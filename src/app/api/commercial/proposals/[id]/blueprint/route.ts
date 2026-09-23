import { NextResponse } from 'next/server';
import { z } from 'zod';
import { logAuditEventServer } from '@/lib/audit/log-audit-event-server';
import { requireCommercialSession, isSessionError, safeGovernedError } from '@/lib/commercial/server-session';
import { createExecutionBlueprint } from '@/lib/commercial/engagement-service';
import { blueprintItemsFromFacts } from '@/lib/commercial/blueprint';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ revisionId: z.string().uuid() });

/**
 * Monta o BLUEPRINT de execução de uma revisão a partir dos fatos lidos dela.
 *
 * É contexto de PLANEJAMENTO: `commercial_blueprint_create` não tem FK para
 * projeto, OS, medição ou faturamento, e o blueprint só pode ser CONSUMIDO
 * quando a revisão está aceita e há autorização ativa (gatilho da 199). Cada
 * item aponta o fato de onde veio; fato rejeitado não entra.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireCommercialSession(['commercial.proposals.manage']);
  if (isSessionError(session)) return session.error;
  const { id } = await context.params;
  let parsed: z.infer<typeof schema>;
  try { parsed = schema.parse(await request.json()); }
  catch { return NextResponse.json({ ok: false, error: 'Informe a revisão.' }, { status: 400 }); }

  const { data: revision } = await session.supabase.from('commercial_proposal_revisions').select('id,proposal_id')
    .eq('organization_id', session.organizationId).eq('id', parsed.revisionId).eq('proposal_id', id).maybeSingle();
  if (!revision) return NextResponse.json({ ok: false, error: 'Revisão não encontrada nesta proposta.' }, { status: 404 });

  const { data: facts } = await session.supabase.from('commercial_extracted_facts')
    .select('id,fact_domain,label,value_text,value_numeric,value_date,unit,currency,corrected_value,confidence,confirmation_state')
    .eq('organization_id', session.organizationId).eq('subject_id', parsed.revisionId)
    .neq('confirmation_state', 'REJECTED').limit(400);
  const items = blueprintItemsFromFacts((facts ?? []) as never[]);
  if (!items.length) {
    return NextResponse.json({ ok: false,
      error: 'A revisão não tem fatos lidos que alimentem um blueprint. Nada será suposto.' }, { status: 422 });
  }
  try {
    const blueprintId = await createExecutionBlueprint(session.organizationId, session.user.id, parsed.revisionId,
      { generated_by: 'human', items });
    await logAuditEventServer({
      organizationId: session.organizationId, action: 'commercial.blueprint.created',
      entityType: 'commercial_execution_blueprint', entityId: blueprintId,
      metadata: { revisionId: parsed.revisionId, items: items.length },
    }, request.headers);
    return NextResponse.json({ ok: true, blueprintId, items: items.length });
  } catch (error) {
    return NextResponse.json({ ok: false, error: safeGovernedError((error as Error).message) }, { status: 422 });
  }
}
