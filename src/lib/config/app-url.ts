export const CANONICAL_PRODUCTION_ORIGIN = 'https://insightapex.co';

export const LEGACY_APP_HOSTS = new Set([
  'board.insightapex.co',
  'www.insightapex.co',
]);

function normalizeOrigin(value: string | undefined): string | null {
  if (!value) return null;

  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const normalized = url.origin;
    const canonicalRedirect = getCanonicalRedirectUrl(url);
    if (canonicalRedirect) return canonicalRedirect.origin;
    // A historical local configuration reused the Ponto URL as SITE_URL.
    // Never generate main-application Auth links for that separate portal.
    if (url.hostname.toLowerCase() === 'ponto.insightapex.co') return null;
    return normalized;
  } catch {
    return null;
  }
}

/**
 * Public origin used in links that leave the browser (Auth emails, invites).
 *
 * NEXT_PUBLIC_APP_URL is intentionally distinct from NEXT_PUBLIC_PONTO_URL:
 * the latter belongs to the dedicated employee time-tracking portal.
 * NEXT_PUBLIC_SITE_URL remains a backwards-compatible fallback.
 */
export function getPublicAppOrigin(fallbackOrigin?: string): string {
  return (
    normalizeOrigin(process.env.NEXT_PUBLIC_APP_URL) ??
    normalizeOrigin(process.env.NEXT_PUBLIC_SITE_URL) ??
    normalizeOrigin(fallbackOrigin) ??
    CANONICAL_PRODUCTION_ORIGIN
  );
}

/** Returns the canonical URL only for known legacy production hosts. */
export function getCanonicalRedirectUrl(input: URL): URL | null {
  if (!LEGACY_APP_HOSTS.has(input.hostname.toLowerCase())) return null;

  const destination = new URL(input.toString());
  destination.protocol = 'https:';
  destination.hostname = 'insightapex.co';
  destination.port = '';
  return destination;
}
