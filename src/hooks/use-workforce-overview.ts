'use client';

/**
 * Toda a fonte de dados da Visão Geral de Pessoas & Custos, num lugar só.
 *
 * A página fazia isto inline: dois `fetch`, o hook do eSocial, o memo de
 * receita do contas a receber, o pipeline da série efetiva e DOZE `useMemo`
 * chamando um seletor cada. Além de ocupar duzentas linhas no meio do JSX, os
 * doze recalculavam `resolvePeriodRange` por conta própria a cada render.
 *
 * Aqui a composição inteira colapsa num único memo sobre
 * `buildWorkforceOverviewModel`, e a página recebe um objeto pronto — o mesmo
 * que os três documentos exportados consomem.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useEsocialOverview } from '@/hooks/use-esocial-overview';
import { useReportBranding } from '@/hooks/use-report-branding';
import { useWorkforceComplianceKpis } from '@/hooks/use-workforce-compliance-kpis';
import { repositoryMode } from '@/lib/payroll/closing-client';
import { getAPARTitles } from '@/lib/finance/finance-store';
import { selectMonthlyRevenue } from '@/lib/finance/selectors/apar';
import {
  buildEffectiveSeries,
  enrichSeriesWithEsocial,
  enrichSeriesWithRevenue,
  DEFAULT_WORKFORCE_PERIOD,
  type WorkforcePeriodSelection,
} from '@/lib/workforce/period';
import { buildWorkforceOverviewModel } from '@/lib/workforce/overview/model';
import {
  DEFAULT_COMPARISON_MODE,
  EMPTY_WORKFORCE_FILTERS,
  type ComparisonMode,
  type WorkforceOverviewFilters,
  type WorkforceOverviewModel,
} from '@/lib/workforce/overview/types';
import type { PayrollClosingBatch, PayrollClosingBatchApproved } from '@/lib/types/payroll-closing';

interface UseWorkforceOverviewOptions {
  /** Necessário para buscar os lotes de qualquer status (compliance). */
  canSeePayroll: boolean;
  /** Centro de custo do drilldown, vindo de `?costCenterId=`. */
  drilldownCostCenterId?: string | null;
}

export interface UseWorkforceOverviewResult {
  model: WorkforceOverviewModel;
  loading: boolean;

  period: WorkforcePeriodSelection;
  setPeriod: (next: WorkforcePeriodSelection) => void;
  comparison: ComparisonMode;
  setComparison: (next: ComparisonMode) => void;
  filters: WorkforceOverviewFilters;
  setFilters: (next: WorkforceOverviewFilters) => void;

  /** Série completa, antes do recorte — alimenta o seletor de período. */
  rawSeries: ReturnType<typeof buildEffectiveSeries>;

  reloadEsocial: () => Promise<void>;
  saveManualHeadcount: (competence: string, headcount: number, sourceNote: string) => Promise<void>;
  removeManualHeadcount: (competence: string) => Promise<void>;
  /** Competências oferecidas ao ajuste manual, da mais recente para a mais antiga. */
  adjustableCompetences: {
    competence: string;
    esocialHeadcount: number;
    payroll: number;
    manualHeadcount?: number;
    manualNote?: string;
  }[];
}

