/**
 * Currency-aware money math — the SINGLE place allowed to convert between a
 * human decimal amount (e.g. "19.99") and Stripe "minor units" (integer cents).
 *
 * Every operation is exact (BigInt / integer-string arithmetic), never JS
 * floating point, and rounds HALF-UP at the currency's minor-unit precision.
 *
 * Inline `* 100` / `/ 100` conversions are forbidden elsewhere — route every
 * decimal⇄minor-unit conversion (and every percentage of money) through here.
 */

/**
 * ISO 4217 minor-unit exponents. Only the few we actually transact in are
 * listed; anything unknown falls back to {@link DEFAULT_EXPONENT} (2), which is
 * correct for the overwhelming majority of currencies.
 */
const CURRENCY_EXPONENTS: Readonly<Record<string, number>> = {
  CAD: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  // Zero-decimal currencies (kept for correctness even if unused in MVP).
  JPY: 0,
  KRW: 0,
  // Three-decimal currencies.
  BHD: 3,
  KWD: 3,
  TND: 3,
};

const DEFAULT_EXPONENT = 2;

/** Decimal string: optional sign, then `digits[.digits]` or `.digits`. */
const DECIMAL_RE = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;

/** Minor-unit exponent for a currency (case-insensitive). Unknown ⇒ 2. */
export function currencyExponent(currency: string): number {
  const exp = CURRENCY_EXPONENTS[currency.toUpperCase()];
  return exp === undefined ? DEFAULT_EXPONENT : exp;
}

function tenPow(n: number): bigint {
  return 10n ** BigInt(n);
}

/** Reject the safe-integer overflow that would make a `number` result lossy. */
function bigintToSafeNumber(value: bigint): number {
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  if (value > max || value < -max) {
    throw new RangeError(`Money value ${value} exceeds the safe integer range`);
  }
  return Number(value);
}

function numberToDecimalString(n: number): string {
  if (!Number.isFinite(n)) throw new RangeError(`Non-finite amount: ${n}`);
  const s = String(n);
  if (/[eE]/.test(s)) {
    throw new RangeError(
      `Amount ${n} uses exponent notation; pass a decimal string instead`,
    );
  }
  return s;
}

function parseDecimal(amount: string): {
  neg: boolean;
  intPart: string;
  fracPart: string;
} {
  const trimmed = amount.trim();
  if (!DECIMAL_RE.test(trimmed)) {
    throw new RangeError(`Invalid decimal amount: "${amount}"`);
  }
  let neg = false;
  let body = trimmed;
  if (body[0] === '+') body = body.slice(1);
  else if (body[0] === '-') {
    neg = true;
    body = body.slice(1);
  }
  const dot = body.indexOf('.');
  const intPart = dot === -1 ? body : body.slice(0, dot);
  const fracPart = dot === -1 ? '' : body.slice(dot + 1);
  return { neg, intPart: intPart === '' ? '0' : intPart, fracPart };
}

/**
 * Convert a decimal amount to integer minor units (Stripe "cents"), HALF-UP.
 * e.g. toMinorUnits("19.99", "CAD") === 1999 ; toMinorUnits("100.005", "CAD") === 10001.
 */
export function toMinorUnits(amount: string | number, currency: string): number {
  const exponent = currencyExponent(currency);
  const str = typeof amount === 'number' ? numberToDecimalString(amount) : amount;
  const { neg, intPart, fracPart } = parseDecimal(str);

  // Keep `exponent` fractional digits; the first dropped digit decides rounding.
  const kept = fracPart.slice(0, exponent).padEnd(exponent, '0');
  const remainder = fracPart.slice(exponent);
  let scaled = BigInt(intPart + kept);

  // HALF-UP: 0.<remainder> >= 0.5 ⇔ its leading digit is >= 5 ('5' is char 53).
  if (remainder.length > 0 && remainder.charCodeAt(0) >= 53) {
    scaled += 1n;
  }
  if (neg) scaled = -scaled;
  return bigintToSafeNumber(scaled);
}

/**
 * Convert integer minor units back to a fixed-precision decimal string.
 * e.g. fromMinorUnits(1999, "CAD") === "19.99" ; fromMinorUnits(5, "CAD") === "0.05".
 */
export function fromMinorUnits(minor: number, currency: string): string {
  if (!Number.isInteger(minor)) {
    throw new RangeError(`Minor units must be an integer: ${minor}`);
  }
  const exponent = currencyExponent(currency);
  const neg = minor < 0;
  let digits = BigInt(Math.abs(minor)).toString();
  if (exponent === 0) return `${neg ? '-' : ''}${digits}`;

  digits = digits.padStart(exponent + 1, '0');
  const intPart = digits.slice(0, digits.length - exponent);
  const fracPart = digits.slice(digits.length - exponent);
  return `${neg ? '-' : ''}${intPart}.${fracPart}`;
}

/**
 * Apply a percentage to an integer minor-unit amount, HALF-UP, exact integer
 * result. The percent may carry decimals (e.g. "9.975"). Used for the deposit
 * basis and the platform commission so the accounting invariant
 * `net = gross - fee - tax` holds exactly in minor units.
 *
 * e.g. percentageOf(10000, "20.00") === 2000 ; percentageOf(2000, "10") === 200.
 */
export function percentageOf(minorUnits: number, percent: string | number): number {
  if (!Number.isInteger(minorUnits) || minorUnits < 0) {
    throw new RangeError(`minorUnits must be a non-negative integer: ${minorUnits}`);
  }
  const pStr = typeof percent === 'number' ? numberToDecimalString(percent) : percent;
  const { neg, intPart, fracPart } = parseDecimal(pStr);
  if (neg) throw new RangeError(`Percent must be non-negative: "${pStr}"`);

  const pNum = BigInt(intPart + fracPart); // percent scaled by 10^fracPart.length
  const numerator = BigInt(minorUnits) * pNum;
  const denominator = 100n * tenPow(fracPart.length); // ÷100 and undo the scaling

  // HALF-UP for non-negative operands: floor((2·num + den) / (2·den)).
  const q = (2n * numerator + denominator) / (2n * denominator);
  return bigintToSafeNumber(q);
}
