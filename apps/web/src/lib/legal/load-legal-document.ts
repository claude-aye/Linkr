import 'server-only';

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { LegalDocument } from './legal-pages';

/**
 * Reads one legal text from `apps/web/content/legal/`.
 *
 * The texts live as Markdown, not as TSX, so that a wording fix never touches
 * JSX and a legal review reads a plain diff.
 *
 * `process.cwd()` is the Next.js project directory (documented in
 * `node_modules/next/dist/docs`, « Font loading, process.cwd() is Next.js
 * project directory »). The four pages are statically prerendered, so this
 * read happens at BUILD time: a missing file fails the build loudly instead of
 * serving an empty page to someone looking for their rights.
 */
export async function loadLegalDocument(doc: LegalDocument): Promise<string> {
  return readFile(join(process.cwd(), 'content', 'legal', doc.file), 'utf8');
}
