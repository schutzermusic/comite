import { NextResponse } from 'next/server';
import { resolvePayrollActor } from '@/lib/payroll/repository/actor';
import { requireApiPermission } from '@/lib/auth/api-guard';
import { getServerRepository } from '@/lib/payroll/repository';
import { batchActionRules } from '@/lib/payroll/batch-actions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/payroll/batches/[id] — batch + attachments + dispatches. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await resolvePayrollActor('people.payroll_close');
  if (!r.ok) return r.response;
  try {
    const repo = getServerRepository();
    const batch = await repo.getClosingBatch(r.actor, id);
    if (!batch) return NextResponse.json({ ok: false, error: 'Não encontrado.' }, { status: 404 });
    const [attachments, dispatches] = await Promise.all([
      repo.getAttachments(r.actor, id),
      repo.getDispatches(r.actor, id),
    ]);
    return NextResponse.json({ ok: true, batch, attachments, dispatches });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Erro' }, { status: 500 });
  }
}

/**
 * DELETE /api/payroll/batches/[id] — HARD delete (child rows + Storage + batch).
 * Re-validates the status rule and requires people.payroll_delete (admins
 * bypass). Blocked when a finance batch exists or the closing is posted.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await resolvePayrollActor('people.payroll_close');
  if (!r.ok) return r.response;
  try {
    const repo = getServerRepository();
    const batch = await repo.getClosingBatch(r.actor, id);
    if (!batch) return NextResponse.json({ ok: false, error: 'Não encontrado.' }, { status: 404 });
    const rule = batchActionRules(batch.status, !!batch.finance_batch_id).delete;
    if (!rule.allowed) return NextResponse.json({ ok: false, error: rule.reason ?? 'Exclusão não permitida.' }, { status: 409 });
    const guard = await requireApiPermission(rule.permission, { allowAdmin: true });
    if (!guard.ok) return guard.response;
    const result = await repo.deleteClosingBatch(r.actor, id);
    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Erro' }, { status: 500 });
  }
}
