import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * D7 — addresses of carrier email-to-text gateways (a phone number at the
 * carrier's domain) are refused at sign-up.
 *
 * Why: such an address turns every Linkr email into a text message, delivery
 * is unreliable or shut down, and Brevo counts the soft bounces and deferrals
 * against the sender (7 days observed: 4 soft bounces and at least 5 deferred
 * sends to tmomail.net and vtext.com).
 *
 * ⚠️ V1 KEEPS ONLY THE WELL-SOURCED DOMAINS. Left out on purpose, because they
 * may also host real mailboxes and need confirming first: fido.ca,
 * mailmymobile.net, vmobl.com, vmpix.com, smtext.com.
 *
 * Sources (secondary — carrier gateway tables): Sinch, DialMyCalls, Digital
 * Trends, Textmagic, Textbolt. To confirm against primary sources (the FCC
 * wireless domain names list, carrier pages) before production.
 *
 * The comparison is on the part after the LAST `@`, case-insensitive, exact
 * domain or any subdomain of it. No network call. The ONLY place the list
 * lives: the web has no copy and shows the API's code.
 */
export const SMS_GATEWAY_DOMAINS: readonly string[] = [
  // United States. tmomail.net: no reliable delivery since late 2024.
  // txt.att.net: closed since 17 June 2025. vtext.com / vzwpix.com: end no
  // later than 31 March 2027. (Carrier blog posts, secondary.)
  'tmomail.net',
  'vtext.com',
  'vzwpix.com',
  'txt.att.net',
  'mms.att.net',
  'messaging.sprintpcs.com',
  'pm.sprint.com',
  'email.uscc.net',
  'mms.uscc.net',
  'mymetropcs.com',
  'sms.myboostmobile.com',
  'myboostmobile.com',
  'sms.cricketwireless.net',
  'mms.cricketwireless.net',
  'msg.fi.google.com',
  'message.ting.com',
  // Canada.
  'txt.bell.ca',
  'msg.telus.com',
];

/** True when the address's domain is a listed gateway or a subdomain of one. */
export function isSmsGatewayAddress(email: string): boolean {
  const at = email.lastIndexOf('@');
  if (at < 0) return false;
  const domain = email
    .slice(at + 1)
    .trim()
    .toLowerCase()
    .replace(/\.$/, '');
  if (!domain) return false;
  return SMS_GATEWAY_DOMAINS.some(
    (gateway) => domain === gateway || domain.endsWith(`.${gateway}`),
  );
}

/** Machine-readable code. Part of the contract: the web maps on it. */
export const EMAIL_DOMAIN_NOT_ALLOWED = 'EMAIL_DOMAIN_NOT_ALLOWED';

/**
 * 400 — the address is a text-message gateway. Raised BEFORE any lookup,
 * budget reservation or write: nothing is created and no email is sent. The
 * message is French (shown as is under the field); the address is never in
 * the body nor in a log.
 */
export class EmailDomainNotAllowedException extends HttpException {
  constructor() {
    super(
      {
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'Bad Request',
        code: EMAIL_DOMAIN_NOT_ALLOWED,
        message:
          'Cette adresse ne peut pas recevoir nos courriels. Utilisez une adresse courriel ordinaire.',
      },
      HttpStatus.BAD_REQUEST,
    );
  }
}
