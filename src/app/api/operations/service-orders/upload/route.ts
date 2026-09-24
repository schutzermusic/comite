import { NextResponse } from 'next/server';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { logAuditEventServer } from '@/lib/audit/log-audit-event-server';
import { requireOperationsSession, isSessionError, hasOptionalPermission, governedFailure } from '@/lib/operations/session';
import { platformServiceClient } from '@/lib/platform/server-client';
import { ONBOARDING_STORAGE_BUCKET } from '@/lib/contracts/onboarding/upload-paths';
import { sniffEvidenceMime } from '@/lib/supply/evidence';
import { compareWithGoverning, registerUpload } from '@/lib/operations/service-orders/service';
import {
  extractUploadedServiceOrder, isServiceOrderUploadPath, serviceOrderUploadPath,
} from '@/lib/operations/service-orders/extraction';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const MAX_OS_PDF_BYTES = 30 * 1024 * 1024;

const authorizeSchema = z.object({
  action: z.literal('authorize'),
  fileName: z.string().trim().min(1).max(300).refine((n) => n.toLowerCase().endsWith('.pdf'), 'Envie a OS em PDF.'),
  mimeType: z.literal('application/pdf', 'Envie a OS em PDF.'),
  fileSize: z.number().positive().max(MAX_OS_PDF_BYTES, 'O PDF deve ter no máximo 30 MB.'),
});

const registerSchema = z.object({
  action: z.literal('register'),
  engagementId: z.string().uuid(),
  path: z.string().min(10).max(500),
  fileName: z.string().trim().min(1).max(300),
  // Aceito por compatibilidade com o cliente, e IGNORADO: o hash que vale é o que o servidor calcula.
  contentSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
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
    const auth = authorizeSchema.safeParse(body);
    if (!auth.success) {
      return NextResponse.json({ ok: false, error: auth.error.issues[0]?.message ?? 'Pedido de envio inválido.' }, { status: 400 });
    }
    const path = serviceOrderUploadPath(session.organizationId, randomUUID(), auth.data.fileName);
    const { data, error } = await platformServiceClient().storage.from(ONBOARDING_STORAGE_BUCKET).createSignedUploadUrl(path);
    if (error || !data) return NextResponse.json({ ok: false, error: 'Não foi possível iniciar o envio.' }, { status: 500 });
    await logAuditEventServer({ organizationId: session.organizationId, action: 'operations.service_order.upload_authorized',
      entityType: 'internal_service_order', entityId: null, metadata: { path, size: auth.data.fileSize } }, request.headers);
    return NextResponse.json({ ok: true, path, token: data.token, bucket: ONBOARDING_STORAGE_BUCKET });
  }

  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Pedido de registro inválido.' }, { status: 400 });
  const b = parsed.data;
  if (!isServiceOrderUploadPath(session.organizationId, b.path)) {
    return NextResponse.json({ ok: false, error: 'Caminho do PDF fora da área de OS deste inquilino.' }, { status: 403 });
  }

  // O servidor confere o que foi enviado: é PDF de verdade, e o hash é o do conteúdo — não o que o cliente afirmou.
  const storage = platformServiceClient().storage.from(ONBOARDING_STORAGE_BUCKET);
  const { data: blob, error: dlError } = await storage.download(b.path);
  if (dlError || !blob) return NextResponse.json({ ok: false, error: 'PDF não encontrado no armazenamento.' }, { status: 404 });
  const bytes = Buffer.from(await blob.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_OS_PDF_BYTES || sniffEvidenceMime(bytes) !== 'application/pdf') {
    await storage.remove([b.path]);
    return NextResponse.json({ ok: false, error: 'O arquivo enviado não é um PDF válido de até 30 MB.' }, { status: 415 });
  }
  const contentSha256 = createHash('sha256').update(bytes).digest('hex');

  let registered: Awaited<ReturnType<typeof registerUpload>>;
  try {
    registered = await registerUpload(session.organizationId, session.user.id, b.engagementId, {
      file_path: b.path, content_sha256: contentSha256, file_title: b.fileName,
      os_number: b.osNumber || undefined, title: b.title || undefined,
    });
  } catch (error) {
    return governedFailure(error);
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
