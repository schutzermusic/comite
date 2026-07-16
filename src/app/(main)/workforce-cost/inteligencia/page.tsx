'use client';

/**
 * Inteligência — simulador de nova demanda, forecast de capacidade e
 * insights de IA (Fase 8, diferencial D2). O motor é determinístico
 * (workforce-intelligence); a IA apenas interpreta o resumo e recomenda.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Brain,
  Lightbulb,
  Sparkles,
  TrendingUp,
  UserSearch,
  Users,
} from 'lucide-react';
import {
  HudBadge,
  HudButton,
  HudEmptyState,
  HudHeader,
  HudInput,
  HudKpiStrip,
  HudPageLayout,
  HudPanel,
  HudStatusPill,
  HudTable,
  useHudToast,
  type HudTableColumn,
  type KpiItem,
} from '@/components/hud';
import { usePermissions } from '@/hooks/use-permissions';
import type {
  CapacityForecastPoint,
  DemandCandidate,
  WorkforceAdvice,
} from '@/lib/types/people';
import { GOVERNANCE_SEVERITY_LABELS } from '@/lib/types/people';
import {
  buildIntelligenceSummary,
  forecastCapacity,
  simulateDemand,
} from '@/lib/services/workforce-intelligence';
import { formatCents } from '@/lib/services/cost';
import { maskCost } from '@/lib/services/capacity';

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}
function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function monthShort(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
}

const SEVERITY_PILL = {
  critical: 'critical',
  high: 'error',
  medium: 'warning',
  low: 'info',
  info: 'neutral',
} as const;

export default function InteligenciaPage() {
  const { hasPermission } = usePermissions();
  const { notify } = useHudToast();
  const canViewCost = hasPermission('people.cost_view');
  const canAi = hasPermission('people.ai_insights');

  const [forecast, setForecast] = useState<CapacityForecastPoint[]>([]);
  const [loading, setLoading] = useState(true);

  // simulator state
  const [startMonth, setStartMonth] = useState(currentMonth());
  const [endMonth, setEndMonth] = useState(addMonths(currentMonth(), 2));
  const [neededPct, setNeededPct] = useState('50');
  const [maxCost, setMaxCost] = useState('');
  const [competencies, setCompetencies] = useState('');
  const [candidates, setCandidates] = useState<DemandCandidate[] | null>(null);
  const [simBusy, setSimBusy] = useState(false);

  // AI state
  const [advice, setAdvice] = useState<WorkforceAdvice | null>(null);
  const [aiBusy, setAiBusy] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setForecast(await forecastCapacity(6));
    } catch {
      setForecast([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const kpis: KpiItem[] = useMemo(() => {
    const now = forecast[0];
    const peakOverload = Math.max(0, ...forecast.map((f) => f.overloadedCount));
    const avgIdle =
      forecast.length > 0
        ? Math.round(forecast.reduce((s, f) => s + f.idleCount, 0) / forecast.length)
        : 0;
    return [
      { id: 'headcount', label: 'Headcount ativo', value: now?.capacityFte ?? 0, icon: <Users className="h-4 w-4" /> },
      { id: 'fte', label: 'FTE comprometido (mês)', value: (now?.demandFte ?? 0).toFixed(2).replace('.', ',') },
      { id: 'overload', label: 'Pico de sobrecarga (6m)', value: peakOverload, variant: peakOverload > 0 ? 'danger' : 'default', tintValue: peakOverload > 0, icon: <AlertTriangle className="h-4 w-4" /> },
      { id: 'idle', label: 'Ociosidade média', value: avgIdle, variant: avgIdle > 0 ? 'warning' : 'default' },
    ];
  }, [forecast]);

  async function handleSimulate() {
    const pct = Number(neededPct);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
      notify('Informe um percentual entre 1 e 100', { variant: 'warning' });
      return;
    }
    if (endMonth < startMonth) {
      notify('Período inválido', { description: 'Fim antes do início.', variant: 'warning' });
      return;
    }
    setSimBusy(true);
    try {
      const result = await simulateDemand({
        startMonth,
        endMonth,
        neededPercentage: pct,
        maxMonthlyCostCents: maxCost ? Math.round(Number(maxCost) * 100) : null,
        competencies: competencies.trim() || undefined,
      });
      setCandidates(result);
    } catch (e) {
      notify('Erro na simulação', {
        description: e instanceof Error ? e.message : undefined,
        variant: 'error',
      });
    } finally {
      setSimBusy(false);
    }
  }

  async function handleGenerateAi() {
    setAiBusy(true);
    try {
      const summary = await buildIntelligenceSummary();
      const res = await fetch('/api/ai/workforce-insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || `Falha ${res.status}`);
      }
      setAdvice(json.advice as WorkforceAdvice);
    } catch (e) {
      notify('Não foi possível gerar insights de IA', {
        description: e instanceof Error ? e.message : undefined,
        variant: 'error',
      });
    } finally {
      setAiBusy(false);
    }
  }

  const maxDemand = Math.max(1, ...forecast.map((f) => Math.max(f.demandFte, f.capacityFte)));

  const candidateColumns: HudTableColumn<DemandCandidate>[] = [
    {
      key: 'person',
      header: 'Colaborador',
      cell: (c) => (
        <div>
          <p className="text-sm font-medium text-ig-fg-strong">{c.person.fullName}</p>
          <p className="text-xs text-ig-fg-muted">{c.person.jobTitle ?? c.person.department ?? '—'}</p>
        </div>
      ),
    },
    {
      key: 'compat',
      header: 'Compatibilidade',
      align: 'right',
      cell: (c) => (
        <div className="flex items-center justify-end gap-2">
          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-ig-panel">
            <div
              className={`h-full rounded-full ${c.compatibility >= 70 ? 'bg-ig-success' : c.compatibility >= 40 ? 'bg-ig-warning' : 'bg-ig-danger'}`}
              style={{ width: `${c.compatibility}%` }}
            />
          </div>
          <span className="w-9 text-right text-sm font-semibold tabular-nums text-ig-fg-strong">
            {c.compatibility}%
          </span>
        </div>
      ),
    },
    {
      key: 'avail',
      header: 'Disponível',
      align: 'right',
      cell: (c) => (
        <span className={`text-sm tabular-nums ${c.availablePct < 0 ? 'text-ig-danger' : c.availablePct === 0 ? 'text-ig-warning' : 'text-ig-success'}`}>
          {c.availablePct.toFixed(0)}%
        </span>
      ),
    },
    {
      key: 'comp',
      header: 'Competência',
      align: 'right',
      cell: (c) => <span className="text-sm tabular-nums text-ig-fg-muted">{c.competencyScore}%</span>,
    },
    {
      key: 'cost',
      header: 'Custo estimado',
      align: 'right',
      cell: (c) => (
        <span className="text-sm tabular-nums text-ig-fg-muted">
          {maskCost(c.estimatedMonthlyCostCents == null ? '—' : formatCents(c.estimatedMonthlyCostCents), canViewCost)}
        </span>
      ),
    },
    {
      key: 'conflict',
      header: 'Conflito',
      cell: (c) =>
        c.conflict === 'overloaded' ? (
          <HudStatusPill variant="critical" size="sm">Sobrealocado</HudStatusPill>
        ) : c.conflict === 'partial' ? (
          <HudStatusPill variant="warning" size="sm">Parcial</HudStatusPill>
        ) : (
          <HudStatusPill variant="active" size="sm">Livre</HudStatusPill>
        ),
    },
  ];

  return (
    <HudPageLayout>
      <div className="space-y-6">
        <HudHeader
          title="Inteligência de Capacidade"
          subtitle="Simulador de demanda, forecast e recomendações — motor determinístico + IA"
          icon={<Brain className="h-5 w-5" />}
          breadcrumbs={[{ label: 'Pessoas & Custos', href: '/workforce-cost' }, { label: 'Inteligência' }]}
        />

        <HudKpiStrip kpis={kpis} columns={4} />

        {/* Forecast de capacidade */}
        <HudPanel title="Forecast de capacidade — próximos 6 meses" accentColor="emerald">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-ig-border border-t-ig-accent" />
            </div>
          ) : forecast.length === 0 ? (
            <HudEmptyState icon="inbox" compact title="Sem dados" description="Cadastre pessoas e alocações para projetar a capacidade." />
          ) : (
            <div className="flex items-end justify-between gap-3 pt-2">
              {forecast.map((f) => {
                const demandH = Math.round((f.demandFte / maxDemand) * 120);
                const capH = Math.round((f.capacityFte / maxDemand) * 120);
                const over = f.demandFte > f.capacityFte;
                return (
                  <div key={f.month} className="flex flex-1 flex-col items-center gap-2">
                    <div className="flex h-32 items-end gap-1">
                      <div
                        className="w-5 rounded-t bg-ig-border-strong"
                        style={{ height: `${capH}px` }}
                        title={`Capacidade ${f.capacityFte} FTE`}
                      />
                      <div
                        className={`w-5 rounded-t ${over ? 'bg-ig-danger' : 'bg-ig-accent'}`}
                        style={{ height: `${demandH}px` }}
                        title={`Demanda ${f.demandFte.toFixed(2)} FTE`}
                      />
                    </div>
                    <span className="text-[11px] capitalize text-ig-fg-muted">{monthShort(f.month)}</span>
                    <span className="text-xs font-semibold tabular-nums text-ig-fg-strong">
                      {f.demandFte.toFixed(1)}
                    </span>
                    {(f.overloadedCount > 0 || f.idleCount > 0) && (
                      <span className="text-[10px] text-ig-fg-muted">
                        {f.overloadedCount > 0 && <span className="text-ig-danger">{f.overloadedCount}⚠</span>}
                        {f.overloadedCount > 0 && f.idleCount > 0 && ' · '}
                        {f.idleCount > 0 && <span className="text-ig-warning">{f.idleCount} livre</span>}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <div className="mt-4 flex items-center gap-4 border-t border-ig-border-subtle pt-3 text-[11px] text-ig-fg-muted">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-ig-border-strong" /> Capacidade (FTE)</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-ig-accent" /> Demanda comprometida</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-ig-danger" /> Demanda &gt; capacidade</span>
          </div>
        </HudPanel>

        {/* Simulador de nova demanda */}
        <HudPanel title="Simulador de nova demanda" accentColor="emerald">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <HudInput label="Início (competência)" type="month" value={startMonth} onChange={(e) => setStartMonth(e.target.value)} />
            <HudInput label="Fim (competência)" type="month" value={endMonth} onChange={(e) => setEndMonth(e.target.value)} />
            <HudInput label="Necessidade (%)" type="number" min={1} max={100} value={neededPct} onChange={(e) => setNeededPct(e.target.value)} />
            <HudInput label="Teto de custo/mês (R$)" type="number" min={0} value={maxCost} onChange={(e) => setMaxCost(e.target.value)} placeholder="opcional" />
            <HudInput label="Competências" value={competencies} onChange={(e) => setCompetencies(e.target.value)} placeholder="Ex.: NR-10, subestação" />
          </div>
          <div className="mt-3">
            <HudButton variant="primary" leftIcon={<UserSearch className="h-4 w-4" />} disabled={simBusy} onClick={() => void handleSimulate()}>
              {simBusy ? 'Simulando…' : 'Ranquear candidatos'}
            </HudButton>
          </div>

          {candidates && (
            <div className="mt-4">
              <HudTable<DemandCandidate>
                columns={candidateColumns}
                data={candidates}
                keyExtractor={(c) => c.person.id}
                emptyState={
                  <HudEmptyState icon="search" compact title="Nenhum candidato" description="Ajuste os critérios: período, percentual ou competências." />
                }
              />
              {candidates.length > 0 && candidates[0].reasons.length > 0 && (
                <p className="mt-2 text-[11px] text-ig-fg-muted">
                  Melhor candidato: {candidates[0].person.fullName} — {candidates[0].reasons.join(' · ')}
                </p>
              )}
            </div>
          )}
        </HudPanel>

        {/* Insights de IA */}
        <HudPanel title="Insights de IA" accentColor="emerald">
          {!canAi ? (
            <HudEmptyState icon="alert" compact title="Sem acesso" description="Geração de insights de IA requer people.ai_insights." />
          ) : (
            <>
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-ig-fg-muted">
                  Leitura executiva e recomendações sobre o estado atual da capacidade, ociosidade e
                  sobrecarga — interpretadas por IA a partir dos números do sistema.
                </p>
                <HudButton variant="primary" leftIcon={<Sparkles className="h-4 w-4" />} disabled={aiBusy} onClick={() => void handleGenerateAi()}>
                  {aiBusy ? 'Analisando…' : advice ? 'Regenerar' : 'Gerar insights'}
                </HudButton>
              </div>

              {advice && (
                <div className="mt-4 space-y-4">
                  <div className="rounded-lg border border-ig-border-focus bg-ig-accent-weak/30 px-4 py-3">
                    <p className="flex items-start gap-2 text-sm font-medium text-ig-fg-strong">
                      <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-ig-accent" />
                      {advice.headline}
                    </p>
                  </div>

                  {advice.insights.length > 0 && (
                    <div className="space-y-2">
                      {advice.insights.map((ins, i) => (
                        <div key={i} className="flex items-start gap-3 rounded-lg border border-ig-border-subtle bg-ig-panel/60 px-4 py-3">
                          <HudStatusPill variant={SEVERITY_PILL[ins.severity]} size="sm">
                            {GOVERNANCE_SEVERITY_LABELS[ins.severity]}
                          </HudStatusPill>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-ig-fg-strong">{ins.title}</p>
                            <p className="text-xs text-ig-fg-muted">{ins.detail}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {advice.recommendations.length > 0 && (
                    <div className="rounded-lg border border-ig-border-subtle bg-ig-panel/60 px-4 py-3">
                      <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-ig-fg-muted">
                        <Lightbulb className="h-3.5 w-3.5" /> Recomendações
                      </p>
                      <ul className="space-y-1.5">
                        {advice.recommendations.map((r, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-ig-fg-strong">
                            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ig-accent" />
                            {r}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <p className="text-[11px] text-ig-fg-muted">
                    Gerado por IA a partir de dados determinísticos do sistema. Revise antes de decidir.
                  </p>
                </div>
              )}
            </>
          )}
        </HudPanel>
      </div>
    </HudPageLayout>
  );
}
