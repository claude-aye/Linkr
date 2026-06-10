import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StripeConnectAccount } from '../entities/stripe-connect-account.entity';
import { StripeConnectAccountType } from '../enums/stripe-connect-account-type.enum';
import { StripeConnectOnboardingStatus } from '../enums/stripe-connect-onboarding-status.enum';

/** Domain record — snake_case columns mapped to camelCase. */
export interface StripeConnectAccountRecord {
  id: string;
  serviceProviderId: string;
  stripeAccountId: string;
  accountType: StripeConnectAccountType;
  onboardingStatus: StripeConnectOnboardingStatus;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  requirementsCurrentlyDue: string[];
  countryCode: string;
  defaultCurrency: string;
  onboardedAtUtc: Date | null;
  createdAtUtc: Date;
  updatedAtUtc: Date;
}

export interface CreateStripeConnectAccountData {
  serviceProviderId: string;
  stripeAccountId: string;
  onboardingStatus: StripeConnectOnboardingStatus;
  countryCode: string;
  defaultCurrency: string;
}

export interface SyncStripeConnectAccountData {
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  requirementsCurrentlyDue: string[];
  onboardingStatus: StripeConnectOnboardingStatus;
  /**
   * Timestamp to stamp IF the account is now VERIFIED and not already stamped.
   * Persisted via COALESCE so an existing value is never overwritten or cleared.
   */
  onboardedAtUtcIfVerified: Date | null;
}

interface RawRow {
  id: string;
  service_provider_id: string;
  stripe_account_id: string;
  account_type: StripeConnectAccountType;
  onboarding_status: StripeConnectOnboardingStatus;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  requirements_currently_due: string[];
  country_code: string;
  default_currency: string;
  onboarded_at_utc: Date | null;
  created_at_utc: Date;
  updated_at_utc: Date;
}

const SELECT_COLUMNS = `
  id, service_provider_id, stripe_account_id, account_type, onboarding_status,
  charges_enabled, payouts_enabled, requirements_currently_due, country_code,
  default_currency, onboarded_at_utc, created_at_utc, updated_at_utc
`;

function mapRow(row: RawRow): StripeConnectAccountRecord {
  return {
    id: row.id,
    serviceProviderId: row.service_provider_id,
    stripeAccountId: row.stripe_account_id,
    accountType: row.account_type,
    onboardingStatus: row.onboarding_status,
    chargesEnabled: row.charges_enabled,
    payoutsEnabled: row.payouts_enabled,
    // jsonb is parsed by the pg driver; guard against a null column just in case.
    requirementsCurrentlyDue: row.requirements_currently_due ?? [],
    countryCode: row.country_code,
    defaultCurrency: row.default_currency,
    onboardedAtUtc: row.onboarded_at_utc,
    createdAtUtc: row.created_at_utc,
    updatedAtUtc: row.updated_at_utc,
  };
}

@Injectable()
export class StripeConnectAccountRepository {
  constructor(
    @InjectRepository(StripeConnectAccount)
    private readonly repo: Repository<StripeConnectAccount>,
  ) {}

  async findByServiceProviderId(
    serviceProviderId: string,
  ): Promise<StripeConnectAccountRecord | null> {
    const rows: RawRow[] = await this.repo.query(
      `SELECT ${SELECT_COLUMNS} FROM stripe_connect_accounts
       WHERE service_provider_id = $1`,
      [serviceProviderId],
    );
    return rows.length ? mapRow(rows[0]) : null;
  }

  async findByStripeAccountId(
    stripeAccountId: string,
  ): Promise<StripeConnectAccountRecord | null> {
    const rows: RawRow[] = await this.repo.query(
      `SELECT ${SELECT_COLUMNS} FROM stripe_connect_accounts
       WHERE stripe_account_id = $1`,
      [stripeAccountId],
    );
    return rows.length ? mapRow(rows[0]) : null;
  }

  async create(
    data: CreateStripeConnectAccountData,
  ): Promise<StripeConnectAccountRecord> {
    // account_type, charges/payouts and requirements default at the DB level.
    const rows: Array<{ id: string }> = await this.repo.query(
      `INSERT INTO stripe_connect_accounts
        (service_provider_id, stripe_account_id, onboarding_status,
         country_code, default_currency)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        data.serviceProviderId,
        data.stripeAccountId,
        data.onboardingStatus,
        data.countryCode,
        data.defaultCurrency,
      ],
    );
    const created = await this.findByStripeAccountId(data.stripeAccountId);
    if (!created) {
      throw new Error('Connect account insert succeeded but read-back failed');
    }
    return created;
  }

  /**
   * Overwrite the mutable Stripe-synced fields for an existing account.
   * `onboarded_at_utc` uses COALESCE so it is stamped at most once (first
   * VERIFIED transition) and never cleared. Returns the updated record, or null
   * if no row matched the Stripe account id.
   */
  async sync(
    stripeAccountId: string,
    data: SyncStripeConnectAccountData,
  ): Promise<StripeConnectAccountRecord | null> {
    const rows: RawRow[] = await this.repo.query(
      `UPDATE stripe_connect_accounts
         SET charges_enabled = $2,
             payouts_enabled = $3,
             requirements_currently_due = $4::jsonb,
             onboarding_status = $5,
             onboarded_at_utc = COALESCE(onboarded_at_utc, $6),
             updated_at_utc = now()
       WHERE stripe_account_id = $1
       RETURNING ${SELECT_COLUMNS}`,
      [
        stripeAccountId,
        data.chargesEnabled,
        data.payoutsEnabled,
        JSON.stringify(data.requirementsCurrentlyDue),
        data.onboardingStatus,
        data.onboardedAtUtcIfVerified,
      ],
    );
    return rows.length ? mapRow(rows[0]) : null;
  }
}
