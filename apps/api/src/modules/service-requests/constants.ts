/**
 * Allowed mime types for service-request attachment uploads.
 * Images + short videos (Avant/Après). Mirrors the 3.7c verification upload
 * validation pattern with an attachment-appropriate whitelist.
 */
export const ALLOWED_ATTACHMENT_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/quicktime',
] as const;

/** Maximum attachment upload size: 50 MiB (videos are larger than documents). */
export const MAX_ATTACHMENT_SIZE_BYTES = 50 * 1024 * 1024;
