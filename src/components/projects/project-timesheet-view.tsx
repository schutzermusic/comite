'use client';

/**
 * Apontamentos do projeto (spec seção 11) — timer web, entrada manual,
 * consolidação, submissão com aprovação por exceção e conciliação
 * planejado × apontado × aprovado do mês. Live-first + demo fallback.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Hourglass,
  Play,
  Send,
  Square,
  Timer,
  Users,
} from 'lucide-react';
import {
  HudBadge,
  HudButton,
  HudEmptyState,
  HudInput,
  HudKpiStrip,
  HudPanel,
  HudStatusPill,
  HudTable,
  useHudToast,
  type HudTableColumn,
  type KpiItem,
} from '@/components/hud';
import { usePermissions } from '@/hooks/use-permissions';
import type { ProjectWorkSession, TimeEntry } from '@/lib/types/people';
import {
  EXCEPTION_FLAG_LABELS,
  TIME_ENTRY_STATUS_LABELS,
} from '@/lib/types/people';
import {
  consolidateMySessions,
  createManualEntry,
  getRunningSession,
  listEntriesByProject,
  listMyDraftSessions,
  startSession,
  stopSession,
  submitEntries,
} from '@/lib/services/timesheet';
import { listAllocationsByProject, LIVE_ALLOCATION_STATUSES } from '@/lib/services/allocations';
import { countBusinessDays, monthBounds } from '@/lib/services/capacity';
import { getCurrentPerson } from '@/lib/services/people';
import { buildDemoTimeEntries } from './timesheet-demo-data';

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function formatHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

function formatDate(date: string): string {
  const [y, m, d] = date.split('-');
  return `${d}/${m}/${y.slice(2)}`;
}

function elapsedLabel(startedAt: string, now: number): string {
  const secs = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

interface ProjectTimesheetViewProps {
  projectId: string;
}

export function ProjectTimesheetView({ projectId }: ProjectTimesheetViewProps) {
  const { hasPermission } = usePermissions();
  const { notify } = useHudToast();
  const canUse = hasPermission('people.timesheet_use');

  const month = currentMonth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [plannedHours, setPlannedHours] = useState(0);
  const [hasPersonLink, setHasPersonLink] = useState(true);

  const [running, setRunning] = useState<ProjectWorkSession | null>(null);
  const [draftSessions, setDraftSessions] = useState<ProjectWorkSession[]>([]);
  const [now, setNow] = useState(Date.now());

  const [manualDate, setManualDate] = useState(new Date().toISOString().slice(0, 10));
  const [manualHours, setManualHours] = useState('8');
  const [manualDescription, setManualDescription] = useState('');
  const [busy, setBusy] = useState(false);

  // ticking clock for the running timer
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [entriesRes, allocations, runningRes, draftsRes, person] = await Promise.all([
        listEntriesByProject(projectId, month),
        listAllocationsByProject(projectId).catch(() => []),
        getRunningSession().catch(() => null),
        listMyDraftSessions().catch(() => []),
        getCurrentPerson().catch(() => null),
      ]);
      setEntries(entriesRes);
      setRunning(runningRes);
      setDraftSessions(draftsRes);
      setHasPersonLink(Boolean(person));

      // planned hours of the month: Σ % × business-day capacity
      const [start, end] = monthBounds(month);
      const businessDays = countBusinessDays(start, end);
      const planned = allocations
        .filter((a) => LIVE_ALLOCATION_STATUSES.includes(a.status))
        .filter((a) => a.startDate <= end && (a.endDate == null || a.endDate >= start))
        .reduce((sum, a) => {
          const weekly = a.person?.weeklyHours ?? 40;
          return sum + (weekly / 5) * businessDays * (a.plannedPercentage / 100);
        }, 0);
      setPlannedHours(planned);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar apontamentos');
    } finally {
      setLoading(false);
    }
  }, [projectId, month]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const usingDemo = !loading && !error && entries.length === 0;
  const sourceEntries = usingDemo ? buildDemoTimeEntries(projectId) : entries;

  const blockDemo = useCallback((): boolean => {
    if (usingDemo) {
      notify('Indisponível em modo demo', {
        description: 'Cadastre alocações e apontamentos reais para habilitar.',
        variant: 'warning',
      });
      return true;
    }
    return false;
  }, [usingDemo, notify]);

  /* ── KPIs ── */

  const totals = useMemo(() => {
    const valid = sourceEntries.filter((e) => e.status !== 'rejected');
    const reported = valid.reduce((s, e) => s + e.minutes, 0);
    const approved = valid
      .filter((e) => e.status === 'approved' || e.status === 'locked')
      .reduce((s, e) => s + e.minutes, 0);
    const pending = valid.filter((e) => e.status === 'submitted').reduce((s, e) => s + e.minutes, 0);
    const flagged = valid.filter((e) => e.exceptionFlags.length > 0 && e.status === 'submitted');
    const today = new Date().toISOString().slice(0, 10);
    const peopleToday = new Set(valid.filter((e) => e.workDate === today).map((e) => e.personId));
    return { reported, approved, pending, flagged: flagged.length, peopleToday: peopleToday.size };
  }, [sourceEntries]);

  const kpis: KpiItem[] = [
    {
      id: 'people-today',
      label: 'Pessoas hoje',
      value: totals.peopleToday,
      icon: <Users className="h-4 w-4" />,
    },
    { id: 'reported', label: 'Horas no mês', value: formatHours(totals.reported), icon: <Clock className="h-4 w-4" /> },
    { id: 'approved', label: 'Aprovadas', value: formatHours(totals.approved), variant: 'success' },
    {
      id: 'pending',
      label: 'Pendentes',
      value: formatHours(totals.pending),
      variant: totals.pending > 0 ? 'warning' : 'default',
      icon: <Hourglass className="h-4 w-4" />,
    },
    {
      id: 'flagged',
      label: 'Com inconsistência',
      value: totals.flagged,
      variant: totals.flagged > 0 ? 'danger' : 'default',
      tintValue: totals.flagged > 0,
      icon: <AlertTriangle className="h-4 w-4" />,
    },
    {
      id: 'planned',
      label: '% do planejado',
      value:
        plannedHours > 0 ? `${((totals.reported / 60 / plannedHours) * 100).toFixed(0)}%` : '—',
    },
  ];

  /* ── timer / manual actions ── */

  async function handleStart() {
    setBusy(true);
    try {
      const session = await startSession({ projectId });
      setRunning(session);
      notify('Cronômetro iniciado', { variant: 'success' });
    } catch (e) {
      notify('Erro ao iniciar', { description: e instanceof Error ? e.message : undefined, variant: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function handleStop() {
    if (!running) return;
    setBusy(true);
    try {
      await stopSession(running.id);
      setRunning(null);
      await reload();
      notify('Sessão encerrada — pronta para consolidar', { variant: 'success' });
    } catch (e) {
      notify('Erro ao encerrar', { description: e instanceof Error ? e.message : undefined, variant: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function handleManual() {
    const hours = Number(manualHours.replace(',', '.'));
    if (!manualDate || !Number.isFinite(hours) || hours <= 0 || hours > 24) {
      notify('Informe data e horas válidas (0–24)', { variant: 'warning' });
      return;
    }
    setBusy(true);
    try {
      await createManualEntry({
        projectId,
        workDate: manualDate,
        minutes: Math.round(hours * 60),
        description: manualDescription.trim() || null,
      });
      setManualDescription('');
      await reload();
      notify('Apontamento criado como rascunho', { variant: 'success' });
    } catch (e) {
      notify('Erro ao criar apontamento', {
        description: e instanceof Error ? e.message : undefined,
        variant: 'error',
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleConsolidateAndSubmit() {
    setBusy(true);
    try {
      const consolidated = await consolidateMySessions();
      const myDrafts = entries.filter(
        (e) => (e.status === 'draft' || e.status === 'rejected') && e.projectId === projectId,
      );
      const ids = [...consolidated.map((e) => e.id), ...myDrafts.map((e) => e.id)];
      if (ids.length === 0) {
        notify('Nada para enviar', {
          description: 'Encerre o cronômetro ou crie um apontamento manual primeiro.',
          variant: 'warning',
        });
        return;
      }
      const results = await submitEntries(Array.from(new Set(ids)));
      const auto = results.filter((r) => r.autoApproved).length;
      const queued = results.filter((r) => r.status === 'submitted').length;
      notify('Apontamentos enviados', {
        description: `${auto} aprovado(s) automaticamente · ${queued} para revisão do gestor.`,
        variant: 'success',
      });
      await reload();
    } catch (e) {
      notify('Erro ao enviar apontamentos', {
        description: e instanceof Error ? e.message : undefined,
        variant: 'error',
      });
    } finally {
      setBusy(false);
    }
  }

  /* ── operational table (per collaborator) ── */

  type PersonRow = {
    personId: string;
    name: string;
    reportedMinutes: number;
    approvedMinutes: number;
    pendingMinutes: number;
    flags: number;
    lastDate: string;
  };

  const personRows = useMemo<PersonRow[]>(() => {
    const map = new Map<string, PersonRow>();
    for (const e of sourceEntries) {
      if (e.status === 'rejected') continue;
      const row = map.get(e.personId) ?? {
        personId: e.personId,
        name: e.person?.fullName ?? '—',
        reportedMinutes: 0,
        approvedMinutes: 0,
        pendingMinutes: 0,
        flags: 0,
        lastDate: e.workDate,
      };
      row.reportedMinutes += e.minutes;
      if (e.status === 'approved' || e.status === 'locked') row.approvedMinutes += e.minutes;
      if (e.status === 'submitted') {
        row.pendingMinutes += e.minutes;
        row.flags += e.exceptionFlags.length;
      }
      if (e.workDate > row.lastDate) row.lastDate = e.workDate;
      map.set(e.personId, row);
    }
    return Array.from(map.values()).sort((a, b) => b.reportedMinutes - a.reportedMinutes);
  }, [sourceEntries]);

  const personColumns: HudTableColumn<PersonRow>[] = [
    {
      key: 'name',
      header: 'Colaborador',
      cell: (r) => <span className="text-sm font-medium text-ig-fg-strong">{r.name}</span>,
    },
    {
      key: 'reported',
      header: 'Horas no mês',
      align: 'right',
      cell: (r) => (
        <span className="text-sm tabular-nums text-ig-fg-strong">{formatHours(r.reportedMinutes)}</span>
      ),
    },
    {
      key: 'approved',
      header: 'Aprovadas',
      align: 'right',
      cell: (r) => (
        <span className="text-sm tabular-nums text-ig-success">{formatHours(r.approvedMinutes)}</span>
      ),
    },
    {
      key: 'pending',
      header: 'Pendentes',
      align: 'right',
      cell: (r) => (
        <span className={`text-sm tabular-nums ${r.pendingMinutes > 0 ? 'text-ig-warning' : 'text-ig-fg-muted'}`}>
          {r.pendingMinutes > 0 ? formatHours(r.pendingMinutes) : '—'}
        </span>
      ),
    },
    {
      key: 'last',
      header: 'Último registro',
      cell: (r) => <span className="text-xs tabular-nums text-ig-fg-muted">{formatDate(r.lastDate)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (r) =>
        r.flags > 0 ? (
          <HudStatusPill variant="warning" size="sm">
            Revisão ({r.flags})
          </HudStatusPill>
        ) : r.pendingMinutes > 0 ? (
          <HudStatusPill variant="pending" size="sm">
            Aguardando
          </HudStatusPill>
        ) : (
          <HudStatusPill variant="active" size="sm">
            Normal
          </HudStatusPill>
        ),
    },
  ];

  /* ── entries detail table ── */

  const entryColumns: HudTableColumn<TimeEntry>[] = [
    {
      key: 'date',
      header: 'Data',
      cell: (e) => <span className="text-sm tabular-nums text-ig-fg-strong">{formatDate(e.workDate)}</span>,
    },
    {
      key: 'person',
      header: 'Colaborador',
      cell: (e) => <span className="text-sm text-ig-fg-strong">{e.person?.fullName ?? '—'}</span>,
    },
    {
      key: 'minutes',
      header: 'Horas',
      align: 'right',
      cell: (e) => <span className="text-sm tabular-nums text-ig-fg-strong">{formatHours(e.minutes)}</span>,
    },
    {
      key: 'description',
      header: 'Descrição',
      cell: (e) => (
        <span className="line-clamp-1 text-xs text-ig-fg-muted">{e.description ?? '—'}</span>
      ),
    },
    {
      key: 'flags',
      header: 'Exceções',
      cell: (e) =>
        e.exceptionFlags.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {e.exceptionFlags.map((f) => (
              <HudBadge key={f} variant="warning">
                {EXCEPTION_FLAG_LABELS[f]}
              </HudBadge>
            ))}
          </div>
        ) : (
          <span className="text-xs text-ig-fg-muted">—</span>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (e) => (
        <HudStatusPill
          size="sm"
          variant={
            e.status === 'approved' || e.status === 'locked'
              ? 'active'
              : e.status === 'submitted'
                ? 'pending'
                : e.status === 'rejected'
                  ? 'error'
                  : 'neutral'
          }
        >
          {TIME_ENTRY_STATUS_LABELS[e.status]}
          {e.autoApproved ? ' · auto' : ''}
        </HudStatusPill>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      {usingDemo && (
        <div className="flex items-center gap-2">
          <HudBadge variant="warning">dados demonstrativos</HudBadge>
          <span className="text-xs text-ig-fg-muted">
            Nenhum apontamento neste projeto — exibindo exemplo. Ações de escrita desativadas.
          </span>
        </div>
      )}
      {error && (
        <HudPanel state="critical">
          <p className="text-sm text-ig-danger">{error}</p>
        </HudPanel>
      )}

      <HudKpiStrip kpis={kpis} columns={6} />

      {/* meu apontamento */}
      {canUse && (
        <HudPanel title="Meu apontamento" accentColor="emerald">
          {!hasPersonLink && !usingDemo && (
            <p className="mb-3 flex items-center gap-1.5 text-xs text-ig-warning">
              <AlertTriangle className="h-3.5 w-3.5" />
              Seu usuário não está vinculado a uma pessoa — peça ao RH em Pessoas &amp; Custos →
              Pessoas.
            </p>
          )}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* timer */}
            <div className="rounded-xl border border-ig-border-subtle bg-ig-panel/60 p-4">
              <div className="flex items-center justify-between">
                <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-ig-fg-muted">
                  <Timer className="h-4 w-4" /> Cronômetro
                </p>
                {running && running.projectId !== projectId && (
                  <HudBadge variant="info">rodando em outro projeto</HudBadge>
                )}
              </div>
              <p className="mt-2 font-mono text-3xl font-semibold tabular-nums text-ig-fg-strong">
                {running ? elapsedLabel(running.startedAt, now) : '00:00:00'}
              </p>
              <div className="mt-3 flex gap-2">
                {running ? (
                  <HudButton
                    variant="secondary"
                    leftIcon={<Square className="h-4 w-4" />}
                    onClick={() => void handleStop()}
                    disabled={busy}
                  >
                    Encerrar
                  </HudButton>
                ) : (
                  <HudButton
                    variant="primary"
                    leftIcon={<Play className="h-4 w-4" />}
                    onClick={() => void handleStart()}
                    disabled={busy || (!hasPersonLink && !usingDemo)}
                  >
                    Iniciar atividade
                  </HudButton>
                )}
              </div>
              {draftSessions.length > 0 && (
                <p className="mt-2 text-xs text-ig-fg-muted">
                  {draftSessions.length} sessão(ões) encerrada(s) aguardando consolidação.
                </p>
              )}
            </div>

            {/* entrada manual */}
            <div className="rounded-xl border border-ig-border-subtle bg-ig-panel/60 p-4">
              <p className="text-xs font-medium uppercase tracking-wider text-ig-fg-muted">
                Entrada manual
              </p>
              <div className="mt-2 grid grid-cols-2 gap-3">
                <HudInput label="Data" type="date" value={manualDate} onChange={(e) => setManualDate(e.target.value)} />
                <HudInput
                  label="Horas"
                  type="number"
                  min={0.5}
                  max={24}
                  step={0.5}
                  value={manualHours}
                  onChange={(e) => setManualHours(e.target.value)}
                />
              </div>
              <div className="mt-3">
                <HudInput
                  label="Descrição"
                  value={manualDescription}
                  onChange={(e) => setManualDescription(e.target.value)}
                  placeholder="Atividade executada"
                />
              </div>
              <div className="mt-3">
                <HudButton
                  variant="secondary"
                  onClick={() => void handleManual()}
                  disabled={busy || (!hasPersonLink && !usingDemo)}
                >
                  Adicionar rascunho
                </HudButton>
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-ig-border-subtle pt-4">
            <p className="text-xs text-ig-fg-muted">
              Ao enviar, registros sem exceções são aprovados automaticamente; os demais entram na
              fila de aprovação do gestor.
            </p>
            <HudButton
              variant="primary"
              leftIcon={<Send className="h-4 w-4" />}
              onClick={() => void handleConsolidateAndSubmit()}
              disabled={busy || (!hasPersonLink && !usingDemo)}
            >
              Consolidar e enviar
            </HudButton>
          </div>
        </HudPanel>
      )}

      {/* conciliação */}
      <HudPanel title="Conciliação do mês" accentColor="emerald">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <ReconCell label="Planejado" value={plannedHours > 0 ? `${plannedHours.toFixed(0)}h` : '—'} />
          <ReconCell label="Apontado" value={formatHours(totals.reported)} />
          <ReconCell label="Aprovado" value={formatHours(totals.approved)} tone="success" />
          <ReconCell
            label="Não aprovado"
            value={formatHours(Math.max(totals.reported - totals.approved, 0))}
            tone={totals.reported - totals.approved > 0 ? 'warning' : undefined}
          />
        </div>
        {plannedHours > 0 && (
          <div className="mt-4">
            <div className="h-2 overflow-hidden rounded-full bg-ig-panel">
              <div
                className={`h-full rounded-full ${totals.reported / 60 > plannedHours ? 'bg-ig-warning' : 'bg-ig-success'}`}
                style={{
                  width: `${Math.min((totals.reported / 60 / plannedHours) * 100, 120)}%`,
                }}
              />
            </div>
            <p className="mt-1.5 text-xs text-ig-fg-muted">
              {((totals.reported / 60 / plannedHours) * 100).toFixed(0)}% do planejado executado
              {totals.reported / 60 > plannedHours ? ' — acima do planejado' : ''}
            </p>
          </div>
        )}
      </HudPanel>

      {/* tabela por colaborador */}
      <HudPanel title="Equipe no mês" accentColor="emerald">
        <HudTable<PersonRow>
          columns={personColumns}
          data={personRows}
          keyExtractor={(r) => r.personId}
          loading={loading}
          emptyState={
            <HudEmptyState icon="inbox" compact title="Sem apontamentos" description="Nenhuma hora registrada neste mês." />
          }
        />
      </HudPanel>

      {/* registros detalhados */}
      <HudPanel title="Registros do mês" accentColor="emerald">
        <HudTable<TimeEntry>
          columns={entryColumns}
          data={sourceEntries}
          keyExtractor={(e) => e.id}
          loading={loading}
          compact
          emptyState={
            <HudEmptyState icon="inbox" compact title="Sem registros" description="Use o cronômetro ou a entrada manual para apontar horas." />
          }
        />
      </HudPanel>
    </div>
  );
}

function ReconCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'success' | 'warning';
}) {
  return (
    <div className="rounded-lg border border-ig-border-subtle bg-ig-panel/60 px-4 py-3">
      <p className="text-[10px] font-medium uppercase tracking-wider text-ig-fg-muted">{label}</p>
      <p
        className={`mt-1 text-lg font-semibold tabular-nums ${
          tone === 'success' ? 'text-ig-success' : tone === 'warning' ? 'text-ig-warning' : 'text-ig-fg-strong'
        }`}
      >
        {value}
      </p>
    </div>
  );
}
