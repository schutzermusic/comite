import { NextResponse } from 'next/server';
import { requireCommercialSession, isSessionError, safeGovernedError } from '@/lib/commercial/server-session';
import { upsertOpportunity } from '@/lib/commercial/engagement-service';
import { resolveOwnerNames } from '@/lib/commercial/owner-directory';
import {
  buildPipelineSignals, isOpenFollowup,
  type SignalFollowup, type SignalOpportunity, type SignalProposal, type SignalRevision,
} from '@/lib/commercial/pipeline-signals';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * O pipeline, já inteligível.
 *
 * ─── Por que os sinais são calculados AQUI ───────────────────────────────
 *
 * "Sem próxima ação", "parada há N dias" e "proposta a vencer" dependem de
 * três fontes — oportunidade, acompanhamento e revisão — que a tela teria de
 * buscar separadamente e cruzar por conta própria. Feito no cliente, o cruzamento
 * divergiria entre a lista, o kanban e a visão geral no primeiro ajuste de
 * limiar; e a tela passaria a receber a fila inteira de follow-ups só para
 * descobrir quais oportunidades estão descobertas.
 *
 * Aqui, uma regra só (`pipeline-signals.ts`, pura e testada em unidade) roda
 * sobre o que a RLS deixou o chamador ver. A tela recebe o veredito e o próximo
 * passo de cada oportunidade — não o material bruto para recalculá-los.
 */
export async function GET() {
  const session = await requireCommercialSession(['commercial.view']);
  if (isSessionError(session)) return session.error;

  const [opportunities, followups, proposals, revisions] = await Promise.all([
    session.supabase.from('commercial_opportunities')
      .select('id,code,title,counterparty_name,party_id,primary_contact_id,stage,estimated_value,'
        + 'currency,probability,expected_decision_date,owner_user_id,engagement_id,closed_at,'
        + 'lost_reason,source,stage_entered_at,created_at,updated_at')
      .eq('organization_id', session.organizationId)
      .order('created_at', { ascending: false })
      .limit(300),
    session.supabase.from('apex_followups')
      .select('id,source_kind,source_id,goal,state,due_date,next_expected_event,'
        + 'next_expected_event_at,responsible_text,responsible_user_id')
      .eq('organization_id', session.organizationId)
      .in('source_kind', ['commercial_opportunity', 'commercial_proposal'])
      .limit(500),
    session.supabase.from('commercial_proposals')
      .select('*') // context_id (217) quando existe: sinais por contexto, não por documento
      .eq('organization_id', session.organizationId)
      .limit(300),
    session.supabase.from('commercial_proposal_revisions')
      .select('id,proposal_id,revision,status,validity_until')
      .eq('organization_id', session.organizationId)
      .limit(1000),
  ]);

  if (opportunities.error) {
    return NextResponse.json({ ok: false,
      error: 'Não foi possível consultar as oportunidades.' }, { status: 500 });
  }

  const rows = (opportunities.data ?? []) as unknown as SignalOpportunity[];
  const followupRows = (followups.data ?? []) as unknown as SignalFollowup[];

  const signals = buildPipelineSignals({
    opportunities: rows,
    followups: followupRows,
    proposals: (proposals.data ?? []) as unknown as SignalProposal[],
    revisions: (revisions.data ?? []) as unknown as SignalRevision[],
  });

  /*
    O PRÓXIMO PASSO de cada oportunidade: o acompanhamento aberto mais urgente.
    "Mais urgente" é o de menor prazo, e um sem prazo perde para um com prazo —
    um compromisso sem data não é mais urgente do que um datado, é menos
    governado, e ordenar ao contrário faria a linha da lista mostrar o item
    menos acionável.
  */
  const nextActions: Record<string, SignalFollowup> = {};
  for (const followup of followupRows) {
    if (followup.source_kind !== 'commercial_opportunity' || !isOpenFollowup(followup)) continue;
    const current = nextActions[followup.source_id];
    if (!current) { nextActions[followup.source_id] = followup; continue; }
    const a = followup.due_date ?? '9999-12-31';
    const b = current.due_date ?? '9999-12-31';
    if (a < b) nextActions[followup.source_id] = followup;
  }

  const owners = await resolveOwnerNames(session.organizationId,
    rows.map((row) => (row as unknown as { owner_user_id: string | null }).owner_user_id));

  return NextResponse.json({ ok: true, opportunities: rows, signals, nextActions, owners });
}

export async function POST(request: Request) {
  const session = await requireCommercialSession(['commercial.manage']);
  if (isSessionError(session)) return session.error;

  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok: false, error: 'Corpo inválido.' }, { status: 400 }); }

  if (!String(body.title ?? '').trim() || !String(body.counterparty_name ?? '').trim()) {
    return NextResponse.json({ ok: false,
      error: 'Título e contraparte são obrigatórios.' }, { status: 400 });
  }
  try {
    const id = await upsertOpportunity(session.organizationId, session.user.id, body);
    return NextResponse.json({ ok: true, opportunityId: id });
  } catch (error) {
    return NextResponse.json({ ok: false,
      error: safeGovernedError((error as Error).message) }, { status: 422 });
  }
}
