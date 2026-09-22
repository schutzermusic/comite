import { NextResponse } from 'next/server';
import { logAuditEventServer } from '@/lib/audit/log-audit-event-server';
import { requireCommercialSession, isSessionError, safeGovernedError } from '@/lib/commercial/server-session';
import { createEngagement } from '@/lib/commercial/engagement-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * A Carteira consolidada: TODO trabalho autorizado, seja qual for a fonte.
 *
 * Leitura pelo cliente AUTENTICADO — quem decide o que aparece é a policy
 * `ce_select`, não este filtro. O `.eq('organization_id', …)` é defesa em
 * profundidade sobre a mesma fronteira.
 */
export async function GET() {
  const session = await requireCommercialSession(['contracts.view']);
  if (isSessionError(session)) return session.error;

  const { data, error } = await session.supabase
    .from('commercial_engagements')
    .select('id,engagement_number,title,counterparty_name,currency,authorized_value,'
      + 'status,origin,authorized_at,owner_user_id,created_at')
    .eq('organization_id', session.organizationId)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) {
    return NextResponse.json({ ok: false, error: 'Não foi possível consultar a carteira.' }, { status: 500 });
  }

  const { data: authorizations } = await session.supabase
    .from('commercial_engagement_authorizations')
    .select('id,engagement_id,source_kind,contract_id,proposal_revision_id,document_id,'
      + 'external_reference,authorized_value,currency,governing,state')
    .eq('organization_id', session.organizationId)
    .eq('state', 'ACTIVE');

  return NextResponse.json({ ok: true, engagements: data ?? [], authorizations: authorizations ?? [] });
}

/**
 * "+ Adicionar → Criar manualmente" e as demais portas de entrada.
 *
 * O que nasce aqui é SEMPRE `UNDER_ANALYSIS`: o payload não tem campo de
 * status, e a função governada ignora qualquer tentativa de informá-lo. Uma
 * entrada nova não pode mexer em valor autorizado nem em backlog no instante
 * do cadastro.
 */
export async function POST(request: Request) {
  const session = await requireCommercialSession(['commercial.engagements.manage']);
  if (isSessionError(session)) return session.error;

  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok: false, error: 'Corpo inválido.' }, { status: 400 }); }

  const title = String(body.title ?? '').trim();
  const counterpartyName = String(body.counterpartyName ?? '').trim();
  if (!title || !counterpartyName) {
    return NextResponse.json({ ok: false,
      error: 'Título e contraparte são obrigatórios.' }, { status: 400 });
  }

  try {
    const id = await createEngagement(session.organizationId, session.user.id, {
      title,
      counterpartyName,
      counterpartyPartyId: body.counterpartyPartyId ? String(body.counterpartyPartyId) : null,
      currency: body.currency ? String(body.currency) : 'BRL',
      origin: (body.origin as CreateOrigin) ?? 'manual',
      engagementNumber: body.engagementNumber ? String(body.engagementNumber) : null,
      notes: body.notes ? String(body.notes) : null,
    });
    await logAuditEventServer({
      organizationId: session.organizationId,
      action: 'commercial.engagement.created',
      entityType: 'commercial_engagement',
      entityId: id,
      metadata: { origin: body.origin ?? 'manual', status: 'UNDER_ANALYSIS' },
    }, request.headers);
    return NextResponse.json({ ok: true, engagementId: id, status: 'UNDER_ANALYSIS' });
  } catch (error) {
    return NextResponse.json({ ok: false,
      error: safeGovernedError((error as Error).message) }, { status: 422 });
  }
}

type CreateOrigin = 'formal_contract' | 'accepted_proposal' | 'customer_po'
  | 'customer_authorization' | 'manual';
