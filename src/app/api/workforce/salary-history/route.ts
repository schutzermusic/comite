import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { resolvePayrollActor } from '@/lib/payroll/repository/actor';
import {
  APPROVED_BATCH_STATUSES,
  buildSalaryHistory,
  type SalaryHistoryLine,
} from '@/lib/workforce/salary-history';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Histórico salarial por pessoa.
 *
 * Salário individual não é dado de `people.view`: a rota exige
 * `people.view_salary` (com `people.payroll_view_sensitive` como alternativa,
 * porque quem já vê a folha detalhada vê os mesmos valores). O cálculo roda no
 * servidor — mandar `payroll_employee_lines` cru para o browser seria despejar
 * a folha inteira no cliente para depois agregá-la lá.
 */
export async function GET() {
  const r = await resolvePayrollActor('people.view_salary');
  if (!r.ok) {
    const alt = await resolvePayrollActor('people.payroll_view_sensitive');
    if (!alt.ok) return r.response;
    return handle(alt.actor.organizationId);
  }
  return handle(r.actor.organizationId);
}

async function handle(organizationId: string) {
  const supabase = await createClient();

  const { data: batchRows, error: batchError } = await supabase
    .from('payroll_closing_batches')
    .select('id, competence_month')
    .eq('organization_id', organizationId)
    .in('status', [...APPROVED_BATCH_STATUSES])
    .order('competence_month', { ascending: true });

  if (batchError) {
    return NextResponse.json({ ok: false, error: batchError.message }, { status: 500 });
  }

  const batches = (batchRows ?? []).map((b) => ({
    id: String(b.id),
    competence_month: String(b.competence_month),
  }));

  if (batches.length === 0) {
    return NextResponse.json({
      ok: true,
      history: {
        competencesObserved: [],
        people: [],
        unmatched: [],
        counts: {
          peopleMatched: 0,
          peopleUnmatched: 0,
          withoutRaise12m: 0,
          raisedWithin12m: 0,
          indeterminate: 0,
        },
        notes: ['Nenhum lote de folha aprovado — sem série salarial para apurar.'],
      },
    });
  }

  // Paginado: um ano de folha de algumas centenas de pessoas passa fácil do
  // teto padrão de 1000 linhas do PostgREST, e uma série truncada em silêncio
  // viraria "reajuste" onde só houve corte de página.
  const lines: SalaryHistoryLine[] = [];
  const batchIds = batches.map((b) => b.id);
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from('payroll_employee_lines')
      .select('batch_id, employee_name, cost_center_label, contract_type, gross_amount_cents, net_amount_cents')
      .in('batch_id', batchIds)
      .order('batch_id', { ascending: true })
      .order('employee_name', { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    const rows = (data ?? []) as SalaryHistoryLine[];
    lines.push(...rows);
    if (rows.length < PAGE) break;
  }

  const { data: peopleRows } = await supabase
    .from('people')
    .select('id, full_name, payroll_name_key')
    .eq('organization_id', organizationId);

  const history = buildSalaryHistory({
    lines,
    batches,
    people: (peopleRows ?? []).map((p) => ({
      id: String(p.id),
      full_name: String(p.full_name),
      payroll_name_key: p.payroll_name_key ? String(p.payroll_name_key) : null,
    })),
  });

  return NextResponse.json({ ok: true, history });
}
