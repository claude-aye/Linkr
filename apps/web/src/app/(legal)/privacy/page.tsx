import type { Metadata } from 'next';

import { LegalDocumentPage } from '@/components/legal/legal-document-page';
import { LEGAL_DOCUMENTS } from '@/lib/legal/legal-pages';

export const metadata: Metadata = {
  title: `${LEGAL_DOCUMENTS['privacy-en'].title} — Linkr`,
};

export default function Page() {
  return <LegalDocumentPage docKey="privacy-en" />;
}
