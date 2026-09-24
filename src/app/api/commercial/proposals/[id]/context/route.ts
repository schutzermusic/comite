import { NextResponse } from 'next/server';
import { z } from 'zod';
import { logAuditEventServer } from '@/lib/audit/log-audit-event-server';
import { requireCommercialSession, isSessionError, safeGovernedError } from '@/lib/commercial/server-session';
import { transitionProposalContext, transitionProposalRevision } from '@/lib/commercial/engagement-service';
import { isMissingFunction, loadContextMembers, loadProposal } from '@/lib/commercial/proposal-context-server';
import { latestOf } from '@/lib/commercial/proposal-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  to: z.enum(['INTERNAL_REVIEW', 'INTERNALLY_APPROVED', 'SENT', 'DRAFT']),
});

const FROM: Record<string, string[]> = {
  INTERNAL_REVIEW: ['DRAFT'],
  INTERNALLY_APPROVED: ['INTERNAL_REVIEW'],
  SENT: ['INTERNALLY_APPROVED'],
  DRAFT: ['INTERNAL_REVIEW', 'INTERNALLY_APPROVED'],
};

/**
 * APROVAÇÃO INTERNA do pacote PT + PC.
 *
 * "Este pacote exato PT/PC está autorizado a ir ao cliente?" — não é análise
 * de IA: é a decisão de quem tem alçada. As revisões correntes dos dois
 * documentos andam juntas (217, uma transação). Aprovar exige
 * `commercial.proposals.approve_internal`; o resto (inclusive devolver para
 * ajuste), `commercial.proposals.manage`.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireCommercialSession(['commercial.proposals.manage']);
  if (isSessionError(session)) return session.error;
  const { id } = await context.params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ ok: false, error: 'Transição inválida.' }, { status: 400 });
  }
  const { to } = parsed.data;
  if (to === 'INTERNALLY_APPROVED'
      && !session.permissions.has('commercial.proposals.approve_internal')) {
    return NextResponse.json({ ok: false,
      error: 'Decidir a aprovação interna exige commercial.proposals.approve_internal.' }, { status: 403 });
  }

  try {
    let result: { moved: Array<{ proposal_id: string; revision_id: string; revision: number; kind?: string }> };
    try {
      result = await transitionProposalContext(session.organizationId, session.user.id, id, to);
    } catch (error) {
      if (!isMissingFunction(error)) throw error;
      // Banco sem a 217: o mesmo ato, documento a documento, pelo contexto derivado.
      const proposal = await loadProposal(session, id);
      if (!proposal) return NextResponse.json({ ok: false, error: 'Proposta não encontrada.' }, { status: 404 });
      const members = await loadContextMembers(session, proposal);
      const { data } = await session.supabase.from('commercial_proposal_revisions')
        .select('id,proposal_id,revision,status').eq('organization_id', session.organizationId)
        .in('proposal_id', members.map((m) => m.id));
      const moved: Array<{ proposal_id: string; revision_id: string; revision: number }> = [];
      for (const member of members) {
        const current = latestOf(((data ?? []) as Array<{ id: string; proposal_id: string; revision: number; status: string }>)
          .filter((r) => r.proposal_id === member.id));
        if (!current || !FROM[to].includes(current.status)) continue;
        await transitionProposalRevision(session.organizationId, session.user.id, current.id, to);
        moved.push({ proposal_id: member.id, revision_id: current.id, revision: current.revision });
      }
      if (!moved.length) throw new Error(`Pacote: nenhum documento pode ir para ${to}.`);
      result = { moved };
    }
    await logAuditEventServer({
      organizationId: session.organizationId,
      action: `commercial.proposal_context.${to.toLowerCase()}`,
      entityType: 'commercial_proposal', entityId: id,
      metadata: { moved: result.moved.map((m) => m.revision_id) },
    }, request.headers);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: safeGovernedError((error as Error).message) }, { status: 422 });
  }
}
