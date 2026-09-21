import { NextResponse } from 'next/server';
import { getActiveOrganizationRow } from '@/lib/auth/active-organization';
import { createClient } from '@/utils/supabase/server';
import { requireApiPermission } from '@/lib/auth/api-guard';
import { proposeForProject } from '@/lib/contracts/billing/planning/propose-mappings-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';


/**
 * POST /api/contracts/billing/schedule-mapping/propose
 *
 * Roda o casamento automático marco contratual ↔ etapa de cronograma para um
 * projeto e PERSISTE as sugestões como PROPOSTAS.
 *
 * ─── O teto desta rota ────────────────────────────────────────────────────
 *
 * Ela nunca aceita mapeamento. O único caminho de escrita é a RPC
 * `contract_billing_propose_timeline_mapping`, que grava `system_proposed` /
 * `proposed` como literais — e o CHECK `cmrtm_proposal_needs_review` da
 * migration 131 continua exigindo revisor humano NOMEADO para chegar a
 * `accepted`. Nem esta rota, nem a importação que a chama, nem um parâmetro
 * futuro conseguem pular essa revisão.
 *
 * ─── O que ela deixa em paz ───────────────────────────────────────────────
 *
 * Regra que JÁ tem mapeamento aceito não entra no lote. O mapeamento aceito
 * continua valendo e a data nova do cronograma flui por ele sozinha — é
 * exatamente o "uma vez governado, sincroniza para sempre". Repropor ali seria
 * oferecer ao revisor uma decisão que ele já tomou.
 */
export async function POST(req: Request) {
  // Propor mapeamento é ato de Contratos: é a ponte que vai virar data de
  // faturamento. Quem importa cronograma sem poder editar contrato dispara a
  // rota pela importação, que roda com a sua própria permissão.
  const guard = await requireApiPermission('contracts.edit', { allowAdmin: true });
  if (!guard.ok) return guard.response;

  let body: { projectId?: string };
  try {
    body = (await req.json()) as { projectId?: string };
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON inválido.' }, { status: 400 });
  }
  const projectId = body.projectId;
  if (!projectId) {
    return NextResponse.json({ ok: false, error: 'projectId é obrigatório.' }, { status: 400 });
  }

  const supabase = await createClient();
  const profile = await getActiveOrganizationRow(supabase);
  const orgId = profile?.organization_id as string | undefined;
  if (!orgId) return NextResponse.json({ ok: false, error: 'Usuário sem organização.' }, { status: 403 });

  const result = await proposeForProject(orgId, projectId);
  return NextResponse.json({ ok: true, ...result });
}

