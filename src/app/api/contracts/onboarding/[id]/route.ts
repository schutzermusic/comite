import { NextResponse } from 'next/server';
import { platformServiceClient } from '@/lib/platform/server-client';
import { scheduleFastDrain } from '@/lib/platform/jobs/fast-path';
import { logAuditEventServer } from '@/lib/audit/log-audit-event-server';
import { requireContractOnboardingSession } from '@/lib/contracts/onboarding/server-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireContractOnboardingSession();
  if ('error' in auth) return auth.error;
  const { id } = await params;
  const { data, error } = await auth.supabase.from('contract_onboarding_intakes')
    .select('id,file_name,status,structured_result,attention_count,error_safe,contract_id,received_at,completed_at')
    .eq('id', id).eq('organization_id', auth.organizationId).eq('uploaded_by', auth.user.id).maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: 'Não foi possível consultar a leitura.' }, { status: 500 });
  if (!data) return NextResponse.json({ ok: false, error: 'Entrada de contrato não encontrada.' }, { status: 404 });
  return NextResponse.json({ ok: true, intake: data });
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireContractOnboardingSession();
  if ('error' in auth) return auth.error;
  const { id } = await params;
  const { data, error } = await platformServiceClient().rpc('contract_onboarding_enqueue', {
    p_organization_id: auth.organizationId, p_intake_id: id,
  });
  if (error) return NextResponse.json({ ok: false, error: 'Não foi possível tentar novamente.' }, { status: 400 });
  scheduleFastDrain('contract-onboarding-retry');
  return NextResponse.json({ ok: true, ...(data as object) }, { status: 202 });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireContractOnboardingSession();
  if ('error' in auth) return auth.error;
  const { id } = await params;
  let finalValues: Record<string, unknown>;
  try { finalValues = await req.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ ok: false, error: 'Cadastro final inválido.' }, { status: 400 }); }
  const { data, error } = await platformServiceClient().rpc('contract_onboarding_finalize', {
    p_organization_id: auth.organizationId, p_intake_id: id, p_actor: auth.user.id, p_final: finalValues,
  });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  const result = data as { contract_id: string; document_id?: string; reused?: boolean };
  if (result.document_id) {
    // Metadata registration and contractual operationalization stay separate.
    // The existing canonical queue performs clauses + obligations after creation.
    await platformServiceClient().rpc('contract_clause_extraction_request', {
      p_organization_id: auth.organizationId,
      p_contract_id: result.contract_id,
      p_document_id: result.document_id,
      p_requested_by: auth.user.id,
    });
    scheduleFastDrain('contract-operationalization');
  }
  await logAuditEventServer({ organizationId: auth.organizationId, action: 'contract.created',
    entityType: 'contract', entityId: result.contract_id,
    metadata: { source: 'document_first_onboarding', intake_id: id,
      document_id: result.document_id, reused: result.reused ?? false },
  }, req.headers);
  return NextResponse.json({ ok: true, contractId: result.contract_id,
    documentId: result.document_id, reused: result.reused ?? false });
}
