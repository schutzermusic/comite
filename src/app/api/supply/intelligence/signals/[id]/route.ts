import { NextResponse } from 'next/server';
import { z } from 'zod';
import { logAuditEventServer } from '@/lib/audit/log-audit-event-server';
import { requireAnyOperationsPermission, isSessionError, hasOptionalPermission } from '@/lib/operations/session';
import { createFollowupAsHuman } from '@/lib/platform/followups/session';
import type { FollowupSourceKind } from '@/lib/platform/followups/types';
import { inventoryFailure } from '@/lib/supply/inventory-route';
import { inventoryAct } from '@/lib/supply/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('execute'), quantity: z.coerce.number().positive().optional(),
    locationId: z.string().uuid().optional(), note: z.string().trim().max(500).optional() }),
  z.object({ action: z.literal('dismiss'), note: z.string().trim().min(3).max(500) }),
  z.object({ action: z.literal('follow_up'), responsibleUserId: z.string().uuid().nullish(),
    responsibleText: z.string().trim().max(200).nullish(), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
    goal: z.string().trim().min(3).max(500).optional() })
    .refine((f) => f.responsibleUserId || (f.responsibleText ?? '').length > 1, 'Diga quem responde pelo acompanhamento.'),
]);

/** Ação humana sobre a recomendação: executar o ato governado, descartar com motivo, ou abrir acompanhamento. */
const PERMISSION: Record<string, string[]> = {
  RESERVE: ['inventory.reserve'], TRANSFER: ['inventory.manage', 'inventory.reserve'], REQUISITION: ['procurement.request'],
};
/** Quem DECIDE sobre uma recomendação (descartar, acompanhar): o mesmo conjunto que o banco reconfere. */
const DECIDERS = ['supply.plan', 'inventory.reserve', 'inventory.manage', 'procurement.request', 'procurement.source', 'receiving.receive'];

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireAnyOperationsPermission(['supply.view', 'procurement.view', 'inventory.view', 'receiving.view', 'projects.view']);
  if (isSessionError(session)) return session.error;
  const { id } = await context.params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Pedido inválido.' }, { status: 400 });
  const { data: signal } = await session.supabase.from('supply_signals')
    .select('id,status,title,project_id,requirement_id,purchase_order_id,recommended_action,followup_id')
    .eq('organization_id', session.organizationId).eq('id', id)
    .maybeSingle<{ id: string; status: string; title: string; project_id: string | null; requirement_id: string | null;
      purchase_order_id: string | null; recommended_action: { kind: string; payload: Record<string, unknown> };
      followup_id: string | null }>();
  if (!signal) return NextResponse.json({ ok: false, error: 'Recomendação não encontrada.' }, { status: 404 });
  const input = parsed.data;
  if (input.action !== 'execute') {
    // Antes de qualquer escrita: o acompanhamento nasceria órfão se o vínculo fosse recusado depois.
    const decides = (await Promise.all(DECIDERS.map((k) => hasOptionalPermission(session, k)))).some(Boolean);
    if (!decides) {
      return NextResponse.json({ ok: false, error: 'Seu perfil não tem alçada para decidir recomendações de Supply.', code: 'FORBIDDEN' },
        { status: 403 });
    }
  }

  try {
    let out: Record<string, unknown>;
    if (input.action === 'execute') {
      const needed = PERMISSION[signal.recommended_action.kind];
      if (!needed) return NextResponse.json({ ok: false, error: 'Esta recomendação não é um ato executável: acompanhe ou abra o registro.' }, { status: 400 });
      const allowed = (await Promise.all(needed.map((k) => hasOptionalPermission(session, k)))).some(Boolean);
      if (!allowed) return NextResponse.json({ ok: false, error: `Esta ação exige: ${needed.join(' ou ')}.` }, { status: 403 });
      out = await inventoryAct('supply_signal_execute', session.organizationId, session.user.id, { p_signal_id: id,
        p_overrides: { quantity: input.quantity ?? null, location_id: input.locationId ?? null, note: input.note ?? null } });
    } else if (input.action === 'dismiss') {
      out = await inventoryAct('supply_signal_dismiss', session.organizationId, session.user.id, { p_signal_id: id, p_note: input.note });
    } else {
      // Acompanhamento do Apex (156): a origem é o registro durável, não o sinal passageiro.
      const payload = signal.recommended_action.payload ?? {};
      const sourceKind = (payload.source_kind as FollowupSourceKind | undefined)
        ?? (signal.purchase_order_id ? 'purchase_order' : 'project_requirement');
      const sourceId = String(payload.source_id ?? signal.purchase_order_id ?? signal.requirement_id ?? '');
      if (!sourceId) return NextResponse.json({ ok: false, error: 'Recomendação sem registro de origem para acompanhar.' }, { status: 400 });
      if (signal.followup_id) {
        return NextResponse.json({ ok: true, result: { signal_id: id, followup_id: signal.followup_id, replayed: true } });
      }
      // Chave determinística: repetir o pedido (ou retomar depois de uma falha no vínculo) reencontra o MESMO acompanhamento.
      const followup = await createFollowupAsHuman(`supply-signal:${id}:follow-up`, {
        sourceKind, sourceId, goal: input.goal ?? String(payload.goal ?? signal.title),
        responsibleUserId: input.responsibleUserId ?? null, responsibleText: input.responsibleText ?? null,
        dueDate: input.dueDate ?? (payload.due_date as string | undefined) ?? null, cadenceDays: 2, escalateAfterDays: 5,
      });
      out = await inventoryAct('supply_signal_link_followup', session.organizationId, session.user.id,
        { p_signal_id: id, p_followup_id: followup.id });
    }
    await logAuditEventServer({ organizationId: session.organizationId, action: `supply.signal.${input.action}`,
      entityType: 'supply_signal', entityId: id, metadata: { kind: signal.recommended_action.kind } }, request.headers);
    return NextResponse.json({ ok: true, result: out });
  } catch (error) {
    return inventoryFailure(error);
  }
}
