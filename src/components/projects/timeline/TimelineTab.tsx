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
import { createPortal } from 'react-dom';
import { useSearchParams } from 'next/navigation';
import { Bot, CalendarClock, Crosshair, FileUp, GanttChartSquare, Info, Loader2, Maximize2, Minimize2, Plus, Users2, Workflow } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SignalChip } from '@/components/ui/signal-chip';
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
import {
  computeAssignmentCoverage,
  computeAutonomyMetrics,
  formatRate,
  matchAll,
  EMPTY_AUTONOMY,
  MATCHING_POLICY,
  type EvidenceMatch,
} from '@/lib/projects/execution-matching';
import {
  buildExecutionExceptions,
  buildObservedExecution,
  type ExecutionException,
  type ObservedExecution,
} from '@/lib/projects/execution-derivation';
import {
  loadProjectEvidence,
  EMPTY_EVIDENCE_BUNDLE,
  type ProjectEvidenceBundle,
} from '@/lib/services/execution-evidence';
import { ExecutionExceptionsPanel } from './ExecutionExceptionsPanel';
import {
  buildSessionCandidates,
  autoApplicable,
} from '@/lib/projects/execution-automation';
import {
  computeExecutionAutonomy,
  EMPTY_EXECUTION_AUTONOMY,
  type ApexSessionSummary,
} from '@/lib/projects/execution-policy';
import {
  listApexSessions,
  writeReconstructedSession,
} from '@/lib/services/execution-writeback';
import {
  listProjectTeams,
  listTimelineTeamAssignments,
} from '@/lib/services/project-teams';
import type { ProjectTeam, TimelineTeamAssignment } from '@/lib/types/project-timeline';
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
  const [evidenceBundle, setEvidenceBundle] = useState<ProjectEvidenceBundle>(EMPTY_EVIDENCE_BUNDLE);
  const [teams, setTeams] = useState<ProjectTeam[]>([]);
  const [teamAssignments, setTeamAssignments] = useState<TimelineTeamAssignment[]>([]);
  const [apexSessions, setApexSessions] = useState<ApexSessionSummary[]>([]);
  const [autoRunning, setAutoRunning] = useState(false);
  const [execution, setExecution] = useState<ProjectExecutionModel>(EMPTY_EXECUTION);
  const [counts, setCounts] = useState({ visible: 0, total: 0 });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [newActivityOpen, setNewActivityOpen] = useState(false);
  const [presenting, setPresenting] = useState(false);

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

  /*
    Capacidades como BOOLEANOS, não como closure.

    `usePermissions()` devolve um `hasPermission` novo a cada render. Depender
    da função dentro de um useCallback fazia `reloadExecution` mudar de
    identidade em todo render, o efeito que o chama disparar de novo, e cada
    disparo fazer setState — um laço infinito de fetch/render. Booleanos são
    estáveis por valor e cortam o ciclo.
  */
  const canReadAttendance =
    !permissionsLoading &&
    (hasPermission('people.attendance_view') || hasPermission('people.attendance_manage'));
  const canReadAllocations =
    !permissionsLoading &&
    (hasPermission('people.allocations_view') || hasPermission('people.manage'));

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

    const [deps, logs, data, bundle, projectTeams, itemTeams] = await Promise.all([
      listTimelineDependencies(projectId),
      listDelayLogsByProject(projectId),
      loadProjectExecutionData({ projectId, month: monthKeyOf(now), canReadTimesheet, now }),
      // Cada fonte de evidência tem gate próprio: uma sem permissão não
      // derruba as outras nem entra no denominador das métricas.
      loadProjectEvidence({
        projectId,
        capabilities: {
          timesheet: canReadTimesheet,
          attendance: canReadAttendance,
          allocations: canReadAllocations,
        },
        now,
      }),
      listProjectTeams(projectId),
      listTimelineTeamAssignments(projectId),
    ]);

    setApexSessions(
      (await listApexSessions(projectId)).map((r) => ({
        id: r.id,
        verificationStatus: r.verification_status,
        correctedAt: r.corrected_at,
        durationMinutes: r.duration_minutes,
      })),
    );
    setTeams(projectTeams);
    setTeamAssignments(itemTeams);
    setEvidenceBundle(bundle);
    setDependencies(deps);
    setDelayLogs(logs);
    setEntries(data.entries);
    setSessions(data.sessions);
    setLinks(data.links);
    setAvailability(data.availability);
  }, [projectId, canReadTimesheet, canReadAttendance, canReadAllocations, permissionsLoading]);

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

  /* ─── P2: evidência → casamento → observação → exceções ─── */
  const predecessorsByItem = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const dep of dependencies) {
      const list = map.get(dep.successorId);
      if (list) list.push(dep.predecessorId);
      else map.set(dep.successorId, [dep.predecessorId]);
    }
    return map;
  }, [dependencies]);

  const acquisition = useMemo(() => {
    if (items.length === 0) {
      return {
        matches: [] as EvidenceMatch[],
        observed: new Map<string, ObservedExecution>(),
        exceptions: [] as ExecutionException[],
        candidates: [] as ReturnType<typeof buildSessionCandidates>,
        executionAutonomy: EMPTY_EXECUTION_AUTONOMY,
        autonomy: EMPTY_AUTONOMY,
        coverage: { openLeaves: 0, withExplicitWorker: 0, withTeam: 0, withoutAnyAssignment: 0, workersWithProjectContext: 0 },
      };
    }
    const now = new Date();
    // A ponte pessoa→usuário é a mesma já usada pelo modelo de execução.
    const userIdByPerson = new Map(
      links.filter((l) => l.userId).map((l) => [l.personId, l.userId as string]),
    );

    /*
      Intenção por EQUIPE resolvida para `people`: é o que permite atribuir a
      turma a uma fase inteira sem duplicar cada membro em cada linha do Gantt,
      e sem depender da ponte people↔auth.users.
    */
    const itemsByTeam = new Map<string, string[]>();
    const teamNameByItem = new Map<string, string>();
    for (const ta of teamAssignments) {
      const list = itemsByTeam.get(ta.teamId);
      if (list) list.push(ta.timelineItemId);
      else itemsByTeam.set(ta.teamId, [ta.timelineItemId]);
      if (ta.teamName) teamNameByItem.set(ta.timelineItemId, ta.teamName);
    }
    const teamItemsByPerson = new Map<string, Set<string>>();
    for (const team of teams) {
      const teamItems = itemsByTeam.get(team.id);
      if (!teamItems) continue;
      for (const member of team.members ?? []) {
        const set = teamItemsByPerson.get(member.personId) ?? new Set<string>();
        teamItems.forEach((id) => set.add(id));
        teamItemsByPerson.set(member.personId, set);
      }
    }

    const matches = matchAll(evidenceBundle.evidence, {
      projectId,
      items,
      allocations: evidenceBundle.allocations,
      geofences: evidenceBundle.geofences,
      userIdByPerson,
      teamItemsByPerson,
      teamNameByItem,
    });
    const observed = buildObservedExecution({
      items,
      evidence: evidenceBundle.evidence,
      matches,
      now,
      autoApplyMin: MATCHING_POLICY.autoApplyMin,
    });
    const exceptions = buildExecutionExceptions({
      items,
      evidence: evidenceBundle.evidence,
      matches,
      observed,
      predecessorsByItem,
      now,
    });
    // P3B — o que a automação escreveria a partir desta evidência.
    const candidates = buildSessionCandidates({
      projectId, items, evidence: evidenceBundle.evidence, matches,
    });

    return {
      matches,
      observed,
      exceptions,
      candidates,
      executionAutonomy: computeExecutionAutonomy({
        verdicts: candidates.map((c) => c.verdict),
        sessions: apexSessions,
      }),
      autonomy: computeAutonomyMetrics(matches),
      coverage: computeAssignmentCoverage({
        items,
        teamItemIds: new Set(teamAssignments.map((t) => t.timelineItemId)),
        allocations: evidenceBundle.allocations,
        now,
      }),
    };
  }, [items, evidenceBundle, links, projectId, predecessorsByItem, teams, teamAssignments, apexSessions]);

  /** Alguma fonte de evidência foi realmente lida? */
  const anyEvidenceSource = Object.values(evidenceBundle.sourceStatus).some((s) => s === 'available');
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

  /* ─── Modo apresentação ───────────────────────────────────────────────────
     O fullscreen nativo é pedido no `documentElement`, não no container do
     Gantt. Elemento em fullscreen vai para a TOP LAYER e passa a esconder tudo
     que está fora dele — o drawer da atividade, os modais e os toasts sumiriam
     da tela. Com o documento inteiro em fullscreen, a sobreposição volta a ser
     um simples `fixed` e a pilha de z-index continua valendo (overlay 70 fica
     abaixo do drawer em 80, então clicar numa atividade ainda abre o detalhe).

     O fullscreen é BEST-EFFORT: onde o navegador negar (iframe sem permissão,
     iOS), a sobreposição sozinha já entrega a tela cheia do app.
  */
  const enterPresentation = useCallback(() => {
    setPresenting(true);
    void document.documentElement.requestFullscreen?.().catch(() => {});
  }, []);

  const exitPresentation = useCallback(() => {
    setPresenting(false);
    if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => {});
  }, []);

  useEffect(() => {
    if (!presenting) return;
    // Sair do fullscreen por F11/Esc do navegador precisa desfazer a
    // sobreposição também, senão a tela fica "presa" no modo apresentação.
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) setPresenting(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      // Com o drawer aberto o Esc pertence a ele: fecha o detalhe, não a
      // apresentação.
      if (e.key === 'Escape' && !selectedItemId) exitPresentation();
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [presenting, selectedItemId, exitPresentation]);

  /**
   * Executa o writeback das sessões que a POLÍTICA liberou. Nada aqui decide
   * confiança: `autoApplicable` já filtrou por AUTO_APPLY, e cada escrita
   * passa de novo pela política dentro do serviço — defesa em profundidade.
   */
  const runAutomation = useCallback(async () => {
    const ready = autoApplicable(acquisition.candidates);
    if (ready.length === 0) return;
    setAutoRunning(true);
    let created = 0;
    let unchanged = 0;
    let failed = 0;
    try {
      for (const c of ready) {
        const r = await writeReconstructedSession({
          segment: c.segment, match: c.match, projectId: c.projectId,
        });
        if (r.outcome === 'created' || r.outcome === 'updated') created += 1;
        else if (r.outcome === 'unchanged') unchanged += 1;
        else if (r.outcome === 'verification_failed' || r.outcome === 'error') failed += 1;
      }
      await reloadExecution();
      notify(
        `${created} sessão(ões) registrada(s)` +
          (unchanged > 0 ? ` · ${unchanged} já existia(m)` : '') +
          (failed > 0 ? ` · ${failed} exigem revisão` : ''),
        { variant: failed > 0 ? 'error' : 'success' },
      );
    } catch (e) {
      notify('Falha ao registrar sessões', {
        description: e instanceof Error ? e.message : undefined, variant: 'error',
      });
    } finally {
      setAutoRunning(false);
    }
  }, [acquisition.candidates, reloadExecution, notify]);

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
      <HudButton
        variant="ghost"
        size="sm"
        leftIcon={presenting ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
        onClick={() => (presenting ? exitPresentation() : enterPresentation())}
        title={presenting ? 'Sair da apresentação (Esc)' : 'Expandir o cronograma em tela cheia'}
        className={presenting ? 'text-ig-accent' : undefined}
      >
        {presenting ? 'Sair' : 'Apresentar'}
      </HudButton>
      {presenting && <span className="text-[11px] text-ig-fg-subtle">Esc</span>}

      <span className="mx-1 hidden h-5 w-px bg-ig-border sm:block" />

      {/* Ações de edição saem de cena na apresentação: o comitê vê o
          cronograma, não a barra de ferramentas de quem o mantém. */}
      {items.length > 0 && !presenting && (
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
      {canEdit && !presenting && (
        <HudButton variant="secondary" size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={() => setNewActivityOpen(true)}>
          Nova atividade
        </HudButton>
      )}
      {canImport && !presenting && (
        <HudButton variant="primary" size="sm" leftIcon={<FileUp className="h-4 w-4" />} onClick={() => setImportOpen(true)}>
          Importar MS Project
        </HudButton>
      )}
    </div>
  );

  /*
    Filtros + gráfico. Em modo normal é um wrapper neutro; em apresentação vira
    uma coluna flex que cobre a viewport, e o Gantt (`fill`) cresce até o rodapé
    em vez de parar no teto de 62vh.
  */
  const ganttBlock = (
    <div
      className={cn(
        presenting && 'fixed inset-0 z-[70] flex flex-col gap-2 overflow-hidden bg-ig-canvas p-3',
      )}
    >
      <div className="flex-shrink-0">
        <TimelineFilterRail
          items={items}
          executionKnown={executionKnown}
          visibleCount={counts.visible}
          totalCount={counts.total}
        />
      </div>

      {/*
        Na apresentação o próprio painel é o cabeçalho da tela: leva o nome do
        projeto e o resumo de prazo. Um cabeçalho separado acima repetiria a
        mesma informação e — medido numa viewport de 720px — comia altura
        suficiente para o Gantt ficar MENOR em tela cheia do que no modo normal.
      */}
      <HudPanel
        title={presenting ? projectName : 'Cronograma'}
        subtitle={
          presenting
            ? `Cronograma · ${kpis.overallPercent}% concluído` +
              (schedule.expectedProgressOverall != null
                ? ` · esperado ${schedule.expectedProgressOverall}%`
                : '') +
              (schedule.forecastDelayDays != null && schedule.forecastDelayDays > 0
                ? ` · atraso previsto ${formatDays(schedule.forecastDelayDays)}`
                : '')
            : executionKnown
              ? 'Planejado × apontado por atividade'
              : 'Planejamento e execução'
        }
        icon={<GanttChartSquare className="h-4 w-4" />}
        headerActions={toolbar}
        elevation={1}
        interactive={false}
        sweep={false}
        parallax={false}
        noPadding
        fullHeight={presenting}
        className={presenting ? 'min-h-0 flex-1' : undefined}
      >
        <div className={presenting ? 'flex h-full min-h-0 flex-col' : undefined}>
          <GanttView
            ref={ganttRef}
            items={items}
            execution={execution}
            scheduleByItem={schedule.byItem}
            dependencies={dependencies}
            onVisibleCountChange={handleVisibleCountChange}
            fill={presenting}
          />
          <GanttLegend className="m-2 flex-shrink-0" />
        </div>
      </HudPanel>
    </div>
  );

  /*
    Na apresentação o bloco é PORTADO para o <body>. Medido no navegador, ficar
    no lugar não funciona por duas razões independentes:

    1. Empilhamento — o container da página é `z-10` e o cabeçalho do app é
       `z-40` no MESMO contexto. Qualquer z-index meu compete só DENTRO do z-10,
       então o cabeçalho pintava por cima da apresentação por mais alto que eu
       subisse.
    2. Bloco de contenção — um ancestral animado (transform) fazia o `fixed`
       resolver contra ele, não contra a viewport: a sobreposição nascia 12px
       abaixo do topo e 12px mais curta que a tela.

    No body, o overlay fica em z-70: acima da página e ABAIXO do HudDrawer
    (z-80), então clicar numa atividade ainda abre o detalhe por cima.
  */
  const ganttSection =
    presenting && typeof document !== 'undefined'
      ? createPortal(ganttBlock, document.body)
      : ganttBlock;

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

          {/*
            P2 — aquisição autônoma. A faixa só existe quando ALGUMA fonte de
            evidência foi realmente lida: taxa sobre denominador vazio seria
            métrica fabricada.
          */}
          {anyEvidenceSource && acquisition.autonomy.totalEvidence > 0 && (
            <HudKpiStrip
              columns={5}
              kpis={[
                {
                  id: 'evidence',
                  label: 'Evidências lidas',
                  value: acquisition.autonomy.totalEvidence,
                },
                {
                  id: 'match-rate',
                  label: 'Taxa de casamento',
                  value: formatRate(acquisition.autonomy.matchRate),
                },
                {
                  id: 'autonomy',
                  label: 'Autonomia',
                  value: formatRate(acquisition.autonomy.autonomyRate),
                  variant: (acquisition.autonomy.autonomyRate ?? 0) > 0.5 ? 'success' : 'default',
                  tintValue: (acquisition.autonomy.autonomyRate ?? 0) > 0.5,
                },
                {
                  id: 'ambiguous',
                  label: 'Ambíguas',
                  value: formatRate(acquisition.autonomy.ambiguousRate),
                  variant: (acquisition.autonomy.ambiguousRate ?? 0) > 0 ? 'warning' : 'default',
                  tintValue: (acquisition.autonomy.ambiguousRate ?? 0) > 0,
                },
                {
                  id: 'human',
                  label: 'Exigem decisão',
                  value: acquisition.autonomy.needingHuman,
                  variant: acquisition.autonomy.needingHuman > 0 ? 'warning' : 'default',
                  tintValue: acquisition.autonomy.needingHuman > 0,
                },
              ]}
            />
          )}

          {/*
            P3A — cobertura de INTENÇÃO. Diz ao gestor onde falta declarar
            responsabilidade: é a alavanca direta para subir a autonomia, já
            que atribuição nominal (0,92) e equipe (0,85) casam sozinhas,
            enquanto contexto puro (janela, 0,55) não.
          */}
          {acquisition.coverage.openLeaves > 0 && (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-[11px] text-ig-fg-subtle">
              <Users2 className="h-3.5 w-3.5 shrink-0" />
              <span>
                Intenção declarada: {acquisition.coverage.withExplicitWorker} com responsável ·{' '}
                {acquisition.coverage.withTeam} com equipe ·{' '}
                <span className={acquisition.coverage.withoutAnyAssignment > 0 ? 'text-ig-warning' : undefined}>
                  {acquisition.coverage.withoutAnyAssignment} sem atribuição
                </span>{' '}
                (de {acquisition.coverage.openLeaves} atividades abertas)
              </span>
              {acquisition.coverage.workersWithProjectContext > 0 && (
                <span>· {acquisition.coverage.workersWithProjectContext} pessoa(s) alocada(s) hoje</span>
              )}
            </p>
          )}

          {/*
            P3B — reconciliação. Automação bem-sucedida é INVISÍVEL: esta linha
            só existe quando há algo a fazer ou algo a relatar. O gestor deve
            ver "2 decisões", nunca "73 sessões reconstruídas para revisar".
          */}
          {anyEvidenceSource && acquisition.candidates.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-1 text-[11px] text-ig-fg-subtle">
              <Bot className="h-3.5 w-3.5 shrink-0" />
              {acquisition.executionAutonomy.sessionsReconstructed > 0 && (
                <SignalChip
                  size="xs"
                  tone="success"
                  label={`${acquisition.executionAutonomy.sessionsReconstructed} sessão(ões) reconstruída(s)`}
                />
              )}
              {acquisition.executionAutonomy.sessionsNeedingReview > 0 && (
                <SignalChip
                  size="xs"
                  tone="critical"
                  label={`${acquisition.executionAutonomy.sessionsNeedingReview} falharam na verificação`}
                />
              )}
              {acquisition.executionAutonomy.sessionsCorrected > 0 && (
                <SignalChip
                  size="xs"
                  tone="warning"
                  label={`${acquisition.executionAutonomy.sessionsCorrected} corrigida(s) por pessoa`}
                />
              )}
              <span>
                {autoApplicable(acquisition.candidates).length} sessão(ões) pronta(s) para registro
                automático · {acquisition.executionAutonomy.requireHuman} exigem decisão
                {acquisition.executionAutonomy.executionAutonomyRate != null && (
                  <> · autonomia de execução {formatRate(acquisition.executionAutonomy.executionAutonomyRate)}</>
                )}
              </span>
              {canEdit && autoApplicable(acquisition.candidates).length > 0 && (
                <HudButton
                  variant="secondary"
                  size="sm"
                  isLoading={autoRunning}
                  onClick={() => void runAutomation()}
                >
                  Registrar sessões
                </HudButton>
              )}
            </div>
          )}

          {anyEvidenceSource && (
            <ExecutionExceptionsPanel
              exceptions={acquisition.exceptions}
              onSelectItem={(id) => {
                expandIds(ancestorIdsOf(items, id));
                selectItem(id);
              }}
            />
          )}

          {ganttSection}

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
        observed={selectedItem ? acquisition.observed.get(selectedItem.id) : undefined}
        teams={teams}
        teamAssignments={teamAssignments}
        onTeamsChanged={reloadExecution}
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
