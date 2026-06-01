/**
 * Selectors for /financeiro/contratos-receita.
 *
 * Source of truth:
 *   - Contract reference table (src/data/finance/reference.ts) for non-monetary
 *     attributes (code, client, type, dates, total contracted value).
 *   - Ledger (mockLedgerEntries) for *measured* revenue (sum of revenue
 *     actuals grouped by contract_id).
 *   - APAR titles (mockAPARTitles) for *invoiced* / *received* / *delayedDays*.
 *
 * No monetary number is hard-coded here — every figure traces back to the
 * canonical ledger or AR titles.
 */

import type { FinanceKpi } from '../kpi';
import { fmtBRL, fmtCompactBRL, fmtPct } from '@/components/finance/shared';
import type { FinanceStatus } from '@/components/finance/shared';
import type { LedgerEntry, APARTitle } from '@/lib/types/finance';
import { mockLedgerEntries, mockAPARTitles } from '@/data/finance/mock-ledger';
import { managementCategories } from '@/data/finance/seed-categories';
import { contracts as contractRefs, type ContractRef, type ContractType } from '@/data/finance/reference';

export type { ContractType };

export const CONTRACT_TYPE_LABEL: Record<ContractType, string> = {
  recurring: 'Recorrente',
  fixed: 'Escopo Fechado',
  usage: 'Por Consumo',
};

// ── Public types (preserved for back-compat with the page) ─────────

export interface ContractTimelineEvent {
  date: string;
  event: string;
  amount?: number;
}

export interface ContractMock {
  id: string;
  code: string;
  client: string;
  type: ContractType;
  contracted: number;
  measured: number;
  invoiced: number;
  received: number;
  mrr: number;
  arr: number;
  start: string;
  end: string;
  status: FinanceStatus;
  delayedDays: number;
  timeline: ContractTimelineEvent[];
}

// ── Derivation ─────────────────────────────────────────────────────

function monthsBetween(startISO: string, endISO: string): number {
  const a = new Date(startISO);
  const b = new Date(endISO);
  return Math.max(1, (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) + 1);
}

function statusToFinanceStatus(s: ContractRef['status']): FinanceStatus {
  return s === 'at_risk' ? 'at_risk'
       : s === 'pending' ? 'pending'
       : s === 'completed' ? 'completed'
       : 'active';
}

function daysOverdue(due: string, today = new Date('2026-04-30')): number {
  const ms = today.getTime() - new Date(due).getTime();
  return Math.max(0, Math.floor(ms / (24 * 3600 * 1000)));
}

/**
 * Build the ContractMock[] consumed by the contracts dashboard. The shape
 * is preserved 1:1 so the existing page renders identically; only the data
 * source changed (ledger + APAR vs. inline numbers).
 */
export function selectContracts(
  refs: ContractRef[] = contractRefs,
  entries: LedgerEntry[] = mockLedgerEntries,
  titles: APARTitle[] = mockAPARTitles,
): ContractMock[] {
  // Index revenue actuals by contract_id
  const measuredByContract = new Map<string, number>();
  for (const e of entries) {
    if (!e.contract_id || e.entry_type !== 'actual' || e.status === 'void') continue;
    const cat = managementCategories.find(c => c.id === e.category_id);
    if (!cat || cat.group_key !== 'revenue') continue;
    const v = measuredByContract.get(e.contract_id) ?? 0;
    measuredByContract.set(e.contract_id, v + (e.amount_cents * cat.sign) / 100);
  }

  // Index AR aggregates by contract_id
  const invByContract = new Map<string, number>();
  const rcvByContract = new Map<string, number>();
  const lateByContract = new Map<string, number>();
  const titlesByContract = new Map<string, APARTitle[]>();

  for (const t of titles) {
    if (t.type !== 'receivable' || !t.contract_id) continue;
    invByContract.set(t.contract_id, (invByContract.get(t.contract_id) ?? 0) + t.amount_cents / 100);
    rcvByContract.set(t.contract_id, (rcvByContract.get(t.contract_id) ?? 0) + t.paid_amount_cents / 100);

    if (t.status === 'overdue' || (t.status === 'open' && daysOverdue(t.due_date) > 0)) {
      const d = daysOverdue(t.due_date);
      lateByContract.set(t.contract_id, Math.max(lateByContract.get(t.contract_id) ?? 0, d));
    }
    const list = titlesByContract.get(t.contract_id) ?? [];
    list.push(t);
    titlesByContract.set(t.contract_id, list);
  }

  return refs.map(r => {
    const contracted = r.total_value_cents / 100;
    const measured = measuredByContract.get(r.id) ?? 0;
    const invoiced = invByContract.get(r.id) ?? 0;
    const received = rcvByContract.get(r.id) ?? 0;
    const delayed = lateByContract.get(r.id) ?? 0;
    const mrr = r.mrr_cents / 100;
    const months = monthsBetween(r.start_date, r.end_date);
    const arr = r.type === 'recurring'
      ? mrr * 12
      : (contracted / months) * 12;

    const timeline: ContractTimelineEvent[] = [
      { date: r.start_date, event: 'Início de vigência' },
      ...(titlesByContract.get(r.id) ?? [])
        .sort((a, b) => a.issue_date.localeCompare(b.issue_date))
        .map(t => ({
          date: t.issue_date,
          event: t.paid_amount_cents > 0 ? `Recebido ${t.title_number}` : `Faturamento ${t.title_number}`,
          amount: t.amount_cents / 100,
        })),
    ];

    return {
      id: r.id,
      code: r.code,
      client: r.client_name,
      type: r.type,
      contracted,
      measured,
      invoiced,
      received,
      mrr,
      arr,
      start: r.start_date,
      end: r.end_date,
      status: statusToFinanceStatus(r.status),
      delayedDays: delayed,
      timeline,
    } satisfies ContractMock;
  });
}

