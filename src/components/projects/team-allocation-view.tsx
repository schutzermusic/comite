'use client';

/**
 * Equipe do projeto — enterprise allocation view (spec: plan/
 * INSIGHT_APEX_ALOCACAO_APONTAMENTO_ARQUITETURA.md, seção 9).
 * Live-first: project_allocations via Supabase RLS; read-only demo
 * fallback when the table is empty (risk-demo-data pattern).
 * Individual cost is gated by people.cost_view (masked otherwise).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarRange,
  Info,
  Coins,
  History,
  LayoutGrid,
  Pencil,
  Plus,
  StopCircle,
  Users,
} from 'lucide-react';
import {
  HudBadge,
  HudButton,
  HudDrawer,
  HudEmptyState,
  HudInput,
  HudKpiStrip,
  HudModal,
  HudPanel,
  HudSelect,
  HudStatusPill,
  HudTable,
  HudTabs,
  useHudToast,
  type HudTableColumn,
  type KpiItem,
} from '@/components/hud';
import { usePermissions } from '@/hooks/use-permissions';
import type { Person, PersonProjectAllocation } from '@/lib/types/people';
import {
  ALLOCATION_STATUS_LABELS,
  ALLOCATION_TYPE_LABELS,
} from '@/lib/types/people';
import {
  createAllocation,
  endAllocation,
  listAllocationsByProject,
  listLiveAllocationsInPeriod,
  updateAllocation,
  validateAllocation,
  LIVE_ALLOCATION_STATUSES,
} from '@/lib/services/allocations';
import { listPeople } from '@/lib/services/people';
import { computeProjectFte, maskCost, monthBounds } from '@/lib/services/capacity';
import {
  buildDemoCorporateAllocations,
  buildDemoTeamAllocations,
  DEMO_PEOPLE,
} from './team-demo-data';
import { ProjectLaborCostPanel } from './project-labor-cost-panel';

/* ─────────────────────────── helpers ─────────────────────────── */

function formatDate(date: string | null): string {
  if (!date) return 'aberto';
  const [y, m, d] = date.split('-');
  return `${d}/${m}/${y.slice(2)}`;
}

function formatPeriod(a: PersonProjectAllocation): string {
  return `${formatDate(a.startDate)} – ${formatDate(a.endDate)}`;
}

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
  return new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
}

function allocationCoversMonth(a: PersonProjectAllocation, month: string): boolean {
  const [start, end] = monthBounds(month);
  return a.startDate <= end && (a.endDate == null || a.endDate >= start);
}

function initials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

type KpiFilter = 'all' | 'overloaded' | 'available' | 'pending';

/* ─────────────────────────── component ───────────────────────── */

interface TeamAllocationViewProps {
  projectId: string;
}