export function useWorkforceOverview(
  options: UseWorkforceOverviewOptions,
): UseWorkforceOverviewResult {
  const { canSeePayroll, drilldownCostCenterId } = options;

  const [period, setPeriod] = useState<WorkforcePeriodSelection>(DEFAULT_WORKFORCE_PERIOD);
  const [comparison, setComparison] = useState<ComparisonMode>(DEFAULT_COMPARISON_MODE);
  const [filters, setFilters] = useState<WorkforceOverviewFilters>(EMPTY_WORKFORCE_FILTERS);

  const [approvedBatches, setApprovedBatches] = useState<PayrollClosingBatchApproved[]>([]);
  const [allBatches, setAllBatches] = useState<PayrollClosingBatch[]>([]);

  useEffect(() => {
    if (repositoryMode() !== 'supabase') return;
    fetch('/api/payroll/batches?approved=true')
      .then((r) => r.json())
      .then((d: { ok: boolean; batches?: PayrollClosingBatchApproved[] }) => {
        if (d.ok) setApprovedBatches(d.batches ?? []);
      })
      .catch(() => {});
  }, []);

  // Todos os lotes (qualquer status) alimentam o compliance: uma competência
  // sem lote aprovado ainda precisa aparecer como pendência, não como ausência.
  useEffect(() => {
    if (repositoryMode() !== 'supabase' || !canSeePayroll) return;
    fetch('/api/payroll/batches')
      .then((r) => r.json())
      .then((d: { ok: boolean; batches?: PayrollClosingBatch[] }) => {
        if (d.ok) setAllBatches(d.batches ?? []);
      })
      .catch(() => {});
  }, [canSeePayroll]);

  const esocial = useEsocialOverview();
  // Marca da empresa (Configurações › Branding) — entra no modelo para que
  // tela, PDF, deck e PowerPoint mostrem exatamente a mesma identidade.
  const { branding } = useReportBranding();

  const arTitles = useMemo(() => getAPARTitles('receivable'), []);
  const monthlyRevenue = useMemo(() => selectMonthlyRevenue(arTitles), [arTitles]);

  /**
   * Série efetiva, da fonte mais fraca para a mais forte:
   * folha importada → receita real (AR) → apurado do eSocial.
   *
   * Não há camada de demonstração embaixo: competência sem nenhuma dessas
   * fontes simplesmente não existe na série.
   */
  const rawSeries = useMemo(
    () =>
      enrichSeriesWithEsocial(
        enrichSeriesWithRevenue(buildEffectiveSeries(approvedBatches), monthlyRevenue),
        esocial.competences,
        esocial.areas,
        esocial.manualHeadcountByCompetence,
      ),
    [
      approvedBatches,
      monthlyRevenue,
      esocial.competences,
      esocial.areas,
      esocial.manualHeadcountByCompetence,
    ],
  );

  // A competência corrente do compliance é a mais recente apurada; os KPIs de
  // SST e série salarial são buscados por ela, cada um com permissão própria.
  const currentCompetence =
    rawSeries[rawSeries.length - 1]?.competenceMonth ?? new Date().toISOString().slice(0, 7);
  const complianceKpis = useWorkforceComplianceKpis(currentCompetence);

  const model = useMemo(
    () =>
      buildWorkforceOverviewModel({
        period,
        comparison,
        filters,
        rawSeries,
        approvedBatches,
        allBatches,
        esocialLink: esocial.link,
        figuresByCompetence: esocial.figuresByCompetence,
        coverageByCompetence: esocial.coverageByCompetence,
        metricsByCompetence: esocial.metricsByCompetence,
        complianceKpis,
        drilldownCostCenterId,
        branding,
      }),
    [
      period,
      comparison,
      filters,
      rawSeries,
      approvedBatches,
      allBatches,
      esocial.link,
      esocial.figuresByCompetence,
      esocial.coverageByCompetence,
      esocial.metricsByCompetence,
      complianceKpis,
      drilldownCostCenterId,
      branding,
    ],
  );

  const saveManualHeadcount = useCallback(
    async (competence: string, headcount: number, sourceNote: string) => {
      const res = await fetch('/api/workforce/manual-headcount', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ competence, headcount, sourceNote }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? 'Falha ao gravar o ajuste.');
      await esocial.reload();
    },
    [esocial],
  );

  const removeManualHeadcount = useCallback(
    async (competence: string) => {
      const res = await fetch(
        `/api/workforce/manual-headcount?competence=${encodeURIComponent(competence)}`,
        { method: 'DELETE' },
      );
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? 'Falha ao remover o ajuste.');
      await esocial.reload();
    },
    [esocial],
  );

  const adjustableCompetences = useMemo(
    () =>
      [...rawSeries].reverse().map((r) => {
        const manual = esocial.manualHeadcountByCompetence[r.competenceMonth];
        return {
          competence: r.competenceMonth,
          esocialHeadcount: esocial.metricsByCompetence[r.competenceMonth]?.headcount ?? 0,
          payroll: r.payroll,
          manualHeadcount: manual?.headcount,
          manualNote: manual?.sourceNote,
        };
      }),
    [rawSeries, esocial.manualHeadcountByCompetence, esocial.metricsByCompetence],
  );

  return {
    model,
    loading: esocial.loading,
    period,
    setPeriod,
    comparison,
    setComparison,
    filters,
    setFilters,
    rawSeries,
    reloadEsocial: esocial.reload,
    saveManualHeadcount,
    removeManualHeadcount,
    adjustableCompetences,
  };
}
