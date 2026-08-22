const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Escapes a value before it is interpolated into an email's HTML body.
 *
 * Templates are plain string concatenation, so this is the only thing standing
 * between a caller-supplied variable and injected markup. It exists from the
 * first template rather than from the first incident: A-2 will interpolate a
 * reset URL, and the habit has to already be in place.
 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}
