/**
 * FATURAMENTO DO LOCAL — `GET /api/dashboard/site/[projectId]/billing`.
 *
 * O eventograma dos contratos vinculados ao projeto. Id inválido, projeto que
 * não existe (ou é de outra organização), perfil restrito ou leitura do
 * projeto que falhou respondem 200 com `ok: false` + `reason` (e `error`
 * repetindo a mensagem) — o Dashboard não produz erro no console. 500 só
 * quando a montagem inteira falha. Faturar é em Contratos.
 */
import { NextResponse } from 'next/server';
import { isSessionError, requireCommercialSession } from '@/lib/commercial/server-session';
import { buildSiteBilling } from '@/lib/dashboard/site-billing';
import { todayInSaoPaulo } from '@/lib/operations/projects/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ projectId: string }> }) {
  const started = Date.now();
  const session = await requireCommercialSession([]);
  if (isSessionError(session)) return session.error;
  const { projectId } = await context.params;
  const timings: Record<string, number> = {};
  try {
    const body = await buildSiteBilling(session, projectId, todayInSaoPaulo(), timings);
    const serverTiming = [...Object.entries(timings).map(([k, ms]) => `${k};dur=${ms}`), `total;dur=${Date.now() - started}`].join(', ');
    return NextResponse.json(body, { status: 200, headers: { 'Cache-Control': 'no-store', 'Server-Timing': serverTiming } });
  } catch (error) {
    console.error('[dashboard/site] billing: montagem falhou', error);
    const message = 'Não foi possível montar o faturamento deste local.';
    return NextResponse.json({ ok: false, reason: 'error', message, error: message },
      { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
