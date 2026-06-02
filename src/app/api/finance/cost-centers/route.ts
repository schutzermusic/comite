import { NextResponse } from 'next/server';
import { resolvePayrollActor } from '@/lib/payroll/repository/actor';
import { getServerRepository } from '@/lib/payroll/repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/finance/cost-centers — active Finance cost centers (uuid id) for the
 * org. Source for the payroll mapping dropdown in supabase mode, so saved
 * cost_center_id values are always valid uuids.
 */
export async function GET() {
  const r = await resolvePayrollActor('finance.view');
  if (!r.ok) return r.response;
  try {
    const costCenters = await getServerRepository().listFinanceCostCenters(r.actor);
    return NextResponse.json({ ok: true, costCenters });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Erro' }, { status: 500 });
  }
}

/** POST /api/finance/cost-centers — create a cost center ("Criar centro de custo"). */
export async function POST(req: Request) {
  const r = await resolvePayrollActor('finance.edit');
  if (!r.ok) return r.response;
  let body: { name?: string; code?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON inválido.' }, { status: 400 });
  }
  if (!body.name?.trim()) {
    return NextResponse.json({ ok: false, error: 'name é obrigatório.' }, { status: 400 });
  }
  try {
    const costCenter = await getServerRepository().createFinanceCostCenter(r.actor, { name: body.name, code: body.code });
    return NextResponse.json({ ok: true, costCenter });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Erro' }, { status: 500 });
  }
}
