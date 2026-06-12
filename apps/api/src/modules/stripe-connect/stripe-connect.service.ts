import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { StripeAccount, StripeService } from './stripe.service';
import {
  StripeConnectAccountRecord,
  StripeConnectAccountRepository,
} from './repositories/stripe-connect-account.repository';
import { StripeConnectOnboardingStatus } from './enums/stripe-connect-onboarding-status.enum';
import { ConnectOnboardingResponseDto } from './dto/connect-onboarding-response.dto';
import { ConnectAccountResponseDto } from './dto/connect-account-response.dto';
import {
  ConnectAccountNotFoundException,
  NotConnectAccountOwnerException,
  OrganizationConnectOnboardingNotImplementedException,
  StripeConnectOperationFailedException,
} from './exceptions/stripe-connect.exceptions';
import {
  ServiceProviderRecord,
  ServiceProviderRepository,
} from '../service-providers/repositories/service-provider.repository';
import { ProviderType } from '../service-providers/enums/provider-type.enum';
import { UsersRepository } from '../users/users.repository';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

/**
 * Stripe Connect (Express) onboarding via Account Links — NOT OAuth. Owns the
 * local `stripe_connect_accounts` mirror and the status derivation/sync logic
 * consumed by the inline `account.updated` webhook handler.
 *
 * 3.10a is INDIVIDUAL-provider only; ORGANIZATION onboarding is deferred (501).
 */
@Injectable()
export class StripeConnectService {
  private readonly logger = new Logger(StripeConnectService.name);
  private readonly returnUrl: string;
  private readonly refreshUrl: string;

  constructor(
    private readonly stripe: StripeService,
    private readonly repo: StripeConnectAccountRepository,
    private readonly providerRepo: ServiceProviderRepository,
    private readonly usersRepo: UsersRepository,
    config: ConfigService,
  ) {
    this.returnUrl = config.getOrThrow<string>('CONNECT_ONBOARDING_RETURN_URL');
    this.refreshUrl = config.getOrThrow<string>(
      'CONNECT_ONBOARDING_REFRESH_URL',
    );
  }

  /**
   * Start (or resume) Express onboarding for an INDIVIDUAL provider the caller
   * owns. Creates the Stripe account + local mirror on first call, then returns
   * a fresh Account Link to complete KYC.
   */
  async onboard(
    providerId: string,
    currentUser: JwtPayload,
  ): Promise<ConnectOnboardingResponseDto> {
    const provider = await this.resolveOwnedIndividualProvider(
      providerId,
      currentUser,
    );

    const existing = await this.repo.findByServiceProviderId(provider.id);
    let stripeAccountId: string;

    if (existing) {
      stripeAccountId = existing.stripeAccountId;
    } else {
      // userId is guaranteed non-null for INDIVIDUAL providers (DB CHECK).
      const owner = await this.usersRepo.findById(provider.userId as string);
      if (!owner) throw new NotFoundException('Owning user not found');

      try {
        const account = await this.stripe.client.accounts.create({
          type: 'express',
          country: owner.countryCode,
          email: owner.email,
          capabilities: {
            card_payments: { requested: true },
            transfers: { requested: true },
          },
        });
        const created = await this.repo.create({
          serviceProviderId: provider.id,
          stripeAccountId: account.id,
          onboardingStatus: StripeConnectOnboardingStatus.NOT_STARTED,
          countryCode: (account.country ?? owner.countryCode).toUpperCase(),
          // Stripe returns the currency lowercase; the column stores it UPPERCASE.
          defaultCurrency: (account.default_currency ?? 'CAD').toUpperCase(),
        });
        stripeAccountId = created.stripeAccountId;
        this.logger.log(
          `Created Stripe Express account ${account.id} for provider ${provider.id}`,
        );
      } catch (err) {
        this.wrapStripeError(err);
      }
    }

    return this.createOnboardingLink(stripeAccountId);
  }

  /** Return the local Connect mirror for an owned provider (404 if none). */
  async getStatus(
    providerId: string,
    currentUser: JwtPayload,
  ): Promise<ConnectAccountResponseDto> {
    const provider = await this.resolveOwnedIndividualProvider(
      providerId,
      currentUser,
    );
    const account = await this.repo.findByServiceProviderId(provider.id);
    if (!account) throw new ConnectAccountNotFoundException();
    return ConnectAccountResponseDto.from(account);
  }

