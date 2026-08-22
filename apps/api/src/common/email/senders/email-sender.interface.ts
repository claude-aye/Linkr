/** Injection token for the active email transport. */
export const EMAIL_SENDER = 'EMAIL_SENDER';

/** A fully rendered message, ready to hand to a transport. */
export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Port for outbound email. The single adapter today is SmtpEmailSender
 * (Nodemailer). Everything upstream — service, worker, templates — talks to
 * this, so moving to a provider API later is a new adapter behind the same
 * token, never a rewrite.
 *
 * The `from` identity is NOT a parameter: it belongs to the deployment
 * (EMAIL_FROM_ADDRESS / EMAIL_FROM_NAME), not to the caller, and a caller able
 * to choose it is a caller able to spoof it.
 */
export interface IEmailSender {
  send(message: EmailMessage): Promise<void>;
}
