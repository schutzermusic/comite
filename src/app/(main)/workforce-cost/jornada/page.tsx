'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Banknote, CalendarClock, CheckCircle2, Clock3, ExternalLink,
  FileCheck2, ListChecks, Moon, RefreshCw, Scale, Settings2, Timer, Users,
} from 'lucide-react';
import {
  HudBadge, HudButton, HudDrawer, HudEmptyState, HudHeader, HudInput, HudKpiStrip,
  HudPageLayout, HudPanel, HudSelect, HudStatusPill, HudTable, HudTabs, useHudToast,
  type HudTableColumn, type KpiItem,
} from '@/components/hud';
import { journeyManagementApi, type JourneyManagementResponse } from '@/lib/services/journey-management-client';
import type {
  JourneyDayStatus, JourneyDaySummary, JourneyScheduleExceptionType,
} from '@/lib/types/journey-management';

function currentMonth() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }).slice(0, 7);
}
function monthLabel(month: string) {
  const [year, value] = month.split('-').map(Number);
  return new Date(year, value - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}
function addMonths(month: string, amount: number) {
  const [year, value] = month.split('-').map(Number);
  const date = new Date(year, value - 1 + amount, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}
function fmtMinutes(value: number | null) {
  if (value == null) return '—';
  const sign = value < 0 ? '−' : '';
  const absolute = Math.abs(value);
  return `${sign}${Math.floor(absolute / 60)}h${absolute % 60 ? String(absolute % 60).padStart(2, '0') : ''}`;
}
function fmtTime(value: string | null) {
  return value ? new Date(value).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—';
}
function fmtDate(value: string) {
  return value.split('-').reverse().join('/');
}

const STATUS: Record<JourneyDayStatus, { label: string; variant: 'active' | 'warning' | 'critical' | 'info' | 'neutral' }> = {
  no_schedule: { label: 'Sem escala', variant: 'neutral' },
  expected: { label: 'Previsto', variant: 'info' },
  working: { label: 'Trabalhando', variant: 'active' },
  break: { label: 'Em intervalo', variant: 'warning' },
  closed: { label: 'Encerrada', variant: 'active' },
  absent: { label: 'Sem marcação', variant: 'critical' },
  excused: { label: 'Justificada', variant: 'neutral' },
  incomplete: { label: 'Incompleta', variant: 'critical' },
};

type ScheduleForm = {
  name: string; startTime: string; endTime: string; breakMinutes: string;
  toleranceAfterMinutes: string;
};
type AssignmentForm = { personId: string; templateId: string; validFrom: string };
type ExceptionForm = {
  personId: string; workDate: string; type: JourneyScheduleExceptionType;
  startTime: string; endTime: string; reason: string;
};

export default function JornadaPage() {
  const { notify } = useHudToast();
  const [month, setMonth] = useState(currentMonth());
  const [page, setPage] = useState(1);
  const [data, setData] = useState<JourneyManagementResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<JourneyDaySummary | null>(null);
  const [personFilter, setPersonFilter] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [managerFilter, setManagerFilter] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [correctionPunchId, setCorrectionPunchId] = useState('');
  const [correctionTime, setCorrectionTime] = useState('');
  const [correctionReason, setCorrectionReason] = useState('');
  const [schedule, setSchedule] = useState<ScheduleForm>({
    name: '', startTime: '08:00', endTime: '17:00', breakMinutes: '60', toleranceAfterMinutes: '10',
  });
  const [assignment, setAssignment] = useState<AssignmentForm>({
    personId: '', templateId: '', validFrom: `${currentMonth()}-01`,
  });
  const [exceptionForm, setExceptionForm] = useState<ExceptionForm>({
    personId: '', workDate: new Date().toLocaleDateString('en-CA'), type: 'day_off',
    startTime: '08:00', endTime: '17:00', reason: '',
  });
  const [scopeManager, setScopeManager] = useState('');
  const [scopeMode, setScopeMode] = useState<'direct_team' | 'projects' | 'both'>('direct_team');
  const [scopeProjects, setScopeProjects] = useState<string[]>([]);
  const [reopenReason, setReopenReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await journeyManagementApi.list(month, page, 100));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erro ao carregar a Jornada');
    } finally {
      setLoading(false);
    }
  }, [month, page]);

  useEffect(() => { void load(); }, [load]);

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const departments = useMemo(
    () => [...new Set((data?.people ?? []).map((person) => person.department).filter(Boolean) as string[])].sort(),
    [data],
  );
  const visibleDays = useMemo(() => (data?.days ?? []).filter((day) =>
    (!personFilter || day.personId === personFilter)
    && (!departmentFilter || day.department === departmentFilter)
    && (!statusFilter || day.status === statusFilter)
    && (!managerFilter || data?.people.find((person) => person.id === day.personId)?.managerPersonId === managerFilter)
    && (!projectFilter || day.schedule?.projectId === projectFilter),
  ), [data, personFilter, departmentFilter, statusFilter, managerFilter, projectFilter]);
  const managers = useMemo(() => {
    const ids = new Set((data?.people ?? []).map((person) => person.managerPersonId).filter(Boolean));
    return (data?.people ?? []).filter((person) => ids.has(person.id));
  }, [data]);
  const scheduledProjectIds = useMemo(
    () => [...new Set((data?.days ?? []).map((day) => day.schedule?.projectId).filter(Boolean) as string[])],
    [data],
  );
  const todayDays = visibleDays.filter((day) => day.date === today);
  const pendingDays = visibleDays.filter((day) => day.exceptions.length > 0);
  const balanceDays = visibleDays.filter((day) => day.workedMinutes > 0 || day.expectedMinutes != null);
  const reconDays = visibleDays.filter((day) => day.reportedMinutes > 0 || day.workedMinutes > 0);
  const reviewBlocking = visibleDays.filter((day) =>
    day.exceptions.some((item) => item.severity === 'critical'),
  ).length;

  const kpis: KpiItem[] = [
    { id: 'expected', label: 'Previstos hoje', value: todayDays.filter((d) => d.schedule).length, icon: <CalendarClock className="h-4 w-4" /> },
    { id: 'working', label: 'Trabalhando', value: todayDays.filter((d) => d.status === 'working').length, icon: <Timer className="h-4 w-4" />, variant: 'success' },
    { id: 'break', label: 'Em intervalo', value: todayDays.filter((d) => d.status === 'break').length, variant: 'warning' },
    { id: 'closed', label: 'Encerrados', value: todayDays.filter((d) => d.status === 'closed').length, icon: <CheckCircle2 className="h-4 w-4" /> },
    { id: 'missing', label: 'Sem marcação', value: todayDays.filter((d) => d.status === 'absent').length, variant: 'danger' },
    { id: 'incomplete', label: 'Incompletas', value: todayDays.filter((d) => d.status === 'incomplete').length, variant: 'danger' },
  ];

  async function act(body: Record<string, unknown>, success: string) {
    setBusy(true);
    try {
      await journeyManagementApi.action(body);
      notify(success, { variant: 'success' });
      await load();
    } catch (cause) {
      notify('Falha na ação', { description: cause instanceof Error ? cause.message : undefined, variant: 'error' });
      throw cause;
    } finally {
      setBusy(false);
    }
  }

  async function correctPunch() {
    if (!correctionPunchId || !correctionTime || !correctionReason.trim()) {
      notify('Preencha marcação, novo horário e motivo.', { variant: 'error' });
      return;
    }
    await act({
      action: 'correct',
      punchId: correctionPunchId,
      occurredAt: new Date(`${selected!.date}T${correctionTime}:00`).toISOString(),
      reason: correctionReason,
    }, 'Correção registrada com auditoria.');
    setSelected(null);
  }

  async function decide(days: JourneyDaySummary[], decision: 'approved' | 'rejected') {
    if (!days.length) return;
    setBusy(true);
    try {
      await journeyManagementApi.approve(days, decision);
      notify(`${days.length} saldo(s) ${decision === 'approved' ? 'aprovado(s)' : 'rejeitado(s)'}.`, { variant: 'success' });
      await load();
    } catch (cause) {
      notify('Falha ao decidir saldos', { description: cause instanceof Error ? cause.message : undefined, variant: 'error' });
    } finally {
      setBusy(false);
    }
  }

  const columns: HudTableColumn<JourneyDaySummary>[] = [
    { key: 'person', header: 'Colaborador / dia', cell: (day) => <div><p className="font-medium text-ig-fg-strong">{day.personName}</p><p className="text-xs text-ig-fg-muted">{fmtDate(day.date)} · {day.department ?? 'Sem departamento'}</p></div> },
    { key: 'planned', header: 'Previsto', cell: (day) => day.schedule ? <span className="tabular-nums">{day.schedule.startTime}–{day.schedule.endTime}</span> : <span className="text-ig-fg-muted">Sem escala</span> },
    { key: 'actual', header: 'Realizado', cell: (day) => <span className="tabular-nums">{fmtTime(day.firstIn)}–{fmtTime(day.lastOut)}</span> },
    { key: 'worked', header: 'Jornada', align: 'right', cell: (day) => fmtMinutes(day.workedMinutes) },
    { key: 'break', header: 'Intervalo', align: 'right', cell: (day) => fmtMinutes(day.breakMinutes) },
    { key: 'overtime', header: 'HE', align: 'right', cell: (day) => <span className={day.overtimeMinutes ? 'text-ig-warning' : 'text-ig-fg-muted'}>{fmtMinutes(day.overtimeMinutes)}</span> },
    { key: 'night', header: 'Noturno', align: 'right', cell: (day) => <span className={day.nightMinutes ? 'text-ig-info' : 'text-ig-fg-muted'}>{fmtMinutes(day.nightMinutes)}</span> },
    { key: 'balance', header: 'Saldo', align: 'right', cell: (day) => <span className={day.provisionalBalanceMinutes < 0 ? 'text-ig-danger' : 'text-ig-success'}>{fmtMinutes(day.provisionalBalanceMinutes)}</span> },
    { key: 'status', header: 'Status', cell: (day) => <HudStatusPill size="sm" variant={STATUS[day.status].variant}>{STATUS[day.status].label}</HudStatusPill> },
  ];

  const empty = <HudEmptyState icon="inbox" title="Sem registros" description="Nenhum dado real encontrado para os filtros selecionados." />;
  const table = (rows: JourneyDaySummary[]) => (
    <HudPanel>
      <HudTable columns={columns} data={rows} keyExtractor={(day) => `${day.personId}:${day.date}`} onRowClick={setSelected} loading={loading} emptyState={empty} />
    </HudPanel>
  );

  const schedulesContent = (
    <div className="space-y-4">
      <HudPanel>
        <div className="mb-4 flex items-center justify-between">
          <div><h3 className="font-semibold text-ig-fg-strong">Modelos reutilizáveis</h3><p className="text-xs text-ig-fg-muted">Turnos diurnos ou noturnos, sem horários presumidos.</p></div>
          <HudBadge variant="info">{data?.templates.length ?? 0} modelos</HudBadge>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <HudInput label="Nome" value={schedule.name} onChange={(e) => setSchedule({ ...schedule, name: e.target.value })} />
          <HudInput label="Entrada" type="time" value={schedule.startTime} onChange={(e) => setSchedule({ ...schedule, startTime: e.target.value })} />
          <HudInput label="Saída" type="time" value={schedule.endTime} onChange={(e) => setSchedule({ ...schedule, endTime: e.target.value })} />
          <HudInput label="Intervalo (min)" type="number" value={schedule.breakMinutes} onChange={(e) => setSchedule({ ...schedule, breakMinutes: e.target.value })} />
          <HudInput label="Tolerância (min)" type="number" value={schedule.toleranceAfterMinutes} onChange={(e) => setSchedule({ ...schedule, toleranceAfterMinutes: e.target.value })} />
        </div>
        <div className="mt-3 flex justify-end">
          <HudButton disabled={busy || !data?.permissions.canManageSchedules} onClick={() => void act({
            action: 'create_template', ...schedule, weekdays: [1, 2, 3, 4, 5],
            breakMinutes: Number(schedule.breakMinutes), toleranceBeforeMinutes: 0,
            toleranceAfterMinutes: Number(schedule.toleranceAfterMinutes),
          }, 'Modelo de turno criado.')}>Criar modelo</HudButton>
        </div>
      </HudPanel>

      <div className="grid gap-4 xl:grid-cols-2">
        <HudPanel>
          <h3 className="mb-4 font-semibold text-ig-fg-strong">Atribuir escala por período</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <HudSelect label="Colaborador" value={assignment.personId} onChange={(value) => setAssignment({ ...assignment, personId: value })} options={(data?.people ?? []).map((p) => ({ value: p.id, label: p.fullName }))} />
            <HudSelect label="Modelo" value={assignment.templateId} onChange={(value) => setAssignment({ ...assignment, templateId: value })} options={(data?.templates ?? []).map((t) => ({ value: t.id, label: `${t.name} · ${t.startTime}–${t.endTime}` }))} />
            <HudInput label="Vigência inicial" type="date" value={assignment.validFrom} onChange={(e) => setAssignment({ ...assignment, validFrom: e.target.value })} />
          </div>
          <div className="mt-3 flex justify-end"><HudButton disabled={busy || !data?.permissions.canManageSchedules} onClick={() => void act({ action: 'assign_shift', personId: assignment.personId, shiftTemplateId: assignment.templateId, validFrom: assignment.validFrom }, 'Escala atribuída.')}>Atribuir</HudButton></div>
        </HudPanel>
        <HudPanel>
          <h3 className="mb-4 font-semibold text-ig-fg-strong">Exceção por data</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <HudSelect label="Colaborador" value={exceptionForm.personId} onChange={(value) => setExceptionForm({ ...exceptionForm, personId: value })} options={(data?.people ?? []).map((p) => ({ value: p.id, label: p.fullName }))} />
            <HudSelect label="Tipo" value={exceptionForm.type} onChange={(value) => setExceptionForm({ ...exceptionForm, type: value as JourneyScheduleExceptionType })} options={[{ value: 'day_off', label: 'Folga' }, { value: 'planned_absence', label: 'Ausência prevista' }, { value: 'custom_shift', label: 'Horário especial / troca' }]} />
            <HudInput label="Data" type="date" value={exceptionForm.workDate} onChange={(e) => setExceptionForm({ ...exceptionForm, workDate: e.target.value })} />
            <HudInput label="Motivo obrigatório" value={exceptionForm.reason} onChange={(e) => setExceptionForm({ ...exceptionForm, reason: e.target.value })} />
            {exceptionForm.type === 'custom_shift' && <><HudInput label="Entrada especial" type="time" value={exceptionForm.startTime} onChange={(e) => setExceptionForm({ ...exceptionForm, startTime: e.target.value })} /><HudInput label="Saída especial" type="time" value={exceptionForm.endTime} onChange={(e) => setExceptionForm({ ...exceptionForm, endTime: e.target.value })} /></>}
          </div>
          <div className="mt-3 flex justify-end"><HudButton disabled={busy || !data?.permissions.canManageSchedules} onClick={() => void act({ action: 'create_exception', ...exceptionForm }, 'Exceção registrada.')}>Salvar exceção</HudButton></div>
        </HudPanel>
      </div>

      {data?.permissions.canAdminScopes && (
        <HudPanel>
          <h3 className="mb-1 font-semibold text-ig-fg-strong">Escopo gerencial</h3>
          <p className="mb-4 text-xs text-ig-fg-muted">O administrador define equipe direta, projetos selecionados ou ambos.</p>
          <div className="grid gap-3 md:grid-cols-3">
            <HudSelect label="Gestor" value={scopeManager} onChange={setScopeManager} options={(data.people ?? []).map((p) => ({ value: p.id, label: p.fullName }))} />
            <HudSelect label="Acesso" value={scopeMode} onChange={(v) => setScopeMode(v as typeof scopeMode)} options={[{ value: 'direct_team', label: 'Equipe direta' }, { value: 'projects', label: 'Projetos selecionados' }, { value: 'both', label: 'Equipe direta + projetos' }]} />
            <div>
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-ig-fg-muted">Projetos</p>
              <div className="max-h-32 space-y-1 overflow-auto rounded-lg border border-ig-border p-2">
                {(data.projects ?? []).map((project) => <label key={project.id} className="flex gap-2 text-xs"><input type="checkbox" checked={scopeProjects.includes(project.id)} onChange={(e) => setScopeProjects(e.target.checked ? [...scopeProjects, project.id] : scopeProjects.filter((id) => id !== project.id))} />{project.name}</label>)}
              </div>
            </div>
          </div>
          <div className="mt-3 flex justify-end"><HudButton disabled={busy || !scopeManager} onClick={() => void act({ action: 'save_scope', managerPersonId: scopeManager, accessMode: scopeMode, projectIds: scopeProjects }, 'Escopo gerencial salvo.')}>Salvar escopo</HudButton></div>
        </HudPanel>
      )}
    </div>
  );

  const closingStatus = data?.closingPeriod?.status ?? 'open';
  const closingContent = (
    <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
      <HudPanel>
        <div className="flex items-start justify-between">
          <div><h3 className="font-semibold text-ig-fg-strong">Competência {monthLabel(month)}</h3><p className="mt-1 text-sm text-ig-fg-muted">Gestores revisam o próprio escopo; RH realiza o fechamento final.</p></div>
          <HudStatusPill variant={closingStatus === 'closed' ? 'active' : closingStatus === 'open' ? 'neutral' : 'warning'}>{closingStatus.replace('_', ' ')}</HudStatusPill>
        </div>
        <div className="mt-5 grid gap-2 sm:grid-cols-4">
          {['open', 'manager_review', 'rh_review', 'closed'].map((status, index) => <div key={status} className={`rounded-lg border p-3 text-xs ${status === closingStatus ? 'border-ig-border-focus bg-ig-accent-weak text-ig-accent' : 'border-ig-border text-ig-fg-muted'}`}><span className="mr-2 font-bold">{index + 1}</span>{status.replace('_', ' ')}</div>)}
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          {closingStatus === 'open' && data?.permissions.canClose && <HudButton disabled={busy} onClick={() => void act({ action: 'transition_closing', month, transition: 'start_review' }, 'Revisão dos gestores iniciada.')}>Iniciar revisão</HudButton>}
          {closingStatus === 'manager_review' && data?.permissions.canApprove && <HudButton disabled={busy || reviewBlocking > 0} onClick={() => void act({ action: 'transition_closing', month, transition: 'submit_scope' }, 'Escopo enviado ao RH.')}>Enviar meu escopo</HudButton>}
          {closingStatus === 'manager_review' && data?.permissions.canClose && <HudButton disabled={busy} onClick={() => void act({ action: 'transition_closing', month, transition: 'send_to_rh' }, 'Competência enviada ao RH.')}>Avançar para RH</HudButton>}
          {closingStatus === 'rh_review' && data?.permissions.canClose && <HudButton disabled={busy} onClick={() => void act({ action: 'transition_closing', month, transition: 'close' }, 'Competência fechada.')}>Fechar competência</HudButton>}
          {closingStatus === 'closed' && data?.permissions.canClose && <><HudInput fullWidth={false} placeholder="Justificativa da reabertura" value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} /><HudButton variant="danger" disabled={busy || !reopenReason.trim()} onClick={() => void act({ action: 'transition_closing', month, transition: 'reopen', reason: reopenReason }, 'Competência reaberta com auditoria.')}>Reabrir</HudButton></>}
        </div>
      </HudPanel>
      <HudPanel>
        <h3 className="font-semibold text-ig-fg-strong">Revisões por gestor</h3>
        <div className="mt-3 space-y-2">
          {(data?.managerReviews ?? []).map((review) => <div key={review.id} className="flex justify-between rounded-lg border border-ig-border p-3 text-sm"><span>{data?.people.find((p) => p.id === review.managerPersonId)?.fullName ?? 'Gestor'}</span><HudStatusPill size="sm" variant={review.status === 'submitted' ? 'active' : 'warning'}>{review.status === 'submitted' ? 'Enviado' : 'Pendente'}</HudStatusPill></div>)}
          {!data?.managerReviews.length && <p className="text-sm text-ig-fg-muted">As revisões serão criadas ao iniciar o fechamento.</p>}
        </div>
      </HudPanel>
    </div>
  );

  return (
    <HudPageLayout>
      <div className="space-y-5">
        <HudHeader title="Jornada" subtitle="Central gerencial de operação diária, banco de horas e fechamento" icon={<Timer className="h-5 w-5" />} breadcrumbs={[{ label: 'Pessoas & Custos', href: '/workforce-cost' }, { label: 'Jornada' }]} />
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-56"><HudSelect label="Competência" value={month} onChange={(value) => { setMonth(value); setPage(1); }} options={[-6, -5, -4, -3, -2, -1, 0, 1].map((amount) => { const value = addMonths(currentMonth(), amount); return { value, label: monthLabel(value) }; })} /></div>
          <div className="w-56"><HudSelect label="Colaborador" value={personFilter} onChange={setPersonFilter} placeholder="Todos" options={[{ value: '', label: 'Todos' }, ...(data?.people ?? []).map((p) => ({ value: p.id, label: p.fullName }))]} /></div>
          <div className="w-52"><HudSelect label="Departamento" value={departmentFilter} onChange={setDepartmentFilter} placeholder="Todos" options={[{ value: '', label: 'Todos' }, ...departments.map((value) => ({ value, label: value }))]} /></div>
          <div className="w-52"><HudSelect label="Gestor" value={managerFilter} onChange={setManagerFilter} placeholder="Todos" options={[{ value: '', label: 'Todos' }, ...managers.map((person) => ({ value: person.id, label: person.fullName }))]} /></div>
          <div className="w-52"><HudSelect label="Projeto" value={projectFilter} onChange={setProjectFilter} placeholder="Todos" options={[{ value: '', label: 'Todos' }, ...scheduledProjectIds.map((id) => ({ value: id, label: data?.projects?.find((project) => project.id === id)?.name ?? id }))]} /></div>
          <div className="w-44"><HudSelect label="Status" value={statusFilter} onChange={setStatusFilter} placeholder="Todos" options={[{ value: '', label: 'Todos' }, ...Object.entries(STATUS).map(([value, item]) => ({ value, label: item.label }))]} /></div>
          <HudButton variant="secondary" onClick={() => void load()} disabled={loading}><RefreshCw className="h-4 w-4" /> Atualizar</HudButton>
        </div>
        <div className="flex flex-wrap gap-2">
          <HudBadge variant="info">Registro exclusivo no ponto.insightapex</HudBadge>
          <Link href="/workforce-cost/ponto-revisao" className="inline-flex items-center gap-1 rounded-full border border-ig-border px-3 py-1 text-xs text-ig-fg-muted hover:text-ig-accent">Revisão de Ponto · {data?.reviewCount ?? 0}<ExternalLink className="h-3 w-3" /></Link>
          <Link href="/workforce-cost/ponto-oficial" className="inline-flex items-center gap-1 rounded-full border border-ig-border px-3 py-1 text-xs text-ig-fg-muted hover:text-ig-accent">Ponto Oficial<ExternalLink className="h-3 w-3" /></Link>
        </div>
        {error && <HudPanel state="critical"><p className="text-sm text-ig-danger">{error}</p></HudPanel>}
        <HudKpiStrip kpis={kpis} columns={6} />
        <HudTabs tabs={[
          { id: 'today', label: 'Hoje', icon: <Clock3 className="h-4 w-4" />, content: table(todayDays) },
          { id: 'journeys', label: 'Jornadas', icon: <ListChecks className="h-4 w-4" />, content: table(visibleDays) },
          { id: 'pending', label: 'Pendências', badge: pendingDays.length, icon: <AlertTriangle className="h-4 w-4" />, content: table(pendingDays) },
          { id: 'balance', label: 'Banco de horas', icon: <Banknote className="h-4 w-4" />, content: <div className="space-y-3"><div className="flex justify-end gap-2">{data?.permissions.canApprove && <><HudButton disabled={busy} onClick={() => void decide(balanceDays.filter((d) => d.approvalStatus !== 'approved'), 'approved')}>Aprovar em lote</HudButton><HudButton variant="danger" disabled={busy} onClick={() => void decide(balanceDays.filter((d) => d.approvalStatus !== 'rejected'), 'rejected')}>Rejeitar em lote</HudButton></>}</div>{table(balanceDays)}</div> },
          { id: 'reconciliation', label: 'Conciliação', icon: <Scale className="h-4 w-4" />, content: table(reconDays) },
          { id: 'schedules', label: 'Escalas', icon: <Settings2 className="h-4 w-4" />, content: schedulesContent },
          { id: 'closing', label: 'Fechamento', icon: <FileCheck2 className="h-4 w-4" />, content: closingContent },
        ]} />
        {data?.pagination && data.pagination.totalPages > 1 && <div className="flex items-center justify-end gap-3 text-sm text-ig-fg-muted"><HudButton variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Anterior</HudButton>Página {page} de {data.pagination.totalPages}<HudButton variant="secondary" size="sm" disabled={page >= data.pagination.totalPages} onClick={() => setPage((value) => value + 1)}>Próxima</HudButton></div>}
      </div>

      <HudDrawer isOpen={Boolean(selected)} onClose={() => setSelected(null)} title={selected?.personName} subtitle={selected ? `Jornada de ${fmtDate(selected.date)}` : undefined} width="560px">
        {selected && <div className="space-y-5">
          <div className="grid grid-cols-3 gap-2">
            <HudPanel><p className="text-xs text-ig-fg-muted">Previsto</p><p className="mt-1 font-semibold">{selected.schedule ? `${selected.schedule.startTime}–${selected.schedule.endTime}` : 'Sem escala'}</p></HudPanel>
            <HudPanel><p className="text-xs text-ig-fg-muted">Realizado</p><p className="mt-1 font-semibold">{fmtMinutes(selected.workedMinutes)}</p></HudPanel>
            <HudPanel><p className="text-xs text-ig-fg-muted">Saldo</p><p className="mt-1 font-semibold">{fmtMinutes(selected.provisionalBalanceMinutes)}</p></HudPanel>
          </div>
          <div><h3 className="mb-3 font-semibold text-ig-fg-strong">Linha do tempo fiscal</h3><div className="space-y-2">{selected.punches.map((punch) => <button type="button" key={punch.id} onClick={() => { setCorrectionPunchId(punch.id); setCorrectionTime(new Date(punch.occurredAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })); }} className={`flex w-full items-center justify-between rounded-lg border p-3 text-left ${correctionPunchId === punch.id ? 'border-ig-border-focus bg-ig-accent-weak' : 'border-ig-border'}`}><span><span className="font-medium">{punch.type.replace('_', ' ')}</span><span className="ml-2 text-xs text-ig-fg-muted">NSR {punch.nsr ?? '—'} · {punch.source}</span></span><span className="font-semibold tabular-nums">{fmtTime(punch.occurredAt)}</span></button>)}</div></div>
          <div><h3 className="mb-2 font-semibold text-ig-fg-strong">Evidências e divergências</h3><div className="space-y-2">{selected.exceptions.map((item) => <div key={item.type} className="flex gap-2 rounded-lg border border-ig-border p-3 text-sm"><AlertTriangle className={`h-4 w-4 ${item.severity === 'critical' ? 'text-ig-danger' : 'text-ig-warning'}`} />{item.label}</div>)}{!selected.exceptions.length && <p className="text-sm text-ig-fg-muted">Sem divergências detectadas.</p>}</div></div>
          {data?.permissions.canManage && data.closingPeriod?.status !== 'closed' && <HudPanel><h3 className="mb-3 font-semibold text-ig-fg-strong">Correção auditável</h3><p className="mb-3 text-xs text-ig-fg-muted">O evento original, NSR e hash não serão alterados.</p><div className="space-y-3"><HudInput label="Novo horário" type="time" value={correctionTime} onChange={(e) => setCorrectionTime(e.target.value)} /><HudInput label="Motivo obrigatório" value={correctionReason} onChange={(e) => setCorrectionReason(e.target.value)} /><HudButton disabled={busy || !correctionPunchId} onClick={() => void correctPunch()}>Registrar correção</HudButton></div></HudPanel>}
          {data?.permissions.canApprove && data.closingPeriod?.status !== 'closed' && <HudPanel><h3 className="mb-3 font-semibold text-ig-fg-strong">Decisão do saldo</h3><p className="mb-3 text-sm text-ig-fg-muted">Provisório: {fmtMinutes(selected.provisionalBalanceMinutes)} · consolidado atual: {fmtMinutes(selected.consolidatedBalanceMinutes)}</p><div className="flex gap-2"><HudButton disabled={busy} onClick={() => void decide([selected], 'approved')}>Aprovar</HudButton><HudButton variant="danger" disabled={busy} onClick={() => void decide([selected], 'rejected')}>Rejeitar</HudButton></div></HudPanel>}
          <div><h3 className="mb-2 font-semibold text-ig-fg-strong">Auditoria</h3><p className="text-sm text-ig-fg-muted">Marcações corrigidas permanecem vinculadas ao evento original. Decisões de saldo, fechamento e reabertura são registradas no log corporativo.</p></div>
        </div>}
      </HudDrawer>
    </HudPageLayout>
  );
}
