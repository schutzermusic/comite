import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { logAuditEventServer } from '@/lib/audit/log-audit-event-server';
import {
  requireOperationsSession, isSessionError, hasOptionalPermission, safeOperationsError,
} from '@/lib/operations/session';
import { platformServiceClient } from '@/lib/platform/server-client';
import { ONBOARDING_STORAGE_BUCKET } from '@/lib/contracts/onboarding/upload-paths';
import { compareWithGoverning, registerUpload } from '@/lib/operations/service-orders/service';
import {
  extractUploadedServiceOrder, isServiceOrderUploadPath, serviceOrderUploadPath,
} from '@/lib/operations/service-orders/extraction';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const registerSchema = z.object({
  action: z.literal('register'),
  engagementId: z.string().uuid(),
  path: z.string().min(10).max(500),
  fileName: z.string().trim().min(1).max(300),
  contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
  osNumber: z.string().trim().max(60).optional(),
  title: z.string().trim().max(300).optional(),
});

/**
 * "Importar OS" — PDF de uma OS interna já emitida fora do Apex.
 *
 *  1. `authorize` — envio assinado num caminho que o SERVIDOR gera, dentro
 *     do inquilino.
 *  2. `register`  — o PDF vira documento canônico (pai: o trabalho
 *     autorizado) e a OS nasce `uploaded_document`. Mesmo hash, mesma OS.
 *  3. leitura     — com `commercial.documents.ingest`, a Apex lê o PDF
 *     (página + trecho por fato) e as linhas entram PENDENTES de revisão.
 *     Sem a permissão, o documento fica registrado e a tela diz isso.
 *  4. confronto   — regras do banco contra a fonte regente, na hora.
 *
 * Falha da leitura não perde o documento: ele já está registrado.
 */
export async function POST(request: Request) {
  const session = await requireOperationsSession(['commercial.service_orders.manage']);
  if (isSessionError(session)) return session.error;
  const body = await request.json().catch(() => null);

  if (body?.action === 'authorize') {
    if (String(body.mimeType) !== 'application/pdf' || !String(body.fileName ?? '').toLowerCase().endsWith('.pdf')) {
      return NextResponse.json({ ok: false, error: 'Envie a OS em PDF.' }, { status: 415 });
    }
    if (!(Number(body.fileSize) > 0 && Number(body.fileSize) <= 30 * 1024 * 1024)) {
      return NextResponse.json({ ok: false, error: 'O PDF deve ter no máximo 30 MB.' }, { status: 413 });
    }
    const path = serviceOrderUploadPath(session.organizationId, randomUUID(), String(body.fileName));
    const { data, error } = await platformServiceClient().storage.from(ONBOARDING_STORAGE_BUCKET).createSignedUploadUrl(path);
    if (error || !data) return NextResponse.json({ ok: false, error: 'Não foi possível iniciar o envio.' }, { status: 500 });
    return NextResponse.json({ ok: true, path, token: data.token, bucket: ONBOARDING_STORAGE_BUCKET });
  }

  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Pedido de registro inválido.' }, { status: 400 });
  const b = parsed.data;
  if (!isServiceOrderUploadPath(session.organizationId, b.path)) {
    return NextResponse.json({ ok: false, error: 'Caminho do PDF fora da área de OS deste inquilino.' }, { status: 403 });
  }

  let registered: Awaited<ReturnType<typeof registerUpload>>;
  try {
    registered = await registerUpload(session.organizationId, session.user.id, b.engagementId, {
      file_path: b.path, content_sha256: b.contentSha256, file_title: b.fileName,
      os_number: b.osNumber || undefined, title: b.title || undefined,
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: safeOperationsError((error as Error).message) }, { status: 422 });
  }

  const canRead = await hasOptionalPermission(session, 'commercial.documents.ingest');
  let reading: { state: 'read' | 'skipped' | 'failed'; facts?: number; itemsAdded?: number; model?: string } =
    { state: 'skipped' };
  if (canRead) {
    try {
      const out = await extractUploadedServiceOrder({
        organizationId: session.organizationId, actorId: session.user.id,
        serviceOrderId: registered.service_order_id, engagementId: b.engagementId,
        documentId: registered.document_id, path: b.path, fileName: b.fileName,
      });
      reading = { state: 'read', facts: out.facts, itemsAdded: out.itemsAdded, model: out.model };
    } catch (error) {
      console.warn('[operations-service-order-upload] reading failed', JSON.stringify({
        serviceOrderId: registered.service_order_id, message: (error as Error).message.slice(0, 200) }));
      reading = { state: 'failed' };
    }
  }
  const comparison = await compareWithGoverning(session.organizationId, registered.service_order_id)
    .catch(() => ({ compared: false, divergences_opened: 0 }));

  await logAuditEventServer({
    organizationId: session.organizationId, action: 'operations.service_order.imported',
    entityType: 'internal_service_order', entityId: registered.service_order_id,
    metadata: { documentId: registered.document_id, reused: registered.reused, reading: reading.state,
      facts: reading.facts ?? 0, divergences: comparison.divergences_opened ?? 0 },
  }, request.headers);

  return NextResponse.json({ ok: true, serviceOrderId: registered.service_order_id,
    documentId: registered.document_id, reused: registered.reused, reading,
    divergencesOpened: comparison.divergences_opened ?? 0 });
}
