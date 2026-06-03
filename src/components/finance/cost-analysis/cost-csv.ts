import type { LedgerEntry } from '@/lib/types/finance';
import {
  managementCategories,
  resolveCategoryPath,
  costCenters,
  suppliers as supplierRefs,
} from '@/data/finance/seed-categories';
import { projects as projectRefs, contracts as contractRefs } from '@/data/finance/reference';

const catName = (id: string) => managementCategories.find((c) => c.id === id);
const projName = (id?: string) => projectRefs.find((p) => p.id === id)?.name ?? '';
const ccName = (id?: string) => costCenters.find((c) => c.id === id)?.name ?? '';
const supName = (id?: string) => supplierRefs.find((s) => s.id === id)?.name ?? '';
const ctrName = (id?: string) => {
  const c = contractRefs.find((c) => c.id === id);
  return c ? `${c.code} — ${c.client_name}` : '';
};

function csvCell(v: string | number): string {
  const s = String(v ?? '');
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Build a UTF-8 CSV (pt-BR friendly, ';' separated) from cost ledger entries. */
export function entriesToCsv(entries: LedgerEntry[]): string {
  const header = [
    'Data', 'Competência', 'Descrição', 'Grupo DRE', 'Categoria', 'Subcategoria',
    'Projeto', 'Contrato', 'Centro de Custo', 'Fornecedor', 'Valor (R$)', 'Tipo', 'Status',
  ];
  const lines = entries.map((e) => {
    const cat = catName(e.category_id);
    const path = cat ? resolveCategoryPath(cat) : undefined;
    const value = (Math.abs(e.amount_cents) / 100).toFixed(2).replace('.', ',');
    return [
      e.entry_date,
      e.competence_month ?? e.period_key,
      e.description,
      path?.groupKey ?? '',
      path?.categoryName ?? '',
      path?.subcategoryName ?? path?.categoryName ?? '',
      projName(e.project_id),
      ctrName(e.contract_id),
      ccName(e.cost_center_id),
      supName(e.supplier_id),
      value,
      e.entry_type,
      e.status,
    ].map(csvCell).join(';');
  });
  return [header.join(';'), ...lines].join('\n');
}

/** Trigger a client-side download of the given CSV text. */
export function downloadCsv(filename: string, csv: string): void {
  // BOM so Excel pt-BR opens accents correctly.
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
