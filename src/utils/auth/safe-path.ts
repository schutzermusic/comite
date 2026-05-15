export function isSafeInternalPath(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value.length === 0 || value.length > 512) return false;
  if (!value.startsWith('/')) return false;
  if (value.startsWith('//') || value.startsWith('/\\')) return false;
  // Reject ':' to prevent protocol-like or absolute URLs (e.g. 'https:'),
  // while still permitting '?', '&', '=', and '#' which are normal path/query chars.
  if (value.includes(':')) return false;
  return true;
}
