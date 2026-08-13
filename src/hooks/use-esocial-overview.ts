'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  EMPTY_ESOCIAL_LINK,
  type EsocialCompetenceFigures,
  type EsocialLinkState,
} from '@/lib/workforce/compliance';
import {
  competenceCoverage,
  summarizeCoverage,
  type CompetenceCoverage,
} from '@/lib/workforce/esocial-coverage';

/** Métricas de uma competência, já normalizadas a partir dos eventos do eSocial. */
export interface EsocialCompetenceMetrics {
  competence: string;
  gross_payroll_cents: number;
  overtime_cents: number;
  overtime_hours: number;
  benefits_cents: number;
  deductions_cents: number;
  net_paid_cents: number;
  /** Cobertura da tabela de rubricas — ver `esocial-coverage`. */
  rubric_total_cents: number;
  rubric_mapped_cents: number;
  headcount: number;
  admissions: number;
  terminations: number;
  absence_days: number;
  absence_events: number;
  inss_cents: number | null;
  inss_withheld_cents: number | null;
  irrf_cents: number | null;
  fgts_cents: number | null;
  cp_base_cents: number | null;
  fgts_base_cents: number | null;
  rat_fap_rate: number | null;
  totalizers: Record<string, boolean>;
  source_event_count: number;
}

export interface EsocialAreaMetrics {
  competence: string;
  area_code: string;
  area_label: string;
  headcount: number;
  admissions: number;
  terminations: number;
  absence_days: number;
  gross_cents: number;
  overtime_cents: number;
  base_cents: number;
}

export interface EsocialSyncRunSummary {
  id: string;
  status: string;
  started_at: string;
  completed_at?: string;
  events_imported: number;
  events_failed: number;
  safe_message?: string;
}

/** Quadro informado manualmente, por competência. */
export interface ManualHeadcountAdjustment {
  competence: string;
  headcount: number;
  source_note: string;
  updated_at: string;
}

export interface EsocialOverview {
  link: EsocialLinkState;
  competences: EsocialCompetenceMetrics[];
  areas: EsocialAreaMetrics[];
  activeHeadcount: number;
  recentRuns: EsocialSyncRunSummary[];
  manualHeadcount: ManualHeadcountAdjustment[];
}

const EMPTY_OVERVIEW: EsocialOverview = {
  link: EMPTY_ESOCIAL_LINK,
  competences: [],
  areas: [],
  activeHeadcount: 0,
  recentRuns: [],
  manualHeadcount: [],
};

/**
 * Métricas do eSocial já apuradas para a Visão Geral de Pessoas & Custos.
 *
 * Falha em silêncio (sem permissão, offline, integração não configurada) e cai
 * no estado vazio — a página continua funcional com os dados da folha
 * importada, apenas sem os valores apurados de guia.
 */
export function useEsocialOverview() {
  const [data, setData] = useState<EsocialOverview>(EMPTY_OVERVIEW);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Os ajustes manuais vêm de rota própria: eles não são apuração e não
      // pertencem ao payload do eSocial. Falha em ler ajustes não derruba o
      // cockpit — só deixa o quadro daquelas competências como o eSocial o viu.
      const [overview, adjustments] = await Promise.all([
        fetch('/api/workforce/esocial-overview', { cache: 'no-store' }),
        fetch('/api/workforce/manual-headcount', { cache: 'no-store' }).catch(() => null),
      ]);
      if (!overview.ok) throw new Error(String(overview.status));
      const json = (await overview.json()) as { ok: boolean } & Partial<EsocialOverview>;

      let manualHeadcount: ManualHeadcountAdjustment[] = [];
      if (adjustments?.ok) {
        const body = (await adjustments.json()) as {
          ok: boolean;
          adjustments?: ManualHeadcountAdjustment[];
        };
        if (body.ok) manualHeadcount = body.adjustments ?? [];
      }

      if (json.ok) setData({ ...EMPTY_OVERVIEW, ...json, manualHeadcount });
      else setData(EMPTY_OVERVIEW);
    } catch {
      setData(EMPTY_OVERVIEW);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Valores de guia por competência — em reais, prontos para o compliance. */
  const figuresByCompetence = useMemo(() => {
    const out: Record<string, EsocialCompetenceFigures> = {};
    for (const c of data.competences) {
      out[c.competence] = {
        inss: c.inss_cents === null ? undefined : c.inss_cents / 100,
        irrf: c.irrf_cents === null ? undefined : c.irrf_cents / 100,
        fgts: c.fgts_cents === null ? undefined : c.fgts_cents / 100,
        totalizers: c.totalizers ?? {},
      };
    }
    return out;
  }, [data.competences]);

  const metricsByCompetence = useMemo(() => {
    const out: Record<string, EsocialCompetenceMetrics> = {};
    for (const c of data.competences) out[c.competence] = c;
    return out;
  }, [data.competences]);

  /**
   * O que dá para afirmar sobre cada competência.
   *
   * Fica ao lado dos números de propósito: a diferença entre um mês completo e
   * um mês em que só os totalizadores sobreviveram à janela de retenção não é
   * visível no valor, só na cobertura.
   */
  const coverageByCompetence = useMemo(() => {
    const out: Record<string, CompetenceCoverage> = {};
    for (const c of data.competences) out[c.competence] = competenceCoverage(c);
    return out;
  }, [data.competences]);

  const coverageSummary = useMemo(() => summarizeCoverage(data.competences), [data.competences]);

  /** Ajustes indexados por competência, no formato que a série consome. */
  const manualHeadcountByCompetence = useMemo(() => {
    const out: Record<string, { headcount: number; sourceNote: string }> = {};
    for (const a of data.manualHeadcount) {
      out[a.competence] = { headcount: a.headcount, sourceNote: a.source_note };
    }
    return out;
  }, [data.manualHeadcount]);

  return {
    ...data,
    figuresByCompetence,
    metricsByCompetence,
    coverageByCompetence,
    coverageSummary,
    manualHeadcountByCompetence,
    loading,
    reload: load,
  };
}
