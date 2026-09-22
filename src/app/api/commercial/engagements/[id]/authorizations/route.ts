import { NextResponse } from 'next/server';
import { logAuditEventServer } from '@/lib/audit/log-audit-event-server';
import { requireCommercialSession, isSessionError, safeGovernedError } from '@/lib/commercial/server-session';
import { attachAuthorization } from '@/lib/commercial/engagement-service';
import type { AuthorizationSourceKind } from '@/lib/commercial/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KINDS: AuthorizationSourceKind[] =
  ['formal_contract', 'accepted_proposal', 'customer_po', 'customer_authorization'];

/**
 * Anexa uma fonte de autorização ao MESMO trabalho autorizado.
 *
 * É esta rota que o cenário do contrato tardio usa: o contrato entra no
 * engajamento que já existe, é COMPARADO com a fonte regente, e as
 * divergências ficam abertas. Ele NÃO passa a reger por ter chegado — para
 * isso existe `PUT /governing`, que exige motivo escrito. A resposta devolve
 * `governing` e `divergencesOpened` justamente para a tela poder dizer, sem
 * rodeio, que nada foi sobrescrito.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireCommercialSession(['commercial.engagements.manage']);
  if (isSessionError(session)) return session.error;
  const { id } = await context.params;

  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok: false, error: 'Corpo inválido.' }, { status: 400 }); }

  const sourceKind = String(body.sourceKind ?? '') as AuthorizationSourceKind;
  if (!KINDS.includes(sourceKind)) {
    return NextResponse.json({ ok: false,
      error: `Fonte de autorização inválida. Use uma de: ${KINDS.join(', ')}.` }, { status: 400 });
  }

  try {
    const result = await attachAuthorization(session.organizationId, session.user.id, id, {
      sourceKind,
      contractId: body.contractId ? String(body.contractId) : null,
      proposalRevisionId: body.proposalRevisionId ? String(body.proposalRevisionId) : null,
      documentId: body.documentId ? String(body.documentId) : null,
      externalReference: body.externalReference ? String(body.externalReference) : null,
      authorizedValue: body.authorizedValue === null || body.authorizedValue === undefined
        ? null : Number(body.authorizedValue),
      currency: body.currency ? String(body.currency) : null,
      effectiveFrom: body.effectiveFrom ? String(body.effectiveFrom) : null,
      effectiveUntil: body.effectiveUntil ? String(body.effectiveUntil) : null,
      note: body.note ? String(body.note) : null,
    });

    await logAuditEventServer({
      organizationId: session.organizationId,
      action: 'commercial.engagement.authorization_attached',
      entityType: 'commercial_engagement', entityId: id,
      metadata: { sourceKind, governing: result.governing, divergences: result.divergences_opened },
    }, request.headers);

    return NextResponse.json({ ok: true,
      authorizationId: result.authorization_id,
      governing: result.governing,
      divergencesOpened: result.divergences_opened,
      // Mensagem explícita: o silêncio aqui é que produziria a impressão de
      // que o documento novo passou a mandar.
      note: result.governing
        ? 'Esta é a primeira fonte ativa: ela passa a reger o trabalho.'
        : 'A fonte regente NÃO mudou. Para trocá-la, use a ação de definir fonte regente.' });
  } catch (error) {
    return NextResponse.json({ ok: false,
      error: safeGovernedError((error as Error).message) }, { status: 422 });
  }
}
