import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { ServiceRequestRepository } from './repositories/service-request.repository';
import { ServiceRequestRecord } from './repositories/service-request.repository';
import { ServiceRequestAssignmentRepository } from './repositories/service-request-assignment.repository';
import { ServiceProviderRepository } from '../service-providers/repositories/service-provider.repository';
import { UsersRepository } from '../users/users.repository';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateServiceRequestDto } from './dto/create-service-request.dto';
import { CancelServiceRequestDto } from './dto/cancel-service-request.dto';
import { DeclineServiceRequestDto } from './dto/decline-service-request.dto';
import { ListServiceRequestsDto } from './dto/list-service-requests.dto';
import { ListProviderServiceRequestsDto } from './dto/list-provider-service-requests.dto';
import { ServiceRequestResponseDto } from './dto/service-request-response.dto';
import { ProviderServiceRequestItemDto } from './dto/provider-service-request-item.dto';
import { ServiceRequestStatus } from './enums/service-request-status.enum';
import { ServiceRequestType } from './enums/service-request-type.enum';
import { ServiceRequestAssignmentStatus } from './enums/service-request-assignment-status.enum';
import { buildTransition } from './service-request-state-machine';
import { buildAssignmentTransition } from './service-request-assignment-state-machine';
import {
  DirectBookingValidationException,
  NotRequestOwnerException,
  OrganizationDispatchNotSupportedException,
  RequestAlreadyContestedException,
  RequestContestedException,
  RequestNotCompletedException,
  TenderValidationException,
} from './exceptions/service-request.exceptions';
import { ProviderType } from '../service-providers/enums/provider-type.enum';
import { SystemRole } from '../users/enums/system-role.enum';
import { PaymentsService } from '../payments/payments.service';

@Injectable()
export class ServiceRequestsService {
  private readonly logger = new Logger(ServiceRequestsService.name);

  private readonly autoReleaseHours: number;

