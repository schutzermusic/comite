import { NextResponse } from 'next/server';
import { logAuditEventServer } from '@/lib/audit/log-audit-event-server';
import { requireCommercialSession, isSessionError, safeGovernedError } from '@/lib/commercial/server-session';
import { transitionOpportunityStage } from '@/lib/commercial/engagement-service';
import { checkStageTransition } from '@/lib/commercial/stage-policy';
import type { OpportunityStage } from '@/lib/commercial/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STAGES: OpportunityStage[] = [
  'QUALIFICATION', 'DISCOVERY', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST', 'ABANDONED',
];

/**
 * A MUDANÇA DE ETAPA como ato.
 *
 * A rota valida contra a mesma tabela de transições que a tela usa para decidir
 * o que oferecer (`stage-policy.ts`) e só então chama a função governada, que
 * valida de novo. A repetição é deliberada: a daqui existe para a pessoa
 * receber "perder exige motivo" em vez de um erro de banco; a do banco existe
 * porque é ela que continua valendo quando alguém chama a API sem passar pela
 * tela.
 *
 * Ganhar NÃO abre trabalho autorizado. São permissões diferentes, fontes
 * diferentes e momentos diferentes — e o intervalo entre os dois é visível de
 * propósito, como o sinal WON_WITHOUT_AUTHORIZED_WORK.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireCommercialSession(['commercial.manage']);
  if (isSessionError(session)) return session.error;
  const { id } = await context.params;

  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok: false, error: 'Corpo inválido.' }, { status: 400 }); }

  const to = String(body.to ?? '').trim() as OpportunityStage;
  const reason = String(body.reason ?? '').trim() || null;
  if (!STAGES.includes(to)) {
    return NextResponse.json({ ok: false, error: 'Etapa de destino inválida.' }, { status: 400 });
  }

  const { data: current } = await session.supabase
    .from('commercial_opportunities')
    .select('stage')
    .eq('organization_id', session.organizationId)
    .eq('id', id)
    .maybeSingle();
  if (!current) {
    return NextResponse.json({ ok: false, error: 'Oportunidade não encontrada.' }, { status: 404 });
  }

  const verdict = checkStageTransition(current.stage as OpportunityStage, to, reason);
  if (!verdict.ok) {
    return NextResponse.json({ ok: false, error: verdict.reason }, { status: 422 });
  }

  try {
    const result = await transitionOpportunityStage(
      session.organizationId, session.user.id, id, to, reason);
    await logAuditEventServer({
      organizationId: session.organizationId,
      action: 'commercial.opportunity.stage_changed',
      entityType: 'commercial_opportunity', entityId: id,
      metadata: { from: result.from_stage, to: result.to_stage, hasReason: Boolean(reason) },
    }, request.headers);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ ok: false,
      error: safeGovernedError((error as Error).message) }, { status: 422 });
  }
}
