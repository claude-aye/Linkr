import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { QuoteRecord, QuoteRepository } from './repositories/quote.repository';
import { QuoteStatus } from './enums/quote-status.enum';
import { buildQuoteTransition } from './quote-state-machine';
import { SubmitQuoteDto } from './dto/submit-quote.dto';
import { QuoteResponseDto } from './dto/quote-response.dto';
import {
  ActiveQuoteExistsException,
  NotQuoteOwnerException,
  OrganizationQuoteDispatchNotImplementedException,
  ProviderNotEligibleForCategoryException,
  ProviderProfileRequiredException,
  QuoteExpiredException,
  QuoteValidUntilInPastException,
  RequestNotOpenForQuotingException,
} from './exceptions/quote.exceptions';
import { ServiceRequestsService } from '../service-requests/service-requests.service';
import { ServiceRequestStatus } from '../service-requests/enums/service-request-status.enum';
import { ServiceRequestType } from '../service-requests/enums/service-request-type.enum';
import { NotRequestOwnerException } from '../service-requests/exceptions/service-request.exceptions';
import { ServiceProviderRepository } from '../service-providers/repositories/service-provider.repository';
import { ProfessionalServiceCategoryRepository } from '../service-providers/repositories/professional-service-category.repository';
import { ProviderType } from '../service-providers/enums/provider-type.enum';

/** Postgres unique-violation SQLSTATE — raised by the live-quote partial unique index. */
function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: string; driverError?: { code?: string } };
  return e.code === '23505' || e.driverError?.code === '23505';
}

@Injectable()
export class QuotesService {
  private readonly logger = new Logger(QuotesService.name);