  constructor(
    private readonly requestRepo: ServiceRequestRepository,
    private readonly assignmentRepo: ServiceRequestAssignmentRepository,
    private readonly providerRepo: ServiceProviderRepository,
    private readonly usersRepo: UsersRepository,
    private readonly notificationsService: NotificationsService,
    private readonly paymentsService: PaymentsService,
    config: ConfigService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {
    this.autoReleaseHours = config.getOrThrow<number>('PLATFORM_AUTO_RELEASE_HOURS');
  }

  async create(
    clientUserId: string,
    dto: CreateServiceRequestDto,
  ): Promise<ServiceRequestResponseDto> {
    if (dto.requestType === ServiceRequestType.DIRECT_BOOKING) {
      if (!dto.serviceItemId) {
        throw new DirectBookingValidationException(
          'DIRECT_BOOKING requires serviceItemId',
        );
      }
      if (!dto.requestedServiceProviderId) {
        throw new DirectBookingValidationException(
          'DIRECT_BOOKING requires requestedServiceProviderId',
        );
      }
      const provider = await this.providerRepo.findById(dto.requestedServiceProviderId);
      if (!provider) {
        throw new NotFoundException('Service provider not found');
      }
      if (!provider.isActive) {
        throw new DirectBookingValidationException(
          'The requested service provider is not active',
        );
      }
    }

    if (dto.requestType === ServiceRequestType.PROJECT_TENDER) {
      if (dto.requestedServiceProviderId) {
        throw new TenderValidationException();
      }
    }

    const transition = buildTransition(null, ServiceRequestStatus.OPEN);

    const record = await this.requestRepo.create({
      clientUserId,
      requestType: dto.requestType,
      status: transition.status,
      serviceCategoryId: dto.serviceCategoryId,
      serviceItemId: dto.serviceItemId ?? null,
      requestedServiceProviderId: dto.requestedServiceProviderId ?? null,
      title: dto.title,
      description: dto.description,
      serviceAddress: dto.serviceAddress,
      serviceLocation: dto.serviceLocation,
      desiredStartAtUtc: dto.desiredStartAtUtc ? new Date(dto.desiredStartAtUtc) : null,
      desiredEndAtUtc: dto.desiredEndAtUtc ? new Date(dto.desiredEndAtUtc) : null,
      estimatedAmount: dto.estimatedAmount != null ? String(dto.estimatedAmount) : null,
      estimatedCurrency: dto.estimatedCurrency ?? null,
      responseDeadlineUtc: dto.responseDeadlineUtc ? new Date(dto.responseDeadlineUtc) : null,
      quotesDeadlineUtc: dto.quotesDeadlineUtc ? new Date(dto.quotesDeadlineUtc) : null,
    });

    // Best-effort broadcast: notify eligible providers when a PROJECT_TENDER
    // is created. Failures are logged and swallowed — they must never rollback
    // the request creation, which is already committed at this point.
    if (record.requestType === ServiceRequestType.PROJECT_TENDER) {
      this.notificationsService.broadcastTenderMatch(record).catch((err: unknown) => {
        this.logger.error(
          `broadcastTenderMatch failed for request ${record.id}: ${String(err)}`,
        );
      });
    }

    // Same terms for a DIRECT_BOOKING, but targeted: the client picked this one
    // provider, so only that provider is told. A separate call rather than a
    // branch inside broadcastTenderMatch(), whose geographic fan-out is exactly
    // what a direct booking must not trigger.
    if (
      record.requestType === ServiceRequestType.DIRECT_BOOKING &&
      record.requestedServiceProviderId
    ) {
      this.notificationsService.notifyDirectBooking(record).catch((err: unknown) => {
        this.logger.error(
          `notifyDirectBooking failed for request ${record.id}: ${String(err)}`,
        );
      });
    }

    return this.toResponseDto(record);
  }

  private async isAdmin(userId: string): Promise<boolean> {
    const user = await this.usersRepo.findById(userId);
    return user?.systemRole === SystemRole.ADMIN;
  }

  /**
   * Raw request lookup with no ownership enforcement — for cross-domain callers
   * (e.g. the Quotes module) that perform their own authorization. The
   * endpoint-facing reader is {@link findById}, which gates by owner/admin.
   */
  async getRequestRecord(requestId: string): Promise<ServiceRequestRecord | null> {
    return this.requestRepo.findById(requestId);
  }

  /**
   * Locked request read (SELECT ... FOR UPDATE) inside a caller-provided
   * transaction. Lets cross-domain transactions (e.g. quote acceptance)
   * serialize on the request row before mutating it.
   */
  async lockRequestForUpdate(
    requestId: string,
    manager: EntityManager,
  ): Promise<ServiceRequestRecord | null> {
    return this.requestRepo.findByIdForUpdate(requestId, manager);
  }

  /**
   * Shared INDIVIDUAL auto-self-assign path (3.8c-1), reused by DIRECT_BOOKING
   * acceptance and by quote acceptance (3.9). Within the caller's transaction:
   *   • transitions the request <current>→ASSIGNED (state-machine guarded),
   *     stamping assigned_service_provider_id + accepted_at_utc;
   *   • inserts a self-assignment (worker = assigned_by = the individual's user).
   *
   * The caller MUST ensure the provider is INDIVIDUAL with a non-null user id —
   * ORGANIZATION dispatch is rejected upstream with endpoint-specific semantics
   * (DIRECT_BOOKING → 422, quotes → 501).
   *
   * Before transitioning, a payability guard (Part 4) is enforced INSIDE the
   * caller's transaction: a 409 here rolls the whole assignment back. The
   * subsequent deposit capture (Part 5) is the caller's responsibility, AFTER
   * the transaction commits.
   */
  async assignIndividualProvider(
    manager: EntityManager,
    params: {
      requestId: string;
      currentStatus: ServiceRequestStatus;
      serviceProviderId: string;
      workerUserId: string;
      clientUserId: string;
      now?: Date;
    },
  ): Promise<void> {
    const now = params.now ?? new Date();

    // Payability guard: recipient can take charges + client has a default PM.
    // Throws 409 (rolls back the caller's tx) if the request is not payable.
    await this.paymentsService.assertPayable(
      params.clientUserId,
      params.serviceProviderId,
    );

    const requestTransition = buildTransition(
      params.currentStatus,
      ServiceRequestStatus.ASSIGNED,
    );
    await this.requestRepo.update(
      params.requestId,
      {
        status: requestTransition.status,
        assignedServiceProviderId: params.serviceProviderId,
        acceptedAtUtc: now,
      },
      manager,
    );

    const assignmentTransition = buildAssignmentTransition(
      null,
      ServiceRequestAssignmentStatus.ASSIGNED,
    );
    await this.assignmentRepo.create(
      {
        serviceRequestId: params.requestId,
        workerUserId: params.workerUserId,
        assignedByUserId: params.workerUserId,
        status: assignmentTransition.status,
        assignedAtUtc: now,
      },
      manager,
    );
  }

  async findById(
    requestId: string,
    actingUserId: string,
  ): Promise<ServiceRequestResponseDto> {
    const record = await this.requestRepo.findById(requestId);
    if (!record) throw new NotFoundException('Service request not found');

    const admin = await this.isAdmin(actingUserId);
    if (!admin && record.clientUserId !== actingUserId) {
      throw new NotRequestOwnerException();
    }

    return this.toResponseDto(record);
  }

  async list(
    actingUserId: string,
    dto: ListServiceRequestsDto,
  ): Promise<{ items: ServiceRequestResponseDto[]; total: number; page: number; limit: number }> {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const admin = await this.isAdmin(actingUserId);

    const { items, total } = await this.requestRepo.findAll({
      clientUserId: admin ? undefined : actingUserId,
      status: dto.status,
      requestType: dto.requestType,
      page,
      limit,
    });

    return {
      items: items.map((r) => this.toResponseDto(r)),
      total,
      page,
      limit,
    };
  }

  /**
   * Provider-facing listing for the prestataire dashboard (Vision B: requests
   * ASSIGNED to the provider + DIRECT_BOOKINGs still OPEN and targeted at it).
   * Pure data read — the caller (ProviderServiceRequestsController) has already
   * enforced ownership of `providerId` via `loadOwnedProvider`. Maps through the
   * dedicated label-joined DTO; `toResponseDto`/`list` stay untouched.
   */
  async listForProvider(
    providerId: string,
    dto: ListProviderServiceRequestsDto,
  ): Promise<{
    items: ProviderServiceRequestItemDto[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;

    const { items, total } =
      await this.requestRepo.findAssignedOrTargetedToProvider(providerId, {
        status: dto.status,
        page,
        limit,
      });

    return {
      items: items.map((r) => ProviderServiceRequestItemDto.fromWithLabels(r)),
      total,
      page,
      limit,
    };
  }

  async cancel(
    requestId: string,
    actingUserId: string,
    dto: CancelServiceRequestDto,
  ): Promise<ServiceRequestResponseDto> {
    const record = await this.requestRepo.findById(requestId);
    if (!record) throw new NotFoundException('Service request not found');

    const admin = await this.isAdmin(actingUserId);
    if (!admin && record.clientUserId !== actingUserId) {
      throw new NotRequestOwnerException();
    }

    const transition = buildTransition(record.status, ServiceRequestStatus.CANCELLED, {
      cancelledByUserId: actingUserId,
      cancellationReason: dto.cancellationReason,
    });

    await this.requestRepo.update(requestId, {
      status: transition.status,
      cancelledAtUtc: transition.cancelledAtUtc,
      cancellationReason: transition.cancellationReason,
      cancelledByUserId: transition.cancelledByUserId,
    });

    const updated = await this.requestRepo.findById(requestId);
    if (!updated) throw new NotFoundException('Service request not found after update');
    return this.toResponseDto(updated);
  }

  /**
   * Accept a DIRECT_BOOKING: OPEN→ASSIGNED on the request + create assignment.
   * Only the targeted INDIVIDUAL provider (caller must be provider.user_id).
   */
  async acceptRequest(
    requestId: string,
    callerUserId: string,
  ): Promise<ServiceRequestResponseDto> {
    const request = await this.requestRepo.findById(requestId);
    if (!request) throw new NotFoundException('Service request not found');

    if (request.requestType !== ServiceRequestType.DIRECT_BOOKING) {
      throw new DirectBookingValidationException(
        'Only DIRECT_BOOKING requests can be accepted by a provider',
      );
    }
    if (!request.requestedServiceProviderId) {
      throw new DirectBookingValidationException(
        'No provider is targeted by this request',
      );
    }

    const provider = await this.providerRepo.findById(request.requestedServiceProviderId);
    if (!provider) throw new NotFoundException('Service provider not found');

    if (provider.providerType === ProviderType.ORGANIZATION) {
      throw new OrganizationDispatchNotSupportedException();
    }

    if (provider.userId !== callerUserId) {
      throw new ForbiddenException('You are not the targeted provider for this request');
    }

    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      await this.assignIndividualProvider(qr.manager, {
        requestId,
        currentStatus: request.status,
        serviceProviderId: request.requestedServiceProviderId,
        // INDIVIDUAL provider self-assigns: caller === provider.user_id (asserted above).
        workerUserId: callerUserId,
        clientUserId: request.clientUserId,
      });
      await qr.commitTransaction();
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }

    // Deposit capture (Part 5) runs AFTER the assignment commits. Agreed amount
    // for a DIRECT_BOOKING lives on the request (estimated_amount/currency).
    await this.paymentsService.captureDeposit({
      serviceRequestId: requestId,
      clientUserId: request.clientUserId,
      serviceProviderId: request.requestedServiceProviderId,
      agreedAmount: request.estimatedAmount,
      agreedCurrency: request.estimatedCurrency,
    });

    this.logger.log(`Provider ${request.requestedServiceProviderId} accepted request ${requestId}`);
    const updated = await this.requestRepo.findById(requestId);
    if (!updated) throw new NotFoundException('Service request not found after update');
    return this.toResponseDto(updated);
  }

  /**
   * Decline a DIRECT_BOOKING: OPEN→CANCELLED on the request. No assignment created.
   * Only the targeted INDIVIDUAL provider.
   */
  async declineRequest(
    requestId: string,
    callerUserId: string,
    dto: DeclineServiceRequestDto,
  ): Promise<ServiceRequestResponseDto> {
    const request = await this.requestRepo.findById(requestId);
    if (!request) throw new NotFoundException('Service request not found');

    if (request.requestType !== ServiceRequestType.DIRECT_BOOKING) {
      throw new DirectBookingValidationException(
        'Only DIRECT_BOOKING requests can be declined by a provider',
      );
    }
    if (!request.requestedServiceProviderId) {
      throw new DirectBookingValidationException(
        'No provider is targeted by this request',
      );
    }

    const provider = await this.providerRepo.findById(request.requestedServiceProviderId);
    if (!provider) throw new NotFoundException('Service provider not found');

    if (provider.providerType === ProviderType.ORGANIZATION) {
      throw new OrganizationDispatchNotSupportedException();
    }

    if (provider.userId !== callerUserId) {
      throw new ForbiddenException('You are not the targeted provider for this request');
    }

    const requestTransition = buildTransition(
      request.status,
      ServiceRequestStatus.CANCELLED,
      {
        cancelledByUserId: callerUserId,
        cancellationReason: dto.reason ?? 'Refusé par le prestataire',
      },
    );

    await this.requestRepo.update(requestId, {
      status: requestTransition.status,
      cancelledAtUtc: requestTransition.cancelledAtUtc,
      cancellationReason: requestTransition.cancellationReason,
      cancelledByUserId: requestTransition.cancelledByUserId,
    });

    this.logger.log(`Provider ${request.requestedServiceProviderId} declined request ${requestId}`);
    const updated = await this.requestRepo.findById(requestId);
    if (!updated) throw new NotFoundException('Service request not found after update');
    return this.toResponseDto(updated);
  }

  /**
   * Start a request: assignment ASSIGNED→ACCEPTED_BY_WORKER + request ASSIGNED→IN_PROGRESS.
   * Caller must be the worker_user_id of the live assignment.
   */
  async startRequest(
    requestId: string,
    callerUserId: string,
  ): Promise<ServiceRequestResponseDto> {
    const request = await this.requestRepo.findById(requestId);
    if (!request) throw new NotFoundException('Service request not found');

    // Validate the request-level transition first → 409 if not ASSIGNED (e.g. still OPEN).
    // This prevents a misleading 404 from the assignment lookup below.
    const requestTransition = buildTransition(request.status, ServiceRequestStatus.IN_PROGRESS);

    const assignment = await this.assignmentRepo.findLiveByRequestId(requestId);
    if (!assignment) throw new NotFoundException('No active assignment found for this request');

    if (assignment.workerUserId !== callerUserId) {
      throw new ForbiddenException('You are not the assigned worker for this request');
    }

    const assignmentTransition = buildAssignmentTransition(
      assignment.status,
      ServiceRequestAssignmentStatus.ACCEPTED_BY_WORKER,
    );

    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      await this.assignmentRepo.update(
        assignment.id,
        {
          status: assignmentTransition.status,
          acknowledgedAtUtc: assignmentTransition.acknowledgedAtUtc,
        },
        qr.manager,
      );
      await this.requestRepo.update(requestId, { status: requestTransition.status }, qr.manager);
      await qr.commitTransaction();
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }

    this.logger.log(`Worker ${callerUserId} started request ${requestId}`);
    const updated = await this.requestRepo.findById(requestId);
    if (!updated) throw new NotFoundException('Service request not found after update');
    return this.toResponseDto(updated);
  }

