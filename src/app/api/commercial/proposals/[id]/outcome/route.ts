import { NextResponse } from 'next/server';
import { logAuditEventServer } from '@/lib/audit/log-audit-event-server';
import { requireCommercialSession, isSessionError, safeGovernedError } from '@/lib/commercial/server-session';
import { recordProposalContextOutcome, recordProposalOutcome } from '@/lib/commercial/engagement-service';
import { governingOf } from '@/lib/commercial/proposal-context';
import { isMissingFunction, loadContextMembers, loadProposal } from '@/lib/commercial/proposal-context-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OUTCOMES = ['ACCEPTED', 'REJECTED', 'EXPIRED'] as const;
type Outcome = (typeof OUTCOMES)[number];

/**
 * Registra a manifestação do CLIENTE sobre uma revisão de proposta.
 *
 * O verbo é "registrar", não "aceitar": quem aceita é o cliente, fora daqui.
 * A permissão `commercial.proposals.record_acceptance` é separada de
 * `commercial.proposals.manage` porque são dois poderes — escrever a proposta
 * e afirmar o que o cliente respondeu.
 *
 * Não existe caminho de IA nem de integração para esta rota sem ator: a
 * sessão exige usuário autenticado e a função governada recusa ator nulo.
 *
 * ─── Sobre o nome do segmento ────────────────────────────────────────────
 *
 * A pasta chama-se `[id]` e o valor é um id de REVISÃO. O Next.js exige um
 * único nome de slug por nível, e o dossiê da proposta (`proposals/[id]`)
 * ocupa o mesmo nível — duas grafias ali derrubam o build inteiro, não só
 * estas duas rotas. A URL pública não mudou; só a pasta. O `as` abaixo
 * devolve o nome correto ao valor, para que o resto da função continue
 * dizendo o que ele é.
 *
 * ─── O PACOTE (217) ──────────────────────────────────────────────────────
 *
 * PT + PC são uma proposta: o cliente responde ao PACOTE. A revisão informada
 * identifica o contexto; a resposta vale para a revisão regente de CADA
 * documento, numa transação, e o aceite grava QUAL pacote exato foi aceito.
 * Aceitar exige o pacote inteiro com o cliente — nada de aceite de metade.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireCommercialSession(['commercial.proposals.record_acceptance']);
  if (isSessionError(session)) return session.error;
  const { id: revisionId } = await context.params;

  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok: false, error: 'Corpo inválido.' }, { status: 400 }); }

  const outcome = String(body.outcome ?? '') as Outcome;
  if (!OUTCOMES.includes(outcome)) {
    return NextResponse.json({ ok: false,
      error: `Resultado inválido. Use um de: ${OUTCOMES.join(', ')}.` }, { status: 400 });
  }
  if (outcome === 'ACCEPTED' && !String(body.acceptanceSource ?? '').trim()) {
    return NextResponse.json({ ok: false,
      error: 'Aceite exige dizer COMO o cliente se manifestou (documento assinado, e-mail, portal, pedido…).' },
      { status: 400 });
  }

  const payload = {
    acceptance_source: body.acceptanceSource ?? null,
    acceptance_document_id: body.acceptanceDocumentId ?? null,
    acceptance_external_ref: body.acceptanceExternalRef ?? null,
    acceptance_note: body.acceptanceNote ?? null,
    rejection_reason: body.rejectionReason ?? null,
  };
  try {
    const { data: revisionRow } = await session.supabase.from('commercial_proposal_revisions')
      .select('id,proposal_id').eq('organization_id', session.organizationId).eq('id', revisionId).maybeSingle();
    const proposalId = (revisionRow as { proposal_id?: string } | null)?.proposal_id;
    if (!proposalId) {
      return NextResponse.json({ ok: false, error: 'Revisão não encontrada.' }, { status: 404 });
    }
    let result: Record<string, unknown>;
    try {
      result = await recordProposalContextOutcome(session.organizationId, session.user.id, proposalId, outcome, payload);
    } catch (error) {
      if (!isMissingFunction(error)) throw error;
      /*
        Banco sem a 217: o mesmo ato, documento a documento, pelo contexto
        derivado — com a MESMA regra de pacote: aceitar exige todos com o
        cliente; recusa/expiração alcançam os que estão com o cliente.
      */
      const proposal = await loadProposal(session, proposalId);
      const members = proposal ? await loadContextMembers(session, proposal) : [];
      const { data } = await session.supabase.from('commercial_proposal_revisions')
        .select('id,proposal_id,revision,status').eq('organization_id', session.organizationId)
        .in('proposal_id', members.map((m) => m.id));
      const rows = (data ?? []) as Array<{ id: string; proposal_id: string; revision: number; status: string }>;
      const current = members.map((m) => ({ m, r: governingOf(rows.filter((r) => r.proposal_id === m.id)) }));
      if (outcome === 'ACCEPTED') {
        const behind = current.find(({ r }) => r && r.status !== 'ACCEPTED' && !['SENT', 'NEGOTIATION'].includes(r.status));
        if (behind) {
          throw new Error(`Pacote: ${behind.m.proposal_number} R${String(behind.r!.revision).padStart(2, '0')} está em ${behind.r!.status} — o cliente só aceita o pacote que recebeu.`);
        }
      }
      const moved = [];
      for (const { m, r } of current) {
        if (!r || !['SENT', 'NEGOTIATION'].includes(r.status)) continue;
        await recordProposalOutcome(session.organizationId, session.user.id, r.id, outcome, payload);
        moved.push({ proposal_id: m.id, revision_id: r.id, revision: r.revision, kind: m.kind });
      }
      if (!moved.length) throw new Error(`Pacote: nenhum documento com o cliente pode receber ${outcome}.`);
      result = { status: outcome, moved, acceptance: null };
    }
    await logAuditEventServer({
      organizationId: session.organizationId,
      action: `commercial.proposal_context.${outcome.toLowerCase()}`,
      entityType: 'commercial_proposal', entityId: proposalId,
      metadata: {
        acceptanceSource: body.acceptanceSource ?? null,
        acceptanceExternalRef: body.acceptanceExternalRef ?? null,
        revisions: ((result.moved ?? []) as Array<{ revision_id: string }>).map((m) => m.revision_id),
        acceptanceId: (result.acceptance as { id?: string } | null)?.id ?? null,
      },
    }, request.headers);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ ok: false,
      error: safeGovernedError((error as Error).message) }, { status: 422 });
  }
}
