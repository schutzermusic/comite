/**
 * Dimensão organizacional unificada — centro de custo + lotação.
 *
 * As duas fontes descrevem a mesma coisa por caminhos diferentes:
 *
 *   • lote de folha aprovado → `costCenters[]`, com valor apurado e
 *     `headcount: 0` fixo (o resumo por centro de custo não traz quadro);
 *   • eSocial → `actuals.areas[]`, com quadro, movimentação e faltas — e daí
 *     `applyEsocial` sintetiza `costCenters` com id `esocial-<código>`.
 *
 * Oferecer dois filtros separados seria redundante quando a competência vem do
 * eSocial (são o mesmo conjunto, com os mesmos ids) e silenciosamente
 * inconsistente quando vem do lote. Esta função monta uma dimensão só e declara,
 * por unidade, o que ela sabe responder — para o seletor mostrar isso ANTES da
 * escolha, em vez de deixar o usuário descobrir pelo traço no KPI.
 */

import type { WorkforceMonthlyRecord } from '@/lib/workforce/period';
import type { WorkforceUnit } from './types';

interface UnitAccumulator {
  id: string;
  label: string;
  fromBatch: boolean;
  fromEsocial: boolean;
  headcount: boolean;
  movement: boolean;
  absence: boolean;
  payroll: boolean;
  competences: Set<string>;
  totalPayroll: number;
}

/**
 * Constrói a dimensão a partir da série apurada.
 *
 * Ordenada por folha acumulada: quem vai recortar procura primeiro o que pesa.
 */
export function buildWorkforceUnits(series: WorkforceMonthlyRecord[]): WorkforceUnit[] {
  const acc = new Map<string, UnitAccumulator>();

  const ensure = (id: string, label: string): UnitAccumulator => {
    let entry = acc.get(id);
    if (!entry) {
      entry = {
        id,
        label,
        fromBatch: false,
        fromEsocial: false,
        headcount: false,
        movement: false,
        absence: false,
        payroll: false,
        competences: new Set(),
        totalPayroll: 0,
      };
      acc.set(id, entry);
    }
    // O rótulo mais informativo vence: o eSocial traz o nome da lotação, o lote
    // traz o texto digitado na planilha.
    if (label && label.length > entry.label.length) entry.label = label;
    return entry;
  };

  for (const record of series) {
    for (const cc of record.costCenters) {
      const entry = ensure(cc.id, cc.name);
      entry.competences.add(record.competenceMonth);
      entry.totalPayroll += cc.payrollValue;
      if (cc.payrollValue > 0) entry.payroll = true;
      // Centro sintetizado do eSocial carrega o prefixo; os demais vêm do lote.
      if (cc.id.startsWith('esocial-')) entry.fromEsocial = true;
      else entry.fromBatch = true;
      if (cc.headcount > 0) entry.headcount = true;
    }

    for (const area of record.actuals?.areas ?? []) {
      // Mesmo id que `applyEsocial` usa ao sintetizar o centro de custo, para
      // que lotação e centro colapsem numa entrada só em vez de duplicarem.
      const entry = ensure(`esocial-${area.code}`, area.label);
      entry.fromEsocial = true;
      entry.competences.add(record.competenceMonth);
      if (area.headcount > 0) entry.headcount = true;
      if (area.admissions > 0 || area.terminations > 0) entry.movement = true;
      if (area.absenceDays > 0) entry.absence = true;
      if (area.payroll > 0) entry.payroll = true;
    }
  }

  return [...acc.values()]
    .map<WorkforceUnit>((entry) => ({
      id: entry.id,
      label: entry.label || entry.id,
      origin:
        entry.fromBatch && entry.fromEsocial
          ? 'both'
          : entry.fromEsocial
            ? 'esocial-lotacao'
            : 'payroll-batch',
      carries: {
        payroll: entry.payroll,
        headcount: entry.headcount,
        movement: entry.movement,
        absence: entry.absence,
      },
      competences: [...entry.competences].sort(),
      totalPayroll: Math.round(entry.totalPayroll),
    }))
    .sort((a, b) => b.totalPayroll - a.totalPayroll || a.label.localeCompare(b.label, 'pt-BR'));
}

/** Legenda humana do recorte, idêntica na tela e nos três documentos. */
export function describeUnitSelection(units: WorkforceUnit[], selectedIds: string[]): string {
  if (selectedIds.length === 0) return 'Todas as lotações';
  const byId = new Map(units.map((u) => [u.id, u]));
  const labels = selectedIds.map((id) => byId.get(id)?.label ?? id);
  if (labels.length <= 2) return labels.join(' · ');
  return `${labels.slice(0, 2).join(' · ')} +${labels.length - 2}`;
}