  /**
   * Complete a request: assignment ACCEPTED_BY_WORKER→COMPLETED + request IN_PROGRESS→COMPLETED.
   * Caller must be the worker_user_id of the live assignment.
   */
  async completeRequest(
    requestId: string,
    callerUserId: string,
  ): Promise<ServiceRequestResponseDto> {
    const request = await this.requestRepo.findById(requestId);
    if (!request) throw new NotFoundException('Service request not found');

    // Validate the request-level transition first → 409 if not IN_PROGRESS (e.g. still ASSIGNED).
    const requestTransition = buildTransition(request.status, ServiceRequestStatus.COMPLETED);

    const assignment = await this.assignmentRepo.findLiveByRequestId(requestId);
    if (!assignment) throw new NotFoundException('No active assignment found for this request');

    if (assignment.workerUserId !== callerUserId) {
      throw new ForbiddenException('You are not the assigned worker for this request');
    }

    const assignmentTransition = buildAssignmentTransition(
      assignment.status,
      ServiceRequestAssignmentStatus.COMPLETED,
    );
    const now = new Date();

    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      await this.assignmentRepo.update(
        assignment.id,
        {
          status: assignmentTransition.status,
          completedAtUtc: assignmentTransition.completedAtUtc,
        },
        qr.manager,
      );
      await this.requestRepo.update(
        requestId,
        { status: requestTransition.status, completedAtUtc: now },
        qr.manager,
      );
      await qr.commitTransaction();
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }

