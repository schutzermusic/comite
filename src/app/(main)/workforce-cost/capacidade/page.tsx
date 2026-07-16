'use client';

/**
 * Capacidade e Alocação — corporate allocation matrix (spec seção 10).
 * Rows = people, columns = active projects + "Livre". Capacity is
 * derived (weekly_hours − leaves); live-first with read-only demo
 * fallback when there is no data.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarOff, Gauge, Users } from 'lucide-react';
import {
  HudBadge,
  HudButton,
  HudEmptyState,
  HudHeader,
  HudInput,
  HudKpiStrip,
  HudModal,
  HudPageLayout,
  HudPanel,
  HudSelect,
  useHudToast,
  type KpiItem,
} from '@/components/hud';
import { usePermissions } from '@/hooks/use-permissions';
import type { LeavePeriod, Person, PersonProjectAllocation } from '@/lib/types/people';
import { CONTRACT_TYPE_LABELS, LEAVE_TYPE_LABELS } from '@/lib/types/people';
import { listPeople } from '@/lib/services/people';
import { listLiveAllocationsInPeriod } from '@/lib/services/allocations';
import {
  buildAllocationMatrix,
  createLeave,
  listLeavesInPeriod,
  monthBounds,
} from '@/lib/services/capacity';
import { getProjectsAsync } from '@/lib/services/projects';
import {
  buildDemoCorporateAllocations,
  DEMO_PEOPLE,
} from '@/components/projects/team-demo-data';

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

export default function CapacidadePage() {
  const { hasPermission } = usePermissions();
  const { notify } = useHudToast();
  const canManage = hasPermission('people.allocations_manage');

  const [month, setMonth] = useState(currentMonth());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [allocations, setAllocations] = useState<PersonProjectAllocation[]>([]);
  const [leaves, setLeaves] = useState<LeavePeriod[]>([]);
  const [projectNames, setProjectNames] = useState<Record<string, string>>({});

  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('all');
  const [contractType, setContractType] = useState('all');
  const [minAvailability, setMinAvailability] = useState('none');
  const [leaveModalPerson, setLeaveModalPerson] = useState<Person | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [start, end] = monthBounds(month);
      const [peopleRes, allocationsRes, leavesRes, projectsRes] = await Promise.all([
        listPeople({ status: 'active' }),
        listLiveAllocationsInPeriod(start, end),
        listLeavesInPeriod(start, end),
        getProjectsAsync().catch(() => []),
      ]);
      setPeople(peopleRes);
      setAllocations(allocationsRes);
      setLeaves(leavesRes);
      setProjectNames(
        Object.fromEntries(projectsRes.map((p) => [p.id, p.codigo || p.nome || p.id])),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar capacidade');
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const usingDemo = !loading && !error && people.length === 0;
  const sourcePeople = usingDemo ? DEMO_PEOPLE : people;
  const sourceAllocations = usingDemo ? buildDemoCorporateAllocations('demo-proj-uhe') : allocations;
  const sourceLeaves = usingDemo ? [] : leaves;

  const matrix = useMemo(
    () => buildAllocationMatrix(sourcePeople, sourceAllocations, sourceLeaves, month),
    [sourcePeople, sourceAllocations, sourceLeaves, month],
  );

  const departments = useMemo(
    () =>
      Array.from(new Set(sourcePeople.map((p) => p.department).filter(Boolean))) as string[],
    [sourcePeople],
  );

  const projectColumns = useMemo(() => {
    const ids = new Set<string>();
    for (const row of matrix) for (const pid of Object.keys(row.byProject)) ids.add(pid);
    return Array.from(ids).sort();
  }, [matrix]);

  const filteredMatrix = useMemo(
    () =>
      matrix.filter((row) => {
        if (search && !row.person.fullName.toLowerCase().includes(search.toLowerCase()))
          return false;
        if (department !== 'all' && row.person.department !== department) return false;
        if (contractType !== 'all' && row.person.contractType !== contractType) return false;
        if (minAvailability !== 'none' && row.freePct < Number(minAvailability)) return false;
        return true;
      }),
    [matrix, search, department, contractType, minAvailability],
  );

  const kpis: KpiItem[] = useMemo(() => {
    const overloaded = matrix.filter((r) => r.freePct < 0).length;
    const idle = matrix.filter((r) => r.totalPct === 0).length;
    const fte = matrix.reduce((s, r) => s + r.totalPct, 0) / 100;
    return [
      { id: 'headcount', label: 'Colaboradores ativos', value: matrix.length, icon: <Users className="h-4 w-4" /> },
      { id: 'fte', label: 'FTE alocado', value: fte.toFixed(2).replace('.', ',') },
      {
        id: 'overloaded',
        label: 'Sobrecarregados',
        value: overloaded,
        variant: overloaded > 0 ? 'danger' : 'default',
        tintValue: overloaded > 0,
        icon: <AlertTriangle className="h-4 w-4" />,
      },
      { id: 'idle', label: 'Sem alocação', value: idle, variant: idle > 0 ? 'warning' : 'default' },
      {
        id: 'onleave',
        label: 'Com afastamento no mês',
        value: matrix.filter((r) => r.onLeave).length,
        icon: <CalendarOff className="h-4 w-4" />,
      },
    ];
  }, [matrix]);

  return (
    <HudPageLayout>
      <div className="space-y-6">
        <HudHeader
          title="Capacidade e Alocação"
          subtitle={`Matriz corporativa · ${monthLabel(month)}`}
          icon={<Gauge className="h-5 w-5" />}
          breadcrumbs={[{ label: 'Pessoas & Custos', href: '/workforce-cost' }, { label: 'Capacidade' }]}
        />

        {usingDemo && (
          <div className="flex items-center gap-2">
            <HudBadge variant="warning">dados demonstrativos</HudBadge>
            <span className="text-xs text-ig-fg-muted">
              Sem pessoas cadastradas — exibindo exemplo. Cadastre pessoas e alocações para dados
              reais.
            </span>
          </div>
        )}
        {error && (
          <HudPanel state="critical">
            <p className="text-sm text-ig-danger">{error}</p>
          </HudPanel>
        )}

        <HudKpiStrip kpis={kpis} columns={5} />

        {/* filtros */}
        <HudPanel>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <HudInput
              label="Buscar"
              placeholder="Nome do colaborador…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <HudSelect
              label="Competência"
              value={month}
              onChange={setMonth}
              options={[-2, -1, 0, 1, 2, 3].map((i) => {
                const m = addMonths(currentMonth(), i);
                return { value: m, label: monthLabel(m) };
              })}
            />
            <HudSelect
              label="Área"
              value={department}
              onChange={setDepartment}
              options={[
                { value: 'all', label: 'Todas' },
                ...departments.map((d) => ({ value: d, label: d })),
              ]}
            />
            <HudSelect
              label="Vínculo"
              value={contractType}
              onChange={setContractType}
              options={[
                { value: 'all', label: 'Todos' },
                ...Object.entries(CONTRACT_TYPE_LABELS).map(([value, label]) => ({ value, label })),
              ]}
            />
            <HudSelect
              label="Disponibilidade mínima"
              value={minAvailability}
              onChange={setMinAvailability}
              options={[
                { value: 'none', label: 'Qualquer' },
                { value: '10', label: '≥ 10% livre' },
                { value: '25', label: '≥ 25% livre' },
                { value: '50', label: '≥ 50% livre' },
              ]}
            />
          </div>
        </HudPanel>

        {/* matriz */}
        <HudPanel title="Matriz de alocação" accentColor="emerald">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-ig-border border-t-ig-accent" />
            </div>
          ) : filteredMatrix.length === 0 ? (
            <HudEmptyState
              icon="search"
              title="Nenhum colaborador encontrado"
              description="Ajuste os filtros ou cadastre pessoas em Pessoas & Custos → Pessoas."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-ig-border">
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-ig-fg-muted">
                      Colaborador
                    </th>
                    {projectColumns.map((pid) => (
                      <th
                        key={pid}
                        className="max-w-28 truncate px-3 py-3 text-center text-xs font-medium uppercase tracking-wider text-ig-fg-muted"
                        title={projectNames[pid] ?? pid}
                      >
                        {projectNames[pid] ?? pid}
                      </th>
                    ))}
                    <th className="px-3 py-3 text-center text-xs font-medium uppercase tracking-wider text-ig-fg-muted">
                      Total
                    </th>
                    <th className="px-3 py-3 text-center text-xs font-medium uppercase tracking-wider text-ig-fg-muted">
                      Livre
                    </th>
                    <th className="px-3 py-3 text-center text-xs font-medium uppercase tracking-wider text-ig-fg-muted">
                      Capacidade
                    </th>
                    {canManage && <th className="px-3 py-3" />}
                  </tr>
                </thead>
                <tbody>
                  {filteredMatrix.map((row) => (
                    <tr
                      key={row.person.id}
                      className="border-b border-ig-border-subtle transition-colors hover:bg-ig-panel-hover/40"
                    >
                      <td className="px-4 py-2.5">
                        <p className="text-sm font-medium text-ig-fg-strong">
                          {row.person.fullName}
                          {row.onLeave && (
                            <span title="Afastamento no mês">
                              <CalendarOff className="ml-1.5 inline h-3.5 w-3.5 text-ig-warning" />
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-ig-fg-muted">
                          {row.person.department ?? '—'}
                          {row.person.contractType
                            ? ` · ${CONTRACT_TYPE_LABELS[row.person.contractType]}`
                            : ''}
                        </p>
                      </td>
                      {projectColumns.map((pid) => {
                        const pct = row.byProject[pid] ?? 0;
                        return (
                          <td key={pid} className="px-3 py-2.5 text-center">
                            {pct > 0 ? (
                              <span className="inline-block min-w-12 rounded-md bg-ig-accent-weak px-2 py-0.5 text-xs font-semibold tabular-nums text-ig-accent">
                                {pct.toFixed(0)}%
                              </span>
                            ) : (
                              <span className="text-xs text-ig-fg-muted">—</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="px-3 py-2.5 text-center">
                        <span
                          className={`text-sm font-semibold tabular-nums ${row.totalPct > 100 ? 'text-ig-danger' : 'text-ig-fg-strong'}`}
                        >
                          {row.totalPct.toFixed(0)}%
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <span
                          className={`inline-block min-w-12 rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums ${
                            row.freePct < 0
                              ? 'bg-[color-mix(in_oklab,var(--ig-danger)_16%,transparent)] text-ig-danger'
                              : row.freePct === 0
                                ? 'bg-[color-mix(in_oklab,var(--ig-warning)_14%,transparent)] text-ig-warning'
                                : 'bg-[color-mix(in_oklab,var(--ig-success)_14%,transparent)] text-ig-success'
                          }`}
                        >
                          {row.freePct.toFixed(0)}%
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-center text-xs tabular-nums text-ig-fg-muted">
                        {row.capacityHours.toFixed(0)}h
                      </td>
                      {canManage && (
                        <td className="px-3 py-2.5 text-right">
                          <HudButton
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              if (usingDemo) {
                                notify('Indisponível em modo demo', { variant: 'warning' });
                                return;
                              }
                              setLeaveModalPerson(row.person);
                            }}
                          >
                            Afastamento
                          </HudButton>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </HudPanel>
      </div>

      <LeaveModal
        person={leaveModalPerson}
        onClose={() => setLeaveModalPerson(null)}
        onSaved={async () => {
          setLeaveModalPerson(null);
          await reload();
        }}
      />
    </HudPageLayout>
  );
}

/* ─────────────────────── LeaveModal ──────────────────────────── */

function LeaveModal({
  person,
  onClose,
  onSaved,
}: {
  person: Person | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { notify } = useHudToast();
  const [type, setType] = useState('vacation');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (person) {
      setType('vacation');
      setStartDate('');
      setEndDate('');
      setNotes('');
    }
  }, [person]);

  async function handleSave() {
    if (!person) return;
    if (!startDate || !endDate) {
      notify('Informe início e fim do afastamento', { variant: 'warning' });
      return;
    }
    setSaving(true);
    try {
      await createLeave({
        personId: person.id,
        type: type as LeavePeriod['type'],
        startDate,
        endDate,
        notes: notes.trim() || null,
      });
      notify('Afastamento registrado', { variant: 'success' });
      await onSaved();
    } catch (e) {
      notify('Erro ao registrar afastamento', {
        description: e instanceof Error ? e.message : undefined,
        variant: 'error',
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <HudModal
      isOpen={Boolean(person)}
      onClose={onClose}
      title={`Afastamento — ${person?.fullName ?? ''}`}
      subtitle="Férias e afastamentos reduzem a capacidade do período"
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <HudButton variant="ghost" onClick={onClose}>
            Cancelar
          </HudButton>
          <HudButton variant="primary" onClick={() => void handleSave()} disabled={saving}>
            {saving ? 'Salvando…' : 'Registrar'}
          </HudButton>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <HudSelect
          label="Tipo"
          value={type}
          onChange={setType}
          options={Object.entries(LEAVE_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
        />
        <div />
        <HudInput label="Início" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        <HudInput label="Fim" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
      </div>
      <div className="mt-4">
        <HudInput
          label="Observações"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Opcional"
        />
      </div>
    </HudModal>
  );
}
