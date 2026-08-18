import { NextResponse } from 'next/server';
import { resolvePayrollActor } from '@/lib/payroll/repository/actor';
import { getEsocialServiceClient } from '@/lib/esocial/connector/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Eventos ingeridos, sem o XML. O conteúdo bruto carrega dado de trabalhador e
 * só é acessível por quem tem `people.payroll_view_sensitive` (política da
 * migration 080) — esta listagem devolve apenas metadados de auditoria.
 */
export async function GET(req: Request) {
  const r = await resolvePayrollActor('admin.manage_integrations');
  if (!r.ok) return r.response;

  const { searchParams } = new URL(req.url);
  const competence = searchParams.get('competence');
  const eventType = searchParams.get('eventType');

  let query = getEsocialServiceClient()
    .from('esocial_events')
    .select('id, event_type, esocial_event_id, receipt_number, competence, worker_cpf_mask, status, received_at, normalized_at')
    .eq('organization_id', r.actor.organizationId)
    .order('received_at', { ascending: false })
    .limit(200);
  if (competence) query = query.eq('competence', competence);
  if (eventType) query = query.eq('event_type', eventType);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, events: data ?? [] });
}
