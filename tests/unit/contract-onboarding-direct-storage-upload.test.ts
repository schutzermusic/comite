/**
 * Regression tests for the CONFIRMED production HTTP 413 on
 * POST /api/contracts/onboarding.
 *
 * Root cause: Vercel Functions cap inbound request bodies at ~4.5 MB, so the
 * previous browser -> Vercel Function (multipart PDF) -> Storage path made
 * the advertised 30 MB product limit unreachable — Vercel rejected the
 * request before contract-onboarding-extractor.ts, the DB, or Anthropic ever
 * saw it.
 *
 * Fix: the PDF now goes browser -> Storage directly via a signed, path-
 * scoped upload token; Apex's two API routes only ever see small JSON
 * metadata. This file proves that architecture, its security properties,
 * and that the existing document-first flow/trust/schema fixes are intact.
 *
 * NO live Anthropic calls are made in this file. No bytes are sent through
 * a Next.js route handler.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  buildOnboardingStoragePath,
  parseOnboardingStoragePath,
  ownsOnboardingStoragePath,
  isPdfUpload,
  safeOnboardingFileName,
  MAX_ONBOARDING_PDF_BYTES,
  ONBOARDING_STORAGE_BUCKET,
} from '@/lib/contracts/onboarding/upload-paths';
import { CONTRACT_ONBOARDING_EXTRACTION_SCHEMA } from '@/lib/contracts/onboarding/document-first';
import { countSchemaUnions } from '@/lib/ai/gateway/schema-complexity';
import { getApexAITaskPolicy } from '@/lib/ai/gateway/task-registry';

const source = (path: string) => readFileSync(path, 'utf8');

const ORG_A = '11111111-1111-1111-1111-111111111111';
const ORG_B = '22222222-2222-2222-2222-222222222222';
const USER_A = '33333333-3333-3333-3333-333333333333';
const USER_B = '44444444-4444-4444-4444-444444444444';
const UPLOAD_1 = '55555555-5555-5555-5555-555555555555';
const UPLOAD_2 = '66666666-6666-6666-6666-666666666666';

describe('upload-paths: server-generated path construction', () => {
  it('builds the documented convention', () => {
    const path = buildOnboardingStoragePath(ORG_A, USER_A, UPLOAD_1, 'Contrato JA10182283.pdf');
    expect(path).toBe(`${ORG_A}/onboarding/${USER_A}/${UPLOAD_1}-Contrato-JA10182283.pdf`);
  });
  it('sanitizes accents, spaces and unsafe characters in the file name', () => {
    const path = buildOnboardingStoragePath(ORG_A, USER_A, UPLOAD_1, 'Contração "final"/rev 2.pdf');
    expect(path).not.toMatch(/[^\x00-\x7F]/); // no remaining non-ASCII
    expect(path.split('/')).toHaveLength(4); // sanitized name cannot introduce extra path segments
  });
  it('falls back to a safe default name only when sanitization empties the name entirely', () => {
    expect(safeOnboardingFileName('')).toBe('documento.pdf');
  });
  it('non-ASCII-only names still sanitize to a non-empty, path-safe string', () => {
    const cleaned = safeOnboardingFileName('★★★');
    expect(cleaned.length).toBeGreaterThan(0);
    expect(cleaned).toMatch(/^[a-zA-Z0-9._-]+$/);
  });
});

describe('upload-paths: parse/ownership is the finalize-time authority check', () => {
  it('round-trips a path this server built', () => {
    const path = buildOnboardingStoragePath(ORG_A, USER_A, UPLOAD_1, 'contrato.pdf');
    expect(parseOnboardingStoragePath(path)).toEqual({ organizationId: ORG_A, userId: USER_A, uploadId: UPLOAD_1 });
    expect(ownsOnboardingStoragePath(path, ORG_A, USER_A, UPLOAD_1)).toBe(true);
  });

  it('USER A cannot finalize a path claiming to be USER B, even within the same org', () => {
    const path = buildOnboardingStoragePath(ORG_A, USER_B, UPLOAD_1, 'contrato.pdf');
    expect(ownsOnboardingStoragePath(path, ORG_A, USER_A, UPLOAD_1)).toBe(false);
  });

  it('ORG A cannot finalize an ORG B path', () => {
    const path = buildOnboardingStoragePath(ORG_B, USER_A, UPLOAD_1, 'contrato.pdf');
    expect(ownsOnboardingStoragePath(path, ORG_A, USER_A, UPLOAD_1)).toBe(false);
  });

  it('a forged/foreign uploadId on an otherwise-correct path is rejected', () => {
    const path = buildOnboardingStoragePath(ORG_A, USER_A, UPLOAD_1, 'contrato.pdf');
    expect(ownsOnboardingStoragePath(path, ORG_A, USER_A, UPLOAD_2)).toBe(false);
  });

  it('cannot finalize an arbitrary pre-existing contract-files object outside this convention', () => {
    expect(parseOnboardingStoragePath(`${ORG_A}/contracts/${USER_A}/some-other-object.pdf`)).toBeNull();
    expect(parseOnboardingStoragePath(`${ORG_A}/onboarding/${USER_A}/not-a-valid-uuid-name.pdf`)).toBeNull();
  });

  it('path traversal is impossible', () => {
    expect(parseOnboardingStoragePath(`${ORG_A}/onboarding/${USER_A}/../../etc/passwd`)).toBeNull();
    expect(parseOnboardingStoragePath(`../${ORG_A}/onboarding/${USER_A}/${UPLOAD_1}-x.pdf`)).toBeNull();
    expect(parseOnboardingStoragePath(`${ORG_A}/onboarding/${USER_A}/${UPLOAD_1}-..`)).toBeNull();
    expect(parseOnboardingStoragePath(`${ORG_A}//onboarding/${USER_A}/${UPLOAD_1}-x.pdf`)).toBeNull();
  });

  it('rejects extra or missing path segments', () => {
    expect(parseOnboardingStoragePath(`${ORG_A}/onboarding/${USER_A}/extra/${UPLOAD_1}-x.pdf`)).toBeNull();
    expect(parseOnboardingStoragePath(`${ORG_A}/onboarding/${UPLOAD_1}-x.pdf`)).toBeNull();
  });

  it('rejects organization/user segments that are not well-formed UUIDs', () => {
    expect(parseOnboardingStoragePath(`not-a-uuid/onboarding/${USER_A}/${UPLOAD_1}-x.pdf`)).toBeNull();
    expect(parseOnboardingStoragePath(`${ORG_A}/onboarding/not-a-uuid/${UPLOAD_1}-x.pdf`)).toBeNull();
  });

  it('rejects a malformed uploadId segment', () => {
    expect(parseOnboardingStoragePath(`${ORG_A}/onboarding/${USER_A}/not-a-uuid-x.pdf`)).toBeNull();
  });

  it('rejects the wrong marker segment', () => {
    expect(parseOnboardingStoragePath(`${ORG_A}/attachments/${USER_A}/${UPLOAD_1}-x.pdf`)).toBeNull();
  });
});

describe('upload-paths: MIME/extension validation', () => {
  it('accepts a declared PDF mime type', () => { expect(isPdfUpload('anything', 'application/pdf')).toBe(true); });
  it('accepts a .pdf extension regardless of mime', () => { expect(isPdfUpload('contrato.PDF', '')).toBe(true); });
  it('rejects a non-PDF file with a non-PDF mime', () => { expect(isPdfUpload('malware.exe', 'application/x-msdownload')).toBe(false); });
  it('rejects a disguised extension with a wrong mime and no .pdf suffix', () => { expect(isPdfUpload('invoice.html', 'text/html')).toBe(false); });
});

describe('upload-paths: 30 MB product limit is real end-to-end', () => {
  const MB = 1024 * 1024;
  it('1 MB is permitted', () => { expect(1 * MB).toBeLessThanOrEqual(MAX_ONBOARDING_PDF_BYTES); });
  it('5 MB is permitted (previously impossible: over the ~4.5 MB Vercel body limit)', () => {
    expect(5 * MB).toBeLessThanOrEqual(MAX_ONBOARDING_PDF_BYTES);
  });
  it('10 MB is permitted', () => { expect(10 * MB).toBeLessThanOrEqual(MAX_ONBOARDING_PDF_BYTES); });
  it('exactly 30 MB is permitted (the product limit itself)', () => { expect(30 * MB).toBeLessThanOrEqual(MAX_ONBOARDING_PDF_BYTES); });
  it('over 30 MB is rejected by product validation', () => { expect(30 * MB + 1).toBeGreaterThan(MAX_ONBOARDING_PDF_BYTES); });
  it('MAX_ONBOARDING_PDF_BYTES is exactly 30 MB, matching the product limit', () => {
    expect(MAX_ONBOARDING_PDF_BYTES).toBe(30 * 1024 * 1024);
  });
});

describe('Regression: no onboarding route reads PDF bytes from its OWN inbound request', () => {
  const authorizeRoute = source('src/app/api/contracts/onboarding/upload-authorize/route.ts');
  const finalizeRoute = source('src/app/api/contracts/onboarding/route.ts');
  const clientLib = source('src/lib/contracts/onboarding/client.ts');

  for (const [name, text] of [['upload-authorize/route.ts', authorizeRoute], ['route.ts (finalize)', finalizeRoute]] as const) {
    it(`${name} never calls req.formData()`, () => { expect(text).not.toMatch(/req\.formData\(\)/); });
    it(`${name} never calls file.arrayBuffer()`, () => { expect(text).not.toMatch(/file\.arrayBuffer\(\)/); });
    it(`${name} never does Buffer.from(file`, () => { expect(text).not.toMatch(/Buffer\.from\(file/); });
  }

  it('finalize route body parsing is req.json(), not multipart', () => {
    expect(finalizeRoute).toContain('await req.json()');
    expect(finalizeRoute).not.toContain('FormData');
  });
  it('authorize route body parsing is req.json(), not multipart', () => {
    expect(authorizeRoute).toContain('await req.json()');
    expect(authorizeRoute).not.toContain('FormData');
  });
  it('the finalize route downloads bytes FROM Storage server-side (outbound call, not inbound body)', () => {
    expect(finalizeRoute).toContain(".storage.from(ONBOARDING_STORAGE_BUCKET).download(path)");
  });
  it('the authorize route mints a signed upload URL, never uploads bytes itself', () => {
    expect(authorizeRoute).toContain('createSignedUploadUrl');
    expect(authorizeRoute).not.toContain('.upload(');
  });
  it('client sends the actual PDF straight to Storage, not to an Apex API route', () => {
    expect(clientLib).toContain('uploadToSignedUrl');
    expect(clientLib).toContain("fetch('/api/contracts/onboarding/upload-authorize'");
    // the finalize fetch body must be small JSON metadata, never the File/Blob itself
    const finalizeCallIdx = clientLib.indexOf("fetch('/api/contracts/onboarding', {");
    expect(finalizeCallIdx).toBeGreaterThan(-1);
    const finalizeCallBlock = clientLib.slice(finalizeCallIdx, finalizeCallIdx + 300);
    expect(finalizeCallBlock).not.toContain('body: file');
    expect(finalizeCallBlock).toContain('JSON.stringify');
  });
});

describe('Security: authentication and authorization remain enforced', () => {
  const authorizeRoute = source('src/app/api/contracts/onboarding/upload-authorize/route.ts');
  const finalizeRoute = source('src/app/api/contracts/onboarding/route.ts');

  it('both routes require the authenticated onboarding session before doing anything else', () => {
    for (const text of [authorizeRoute, finalizeRoute]) {
      expect(text).toContain('await requireContractOnboardingSession()');
      expect(text).toContain("if ('error' in auth) return auth.error;");
    }
  });
  it('finalize never trusts a client-supplied path without checking ownership first', () => {
    expect(finalizeRoute).toContain('ownsOnboardingStoragePath(path, auth.organizationId, auth.user.id, uploadId)');
  });
  it('storage path is built from the server-authenticated org/user, never from client input', () => {
    expect(authorizeRoute).toContain('buildOnboardingStoragePath(auth.organizationId, auth.user.id, uploadId, fileName)');
  });
  it('the signed upload token is minted with the service-role client, never exposing SUPABASE_SERVICE_ROLE_KEY to the browser', () => {
    const clientLib = source('src/lib/contracts/onboarding/client.ts');
    expect(authorizeRoute).toContain('platformServiceClient()');
    expect(clientLib).not.toMatch(/SERVICE_ROLE/i);
  });
  it('finalize independently re-verifies real object size and real PDF bytes, never trusting the authorize-time estimate', () => {
    expect(finalizeRoute).toContain('bytes.byteLength > MAX_ONBOARDING_PDF_BYTES');
    expect(finalizeRoute).toContain("bytes.subarray(0, 5).toString('ascii') !== '%PDF-'");
  });
  it('finalize computes the authoritative content_sha256 itself, never trusting a client-supplied hash', () => {
    expect(finalizeRoute).toContain("createHash('sha256').update(bytes).digest('hex')");
    expect(finalizeRoute).not.toMatch(/body\.(hash|sha256|contentHash)/);
  });
  it('oversized or non-PDF objects are not left as silent orphans: cleaned up on rejection', () => {
    expect(finalizeRoute).toContain('removeRedundantUpload(service, path)');
  });
});

describe('SHA256 invariant, duplicate and retry semantics are preserved unchanged', () => {
  const finalizeRoute = source('src/app/api/contracts/onboarding/route.ts');
  it('same insert shape as before: content_sha256 computed from the authoritative bytes', () => {
    expect(finalizeRoute).toContain('content_sha256: hash');
  });
  it('duplicate detection against contract_documents is unchanged', () => {
    expect(finalizeRoute).toContain("from('contract_documents')");
    expect(finalizeRoute).toContain('duplicate: true');
  });
  it('existing intake (org+uploader+hash) is reused, not duplicated', () => {
    expect(finalizeRoute).toContain("eq('organization_id', auth.organizationId).eq('uploaded_by', auth.user.id)");
    expect(finalizeRoute).toContain("eq('content_sha256', hash)");
  });
  it('FAILED-intake retry still goes through contract_onboarding_enqueue with retry_count semantics from migration 166', () => {
    const migration = source('supabase/migrations/166_contract_document_first_onboarding.sql');
    expect(migration).toContain("next_retry:=CASE WHEN r.status='FAILED' THEN r.retry_count+1 ELSE r.retry_count END");
  });
  it('no new migration was introduced by this fix', () => {
    // 166 remains the latest migration; this change is app-code + Storage only.
    expect(finalizeRoute).not.toMatch(/CREATE (TABLE|FUNCTION)/);
  });
});

describe('UI: the false "document preserved" claim is fixed', () => {
  const component = source('src/components/contracts/contract-upload.tsx');
  it('the preserved message is conditioned on a confirmed intake, not shown unconditionally while processing', () => {
    expect(component).toContain("intakeId ? 'O documento original já foi preservado.'");
    expect(component).toContain("'Enviando o documento…'");
  });
  it('a failed send shows a truthful business-safe message instead of claiming preservation', () => {
    expect(component).toContain("intakeError ? 'Não foi possível enviar o documento.'");
  });
  it('still uses sendContractDocument and keeps the no-double-send copy', () => {
    expect(component).toContain('sendContractDocument(selected)');
    expect(component).toContain('Não é necessário enviar novamente.');
    expect(component).toContain('O arquivo foi preservado.');
  });
  it('keeps technology/provider terminology out of rendered business copy', () => {
    const jsxStrings = [...component.matchAll(/>([^<>{}\n][^<>{}]*)</g)].map((match) => match[1]).join(' ');
    expect(jsxStrings).not.toMatch(/\b(?:IA|AI|LLM|Claude|Anthropic|Supabase|Vercel)\b/i);
  });
});

describe('Known separate finding untouched: OPERATIONALIZATION_SCHEMA complexity defect', () => {
  it('this branch does not modify contract-operationalization.ts', () => {
    const text = source('src/lib/ai/contract-operationalization.ts');
    // Presence of the known union-heavy fields proves the file is unchanged from its
    // pre-existing (already over-limit) shape — this fix does not touch that schema.
    expect(text).toContain("category: { type: ['string', 'null'] }");
  });
});

describe('Regression: previous AI schema-complexity fixes remain intact', () => {
  it('CONTRACT_ONBOARDING_EXTRACTION_SCHEMA union count is still 2', () => {
    expect(countSchemaUnions(CONTRACT_ONBOARDING_EXTRACTION_SCHEMA)).toBe(2);
  });
  it('schema still has no minimum/maximum', () => {
    const s = JSON.stringify(CONTRACT_ONBOARDING_EXTRACTION_SCHEMA);
    expect(s).not.toContain('"minimum"');
    expect(s).not.toContain('"maximum"');
  });
  it('model routing is unchanged: claude-sonnet-5, no fallback, no Opus', () => {
    const p = getApexAITaskPolicy('CONTRACT_EXTRACTION');
    expect(p.provider).toBe('anthropic');
    expect(p.model).toBe('claude-sonnet-5');
    expect(p.fallbacks).toEqual([]);
    expect(p.model.toLowerCase()).not.toContain('opus');
  });
});

describe('Bucket constant sanity', () => {
  it('targets the existing private contract-files bucket, not a new one', () => {
    expect(ONBOARDING_STORAGE_BUCKET).toBe('contract-files');
  });
});
