import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
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
import { ServiceRequestResponseDto } from './dto/service-request-response.dto';
import { ServiceRequestStatus } from './enums/service-request-status.enum';
import { ServiceRequestType } from './enums/service-request-type.enum';
import { ServiceRequestAssignmentStatus } from './enums/service-request-assignment-status.enum';
import { buildTransition } from './service-request-state-machine';
import { buildAssignmentTransition } from './service-request-assignment-state-machine';
import {
  DirectBookingValidationException,
  NotRequestOwnerException,
  OrganizationDispatchNotSupportedException,
  TenderValidationException,
} from './exceptions/service-request.exceptions';
import { ProviderType } from '../service-providers/enums/provider-type.enum';
import { SystemRole } from '../users/enums/system-role.enum';

@Injectable()
export class ServiceRequestsService {
  private readonly logger = new Logger(ServiceRequestsService.name);

  constructor(
    private readonly requestRepo: ServiceRequestRepository,
    private readonly assignmentRepo: ServiceRequestAssignmentRepository,
    private readonly providerRepo: ServiceProviderRepository,
    private readonly usersRepo: UsersRepository,
    private readonly notificationsService: NotificationsService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

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

    return this.toResponseDto(record);
  }

  private async isAdmin(userId: string): Promise<boolean> {
    const user = await this.usersRepo.findById(userId);
    return user?.systemRole === SystemRole.ADMIN;
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

    const requestTransition = buildTransition(request.status, ServiceRequestStatus.ASSIGNED);
    const now = new Date();

    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      await this.requestRepo.update(
        requestId,
        {
          status: requestTransition.status,
          assignedServiceProviderId: request.requestedServiceProviderId,
          acceptedAtUtc: now,
        },
        qr.manager,
      );

      const assignmentTransition = buildAssignmentTransition(
        null,
        ServiceRequestAssignmentStatus.ASSIGNED,
      );
      await this.assignmentRepo.create(
        {
          serviceRequestId: requestId,
          workerUserId: callerUserId,
          assignedByUserId: callerUserId,
          status: assignmentTransition.status,
          assignedAtUtc: now,
        },
        qr.manager,
      );

      await qr.commitTransaction();
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }

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
    dto.cancelledAtUtc = record.cancelledAtUtc;
    dto.cancellationReason = record.cancellationReason;
    dto.cancelledByUserId = record.cancelledByUserId;
    dto.createdAtUtc = record.createdAtUtc;
    dto.updatedAtUtc = record.updatedAtUtc;
    return dto;
  }
}
