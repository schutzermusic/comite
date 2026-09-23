import { NextResponse } from 'next/server';
import { z } from 'zod';
import { logAuditEventServer } from '@/lib/audit/log-audit-event-server';
import { requireCommercialSession, isSessionError, safeGovernedError } from '@/lib/commercial/server-session';
import { linkProposalToOpportunity } from '@/lib/commercial/engagement-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  opportunityId: z.string().uuid(),
  reason: z.string().trim().max(1000).nullish(),
});

/**
 * Vincular a proposta à oportunidade — pela função governada da 216.
 *
 * Mexe nas duas pontas do funil, e por isso pede as duas alçadas: quem cuida
 * de propostas e quem cuida de oportunidades. A função faz o resto: mesmo
 * inquilino, oportunidade viva, conta e trabalho autorizado coerentes,
 * histórico append-only.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireCommercialSession(['commercial.proposals.manage', 'commercial.manage']);
  if (isSessionError(session)) return session.error;
  const { id } = await context.params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ ok: false, error: 'Informe a oportunidade.' }, { status: 400 });
  }
  try {
    const result = await linkProposalToOpportunity(
      session.organizationId, session.user.id, id, parsed.data.opportunityId, parsed.data.reason ?? null);
    if (result.linked) {
      await logAuditEventServer({
        organizationId: session.organizationId, action: 'commercial.proposal.linked_to_opportunity',
        entityType: 'commercial_proposal', entityId: id,
        metadata: { opportunityId: parsed.data.opportunityId, partyInherited: result.party_inherited },
      }, request.headers);
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: safeGovernedError((error as Error).message) }, { status: 422 });
  }
}
