'use client';

/**
 * Jornada — registro de ponto + jornada derivada + regras CLT + banco
 * de horas + conciliação jornada × apontamento (Fase 5, spec §4/§6.3).
 * Live-first com demo fallback. Jornada é domínio separado do
 * apontamento por projeto; esta tela concilia os dois (D4).
 */

import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Clock,
  Coffee,
  LogIn,
  LogOut,
  Moon,
  Play,
  Scale,
  Timer,
} from 'lucide-react';
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
  type HudTableColumn,
  type KpiItem,
} from '@/components/hud';
import { usePermissions } from '@/hooks/use-permissions';
import type {
  AttendancePunch,
  DayJourney,
  JourneyReconciliation,
  Person,
  PunchType,
} from '@/lib/types/people';
import { PUNCH_TYPE_LABELS } from '@/lib/types/people';
import {
  buildJourneys,
  computeBancoHoras,
  getJourneyReconciliation,
  listPunches,
  nextPunchOptions,
  registerPunch,
} from '@/lib/services/journey';
import { listPeople, getCurrentPerson } from '@/lib/services/people';
import { monthBounds } from '@/lib/services/capacity';
import { buildDemoPunches } from '@/components/workforce/journey-demo-data';
import { DEMO_PEOPLE } from '@/components/projects/team-demo-data';

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

const PUNCH_ICON: Record<PunchType, React.ReactNode> = {
  clock_in: <LogIn className="h-4 w-4" />,
  break_start: <Coffee className="h-4 w-4" />,
  break_end: <Play className="h-4 w-4" />,
  clock_out: <LogOut className="h-4 w-4" />,
};

