import { NextResponse } from 'next/server';
import { resolvePayrollActor } from '@/lib/payroll/repository/actor';
import { getServerRepository } from '@/lib/payroll/repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/payroll/batches — list closing batches for the org.
 * ?approved=true returns only approved/sent_to_finance batches enriched with
 * headcount and cost-center summaries (for the Pessoas & Custos overview).
 */
export async function GET(req: Request) {
  const r = await resolvePayrollActor('people.payroll_close');
  if (!r.ok) return r.response;
  try {
    const { searchParams } = new URL(req.url);
    if (searchParams.get('approved') === 'true') {
      const batches = await getServerRepository().listApprovedBatches(r.actor);
      return NextResponse.json({ ok: true, batches });
    }
    const batches = await getServerRepository().listClosingBatches(r.actor);
    return NextResponse.json({ ok: true, batches });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Erro' }, { status: 500 });
  }
}

/** POST /api/payroll/batches — create a closing batch. */
export async function POST(req: Request) {
  const r = await resolvePayrollActor('people.payroll_close');
  if (!r.ok) return r.response;
  let body: { competence_month?: string; payment_deadline?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON inválido.' }, { status: 400 });
  }
  if (!body.competence_month) {
    return NextResponse.json({ ok: false, error: 'competence_month é obrigatório.' }, { status: 400 });
  }
  try {
    const batch = await getServerRepository().createClosingBatch(r.actor, {
      competence_month: body.competence_month,
      payment_deadline: body.payment_deadline,
    });
    return NextResponse.json({ ok: true, batch });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Erro' }, { status: 500 });
  }
}
