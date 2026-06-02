/** Allowed mime types for verification document uploads. */
export const ALLOWED_DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
] as const;

/** Maximum upload size: 10 MiB. */
export const MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024;
