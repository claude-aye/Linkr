import { HttpException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { QuoteRecord, QuoteRepository } from './repositories/quote.repository';
import { QuoteStatus } from './enums/quote-status.enum';
import { buildQuoteTransition } from './quote-state-machine';
import {
  QuoteAcceptabilityViolation,
  quoteAcceptabilityViolation,
} from './quote-acceptability';
import { SubmitQuoteDto } from './dto/submit-quote.dto';
import { QuoteResponseDto } from './dto/quote-response.dto';
import {
  ActiveQuoteExistsException,
  NotQuoteOwnerException,
  OrganizationQuoteDispatchNotImplementedException,
  ProviderNotEligibleForCategoryException,
  ProviderProfileRequiredException,
  ProviderUnavailableException,
  QuoteExpiredException,
  QuotesDeadlinePassedException,
  QuoteValidUntilInPastException,
  RequestNotOpenForQuotingException,
  SelfQuoteForbiddenException,
} from './exceptions/quote.exceptions';
import { ServiceRequestsService } from '../service-requests/service-requests.service';
import { ServiceRequestStatus } from '../service-requests/enums/service-request-status.enum';
import { ServiceRequestType } from '../service-requests/enums/service-request-type.enum';
import {
  InvalidStateTransitionException,
  NotRequestOwnerException,
} from '../service-requests/exceptions/service-request.exceptions';
import { ServiceProviderRepository } from '../service-providers/repositories/service-provider.repository';
import { ProfessionalServiceCategoryRepository } from '../service-providers/repositories/professional-service-category.repository';
import { PaymentsService } from '../payments/payments.service';

/** Postgres unique-violation SQLSTATE — raised by the live-quote partial unique index. */
function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: string; driverError?: { code?: string } };
  return e.code === '23505' || e.driverError?.code === '23505';
}

/**
 * Result of a quote accept — same two facts as `AcceptRequestOutcome`
 * (service-requests), reported separately for the same reason: the assignment
 * is committed and irreversible, the deposit may not have settled. The
 * controller turns `depositSettled: false` into a 202.
 */
export interface AcceptQuoteOutcome {
  quote: QuoteResponseDto;
  /** False when the capture threw AFTER the assignment was committed. */
  depositSettled: boolean;
}

/**
 * Each acceptability reason → the exception `accept` has always thrown for it.
 * Exhaustive by construction: a new reason that is not mapped here does not
 * compile. The only reason without a historical exception is PROVIDER_PAUSED,
 * which is new (409).
 */
function acceptViolationException(
  violation: QuoteAcceptabilityViolation,
  quoteStatus: QuoteStatus,
): HttpException {
  switch (violation) {
    case QuoteAcceptabilityViolation.REQUEST_NOT_OPEN_TENDER:
      return new RequestNotOpenForQuotingException();
    case QuoteAcceptabilityViolation.QUOTE_NOT_SUBMITTED:
      // Same exception, same message the quote state machine throws.
      return new InvalidStateTransitionException(
        quoteStatus as unknown as ServiceRequestStatus,
        QuoteStatus.ACCEPTED as unknown as ServiceRequestStatus,
      );
    case QuoteAcceptabilityViolation.QUOTE_EXPIRED:
      return new QuoteExpiredException();
    case QuoteAcceptabilityViolation.PROVIDER_GONE:
      return new NotFoundException('Service provider not found');
    case QuoteAcceptabilityViolation.PROVIDER_ORGANIZATION:
      return new OrganizationQuoteDispatchNotImplementedException();
    case QuoteAcceptabilityViolation.PROVIDER_PAUSED:
      return new ProviderUnavailableException();
  }
}

@Injectable()
export class QuotesService {
  private readonly logger = new Logger(QuotesService.name);

