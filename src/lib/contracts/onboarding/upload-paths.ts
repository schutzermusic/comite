/**
 * Shared path/limit rules for the Contract Document-First DIRECT-TO-STORAGE
 * upload flow (fix/contracts-direct-storage-upload).
 *
 * Root cause this exists to fix: Vercel Functions cap inbound request bodies
 * at roughly 4.5 MB, so the previous browser -> /api/contracts/onboarding
 * (multipart PDF) -> Storage path made the advertised 30 MB product limit
 * unreachable — Vercel rejected the request with HTTP 413 before the route
 * ever ran, so no intake, no job, no Anthropic call, no trace.
 *
 * New flow: the PDF bytes never enter a Vercel Function request body.
 *   1. browser -> POST /upload-authorize (small JSON metadata only)
 *   2. server validates + mints a signed, path-scoped, private-bucket upload
 *      token via Supabase Storage's createSignedUploadUrl
 *   3. browser -> Storage directly (uploadToSignedUrl) with the real PDF
 *   4. browser -> POST /api/contracts/onboarding (small JSON metadata only)
 *   5. server DOWNLOADS the object from Storage itself to verify it — an
 *      OUTBOUND call this server makes, not subject to the inbound request
 *      body limit — computes the authoritative SHA256, and proceeds exactly
 *      as the existing document-first flow always has.
 *
 * Storage path convention — SERVER-GENERATED, the client never chooses it:
 *   {organizationId}/onboarding/{userId}/{uploadId}-{safeFileName}
 * The org and user segments are what the finalize step re-checks against the
 * caller's own session before ever trusting a path, so one org/user cannot
 * authorize uploads into another's namespace, and a client cannot finalize
 * an object it was never issued a token for.
 */

export const ONBOARDING_STORAGE_BUCKET = 'contract-files';
export const MAX_ONBOARDING_PDF_BYTES = 30 * 1024 * 1024;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function safeOnboardingFileName(name: string): string {
  const cleaned = name.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-').slice(0, 160);
  return cleaned || 'documento.pdf';
}

/** Same tolerant check the route has always used: a declared PDF mime, or a .pdf extension. */
export function isPdfUpload(fileName: string, mimeType: string): boolean {
  return mimeType === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf');
}

/** Server-generated, unpredictable, tenant/user-scoped. The client supplies none of these segments directly. */
export function buildOnboardingStoragePath(
  organizationId: string, userId: string, uploadId: string, fileName: string,
): string {
  return `${organizationId}/onboarding/${userId}/${uploadId}-${safeOnboardingFileName(fileName)}`;
}

export interface ParsedOnboardingStoragePath {
  organizationId: string;
  userId: string;
  uploadId: string;
}

/**
 * Parses a storage path and confirms it has EXACTLY the shape
 * buildOnboardingStoragePath produces. Returns null for anything else,
 * including path traversal (`.`, `..`), extra/missing segments, a
 * malformed uploadId, or organization/user segments that are not
 * themselves well-formed UUIDs.
 */
export function parseOnboardingStoragePath(path: string): ParsedOnboardingStoragePath | null {
  if (typeof path !== 'string' || !path || path.includes('//')) return null;
  const segments = path.split('/');
  if (segments.length !== 4) return null;
  const [organizationId, marker, userId, fileSegment] = segments;
  if (marker !== 'onboarding') return null;
  if (!UUID_RE.test(organizationId) || !UUID_RE.test(userId)) return null;
  if (!fileSegment || fileSegment.length <= 37 || fileSegment[36] !== '-') return null;
  const uploadId = fileSegment.slice(0, 36);
  if (!UUID_RE.test(uploadId)) return null;
  const rest = fileSegment.slice(37);
  if (!rest || rest === '.' || rest === '..') return null;
  return { organizationId, userId, uploadId };
}

/** The finalize-time authority check: does this path belong to exactly this org+user+uploadId? */
export function ownsOnboardingStoragePath(
  path: string, organizationId: string, userId: string, uploadId: string,
): boolean {
  const parsed = parseOnboardingStoragePath(path);
  return !!parsed && parsed.organizationId === organizationId
    && parsed.userId === userId && parsed.uploadId === uploadId;
}
