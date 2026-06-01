/**
 * Accounts Payable / Receivable selectors.
 *
 * Single source of truth: the APAR titles held in finance-store
 * (getAPARTitles). These selectors derive all summary KPIs and aging
 * buckets so the UI never computes AP/AR numbers inline.
 *
 * "Today" is anchored to FINANCE_TODAY (the same reference date the rest of
 * the finance module uses for the 2026 mock dataset) and is injectable so a
 * future real dataset can pass the actual current date.
 */

import type { APARTitle, APARType } from '@/lib/types/finance';

/** Reference "today" for the 2026 mock dataset (matches contracts selector). */
export const FINANCE_TODAY = '2026-04-30';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseDate(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getTime();
}

/** Remaining (unsettled) amount in cents for a title. */
export function remainingCents(t: APARTitle): number {
  return Math.max(0, t.amount_cents - t.paid_amount_cents);
}

/** Days a title is overdue relative to `today` (negative = not yet due). */
export function daysOverdue(t: APARTitle, today: string = FINANCE_TODAY): number {
  return Math.floor((parseDate(today) - parseDate(t.due_date)) / MS_PER_DAY);
}

/** A title is effectively overdue if it has an unsettled balance past due. */
export function isOverdue(t: APARTitle, today: string = FINANCE_TODAY): boolean {
  if (t.status === 'paid' || t.status === 'cancelled') return false;
  return remainingCents(t) > 0 && daysOverdue(t, today) > 0;
}

const isActive = (t: APARTitle) => t.status !== 'paid' && t.status !== 'cancelled';

// ── Summary KPIs ───────────────────────────────────────────────────

export interface AparSummary {
  /** Open balance owed to suppliers (cents). */
  totalPayable: number;
  /** Open balance owed by customers (cents). */
  totalReceivable: number;
  /** Cash already paid out against payables (cents). */
  paidTotal: number;
  /** Cash already received against receivables (cents). */
  receivedTotal: number;
  /** Open + partial unsettled balance, both flows (cents). */
  pendingTotal: number;
  /** Unsettled balance past due, both flows (cents). */
  overdueTotal: number;
  /** Unsettled balance due within the next 7 days, not yet overdue (cents). */
  dueThisWeek: number;
  /** Unsettled balance due within the next 30 days, not yet overdue (cents). */
  dueThisMonth: number;
  /** Net cash impact: receivable − payable (cents). */
  cashImpact: number;
  /** Count of active (open/partial/overdue) titles. */
  activeCount: number;
}

export function selectAparSummary(titles: APARTitle[], today: string = FINANCE_TODAY): AparSummary {
  let totalPayable = 0, totalReceivable = 0;
  let paidTotal = 0, receivedTotal = 0;
  let pendingTotal = 0, overdueTotal = 0;
  let dueThisWeek = 0, dueThisMonth = 0;
  let activeCount = 0;

  for (const t of titles) {
    const rem = remainingCents(t);

    if (t.type === 'payable') paidTotal += t.paid_amount_cents;
    else receivedTotal += t.paid_amount_cents;

    if (!isActive(t)) continue;
    activeCount += 1;
    pendingTotal += rem;

    if (t.type === 'payable') totalPayable += rem;
    else totalReceivable += rem;

    const d = daysOverdue(t, today);
    if (rem > 0 && d > 0) {
      overdueTotal += rem;
    } else if (rem > 0 && d <= 0) {
      const daysUntilDue = -d;
      if (daysUntilDue <= 7) dueThisWeek += rem;
      if (daysUntilDue <= 30) dueThisMonth += rem;
    }
  }

  return {
    totalPayable, totalReceivable, paidTotal, receivedTotal,
    pendingTotal, overdueTotal, dueThisWeek, dueThisMonth,
    cashImpact: totalReceivable - totalPayable,
    activeCount,
  };
}

// ── Aging buckets ──────────────────────────────────────────────────

export type AparAgingKey = 'not_due' | 'd1_7' | 'd8_15' | 'd16_30' | 'd31_plus';

export interface AparAgingBucket {
  key: AparAgingKey;
  label: string;
  payable: number;
  receivable: number;
  count: number;
}

const AGING_LABELS: Record<AparAgingKey, string> = {
  not_due: 'A vencer',
  d1_7: '1–7 dias',
  d8_15: '8–15 dias',
  d16_30: '16–30 dias',
  d31_plus: '31+ dias',
};

function bucketKeyFor(days: number): AparAgingKey {
  if (days <= 0) return 'not_due';
  if (days <= 7) return 'd1_7';
  if (days <= 15) return 'd8_15';
  if (days <= 30) return 'd16_30';
  return 'd31_plus';
}

export function selectAparAging(titles: APARTitle[], today: string = FINANCE_TODAY): AparAgingBucket[] {
  const order: AparAgingKey[] = ['not_due', 'd1_7', 'd8_15', 'd16_30', 'd31_plus'];
  const map = new Map<AparAgingKey, AparAgingBucket>(
    order.map(key => [key, { key, label: AGING_LABELS[key], payable: 0, receivable: 0, count: 0 }]),
  );

  for (const t of titles) {
    if (!isActive(t)) continue;
    const rem = remainingCents(t);
    if (rem <= 0) continue;
    const bucket = map.get(bucketKeyFor(daysOverdue(t, today)))!;
    if (t.type === 'payable') bucket.payable += rem;
    else bucket.receivable += rem;
    bucket.count += 1;
  }

  return order.map(k => map.get(k)!);
}

// ── Filtering helper ───────────────────────────────────────────────

export interface AparFilter {
  type?: APARType | 'all';
  status?: string;
  entityId?: string;       // supplier_id or client_id
  contractId?: string;
  projectId?: string;
  dateField?: 'due_date' | 'issue_date';
  dateFrom?: string;
  dateTo?: string;
  /** Only titles effectively overdue. */
  overdueOnly?: boolean;
}

export function filterAparTitles(titles: APARTitle[], f: AparFilter, today: string = FINANCE_TODAY): APARTitle[] {
  return titles.filter(t => {
    if (f.type && f.type !== 'all' && t.type !== f.type) return false;
    if (f.status && t.status !== f.status) return false;
    if (f.entityId && t.supplier_id !== f.entityId && t.client_id !== f.entityId) return false;
    if (f.contractId && t.contract_id !== f.contractId) return false;
    if (f.projectId && t.project_id !== f.projectId) return false;
    if (f.overdueOnly && !isOverdue(t, today)) return false;
    const field = f.dateField ?? 'due_date';
    const value = t[field] || '';
    if (f.dateFrom && value < f.dateFrom) return false;
    if (f.dateTo && value > f.dateTo) return false;
    return true;
  });
}

/** Sort titles by due date (asc by default). */
export function sortByDueDate(titles: APARTitle[], dir: 'asc' | 'desc' = 'asc'): APARTitle[] {
  return [...titles].sort((a, b) =>
    dir === 'asc' ? a.due_date.localeCompare(b.due_date) : b.due_date.localeCompare(a.due_date),
  );
}