    this.logger.log(`Worker ${callerUserId} completed request ${requestId}`);
    const updated = await this.requestRepo.findById(requestId);
    if (!updated) throw new NotFoundException('Service request not found after update');
    return this.toResponseDto(updated);
  }

  /**
   * Client confirms a COMPLETED job → triggers the 80% balance capture. Only
   * the request owner (client_user_id) may confirm. The COMPLETED→PAID
   * transition is NOT done here — the webhook worker drives it once the BALANCE
   * PaymentIntent succeeds. Idempotent: a re-confirm short-circuits in
   * captureBalance (BALANCE unique guard); an already-PAID request is a no-op.
   */
  async confirmCompletion(
    requestId: string,
    callerUserId: string,
  ): Promise<ServiceRequestResponseDto> {
    const request = await this.requestRepo.findById(requestId);
    if (!request) throw new NotFoundException('Service request not found');
    if (request.clientUserId !== callerUserId) {
      throw new ForbiddenException('Only the client can confirm completion');
    }

    // Already settled (e.g. the auto-release cron won the race) → idempotent OK.
    if (request.status === ServiceRequestStatus.PAID) {
      return this.toResponseDto(request);
    }
    if (request.status !== ServiceRequestStatus.COMPLETED) {
      throw new RequestNotCompletedException();
    }
    if (request.contestedAtUtc !== null) {
      throw new RequestContestedException();
    }

    await this.releaseBalance(request);

    this.logger.log(`Client ${callerUserId} confirmed completion of request ${requestId}`);
    const updated = await this.requestRepo.findById(requestId);
    if (!updated) throw new NotFoundException('Service request not found after update');
    return this.toResponseDto(updated);
  }

  /**
   * Client contests a COMPLETED job → freezes the auto-release timer and routes
   * to admin (no dispute state machine in MVP — this only sets the flag). Only
   * the request owner may contest, and only once.
   */
  async contest(
    requestId: string,
    callerUserId: string,
  ): Promise<ServiceRequestResponseDto> {
    const request = await this.requestRepo.findById(requestId);
    if (!request) throw new NotFoundException('Service request not found');
    if (request.clientUserId !== callerUserId) {
      throw new ForbiddenException('Only the client can contest this request');
    }
    if (request.status !== ServiceRequestStatus.COMPLETED) {
      throw new RequestNotCompletedException();
    }
    if (request.contestedAtUtc !== null) {
      throw new RequestAlreadyContestedException();
    }

    await this.requestRepo.setContestedAt(requestId, new Date());

    this.logger.log(`Client ${callerUserId} contested request ${requestId}`);
    const updated = await this.requestRepo.findById(requestId);
    if (!updated) throw new NotFoundException('Service request not found after update');
    return this.toResponseDto(updated);
  }

  /**
   * Resolve the agreed amount + currency (the balance basis), mirroring the
   * deposit basis: a DIRECT_BOOKING uses the request's estimate; a
   * PROJECT_TENDER uses the accepted quote.
   */
  private async resolveAgreedAmount(
    request: ServiceRequestRecord,
  ): Promise<{ amount: string | null; currency: string | null }> {
    if (request.requestType === ServiceRequestType.DIRECT_BOOKING) {
      return { amount: request.estimatedAmount, currency: request.estimatedCurrency };
    }
    const quote = await this.requestRepo.findAcceptedQuoteAmount(request.id);
    return quote
      ? { amount: quote.amount, currency: quote.currency }
      : { amount: null, currency: null };
  }

  /** Resolve the balance basis and delegate to the shared capture (Part 2). */
  private async releaseBalance(request: ServiceRequestRecord): Promise<void> {
    const agreed = await this.resolveAgreedAmount(request);
    await this.paymentsService.captureBalance({
      serviceRequestId: request.id,
      requestStatus: request.status,
      contestedAtUtc: request.contestedAtUtc,
      agreedAmount: agreed.amount,
      agreedCurrency: agreed.currency,
    });
  }

  /**
   * Webhook-driven COMPLETED→PAID once the BALANCE PaymentIntent succeeds.
   * Idempotent: an already-PAID request is a no-op, and a non-COMPLETED request
   * (an unexpected race) is logged and skipped rather than crashing the worker.
   */
  async markRequestPaid(requestId: string): Promise<void> {
    const request = await this.requestRepo.findById(requestId);
    if (!request) {
      this.logger.warn(`markRequestPaid: request ${requestId} not found`);
      return;
    }
    if (request.status === ServiceRequestStatus.PAID) return;
    if (request.status !== ServiceRequestStatus.COMPLETED) {
      this.logger.warn(
        `markRequestPaid: request ${requestId} is ${request.status}, expected COMPLETED — skipping`,
      );
      return;
    }
    const transition = buildTransition(request.status, ServiceRequestStatus.PAID);
    await this.requestRepo.update(requestId, {
      status: transition.status,
      paidAtUtc: transition.paidAtUtc,
    });
    this.logger.log(`Request ${requestId} → PAID (balance settled)`);
  }

  /**
   * Webhook-driven → REFUNDED when every captured payment of the request is
   * fully refunded (derived by the refunds service). Idempotent; skips (with a
   * log) when the current state does not allow the transition.
   */
  async markRequestRefunded(requestId: string): Promise<void> {
    const request = await this.requestRepo.findById(requestId);
    if (!request) {
      this.logger.warn(`markRequestRefunded: request ${requestId} not found`);
      return;
    }
    if (request.status === ServiceRequestStatus.REFUNDED) return;
    try {
      const transition = buildTransition(request.status, ServiceRequestStatus.REFUNDED);
      await this.requestRepo.update(requestId, { status: transition.status });
      this.logger.log(`Request ${requestId} → REFUNDED (all captured payments refunded)`);
    } catch {
      this.logger.warn(
        `markRequestRefunded: cannot transition request ${requestId} from ${request.status} → REFUNDED — skipping`,
      );
    }
  }

  /**
   * Auto-release sweep (Part 4): trigger the balance capture for COMPLETED,
   * non-contested requests whose release window elapsed. Each capture is
   * idempotent (BALANCE unique guard) so this never double-charges; per-request
   * failures are logged and do not abort the batch.
   */
  async runAutoReleaseCheck(): Promise<{ released: number; failed: number }> {
    const due = await this.requestRepo.findAwaitingRelease(this.autoReleaseHours);
    let released = 0;
    let failed = 0;

    for (const request of due) {
      try {
        await this.releaseBalance(request);
        released++;
      } catch (err) {
        failed++;
        this.logger.error(
          `Auto-release failed for request ${request.id}: ${String(err)}`,
        );
      }
    }

    if (released > 0 || failed > 0) {
      this.logger.log(
        `Auto-release: ${released} balance capture(s) triggered, ${failed} failed`,
      );
    }
    return { released, failed };
  }

  async runExpiryCheck(): Promise<{ expired: number }> {
    const expiredRecords = await this.requestRepo.findExpiredOpen();
    if (expiredRecords.length === 0) return { expired: 0 };

    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    let count = 0;

    try {
      for (const record of expiredRecords) {
        const transition = buildTransition(record.status, ServiceRequestStatus.EXPIRED);
        await this.requestRepo.update(record.id, { status: transition.status }, qr.manager);
        count++;
      }
      await qr.commitTransaction();
      this.logger.log(`Expiry check: ${count} request(s) transitioned to EXPIRED`);
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }

    return { expired: count };
  }

  private toResponseDto(record: ServiceRequestRecord): ServiceRequestResponseDto {
    const dto = new ServiceRequestResponseDto();
    dto.id = record.id;
    dto.clientUserId = record.clientUserId;
    dto.requestType = record.requestType;
    dto.status = record.status;
    dto.serviceCategoryId = record.serviceCategoryId;
    dto.serviceItemId = record.serviceItemId;
    dto.requestedServiceProviderId = record.requestedServiceProviderId;
    dto.assignedServiceProviderId = record.assignedServiceProviderId;
    dto.title = record.title;
    dto.description = record.description;
    dto.serviceAddress = record.serviceAddress;
    dto.serviceLocation = record.serviceLocation;
    dto.desiredStartAtUtc = record.desiredStartAtUtc;
    dto.desiredEndAtUtc = record.desiredEndAtUtc;
    dto.scheduledAtUtc = record.scheduledAtUtc;
    dto.estimatedAmount = record.estimatedAmount;
    dto.estimatedCurrency = record.estimatedCurrency;
    dto.finalAmount = record.finalAmount;
    dto.finalCurrency = record.finalCurrency;
    dto.responseDeadlineUtc = record.responseDeadlineUtc;
    dto.quotesDeadlineUtc = record.quotesDeadlineUtc;
    dto.acceptedAtUtc = record.acceptedAtUtc;
    dto.completedAtUtc = record.completedAtUtc;
    dto.paidAtUtc = record.paidAtUtc;
    dto.contestedAtUtc = record.contestedAtUtc;
    dto.cancelledAtUtc = record.cancelledAtUtc;
    dto.cancellationReason = record.cancellationReason;
    dto.cancelledByUserId = record.cancelledByUserId;
    dto.createdAtUtc = record.createdAtUtc;
    dto.updatedAtUtc = record.updatedAtUtc;
    return dto;
  }
}
