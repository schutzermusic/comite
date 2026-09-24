import { NextResponse } from 'next/server';
import { logAuditEventServer } from '@/lib/audit/log-audit-event-server';
import { requireAnyOperationsPermission, isSessionError, hasOptionalPermission } from '@/lib/operations/session';
import { IncompleteIntelligenceRead, runSupplyIntelligence } from '@/lib/supply/intelligence-read';
import { todayInSaoPaulo } from '@/lib/operations/projects/access';
import { platformServiceClient } from '@/lib/platform/server-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * "Atualizar a leitura da Apex". Quem vê Supply pode pedir a leitura — ela só
 * escreve o livro de recomendações do sistema, nunca um ato de negócio. Uma
 * leitura por minuto por inquilino; furar esse intervalo (`force`) é de quem
 * planeja Supply. A leitura agendada roda pelo relógio da plataforma
 * (`supply.intelligence.sweep`), não por esta rota.
 */
export async function POST(request: Request) {
  const session = await requireAnyOperationsPermission(['supply.view', 'procurement.view', 'inventory.view', 'receiving.view']);
  if (isSessionError(session)) return session.error;
  const force = new URL(request.url).searchParams.get('force') === '1';
  if (force && !(await hasOptionalPermission(session, 'supply.plan'))) {
    return NextResponse.json({ ok: false, error: 'Forçar uma nova leitura é de quem planeja Supply.', code: 'FORBIDDEN' }, { status: 403 });
  }
  const { data: last } = await platformServiceClient().from('supply_intelligence_runs').select('ran_at')
    .eq('organization_id', session.organizationId).order('ran_at', { ascending: false }).limit(1).maybeSingle<{ ran_at: string }>();
  if (!force && last && Date.now() - Date.parse(last.ran_at) < 60_000) {
    return NextResponse.json({ ok: true, skipped: true, lastRunAt: last.ran_at });
  }
  try {
    const out = await runSupplyIntelligence(session.organizationId, todayInSaoPaulo());
    await logAuditEventServer({ organizationId: session.organizationId, action: 'supply.intelligence.sweep_requested',
      entityType: 'supply_intelligence', entityId: null, metadata: { force, ...out } }, request.headers);
    return NextResponse.json({ ok: true, skipped: false, ...out });
  } catch (error) {
    const incomplete = error instanceof IncompleteIntelligenceRead;
    console.error('[supply-intelligence] leitura manual falhou', {
      organizationId: session.organizationId, incomplete, error: (error as Error).message.slice(0, 300) });
    return NextResponse.json({ ok: false, error: incomplete
      ? 'A Apex não conseguiu ler todos os fatos e abortou sem mudar nenhuma recomendação. Tente de novo em instantes.'
      : 'Não foi possível atualizar a leitura da Apex agora.' }, { status: incomplete ? 503 : 500 });
  }
}
