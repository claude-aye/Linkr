import {
  currencyExponent,
  fromMinorUnits,
  percentageOf,
  toMinorUnits,
} from './money';

describe('money', () => {
  describe('currencyExponent', () => {
    it('returns 2 for CAD and is case-insensitive', () => {
      expect(currencyExponent('CAD')).toBe(2);
      expect(currencyExponent('cad')).toBe(2);
    });

    it('knows zero- and three-decimal currencies', () => {
      expect(currencyExponent('JPY')).toBe(0);
      expect(currencyExponent('KWD')).toBe(3);
    });

    it('defaults to 2 for unknown currencies', () => {
      expect(currencyExponent('XYZ')).toBe(2);
    });
  });

  describe('toMinorUnits', () => {
    it('converts CAD 2-decimal amounts', () => {
      expect(toMinorUnits('19.99', 'CAD')).toBe(1999);
      expect(toMinorUnits('100.00', 'CAD')).toBe(10000);
      expect(toMinorUnits('0.05', 'CAD')).toBe(5);
    });

    it('rounds HALF-UP at the .005 boundary', () => {
      expect(toMinorUnits('100.005', 'CAD')).toBe(10001);
      expect(toMinorUnits('100.004', 'CAD')).toBe(10000);
      expect(toMinorUnits('0.005', 'CAD')).toBe(1);
      expect(toMinorUnits('0.015', 'CAD')).toBe(2);
      expect(toMinorUnits('0.025', 'CAD')).toBe(3); // half-up, not banker's
    });

    it('handles zero and missing/extra fractional digits', () => {
      expect(toMinorUnits('0', 'CAD')).toBe(0);
      expect(toMinorUnits('0.00', 'CAD')).toBe(0);
      expect(toMinorUnits('5', 'CAD')).toBe(500);
      expect(toMinorUnits('.5', 'CAD')).toBe(50);
    });

    it('respects the currency exponent', () => {
      expect(toMinorUnits('1000', 'JPY')).toBe(1000); // 0-decimal
      expect(toMinorUnits('1.005', 'KWD')).toBe(1005); // 3-decimal
      expect(toMinorUnits('1.0005', 'KWD')).toBe(1001); // 1000.5 → 1001
    });

    it('accepts a numeric input', () => {
      expect(toMinorUnits(19.99, 'CAD')).toBe(1999);
      expect(toMinorUnits(0, 'CAD')).toBe(0);
    });

    it('handles large amounts without precision loss', () => {
      expect(toMinorUnits('99999999999.99', 'CAD')).toBe(9999999999999);
    });

    it('rejects malformed input', () => {
      expect(() => toMinorUnits('abc', 'CAD')).toThrow();
      expect(() => toMinorUnits('', 'CAD')).toThrow();
      expect(() => toMinorUnits('1.2.3', 'CAD')).toThrow();
    });
  });

  describe('fromMinorUnits', () => {
    it('formats CAD minor units to 2 decimals', () => {
      expect(fromMinorUnits(1000, 'CAD')).toBe('10.00');
      expect(fromMinorUnits(1999, 'CAD')).toBe('19.99');
      expect(fromMinorUnits(5, 'CAD')).toBe('0.05');
      expect(fromMinorUnits(0, 'CAD')).toBe('0.00');
    });

    it('respects the currency exponent', () => {
      expect(fromMinorUnits(1000, 'JPY')).toBe('1000');
      expect(fromMinorUnits(1005, 'KWD')).toBe('1.005');
    });

    it('round-trips with toMinorUnits', () => {
      for (const v of ['0.00', '19.99', '100.00', '7.05', '99999999999.99']) {
        expect(fromMinorUnits(toMinorUnits(v, 'CAD'), 'CAD')).toBe(v);
      }
    });

    it('rejects non-integer minor units', () => {
      expect(() => fromMinorUnits(10.5, 'CAD')).toThrow();
    });
  });

  describe('percentageOf', () => {
    it('computes the deposit basis and commission (HALF-UP)', () => {
      expect(percentageOf(10000, '20.00')).toBe(2000); // 20% of $100.00
      expect(percentageOf(2000, '10.00')).toBe(200); // 10% of $20.00
      expect(percentageOf(9999, '20')).toBe(2000); // 1999.8 → 2000
      expect(percentageOf(0, '20')).toBe(0);
    });

    it('supports fractional percentages exactly', () => {
      expect(percentageOf(10000, '9.975')).toBe(998); // 997.5 → 998
    });

    it('rejects negative inputs', () => {
      expect(() => percentageOf(-1, '20')).toThrow();
      expect(() => percentageOf(100, '-5')).toThrow();
    });
  });
});
