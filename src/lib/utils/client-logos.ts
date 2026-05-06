/**
 * Client logo registry.
 *
 * Resolves a logo URL for a client name. Resolution order:
 *   1. explicit `clientLogoUrl` set on the Project (from backend / API)
 *   2. local registry mapping by slug of the client name
 *   3. undefined → consumers should fall back to initials
 *
 * The registry is intentionally small. When the backend exposes a `client_logo_url`
 * column or an asset CDN, populate Project.clientLogoUrl and the registry becomes
 * a pure local-development convenience for mocks/demos.
 */

function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Demo placeholders. These are seeded picsum images so the visual works in dev
 * without any external logo service. Replace per-client mappings (or remove entirely)
 * once a real CDN/path exists. Keys are slugs of the client name.
 */
const DEMO_REGISTRY: Record<string, string> = {
  // Examples — safe to edit / extend / remove. Image fetch failures are caught
  // by ProjectClientLogo (onError → initials fallback), so a stale URL here
  // never breaks the UI.
  // 'cemig-s-a': '/clients/cemig.svg',
  // 'petrobras': '/clients/petrobras.svg',
  // 'eletrobras': '/clients/eletrobras.svg',
};

/**
 * Resolve a logo URL for a project's client.
 *
 * @param client       Client display name (e.g. "PETROBRAS")
 * @param explicitUrl  Optional URL stored on the Project (backend-provided)
 */
export function getClientLogoUrl(
  client: string | null | undefined,
  explicitUrl?: string | null,
): string | undefined {
  if (explicitUrl) return explicitUrl;
  if (!client) return undefined;
  const key = slugify(client);
  return DEMO_REGISTRY[key];
}

/**
 * Public registry helper: register a logo URL for a client at runtime
 * (useful for tests, Storybook, or wiring backend data on app boot).
 */
export function registerClientLogo(client: string, url: string): void {
  DEMO_REGISTRY[slugify(client)] = url;
}
