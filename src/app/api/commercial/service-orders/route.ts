import { NextResponse } from 'next/server';
import { logAuditEventServer } from '@/lib/audit/log-audit-event-server';
import { requireCommercialSession, isSessionError, safeGovernedError } from '@/lib/commercial/server-session';
import { createServiceOrder, compareServiceOrder } from '@/lib/commercial/engagement-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ORIGINS = ['from_accepted_proposal', 'manual', 'uploaded_document'] as const;
type Origin = (typeof ORIGINS)[number];

export async function GET(request: Request) {
  const session = await requireCommercialSession(['contracts.view']);
  if (isSessionError(session)) return session.error;
  const engagementId = new URL(request.url).searchParams.get('engagementId');

  let query = session.supabase.from('internal_service_orders')
    .select('id,engagement_id,os_number,title,origin,status,authorized_value,currency,'
      + 'scope_summary,planned_start,planned_finish,project_id,source_proposal_revision_id,'
      + 'document_id,issued_at,created_at')
    .eq('organization_id', session.organizationId)
    .order('created_at', { ascending: false })
    .limit(200);
  if (engagementId) query = query.eq('engagement_id', engagementId);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ ok: false,
      error: 'Não foi possível consultar as ordens de serviço.' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, serviceOrders: data ?? [] });
}

/**
 * Cria a OS interna — das três formas que o escopo pede.
 *
 * A OS nasce sempre em `DRAFT`. O confronto com a fonte regente roda LOGO em
 * seguida, na mesma requisição, porque descobrir uma divergência só na hora
 * de emitir é descobrir tarde: quem criou a OS já saiu da tela. Se o confronto
 * abre divergência, a função governada move a OS para
 * `PENDING_CONFIRMATION` — e a resposta diz isso.
 */
export async function POST(request: Request) {
  const session = await requireCommercialSession(['commercial.service_orders.manage']);
  if (isSessionError(session)) return session.error;

  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok: false, error: 'Corpo inválido.' }, { status: 400 }); }

  const engagementId = String(body.engagementId ?? '').trim();
  const origin = String(body.origin ?? '') as Origin;
  const osNumber = String(body.osNumber ?? '').trim();
  const title = String(body.title ?? '').trim();
  if (!engagementId || !ORIGINS.includes(origin) || !osNumber || !title) {
    return NextResponse.json({ ok: false,
      error: 'Informe o trabalho autorizado, a origem, o número e o título da OS.' }, { status: 400 });
  }

  try {
    const created = await createServiceOrder(session.organizationId, session.user.id, engagementId, {
      origin, osNumber, title,
      sourceProposalRevisionId: body.sourceProposalRevisionId ? String(body.sourceProposalRevisionId) : null,
      documentId: body.documentId ? String(body.documentId) : null,
      intakeId: body.intakeId ? String(body.intakeId) : null,
      authorizedValue: body.authorizedValue === null || body.authorizedValue === undefined
        ? null : Number(body.authorizedValue),
      currency: body.currency ? String(body.currency) : null,
      scopeSummary: body.scopeSummary ? String(body.scopeSummary) : null,
      plannedStart: body.plannedStart ? String(body.plannedStart) : null,
      plannedFinish: body.plannedFinish ? String(body.plannedFinish) : null,
      responsibleUserId: body.responsibleUserId ? String(body.responsibleUserId) : null,
      notes: body.notes ? String(body.notes) : null,
    });

    const comparison = await compareServiceOrder(
      session.organizationId, created.service_order_id);

    await logAuditEventServer({
      organizationId: session.organizationId,
      action: 'commercial.service_order.created',
      entityType: 'internal_service_order', entityId: created.service_order_id,
      metadata: { origin, osNumber, divergences: comparison.divergences_opened ?? 0 },
    }, request.headers);

    return NextResponse.json({ ok: true,
      serviceOrderId: created.service_order_id,
      divergencesOpened: comparison.divergences_opened ?? 0,
      comparedAgainst: comparison.reason ?? 'governing_source' });
  } catch (error) {
    return NextResponse.json({ ok: false,
      error: safeGovernedError((error as Error).message) }, { status: 422 });
  }
}
