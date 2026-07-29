'use client';

/**
 * Jornada — visão gerencial derivada das marcações feitas no portal
 * ponto.insightapex, com regras CLT, banco de horas e conciliação
 * jornada × apontamento (Fase 5, spec §4/§6.3).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Clock,
  Moon,
  Scale,
  Timer,
} from 'lucide-react';
import {
  HudBadge,
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
  type HudTableColumn,
  type KpiItem,
} from '@/components/hud';
import { usePermissions } from '@/hooks/use-permissions';
import type {
  AttendancePunch,
  DayJourney,
  JourneyReconciliation,
  Person,
} from '@/lib/types/people';
import {
  buildJourneys,
  computeBancoHoras,
  getJourneyReconciliation,
  listPunches,
} from '@/lib/services/journey';
import { listPeople } from '@/lib/services/people';
import { monthBounds } from '@/lib/services/capacity';

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
function fmtMin(min: number): string {
  const sign = min < 0 ? '-' : '';
  const abs = Math.abs(min);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${h}h${m > 0 ? String(m).padStart(2, '0') : ''}`;
}
function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function fmtDate(date: string): string {
  const [, m, d] = date.split('-');
  return `${d}/${m}`;
}

export default function JornadaPage() {
  const { hasPermission } = usePermissions();
  const { notify } = useHudToast();
  const canView = hasPermission('people.attendance_view') || hasPermission('people.attendance_manage');

  const [month, setMonth] = useState(currentMonth());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [punches, setPunches] = useState<AttendancePunch[]>([]);
  const [reconPersonId, setReconPersonId] = useState<string>('');
  const [recon, setRecon] = useState<JourneyReconciliation[]>([]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [start, end] = monthBounds(month);
      const [peopleRes, punchesRes] = await Promise.all([
        canView ? listPeople({ status: 'active' }).catch(() => [] as Person[]) : Promise.resolve([] as Person[]),
        canView ? listPunches(start, end) : Promise.resolve([] as AttendancePunch[]),
      ]);
      setPeople(peopleRes);
      setPunches(punchesRes);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar jornada');
    } finally {
      setLoading(false);
    }
  }, [month, canView]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // journeys per person
  const journeys = useMemo(() => {
    const all: DayJourney[] = [];
    for (const person of people) {
      all.push(...buildJourneys(person, punches));
    }
    return all;
  }, [people, punches]);

  const peopleById = useMemo(
    () => new Map(people.map((p) => [p.id, p])),
    [people],
  );

  // corporate KPIs
  const kpis: KpiItem[] = useMemo(() => {
    const worked = journeys.reduce((s, j) => s + j.workedMinutes, 0);
    const overtime = journeys.reduce((s, j) => s + j.overtimeMinutes, 0);
    const night = journeys.reduce((s, j) => s + j.nightMinutes, 0);
    const incomplete = journeys.filter((j) => j.incomplete).length;
    const banco = computeBancoHoras(journeys);
    return [
      { id: 'worked', label: 'Horas trabalhadas', value: fmtMin(worked), icon: <Clock className="h-4 w-4" /> },
      { id: 'overtime', label: 'Horas extras', value: fmtMin(overtime), variant: overtime > 0 ? 'warning' : 'default' },
      { id: 'night', label: 'Adicional noturno', value: fmtMin(night), icon: <Moon className="h-4 w-4" /> },
      {
        id: 'banco',
        label: 'Banco de horas',
        value: fmtMin(banco),
        variant: banco < 0 ? 'danger' : 'success',
        tintValue: true,
        icon: <Scale className="h-4 w-4" />,
      },
      {
        id: 'incomplete',
        label: 'Jornadas incompletas',
        value: incomplete,
        variant: incomplete > 0 ? 'danger' : 'default',
        icon: <AlertTriangle className="h-4 w-4" />,
      },
    ];
  }, [journeys]);

  // conciliation loader
  const loadRecon = useCallback(
    async (personId: string) => {
      const person = peopleById.get(personId);
      if (!person) return;
      try {
        setRecon(await getJourneyReconciliation(personId, month, person));
      } catch (e) {
        notify('Erro ao conciliar', {
          description: e instanceof Error ? e.message : undefined,
          variant: 'error',
        });
      }
    },
    [peopleById, month, notify],
  );

  useEffect(() => {
    if (!canView || people.length === 0) return;
    if (!reconPersonId || !peopleById.has(reconPersonId)) {
      setReconPersonId(people[0].id);
      return;
    }
    void loadRecon(reconPersonId);
  }, [canView, people, peopleById, reconPersonId, month, loadRecon]);

  const journeyColumns: HudTableColumn<DayJourney>[] = [
    {
      key: 'person',
      header: 'Colaborador',
      cell: (j) => (
        <div>
          <p className="text-sm font-medium text-ig-fg-strong">
            {peopleById.get(j.personId)?.fullName ?? '—'}
          </p>
          <p className="text-xs tabular-nums text-ig-fg-muted">{fmtDate(j.date)}</p>
        </div>
      ),
    },
    { key: 'in', header: 'Entrada', align: 'right', cell: (j) => <span className="text-sm tabular-nums text-ig-fg-strong">{fmtTime(j.firstIn)}</span> },
    { key: 'out', header: 'Saída', align: 'right', cell: (j) => <span className="text-sm tabular-nums text-ig-fg-strong">{fmtTime(j.lastOut)}</span> },
    { key: 'worked', header: 'Trabalhadas', align: 'right', cell: (j) => <span className="text-sm tabular-nums text-ig-fg-strong">{fmtMin(j.workedMinutes)}</span> },
    { key: 'expected', header: 'Prevista', align: 'right', cell: (j) => <span className="text-sm tabular-nums text-ig-fg-muted">{fmtMin(j.expectedMinutes)}</span> },
    {
      key: 'ot',
      header: 'HE',
      align: 'right',
      cell: (j) => (
        <span className={`text-sm tabular-nums ${j.overtimeMinutes > 0 ? 'text-ig-warning' : 'text-ig-fg-muted'}`}>
          {j.overtimeMinutes > 0 ? fmtMin(j.overtimeMinutes) : '—'}
        </span>
      ),
    },
    {
      key: 'night',
      header: 'Noturno',
      align: 'right',
      cell: (j) => (
        <span className={`text-sm tabular-nums ${j.nightMinutes > 0 ? 'text-ig-info' : 'text-ig-fg-muted'}`}>
          {j.nightMinutes > 0 ? fmtMin(j.nightMinutes) : '—'}
        </span>
      ),
    },
    {
      key: 'balance',
      header: 'Saldo',
      align: 'right',
      cell: (j) => (
        <span className={`text-sm font-semibold tabular-nums ${j.balanceMinutes < 0 ? 'text-ig-danger' : 'text-ig-success'}`}>
          {fmtMin(j.balanceMinutes)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (j) =>
        j.incomplete ? (
          <HudStatusPill variant="warning" size="sm">Incompleta</HudStatusPill>
        ) : (
          <HudStatusPill variant="active" size="sm">Fechada</HudStatusPill>
        ),
    },
  ];

  const reconColumns: HudTableColumn<JourneyReconciliation>[] = [
    { key: 'date', header: 'Dia', cell: (r) => <span className="text-sm tabular-nums text-ig-fg-strong">{fmtDate(r.date)}</span> },
    { key: 'worked', header: 'Jornada', align: 'right', cell: (r) => <span className="text-sm tabular-nums text-ig-fg-strong">{fmtMin(r.workedMinutes)}</span> },
    { key: 'reported', header: 'Apontado', align: 'right', cell: (r) => <span className="text-sm tabular-nums text-ig-fg-strong">{fmtMin(r.reportedMinutes)}</span> },
    {
      key: 'unclassified',
      header: 'Não classificado',
      align: 'right',
      cell: (r) => (
        <span className={`text-sm tabular-nums ${r.unclassifiedMinutes > 0 ? 'text-ig-warning' : 'text-ig-fg-muted'}`}>
          {r.unclassifiedMinutes > 0 ? fmtMin(r.unclassifiedMinutes) : '—'}
        </span>
      ),
    },
    {
      key: 'outside',
      header: 'Fora da jornada',
      align: 'right',
      cell: (r) => (
        <span className={`text-sm tabular-nums ${r.outsideJourneyMinutes > 0 ? 'text-ig-danger' : 'text-ig-fg-muted'}`}>
          {r.outsideJourneyMinutes > 0 ? fmtMin(r.outsideJourneyMinutes) : '—'}
        </span>
      ),
    },
  ];

  return (
    <HudPageLayout>
      <div className="space-y-6">
        <HudHeader
          title="Jornada"
          subtitle={`Gestão de ponto, banco de horas e conciliação · ${monthLabel(month)}`}
          icon={<Timer className="h-5 w-5" />}
          breadcrumbs={[{ label: 'Pessoas & Custos', href: '/workforce-cost' }, { label: 'Jornada' }]}
        />

        {error && (
          <HudPanel state="critical">
            <p className="text-sm text-ig-danger">{error}</p>
          </HudPanel>
        )}

        {canView ? (
          <>
            <div className="flex items-center gap-3">
              <div className="w-56">
                <HudSelect
                  label="Competência"
                  value={month}
                  onChange={setMonth}
                  options={[-2, -1, 0].map((i) => {
                    const m = addMonths(currentMonth(), i);
                    return { value: m, label: monthLabel(m) };
                  })}
                />
              </div>
              <HudBadge variant="info">marcações originadas em ponto.insightapex</HudBadge>
              <HudBadge variant="default">jornada esperada = carga semanal ÷ 5 · noturno 22h–05h</HudBadge>
            </div>

            <HudKpiStrip kpis={kpis} columns={5} />

            <HudTabs
              tabs={[
                {
                  id: 'journeys',
                  label: 'Jornadas diárias',
                  icon: <Clock className="h-4 w-4" />,
                  content: (
                    <HudPanel>
                      <HudTable<DayJourney>
                        columns={journeyColumns}
                        data={journeys}
                        keyExtractor={(j) => `${j.personId}-${j.date}`}
                        loading={loading}
                        emptyState={
                          <HudEmptyState icon="inbox" title="Sem jornadas" description="Nenhuma marcação de ponto nesta competência." />
                        }
                      />
                    </HudPanel>
                  ),
                },
                {
                  id: 'recon',
                  label: 'Conciliação com apontamento',
                  icon: <Scale className="h-4 w-4" />,
                  content: (
                    <HudPanel>
                      <div className="mb-4 w-64">
                        <HudSelect
                          label="Colaborador"
                          value={reconPersonId}
                          onChange={(v) => {
                            setReconPersonId(v);
                            void loadRecon(v);
                          }}
                          options={people.map((p) => ({ value: p.id, label: p.fullName }))}
                        />
                      </div>
                      <HudTable<JourneyReconciliation>
                        columns={reconColumns}
                        data={recon}
                        keyExtractor={(r) => r.date}
                        emptyState={
                          <HudEmptyState
                            icon="search"
                            compact
                            title="Sem conciliação"
                            description="Selecione um colaborador com jornada e apontamento na competência."
                          />
                        }
                      />
                      <p className="mt-3 text-[11px] text-ig-fg-muted">
                        <span className="text-ig-warning">Não classificado</span> = horas de jornada
                        sem projeto apontado. <span className="text-ig-danger">Fora da jornada</span>{' '}
                        = horas apontadas em projeto além da jornada registrada.
                      </p>
                    </HudPanel>
                  ),
                },
              ]}
            />
          </>
        ) : (
          <HudPanel>
            <HudEmptyState
              icon="alert"
              title="Sem acesso à visão de equipe"
              description="Esta área é exclusivamente gerencial e requer permissão para visualizar jornadas da equipe. O registro individual é feito em ponto.insightapex."
            />
          </HudPanel>
        )}
      </div>
    </HudPageLayout>
  );
}
