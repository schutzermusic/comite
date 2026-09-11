import { createHash, randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { platformServiceClient } from '@/lib/platform/server-client';
import { scheduleFastDrain } from '@/lib/platform/jobs/fast-path';
import { logAuditEventServer } from '@/lib/audit/log-audit-event-server';
import { requireContractOnboardingSession } from '@/lib/contracts/onboarding/server-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_BYTES = 30 * 1024 * 1024;
const safeName = (name: string) => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-').slice(0, 160);

export async function POST(req: Request) {
  const auth = await requireContractOnboardingSession();
  if ('error' in auth) return auth.error;
  let form: FormData;
  try { form = await req.formData(); } catch {
    return NextResponse.json({ ok: false, error: 'Documento ausente.' }, { status: 400 });
  }
  const file = form.get('document');
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ ok: false, error: 'Selecione o contrato em PDF.' }, { status: 400 });
  }
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    return NextResponse.json({ ok: false, error: 'O envio inicial aceita o contrato em PDF.' }, { status: 415 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ ok: false, error: 'O PDF deve ter no máximo 30 MB.' }, { status: 413 });
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.subarray(0, 5).toString('ascii') !== '%PDF-') {
    return NextResponse.json({ ok: false, error: 'O arquivo selecionado não é um PDF válido.' }, { status: 415 });
  }
  const hash = createHash('sha256').update(bytes).digest('hex');

  // Existing canonical document wins over a new intake. The authenticated query keeps
  // the duplicate signal inside the caller's contract visibility boundary.
  const { data: existingDocument } = await auth.supabase.from('contract_documents')
    .select('id,contract_id').eq('content_sha256', hash).eq('document_type', 'contract')
    .is('superseded_by_document_id', null).maybeSingle<{ id: string; contract_id: string }>();
  if (existingDocument) return NextResponse.json({ ok: true, duplicate: true,
    contractId: existingDocument.contract_id, message: 'Este documento parece já estar cadastrado.' });

  const service = platformServiceClient();
  const { data: existing } = await service.from('contract_onboarding_intakes').select('*')
    .eq('organization_id', auth.organizationId).eq('uploaded_by', auth.user.id)
    .eq('content_sha256', hash).maybeSingle<Record<string, unknown>>();
  if (existing) {
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
  const path = `${auth.organizationId}/onboarding/${auth.user.id}/${hash}-${safeName(file.name)}`;
  const upload = await service.storage.from('contract-files').upload(path, bytes, {
    contentType: 'application/pdf', upsert: false,
  });
  if (upload.error) return NextResponse.json({ ok: false, error: 'Não foi possível preservar o documento.' }, { status: 500 });
  const { error: insertError } = await service.from('contract_onboarding_intakes').insert({
    id: intakeId, organization_id: auth.organizationId, uploaded_by: auth.user.id,
    file_name: file.name, file_path: path, file_size: file.size,
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
    metadata: { content_sha256: hash, file_name: file.name, job_id: (queued as { job_id?: string }).job_id },
  }, req.headers);
  scheduleFastDrain('contract-onboarding');
  return NextResponse.json({ ok: true, intakeId, status: 'QUEUED', reused: false }, { status: 202 });
}
