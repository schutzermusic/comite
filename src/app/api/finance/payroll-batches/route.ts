import { NextResponse } from 'next/server';
import { resolvePayrollActor } from '@/lib/payroll/repository/actor';
import { getServerRepository } from '@/lib/payroll/repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/finance/payroll-batches — persisted Finance `payroll_batch` rows.
 *
 * Lets Financeiro > Folha & Alocação read the real PayrollBatch records created
 * by the payroll-closing sendToFinance flow (and manual finance entry), so they
 * survive a reload / server restart instead of relying only on the in-memory
 * mirror. Read-only: never creates a LedgerEntry.
 *
 * ?period=YYYY-MM scopes to a single competence.
 */
export async function GET(req: Request) {
  const r = await resolvePayrollActor('finance.view');
  if (!r.ok) return r.response;
  try {
    const { searchParams } = new URL(req.url);
    const period = searchParams.get('period') ?? undefined;
    const batches = await getServerRepository().listFinancePayrollBatches(r.actor, { periodKey: period });
    return NextResponse.json({ ok: true, batches });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Erro' }, { status: 500 });
  }
}
