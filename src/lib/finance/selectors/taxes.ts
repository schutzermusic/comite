/**
 * Tax obligation selectors.
 *
 * Source of truth: TaxObligation entities held in finance-store
 * (getTaxObligations). Settlement entries live in the ledger under
 * group_key='clearing' (cat-f31) and are intentionally excluded from the
 * managerial DRE — see [[finance-store.recordTaxPayment]].
 *
 * "Today" mirrors the AP/AR selector convention (FINANCE_TODAY = '2026-04-30')
 * so overdue / due-soon math is consistent across the Finance module.
 */

import type { TaxObligation, TaxStatus, TaxType } from '@/lib/types/finance';
import { FINANCE_TODAY } from './apar';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseDate(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getTime();
}

export function remainingTaxCents(t: TaxObligation): number {
  return Math.max(0, t.amount_cents - t.paid_amount_cents);
}

export function daysOverdueTax(t: TaxObligation, today: string = FINANCE_TODAY): number {
  return Math.floor((parseDate(today) - parseDate(t.due_date)) / MS_PER_DAY);
}

export function isTaxOverdue(t: TaxObligation, today: string = FINANCE_TODAY): boolean {
  if (t.status === 'paid' || t.status === 'cancelled') return false;
  return remainingTaxCents(t) > 0 && daysOverdueTax(t, today) > 0;
}

const isActive = (t: TaxObligation) => t.status !== 'paid' && t.status !== 'cancelled';

// ── Summary KPIs ───────────────────────────────────────────────────

export interface TaxSummary {
  /** Total amount obligated this scope (cents). */
  totalProvisioned: number;
  /** Amount already paid (cents). */
  totalPaid: number;
  /** Unsettled balance (cents). */
  totalOpen: number;
  /** Unsettled balance past due (cents). */
  overdueTotal: number;
  /** Unsettled balance due within next 7 days, not yet overdue (cents). */
  dueThisWeek: number;
  /** Unsettled balance due within next 30 days, not yet overdue (cents). */
  dueThisMonth: number;
  /** Count of active (open/scheduled/partial/overdue) obligations. */
  activeCount: number;
  /** Count of obligations effectively overdue. */
  overdueCount: number;
  /** Count fully paid. */
  paidCount: number;
}

export function selectTaxSummary(taxes: TaxObligation[], today: string = FINANCE_TODAY): TaxSummary {
  let totalProvisioned = 0, totalPaid = 0, totalOpen = 0;
  let overdueTotal = 0, dueThisWeek = 0, dueThisMonth = 0;
  let activeCount = 0, overdueCount = 0, paidCount = 0;

  for (const t of taxes) {
    totalProvisioned += t.amount_cents;
    totalPaid += t.paid_amount_cents;
    const rem = remainingTaxCents(t);
    totalOpen += rem;

    if (t.status === 'paid') paidCount += 1;
    if (!isActive(t)) continue;
    activeCount += 1;

    if (rem <= 0) continue;
    const d = daysOverdueTax(t, today);
    if (d > 0) {
      overdueTotal += rem;
      overdueCount += 1;
    } else {
      const until = -d;
      if (until <= 7) dueThisWeek += rem;
      if (until <= 30) dueThisMonth += rem;
    }
  }

  return { totalProvisioned, totalPaid, totalOpen, overdueTotal, dueThisWeek, dueThisMonth, activeCount, overdueCount, paidCount };
}

// ── Aging buckets ──────────────────────────────────────────────────

export type TaxAgingKey = 'not_due' | 'd1_7' | 'd8_15' | 'd16_30' | 'd31_plus';

export interface TaxAgingBucket {
  key: TaxAgingKey;
  label: string;
  amount: number;
  count: number;
}

const AGING_LABELS: Record<TaxAgingKey, string> = {
  not_due: 'A vencer',
  d1_7: '1–7 dias',
  d8_15: '8–15 dias',
  d16_30: '16–30 dias',
  d31_plus: '31+ dias',
};

function bucketKeyFor(days: number): TaxAgingKey {
  if (days <= 0) return 'not_due';
  if (days <= 7) return 'd1_7';
  if (days <= 15) return 'd8_15';
  if (days <= 30) return 'd16_30';
  return 'd31_plus';
}

