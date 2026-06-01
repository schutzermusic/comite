/**
 * DRE (managerial P&L) selectors.
 *
 * Single source of truth: mockLedgerEntries grouped by L1 DRE group
 * (revenue / cogs / opex / financial / taxes), with composition derived
 * from L2 categories inside each group.
 *
 * Provides shapes both for the legacy /financeiro/dre-gerencial page
 * (DreManagerialRow[] with composition + prior period) and for callers
 * who want the raw aggregate (PnL groups).
 */

import type { LedgerEntry } from '@/lib/types/finance';
import { mockLedgerEntries } from '@/data/finance/mock-ledger';
import { managementCategories } from '@/data/finance/seed-categories';

export interface DreCompositionItem {
  name: string;
  value: number;
}

export interface DreManagerialRow {
  key: string;
  label: string;
  /** Indentation level: 0 = group line, 1 = detail line. */
  level: 0 | 1;
  /** Subtotal styling. */
  tone?: 'sub' | 'final';
  current: number;
  prior: number;
  budget: number;
  composition: DreCompositionItem[];
}

function prevPeriodKey(periodKey: string): string {
  const [y, m] = periodKey.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function sumGroupForPeriod(
  entries: LedgerEntry[],
  group: 'revenue' | 'cogs' | 'opex' | 'financial' | 'taxes',
  periodKey: string,
  type: LedgerEntry['entry_type'],
): number {
  let sum = 0;
  for (const e of entries) {
    if (e.period_key !== periodKey || e.entry_type !== type || e.status === 'void') continue;
    const cat = managementCategories.find(c => c.id === e.category_id);
    if (!cat || cat.group_key !== group) continue;
    sum += (e.amount_cents * cat.sign) / 100;
  }
  return sum;
}

function compositionByL2(
  entries: LedgerEntry[],
  group: 'revenue' | 'cogs' | 'opex' | 'financial' | 'taxes',
  periodKey: string,
  type: LedgerEntry['entry_type'] = 'actual',
): DreCompositionItem[] {
  const byL2 = new Map<string, number>();
  for (const e of entries) {
    if (e.period_key !== periodKey || e.entry_type !== type || e.status === 'void') continue;
    const cat = managementCategories.find(c => c.id === e.category_id);
    if (!cat || cat.group_key !== group) continue;
    const l2 = cat.level === 3 ? managementCategories.find(c => c.id === cat.parent_id) ?? cat : cat;
    byL2.set(l2.name, (byL2.get(l2.name) ?? 0) + (e.amount_cents * cat.sign) / 100);
  }
  return Array.from(byL2.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
}

/**
 * Build the legacy DRE managerial rows for the given period. Numbers
 * come from the canonical ledger; composition lists the L2 categories
 * inside each L1 group.
 */
export function selectDreManagerial(
  periodKey: string = '2026-04',
  entries: LedgerEntry[] = mockLedgerEntries,
): DreManagerialRow[] {
  const prev = prevPeriodKey(periodKey);
  const sum = (g: Parameters<typeof sumGroupForPeriod>[1], p: string, t: Parameters<typeof sumGroupForPeriod>[3]) =>
    sumGroupForPeriod(entries, g, p, t);

  // Revenue
  const rbCur = sum('revenue', periodKey, 'actual');
  const rbPrev = sum('revenue', prev, 'actual');
  const rbBud = sum('revenue', periodKey, 'budget');

  // Synthetic deductions = 13% of revenue (legacy convention; would be its own
  // ledger category once data is modelled).
  const dedRate = 0.13;
  const dedCur = -Math.round(rbCur * dedRate);
  const dedPrev = -Math.round(rbPrev * dedRate);
  const dedBud = -Math.round(rbBud * dedRate);

  const rlCur = rbCur + dedCur;
  const rlPrev = rbPrev + dedPrev;
  const rlBud = rbBud + dedBud;

  const cdCur = sum('cogs', periodKey, 'actual');
  const cdPrev = sum('cogs', prev, 'actual');
  const cdBud = sum('cogs', periodKey, 'budget');

  const mbCur = rlCur + cdCur;
  const mbPrev = rlPrev + cdPrev;
  const mbBud = rlBud + cdBud;

  const opCur = sum('opex', periodKey, 'actual');
  const opPrev = sum('opex', prev, 'actual');
  const opBud = sum('opex', periodKey, 'budget');

  const ebCur = mbCur + opCur;
  const ebPrev = mbPrev + opPrev;
  const ebBud = mbBud + opBud;

  const finCur = sum('financial', periodKey, 'actual');
  const finPrev = sum('financial', prev, 'actual');
  const finBud = sum('financial', periodKey, 'budget');

  const taxCur = sum('taxes', periodKey, 'actual');
  const taxPrev = sum('taxes', prev, 'actual');
  const taxBud = sum('taxes', periodKey, 'budget');

  const liqCur = ebCur + finCur + taxCur;
  const liqPrev = ebPrev + finPrev + taxPrev;
  const liqBud = ebBud + finBud + taxBud;

  return [
    {
      key: 'rb', label: 'Receita Bruta', level: 0,
      current: rbCur, prior: rbPrev, budget: rbBud,
      composition: compositionByL2(entries, 'revenue', periodKey),
    },
    {
      key: 'ded', label: '(–) Deduções e Impostos sobre Receita', level: 1,
      current: dedCur, prior: dedPrev, budget: dedBud,
      composition: [
        { name: 'PIS/COFINS', value: Math.round(dedCur * 0.55) },
        { name: 'ISS/ICMS', value: Math.round(dedCur * 0.32) },
        { name: 'Devoluções e Cancelamentos', value: Math.round(dedCur * 0.13) },
      ],
    },
    {
      key: 'rl', label: 'Receita Líquida', level: 0, tone: 'sub',
      current: rlCur, prior: rlPrev, budget: rlBud, composition: [],
    },
    {
      key: 'cd', label: '(–) Custo Direto (CMV / CSP)', level: 1,
      current: cdCur, prior: cdPrev, budget: cdBud,
      composition: compositionByL2(entries, 'cogs', periodKey),
    },
    {
      key: 'mb', label: 'Margem Bruta', level: 0, tone: 'sub',
      current: mbCur, prior: mbPrev, budget: mbBud, composition: [],
    },
    {
      key: 'opex', label: '(–) OPEX (Pessoal, Estrutura, G&A)', level: 1,
      current: opCur, prior: opPrev, budget: opBud,
      composition: compositionByL2(entries, 'opex', periodKey),
    },
    {
      key: 'ebitda', label: 'EBITDA', level: 0, tone: 'sub',
      current: ebCur, prior: ebPrev, budget: ebBud, composition: [],
    },
    {
      key: 'fin', label: 'Resultado Financeiro', level: 1,
      current: finCur, prior: finPrev, budget: finBud,
      composition: compositionByL2(entries, 'financial', periodKey),
    },
    {
      key: 'tax', label: 'Impostos sobre o Lucro (IR/CSLL)', level: 1,
      current: taxCur, prior: taxPrev, budget: taxBud,
      composition: compositionByL2(entries, 'taxes', periodKey),
    },
    {
      key: 'rl_final', label: 'Resultado Líquido', level: 0, tone: 'final',
      current: liqCur, prior: liqPrev, budget: liqBud, composition: [],
    },
  ];
}
