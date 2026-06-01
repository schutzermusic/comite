import { NextResponse } from 'next/server';
import { resolvePayrollActor } from '@/lib/payroll/repository/actor';
import { getServerRepository } from '@/lib/payroll/repository';

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
