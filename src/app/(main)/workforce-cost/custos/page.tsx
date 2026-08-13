'use client';

/**
 * Folha & Encargos (rota /custos, mantida para não quebrar links salvos).
 *
 * A seção passou a ser a casa dos relatórios de custo de folha, mas o que ela
 * já fazia continua exatamente onde estava: a aba "Custo por Colaborador" é a
 * página original — snapshots de custo carregado por competência (Fase 6, spec
 * §8/§21), com o mesmo seletor, os mesmos KPIs, a mesma tabela e o mesmo botão
 * de calcular. Nada daquele fluxo foi reescrito.
 *
 * As abas novas leem o que o eSocial já apurava e a Visão Geral não tinha onde
 * detalhar: composição da folha por competência, recorte por centro de custo e
 * por lotação, e variação salarial. Onde a tabela de rubricas não cobre a
 * folha, a composição fica INDISPONÍVEL e a tela diz por quê — nunca zerada.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Calculator, Coins, Layers, TrendingUp, Users, Wallet } from 'lucide-react';
import {
  HudBadge,
  HudButton,
  HudEmptyState,
  HudHeader,
  HudKpiStrip,
  HudPageLayout,
  HudPanel,
  HudSelect,
  HudStatusPill,
  HudTable,
  HudTabs,
  useHudToast,
  type HudTab,
  type HudTableColumn,
  type KpiItem,
} from '@/components/hud';
import { ExportReportButton } from '@/components/reports/ExportReportButton';
import { usePermissions } from '@/hooks/use-permissions';
import { useEsocialOverview } from '@/hooks/use-esocial-overview';
import type { EmployeeCostSnapshot } from '@/lib/types/people';
import { computeCostSnapshots, formatCents, listSnapshots } from '@/lib/services/cost';
import { EsocialCoverageNotice } from '@/components/workforce/EsocialCoverageNotice';
import type { PersonSalaryHistory, SalaryHistoryResult } from '@/lib/workforce/salary-history';
import { openPayrollCostReport } from '@/lib/reports/modules/payroll-cost-report';

const NA = '—';

const STATUS_LABELS: Record<EmployeeCostSnapshot['status'], string> = {
  estimated: 'Estimado',
  processed: 'Folha processada',
  reconciled: 'Reconciliado',
  superseded: 'Substituído',
};

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

function shortMonth(month: string): string {
  if (/^\d{4}-13$/.test(month)) return `13º ${month.slice(0, 4)}`;
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return month;
  return new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
}

/** Cents → BRL. Ausência é `—`, nunca R$ 0,00. */
function brl(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return NA;
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

export default function CustosMOPage() {
  const { hasPermission } = usePermissions();
  const { notify } = useHudToast();
  const canManageCost = hasPermission('people.cost_manage');
  const canViewCost = hasPermission('people.cost_view');

  const [month, setMonth] = useState(addMonths(currentMonth(), -1));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<EmployeeCostSnapshot[]>([]);
  const [busy, setBusy] = useState(false);

  const esocial = useEsocialOverview();

  // ── Competência selecionada nas abas do eSocial ─────────────────────────
  const esocialCompetences = useMemo(
    () => [...esocial.competences].map((c) => c.competence).sort((a, b) => b.localeCompare(a)),
    [esocial.competences],
  );
  const [competence, setCompetence] = useState<string | null>(null);
  const activeCompetence = competence ?? esocialCompetences[0] ?? null;
  const metric = activeCompetence ? esocial.metricsByCompetence[activeCompetence] : undefined;
  const coverage = activeCompetence ? esocial.coverageByCompetence[activeCompetence] : undefined;

  // ── Histórico salarial ──────────────────────────────────────────────────
  const [salary, setSalary] = useState<SalaryHistoryResult | null>(null);
  const [salaryError, setSalaryError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/workforce/salary-history');
        const json = (await res.json()) as { ok: boolean; history?: SalaryHistoryResult; error?: string };
        if (cancelled) return;
        if (!res.ok || !json.ok || !json.history) {
          // Sem permissão de salário a aba avisa; não é erro de sistema.
          setSalaryError(res.status === 403 ? 'sem-permissao' : (json.error ?? 'Falha ao carregar'));
          return;
        }
        setSalary(json.history);
      } catch (e) {
        if (!cancelled) setSalaryError(e instanceof Error ? e.message : 'Falha ao carregar');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSnapshots(await listSnapshots(month));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar custos');
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function handleCompute() {
    setBusy(true);
    try {
      const result = await computeCostSnapshots(month);
      notify('Snapshots calculados', {
        description: `${result.length} colaborador(es) com custo carregado congelado em ${month}.`,
        variant: 'success',
      });
      await reload();
    } catch (e) {
      notify('Erro ao calcular custos', {
        description: e instanceof Error ? e.message : undefined,
        variant: 'error',
      });
    } finally {
      setBusy(false);
    }
  }

  const kpis: KpiItem[] = useMemo(() => {
    const loaded = snapshots.reduce((s, r) => s + r.loadedMonthlyCostCents, 0);
    const avgHourly =
      snapshots.length > 0
        ? snapshots.reduce((s, r) => s + r.loadedHourlyCostCents, 0) / snapshots.length
        : 0;
    const processed = snapshots.filter(
      (r) => r.status === 'processed' || r.status === 'reconciled',
    ).length;
    return [
      {
        id: 'people',
        label: 'Pessoas com snapshot',
        value: snapshots.length,
        icon: <Users className="h-4 w-4" />,
      },
      {
        id: 'loaded',
        label: 'Custo carregado total',
        value: formatCents(loaded, true),
        icon: <Wallet className="h-4 w-4" />,
      },
      {
        id: 'hourly',
        label: 'Custo-hora médio',
        value: formatCents(Math.round(avgHourly)),
      },
      {
        id: 'processed',
        label: 'Com folha processada',
        value: `${processed}/${snapshots.length || 0}`,
        variant: processed === snapshots.length && snapshots.length > 0 ? 'success' : 'default',
      },
    ];
  }, [snapshots]);

  const columns: HudTableColumn<EmployeeCostSnapshot>[] = [
    {
      key: 'person',
      header: 'Colaborador',
      cell: (r) => (
        <div>
          <p className="text-sm font-medium text-ig-fg-strong">{r.person?.fullName ?? '—'}</p>
          <p className="text-xs text-ig-fg-muted">
            v{r.version}
            {r.supersedesId ? ' · recalculado' : ''}
          </p>
        </div>
      ),
    },
    {
      key: 'salary',
      header: 'Salário (bruto)',
      align: 'right',
      cell: (r) => (
        <span className="text-sm tabular-nums text-ig-fg-strong">{formatCents(r.salaryCents)}</span>
      ),
    },
    {
      key: 'taxes',
      header: 'Encargos',
      align: 'right',
      cell: (r) => (
        <span className="text-sm tabular-nums text-ig-fg-muted">
          {formatCents(r.payrollTaxesCents)}
        </span>
      ),
    },
    {
      key: 'benefits',
      header: 'Benefícios',
      align: 'right',
      cell: (r) => (
        <span className="text-sm tabular-nums text-ig-fg-muted">
          {formatCents(r.benefitsCents)}
        </span>
      ),
    },
    {
      key: 'provisions',
      header: 'Provisões',
      align: 'right',
      cell: (r) => (
        <span className="text-sm tabular-nums text-ig-fg-muted">
          {formatCents(r.provisionsCents)}
        </span>
      ),
    },
    {
      key: 'loaded',
      header: 'Custo carregado',
      align: 'right',
      cell: (r) => (
        <span className="text-sm font-semibold tabular-nums text-ig-fg-strong">
          {formatCents(r.loadedMonthlyCostCents)}
        </span>
      ),
    },
    {
      key: 'capacity',
      header: 'Capacidade',
      align: 'right',
      cell: (r) => (
        <span className="text-xs tabular-nums text-ig-fg-muted">
          {r.productiveCapacityHours.toFixed(0)}h
        </span>
      ),
    },
    {
      key: 'hourly',
      header: 'Custo-hora',
      align: 'right',
      cell: (r) => (
        <span className="text-sm font-semibold tabular-nums text-ig-accent">
          {formatCents(r.loadedHourlyCostCents)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (r) => (
        <HudStatusPill
          size="sm"
          variant={
            r.status === 'reconciled'
              ? 'active'
              : r.status === 'processed'
                ? 'info'
                : 'pending'
          }
        >
          {STATUS_LABELS[r.status]}
        </HudStatusPill>
      ),
    },
  ];

  // ── Aba 1 — a página original, intacta ──────────────────────────────────
  const snapshotsTab = (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-56">
          <HudSelect
            label="Competência"
            value={month}
            onChange={setMonth}
            options={[-4, -3, -2, -1, 0].map((i) => {
              const m = addMonths(currentMonth(), i);
              return { value: m, label: monthLabel(m) };
            })}
          />
        </div>
        <HudBadge variant="info">
          custo = salário + encargos + benefícios (folha) + provisões (13º/férias)
        </HudBadge>
      </div>

      <HudKpiStrip kpis={kpis} columns={4} />

      <HudPanel title="Snapshots da competência">
        <HudTable<EmployeeCostSnapshot>
          columns={columns}
          data={snapshots}
          keyExtractor={(r) => r.id}
          loading={loading}
          emptyState={
            <HudEmptyState
              icon="inbox"
              title="Nenhum snapshot nesta competência"
              description={
                canManageCost
                  ? 'Importe/feche a folha da competência em Fechamento da Folha e clique em "Calcular snapshots".'
                  : 'Os snapshots de custo desta competência ainda não foram calculados.'
              }
              action={
                canManageCost
                  ? { label: 'Calcular snapshots', onClick: () => void handleCompute() }
                  : undefined
              }
            />
          }
        />
      </HudPanel>

      <p className="text-[11px] text-ig-fg-muted">
        Snapshots são congelados por competência (histórico reproduzível). Recalcular gera nova
        versão e marca a anterior como substituída — nada é sobrescrito silenciosamente.
      </p>
    </div>
  );

  // ── Aba 2 — composição da folha por competência ─────────────────────────
  const compositionReliable = coverage?.compositionReliable ?? false;

  const payrollTab = (
    <div className="space-y-6">
      {esocialCompetences.length === 0 ? (
        <HudPanel elevation={2}>
          <HudEmptyState
            icon="package"
            title="Nenhuma competência apurada pelo eSocial"
            description="A composição da folha vem dos eventos do eSocial. Importe o pacote do eSocial Download em Configurações → Integrações."
          />
        </HudPanel>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <div className="w-56">
              <HudSelect
                label="Competência"
                value={activeCompetence ?? ''}
                onChange={setCompetence}
                options={esocialCompetences.map((c) => ({ value: c, label: shortMonth(c) }))}
              />
            </div>
            {coverage && (
              <HudBadge variant={coverage.payrollSource === 'rubricas' ? 'success' : 'warning'}>
                fonte: {coverage.payrollSource === 'rubricas' ? 'rubricas classificadas' : 'base apurada pelo eSocial'}
              </HudBadge>
            )}
          </div>

          {/* Procedência antes dos números — o mesmo aviso do cockpit. */}
          <EsocialCoverageNotice coverage={coverage} summary={esocial.coverageSummary} />

          <div className="grid gap-6 lg:grid-cols-2">
            <HudPanel title="Composição da folha" subtitle={activeCompetence ? shortMonth(activeCompetence) : undefined}>
              {compositionReliable ? (
                <div className="space-y-2">
                  <Line label="Proventos (folha bruta)" value={brl(metric?.gross_payroll_cents)} strong />
                  <Line label="Horas extras" value={brl(metric?.overtime_cents)} sub={metric?.overtime_hours ? `${metric.overtime_hours.toFixed(0)} h` : undefined} />
                  <Line label="Benefícios" value={brl(metric?.benefits_cents)} />
                  <Line label="Descontos" value={brl(metric?.deductions_cents)} />
                  <Line label="Líquido pago" value={brl(metric?.net_paid_cents)} strong />
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-ig-fg-muted">
                    A composição desta competência não pode ser publicada: a tabela de rubricas
                    (S-1010) não cobre a folha declarada, então proventos, horas extras, benefícios e
                    descontos não puderam ser separados.
                  </p>
                  <div className="rounded-xl border border-ig-border-subtle p-3">
                    <Line label="Massa apurada pelo eSocial" value={brl(Math.round((coverage?.payroll ?? 0) * 100))} strong />
                    <p className="mt-1 text-[11px] text-ig-fg-muted">
                      Base de cálculo apurada pelo próprio governo — completa, porém sem composição.
                    </p>
                  </div>
                  <p className="text-[11px] text-ig-fg-muted">
                    Cobertura de rubricas: {((coverage?.rubricCoverage ?? 0) * 100).toFixed(1)}%.
                  </p>
                </div>
              )}
            </HudPanel>

            <HudPanel title="Encargos e bases" subtitle="Valores dos totalizadores, apurados pelo eSocial">
              <div className="space-y-2">
                <Line label="INSS (guia)" value={brl(metric?.inss_cents)} strong />
                <Line label="INSS retido dos segurados" value={brl(metric?.inss_withheld_cents)} />
                <Line label="IRRF (guia)" value={brl(metric?.irrf_cents)} strong />
                <Line label="FGTS (guia)" value={brl(metric?.fgts_cents)} strong />
                <Line label="Base CP" value={brl(metric?.cp_base_cents)} />
                <Line label="Base FGTS" value={brl(metric?.fgts_base_cents)} />
                <Line
                  label="Alíquota RAT × FAP"
                  value={metric?.rat_fap_rate != null ? `${(metric.rat_fap_rate * 100).toFixed(2)}%` : NA}
                />
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-ig-fg-muted">
                {NA} aqui significa que o totalizador correspondente ainda não chegou no acervo —
                distinto de zero, que significaria &ldquo;apurado e sem valor a recolher&rdquo;.
              </p>
            </HudPanel>
          </div>

          <HudPanel title="Série por competência" subtitle="Massa, encargos e quadro mês a mês">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-ig-border text-left text-[11px] uppercase tracking-wide text-ig-fg-muted">
                    <th className="py-2 pr-3">Competência</th>
                    <th className="py-2 pr-3 text-right">Massa</th>
                    <th className="py-2 pr-3 text-right">INSS</th>
                    <th className="py-2 pr-3 text-right">FGTS</th>
                    <th className="py-2 pr-3 text-right">IRRF</th>
                    <th className="py-2 pr-3 text-right">Quadro</th>
                    <th className="py-2 text-right">Rubricas</th>
                  </tr>
                </thead>
                <tbody>
                  {esocialCompetences.map((c) => {
                    const m = esocial.metricsByCompetence[c];
                    const cov = esocial.coverageByCompetence[c];
                    return (
                      <tr key={c} className="border-b border-ig-border-subtle last:border-0">
                        <td className="py-2 pr-3 text-ig-fg-strong">{shortMonth(c)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums text-ig-fg-strong">
                          {brl(Math.round((cov?.payroll ?? 0) * 100))}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums text-ig-fg-muted">{brl(m?.inss_cents)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums text-ig-fg-muted">{brl(m?.fgts_cents)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums text-ig-fg-muted">{brl(m?.irrf_cents)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums text-ig-fg-muted">{m?.headcount || NA}</td>
                        <td className="py-2 text-right tabular-nums">
                          {cov?.compositionReliable ? (
                            <span className="text-ig-success">{(cov.rubricCoverage * 100).toFixed(0)}%</span>
                          ) : cov && cov.rubricCoverage > 0 ? (
                            <span className="text-ig-warning">{(cov.rubricCoverage * 100).toFixed(0)}%</span>
                          ) : (
                            <span className="text-ig-fg-subtle">{NA}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </HudPanel>
        </>
      )}
    </div>
  );

  // ── Aba 3 — centro de custo e lotação ───────────────────────────────────
  const areasForCompetence = useMemo(
    () => esocial.areas.filter((a) => a.competence === activeCompetence),
    [esocial.areas, activeCompetence],
  );

  const costCenterTab = (
    <div className="space-y-6">
      {esocialCompetences.length === 0 ? (
        <HudPanel elevation={2}>
          <HudEmptyState
            icon="package"
            title="Nenhuma competência apurada"
            description="O recorte por lotação vem dos totalizadores do eSocial, que apuram a base por lotação tributária."
          />
        </HudPanel>
      ) : (
        <>
          <div className="w-56">
            <HudSelect
              label="Competência"
              value={activeCompetence ?? ''}
              onChange={setCompetence}
              options={esocialCompetences.map((c) => ({ value: c, label: shortMonth(c) }))}
            />
          </div>

          <HudPanel title="Custo por lotação (eSocial)" subtitle="Base apurada pelo governo, independente da tabela de rubricas">
            {areasForCompetence.length === 0 ? (
              <HudEmptyState icon="inbox" compact title="Sem recorte por lotação nesta competência" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-ig-border text-left text-[11px] uppercase tracking-wide text-ig-fg-muted">
                      <th className="py-2 pr-3">Lotação</th>
                      <th className="py-2 pr-3 text-right">Quadro</th>
                      <th className="py-2 pr-3 text-right">Base apurada</th>
                      <th className="py-2 pr-3 text-right">Bruto (rubricas)</th>
                      <th className="py-2 text-right">Horas extras</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...areasForCompetence]
                      .sort((a, b) => (b.base_cents || b.gross_cents) - (a.base_cents || a.gross_cents))
                      .map((a) => (
                        <tr key={a.area_code} className="border-b border-ig-border-subtle last:border-0">
                          <td className="py-2 pr-3">
                            <p className="text-ig-fg-strong">{a.area_label}</p>
                            <p className="font-mono text-[11px] text-ig-fg-muted">{a.area_code}</p>
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums text-ig-fg-muted">{a.headcount || NA}</td>
                          <td className="py-2 pr-3 text-right tabular-nums text-ig-fg-strong">{a.base_cents ? brl(a.base_cents) : NA}</td>
                          <td className="py-2 pr-3 text-right tabular-nums text-ig-fg-muted">{a.gross_cents ? brl(a.gross_cents) : NA}</td>
                          <td className="py-2 text-right tabular-nums text-ig-fg-muted">{a.overtime_cents ? brl(a.overtime_cents) : NA}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-[11px] leading-relaxed text-ig-fg-muted">
              A lotação tributária do eSocial e o centro de custo do financeiro são eixos distintos.
              As lotações sem correspondência aparecem em{' '}
              <a href="/workforce-cost/fechamento-folha?tab=esocial" className="text-ig-accent hover:underline">
                Fechamento da Folha → Controle eSocial
              </a>
              , de onde é possível criar o vínculo.
            </p>
          </HudPanel>
        </>
      )}
    </div>
  );

  // ── Aba 4 — variação salarial ───────────────────────────────────────────
  const salaryColumns: HudTableColumn<PersonSalaryHistory>[] = [
    {
      key: 'name',
      header: 'Colaborador',
      cell: (r) => (
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ig-fg-strong">{r.fullName}</p>
          <p className="text-xs text-ig-fg-muted">{r.costCenterLabel ?? NA}</p>
        </div>
      ),
    },
    {
      key: 'current',
      header: 'Bruto atual',
      align: 'right',
      cell: (r) => <span className="text-sm tabular-nums text-ig-fg-strong">{brl(r.currentGrossCents)}</span>,
    },
    {
      key: 'lastRaise',
      header: 'Último reajuste',
      cell: (r) => (
        <span className="text-sm tabular-nums text-ig-fg-muted">
          {r.lastRaiseCompetence ? shortMonth(r.lastRaiseCompetence) : NA}
        </span>
      ),
    },
    {
      key: 'pct',
      header: 'Variação',
      align: 'right',
      cell: (r) =>
        r.lastRaisePercent === null ? (
          <span className="text-sm text-ig-fg-subtle">{NA}</span>
        ) : (
          <span className={`text-sm tabular-nums ${r.lastRaisePercent < 0 ? 'text-ig-danger' : 'text-ig-success'}`}>
            {r.lastRaisePercent > 0 ? '+' : ''}{r.lastRaisePercent.toFixed(1)}%
          </span>
        ),
    },
    {
      key: 'months',
      header: 'Meses no patamar',
      align: 'right',
      cell: (r) => (
        <span className="text-sm tabular-nums text-ig-fg-muted">
          {r.monthsSinceLastRaise === null ? NA : `${r.monthsIsLowerBound ? '≥ ' : ''}${r.monthsSinceLastRaise}`}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Situação',
      cell: (r) => (
        <HudStatusPill
          size="sm"
          variant={r.raiseStatus === 'stale' ? 'warning' : r.raiseStatus === 'recent' ? 'active' : 'neutral'}
        >
          {r.raiseStatus === 'stale' ? '+12 meses sem reajuste' : r.raiseStatus === 'recent' ? 'Reajustado' : 'Não determinado'}
        </HudStatusPill>
      ),
    },
  ];

  const salaryTab = (
    <div className="space-y-6">
      {salaryError === 'sem-permissao' ? (
        <HudPanel elevation={2}>
          <HudEmptyState
            icon="alert"
            title="Acesso restrito"
            description="A variação salarial por colaborador exige a permissão people.view_salary."
          />
        </HudPanel>
      ) : salaryError ? (
        <HudPanel state="critical">
          <p className="text-sm text-ig-danger">{salaryError}</p>
        </HudPanel>
      ) : !salary ? (
        <HudPanel elevation={2}>
          <HudEmptyState icon="package" compact title="Carregando série salarial…" />
        </HudPanel>
      ) : salary.people.length === 0 ? (
        <HudPanel elevation={2}>
          <HudEmptyState
            icon="package"
            title="Sem série salarial apurada"
            description="A série vem das linhas por colaborador dos lotes de fechamento aprovados. Aprove ao menos duas competências para que patamares possam ser identificados."
          />
        </HudPanel>
      ) : (
        <>
          <HudKpiStrip
            columns={4}
            size="sm"
            kpis={[
              { id: 'matched', label: 'Colaboradores na série', value: salary.counts.peopleMatched },
              {
                id: 'stale',
                label: 'Sem reajuste há +12 meses',
                value: salary.counts.withoutRaise12m,
                variant: salary.counts.withoutRaise12m > 0 ? 'warning' : 'default',
                deltaLabel: 'Comprovado pela série',
              },
              { id: 'recent', label: 'Reajustados no período', value: salary.counts.raisedWithin12m },
              {
                id: 'indeterminate',
                label: 'Não determinado',
                // Nunca semântico: é curtidão de série, não desempenho.
                value: salary.counts.indeterminate,
                deltaLabel: 'Série curta demais para afirmar',
              },
            ]}
          />

          {salary.notes.length > 0 && (
            <HudPanel elevation={1}>
              <ul className="space-y-1.5">
                {salary.notes.map((n, i) => (
                  <li key={i} className="text-[11px] leading-relaxed text-ig-fg-muted">{n}</li>
                ))}
              </ul>
            </HudPanel>
          )}

          <HudPanel title="Variação salarial por colaborador" subtitle="Patamar = dois meses consecutivos no mesmo bruto; mês variável (13º, férias) não abre patamar">
            <HudTable<PersonSalaryHistory>
              columns={salaryColumns}
              data={salary.people}
              keyExtractor={(r) => r.personId}
            />
          </HudPanel>

          {salary.unmatched.length > 0 && (
            <HudPanel title="Nomes da folha sem pessoa vinculada" subtitle="Ficam fora dos indicadores por pessoa — declarados, nunca descartados" state="warning">
              <div className="space-y-1.5">
                {salary.unmatched.slice(0, 20).map((u) => (
                  <div key={u.normalizedName} className="flex items-center justify-between gap-3 border-b border-ig-border-subtle pb-1.5 last:border-0">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-ig-fg-strong">{u.employeeName}</p>
                      <p className="text-[11px] text-ig-fg-muted">{u.competences.length} competência(s)</p>
                    </div>
                    <span className="shrink-0 text-sm tabular-nums text-ig-fg-muted">{brl(u.lastGrossCents)}</span>
                  </div>
                ))}
              </div>
            </HudPanel>
          )}
        </>
      )}
    </div>
  );

  const tabs: HudTab[] = [
    { id: 'snapshots', label: 'Custo por Colaborador', icon: <Users className="h-4 w-4" />, content: snapshotsTab },
    { id: 'payroll', label: 'Folha por Competência', icon: <Coins className="h-4 w-4" />, content: payrollTab },
    { id: 'costcenter', label: 'Centro de Custo & Lotação', icon: <Layers className="h-4 w-4" />, content: costCenterTab },
    { id: 'salary', label: 'Variação Salarial', icon: <TrendingUp className="h-4 w-4" />, content: salaryTab },
  ];

  return (
    <HudPageLayout>
      <div className="space-y-6">
        <HudHeader
          title="Folha & Encargos"
          subtitle={`Custo de mão de obra, composição da folha e encargos · ${monthLabel(month)}`}
          icon={<Coins className="h-5 w-5" />}
          breadcrumbs={[
            { label: 'Pessoas & Custos', href: '/workforce-cost' },
            { label: 'Folha & Encargos' },
          ]}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <ExportReportButton
                size="sm"
                permission="people.cost_view"
                fallbackPermission="people.view"
                build={() =>
                  openPayrollCostReport({
                    competences: esocial.competences,
                    coverageByCompetence: esocial.coverageByCompetence,
                    areas: esocial.areas,
                    snapshots,
                    snapshotMonth: month,
                    salary,
                  })
                }
              />
              {canManageCost && (
                <HudButton
                  variant="primary"
                  leftIcon={<Calculator className="h-4 w-4" />}
                  disabled={busy}
                  onClick={() => void handleCompute()}
                >
                  {busy ? 'Calculando…' : 'Calcular snapshots da competência'}
                </HudButton>
              )}
            </div>
          }
        />

        {!canViewCost && (
          <HudPanel state="critical">
            <p className="text-sm text-ig-danger">
              Sem permissão para visualizar custo individual (people.cost_view).
            </p>
          </HudPanel>
        )}
        {error && canViewCost && (
          <HudPanel state="critical">
            <p className="text-sm text-ig-danger">{error}</p>
          </HudPanel>
        )}

        <HudTabs tabs={tabs} variant="underline" contentClassName="mt-5" />
      </div>
    </HudPageLayout>
  );
}

/** Linha rótulo → valor das fichas de composição. */
function Line({ label, value, sub, strong }: { label: string; value: string; sub?: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-ig-border-subtle py-1.5 last:border-0">
      <div className="min-w-0">
        <span className="text-sm text-ig-fg-muted">{label}</span>
        {sub && <span className="ml-2 text-[11px] text-ig-fg-subtle">{sub}</span>}
      </div>
      <span
        className={`shrink-0 tabular-nums ${
          strong ? 'text-sm font-semibold text-ig-fg-strong' : 'text-sm text-ig-fg-muted'
        }`}
      >
        {value}
      </span>
    </div>
  );
}
