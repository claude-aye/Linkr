import { safeSmtpReason } from './smtp-reason';

describe('safeSmtpReason (L1b/L1d) — no address survives', () => {
  it.each([
    'rejected "a b"@x.example by relay',
    'RCPT TO:"John.Doe"@Example.COM failed',
    'mailbox <A@B.EXAMPLE> unknown',
    'to [x@y.example] refused',
    'RCPT TO:x@y.example',
    'quoted "with \\"escape"@x.example',
  ])('%s', (message) => {
    const out = safeSmtpReason(new Error(message));
    expect(out).not.toMatch(/@/);
    expect(out).not.toMatch(/example/i);
  });

  it('keeps only the reply code when there is one', () => {
    const e = Object.assign(new Error('550 "a b"@x.example rejected'), { responseCode: 550, code: 'EENVELOPE' });
    expect(safeSmtpReason(e)).toBe('SMTP 550 EENVELOPE');
  });

  it('keeps an address-free message as is', () => {
    expect(safeSmtpReason(new Error('connection timed out'))).toBe('connection timed out');
  });
});
