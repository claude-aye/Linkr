/**
 * The version of the legal texts (terms of use + privacy policy) a new account
 * must accept — their civil publication date, `YYYY-MM-DD`.
 *
 * ⚠️ MIRRORED, NOT SHARED. The web holds the same value as `LEGAL_VERSION`
 * (`apps/web/src/lib/legal/legal-pages.ts`), which dates the pages people
 * actually read. `scripts/check-mirrored-constants.mjs` fails a pull request
 * where the two disagree — and they must agree, because the BFF sends
 * `LEGAL_VERSION` and `SignupDto` refuses anything but this value with a 400.
 * Bumping one side alone would make EVERY signup fail.
 *
 * Bumping both (a new version of the texts) does not touch existing accounts:
 * they keep the version they accepted. Asking them to accept the new one is the
 * re-acceptance screen, deferred (CLAUDE.md §6).
 */
export const CURRENT_TERMS_VERSION = '2026-10-11';
