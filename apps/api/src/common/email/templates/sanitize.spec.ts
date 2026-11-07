import {
  FIRST_NAME_MAX_CHARS,
  TITLE_MAX_CHARS,
  clipTitle,
  cleanFirstName,
  greet,
} from './sanitize';

// Built with fromCharCode so no control character sits in the source file.
const BELL = String.fromCharCode(7);
const NUL = String.fromCharCode(0);
const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);
const RLO = String.fromCharCode(0x202e);
const LINE_SEPARATOR = String.fromCharCode(0x2028);

describe('cleanFirstName', () => {
  it('keeps an ordinary name, accents and hyphens included', () => {
    expect(cleanFirstName('Marie-Ève')).toBe('Marie-Ève');
    expect(cleanFirstName('Jean Luc')).toBe('Jean Luc');
  });

  it.each([
    ['https://evil.example/pay', ''],
    ['Marie http://evil.example', 'Marie'],
    ['www.evil.example', ''],
    ['Marie www.evil.example/x', 'Marie'],
    ['evil.com', ''],
    ['Marie evil.ca', 'Marie'],
    ['sous.domaine.example.org', ''],
  ])('removes URL and domain patterns: %p', (input, expected) => {
    expect(cleanFirstName(input)).toBe(expected);
  });

  it.each([
    ['marie@example.com', ''],
    ['Marie contact@example.com', 'Marie'],
    ['@marie', ''],
    ['Marie @ent', 'Marie'],
  ])('removes addresses and @ handles: %p', (input, expected) => {
    expect(cleanFirstName(input)).toBe(expected);
  });

  it('removes control, format and separator characters', () => {
    expect(cleanFirstName(`Ma${BELL}rie${NUL}`)).toBe('Ma rie');
    expect(cleanFirstName(`${RLO}Marie`)).toBe('Marie');
    expect(cleanFirstName(`Ma${ZERO_WIDTH_SPACE}rie`)).toBe('Ma rie');
    expect(cleanFirstName(`Marie${LINE_SEPARATOR}Claire`)).toBe('Marie Claire');
    expect(cleanFirstName('Marie\nClaire\tAnne')).toBe('Marie Claire Anne');
  });

  it('cuts a 200-character name to 30 characters', () => {
    const out = cleanFirstName('a'.repeat(200));
    expect(Array.from(out)).toHaveLength(FIRST_NAME_MAX_CHARS);
  });

  it('never splits a surrogate pair when cutting', () => {
    const out = cleanFirstName('😀'.repeat(50));
    expect(Array.from(out)).toHaveLength(FIRST_NAME_MAX_CHARS);
    expect(out).toBe('😀'.repeat(FIRST_NAME_MAX_CHARS));
  });

  it('returns an empty string for empty, blank and non-string input', () => {
    expect(cleanFirstName('')).toBe('');
    expect(cleanFirstName('   ')).toBe('');
    expect(cleanFirstName(undefined)).toBe('');
    expect(cleanFirstName(null)).toBe('');
    expect(cleanFirstName(42)).toBe('');
  });
});

describe('greet', () => {
  it('greets by name in both locales', () => {
    expect(greet('fr-CA', 'Camille')).toBe('Bonjour Camille,');
    expect(greet('en-CA', 'Camille')).toBe('Hello Camille,');
  });

  it('falls back to a neutral greeting when no usable name is left', () => {
    expect(greet('fr-CA', '')).toBe('Bonjour,');
    expect(greet('en-CA', '')).toBe('Hello,');
    expect(greet('fr-CA', 'https://evil.example')).toBe('Bonjour,');
    expect(greet('en-CA', 'x@y.zz')).toBe('Hello,');
  });
});

describe('clipTitle', () => {
  it('leaves a short title untouched', () => {
    expect(clipTitle('Réparation de robinet')).toBe('Réparation de robinet');
  });

  it('keeps a title of exactly 60 characters', () => {
    const exact = 'a'.repeat(TITLE_MAX_CHARS);
    expect(clipTitle(exact)).toBe(exact);
  });

  it('cuts a 200-character title to 60 characters, ellipsis included', () => {
    const out = clipTitle('b'.repeat(200));
    expect(Array.from(out)).toHaveLength(TITLE_MAX_CHARS);
    expect(out.endsWith('…')).toBe(true);
  });

  it('drops control characters and collapses whitespace', () => {
    expect(clipTitle(`Robinet${BELL}  qui\n\tfuit`)).toBe('Robinet qui fuit');
  });

  it('returns an empty string for empty or non-string input', () => {
    expect(clipTitle('')).toBe('');
    expect(clipTitle(undefined)).toBe('');
  });

  it('does not escape: escaping stays with the template', () => {
    expect(clipTitle('<b>&</b>')).toBe('<b>&</b>');
  });
});
