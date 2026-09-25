import { NextResponse } from 'next/server';
import { requireCommercialSession, isSessionError } from '@/lib/commercial/server-session';
import { buildDashboardOverview } from '@/lib/dashboard/overview';
import { todayInSaoPaulo } from '@/lib/operations/projects/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * O Dashboard V2 — uma resposta para toda pessoa autenticada com organização
 * ativa (a fronteira de Decisões; `/dashboard` é onde todo mundo cai depois
 * do login). O que o perfil não lê vem no corpo como `restricted`, nunca como
 * 403 nem como 0. 500 só quando a montagem inteira falha.
 */
export async function GET() {
  const started = Date.now();
  const session = await requireCommercialSession([]);
  if (isSessionError(session)) return session.error;
  const timings: Record<string, number> = {};
  try {
    const overview = await buildDashboardOverview(session, todayInSaoPaulo(), timings);
    const serverTiming = [
      ...Object.entries(timings).map(([k, ms]) => `${k};dur=${ms}`),
      `total;dur=${Date.now() - started}`,
    ].join(', ');
    return NextResponse.json(overview, { status: 200, headers: { 'Cache-Control': 'no-store', 'Server-Timing': serverTiming } });
  } catch (error) {
    console.error('[dashboard] montagem falhou', error);
    return NextResponse.json({ ok: false, error: 'Não foi possível montar o Dashboard.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
