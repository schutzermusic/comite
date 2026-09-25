/**
 * LOCAL EM FOCO — `GET /api/dashboard/site/[projectId]` (Visão geral).
 *
 * Toda pessoa autenticada com organização ativa chega ao Dashboard, e o
 * Dashboard não pode produzir erro no console: id inválido, projeto de outra
 * organização (ou inexistente), perfil sem leitura de projetos e leitura que
 * falhou respondem 200 com `ok: false` e o motivo (`invalid` · `not_found` ·
 * `restricted` · `error`). 500 só quando a montagem inteira cai.
 */
import { handleSiteRequest } from '@/lib/dashboard/site-common';
import { buildSiteHud } from '@/lib/dashboard/site';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await context.params;
  return handleSiteRequest(projectId, 'a visão do local', (site, timings) => buildSiteHud(site, timings));
}
