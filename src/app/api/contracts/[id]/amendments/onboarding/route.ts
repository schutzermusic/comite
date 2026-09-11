import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { requireActiveOrganizationId } from '@/lib/auth/active-organization';
import { platformServiceClient } from '@/lib/platform/server-client';
import { scheduleFastDrain } from '@/lib/platform/jobs/fast-path';
import { logAuditEventServer } from '@/lib/audit/log-audit-event-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type PermShape = { roles?: { role_permissions?: Array<{ permissions?: { key?: string } }> } };

async function session() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ ok: false, error: 'Não autenticado' }, { status: 401 }) };
  const { data: rows, error } = await supabase.from('user_roles')
    .select('roles!inner(role_permissions!inner(permissions!inner(key)))').eq('user_id', user.id);
  if (error) return { error: NextResponse.json({ ok: false, error: 'Não foi possível verificar a permissão.' }, { status: 500 }) };
  const keys = new Set<string>();
  for (const row of (rows ?? []) as unknown as PermShape[]) {
    for (const item of row.roles?.role_permissions ?? []) {
      if (item.permissions?.key) keys.add(item.permissions.key);
    }
  }
  if (!keys.has('contracts.analyze_with_ai') || !keys.has('contracts.edit')) {
    return { error: NextResponse.json({
      ok: false, error: 'Adicionar aditivo exige contracts.edit e contracts.analyze_with_ai.',
    }, { status: 403 }) };
  }
  try {
    const organizationId = await requireActiveOrganizationId(supabase);
    return { supabase, user, organizationId };
  } catch {
    return { error: NextResponse.json({ ok: false, error: 'Nenhuma organização ativa selecionada.' }, { status: 403 }) };
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: contractId } = await params;
  const auth = await session();
  if ('error' in auth) return auth.error;
  let body: { documentId?: string };
  try { body = await req.json() as { documentId?: string }; }
  catch { body = {}; }
  if (!body.documentId) {
    return NextResponse.json({ ok: false, error: 'documentId ausente.' }, { status: 400 });
  }

  const { data, error } = await platformServiceClient().rpc('contract_amendment_ingestion_request', {
    p_organization_id: auth.organizationId,
    p_contract_id: contractId,
    p_document_id: body.documentId,
    p_requested_by: auth.user.id,
  });
  if (error) {
    const deterministic = ['P0002', '23514', '42501'].includes(error.code ?? '');
    return NextResponse.json({ ok: false, error: error.message }, { status: deterministic ? 400 : 500 });
  }
  const queued = data as {
    request_id: string; status: string; job_id: string | null;
    amendment_id: string | null; reused: boolean;
  };
  await logAuditEventServer({
    organizationId: auth.organizationId,
    action: 'contract.amendment_ai_requested',
    entityType: 'contract', entityId: contractId,
    metadata: { request_id: queued.request_id, document_id: body.documentId,
      job_id: queued.job_id, reused: queued.reused },
  }, req.headers);
  scheduleFastDrain('contract-amendment-extraction');
  return NextResponse.json({ ok: true, requestId: queued.request_id, status: queued.status,
    jobId: queued.job_id, amendmentId: queued.amendment_id, reused: queued.reused }, { status: 202 });
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: contractId } = await params;
  const auth = await session();
  if ('error' in auth) return auth.error;
  const requestId = new URL(req.url).searchParams.get('requestId');
  if (!requestId) return NextResponse.json({ ok: false, error: 'requestId ausente.' }, { status: 400 });

  const { data: request, error } = await auth.supabase
    .from('contract_amendment_ingestion_requests')
    .select('*').eq('id', requestId).eq('contract_id', contractId)
    .eq('organization_id', auth.organizationId).maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!request) return NextResponse.json({ ok: false, error: 'Análise não encontrada.' }, { status: 404 });

  let amendment = null;
  let effects: unknown[] = [];
  if (request.amendment_id) {
    const [{ data: amendmentRow }, { data: effectRows }] = await Promise.all([
      auth.supabase.from('contract_amendments').select('*')
        .eq('id', request.amendment_id).eq('contract_id', contractId).maybeSingle(),
      auth.supabase.from('contract_amendment_effective_effects').select('*')
        .eq('amendment_id', request.amendment_id).eq('contract_id', contractId),
    ]);
    amendment = amendmentRow;
    effects = effectRows ?? [];
  }
  return NextResponse.json({ ok: true, request, amendment, effects });
}