export default function JornadaPage() {
  const { hasPermission } = usePermissions();
  const { notify } = useHudToast();
  const canUse = hasPermission('people.attendance_use');
  const canView = hasPermission('people.attendance_view') || hasPermission('people.attendance_manage');

  const [month, setMonth] = useState(currentMonth());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [punches, setPunches] = useState<AttendancePunch[]>([]);
  const [myPerson, setMyPerson] = useState<Person | null>(null);
  const [reconPersonId, setReconPersonId] = useState<string>('');
  const [recon, setRecon] = useState<JourneyReconciliation[]>([]);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [start, end] = monthBounds(month);
      const [peopleRes, punchesRes, me] = await Promise.all([
        listPeople({ status: 'active' }).catch(() => [] as Person[]),
        canView || canUse ? listPunches(start, end) : Promise.resolve([] as AttendancePunch[]),
        getCurrentPerson().catch(() => null),
      ]);
      setPeople(peopleRes);
      setPunches(punchesRes);
      setMyPerson(me);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar jornada');
    } finally {
      setLoading(false);
    }
  }, [month, canView, canUse]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const usingDemo = !loading && !error && punches.length === 0;
  const sourcePunches = usingDemo ? buildDemoPunches() : punches;
  const sourcePeople = usingDemo ? DEMO_PEOPLE : people;

  // journeys per person
  const journeys = useMemo(() => {
    const all: DayJourney[] = [];
    for (const person of sourcePeople) {
      all.push(...buildJourneys(person, sourcePunches));
    }
    return all;
  }, [sourcePeople, sourcePunches]);

  const peopleById = useMemo(
    () => new Map(sourcePeople.map((p) => [p.id, p])),
    [sourcePeople],
  );

  // my journey today
  const myTodayPunches = useMemo(() => {
    if (!myPerson && !usingDemo) return [];
    const pid = usingDemo ? DEMO_PEOPLE[0].id : myPerson?.id;
    const today = new Date().toISOString().slice(0, 10);
    return sourcePunches
      .filter((p) => p.personId === pid && p.occurredAt.slice(0, 10) === today)
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  }, [myPerson, usingDemo, sourcePunches]);

  const lastPunchType = myTodayPunches.length > 0 ? myTodayPunches[myTodayPunches.length - 1].type : null;
  const nextOptions = nextPunchOptions(lastPunchType);

  async function handlePunch(type: PunchType) {
    setBusy(true);
    try {
      await registerPunch(type);
      notify(`${PUNCH_TYPE_LABELS[type]} registrada`, { variant: 'success' });
      await reload();
    } catch (e) {
      notify('Erro ao registrar ponto', {
        description: e instanceof Error ? e.message : undefined,
        variant: 'error',
      });
    } finally {
      setBusy(false);
    }
  }

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
      if (usingDemo) {
        // derive demo reconciliation from demo journeys only (no timesheet)
        const demoJourneys = buildJourneys(person, sourcePunches);
        setRecon(
          demoJourneys.map((j) => ({
            personId,
            date: j.date,
            workedMinutes: j.workedMinutes,
            reportedMinutes: 0,
            unclassifiedMinutes: j.workedMinutes,
            outsideJourneyMinutes: 0,
          })),
        );
        return;
      }
      try {
        setRecon(await getJourneyReconciliation(personId, month, person));
      } catch (e) {
        notify('Erro ao conciliar', {
          description: e instanceof Error ? e.message : undefined,
          variant: 'error',
        });
      }
    },
    [peopleById, usingDemo, sourcePunches, month, notify],
  );

  useEffect(() => {
    const pid = reconPersonId || (usingDemo ? DEMO_PEOPLE[0].id : myPerson?.id ?? '');
    if (pid) {
      setReconPersonId(pid);
      void loadRecon(pid);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usingDemo, myPerson, month]);

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
          subtitle={`Ponto, banco de horas e conciliação com apontamento · ${monthLabel(month)}`}
          icon={<Timer className="h-5 w-5" />}
          breadcrumbs={[{ label: 'Pessoas & Custos', href: '/workforce-cost' }, { label: 'Jornada' }]}
        />

        {usingDemo && (
          <div className="flex items-center gap-2">
            <HudBadge variant="warning">dados demonstrativos</HudBadge>
            <span className="text-xs text-ig-fg-muted">
              Nenhuma marcação de ponto registrada — exibindo exemplo. Ações de escrita desativadas.
            </span>
          </div>
        )}
        {error && (
          <HudPanel state="critical">
            <p className="text-sm text-ig-danger">{error}</p>
          </HudPanel>
        )}

        {/* Minha jornada */}
        {(canUse || usingDemo) && (
          <HudPanel title="Minha jornada de hoje" accentColor="emerald">
            <div className="flex flex-wrap items-center gap-3">
              {nextOptions.map((type) => (
                <HudButton
                  key={type}
                  variant={type === 'clock_in' || type === 'break_end' ? 'primary' : 'secondary'}
                  leftIcon={PUNCH_ICON[type]}
                  disabled={busy}
                  onClick={() => void handlePunch(type)}
                >
                  {PUNCH_TYPE_LABELS[type]}
                </HudButton>
              ))}
              {myTodayPunches.length > 0 && (
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  {myTodayPunches.map((p) => (
                    <span
                      key={p.id}
                      className="flex items-center gap-1.5 rounded-md border border-ig-border-subtle bg-ig-panel/60 px-2.5 py-1 text-xs tabular-nums text-ig-fg-muted"
                    >
                      {PUNCH_ICON[p.type]}
                      <span className="font-medium text-ig-fg-strong">{fmtTime(p.occurredAt)}</span>
                      {PUNCH_TYPE_LABELS[p.type]}
                    </span>
                  ))}
                </div>
              )}
            </div>
            {myTodayPunches.length === 0 && (
              <p className="mt-3 text-xs text-ig-fg-muted">
                Nenhuma marcação hoje. Registre sua entrada para iniciar a jornada.
              </p>
            )}
          </HudPanel>
        )}

        {canView || usingDemo ? (
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
              <HudBadge variant="info">jornada esperada = carga semanal ÷ 5 · noturno 22h–05h</HudBadge>
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
                          options={sourcePeople.map((p) => ({ value: p.id, label: p.fullName }))}
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
              description="Você pode registrar seu próprio ponto acima. A visão consolidada requer people.attendance_view."
            />
          </HudPanel>
        )}
      </div>
    </HudPageLayout>
  );
}
