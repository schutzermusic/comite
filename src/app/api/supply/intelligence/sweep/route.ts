import { NextResponse } from 'next/server';
import { requireAnyOperationsPermission, isSessionError } from '@/lib/operations/session';
import { runSupplyIntelligence } from '@/lib/supply/intelligence-read';
import { todayInSaoPaulo } from '@/lib/operations/projects/access';
import { platformServiceClient } from '@/lib/platform/server-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * "Atualizar a leitura da Apex". Quem vê Supply pode pedir a leitura — ela só
 * escreve o livro de recomendações do sistema, nunca um ato de negócio. Uma
 * leitura por minuto por inquilino, salvo `force`.
 */
export async function POST(request: Request) {
  const session = await requireAnyOperationsPermission(['supply.view', 'procurement.view', 'inventory.view', 'receiving.view']);
  if (isSessionError(session)) return session.error;
  const force = new URL(request.url).searchParams.get('force') === '1';
  const { data: last } = await platformServiceClient().from('supply_intelligence_runs').select('ran_at')
    .eq('organization_id', session.organizationId).order('ran_at', { ascending: false }).limit(1).maybeSingle<{ ran_at: string }>();
  if (!force && last && Date.now() - Date.parse(last.ran_at) < 60_000) {
    return NextResponse.json({ ok: true, skipped: true, lastRunAt: last.ran_at });
  }
  try {
    const out = await runSupplyIntelligence(session.organizationId, todayInSaoPaulo());
    return NextResponse.json({ ok: true, skipped: false, ...out });
  } catch (error) {
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 500 });
  }
}