  constructor(
    private readonly quotesRepo: QuoteRepository,
    private readonly serviceRequestsService: ServiceRequestsService,
    private readonly providerRepo: ServiceProviderRepository,
    private readonly pscRepo: ProfessionalServiceCategoryRepository,
    private readonly paymentsService: PaymentsService,
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
    // Captured ONCE: the deadline check below and the validity check further
    // down must speak of the same instant.
    const now = new Date();

    const request = await this.serviceRequestsService.getRequestRecord(requestId);
    if (!request) throw new NotFoundException('Service request not found');

    if (
      request.requestType !== ServiceRequestType.PROJECT_TENDER ||
      request.status !== ServiceRequestStatus.OPEN
    ) {
      throw new RequestNotOpenForQuotingException();
    }

    // R6 — no quote once the deadline is reached. OPEN is no longer enough:
    // since R7 a tender stays OPEN through the selection window, precisely so
    // the client can still accept one of the quotes already in. Without this
    // guard, a provider could quote for another seven days on a call that the
    // copy says is closed, and the client would be handed offers that arrived
    // after everyone else's.
    //
    // ⚠️ GUARD AGAINST NULL EXPLICITLY. `now >= null` is `true` in JS (null
    // coerces to 0), so the shorthand would 409 every legacy tender whose
    // deadline is null — R1 makes the column mandatory at creation, but rows
    // predating it are not rewritten. Reached ⇒ refused: `now < deadline` is
    // the only accepting case, so the exact millisecond of the deadline is
    // already too late.
    //
    // `submit` WRITES NOTHING here: it does not flip the request to EXPIRED.
    // The cron stays the sole writer of that transition — a read path that
    // mutates state would expire a tender as a side effect of someone merely
    // trying to quote on it.
    if (
      request.quotesDeadlineUtc !== null &&
      now.getTime() >= new Date(request.quotesDeadlineUtc).getTime()
    ) {
      throw new QuotesDeadlinePassedException();
    }

    // No quoting on your own tender. Without this, a client who also holds a
    // provider profile could quote on their own call for tenders, then accept
    // that quote: the job assigned to themselves, a deposit captured from their
    // own card to their own Connect account.
    //
    // Compared on the USER, not the provider: `findByUserId` resolves the
    // caller's INDIVIDUAL profile, so caller and profile owner are the same
    // person by construction — and the check needs no read to run. Placed
    // BEFORE the profile lookup for that reason: the answer is known from the
    // request alone.
    //
    // ORGANIZATION quoting is deferred (`accept` answers 501 on it), so the
    // "member of the org that published the tender" case cannot arise here yet.
    // It is tracked as debt, not solved: no path resolves user → org providers.
    if (request.clientUserId === callerUserId) {
      throw new SelfQuoteForbiddenException();
    }

    const provider = await this.providerRepo.findByUserId(callerUserId);
    if (!provider) throw new ProviderProfileRequiredException();

    const eligible = await this.pscRepo.isEligibleForCategory(
      provider.id,
      request.serviceCategoryId,
    );
    if (!eligible) throw new ProviderNotEligibleForCategoryException();

    const validUntil = new Date(dto.validUntilUtc);
    if (validUntil.getTime() <= now.getTime()) {
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
  async accept(quoteId: string, callerUserId: string): Promise<AcceptQuoteOutcome> {
    // Populated on the happy path (just before commit); consumed AFTER the tx
    // releases to capture the deposit outside the transaction.
    let depositParams: {
      serviceRequestId: string;
      clientUserId: string;
      serviceProviderId: string;
      agreedAmount: string | null;
      agreedCurrency: string | null;
    } | null = null;

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

      // 3. Every "can this quote be accepted?" rule, in ONE place shared with
      //    the client's received-quotes list (`quote-acceptability.ts`). Checked
      //    on the locked records and BEFORE any write, so a refusal rolls back
      //    a transaction that has touched nothing. The provider read moved up
      //    for that reason; it used to run after the quote updates, which the
      //    rollback undid anyway — the HTTP codes are unchanged.
      const provider = await this.providerRepo.findById(quote.serviceProviderId);
      const violation = quoteAcceptabilityViolation(
        request,
        quote,
        // `findById` filters soft-deleted rows: a provider it returns is live.
        provider ? { ...provider, deleted: false } : null,
        new Date(),
      );
      if (violation !== null) {
        throw acceptViolationException(violation, quote.status);
      }
      // Narrowing for the compiler: `violation === null` already excludes both.
      if (!provider || provider.userId === null) {
        throw new OrganizationQuoteDispatchNotImplementedException();
      }

      // 4. Accept the quote (the transition cannot fail: SUBMITTED checked above).
      const quoteTransition = buildQuoteTransition(quote.status, QuoteStatus.ACCEPTED);
      await this.quotesRepo.updateStatus(quote.id, quoteTransition.status, qr.manager);

      // 5. Auto-reject the other live quotes.
      const rejected = await this.quotesRepo.rejectSiblings(
        request.id,
        quote.id,
        qr.manager,
      );

      // 6. Reuse the INDIVIDUAL self-assign path (request OPEN→ASSIGNED +
      //    assignment row).
      await this.serviceRequestsService.assignIndividualProvider(qr.manager, {
        requestId: request.id,
        currentStatus: request.status,
        serviceProviderId: provider.id,
        workerUserId: provider.userId,
        clientUserId: request.clientUserId,
        // D8 a été tranchée pour la RÉSERVATION DIRECTE seulement : aucune règle de
        // résolution n'est décidée pour le chemin tender. `null` EXPLICITE, jamais une
        // omission — c'est ce site d'appel qu'il faudra changer le jour où un tender
        // portera une heure retenue.
        scheduledAtUtc: null,
      });

      // Agreed amount for a PROJECT_TENDER is the accepted quote's amount.
      depositParams = {
        serviceRequestId: request.id,
        clientUserId: request.clientUserId,
        serviceProviderId: provider.id,
        agreedAmount: quote.amount,
        agreedCurrency: quote.currency,
      };

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

    // Deposit capture (Part 5) runs AFTER the assignment commits (outside the tx).
    //
    // ⚠️ NOTHING THROWN BY THE CAPTURE MAY ESCAPE — same rule, same reasons as
    // T4 in `ServiceRequestsService.acceptRequest` (read the comment there; it
    // is not duplicated here). The assignment is committed: the job IS the
    // provider's, whatever the card did. The deposit is reported through
    // `depositSettled` (→ 202) and stays retryable from the provider dashboard.
    // `assertDepositBasis` is not needed on this path: `quotes.amount` and
    // `quotes.currency` are NOT NULL in the schema.
    let depositSettled = true;
    if (depositParams) {
      try {
        await this.paymentsService.captureDeposit(depositParams);
      } catch (err) {
        depositSettled = false;
        const detail = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `Quote ${quoteId} accepted: request ${depositParams.serviceRequestId} was assigned to ` +
            `provider ${depositParams.serviceProviderId} but the deposit did NOT settle: ${detail}`,
        );
        this.serviceRequestsService.announceDepositFailure(depositParams.serviceRequestId);
      }
    }

    const updated = await this.quotesRepo.findById(quoteId);
    if (!updated) throw new NotFoundException('Quote not found after update');
    return { quote: this.toResponseDto(updated), depositSettled };
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
