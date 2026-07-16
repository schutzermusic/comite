'use client';

/**
 * Custos de mão de obra do projeto (Fase 6, spec §8 + D1).
 * Consolida horas aprovadas × snapshot de custo da competência em
 * project_labor_cost_periods e exibe planejado × estimado × reconciliado
 * + margem (receita do contrato − custo MO). Valores individuais são
 * mascarados sem people.cost_view; a consolidação exige people.cost_manage.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Calculator, Coins, TrendingDown, TrendingUp } from 'lucide-react';
import {
  HudButton,
  HudEmptyState,
  HudKpiStrip,
  HudPanel,
  HudSelect,
  HudStatusPill,
  HudTable,
  useHudToast,
  type HudTableColumn,
  type KpiItem,
} from '@/components/hud';
import { usePermissions } from '@/hooks/use-permissions';
import type { ProjectLaborCostPeriod } from '@/lib/types/people';
import {
  computeProjectLaborCost,
  computeProjectMargin,
  formatCents,
  listProjectLaborCost,
} from '@/lib/services/cost';
import { maskCost } from '@/lib/services/capacity';
import { getProjectV2ByIdAsync } from '@/lib/services/projects';

const STATUS_LABELS: Record<ProjectLaborCostPeriod['status'], string> = {
  open: 'Aberto',
  estimated: 'Estimado',
  payroll_processed: 'Folha processada',
  reconciled: 'Reconciliado',
  locked: 'Travado',
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

export function ProjectLaborCostPanel({ projectId }: { projectId: string }) {
  const { hasPermission } = usePermissions();
  const { notify } = useHudToast();
  const canViewCost = hasPermission('people.cost_view');
  const canManageCost = hasPermission('people.cost_manage');

  const [month, setMonth] = useState(currentMonth());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<ProjectLaborCostPeriod[]>([]);
  const [revenueBilledCents, setRevenueBilledCents] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [costRows, projectV2] = await Promise.all([
        listProjectLaborCost(projectId, month),
        getProjectV2ByIdAsync(projectId).catch(() => undefined),
      ]);
      setRows(costRows);
      const billed = projectV2?.revenue?.billed;
      setRevenueBilledCents(typeof billed === 'number' ? Math.round(billed * 100) : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar custos');
    } finally {
      setLoading(false);
    }
  }, [projectId, month]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function handleCompute() {
    setBusy(true);
    try {
      const result = await computeProjectLaborCost(projectId, month);
      notify('Custos consolidados', {
        description: `${result.length} colaborador(es) na competência ${month}.`,
        variant: 'success',
      });
      await reload();
    } catch (e) {
      notify('Erro ao consolidar custos', {
        description: e instanceof Error ? e.message : undefined,
        variant: 'error',
      });
    } finally {
      setBusy(false);
    }
  }

  /* ── totals + margin ── */

  const totals = useMemo(() => {
    const planned = rows.reduce((s, r) => s + r.plannedCostCents, 0);
    const estimated = rows.reduce((s, r) => s + r.estimatedActualCostCents, 0);
    const reconciled = rows.reduce((s, r) => s + r.reconciledActualCostCents, 0);
    const actual = reconciled || estimated;
    return { planned, estimated, reconciled, actual, variance: actual - planned };
  }, [rows]);

  const margin = useMemo(
    () => computeProjectMargin(projectId, month, rows, revenueBilledCents),
    [projectId, month, rows, revenueBilledCents],
  );

  const kpis: KpiItem[] = [
    {
      id: 'planned',
      label: 'Custo planejado',
      value: maskCost(formatCents(totals.planned, true), canViewCost),
      icon: <Coins className="h-4 w-4" />,
    },
    {
      id: 'estimated',
      label: 'Realizado estimado',
      value: maskCost(formatCents(totals.estimated, true), canViewCost),
    },
    {
      id: 'reconciled',
      label: 'Reconciliado',
      value: maskCost(
        totals.reconciled > 0 ? formatCents(totals.reconciled, true) : '—',
        canViewCost,
      ),
      variant: 'success',
    },
    {
      id: 'variance',
      label: 'Variação vs planejado',
      value: maskCost(formatCents(totals.variance, true), canViewCost),
      variant: totals.variance > 0 ? 'danger' : 'success',
      tintValue: true,
      icon:
        totals.variance > 0 ? (
          <TrendingUp className="h-4 w-4" />
        ) : (
          <TrendingDown className="h-4 w-4" />
        ),
    },
    {
      id: 'margin',
      label: 'Margem (vs faturado)',
      value:
        margin.marginPercentage == null
          ? '—'
          : maskCost(`${margin.marginPercentage.toFixed(1)}%`, canViewCost),
      variant:
        margin.marginPercentage == null
          ? 'default'
          : margin.marginPercentage < 0
            ? 'danger'
            : 'success',
      tintValue: margin.marginPercentage != null,
    },
  ];

  /* ── table ── */

  const columns: HudTableColumn<ProjectLaborCostPeriod>[] = [
    {
      key: 'person',
      header: 'Colaborador',
      cell: (r) => (
        <span className="text-sm font-medium text-ig-fg-strong">
          {r.person?.fullName ?? '—'}
        </span>
      ),
    },
    {
      key: 'plannedHours',
      header: 'Horas plan.',
      align: 'right',
      cell: (r) => (
        <span className="text-sm tabular-nums text-ig-fg-muted">
          {r.plannedHours.toFixed(0)}h
        </span>
      ),
    },
    {
      key: 'approvedHours',
      header: 'Horas aprov.',
      align: 'right',
      cell: (r) => (
        <span className="text-sm tabular-nums text-ig-fg-strong">
          {r.approvedHours.toFixed(1).replace('.', ',')}h
        </span>
      ),
    },
    {
      key: 'plannedCost',
      header: 'Custo planejado',
      align: 'right',
      cell: (r) => (
        <span className="text-sm tabular-nums text-ig-fg-muted">
          {maskCost(formatCents(r.plannedCostCents), canViewCost)}
        </span>
      ),
    },
    {
      key: 'estimated',
      header: 'Realizado estimado',
      align: 'right',
      cell: (r) => (
        <span className="text-sm tabular-nums text-ig-fg-strong">
          {maskCost(formatCents(r.estimatedActualCostCents), canViewCost)}
        </span>
      ),
    },
    {
      key: 'variance',
      header: 'Variação',
      align: 'right',
      cell: (r) => (
        <span
          className={`text-sm tabular-nums ${r.varianceAmountCents > 0 ? 'text-ig-danger' : 'text-ig-success'}`}
        >
          {maskCost(formatCents(r.varianceAmountCents), canViewCost)}
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
            r.status === 'reconciled' || r.status === 'locked'
              ? 'active'
              : r.status === 'payroll_processed'
                ? 'info'
                : r.status === 'estimated'
                  ? 'pending'
                  : 'neutral'
          }
        >
          {STATUS_LABELS[r.status]}
        </HudStatusPill>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      {error && (
        <HudPanel state="critical">
          <p className="text-sm text-ig-danger">{error}</p>
        </HudPanel>
      )}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="w-56">
          <HudSelect
            label="Competência"
            value={month}
            onChange={setMonth}
            options={[-3, -2, -1, 0].map((i) => {
              const m = addMonths(currentMonth(), i);
              return { value: m, label: monthLabel(m) };
            })}
          />
        </div>
        {canManageCost && (
          <HudButton
            variant="primary"
            leftIcon={<Calculator className="h-4 w-4" />}
            disabled={busy}
            onClick={() => void handleCompute()}
          >
            {busy ? 'Consolidando…' : 'Consolidar custos da competência'}
          </HudButton>
        )}
      </div>

      <HudKpiStrip kpis={kpis} columns={5} />

      {/* margem — leitura executiva (D1) */}
      {canViewCost && margin.revenueCents != null && (
        <HudPanel title="Margem do projeto" accentColor="emerald">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <MarginCell label="Receita faturada" value={formatCents(margin.revenueCents)} />
            <MarginCell label="Custo MO (competência)" value={formatCents(margin.laborCostCents)} />
            <MarginCell
              label="Margem"
              value={formatCents(margin.marginCents)}
              tone={margin.marginCents != null && margin.marginCents < 0 ? 'danger' : 'success'}
            />
            <MarginCell
              label="Margem %"
              value={
                margin.marginPercentage == null ? '—' : `${margin.marginPercentage.toFixed(1)}%`
              }
              tone={
                margin.marginPercentage != null && margin.marginPercentage < 0
                  ? 'danger'
                  : 'success'
              }
            />
          </div>
          <p className="mt-3 text-[11px] text-ig-fg-muted">
            Margem = receita faturada do contrato − custo de mão de obra da competência. Outros
            custos do ledger entram na visão Financeiro.
          </p>
        </HudPanel>
      )}

      <HudPanel title={`Custo por colaborador · ${monthLabel(month)}`} accentColor="emerald">
        <HudTable<ProjectLaborCostPeriod>
          columns={columns}
          data={rows}
          keyExtractor={(r) => r.id}
          loading={loading}
          emptyState={
            <HudEmptyState
              icon="inbox"
              title="Sem consolidação nesta competência"
              description={
                canManageCost
                  ? 'Calcule os snapshots de custo em Pessoas & Custos → Custo de MO e clique em "Consolidar custos da competência".'
                  : 'A consolidação de custos ainda não foi executada para esta competência.'
              }
            />
          }
        />
      </HudPanel>
    </div>
  );
}

function MarginCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'success' | 'danger';
}) {
  return (
    <div className="rounded-lg border border-ig-border-subtle bg-ig-panel/60 px-4 py-3">
      <p className="text-[10px] font-medium uppercase tracking-wider text-ig-fg-muted">{label}</p>
      <p
        className={`mt-1 text-lg font-semibold tabular-nums ${
          tone === 'success'
            ? 'text-ig-success'
            : tone === 'danger'
              ? 'text-ig-danger'
              : 'text-ig-fg-strong'
        }`}
      >
        {value}
      </p>
    </div>
  );
}
