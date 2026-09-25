/**
 * PLANEJAR — `GET /api/dashboard/site/[projectId]/plan`: o Gantt do projeto
 * (atividades, dependências, necessidades por atividade, atividade em foco).
 *
 * Mesmas regras de resposta do local: 200 com `ok: false` e o motivo para id
 * inválido, projeto não encontrado, perfil sem projetos ou falha de leitura;
 * 500 só quando a montagem inteira cai.
 */
import { handleSiteRequest } from '@/lib/dashboard/site-common';
import { buildSitePlan } from '@/lib/dashboard/site-plan';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await context.params;
  return handleSiteRequest(projectId, 'o plano do local', (site, timings) => buildSitePlan(site, timings));
}
