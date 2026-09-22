import { NextResponse } from 'next/server';
import { logAuditEventServer } from '@/lib/audit/log-audit-event-server';
import { requireCommercialSession, isSessionError, safeGovernedError } from '@/lib/commercial/server-session';
import { recordProposalOutcome } from '@/lib/commercial/engagement-service';

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

  try {
    const result = await recordProposalOutcome(
      session.organizationId, session.user.id, revisionId, outcome, {
        acceptance_source: body.acceptanceSource ?? null,
        acceptance_document_id: body.acceptanceDocumentId ?? null,
        acceptance_external_ref: body.acceptanceExternalRef ?? null,
        acceptance_note: body.acceptanceNote ?? null,
        rejection_reason: body.rejectionReason ?? null,
      });
    await logAuditEventServer({
      organizationId: session.organizationId,
      action: `commercial.proposal_revision.${outcome.toLowerCase()}`,
      entityType: 'commercial_proposal_revision', entityId: revisionId,
      metadata: { acceptanceSource: body.acceptanceSource ?? null },
    }, request.headers);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ ok: false,
      error: safeGovernedError((error as Error).message) }, { status: 422 });
  }
}
