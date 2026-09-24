import { NextResponse } from 'next/server';
import { z } from 'zod';
import { logAuditEventServer } from '@/lib/audit/log-audit-event-server';
import { requireCommercialSession, isSessionError, safeGovernedError } from '@/lib/commercial/server-session';
import {
  linkProposalContextToOpportunity, linkProposalToOpportunity, upsertOpportunity,
} from '@/lib/commercial/engagement-service';
import { isMissingFunction, loadContextMembers, loadProposal } from '@/lib/commercial/proposal-context-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createSchema = z.object({
  title: z.string().trim().min(1).max(300),
  counterparty_name: z.string().trim().min(1).max(300),
  party_id: z.string().uuid().nullish(),
  estimated_value: z.union([z.string(), z.number()]).nullish(),
  currency: z.string().regex(/^[A-Z]{3}$/).nullish(),
  expected_decision_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  owner_user_id: z.string().uuid().nullish(),
  notes: z.string().trim().max(2000).nullish(),
});
const schema = z.object({
  opportunityId: z.string().uuid().optional(),
  create: createSchema.optional(),
  reason: z.string().trim().max(1000).nullish(),
}).refine((b) => Boolean(b.opportunityId) !== Boolean(b.create));

/**
 * Vincular o CONTEXTO da proposta (PT + PC) a uma oportunidade — existente,
 * ou criada aqui mesmo a partir da proposta, sem sair do dossiê.
 *
 * Mexe nas duas pontas do funil, e por isso pede as duas alçadas. Criar usa
 * o mesmo ato governado da tela de oportunidades; vincular, o da 216 aplicado
 * a cada documento do contexto (217) — ou, num banco sem a 217, documento a
 * documento pelo contexto derivado.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireCommercialSession(['commercial.proposals.manage', 'commercial.manage']);
  if (isSessionError(session)) return session.error;
  const { id } = await context.params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ ok: false, error: 'Informe a oportunidade.' }, { status: 400 });
  }
  const body = parsed.data;
  let createdOpportunityId: string | null = null;
  try {
    let opportunityId = body.opportunityId ?? null;
    if (body.create) {
      const c = body.create;
      opportunityId = await upsertOpportunity(session.organizationId, session.user.id, {
        title: c.title, counterparty_name: c.counterparty_name, party_id: c.party_id ?? null,
        estimated_value: c.estimated_value === undefined || c.estimated_value === null || c.estimated_value === ''
          ? null : String(c.estimated_value),
        currency: c.currency ?? 'BRL', expected_decision_date: c.expected_decision_date ?? null,
        owner_user_id: c.owner_user_id ?? null, notes: c.notes ?? null,
        stage: 'PROPOSAL', source: 'proposal',
      });
      createdOpportunityId = opportunityId;
      await logAuditEventServer({
        organizationId: session.organizationId, action: 'commercial.opportunity.created_from_proposal',
        entityType: 'commercial_opportunity', entityId: opportunityId, metadata: { proposalId: id },
      }, request.headers);
    }
    const reason = body.reason ?? (body.create ? 'Oportunidade criada a partir da proposta' : null);

    let result: { linked: boolean; documents_linked?: number; party_inherited: boolean; currency_differs?: boolean };
    try {
      result = await linkProposalContextToOpportunity(session.organizationId, session.user.id, id, opportunityId!, reason);
    } catch (error) {
      if (!isMissingFunction(error)) throw error;
      const proposal = await loadProposal(session, id);
      if (!proposal) return NextResponse.json({ ok: false, error: 'Proposta não encontrada.' }, { status: 404 });
      const members = await loadContextMembers(session, proposal);
      result = { linked: false, documents_linked: 0, party_inherited: false, currency_differs: false };
      for (const member of members) {
        const one = await linkProposalToOpportunity(session.organizationId, session.user.id, member.id, opportunityId!, reason);
        if (one.linked) result.documents_linked = (result.documents_linked ?? 0) + 1;
        result.linked ||= one.linked;
        result.party_inherited ||= one.party_inherited;
        result.currency_differs ||= Boolean(one.currency_differs);
      }
    }
    if (result.linked) {
      await logAuditEventServer({
        organizationId: session.organizationId, action: 'commercial.proposal.linked_to_opportunity',
        entityType: 'commercial_proposal', entityId: id,
        metadata: { opportunityId, partyInherited: result.party_inherited, documents: result.documents_linked ?? 1,
          created: Boolean(createdOpportunityId) },
      }, request.headers);
    }
    return NextResponse.json({ ok: true, ...result, opportunity_id: opportunityId, created: Boolean(createdOpportunityId) });
  } catch (error) {
    return NextResponse.json({
      ok: false, error: safeGovernedError((error as Error).message),
      // Criou e o vínculo foi recusado: a oportunidade existe; a tela diz isso.
      opportunity_id: createdOpportunityId,
    }, { status: 422 });
  }
}
