import { NextResponse } from 'next/server';
import { logAuditEventServer } from '@/lib/audit/log-audit-event-server';
import { requireCommercialSession, isSessionError, safeGovernedError } from '@/lib/commercial/server-session';
import { createProposal, transitionProposalRevision, reviseProposal } from '@/lib/commercial/engagement-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Propostas e suas REVISÕES.
 *
 * A listagem devolve as revisões junto porque uma proposta sem elas não diz
 * nada: valor, prazo, condição e estado vivem na revisão, e mostrar só o
 * cabeçalho obrigaria uma segunda ida ao servidor para saber se a proposta
 * está em rascunho ou aceita.
 */
export async function GET() {
  const session = await requireCommercialSession(['commercial.view']);
  if (isSessionError(session)) return session.error;

  const [proposals, revisions] = await Promise.all([
    session.supabase.from('commercial_proposals')
      .select('id,opportunity_id,proposal_number,kind,title,counterparty_name,currency,created_at')
      .eq('organization_id', session.organizationId)
      .order('created_at', { ascending: false }).limit(300),
    session.supabase.from('commercial_proposal_revisions')
      .select('id,proposal_id,revision,status,total_value,currency,validity_until,'
        + 'payment_terms,scope_summary,document_id,accepted_at,acceptance_source,'
        + 'internally_approved_at,sent_at,superseded_by_id')
      .eq('organization_id', session.organizationId)
      .order('revision', { ascending: false }).limit(1000),
  ]);

  if (proposals.error || revisions.error) {
    return NextResponse.json({ ok: false,
      error: 'Não foi possível consultar as propostas.' }, { status: 500 });
  }
  return NextResponse.json({ ok: true,
    proposals: proposals.data ?? [], revisions: revisions.data ?? [] });
}

export async function POST(request: Request) {
  const session = await requireCommercialSession(['commercial.proposals.manage']);
  if (isSessionError(session)) return session.error;

  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok: false, error: 'Corpo inválido.' }, { status: 400 }); }

  const required = ['proposal_number', 'kind', 'title', 'counterparty_name'];
  const missing = required.filter((key) => !String(body[key] ?? '').trim());
  if (missing.length) {
    return NextResponse.json({ ok: false,
      error: `Campos obrigatórios: ${missing.join(', ')}.` }, { status: 400 });
  }
  try {
    const result = await createProposal(session.organizationId, session.user.id, body);
    await logAuditEventServer({
      organizationId: session.organizationId,
      action: 'commercial.proposal.created', entityType: 'commercial_proposal',
      entityId: result.proposal_id, metadata: { kind: body.kind },
    }, request.headers);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ ok: false,
      error: safeGovernedError((error as Error).message) }, { status: 422 });
  }
}

/**
 * Transição INTERNA da revisão, ou criação da próxima revisão.
 *
 * O que o CLIENTE responde não passa por aqui: aceite, recusa e expiração têm
 * rota própria, permissão própria e exigem dizer como o cliente se manifestou.
 */
export async function PATCH(request: Request) {
  const session = await requireCommercialSession(['commercial.proposals.manage']);
  if (isSessionError(session)) return session.error;

  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok: false, error: 'Corpo inválido.' }, { status: 400 }); }

  const revisionId = String(body.revisionId ?? '').trim();
  if (!revisionId) {
    return NextResponse.json({ ok: false, error: 'Informe a revisão.' }, { status: 400 });
  }

  try {
    if (body.action === 'revise') {
      const result = await reviseProposal(
        session.organizationId, session.user.id, revisionId,
        (body.payload as Record<string, unknown>) ?? {});
      return NextResponse.json({ ok: true, ...result });
    }
    const to = String(body.to ?? '').trim();
    if (to === 'INTERNALLY_APPROVED'
        && !session.permissions.has('commercial.proposals.approve_internal')) {
      return NextResponse.json({ ok: false,
        error: 'Aprovar internamente exige commercial.proposals.approve_internal.' }, { status: 403 });
    }
    const result = await transitionProposalRevision(
      session.organizationId, session.user.id, revisionId, to);
    await logAuditEventServer({
      organizationId: session.organizationId,
      action: `commercial.proposal_revision.${to.toLowerCase()}`,
      entityType: 'commercial_proposal_revision', entityId: revisionId, metadata: {},
    }, request.headers);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ ok: false,
      error: safeGovernedError((error as Error).message) }, { status: 422 });
  }
}