  constructor(
    private readonly quotesRepo: QuoteRepository,
    private readonly serviceRequestsService: ServiceRequestsService,
    private readonly providerRepo: ServiceProviderRepository,
    private readonly pscRepo: ProfessionalServiceCategoryRepository,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  /**
   * Provider submits a quote on an OPEN PROJECT_TENDER. ORG quoting is deferred,
   * so the caller is resolved to their INDIVIDUAL provider profile.
   */
  async submit(
    requestId: string,
    callerUserId: string,
    dto: SubmitQuoteDto,
  ): Promise<QuoteResponseDto> {
    const request = await this.serviceRequestsService.getRequestRecord(requestId);
    if (!request) throw new NotFoundException('Service request not found');

    if (
      request.requestType !== ServiceRequestType.PROJECT_TENDER ||
      request.status !== ServiceRequestStatus.OPEN
    ) {
      throw new RequestNotOpenForQuotingException();
    }

    const provider = await this.providerRepo.findByUserId(callerUserId);
    if (!provider) throw new ProviderProfileRequiredException();

    const eligible = await this.pscRepo.isEligibleForCategory(
      provider.id,
      request.serviceCategoryId,
    );
    if (!eligible) throw new ProviderNotEligibleForCategoryException();

    const validUntil = new Date(dto.validUntilUtc);
    if (validUntil.getTime() <= Date.now()) {
      throw new QuoteValidUntilInPastException();
    }

    try {
      const created = await this.quotesRepo.create({
        serviceRequestId: request.id,
        serviceProviderId: provider.id,
        amount: String(dto.amount),
        currency: dto.currency,
        estimatedDurationMinutes: dto.estimatedDurationMinutes,
        proposedStartAtUtc: dto.proposedStartAtUtc
          ? new Date(dto.proposedStartAtUtc)
          : null,
        description: dto.description,
        validUntilUtc: validUntil,
      });
      this.logger.log(
        `Provider ${provider.id} submitted quote ${created.id} on request ${request.id}`,
      );
      return this.toResponseDto(created);
    } catch (err) {
      if (isUniqueViolation(err)) throw new ActiveQuoteExistsException();
      throw err;
    }
  }

  /**
   * List quotes for a request. The request owner sees every quote; anyone else
   * (a quoting provider) sees only their own.
   */
  async listForRequest(
    requestId: string,
    callerUserId: string,
  ): Promise<QuoteResponseDto[]> {
    const request = await this.serviceRequestsService.getRequestRecord(requestId);
    if (!request) throw new NotFoundException('Service request not found');

    if (request.clientUserId === callerUserId) {
      const quotes = await this.quotesRepo.findByRequestId(requestId);
      return quotes.map((q) => this.toResponseDto(q));
    }

    const provider = await this.providerRepo.findByUserId(callerUserId);
    if (!provider) return [];
    const quotes = await this.quotesRepo.findByRequestIdAndProvider(
      requestId,
      provider.id,
    );
    return quotes.map((q) => this.toResponseDto(q));
  }

  /** The caller's own quotes (across all requests), as a provider. */
  async listMine(callerUserId: string): Promise<QuoteResponseDto[]> {
    const provider = await this.providerRepo.findByUserId(callerUserId);
    if (!provider) return [];
    const quotes = await this.quotesRepo.findByProviderId(provider.id);
    return quotes.map((q) => this.toResponseDto(q));
  }

  /** Provider withdraws their own SUBMITTED quote. */
  async withdraw(
    quoteId: string,
    callerUserId: string,
  ): Promise<QuoteResponseDto> {
    const quote = await this.quotesRepo.findById(quoteId);
    if (!quote) throw new NotFoundException('Quote not found');

    const provider = await this.providerRepo.findById(quote.serviceProviderId);
    if (!provider || provider.userId !== callerUserId) {
      throw new NotQuoteOwnerException();
    }

    const transition = buildQuoteTransition(quote.status, QuoteStatus.WITHDRAWN);
    await this.quotesRepo.updateStatus(quoteId, transition.status);

    this.logger.log(`Provider ${provider.id} withdrew quote ${quoteId}`);
    const updated = await this.quotesRepo.findById(quoteId);
    if (!updated) throw new NotFoundException('Quote not found after update');
    return this.toResponseDto(updated);
  }

  /**
   * Client (request owner) accepts a quote. Fully atomic:
   * locks the quote + parent request, accepts the quote, rejects siblings,
   * transitions the request OPEN→ASSIGNED and self-assigns the INDIVIDUAL
   * provider (reusing the service-requests assignment path). ORG providers are
   * rejected (501) pending the worker-dispatch feature; the tx rolls back.
   */
  async accept(quoteId: string, callerUserId: string): Promise<QuoteResponseDto> {
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      // 1. Lock the quote, then its parent request.
      const quote = await this.quotesRepo.findByIdForUpdate(quoteId, qr.manager);
      if (!quote) throw new NotFoundException('Quote not found');

      const request = await this.serviceRequestsService.lockRequestForUpdate(
        quote.serviceRequestId,
        qr.manager,
      );
      if (!request) throw new NotFoundException('Service request not found');

      // 2. Only the request owner may accept.
      if (request.clientUserId !== callerUserId) {
        throw new NotRequestOwnerException();
      }

      // 3. The request must be an OPEN project tender.
      if (
        request.requestType !== ServiceRequestType.PROJECT_TENDER ||
        request.status !== ServiceRequestStatus.OPEN
      ) {
        throw new RequestNotOpenForQuotingException();
      }

      // 4. The quote must be SUBMITTED and still within its validity window.
      const quoteTransition = buildQuoteTransition(quote.status, QuoteStatus.ACCEPTED);
      if (new Date(quote.validUntilUtc).getTime() <= Date.now()) {
        throw new QuoteExpiredException();
      }

      // 5. Accept the quote.
      await this.quotesRepo.updateStatus(quote.id, quoteTransition.status, qr.manager);

      // 6. Auto-reject the other live quotes.
      const rejected = await this.quotesRepo.rejectSiblings(
        request.id,
        quote.id,
        qr.manager,
      );

      // 7 + 8. Resolve the accepted provider, then reuse the INDIVIDUAL
      // self-assign path (request OPEN→ASSIGNED + assignment row).
      const provider = await this.providerRepo.findById(quote.serviceProviderId);
      if (!provider) throw new NotFoundException('Service provider not found');
      if (provider.providerType === ProviderType.ORGANIZATION || provider.userId === null) {
        throw new OrganizationQuoteDispatchNotImplementedException();
      }

      await this.serviceRequestsService.assignIndividualProvider(qr.manager, {
        requestId: request.id,
        currentStatus: request.status,
        serviceProviderId: provider.id,
        workerUserId: provider.userId,
      });

      await qr.commitTransaction();
      this.logger.log(
        `Quote ${quote.id} accepted on request ${request.id}; ${rejected} sibling(s) rejected`,
      );
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }

    const updated = await this.quotesRepo.findById(quoteId);
    if (!updated) throw new NotFoundException('Quote not found after update');
    return this.toResponseDto(updated);
  }

  /**
   * Hourly sweep: bulk-expire SUBMITTED quotes past their validity window.
   * QUOTE-level expiry (valid_until_utc) — distinct from the request-level
   * quotes_deadline_utc expiry handled by the service-requests cron.
   */
  async runExpiryCheck(): Promise<{ expired: number }> {
    const expired = await this.quotesRepo.expireOverdue();
    if (expired > 0) {
      this.logger.log(`Quote expiry check: ${expired} quote(s) transitioned to EXPIRED`);
    }
    return { expired };
  }

  private toResponseDto(record: QuoteRecord): QuoteResponseDto {
    const dto = new QuoteResponseDto();
    dto.id = record.id;
    dto.serviceRequestId = record.serviceRequestId;
    dto.serviceProviderId = record.serviceProviderId;
    dto.amount = record.amount;
    dto.currency = record.currency;
    dto.estimatedDurationMinutes = record.estimatedDurationMinutes;
    dto.proposedStartAtUtc = record.proposedStartAtUtc;
    dto.description = record.description;
    dto.status = record.status;
    dto.validUntilUtc = record.validUntilUtc;
    dto.createdAtUtc = record.createdAtUtc;
    dto.updatedAtUtc = record.updatedAtUtc;
    return dto;
  }
}