/** Snapshot derived from the canonical ledger + AR titles + contract refs. */
export const CONTRACTS: ContractMock[] = selectContracts();

// ── KPI / chart selectors (kept identical) ─────────────────────────

export function buildContractsKpis(contracts: ContractMock[], asOf?: string): FinanceKpi[] {
  const totalInvoiced = contracts.reduce((a, c) => a + c.invoiced, 0);
  const totalReceived = contracts.reduce((a, c) => a + c.received, 0);
  const totalMeasured = contracts.reduce((a, c) => a + c.measured, 0);
  const totalContracted = contracts.reduce((a, c) => a + c.contracted, 0);
  const totalBacklog = totalContracted - totalMeasured;
  const delayed = contracts.filter((c) => c.delayedDays > 0).length;
  const totalArr = contracts.reduce((a, c) => a + c.arr, 0);
  const totalMrr = contracts.reduce((a, c) => a + c.mrr, 0);

  const delayedRows = contracts
    .filter((c) => c.delayedDays > 0)
    .map((c) => ({
      label: `${c.code} • ${c.client}`,
      value: c.delayedDays,
      formattedValue: `${c.delayedDays} dias`,
      tone: 'danger' as const,
    }));

  const arrByContract = contracts
    .map((c) => ({
      label: `${c.code} • ${c.client}`,
      value: c.arr,
      formattedValue: fmtCompactBRL(c.arr),
    }))
    .sort((a, b) => b.value - a.value);

  return [
    {
      id: 'arr', title: 'ARR contratado', value: totalArr, format: 'compactCurrency', tone: 'success', category: 'revenue',
      source: 'derived', helper: 'Recorrência anualizada',
      details: 'ARR agregado dos contratos. Recorrentes usam MRR×12; fixed/usage usam (contratado / meses) × 12. Tudo derivado do ledger + contratos.',
      drilldown: arrByContract, asOf,
    },
    {
      id: 'mrr', title: 'MRR ativo', value: totalMrr, format: 'compactCurrency', tone: 'success', category: 'revenue',
      source: 'derived', helper: 'Recorrência mensal',
      details: 'MRR agregado dos contratos recorrentes.', asOf,
    },
    {
      id: 'inv', title: 'Faturado', value: totalInvoiced, format: 'compactCurrency', tone: 'info', category: 'revenue',
      source: 'ledger', helper: 'Total faturado no período',
      details: 'Soma das AR (mockAPARTitles) por contrato. Substitui o cálculo inline.',
      asOf,
    },
    {
      id: 'rec', title: 'Recebido', value: totalReceived, format: 'compactCurrency', tone: 'info', category: 'cash',
      source: 'ledger', helper: 'Caixa efetivamente entrado',
      details: 'Soma de paid_amount_cents das AR por contrato.', asOf,
    },
    {
      id: 'bk', title: 'Backlog', value: totalBacklog, format: 'compactCurrency', tone: 'warning', category: 'contract',
      source: 'derived', helper: 'Contratado − Medido',
      details: 'Valor contratado ainda não convertido em receita reconhecida (ledger).', asOf,
    },
    {
      id: 'dl', title: 'Faturas atrasadas', value: delayed, format: 'number', tone: delayed > 0 ? 'danger' : 'success', category: 'risk',
      source: 'derived', helper: delayed > 0 ? 'Acionar cobrança' : 'Sem atrasos',
      details: 'Contratos com pelo menos uma AR overdue. Computado a partir dos títulos AR.',
      drilldown: delayedRows, asOf,
    },
  ];
}

export interface RecognitionFunnelStage {
  label: string;
  value: number;
  color: string;
}

export function buildRecognitionFunnel(contracts: ContractMock[]): RecognitionFunnelStage[] {
  const totalContracted = contracts.reduce((a, c) => a + c.contracted, 0);
  const totalMeasured = contracts.reduce((a, c) => a + c.measured, 0);
  const totalInvoiced = contracts.reduce((a, c) => a + c.invoiced, 0);
  const totalReceived = contracts.reduce((a, c) => a + c.received, 0);
  const totalBacklog = totalContracted - totalMeasured;
  return [
    { label: 'Contratado', value: totalContracted, color: 'bg-ig-info' },
    { label: 'Medido',     value: totalMeasured,   color: 'bg-ig-accent' },
    { label: 'Faturado',   value: totalInvoiced,   color: 'bg-emerald-400' },
    { label: 'Recebido',   value: totalReceived,   color: 'bg-ig-success' },
    { label: 'Backlog',    value: totalBacklog,    color: 'bg-ig-warning' },
  ];
}

export { fmtBRL, fmtCompactBRL, fmtPct };
