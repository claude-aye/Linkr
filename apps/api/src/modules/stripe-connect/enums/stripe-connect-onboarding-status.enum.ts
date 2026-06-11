/**
 * Local lifecycle of a provider's Stripe Connect onboarding, derived from the
 * Stripe account snapshot (see StripeConnectService.deriveStatus). Mirrors the
 * `onboarding_status` column of `stripe_connect_accounts`.
 */
export enum StripeConnectOnboardingStatus {
  NOT_STARTED = 'NOT_STARTED',
  INFO_NEEDED = 'INFO_NEEDED',
  PENDING_VERIFICATION = 'PENDING_VERIFICATION',
  VERIFIED = 'VERIFIED',
  RESTRICTED = 'RESTRICTED',
  DISABLED = 'DISABLED',
}
