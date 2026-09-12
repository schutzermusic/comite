import { createHash, randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { platformServiceClient } from '@/lib/platform/server-client';
import { scheduleFastDrain } from '@/lib/platform/jobs/fast-path';
import { logAuditEventServer } from '@/lib/audit/log-audit-event-server';
import { requireContractOnboardingSession } from '@/lib/contracts/onboarding/server-auth';
import {
  MAX_ONBOARDING_PDF_BYTES, ONBOARDING_STORAGE_BUCKET, ownsOnboardingStoragePath,
} from '@/lib/contracts/onboarding/upload-paths';
import {
  ACTIVE_INTAKE_STATUSES, selectActiveIntakes, type IntakeContinuityRow,
} from '@/lib/contracts/onboarding/resume';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Cadastros de contrato iniciados e ainda não concluídos, do usuário
 * autenticado, na organização ativa.
 *
 * SOMENTE LEITURA. Não enfileira, não reprocessa, não finaliza e não toca em
 * `structured_result`: abrir a carteira não pode alterar um cadastro em
 * andamento. Por isso não existe fast-drain nem RPC aqui.
 *
 * A consulta usa o cliente AUTENTICADO (`auth.supabase`), nunca o service
 * role: a política `coni_read_own` da migration 166 é quem decide o que esta
 * pessoa pode ver — organização ativa, entradas que ela própria enviou e
 * permissão `contracts.create`. O `.eq('organization_id', …)` explícito é
 * defesa em profundidade sobre a mesma fronteira, não a fronteira em si.
 *
 * `contract_id IS NULL` é o filtro que impede um cadastro JÁ CONCLUÍDO de
 * voltar a aparecer como rascunho: assim que o contrato canônico nasce, a
 * entrada sai desta lista e passa a viver no dossiê e na auditoria.
 */
export async function GET() {
  const auth = await requireContractOnboardingSession();
  if ('error' in auth) return auth.error;

  const { data, error } = await auth.supabase.from('contract_onboarding_intakes')
    .select('id,file_name,status,structured_result,attention_count,contract_id,received_at,completed_at')
    .eq('organization_id', auth.organizationId)
    .is('contract_id', null)
    .in('status', [...ACTIVE_INTAKE_STATUSES])
    .order('received_at', { ascending: false })
    .limit(20);
  if (error) {
    return NextResponse.json({ ok: false, error: 'Não foi possível consultar os cadastros em andamento.' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, intakes: selectActiveIntakes((data ?? []) as unknown as IntakeContinuityRow[]) });
}

/** Best-effort cleanup of an object THIS request itself just confirmed is redundant. Never blocks the response. */
async function removeRedundantUpload(service: ReturnType<typeof platformServiceClient>, path: string): Promise<void> {
  try { await service.storage.from(ONBOARDING_STORAGE_BUCKET).remove([path]); } catch { /* best-effort only */ }
}

/**
 * Step 2 of the direct-to-storage upload (see upload-paths.ts): the browser
 * has already put the PDF directly into Storage using the signed token from
 * /upload-authorize. This route receives only small JSON metadata — never
 * PDF bytes — and does the finalize-time verification: the path must belong
 * to THIS caller's org+user+uploadId (never trust a client-supplied path
 * otherwise), the object must actually exist, and its real bytes (downloaded
 * here — an outbound call this server makes to Storage, not an inbound
 * request body, so the original Vercel 413 never applies) must be a PDF at
 * or under the 30 MB product limit. The authoritative content_sha256 is
 * computed from those downloaded bytes, never trusted from the client.
 *
 * Everything after that point — duplicate detection, intake creation,
 * durable enqueue, audit log — is byte-for-byte the same document-first
 * flow that existed before this fix.
 */
export async function POST(req: Request) {
  const auth = await requireContractOnboardingSession();
  if ('error' in auth) return auth.error;

  let body: { uploadId?: unknown; path?: unknown; fileName?: unknown };
  try { body = await req.json(); } catch {
    return NextResponse.json({ ok: false, error: 'Documento ausente.' }, { status: 400 });
  }
  const uploadId = typeof body.uploadId === 'string' ? body.uploadId : '';
  const path = typeof body.path === 'string' ? body.path : '';
  const fileName = typeof body.fileName === 'string' && body.fileName.trim() ? body.fileName.trim() : 'documento.pdf';

  if (!uploadId || !path || !ownsOnboardingStoragePath(path, auth.organizationId, auth.user.id, uploadId)) {
    return NextResponse.json({ ok: false, error: 'Não foi possível confirmar o envio do documento.' }, { status: 400 });
  }

  const service = platformServiceClient();
  const download = await service.storage.from(ONBOARDING_STORAGE_BUCKET).download(path);
  if (download.error || !download.data) {
    return NextResponse.json({ ok: false, error: 'Não foi possível confirmar o envio do documento.' }, { status: 400 });
  }
  const bytes = Buffer.from(await download.data.arrayBuffer());
  if (bytes.byteLength === 0) {
    return NextResponse.json({ ok: false, error: 'Selecione o contrato em PDF.' }, { status: 400 });
  }
  if (bytes.byteLength > MAX_ONBOARDING_PDF_BYTES) {
    await removeRedundantUpload(service, path);
    return NextResponse.json({ ok: false, error: 'O PDF deve ter no máximo 30 MB.' }, { status: 413 });
  }
  if (bytes.subarray(0, 5).toString('ascii') !== '%PDF-') {
    await removeRedundantUpload(service, path);
    return NextResponse.json({ ok: false, error: 'O arquivo selecionado não é um PDF válido.' }, { status: 415 });
  }
  const hash = createHash('sha256').update(bytes).digest('hex');

  // Existing canonical document wins over a new intake. The authenticated query keeps
  // the duplicate signal inside the caller's contract visibility boundary.
  const { data: existingDocument } = await auth.supabase.from('contract_documents')
    .select('id,contract_id').eq('content_sha256', hash).eq('document_type', 'contract')
    .is('superseded_by_document_id', null).maybeSingle<{ id: string; contract_id: string }>();
  if (existingDocument) {
    await removeRedundantUpload(service, path);
    return NextResponse.json({ ok: true, duplicate: true,
      contractId: existingDocument.contract_id, message: 'Este documento parece já estar cadastrado.' });
  }

  const { data: existing } = await service.from('contract_onboarding_intakes').select('*')
    .eq('organization_id', auth.organizationId).eq('uploaded_by', auth.user.id)
    .eq('content_sha256', hash).maybeSingle<Record<string, unknown>>();
  if (existing) {
    await removeRedundantUpload(service, path);
    if (existing.status === 'REGISTERED') return NextResponse.json({ ok: true, duplicate: true,
      contractId: existing.contract_id, message: 'Este documento parece já estar cadastrado.' });
    const { data, error } = await service.rpc('contract_onboarding_enqueue', {
      p_organization_id: auth.organizationId, p_intake_id: existing.id,
    });
    if (error) return NextResponse.json({ ok: false, error: 'Não foi possível retomar a leitura.' }, { status: 500 });
    scheduleFastDrain('contract-onboarding');
    return NextResponse.json({ ok: true, intakeId: existing.id,
      status: (data as { status?: string })?.status ?? existing.status, reused: true }, { status: 202 });
  }

  const intakeId = randomUUID();
  const { error: insertError } = await service.from('contract_onboarding_intakes').insert({
    id: intakeId, organization_id: auth.organizationId, uploaded_by: auth.user.id,
    file_name: fileName, file_path: path, file_size: bytes.byteLength,
    mime_type: 'application/pdf', content_sha256: hash, status: 'RECEIVED',
  });
  if (insertError) return NextResponse.json({ ok: false,
    error: 'O documento foi preservado, mas a leitura ainda não pôde ser iniciada.' }, { status: 500 });
  const { data: queued, error: queueError } = await service.rpc('contract_onboarding_enqueue', {
    p_organization_id: auth.organizationId, p_intake_id: intakeId,
  });
  if (queueError) {
    await service.from('contract_onboarding_intakes').update({ status: 'FAILED',
      completed_at: new Date().toISOString(), error_code: 'queue_unavailable',
      error_safe: 'A leitura ainda não pôde ser iniciada.' }).eq('id', intakeId).eq('organization_id', auth.organizationId);
    return NextResponse.json({ ok: true, intakeId, status: 'FAILED', preserved: true }, { status: 202 });
  }
  await logAuditEventServer({ organizationId: auth.organizationId,
    action: 'contract.onboarding_document_received', entityType: 'contract_onboarding_intake', entityId: intakeId,
    metadata: { content_sha256: hash, file_name: fileName, job_id: (queued as { job_id?: string }).job_id },
  }, req.headers);
  scheduleFastDrain('contract-onboarding');
  return NextResponse.json({ ok: true, intakeId, status: 'QUEUED', reused: false }, { status: 202 });
}
