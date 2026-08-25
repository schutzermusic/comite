'use client';

/**
 * Aba Timeline — centro de controle do cronograma do projeto.
 *
 * Carrega em DUAS FASES: o cronograma (migration 032) renderiza primeiro; o
 * apontamento (041) e as dependências hidratam depois, sem bloquear. O Gantt
 * nunca espera o timesheet — que pode estar indisponível por permissão e ainda
 * assim não pode impedir a leitura do cronograma.
 *
 * A permissão de leitura do apontamento é verificada ANTES de qualquer query
 * (ver project-execution.ts): sem ela, as colunas e KPIs de execução são
 * OMITIDOS, não zerados.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CalendarClock, Crosshair, FileUp, GanttChartSquare, Info, Loader2, Plus, Workflow } from 'lucide-react';
import { HudButton, HudEmptyState, HudKpiStrip, HudPanel, useHudToast } from '@/components/hud';
import { usePermissions } from '@/hooks/use-permissions';
import {
  createTimelineItem,
  isTimelineAvailable,
  listDelayLogsByProject,
  listTimelineDependencies,
  listTimelineItems,
} from '@/lib/services/project-timeline';
import { loadProjectExecutionData, monthKeyOf } from '@/lib/services/project-execution';
import { deriveDelayStatus, timelineKpis, ancestorIdsOf, type GanttZoom } from '@/lib/projects/timeline-analytics';
import {
  buildProjectExecution,
  rollupExecution,
  formatHours,
  formatVariance,
  EMPTY_EXECUTION,
  type ExecutionAvailability,
  type PersonUserLink,
  type ProjectExecutionModel,
} from '@/lib/projects/timeline-execution';
import { buildTree } from '@/lib/projects/timeline-analytics';
import { buildScheduleIntelligence, formatDays } from '@/lib/projects/timeline-intelligence';
import type { DelayLog, NewTimelineItemInput, TimelineDependency, TimelineItem } from '@/lib/types/project-timeline';
import type { ProjectWorkSession, TimeEntry } from '@/lib/types/people';
import { GanttView, type GanttViewHandle } from './GanttView';
import { GanttLegend } from './GanttLegend';
import { ImportWizard } from './ImportWizard';
import { NewActivityModal } from './NewActivityModal';
import { TaskDetailDrawer } from './TaskDetailDrawer';
import { TimelineFilterRail } from './TimelineFilterRail';
import { ExecutionFeedPanel } from './ExecutionFeedPanel';
import { useTimelineStore } from './timeline-store';
import { ExportReportButton } from '@/components/reports/ExportReportButton';
import { openProjectTimelineReport } from '@/lib/reports/modules/project-timeline-report';

const ZOOM_TABS: { id: GanttZoom; label: string }[] = [
  { id: 'day', label: 'Dia' },
  { id: 'week', label: 'Semana' },
  { id: 'month', label: 'Mês' },
];

export interface TimelineTabProps {
  projectId: string;
  projectName: string;
  projectManagerUserId?: string | null;
}

export function TimelineTab({ projectId, projectName, projectManagerUserId }: TimelineTabProps) {
  const { hasPermission, loading: permissionsLoading } = usePermissions();
  const { notify } = useHudToast();
  const searchParams = useSearchParams();
  const {
    zoom, setZoom, selectedItemId, selectItem, showDependencies, setShowDependencies,
    clearFilters, expandIds, resetForProject, filters, toggleFlag,
  } = useTimelineStore();

  const [items, setItems] = useState<TimelineItem[]>([]);
  const [dependencies, setDependencies] = useState<TimelineDependency[]>([]);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [sessions, setSessions] = useState<ProjectWorkSession[]>([]);
  const [delayLogs, setDelayLogs] = useState<DelayLog[]>([]);
  const [links, setLinks] = useState<PersonUserLink[]>([]);
  const [availability, setAvailability] = useState<ExecutionAvailability>('unavailable');
  const [execution, setExecution] = useState<ProjectExecutionModel>(EMPTY_EXECUTION);
  const [counts, setCounts] = useState({ visible: 0, total: 0 });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [newActivityOpen, setNewActivityOpen] = useState(false);

  const ganttRef = useRef<GanttViewHandle>(null);
  const deepLinkHandled = useRef<string | null>(null);

  const canImport = hasPermission('projects.timeline.import') || hasPermission('projects.timeline.admin');
  const canEdit = hasPermission('projects.timeline.edit') || hasPermission('projects.timeline.admin');
  // Enquanto as permissões carregam, `hasPermission` responde false para tudo.
  // Tratar isso como "não autorizado" faria a tela AFIRMAR uma ausência que
  // ainda não se sabe — piscando "sem permissão" para quem tem. Só decidimos
  // depois que a resposta chegou.
  const canReadTimesheet =
    !permissionsLoading &&
    (hasPermission('people.timesheet_view') || hasPermission('people.timesheet_approve'));

  // O store é global de módulo: sem isto, recolhimento/seleção/filtros do
  // projeto anterior vazam ao navegar entre projetos sem desmontar a aba.
  useEffect(() => {
    resetForProject(projectId);
  }, [projectId, resetForProject]);

  /* ─── Fase 1: o cronograma ─── */
  const reload = useCallback(async () => {
    if (!isTimelineAvailable()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setItems(await listTimelineItems(projectId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao carregar o cronograma.');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /* ─── Fase 2: execução + dependências, sem bloquear o gráfico ─── */
  const reloadExecution = useCallback(async () => {
    if (!isTimelineAvailable() || permissionsLoading) return;
    const now = new Date();

    const [deps, logs, data] = await Promise.all([
      listTimelineDependencies(projectId),
      listDelayLogsByProject(projectId),
      loadProjectExecutionData({ projectId, month: monthKeyOf(now), canReadTimesheet, now }),
    ]);

    setDependencies(deps);
    setDelayLogs(logs);
    setEntries(data.entries);
    setSessions(data.sessions);
    setLinks(data.links);
    setAvailability(data.availability);
  }, [projectId, canReadTimesheet, permissionsLoading]);

  useEffect(() => {
    if (items.length > 0) void reloadExecution();
  }, [items.length, reloadExecution]);

  /* ─── Modelo de execução (puro, recomputado dos dados brutos) ─── */
  useEffect(() => {
    if (items.length === 0) {
      setExecution(EMPTY_EXECUTION);
      return;
    }
    const model = buildProjectExecution({
      items,
      entries,
      sessions,
      links,
      now: new Date(),
      availability,
    });
    // Fases agregam a subárvore para que uma fase recolhida siga informativa.
    rollupExecution(buildTree(items), model.byItem);
    setExecution(model);
  }, [items, entries, sessions, links, availability]);

  const kpis = useMemo(() => timelineKpis(items, new Date()), [items]);

  /**
   * Inteligência de prazo. Deliberadamente FORA do gate de timesheet: datas e
   * progresso não são horas, então continuam visíveis para quem não pode ler
   * apontamento.
   */
  const schedule = useMemo(
    () => buildScheduleIntelligence({ items, dependencies, now: new Date() }),
    [items, dependencies],
  );
  /** Projeto atrás do plano além da tolerância de 15 p.p. */
  const behindPlan =
    schedule.expectedProgressOverall != null &&
    kpis.overallPercent < schedule.expectedProgressOverall - 15;

  const selectedItem = useMemo(
    () => items.find((i) => i.id === selectedItemId) ?? null,
    [items, selectedItemId],
  );
  const executionKnown = execution.availability === 'available';

  /* ─── Deep link: /projetos/[id]?tab=timeline&item=<uuid> ─── */
  useEffect(() => {
    const itemParam = searchParams?.get('item');
    if (!itemParam || deepLinkHandled.current === itemParam) return;
    if (!items.some((i) => i.id === itemParam)) return;

    deepLinkHandled.current = itemParam;
    // Um filtro ativo pode esconder o item alvo — limpa e abre os ancestrais
    // antes de focar, senão o deep link levaria a uma tela vazia.
    clearFilters();
    expandIds(ancestorIdsOf(items, itemParam));
    selectItem(itemParam);
    requestAnimationFrame(() => ganttRef.current?.scrollToItem(itemParam));
  }, [searchParams, items, selectItem, clearFilters, expandIds]);

  const resolveUserName = useMemo(() => {
    const map = new Map<string, string>();
    items.forEach((i) => (i.assignments ?? []).forEach((a) => { if (a.userId && a.userName) map.set(a.userId, a.userName); }));
    return (userId: string | null) => (userId ? map.get(userId) ?? '—' : '—');
  }, [items]);

  const handleItemChanged = useCallback((updated: TimelineItem) => {
    setItems((prev) => prev.map((i) => (i.id === updated.id ? { ...updated, assignments: updated.assignments ?? i.assignments } : i)));
  }, []);

  const handleCreate = useCallback(async (input: NewTimelineItemInput) => {
    const created = await createTimelineItem(input);
    setItems((prev) => [...prev, created]);
    selectItem(created.id);
  }, [selectItem]);

  const handleVisibleCountChange = useCallback((visible: number, total: number) => {
    setCounts((prev) => (prev.visible === visible && prev.total === total ? prev : { visible, total }));
  }, []);

  const handleDepsChanged = useCallback(async () => {
    setDependencies(await listTimelineDependencies(projectId));
  }, [projectId]);

  /* ─── Estados de carga ─── */
  if (!isTimelineAvailable()) {
    return (
      <HudEmptyState
        icon="alert"
        title="Cronograma requer conexão Supabase"
        description="O cronograma enterprise usa tabelas relacionais (migrations 032/033). Configure NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY."
      />
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-ig-fg-muted">
        <Loader2 className="h-5 w-5 animate-spin" /> Carregando cronograma…
      </div>
    );
  }

  if (error) {
    return (
      <HudEmptyState
        icon="alert"
        title="Falha ao carregar o cronograma"
        description={error}
        action={{ label: 'Tentar novamente', onClick: () => void reload() }}
      />
    );
  }

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      {/* Controle segmentado de zoom. HudTabs não serve aqui: ele é um
          container de abas com painel de conteúdo, e isto é um seletor. */}
      <div
        role="radiogroup"
        aria-label="Escala do cronograma"
        className="flex items-center gap-0.5 rounded-lg border border-ig-border bg-ig-panel p-0.5"
      >
        {ZOOM_TABS.map((z) => (
          <button
            key={z.id}
            type="button"
            role="radio"
            aria-checked={zoom === z.id}
            onClick={() => setZoom(z.id)}
            className={
              zoom === z.id
                ? 'rounded-md bg-ig-accent-weak px-2.5 py-1 text-xs font-semibold text-ig-accent'
                : 'rounded-md px-2.5 py-1 text-xs text-ig-fg-muted hover:bg-ig-panel-hover hover:text-ig-fg'
            }
          >
            {z.label}
          </button>
        ))}
      </div>
      <HudButton
        variant="ghost"
        size="sm"
        leftIcon={<Crosshair className="h-3.5 w-3.5" />}
        onClick={() => ganttRef.current?.scrollToToday()}
        title="Centralizar em hoje"
      >
        Hoje
      </HudButton>
      <HudButton
        variant="ghost"
        size="sm"
        leftIcon={<Workflow className="h-3.5 w-3.5" />}
        onClick={() => setShowDependencies(!showDependencies)}
        title={showDependencies ? 'Ocultar dependências' : 'Mostrar dependências'}
        className={showDependencies ? 'text-ig-accent' : undefined}
      >
        Dependências
      </HudButton>

      <span className="mx-1 hidden h-5 w-px bg-ig-border sm:block" />

      {items.length > 0 && (
        <ExportReportButton
          size="sm"
          variant="secondary"
          permission="projects.export"
          fallbackPermission="projects.view"
          build={() => openProjectTimelineReport({
            projectName,
            items,
            resolveUserName,
            source: 'Supabase',
            execution: executionKnown
              ? items.map((item) => {
                  const exec = execution.byItem.get(item.id);
                  return {
                    itemId: item.id,
                    plannedHours: exec?.plannedHours ?? null,
                    loggedHours: exec?.loggedHours ?? null,
                    variance: exec?.variance ?? null,
                    lastActivityAt: exec?.lastActivityAt ?? null,
                    collaborators: (exec?.collaborators ?? []).map((c) => c.name),
                  };
                })
              : undefined,
          })}
        />
      )}
      {canEdit && (
        <HudButton variant="secondary" size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={() => setNewActivityOpen(true)}>
          Nova atividade
        </HudButton>
      )}
      {canImport && (
        <HudButton variant="primary" size="sm" leftIcon={<FileUp className="h-4 w-4" />} onClick={() => setImportOpen(true)}>
          Importar MS Project
        </HudButton>
      )}
    </div>
  );

  return (
    <div className="space-y-3">
      {items.length === 0 ? (
        <HudEmptyState
          icon="file"
          title="Nenhuma atividade no cronograma"
          description="Importe o PDF exportado do MS Project ou crie atividades manualmente."
          action={canImport ? { label: 'Importar cronograma MS Project', onClick: () => setImportOpen(true) } : undefined}
          secondaryAction={canEdit ? { label: 'Nova atividade', onClick: () => setNewActivityOpen(true) } : undefined}
        />
      ) : (
        <>
          {/* KPIs de cronograma — clicar aplica o recorte no gráfico. */}
          <HudKpiStrip
            columns={6}
            connected={executionKnown}
            kpis={[
              {
                id: 'progress',
                label: schedule.expectedProgressOverall == null
                  ? '% cronograma'
                  : `% cronograma (esperado ${schedule.expectedProgressOverall}%)`,
                value: `${kpis.overallPercent}%`,
                // Atrás do plano além da tolerância vira alerta visual.
                variant: behindPlan ? 'warning' : 'default',
                tintValue: behindPlan,
                onClick: () => clearFilters(),
              },
              { id: 'delayed', label: 'Atrasadas', value: kpis.delayedCount, variant: kpis.delayedCount > 0 ? 'danger' : 'default', tintValue: kpis.delayedCount > 0, onClick: () => toggleFlag('delayed'), active: filters.flags.has('delayed') },
              { id: 'blocked', label: 'Bloqueadas', value: kpis.blockedCount, variant: kpis.blockedCount > 0 ? 'warning' : 'default', tintValue: kpis.blockedCount > 0, onClick: () => toggleFlag('blocked'), active: filters.flags.has('blocked') },
              { id: 'no-resp', label: 'Sem responsável', value: kpis.missingResponsible, onClick: () => toggleFlag('no_responsible'), active: filters.flags.has('no_responsible') },
              {
                id: 'milestones-risk',
                label: 'Marcos em risco',
                value: schedule.milestonesAtRisk.length,
                variant: schedule.milestonesAtRisk.length > 0 ? 'warning' : 'default',
                tintValue: schedule.milestonesAtRisk.length > 0,
                onClick: () => {
                  const first = schedule.milestonesAtRisk[0];
                  if (first) selectItem(selectedItemId === first.itemId ? null : first.itemId);
                },
                active: schedule.milestonesAtRisk.some((m) => m.itemId === selectedItemId),
              },
              {
                id: 'forecast',
                label: 'Atraso previsto',
                value: formatDays(schedule.forecastDelayDays),
                variant: (schedule.forecastDelayDays ?? 0) > 0 ? 'danger' : 'default',
                tintValue: (schedule.forecastDelayDays ?? 0) > 0,
              },
            ]}
          />

          {/* Strip de execução: só existe quando o apontamento é legível. */}
          {executionKnown && (
            <>
              <HudKpiStrip
                columns={5}
                kpis={[
                  {
                    id: 'planned-hours',
                    label: 'Horas planejadas',
                    // null (nenhuma atividade com duração) vira "—", nunca "0 h":
                    // zero apurado e ausência de fonte são coisas diferentes.
                    value: formatHours(execution.totals.plannedHours),
                  },
                  { id: 'logged-hours', label: 'Horas apontadas', value: formatHours(execution.totals.loggedHours) },
                  {
                    id: 'effort-variance',
                    label: 'Variação de esforço',
                    value: formatVariance(execution.totals.effortVariance),
                    variant: (execution.totals.effortVariance ?? 0) > 0 ? 'warning' : 'default',
                    tintValue: (execution.totals.effortVariance ?? 0) > 0,
                    onClick: () => toggleFlag('over_effort'),
                    active: filters.flags.has('over_effort'),
                  },
                  {
                    id: 'workers-today',
                    label: 'Pessoas hoje',
                    value: execution.totals.activeWorkersToday ?? '—',
                    variant: (execution.totals.activeWorkersToday ?? 0) > 0 ? 'success' : 'default',
                    tintValue: (execution.totals.activeWorkersToday ?? 0) > 0,
                    onClick: () => toggleFlag('worked_today'),
                    active: filters.flags.has('worked_today'),
                  },
                  {
                    id: 'stale',
                    label: 'Sem atividade recente',
                    value: execution.totals.noRecentActivityCount ?? '—',
                    variant: (execution.totals.noRecentActivityCount ?? 0) > 0 ? 'warning' : 'default',
                    tintValue: (execution.totals.noRecentActivityCount ?? 0) > 0,
                    onClick: () => toggleFlag('no_recent_activity'),
                    active: filters.flags.has('no_recent_activity'),
                  },
                ]}
              />

              {/*
                Estado de dado incompleto dito com números. Sem isto, "Horas
                planejadas —" pareceria um bug; com isto, o gestor sabe que a
                origem é o cadastro e onde agir.
              */}
              {execution.coverage.leaves > 0 &&
                execution.coverage.withPlannedHours < execution.coverage.leaves && (
                  <p className="flex items-center gap-1.5 px-1 text-[11px] text-ig-fg-subtle">
                    <Info className="h-3.5 w-3.5 shrink-0" />
                    Horas planejadas cadastradas em {execution.coverage.withPlannedHours} de{' '}
                    {execution.coverage.leaves} atividades
                    {execution.coverage.withPlannedHours === 0 &&
                      ' — indicadores de esforço permanecem indisponíveis até o cadastro'}
                    . Informe a duração no detalhe da atividade.
                  </p>
                )}
            </>
          )}

          <TimelineFilterRail
            items={items}
            executionKnown={executionKnown}
            visibleCount={counts.visible}
            totalCount={counts.total}
          />

          <HudPanel
            title="Cronograma"
            subtitle={executionKnown ? 'Planejado × apontado por atividade' : 'Planejamento e execução'}
            icon={<GanttChartSquare className="h-4 w-4" />}
            headerActions={toolbar}
            elevation={1}
            interactive={false}
            sweep={false}
            parallax={false}
            noPadding
          >
            <GanttView
              ref={ganttRef}
              items={items}
              execution={execution}
              scheduleByItem={schedule.byItem}
              dependencies={dependencies}
              onVisibleCountChange={handleVisibleCountChange}
            />
            <GanttLegend className="m-2" />
          </HudPanel>

          {executionKnown && (
            <ExecutionFeedPanel
              items={items}
              entries={entries}
              sessions={sessions}
              delayLogs={delayLogs}
              onSelectItem={selectItem}
            />
          )}

          {!canReadTimesheet && !permissionsLoading && (
            <p className="flex items-center gap-1.5 px-1 text-[11px] text-ig-fg-subtle">
              <CalendarClock className="h-3.5 w-3.5" />
              Horas de apontamento não exibidas: seu perfil não tem permissão de leitura do timesheet.
            </p>
          )}
        </>
      )}

      <TaskDetailDrawer
        item={selectedItem}
        items={items}
        dependencies={dependencies}
        execution={selectedItem ? execution.byItem.get(selectedItem.id) : undefined}
        schedule={selectedItem ? schedule.byItem.get(selectedItem.id) : undefined}
        executionKnown={executionKnown}
        entries={entries}
        sessions={sessions}
        projectName={projectName}
        projectManagerUserId={projectManagerUserId}
        onClose={() => selectItem(null)}
        onChanged={handleItemChanged}
        onDepsChanged={handleDepsChanged}
      />

      <NewActivityModal
        open={newActivityOpen}
        projectId={projectId}
        items={items}
        onClose={() => setNewActivityOpen(false)}
        onCreate={handleCreate}
      />

      <ImportWizard
        projectId={projectId}
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => {
          void reload();
          void reloadExecution();
        }}
      />
    </div>
  );
}
