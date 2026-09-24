import type { ProcurementWorkspaceModel } from '@/lib/supply/procurement-read';

export type ProcurementModel = ProcurementWorkspaceModel & {
  viewerId: string;
  capabilities: { request: boolean; source: boolean; approve: boolean; issue: boolean; authorities: boolean; suppliers: boolean };
};

export const brlOf = (v: number, currency = 'BRL') => v.toLocaleString('pt-BR', { style: 'currency', currency });

/**
 * Número digitado em pt-BR ou não: com vírgula, a vírgula é o decimal e o
 * ponto é milhar ("1.234,5"); sem vírgula, o ponto é o decimal ("19.50").
 */
export function parseDecimal(input: string): number {
  const v = input.trim();
  if (!v) return Number.NaN;
  return Number(v.includes(',') ? v.replace(/\./g, '').replace(',', '.') : v);
}
