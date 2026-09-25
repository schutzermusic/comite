/**
 * SUPPLY CHAIN DO LOCAL — `GET /api/dashboard/site/[projectId]/supply[?req=<requirementId>]`.
 *
 * Toda pessoa autenticada com organização ativa chega ao Dashboard, e o
 * Dashboard não pode produzir erro no console: id inválido, projeto que não
 * existe (ou é de outra organização), perfil restrito ou leitura que falhou
 * respondem 200 com `ok: false` + `reason` (e `error` repetindo a mensagem).
 * 500 só quando a montagem inteira falha. `?req=` foca outro material do
 * balanço (fora dele, vale o foco padrão: a falta mais grave).
 */
import { NextResponse } from 'next/server';
import { isSessionError, requireCommercialSession } from '@/lib/commercial/server-session';
import { buildSiteSupply } from '@/lib/dashboard/site-supply';
import { todayInSaoPaulo } from '@/lib/operations/projects/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ projectId: string }> }) {
  const started = Date.now();
  const session = await requireCommercialSession([]);
  if (isSessionError(session)) return session.error;
  const { projectId } = await context.params;
  const req = new URL(request.url).searchParams.get('req');
  const timings: Record<string, number> = {};
  try {
    const body = await buildSiteSupply(session, projectId, todayInSaoPaulo(), { focusRequirementId: req }, timings);
    const serverTiming = [...Object.entries(timings).map(([k, ms]) => `${k};dur=${ms}`), `total;dur=${Date.now() - started}`].join(', ');
    return NextResponse.json(body, { status: 200, headers: { 'Cache-Control': 'no-store', 'Server-Timing': serverTiming } });
  } catch (error) {
    console.error('[dashboard/site] supply: montagem falhou', error);
    const message = 'Não foi possível montar o Supply Chain deste local.';
    return NextResponse.json({ ok: false, reason: 'error', message, error: message },
      { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