export function selectTaxAging(taxes: TaxObligation[], today: string = FINANCE_TODAY): TaxAgingBucket[] {
  const order: TaxAgingKey[] = ['not_due', 'd1_7', 'd8_15', 'd16_30', 'd31_plus'];
  const map = new Map<TaxAgingKey, TaxAgingBucket>(
    order.map(key => [key, { key, label: AGING_LABELS[key], amount: 0, count: 0 }]),
  );

  for (const t of taxes) {
    if (!isActive(t)) continue;
    const rem = remainingTaxCents(t);
    if (rem <= 0) continue;
    const bucket = map.get(bucketKeyFor(daysOverdueTax(t, today)))!;
    bucket.amount += rem;
    bucket.count += 1;
  }
  return order.map(k => map.get(k)!);
}

// ── Roll-ups ───────────────────────────────────────────────────────

export interface TaxByTypeRow {
  tax_type: TaxType;
  provisioned: number;
  paid: number;
  open: number;
  count: number;
}

export function selectTaxesByType(taxes: TaxObligation[]): TaxByTypeRow[] {
  const map = new Map<TaxType, TaxByTypeRow>();
  for (const t of taxes) {
    const row = map.get(t.tax_type) ?? { tax_type: t.tax_type, provisioned: 0, paid: 0, open: 0, count: 0 };
    row.provisioned += t.amount_cents;
    row.paid += t.paid_amount_cents;
    row.open += remainingTaxCents(t);
    row.count += 1;
    map.set(t.tax_type, row);
  }
  return Array.from(map.values()).sort((a, b) => b.provisioned - a.provisioned);
}

export interface TaxByStatusRow {
  status: TaxStatus;
  amount: number;
  count: number;
}

export function selectTaxesByStatus(taxes: TaxObligation[]): TaxByStatusRow[] {
  const map = new Map<TaxStatus, TaxByStatusRow>();
  for (const t of taxes) {
    const row = map.get(t.status) ?? { status: t.status, amount: 0, count: 0 };
    row.amount += t.amount_cents;
    row.count += 1;
    map.set(t.status, row);
  }
  return Array.from(map.values()).sort((a, b) => b.amount - a.amount);
}

export interface TaxByCompetenceRow {
  competence_month: string;
  provisioned: number;
  paid: number;
  open: number;
  count: number;
}

export function selectTaxesByCompetence(taxes: TaxObligation[]): TaxByCompetenceRow[] {
  const map = new Map<string, TaxByCompetenceRow>();
  for (const t of taxes) {
    const row = map.get(t.competence_month) ?? { competence_month: t.competence_month, provisioned: 0, paid: 0, open: 0, count: 0 };
    row.provisioned += t.amount_cents;
    row.paid += t.paid_amount_cents;
    row.open += remainingTaxCents(t);
    row.count += 1;
    map.set(t.competence_month, row);
  }
  return Array.from(map.values()).sort((a, b) => a.competence_month.localeCompare(b.competence_month));
}

/** Projected tax cash-out by due-date month for unsettled obligations. */
export function selectProjectedTaxCashOut(taxes: TaxObligation[]): { month: string; amount: number; count: number }[] {
  const map = new Map<string, { month: string; amount: number; count: number }>();
  for (const t of taxes) {
    if (!isActive(t)) continue;
    const rem = remainingTaxCents(t);
    if (rem <= 0) continue;
    const month = t.due_date.slice(0, 7);
    const row = map.get(month) ?? { month, amount: 0, count: 0 };
    row.amount += rem;
    row.count += 1;
    map.set(month, row);
  }
  return Array.from(map.values()).sort((a, b) => a.month.localeCompare(b.month));
}

// ── Filtering / sorting helpers ────────────────────────────────────

export interface TaxFilter {
  taxType?: TaxType | 'all';
  status?: TaxStatus | 'all';
  competenceMonth?: string;
  dueFrom?: string;
  dueTo?: string;
  overdueOnly?: boolean;
}

export function filterTaxes(taxes: TaxObligation[], f: TaxFilter, today: string = FINANCE_TODAY): TaxObligation[] {
  return taxes.filter(t => {
    if (f.taxType && f.taxType !== 'all' && t.tax_type !== f.taxType) return false;
    if (f.status && f.status !== 'all' && t.status !== f.status) return false;
    if (f.competenceMonth && t.competence_month !== f.competenceMonth) return false;
    if (f.dueFrom && t.due_date < f.dueFrom) return false;
    if (f.dueTo && t.due_date > f.dueTo) return false;
    if (f.overdueOnly && !isTaxOverdue(t, today)) return false;
    return true;
  });
}

export function sortTaxesByDueDate(taxes: TaxObligation[], dir: 'asc' | 'desc' = 'asc'): TaxObligation[] {
  return [...taxes].sort((a, b) =>
    dir === 'asc' ? a.due_date.localeCompare(b.due_date) : b.due_date.localeCompare(a.due_date),
  );
}
