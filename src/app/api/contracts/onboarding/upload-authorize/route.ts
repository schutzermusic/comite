import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { platformServiceClient } from '@/lib/platform/server-client';
import { requireContractOnboardingSession } from '@/lib/contracts/onboarding/server-auth';
import {
  buildOnboardingStoragePath, isPdfUpload, MAX_ONBOARDING_PDF_BYTES, ONBOARDING_STORAGE_BUCKET,
} from '@/lib/contracts/onboarding/upload-paths';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Step 1 of the direct-to-storage upload: small JSON metadata only, never
 * the PDF itself. Authenticates and authorizes the caller exactly as the
 * old multipart route did, then mints a signed, path-scoped, short-lived
 * Storage upload token for a path THIS server generates — the browser
 * chooses no part of the organization/user prefix.
 */
export async function POST(req: Request) {
  const auth = await requireContractOnboardingSession();
  if ('error' in auth) return auth.error;

  let body: { fileName?: unknown; fileSize?: unknown; mimeType?: unknown };
  try { body = await req.json(); } catch {
    return NextResponse.json({ ok: false, error: 'Não foi possível iniciar o envio do documento.' }, { status: 400 });
  }
  const fileName = typeof body.fileName === 'string' ? body.fileName.trim() : '';
  const mimeType = typeof body.mimeType === 'string' ? body.mimeType : '';
  const fileSize = typeof body.fileSize === 'number' ? body.fileSize : NaN;

  if (!fileName) return NextResponse.json({ ok: false, error: 'Selecione o contrato em PDF.' }, { status: 400 });
  if (!isPdfUpload(fileName, mimeType)) {
    return NextResponse.json({ ok: false, error: 'O envio inicial aceita o contrato em PDF.' }, { status: 415 });
  }
  if (!Number.isFinite(fileSize) || fileSize <= 0) {
    return NextResponse.json({ ok: false, error: 'Selecione o contrato em PDF.' }, { status: 400 });
  }
  if (fileSize > MAX_ONBOARDING_PDF_BYTES) {
    return NextResponse.json({ ok: false, error: 'O PDF deve ter no máximo 30 MB.' }, { status: 413 });
  }

  const uploadId = randomUUID();
  const path = buildOnboardingStoragePath(auth.organizationId, auth.user.id, uploadId, fileName);

  const service = platformServiceClient();
  const { data, error } = await service.storage.from(ONBOARDING_STORAGE_BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    return NextResponse.json({ ok: false, error: 'Não foi possível iniciar o envio do documento.' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, uploadId, path, token: data.token });
}
