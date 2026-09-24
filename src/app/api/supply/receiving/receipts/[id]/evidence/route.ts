import { NextResponse } from 'next/server';
import { createHash, randomUUID } from 'node:crypto';
import { logAuditEventServer } from '@/lib/audit/log-audit-event-server';
import { requireAnyOperationsPermission, requireOperationsSession, isSessionError } from '@/lib/operations/session';
import { platformServiceClient } from '@/lib/platform/server-client';
import { ONBOARDING_STORAGE_BUCKET, safeOnboardingFileName } from '@/lib/contracts/onboarding/upload-paths';
import { inventoryFailure } from '@/lib/supply/inventory-route';
import { inventoryAct } from '@/lib/supply/service';
import { MAX_EVIDENCE_BYTES, evidenceSchema } from '@/lib/supply/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Evidência do recebimento (foto, romaneio, nota). Mesmo caminho do upload
 * de OS: o SERVIDOR gera o caminho dentro do inquilino e assina o envio; no
 * registro, baixa o objeto, confere tamanho e calcula o hash — o navegador
 * não afirma nada que o servidor não tenha visto.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireOperationsSession(['receiving.receive']);
  if (isSessionError(session)) return session.error;
  const { id } = await context.params;
  const parsed = evidenceSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Pedido inválido.' }, { status: 400 });
  const prefix = `${session.organizationId}/supply-receipts/${session.user.id}/`;
  const storage = platformServiceClient().storage.from(ONBOARDING_STORAGE_BUCKET);

  if (parsed.data.action === 'authorize') {
    const path = `${prefix}${randomUUID()}-${safeOnboardingFileName(parsed.data.fileName)}`;
    const { data, error } = await storage.createSignedUploadUrl(path);
    if (error || !data) return NextResponse.json({ ok: false, error: 'Não foi possível iniciar o envio.' }, { status: 500 });
    return NextResponse.json({ ok: true, path, token: data.token, bucket: ONBOARDING_STORAGE_BUCKET });
  }

  const b = parsed.data;
  if (!b.path.startsWith(prefix)) {
    return NextResponse.json({ ok: false, error: 'Arquivo fora da área de evidências deste usuário.' }, { status: 403 });
  }
  const { data: blob, error: dlError } = await storage.download(b.path);
  if (dlError || !blob) return NextResponse.json({ ok: false, error: 'Arquivo não encontrado no armazenamento.' }, { status: 404 });
  const bytes = Buffer.from(await blob.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_EVIDENCE_BYTES) {
    return NextResponse.json({ ok: false, error: 'Arquivo vazio ou acima de 15 MB.' }, { status: 413 });
  }
  try {
    const out = await inventoryAct<Record<string, unknown>>('goods_receipt_attach_evidence', session.organizationId, session.user.id, {
      p_receipt_id: id, p_payload: { storage_bucket: ONBOARDING_STORAGE_BUCKET, storage_path: b.path, file_name: b.fileName,
        mime_type: b.mimeType, size_bytes: bytes.length, content_sha256: createHash('sha256').update(bytes).digest('hex') } });
    await logAuditEventServer({ organizationId: session.organizationId, action: 'supply.goods_receipt.evidence_attached',
      entityType: 'goods_receipt', entityId: id, metadata: { evidence_id: out.evidence_id, file_name: b.fileName } }, request.headers);
    return NextResponse.json({ ok: true, result: out });
  } catch (error) {
    return inventoryFailure(error);
  }
}

/** Link temporário para ver uma evidência (quem vê recebimento). */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireAnyOperationsPermission(['receiving.view', 'supply.view', 'procurement.view']);
  if (isSessionError(session)) return session.error;
  const { id } = await context.params;
  const evidenceId = new URL(request.url).searchParams.get('evidence') ?? '';
  const { data } = await session.supabase.from('goods_receipt_evidence').select('storage_bucket,storage_path')
    .eq('organization_id', session.organizationId).eq('receipt_id', id).eq('id', evidenceId).maybeSingle<{ storage_bucket: string; storage_path: string }>();
  if (!data) return NextResponse.json({ ok: false, error: 'Evidência não encontrada.' }, { status: 404 });
  const { data: signed } = await platformServiceClient().storage.from(data.storage_bucket).createSignedUrl(data.storage_path, 300);
  if (!signed) return NextResponse.json({ ok: false, error: 'Não foi possível abrir a evidência.' }, { status: 500 });
  return NextResponse.json({ ok: true, url: signed.signedUrl });
}
