import { NextResponse } from 'next/server';
import { z } from 'zod';
import { logAuditEventServer } from '@/lib/audit/log-audit-event-server';
import { requireOperationsSession, isSessionError, safeOperationsError, hasOptionalPermission } from '@/lib/operations/session';
import { getServiceOrderWorkspace } from '@/lib/operations/service-orders/read-model';
import { canIssueNormally, canIssueWithException } from '@/lib/operations/service-orders/next-action';
import { compareWithGoverning, updateDraft } from '@/lib/operations/service-orders/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** O workspace da OS — cabeçalho, pacote, conteúdo, divergências, projeto e história. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireOperationsSession(['operations.view']);
  if (isSessionError(session)) return session.error;
  const { id } = await context.params;
  const workspace = await getServiceOrderWorkspace(session, id);
  if (!workspace) return NextResponse.json({ ok: false, error: 'Ordem de serviço não encontrada.' }, { status: 404 });
  const [canManage, canOverride, canBind, canIngest, canResolve] = await Promise.all([
    hasOptionalPermission(session, 'commercial.service_orders.manage'),
    hasOptionalPermission(session, 'operations.service_orders.override'),
    hasOptionalPermission(session, 'commercial.service_orders.bind_project'),
    hasOptionalPermission(session, 'commercial.documents.ingest'),
    hasOptionalPermission(session, 'commercial.divergences.resolve'),
  ]);
  const { status } = workspace.order;
  return NextResponse.json({ ok: true, ...workspace, capabilities: {
    manage: canManage, override: canOverride, bindProject: canBind, ingest: canIngest,
    resolveDivergences: canResolve,
    issueNormally: canManage && canIssueNormally(status, workspace.counts),
    issueWithException: canManage && canOverride && canIssueWithException(status, workspace.counts),
  } });
}

const draftSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  scopeSummary: z.string().trim().max(4000).nullable().optional(),
  siteLabel: z.string().trim().max(300).nullable().optional(),
  plannedStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  plannedFinish: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  authorizedValue: z.number().nonnegative().nullable().optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
});

const KEYS: Record<string, string> = {
  title: 'title', scopeSummary: 'scope_summary', siteLabel: 'site_label', plannedStart: 'planned_start',
  plannedFinish: 'planned_finish', authorizedValue: 'authorized_value', currency: 'currency', notes: 'notes',
};

/** Editar o RASCUNHO. OS emitida muda por emenda — o banco recusa aqui. */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireOperationsSession(['commercial.service_orders.manage']);
  if (isSessionError(session)) return session.error;
  const { id } = await context.params;
  const parsed = draftSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Campos inválidos.' }, { status: 400 });
  const payload: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed.data)) if (v !== undefined) payload[KEYS[k]] = v;
  if (!Object.keys(payload).length) return NextResponse.json({ ok: false, error: 'Nada a alterar.' }, { status: 400 });
  try {
    await updateDraft(session.organizationId, session.user.id, id, payload);
    const comparison = await compareWithGoverning(session.organizationId, id);
    await logAuditEventServer({ organizationId: session.organizationId, action: 'operations.service_order.draft_edited',
      entityType: 'internal_service_order', entityId: id, metadata: { fields: Object.keys(payload) } }, request.headers);
    return NextResponse.json({ ok: true, divergencesOpened: comparison.divergences_opened ?? 0 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: safeOperationsError((error as Error).message) }, { status: 422 });
  }
}