  /** Regenerate an Account Link for an owned provider's existing account. */
  async refreshLink(
    providerId: string,
    currentUser: JwtPayload,
  ): Promise<ConnectOnboardingResponseDto> {
    const provider = await this.resolveOwnedIndividualProvider(
      providerId,
      currentUser,
    );
    const account = await this.repo.findByServiceProviderId(provider.id);
    if (!account) throw new ConnectAccountNotFoundException();
    return this.createOnboardingLink(account.stripeAccountId);
  }

  /**
   * Map a Stripe account snapshot to our local onboarding status. Evaluated
   * top-to-bottom, first match wins (order is intentional — see 3.10a brief).
   */
  deriveStatus(account: StripeAccount): StripeConnectOnboardingStatus {
    const currentlyDue = account.requirements?.currently_due ?? [];
    const hasDue = currentlyDue.length > 0;
    const charges = account.charges_enabled === true;
    const payouts = account.payouts_enabled === true;

    // 1. Onboarding form not yet submitted.
    if (!account.details_submitted) {
      return hasDue
        ? StripeConnectOnboardingStatus.INFO_NEEDED
        : StripeConnectOnboardingStatus.NOT_STARTED;
    }
    // 2. Stripe has disabled the account (e.g. requirements past due / rejected).
    if (account.requirements?.disabled_reason) {
      return StripeConnectOnboardingStatus.DISABLED;
    }
    // 3. Fully enabled and nothing outstanding.
    if (charges && payouts && !hasDue) {
      return StripeConnectOnboardingStatus.VERIFIED;
    }
    // 4. Partially enabled but with outstanding requirements.
    if ((charges || payouts) && hasDue) {
      return StripeConnectOnboardingStatus.RESTRICTED;
    }
    // 5. Submitted, under review, nothing enabled yet.
    return StripeConnectOnboardingStatus.PENDING_VERIFICATION;
  }

  /**
   * Overwrite the local mirror from a Stripe account snapshot. `onboardedAtUtc`
   * is stamped once, on the first transition to VERIFIED, and never cleared.
   * Returns the updated record, or null if the account is not Linkr-managed.
   */
  async syncFromAccount(
    account: StripeAccount,
  ): Promise<StripeConnectAccountRecord | null> {
    const status = this.deriveStatus(account);
    const onboardedStamp =
      status === StripeConnectOnboardingStatus.VERIFIED ? new Date() : null;

    return this.repo.sync(account.id, {
      chargesEnabled: account.charges_enabled === true,
      payoutsEnabled: account.payouts_enabled === true,
      requirementsCurrentlyDue: account.requirements?.currently_due ?? [],
      onboardingStatus: status,
      onboardedAtUtcIfVerified: onboardedStamp,
    });
  }

  // --- internals -----------------------------------------------------------

  /**
   * Resolve a provider and assert the caller owns it as an INDIVIDUAL. ORG
   * providers are rejected with 501 (deferred); non-owners with 403.
   */
  private async resolveOwnedIndividualProvider(
    providerId: string,
    currentUser: JwtPayload,
  ): Promise<ServiceProviderRecord> {
    const provider = await this.providerRepo.findById(providerId);
    if (!provider) throw new NotFoundException('Service provider not found');

    if (
      provider.providerType === ProviderType.ORGANIZATION ||
      provider.userId === null
    ) {
      throw new OrganizationConnectOnboardingNotImplementedException();
    }
    if (provider.userId !== currentUser.sub) {
      throw new NotConnectAccountOwnerException();
    }
    return provider;
  }

  /** Create a single-use Account Link for `account_onboarding`. */
  private async createOnboardingLink(
    stripeAccountId: string,
  ): Promise<ConnectOnboardingResponseDto> {
    try {
      const link = await this.stripe.client.accountLinks.create({
        account: stripeAccountId,
        refresh_url: this.refreshUrl,
        return_url: this.returnUrl,
        type: 'account_onboarding',
      });
      const dto = new ConnectOnboardingResponseDto();
      dto.url = link.url;
      // Account Links carry `expires_at` as Unix seconds.
      dto.expiresAt = new Date(link.expires_at * 1000);
      return dto;
    } catch (err) {
      this.wrapStripeError(err);
    }
  }

  /**
   * Surface a Stripe SDK error as a 502 with its message (platform-profile and
   * config errors are common here); rethrow anything else untouched.
   */
  private wrapStripeError(err: unknown): never {
    if (err instanceof Stripe.errors.StripeError) {
      this.logger.error(`Stripe API error (${err.type}): ${err.message}`);
      throw new StripeConnectOperationFailedException(err.message);
    }
    throw err instanceof Error ? err : new Error(String(err));
  }
}
