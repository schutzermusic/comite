/**
 * Cash-flow / treasury selectors.
 *
 * Settlement entries posted by AP/AR (recordAPARPayment) use the 'clearing'
 * management group and carry metadata.settlement_of, so they are excluded
 * from the managerial DRE. This module surfaces them for cash movement
 * analysis without touching the rest of the UI.
 *
 * Cash direction follows the clearing category sign (+1 in, −1 out) with a
 * metadata.apar_type fallback.
 */

import type { LedgerEntry } from '@/lib/types/finance';
import { mockLedgerEntries } from '@/data/finance/mock-ledger';
import { managementCategories } from '@/data/finance/seed-categories';

/** A ledger entry is a settlement/clearing cash leg if tagged as such. */
export function isSettlementEntry(e: LedgerEntry): boolean {
  if (e.metadata && typeof e.metadata === 'object' && 'settlement_of' in e.metadata) return true;
  const cat = managementCategories.find(c => c.id === e.category_id);
  return cat?.group_key === 'clearing';
}

export type CashDirection = 'in' | 'out';

/** Cash direction of a settlement entry: cash-in (receivable) vs cash-out (payable). */
export function cashDirection(e: LedgerEntry): CashDirection {
  const apar = e.metadata && typeof e.metadata === 'object' ? (e.metadata as Record<string, unknown>).apar_type : undefined;
  if (apar === 'receivable') return 'in';
  if (apar === 'payable') return 'out';
  const cat = managementCategories.find(c => c.id === e.category_id);
  return (cat?.sign ?? 1) >= 0 ? 'in' : 'out';
}

export interface CashFlowSummary {
  /** Total settlement cash-in (cents). */
  cashIn: number;
  /** Total settlement cash-out (cents). */
  cashOut: number;
  /** Net movement: cashIn − cashOut (cents). */
  net: number;
  /** Count of settlement entries. */
  count: number;
}

/** All settlement/clearing entries within an optional period range. */
export function selectCashMovements(
  entries: LedgerEntry[] = mockLedgerEntries,
  periodFrom?: string,
  periodTo?: string,
): LedgerEntry[] {
  return entries.filter(e => {
    if (e.status === 'void') return false;
    if (!isSettlementEntry(e)) return false;
    if (periodFrom && e.period_key < periodFrom) return false;
    if (periodTo && e.period_key > periodTo) return false;
    return true;
  });
}

export function selectCashFlowSummary(
  entries: LedgerEntry[] = mockLedgerEntries,
  periodFrom?: string,
  periodTo?: string,
): CashFlowSummary {
  let cashIn = 0, cashOut = 0, count = 0;
  for (const e of selectCashMovements(entries, periodFrom, periodTo)) {
    count += 1;
    if (cashDirection(e) === 'in') cashIn += e.amount_cents;
    else cashOut += e.amount_cents;
  }
  return { cashIn, cashOut, net: cashIn - cashOut, count };
}
