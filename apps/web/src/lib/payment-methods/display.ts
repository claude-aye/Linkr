import type { components } from '@linkr/api-client';

/** The saved method, consumed NATIVELY from the generated schema — no mirror. */
export type PaymentMethod = components['schemas']['PaymentMethodResponseDto'];

/**
 * Stripe's `brand` is a lowercase machine string (`visa`, `amex`, `unionpay`).
 * Known brands get their real casing; an unknown one is NOT invented — it falls
 * back to « Carte », because a brand nobody recognises on their statement is
 * worse than no brand at all. The `•••• last4` under it is what identifies the
 * card anyway.
 */
const BRAND_LABELS: Record<string, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'American Express',
  discover: 'Discover',
  diners: 'Diners Club',
  jcb: 'JCB',
  unionpay: 'UnionPay',
};

/**
 * What to call the method on screen.
 *
 * The three types exist in the schema, but only `CARD` can be created today —
 * the SetupIntent is opened with `payment_method_types: ['card']`. The other two
 * are still labelled rather than left blank: a row that exists must say what it
 * is, whatever wrote it.
 */
export function paymentMethodLabel(method: PaymentMethod): string {
  switch (method.type) {
    case 'CARD':
      return (method.brand && BRAND_LABELS[method.brand.toLowerCase()]) ?? 'Carte';
    case 'INTERAC_DEBIT':
      return 'Interac';
    case 'BANK_ACCOUNT':
      return 'Compte bancaire';
  }
}

/** `•••• 4242` — the four digits are all we ever hold. */
export function paymentMethodDigits(method: PaymentMethod): string {
  return `•••• ${method.last4}`;
}

/**
 * `04/2030`, or null when the method has no expiry (a bank account) or a
 * half-filled one. Null means « render nothing » — never « 00/0000 ».
 */
export function formatExpiry(method: PaymentMethod): string | null {
  if (!method.expMonth || !method.expYear) return null;
  return `${String(method.expMonth).padStart(2, '0')}/${method.expYear}`;
}

/** « Visa •••• 4242 » — one line, for a dialog that must name what it deletes. */
export function paymentMethodSummary(method: PaymentMethod): string {
  return `${paymentMethodLabel(method)} ${paymentMethodDigits(method)}`;
}
