'use client';

/**
 * Custo de Mão de Obra — corporate cost snapshots (Fase 6, spec §8/§21).
 * Computes the loaded monthly cost + loaded hourly cost per person from
 * the payroll batch of the competence (encargos/benefícios rateados,
 * provisões estimadas) and freezes it as an EmployeeCostSnapshot.
 * Reading requires people.cost_view (RLS enforced); computing requires
 * people.cost_manage.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Calculator, Coins, Users, Wallet } from 'lucide-react';
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
  useHudToast,
  type HudTableColumn,
  type KpiItem,
} from '@/components/hud';
import { usePermissions } from '@/hooks/use-permissions';
import type { EmployeeCostSnapshot } from '@/lib/types/people';
import { computeCostSnapshots, formatCents, listSnapshots } from '@/lib/services/cost';

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

  return (
    <HudPageLayout>
      <div className="space-y-6">
        <HudHeader
          title="Custo de Mão de Obra"
          subtitle={`Snapshots de custo carregado por competência · ${monthLabel(month)}`}
          icon={<Coins className="h-5 w-5" />}
          breadcrumbs={[
            { label: 'Pessoas & Custos', href: '/workforce-cost' },
            { label: 'Custo de MO' },
          ]}
          actions={
            canManageCost ? (
              <HudButton
                variant="primary"
                leftIcon={<Calculator className="h-4 w-4" />}
                disabled={busy}
                onClick={() => void handleCompute()}
              >
                {busy ? 'Calculando…' : 'Calcular snapshots da competência'}
              </HudButton>
            ) : undefined
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

        <HudPanel title="Snapshots da competência" accentColor="emerald">
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
    </HudPageLayout>
  );
}