export function TeamAllocationView({ projectId }: TeamAllocationViewProps) {
  const { hasPermission } = usePermissions();
  const { notify } = useHudToast();

  const canManage = hasPermission('people.allocations_manage');
  const canViewCost = hasPermission('people.cost_view');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [allocations, setAllocations] = useState<PersonProjectAllocation[]>([]);
  const [corporate, setCorporate] = useState<PersonProjectAllocation[]>([]);
  const [people, setPeople] = useState<Person[]>([]);

  const [kpiFilter, setKpiFilter] = useState<KpiFilter>('all');
  const [drawerAllocation, setDrawerAllocation] = useState<PersonProjectAllocation | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PersonProjectAllocation | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [start] = monthBounds(currentMonth());
      const [end] = monthBounds(addMonths(currentMonth(), 12));
      const [projectAllocs, liveAllocs, allPeople] = await Promise.all([
        listAllocationsByProject(projectId),
        listLiveAllocationsInPeriod(start, end),
        listPeople({ status: 'active' }).catch(() => [] as Person[]),
      ]);
      setAllocations(projectAllocs);
      setCorporate(liveAllocs);
      setPeople(allPeople);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar equipe');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const usingDemo = !loading && !error && allocations.length === 0;
  const sourceAllocations = usingDemo ? buildDemoTeamAllocations(projectId) : allocations;
  const sourceCorporate = usingDemo ? buildDemoCorporateAllocations(projectId) : corporate;
  const sourcePeople = usingDemo ? DEMO_PEOPLE : people;

  const blockDemo = useCallback((): boolean => {
    if (usingDemo) {
      notify('Indisponível em modo demo', {
        description: 'Cadastre alocações reais para habilitar a edição.',
        variant: 'warning',
      });
      return true;
    }
    return false;
  }, [usingDemo, notify]);

  /* ── derived data ── */

  const liveTeam = useMemo(
    () => sourceAllocations.filter((a) => LIVE_ALLOCATION_STATUSES.includes(a.status)),
    [sourceAllocations],
  );
  const historyRows = useMemo(
    () => sourceAllocations.filter((a) => !LIVE_ALLOCATION_STATUSES.includes(a.status)),
    [sourceAllocations],
  );

  /** Σ live % per person across ALL projects (current window). */
  const corporateTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const a of sourceCorporate) {
      if (!LIVE_ALLOCATION_STATUSES.includes(a.status)) continue;
      totals.set(a.personId, (totals.get(a.personId) ?? 0) + a.plannedPercentage);
    }
    return totals;
  }, [sourceCorporate]);

  const enriched = useMemo(
    () =>
      liveTeam.map((a) => {
        const totalPct = corporateTotals.get(a.personId) ?? a.plannedPercentage;
        return {
          allocation: a,
          totalPct,
          availablePct: 100 - totalPct,
          overloaded: totalPct > 100,
        };
      }),
    [liveTeam, corporateTotals],
  );

  const kpis = useMemo(() => {
    const overloaded = enriched.filter((e) => e.overloaded).length;
    const available = enriched.filter((e) => e.availablePct > 0).length;
    const pending = sourceAllocations.filter((a) => a.status === 'pending_approval').length;
    return {
      count: enriched.length,
      fte: computeProjectFte(liveTeam),
      avgPct:
        enriched.length > 0
          ? enriched.reduce((s, e) => s + e.allocation.plannedPercentage, 0) / enriched.length
          : 0,
      overloaded,
      available,
      pending,
    };
  }, [enriched, liveTeam, sourceAllocations]);

  const filteredRows = useMemo(() => {
    switch (kpiFilter) {
      case 'overloaded':
        return enriched.filter((e) => e.overloaded);
      case 'available':
        return enriched.filter((e) => e.availablePct > 0);
      case 'pending':
        return enriched.filter((e) => e.allocation.status === 'pending_approval');
      default:
        return enriched;
    }
  }, [enriched, kpiFilter]);

  const toggleFilter = (f: KpiFilter) => setKpiFilter((cur) => (cur === f ? 'all' : f));

  const kpiItems: KpiItem[] = [
    {
      id: 'people',
      label: 'Pessoas alocadas',
      value: kpis.count,
      icon: <Users className="h-4 w-4" />,
      onClick: () => toggleFilter('all'),
      active: kpiFilter === 'all',
    },
    {
      id: 'fte',
      label: 'FTE alocado',
      value: kpis.fte.toFixed(2).replace('.', ','),
    },
    {
      id: 'avg',
      label: '% média no projeto',
      value: `${kpis.avgPct.toFixed(0)}%`,
    },
    {
      id: 'overloaded',
      label: 'Sobrecarregados',
      value: kpis.overloaded,
      variant: kpis.overloaded > 0 ? 'danger' : 'default',
      tintValue: kpis.overloaded > 0,
      icon: <AlertTriangle className="h-4 w-4" />,
      onClick: () => toggleFilter('overloaded'),
      active: kpiFilter === 'overloaded',
    },
    {
      id: 'available',
      label: 'Com disponibilidade',
      value: kpis.available,
      variant: 'success',
      onClick: () => toggleFilter('available'),
      active: kpiFilter === 'available',
    },
    {
      id: 'pending',
      label: 'Aguardando aprovação',
      value: kpis.pending,
      variant: kpis.pending > 0 ? 'warning' : 'default',
      onClick: () => toggleFilter('pending'),
      active: kpiFilter === 'pending',
    },
  ];

  /* ── table ── */

  type Row = (typeof enriched)[number];

  const columns: HudTableColumn<Row>[] = [
    {
      key: 'person',
      header: 'Colaborador',
      cell: (r) => (
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-ig-border bg-ig-panel text-[11px] font-semibold text-ig-fg-strong">
            {initials(r.allocation.person?.fullName ?? '—')}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ig-fg-strong">
              {r.allocation.person?.fullName ?? '—'}
            </p>
            <p className="truncate text-xs text-ig-fg-muted">
              {r.allocation.person?.jobTitle ?? r.allocation.person?.department ?? ''}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Função no projeto',
      cell: (r) => (
        <span className="text-sm text-ig-fg-muted">{r.allocation.roleTitle ?? '—'}</span>
      ),
    },
    {
      key: 'projectPct',
      header: 'Neste projeto',
      align: 'right',
      cell: (r) => (
        <span className="text-sm font-semibold tabular-nums text-ig-fg-strong">
          {r.allocation.plannedPercentage.toFixed(0)}%
        </span>
      ),
    },
    {
      key: 'totalPct',
      header: 'Total empresa',
      align: 'right',
      cell: (r) => (
        <span
          className={`text-sm font-semibold tabular-nums ${r.overloaded ? 'text-ig-danger' : 'text-ig-fg-strong'}`}
        >
          {r.totalPct.toFixed(0)}%
        </span>
      ),
    },
    {
      key: 'available',
      header: 'Disponível',
      align: 'right',
      cell: (r) => (
        <span
          className={`text-sm tabular-nums ${
            r.availablePct < 0 ? 'text-ig-danger' : r.availablePct === 0 ? 'text-ig-warning' : 'text-ig-success'
          }`}
        >
          {r.availablePct.toFixed(0)}%
        </span>
      ),
    },
    {
      key: 'period',
      header: 'Período',
      cell: (r) => (
        <span className="text-xs tabular-nums text-ig-fg-muted">{formatPeriod(r.allocation)}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (r) => {
        if (r.overloaded) return <HudStatusPill variant="critical">Sobrecarga</HudStatusPill>;
        if (r.allocation.status === 'pending_approval') {
          return <HudStatusPill variant="pending">Aguardando</HudStatusPill>;
        }
        if (r.availablePct === 0) return <HudStatusPill variant="warning">Completo</HudStatusPill>;
        return <HudStatusPill variant="active">Disponível</HudStatusPill>;
      },
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (r) =>
        canManage ? (
          <div className="flex items-center justify-end gap-1">
            <button
              type="button"
              title="Editar alocação"
              className="rounded-md p-1.5 text-ig-fg-muted transition-colors hover:bg-ig-panel-hover hover:text-ig-fg-strong"
              onClick={(e) => {
                e.stopPropagation();
                if (blockDemo()) return;
                setEditing(r.allocation);
                setModalOpen(true);
              }}
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              title="Encerrar alocação"
              className="rounded-md p-1.5 text-ig-fg-muted transition-colors hover:bg-ig-panel-hover hover:text-ig-danger"
              onClick={(e) => {
                e.stopPropagation();
                if (blockDemo()) return;
                void handleEnd(r.allocation);
              }}
            >
              <StopCircle className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null,
    },
  ];

  /* ── mutations ── */

  async function handleEnd(allocation: PersonProjectAllocation) {
    if (!window.confirm(`Encerrar a alocação de ${allocation.person?.fullName ?? 'colaborador'} hoje?`)) return;
    try {
      await endAllocation(allocation.id);
      notify('Alocação encerrada', { variant: 'success' });
      await reload();
    } catch (e) {
      notify('Erro ao encerrar alocação', {
        description: e instanceof Error ? e.message : undefined,
        variant: 'error',
      });
    }
  }

  /* ── matrix (person × months) ── */

  const matrixMonths = useMemo(() => {
    const base = currentMonth();
    return [0, 1, 2, 3, 4, 5].map((i) => addMonths(base, i));
  }, []);

  /* ── render ── */

  return (
    <div className="space-y-5">
      {usingDemo && (
        <div className="flex items-center gap-2">
          <HudBadge variant="warning">dados demonstrativos</HudBadge>
          <span className="text-xs text-ig-fg-muted">
            Nenhuma alocação cadastrada neste projeto — exibindo exemplo. Ações de escrita estão
            desativadas.
          </span>
        </div>
      )}
      {error && (
        <HudPanel state="critical">
          <p className="text-sm text-ig-danger">{error}</p>
        </HudPanel>
      )}

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <HudKpiStrip kpis={kpiItems} columns={6} size="md" />
        </div>
        {canManage && (
          <HudButton
            variant="primary"
            leftIcon={<Plus className="h-4 w-4" />}
            onClick={() => {
              setEditing(null);
              setModalOpen(true);
            }}
          >
            Alocar pessoa
          </HudButton>
        )}
      </div>

      <HudTabs
        tabs={[
          {
            id: 'overview',
            label: 'Visão geral',
            icon: <Users className="h-4 w-4" />,
            content: (
              <HudPanel>
                <HudTable<Row>
                  columns={columns}
                  data={filteredRows}
                  keyExtractor={(r) => r.allocation.id}
                  loading={loading}
                  onRowClick={(r) => setDrawerAllocation(r.allocation)}
                  selectedRowId={drawerAllocation?.id ?? null}
                  emptyState={
                    <HudEmptyState
                      icon="inbox"
                      title="Nenhuma pessoa alocada"
                      description="Aloque colaboradores para planejar a capacidade do projeto."
                      action={
                        canManage
                          ? {
                              label: 'Alocar pessoa',
                              onClick: () => {
                                setEditing(null);
                                setModalOpen(true);
                              },
                            }
                          : undefined
                      }
                    />
                  }
                />
              </HudPanel>
            ),
          },
          {
            id: 'matrix',
            label: 'Matriz de alocação',
            icon: <LayoutGrid className="h-4 w-4" />,
            content: (
              <HudPanel>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-ig-border">
                        <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-ig-fg-muted">
                          Colaborador
                        </th>
                        {matrixMonths.map((m) => (
                          <th
                            key={m}
                            className="px-3 py-3 text-center text-xs font-medium uppercase tracking-wider text-ig-fg-muted"
                          >
                            {monthLabel(m)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {enriched.map((r) => (
                        <tr key={r.allocation.id} className="border-b border-ig-border-subtle">
                          <td className="px-4 py-2.5 text-sm font-medium text-ig-fg-strong">
                            {r.allocation.person?.fullName ?? '—'}
                          </td>
                          {matrixMonths.map((m) => {
                            const active = allocationCoversMonth(r.allocation, m);
                            const pct = active ? r.allocation.plannedPercentage : 0;
                            return (
                              <td key={m} className="px-3 py-2.5 text-center">
                                {active ? (
                                  <span
                                    className={`inline-block min-w-12 rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums ${
                                      pct > 80
                                        ? 'bg-[color-mix(in_oklab,var(--ig-warning)_16%,transparent)] text-ig-warning'
                                        : 'bg-[color-mix(in_oklab,var(--ig-success)_14%,transparent)] text-ig-success'
                                    }`}
                                  >
                                    {pct.toFixed(0)}%
                                  </span>
                                ) : (
                                  <span className="text-xs text-ig-fg-muted">—</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                      {enriched.length === 0 && (
                        <tr>
                          <td colSpan={matrixMonths.length + 1} className="px-4 py-8 text-center text-sm text-ig-fg-muted">
                            Sem alocações vigentes.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </HudPanel>
            ),
          },
          {
            id: 'costs',
            label: 'Custos',
            icon: <Coins className="h-4 w-4" />,
            content: usingDemo ? (
              <HudPanel>
                <HudEmptyState
                  icon="inbox"
                  compact
                  title="Custos indisponíveis em modo demo"
                  description="Cadastre alocações e apontamentos reais e calcule os snapshots de custo da folha."
                />
              </HudPanel>
            ) : (
              <ProjectLaborCostPanel projectId={projectId} />
            ),
          },
          {
            id: 'history',
            label: 'Histórico e aprovações',
            icon: <History className="h-4 w-4" />,
            badge: historyRows.length || undefined,
            content: (
              <HudPanel>
                {historyRows.length === 0 ? (
                  <HudEmptyState
                    icon="file"
                    compact
                    title="Sem histórico"
                    description="Alocações encerradas, canceladas ou rejeitadas aparecem aqui."
                  />
                ) : (
                  <div className="space-y-2">
                    {historyRows.map((a) => (
                      <div
                        key={a.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ig-border-subtle bg-ig-panel/60 px-4 py-3"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-ig-fg-strong">
                            {a.person?.fullName ?? '—'}
                            <span className="ml-2 text-xs font-normal text-ig-fg-muted">
                              {a.roleTitle ?? ALLOCATION_TYPE_LABELS[a.allocationType]}
                            </span>
                          </p>
                          <p className="text-xs tabular-nums text-ig-fg-muted">
                            {formatPeriod(a)} · {a.plannedPercentage.toFixed(0)}%
                            {a.rejectionReason ? ` · Motivo: ${a.rejectionReason}` : ''}
                          </p>
                        </div>
                        <HudStatusPill
                          variant={
                            a.status === 'ended'
                              ? 'neutral'
                              : a.status === 'rejected'
                                ? 'error'
                                : 'neutral'
                          }
                          size="sm"
                        >
                          {ALLOCATION_STATUS_LABELS[a.status]}
                        </HudStatusPill>
                      </div>
                    ))}
                  </div>
                )}
              </HudPanel>
            ),
          },
        ]}
      />

      {/* ── drawer: colaborador ── */}
      <PersonDrawer
        allocation={drawerAllocation}
        corporate={sourceCorporate}
        projectId={projectId}
        canViewCost={canViewCost}
        onClose={() => setDrawerAllocation(null)}
      />

      {/* ── modal: criar/editar alocação ── */}
      <AllocationModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        projectId={projectId}
        people={people}
        editing={editing}
        onSaved={async () => {
          setModalOpen(false);
          await reload();
        }}
      />
    </div>
  );
}

/* ─────────────────────── PersonDrawer ────────────────────────── */

function PersonDrawer({
  allocation,
  corporate,
  projectId,
  canViewCost,
  onClose,
}: {
  allocation: PersonProjectAllocation | null;
  corporate: PersonProjectAllocation[];
  projectId: string;
  canViewCost: boolean;
  onClose: () => void;
}) {
  const person = allocation?.person;

  const personAllocations = useMemo(
    () =>
      allocation
        ? corporate.filter(
            (a) => a.personId === allocation.personId && LIVE_ALLOCATION_STATUSES.includes(a.status),
          )
        : [],
    [allocation, corporate],
  );
  const totalPct = personAllocations.reduce((s, a) => s + a.plannedPercentage, 0);

  const months = useMemo(() => {
    const base = currentMonth();
    return [0, 1, 2, 3].map((i) => addMonths(base, i));
  }, []);

  return (
    <HudDrawer
      isOpen={Boolean(allocation)}
      onClose={onClose}
      title={person?.fullName ?? 'Colaborador'}
      subtitle={person?.jobTitle ?? undefined}
      width="460px"
    >
      {allocation && (
        <div className="space-y-6 p-1">
          {/* identidade */}
          <section>
            <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-ig-fg-muted">
              Identidade organizacional
            </h4>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <InfoCell label="Área" value={person?.department ?? '—'} />
              <InfoCell
                label="Vínculo"
                value={person?.contractType ? person.contractType.toUpperCase() : '—'}
              />
              <InfoCell
                label="Jornada"
                value={person ? `${person.weeklyHours}h/semana` : '—'}
              />
              <InfoCell label="E-mail" value={person?.email ?? '—'} />
            </div>
          </section>

          {/* distribuição atual */}
          <section>
            <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-ig-fg-muted">
              Distribuição atual
            </h4>
            <div className="space-y-1.5">
              {personAllocations.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate text-ig-fg-muted">
                    {a.projectId === projectId ? 'Este projeto' : `Projeto ${a.projectId}`}
                    {a.roleTitle ? ` · ${a.roleTitle}` : ''}
                  </span>
                  <span className="font-semibold tabular-nums text-ig-fg-strong">
                    {a.plannedPercentage.toFixed(0)}%
                  </span>
                </div>
              ))}
              <div className="mt-2 flex items-center justify-between border-t border-ig-border pt-2 text-sm">
                <span className="font-medium text-ig-fg-strong">Total</span>
                <span
                  className={`font-semibold tabular-nums ${totalPct > 100 ? 'text-ig-danger' : 'text-ig-fg-strong'}`}
                >
                  {totalPct.toFixed(0)}%
                </span>
              </div>
              {totalPct > 100 && (
                <p className="flex items-center gap-1.5 text-xs text-ig-danger">
                  <AlertTriangle className="h-3.5 w-3.5" /> Sobrecarga de{' '}
                  {(totalPct - 100).toFixed(0)}% — requer normalização.
                </p>
              )}
            </div>
          </section>

          {/* linha do tempo */}
          <section>
            <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-ig-fg-muted">
              Comprometimento por mês
            </h4>
            <div className="space-y-1.5">
              {months.map((m) => {
                const pct = personAllocations
                  .filter((a) => allocationCoversMonth(a, m))
                  .reduce((s, a) => s + a.plannedPercentage, 0);
                return (
                  <div key={m} className="flex items-center gap-3 text-sm">
                    <span className="w-16 shrink-0 text-xs capitalize text-ig-fg-muted">
                      {monthLabel(m)}
                    </span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-ig-panel">
                      <div
                        className={`h-full rounded-full ${pct > 100 ? 'bg-ig-danger' : pct > 80 ? 'bg-ig-warning' : 'bg-ig-success'}`}
                        style={{ width: `${Math.min(pct, 130)}%` }}
                      />
                    </div>
                    <span
                      className={`w-12 shrink-0 text-right text-xs font-semibold tabular-nums ${pct > 100 ? 'text-ig-danger' : 'text-ig-fg-strong'}`}
                    >
                      {pct.toFixed(0)}%
                    </span>
                  </div>
                );
              })}
            </div>
          </section>

          {/* custos (fase de custos futura popula os valores) */}
          <section>
            <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-ig-fg-muted">
              Custos
            </h4>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <InfoCell label="Custo carregado mensal" value={maskCost(null, canViewCost)} />
              <InfoCell label="Custo-hora" value={maskCost(null, canViewCost)} />
              <InfoCell label="Custo planejado no projeto" value={maskCost(null, canViewCost)} />
              <InfoCell label="Custo realizado" value={maskCost(null, canViewCost)} />
            </div>
            <p className="mt-2 text-[11px] text-ig-fg-muted">
              Valores individuais habilitam com o snapshot de custo da folha (fase de custos).
            </p>
          </section>

          {/* alocação neste projeto */}
          <section>
            <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-ig-fg-muted">
              Alocação neste projeto
            </h4>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <InfoCell label="Função" value={allocation.roleTitle ?? '—'} />
              <InfoCell label="Tipo" value={ALLOCATION_TYPE_LABELS[allocation.allocationType]} />
              <InfoCell label="Período" value={formatPeriod(allocation)} />
              <InfoCell label="Status" value={ALLOCATION_STATUS_LABELS[allocation.status]} />
            </div>
            {allocation.justification && (
              <p className="mt-2 rounded-md border border-ig-border-subtle bg-ig-panel/60 px-3 py-2 text-xs text-ig-fg-muted">
                Justificativa: {allocation.justification}
              </p>
            )}
          </section>
        </div>
      )}
    </HudDrawer>
  );
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-ig-border-subtle bg-ig-panel/60 px-3 py-2">
      <p className="text-[10px] font-medium uppercase tracking-wider text-ig-fg-muted">{label}</p>
      <p className="mt-0.5 truncate text-sm font-medium text-ig-fg-strong">{value}</p>
    </div>
  );
}

/* ────────────────────── AllocationModal ──────────────────────── */

function AllocationModal({
  open,
  onClose,
  projectId,
  people,
  editing,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  people: Person[];
  editing: PersonProjectAllocation | null;
  onSaved: () => Promise<void>;
}) {
  const { notify } = useHudToast();

  const [personId, setPersonId] = useState('');
  const [roleTitle, setRoleTitle] = useState('');
  const [allocationType, setAllocationType] = useState('billable');
  const [percentage, setPercentage] = useState('100');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [justification, setJustification] = useState('');
  const [requiresPonto, setRequiresPonto] = useState(false);
  const [overloadWarning, setOverloadWarning] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setPersonId(editing.personId);
      setRoleTitle(editing.roleTitle ?? '');
      setAllocationType(editing.allocationType);
      setPercentage(String(editing.plannedPercentage));
      setStartDate(editing.startDate);
      setEndDate(editing.endDate ?? '');
      setJustification(editing.justification ?? '');
      setRequiresPonto(editing.requiresPonto ?? false);
    } else {
      setPersonId('');
      setRoleTitle('');
      setAllocationType('billable');
      setPercentage('100');
      setStartDate(new Date().toISOString().slice(0, 10));
      setEndDate('');
      setJustification('');
      setRequiresPonto(false);
    }
    setOverloadWarning(null);
  }, [open, editing]);

  // live overload preview when person/percentage/period change
  useEffect(() => {
    if (!open || !personId || !startDate || !percentage) {
      setOverloadWarning(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const v = await validateAllocation({
          personId,
          projectId,
          startDate,
          endDate: endDate || null,
          plannedPercentage: Number(percentage) || 0,
          excludeAllocationId: editing?.id,
        });
        if (cancelled) return;
        if (v.overlapError) setOverloadWarning(v.overlapError);
        else if (v.overloadWarning) {
          setOverloadWarning(
            `Comprometimento total projetado: ${v.projectedTotalPct.toFixed(0)}% (sobrecarga). Justificativa obrigatória.`,
          );
        } else setOverloadWarning(null);
      } catch {
        if (!cancelled) setOverloadWarning(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, personId, projectId, startDate, endDate, percentage, editing?.id]);

  async function handleSave() {
    const pct = Number(percentage);
    if (!personId) {
      notify('Selecione o colaborador', { variant: 'warning' });
      return;
    }
    if (!startDate) {
      notify('Informe a data de início', { variant: 'warning' });
      return;
    }
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
      notify('Percentual deve estar entre 1 e 100', {
        description: 'Sobrecarga é medida pela soma entre projetos, não por alocação individual.',
        variant: 'warning',
      });
      return;
    }

    setSaving(true);
    try {
      const input = {
        personId,
        projectId,
        roleTitle: roleTitle.trim() || null,
        allocationType: allocationType as PersonProjectAllocation['allocationType'],
        startDate,
        endDate: endDate || null,
        plannedPercentage: pct,
        justification: justification.trim() || null,
        requiresPonto,
      };
      const saved = editing ? await updateAllocation(editing.id, input) : await createAllocation(input);
      notify(editing ? 'Alocação atualizada' : 'Pessoa alocada', { variant: 'success' });

      // Provisionamento IMEDIATO do acesso ao Ponto quando a alocação exige e
      // está viva. Best-effort: NÃO bloqueia a alocação nem falha se o e-mail
      // não sair — o cron horário reconcilia. Reusa o motor server-side.
      if (requiresPonto && (saved.status === 'active' || saved.status === 'pending_approval')) {
        try {
          const res = await fetch('/api/ponto/provision', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ personId, source: 'allocation' }),
          });
          const json = (await res.json().catch(() => ({}))) as { ok?: boolean; action?: string; error?: string };
          if (json.ok && json.action === 'provisioned') notify('Convite de acesso ao Ponto enviado', { variant: 'success' });
          else if (json.ok && json.action === 'skipped_no_email') notify('Acesso ao Ponto pendente: cadastre um e-mail para o colaborador', { variant: 'warning' });
          else if (json.ok && (json.action === 'skipped_active' || json.action === 'skipped_pending')) notify('Colaborador já tem acesso/convite ao Ponto', { variant: 'info' });
          else if (!json.ok) notify('Alocação salva; provisionamento do Ponto será reconciliado pelo cron', { description: json.error, variant: 'warning' });
        } catch {
          notify('Alocação salva; provisionamento do Ponto será reconciliado pelo cron', { variant: 'warning' });
        }
      }
      await onSaved();
    } catch (e) {
      notify('Erro ao salvar alocação', {
        description: e instanceof Error ? e.message : undefined,
        variant: 'error',
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <HudModal
      isOpen={open}
      onClose={onClose}
      title={editing ? 'Editar alocação' : 'Alocar pessoa'}
      subtitle="Alocação com vigência, percentual e aprovação"
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <HudButton variant="ghost" onClick={onClose}>
            Cancelar
          </HudButton>
          <HudButton variant="primary" onClick={() => void handleSave()} disabled={saving}>
            {saving ? 'Salvando…' : editing ? 'Salvar alterações' : 'Alocar'}
          </HudButton>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <HudSelect
          label="Colaborador"
          value={personId}
          onChange={setPersonId}
          options={people.map((p) => ({ value: p.id, label: p.fullName }))}
          placeholder="Selecionar colaborador…"
        />
        <HudInput
          label="Função no projeto"
          value={roleTitle}
          onChange={(e) => setRoleTitle(e.target.value)}
          placeholder="Ex.: Engenheiro de campo"
        />
        <HudSelect
          label="Tipo de alocação"
          value={allocationType}
          onChange={setAllocationType}
          options={Object.entries(ALLOCATION_TYPE_LABELS).map(([value, label]) => ({
            value,
            label,
          }))}
        />
        <HudInput
          label="Percentual (%)"
          type="number"
          min={1}
          max={100}
          value={percentage}
          onChange={(e) => setPercentage(e.target.value)}
        />
        <HudInput
          label="Início"
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
        />
        <HudInput
          label="Fim (opcional)"
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
        />
      </div>

      {overloadWarning && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-[color-mix(in_oklab,var(--ig-warning)_32%,transparent)] bg-[color-mix(in_oklab,var(--ig-warning)_10%,transparent)] px-3 py-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-ig-warning" />
          <p className="text-xs text-ig-warning">{overloadWarning}</p>
        </div>
      )}

      <div className="mt-4">
        <HudInput
          label="Justificativa (obrigatória em sobrecarga)"
          value={justification}
          onChange={(e) => setJustification(e.target.value)}
          placeholder="Ex.: pico de comissionamento aprovado pela diretoria"
        />
      </div>

      <label className="mt-4 flex cursor-pointer items-start gap-2.5 rounded-lg border border-ig-border-subtle bg-ig-panel/40 px-3 py-3">
        <input
          type="checkbox"
          checked={requiresPonto}
          onChange={(e) => setRequiresPonto(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-ig-accent"
        />
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-sm font-medium text-ig-fg-strong">
            Exige registro de ponto
            <span title="Ao salvar uma alocação ativa marcada assim, o colaborador é automaticamente convidado a ativar o acesso ao app de Ponto (se ainda não tiver). Nada é enviado sem e-mail cadastrado; o cron horário reconcilia.">
              <Info className="h-3.5 w-3.5 text-ig-fg-subtle" />
            </span>
          </span>
          <span className="mt-0.5 block text-[11px] text-ig-fg-muted">
            Dispara o provisionamento de acesso ao Ponto para este colaborador.
          </span>
        </span>
      </label>

      <p className="mt-3 flex items-center gap-1.5 text-[11px] text-ig-fg-muted">
        <CalendarRange className="h-3.5 w-3.5" />
        Alterações geram trilha de auditoria. Sobreposição da mesma pessoa neste projeto é
        bloqueada.
      </p>
    </HudModal>
  );
}
