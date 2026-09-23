import { NextResponse } from 'next/server';
import { z } from 'zod';
import { logAuditEventServer } from '@/lib/audit/log-audit-event-server';
import { requireCommercialSession, isSessionError, safeGovernedError } from '@/lib/commercial/server-session';
import { regularizeExecutionStart } from '@/lib/commercial/engagement-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  sourceKind: z.enum(['customer_po', 'customer_authorization', 'formal_contract', 'accepted_proposal']),
  externalReference: z.string().trim().max(500).nullish(),
  documentId: z.string().uuid().nullish(),
  contractId: z.string().uuid().nullish(),
  proposalRevisionId: z.string().uuid().nullish(),
  note: z.string().trim().min(5).max(2000),
});

/**
 * Regularizar o início excepcional: a evidência chega, passa a reger (por
 * escrito) e o faturamento travado é reavaliado — na mesma transação.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireCommercialSession(['commercial.engagements.manage']);
  if (isSessionError(session)) return session.error;
  const { id } = await context.params;
  let parsed: z.infer<typeof schema>;
  try { parsed = schema.parse(await request.json()); }
  catch { return NextResponse.json({ ok: false, error: 'Informe a evidência e uma nota de regularização.' }, { status: 400 }); }
  if (['customer_po', 'customer_authorization'].includes(parsed.sourceKind) && !parsed.externalReference && !parsed.documentId) {
    return NextResponse.json({ ok: false, error: 'Informe o documento ou a referência verificável.' }, { status: 400 });
  }
  try {
    const result = await regularizeExecutionStart(session.organizationId, session.user.id, id, {
      source_kind: parsed.sourceKind,
      external_reference: parsed.externalReference ?? null,
      document_id: parsed.documentId ?? null,
      contract_id: parsed.contractId ?? null,
      proposal_revision_id: parsed.proposalRevisionId ?? null,
      note: parsed.note,
    });
    await logAuditEventServer({
      organizationId: session.organizationId, action: 'commercial.execution.documentation_regularized',
      entityType: 'commercial_execution_start', entityId: id,
      metadata: { sourceKind: parsed.sourceKind, recomputed: result.billing_events_recomputed },
    }, request.headers);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: safeGovernedError((error as Error).message) }, { status: 422 });
  }
}
