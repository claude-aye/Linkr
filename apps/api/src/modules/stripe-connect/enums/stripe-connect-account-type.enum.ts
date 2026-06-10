/**
 * Stripe Connect account flavour. MVP (3.10a) provisions EXPRESS accounts only;
 * CUSTOM is reserved for a later upgrade (CLAUDE.md §5.7).
 */
export enum StripeConnectAccountType {
  EXPRESS = 'EXPRESS',
  CUSTOM = 'CUSTOM',
}
