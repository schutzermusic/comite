'use client';

import React, { useMemo, useState } from 'react';
import {
  Gavel,
  Plus,
  Settings2,
  FolderOpen,
  AlertTriangle,
  Vote,
  AlarmClock,
  Timer,
  PlayCircle,
  Search,
  ListFilter,
  X,
} from 'lucide-react';
import {
  HudPageLayout,
  HudHeader,
  HudKpiStrip,
  HudTabs,
  HudButton,
  HudEmptyState,
  HudPanel,
  HudBadge,
  useHudToast,
  type KpiItem,
  type HudTab,
} from '@/components/hud';
import {
  DecisionPipeline,
  DecisionCard,
  DecisionDetailDrawer,
  NewDeliberationModal,
  countByStatus,
  countBySla,
  getOpenCount,
  getCriticalCount,
  type Deliberacao,
  type DeliberacaoStatus,
  type SlaStatus,
  type PipelineStage,
  type DecisionCardAction,
} from '@/components/deliberacoes';
import { useDeliberacoesView } from '@/hooks/use-deliberacoes-view';
import type { UiVoteChoice } from '@/lib/deliberacoes/live-adapter';
import {
  DecisionAdvancedFilters,
  ADVANCED_FILTERS_EMPTY,
  countAdvancedFilters,
  type AdvancedFilterState,
} from '@/components/deliberacoes/DecisionAdvancedFilters';
import type { NewDeliberationPayload } from '@/components/deliberacoes/NewDeliberationModal';
import { usePermissions } from '@/hooks/use-permissions';
import { useMyCommittees } from '@/hooks/use-my-committees';
import { ExportReportButton } from '@/components/reports/ExportReportButton';
import { openDeliberationReport } from '@/lib/reports/modules/deliberation-report';
import type { DeliberationItem, DeliberationStatus } from '@/lib/types';
import { cn } from '@/lib/utils';

const DELIB_STATUS_MAP: Record<DeliberacaoStatus, DeliberationStatus> = {
  rascunho: 'draft',
  em_revisao: 'in_review',
  em_votacao: 'in_voting',
  aguardando_ata: 'awaiting_minutes',
  em_execucao: 'in_execution',
  concluida: 'resolved',
};

/** Adapt the central-deliberations model to the shared report's DeliberationItem. */
function toReportDeliberation(d: Deliberacao): DeliberationItem {
  return {
    id: d.id,
    title: d.titulo,
    deliberationStatus: DELIB_STATUS_MAP[d.status],
    ownerCommitteeName: d.comite_nome,
    ownerName: d.responsavel_nome,
    dueDate: d.sla_deadline ? new Date(d.sla_deadline) : undefined,
    riskLevel: d.risco === 'critico' ? 'critical' : d.risco === 'alto' ? 'high' : d.risco === 'medio' ? 'medium' : 'low',
    createdAt: new Date(d.created_at),
    resolvedAt: d.status === 'concluida' ? new Date(d.updated_at) : undefined,
    executionItems: d.acoes_execucao.map((a) => ({
      id: a.id,
      title: a.titulo,
      ownerName: a.responsavel_nome,
      dueDate: new Date(a.prazo),
      status: a.status === 'concluida' ? 'completed' : a.status === 'em_andamento' ? 'in_progress' : 'pending',
      linkedEntityType: a.linked_entity_tipo as 'project' | 'contract' | 'risk' | undefined,
    })),
  } as unknown as DeliberationItem;
}

const PIPELINE_LABELS: Record<DeliberacaoStatus, string> = {
  rascunho: 'Rascunho',
  em_revisao: 'Em Revisão',
  em_votacao: 'Em Votação',
  aguardando_ata: 'Aguardando Ata',
  em_execucao: 'Em Execução',
  concluida: 'Concluída',
};

const PIPELINE_ORDER: DeliberacaoStatus[] = [
  'rascunho',
  'em_revisao',
  'em_votacao',
  'aguardando_ata',
  'em_execucao',
  'concluida',
];

function worstSlaForStatus(items: Deliberacao[], status: DeliberacaoStatus): SlaStatus | null {
  const subset = items.filter((d) => d.status === status);
  if (subset.length === 0) return null;
  if (subset.some((d) => d.sla_status === 'overdue')) return 'overdue';
  if (subset.some((d) => d.sla_status === 'at_risk')) return 'at_risk';
  return 'on_track';
}

type KpiFilterId = 'abertas' | 'criticas' | 'aguardando_voto' | 'atrasadas' | 'exec_pendentes';

/**
 * Single-select KPI filters (Contratos Executive Band standard): predicates
 * mirror the counts shown in the band, so "click the number → see those
 * decisions". Mutually exclusive with the pipeline stage filter.
 */
const KPI_FILTERS: Record<KpiFilterId, { label: string; predicate: (d: Deliberacao) => boolean }> = {
  abertas: { label: 'Abertas', predicate: (d) => d.status !== 'concluida' },
  criticas: { label: 'Críticas', predicate: (d) => d.prioridade === 'critica' || d.risco === 'critico' },
  aguardando_voto: { label: 'Aguardando voto', predicate: (d) => d.status === 'em_votacao' },
  atrasadas: { label: 'Atrasadas', predicate: (d) => d.sla_status === 'overdue' },
  exec_pendentes: { label: 'Execuções pendentes', predicate: (d) => d.status === 'em_execucao' },
};

export default function DeliberacoesPage() {
  const { hasPermission, roles, loading: permissionsLoading } = usePermissions();
  const { policyCommitteeIds, hasAny: hasCommittee, loading: committeesLoading } = useMyCommittees();

  // Owners/admins veem tudo, independentemente de vínculo a comitê
  // (espelha current_user_is_admin() / o gate da sidebar).
  const isOwnerAdmin =
    roles.some((r) => r.key === 'owner_admin') ||
    hasPermission('admin.manage_users') ||
    hasPermission('admin.manage_roles');
  const { notify } = useHudToast();
  const {
    items,
    loading: dataLoading,
    error: dataError,
    isDemo,
    castVote,
    requestOpinion,
    attachEvidence,
    upsertExecution,
    generateMinutes,
    createTask,
    createDeliberation,
  } = useDeliberacoesView();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [newDeliberationOpen, setNewDeliberationOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<string>('fila');
  const [busy, setBusy] = useState(false);
  // Primary filter: either a KPI condition or a pipeline stage — never both.
  const [activeKpiFilter, setActiveKpiFilter] = useState<KpiFilterId | null>(null);
  const [activePipelineStage, setActivePipelineStage] = useState<DeliberacaoStatus | null>(null);
  const [advancedFilters, setAdvancedFilters] = useState<AdvancedFilterState>(ADVANCED_FILTERS_EMPTY);
  const [searchTerm, setSearchTerm] = useState('');

  const pipelineStages: PipelineStage[] = useMemo(
    () =>
      PIPELINE_ORDER.map((status) => ({
        status,
        label: PIPELINE_LABELS[status],
        count: countByStatus(items, status),
        sla_state: worstSlaForStatus(items, status),
      })),
    [items],
  );

  const comiteOptions = useMemo(
    () => Array.from(new Set(items.map((d) => d.comite_nome))).sort(),
    [items],
  );

  const responsavelOptions = useMemo(
    () => Array.from(new Set(items.map((d) => d.responsavel_nome))).sort(),
    [items],
  );

  const filteredItems = useMemo(() => {
    let result = items;

    if (activePipelineStage !== null) {
      result = result.filter((d) => d.status === activePipelineStage);
    } else if (activeKpiFilter !== null) {
      result = result.filter(KPI_FILTERS[activeKpiFilter].predicate);
    }

    if (advancedFilters.prioridade !== 'all') {
      result = result.filter((d) => d.prioridade === advancedFilters.prioridade);
    }
    if (advancedFilters.comite !== 'all') {
      result = result.filter((d) => d.comite_nome === advancedFilters.comite);
    }
    if (advancedFilters.sla !== 'all') {
      result = result.filter((d) => d.sla_status === advancedFilters.sla);
    }
    if (advancedFilters.responsavel !== 'all') {
      result = result.filter((d) => d.responsavel_nome === advancedFilters.responsavel);
    }

    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      result = result.filter(
        (d) =>
          d.titulo.toLowerCase().includes(term) ||
          d.id.toLowerCase().includes(term) ||
          d.comite_nome.toLowerCase().includes(term) ||
          d.responsavel_nome.toLowerCase().includes(term) ||
          d.proxima_acao.toLowerCase().includes(term),
      );
    }

    return result;
  }, [items, activePipelineStage, activeKpiFilter, advancedFilters, searchTerm]);

  const selectedDeliberacao = useMemo(
    () => items.find((d) => d.id === selectedId) ?? null,
    [items, selectedId],
  );

  const advancedCount = countAdvancedFilters(advancedFilters);
  const hasAnyFilter =
    activeKpiFilter !== null || activePipelineStage !== null || advancedCount > 0 || searchTerm.trim() !== '';

  const handleClearAll = () => {
    setActiveKpiFilter(null);
    setActivePipelineStage(null);
    setAdvancedFilters(ADVANCED_FILTERS_EMPTY);
    setSearchTerm('');
  };

  // KPI band and pipeline are the two primary (single-select) filter systems;
  // activating one clears the other so the queue never gets an empty AND.
  const toggleKpiFilter = (id: KpiFilterId) => {
    setActiveKpiFilter((current) => (current === id ? null : id));
    setActivePipelineStage(null);
    setActiveTab('fila');
  };

  const handlePipelineClick = (s: DeliberacaoStatus | null) => {
    setActivePipelineStage(s);
    if (s !== null) {
      setActiveKpiFilter(null);
      setActiveTab('fila');
    }
  };

  const handleCardClick = (id: string) => {
    setSelectedId(id);
    setDrawerOpen(true);
  };

  const canVote = hasPermission('deliberations.vote');
  const canView = hasPermission('deliberations.view');
  const canCreate = hasPermission('deliberations.create');
  const canRequestOpinion = hasPermission('deliberations.request_opinion') || canCreate;
  const canAttachEvidence = hasPermission('deliberations.attach_evidence') || canCreate;
  const canExecute = hasPermission('deliberations.execute') || canCreate;
  const canMinutes = hasPermission('deliberations.minutes') || hasPermission('deliberations.close') || canCreate;

  // Mutation wrapper — the drawer stays open; useDeliberacoesView refreshes the
  // list in place, so selectedDeliberacao re-derives with the new data while
  // the active tab / search / filters are preserved.
  const runMutation = async (label: string, fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      notify(label, { variant: 'success' });
    } catch (err) {
      notify('Não foi possível concluir a ação', {
        description: err instanceof Error ? err.message : 'Erro inesperado.',
        variant: 'error',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleVote = (id: string) => (choice: UiVoteChoice, justification?: string) =>
    runMutation('Voto registrado.', () => castVote(id, choice, justification));

  const handleRequestOpinion = (id: string) => () => {
    const tipo = (window.prompt('Tipo de parecer (Legal, Finance, Compliance):', 'Legal') ?? '').trim();
    if (!tipo) return;
    const normalized = (['Legal', 'Finance', 'Compliance'].find((t) => t.toLowerCase() === tipo.toLowerCase()) ??
      'Legal') as 'Legal' | 'Finance' | 'Compliance';
    void runMutation('Parecer solicitado.', () => requestOpinion(id, { type: normalized }));
  };

  const handleAttachEvidence = (id: string) => () => {
    const url = (window.prompt('URL ou link da evidência:') ?? '').trim();
    if (!url) return;
    const name = (window.prompt('Nome da evidência:', url.split('/').pop() || 'Evidência') ?? '').trim() || 'Evidência';
    void runMutation('Evidência anexada.', () => attachEvidence(id, { name, url }));
  };

  const handleGenerateMinutes = (id: string) => () =>
    runMutation('Ata gerada e publicada.', () => generateMinutes(id, { publish: true }));

  const handleCreateTask = (id: string) => () => {
    const title = (window.prompt('Título da tarefa de execução:') ?? '').trim();
    if (!title) return;
    void runMutation('Tarefa criada e vinculada.', () => createTask(id, { title, assigneeUserId: null }));
  };

  const handleExecutionToggle = (id: string) => (itemId: string, next: 'pending' | 'in_progress' | 'completed', title: string, ownerName: string, dueDate: string) =>
    runMutation('Execução atualizada.', () =>
      upsertExecution(id, { id: itemId, title, ownerName, dueDate, status: next }),
    );

  const handleCardAction = (id: string) => (action: DecisionCardAction) => {
    // Card quick actions route to the dossier drawer where the real,
    // permission-gated operations live.
    if (action === 'vote' && !canVote) return;
    handleCardClick(id);
  };

  // Mensagem de sucesso por rota de criação (status + próximo passo).
  const CREATE_TOAST: Record<NewDeliberationPayload['route'], string> = {
    voting: 'Deliberação criada e enviada para votação.',
    review: 'Deliberação criada em revisão. Próximo passo: solicitar parecer.',
    draft: 'Rascunho salvo. Complete os dados para enviar.',
  };

  const handleCreateDeliberation = (payload: NewDeliberationPayload) => {
    void runMutation(CREATE_TOAST[payload.route], async () => {
      const created = await createDeliberation(payload);
      // Preserva tab/filtros/busca (spec §4) — o dossiê recém-criado é aberto
      // diretamente, então a decisão fica acessível mesmo se um filtro a ocultar.
      setSelectedId(created.id);
      setDrawerOpen(true);
    });
  };

  const kpiItems: KpiItem[] = [
    {
      id: 'abertas',
      label: 'Abertas',
      value: getOpenCount(items),
      variant: 'info',
      icon: <FolderOpen className="w-4 h-4" />,
      tintValue: true,
      onClick: () => toggleKpiFilter('abertas'),
      active: activeKpiFilter === 'abertas',
    },
    {
      id: 'criticas',
      label: 'Críticas',
      value: getCriticalCount(items),
      variant: 'danger',
      icon: <AlertTriangle className="w-4 h-4" />,
      tintValue: true,
      onClick: () => toggleKpiFilter('criticas'),
      active: activeKpiFilter === 'criticas',
    },
    {
      id: 'aguardando_voto',
      label: 'Aguardando Voto',
      value: countByStatus(items, 'em_votacao'),
      variant: 'info',
      icon: <Vote className="w-4 h-4" />,
      onClick: () => toggleKpiFilter('aguardando_voto'),
      active: activeKpiFilter === 'aguardando_voto',
    },
    {
      id: 'atrasadas',
      label: 'Atrasadas',
      value: countBySla(items, 'overdue'),
      variant: 'danger',
      icon: <AlarmClock className="w-4 h-4" />,
      tintValue: true,
      onClick: () => toggleKpiFilter('atrasadas'),
      active: activeKpiFilter === 'atrasadas',
    },
    {
      // Metric, not a condition — stays informational (no filter semantics).
      id: 'tempo_medio',
      label: 'Tempo Médio',
      value: '4.2d',
      variant: 'success',
      icon: <Timer className="w-4 h-4" />,
    },
    {
      id: 'exec_pendentes',
      label: 'Execuções Pendentes',
      value: countByStatus(items, 'em_execucao'),
      variant: 'warning',
      icon: <PlayCircle className="w-4 h-4" />,
      onClick: () => toggleKpiFilter('exec_pendentes'),
      active: activeKpiFilter === 'exec_pendentes',
    },
  ];

  const renderCards = (list: Deliberacao[], emptyTitle: string, emptyDescription: string) =>
    list.length === 0 ? (
      <HudPanel elevation={2}>
        <HudEmptyState
          icon="inbox"
          title={emptyTitle}
          description={emptyDescription}
          action={
            hasAnyFilter
              ? { label: 'Limpar filtros', onClick: handleClearAll, variant: 'secondary' }
              : undefined
          }
          compact
        />
      </HudPanel>
    ) : (
      // Poucas decisões (1–2): coluna única, cartões largos — evita o cartão
      // pequeno e isolado à esquerda. A partir de 3, volta a duas colunas.
      <div className={cn('grid gap-3', list.length <= 2 ? 'grid-cols-1' : 'grid-cols-1 xl:grid-cols-2')}>
        {list.map((d) => (
          <DecisionCard
            key={d.id}
            deliberacao={d}
            isSelected={d.id === selectedId}
            onClick={() => handleCardClick(d.id)}
            onAction={handleCardAction(d.id)}
            canVote={!permissionsLoading && canVote}
          />
        ))}
      </div>
    );

  const filaContent = (
    <div className="space-y-4">
      {/* Queue toolbar: compact search + advanced filters */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ig-fg-muted pointer-events-none" />
          <input
            type="search"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar deliberação..."
            aria-label="Buscar por título, código, comitê, responsável ou próxima ação"
            className="hud-input-bg backdrop-blur-sm h-9 w-full rounded-lg border pl-8 pr-3 text-xs focus:outline-none focus-visible:shadow-[var(--ig-focus-ring-outer)] transition-all duration-200"
          />
        </div>
        <span className="hidden sm:block text-[11px] text-ig-fg-muted tabular-nums whitespace-nowrap">
          {filteredItems.length} {filteredItems.length === 1 ? 'deliberação' : 'deliberações'}
        </span>
        <div className="ml-auto">
          <DecisionAdvancedFilters
            value={advancedFilters}
            onChange={setAdvancedFilters}
            comiteOptions={comiteOptions}
            responsavelOptions={responsavelOptions}
          />
        </div>
      </div>

      {renderCards(
        filteredItems,
        'Nenhuma deliberação encontrada',
        'Ajuste os filtros, o estágio ativo ou a busca para ver outros itens.',
      )}
    </div>
  );

  const votacaoItems = items.filter((d) => d.status === 'em_votacao');
  const execucaoItems = items.filter((d) => d.status === 'em_execucao');

  const tabs: HudTab[] = [
    { id: 'fila', label: 'Fila', badge: filteredItems.length, content: filaContent },
    {
      id: 'votacao',
      label: 'Em votação',
      badge: votacaoItems.length,
      content: renderCards(
        votacaoItems,
        'Nenhuma deliberação em votação',
        'Quando uma deliberação entrar em fase de votação, ela aparecerá aqui.',
      ),
    },
    {
      id: 'execucao',
      label: 'Execução',
      badge: execucaoItems.length,
      content: renderCards(
        execucaoItems,
        'Nenhuma deliberação em execução',
        'Deliberações aprovadas com plano de execução aparecerão aqui.',
      ),
    },
    {
      id: 'atas',
      label: 'Atas',
      content: (
        <HudPanel elevation={2}>
          <HudEmptyState
            icon="file"
            title="Atas"
            description="Visualização consolidada de atas das deliberações concluídas — em breve."
            compact
          />
        </HudPanel>
      ),
    },
    {
      id: 'auditoria',
      label: 'Auditoria',
      content: (
        <HudPanel elevation={2}>
          <HudEmptyState
            icon="alert"
            title="Auditoria"
            description="Trilha consolidada de auditoria de todas as deliberações — em breve."
            compact
          />
        </HudPanel>
      ),
    },
    {
      id: 'analytics',
      label: 'Analytics',
      content: (
        <HudPanel elevation={2}>
          <HudEmptyState
            icon="package"
            title="Analytics"
            description="Métricas, SLA, throughput e tempo médio de decisão — em breve."
            compact
          />
        </HudPanel>
      ),
    },
  ];

  if (!permissionsLoading && !canView) {
    return (
      <HudPageLayout maxWidth="2xl">
        <HudPanel elevation={2}>
          <HudEmptyState
            icon="alert"
            title="Acesso restrito"
            description="Visualizar deliberações requer a permissão deliberations.view."
            compact
          />
        </HudPanel>
      </HudPageLayout>
    );
  }

  // Deliberações é restrito a membros de comitê: sem vínculo, sem acesso
  // (o item do menu também é ocultado na sidebar). Owners/admins e o modo
  // demonstração são isentos.
  if (!isDemo && !isOwnerAdmin && !committeesLoading && !hasCommittee) {
    return (
      <HudPageLayout maxWidth="2xl">
        <HudPanel elevation={2}>
          <HudEmptyState
            icon="alert"
            title="Acesso restrito"
            description="Deliberações está disponível apenas para membros de comitê. Solicite ao administrador que vincule você a um comitê."
            compact
          />
        </HudPanel>
      </HudPageLayout>
    );
  }

  return (
    <HudPageLayout maxWidth="2xl">
      <HudHeader
        title="Central de Deliberações"
        subtitle="Decisões corporativas com revisão, votação, ata, execução, evidências e auditoria."
        icon={<Gavel className="w-5 h-5" />}
        iconTint="#17C3B2"
        breadcrumbs={[{ label: 'Deliberações' }]}
        statusChips={[
          { label: 'Decision Control Room', variant: 'info' },
          { label: 'Abertas', variant: 'warning', count: getOpenCount(items) },
          { label: 'Atrasadas', variant: 'critical', count: countBySla(items, 'overdue') },
        ]}
        actions={
          <>
            <ExportReportButton
              size="md"
              variant="secondary"
              label="Gerar relatório"
              permission="deliberations.export"
              fallbackPermission="deliberations.view"
              build={() => openDeliberationReport({
                deliberations: (filteredItems.length ? filteredItems : items).map(toReportDeliberation),
                source: isDemo ? 'demonstração' : 'Supabase',
              })}
            />
            <HudButton variant="secondary" size="md" leftIcon={<Settings2 className="w-4 h-4" />}>
              Configurar fluxo
            </HudButton>
            {canCreate && (
              <HudButton
                variant="primary"
                size="md"
                leftIcon={<Plus className="w-4 h-4" />}
                onClick={() => setNewDeliberationOpen(true)}
              >
                Nova deliberação
              </HudButton>
            )}
          </>
        }
      />

      {(isDemo || dataError || dataLoading) && (
        <div
          className="flex flex-wrap items-center gap-2 rounded-lg border border-ig-border-subtle bg-ig-panel/50 px-3 py-2 text-[11.5px]"
          role="status"
        >
          {dataLoading ? (
            <span className="text-ig-fg-muted">Carregando deliberações…</span>
          ) : dataError ? (
            <>
              <HudBadge variant="danger" size="sm">Erro</HudBadge>
              <span className="text-ig-fg-muted">{dataError}</span>
            </>
          ) : (
            <>
              <HudBadge variant="warning" size="sm">Demonstração</HudBadge>
              <span className="text-ig-fg-muted">
                Dados de exemplo — conecte o Supabase para operar deliberações reais (votação, pareceres, execução e ata).
              </span>
            </>
          )}
        </div>
      )}

      <HudKpiStrip kpis={kpiItems} columns={6} connected size="sm" />

      <DecisionPipeline
        stages={pipelineStages}
        activeStage={activePipelineStage}
        onStageClick={handlePipelineClick}
      />

      {/* Active-filter receipt — the band/pipeline are the filters; this is the summary */}
      {(activeKpiFilter !== null || activePipelineStage !== null || advancedCount > 0) && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-ig-fg-muted">
            <ListFilter className="h-3.5 w-3.5" />
            Filtros ativos
          </span>
          {activeKpiFilter !== null && (
            <button
              type="button"
              onClick={() => setActiveKpiFilter(null)}
              title="Remover filtro"
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-ig-border-focus bg-ig-accent-weak px-2.5 text-[11px] font-semibold text-ig-accent transition-colors hover:bg-ig-panel-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--ig-accent)_45%,transparent)]"
            >
              <span className="truncate">{KPI_FILTERS[activeKpiFilter].label}</span>
              <X className="h-3 w-3 shrink-0" />
            </button>
          )}
          {activePipelineStage !== null && (
            <button
              type="button"
              onClick={() => setActivePipelineStage(null)}
              title="Remover estágio"
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-ig-border-focus bg-ig-accent-weak px-2.5 text-[11px] font-semibold text-ig-accent transition-colors hover:bg-ig-panel-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--ig-accent)_45%,transparent)]"
            >
              <span className="truncate">Estágio: {PIPELINE_LABELS[activePipelineStage]}</span>
              <X className="h-3 w-3 shrink-0" />
            </button>
          )}
          {advancedCount > 0 && (
            <button
              type="button"
              onClick={() => setAdvancedFilters(ADVANCED_FILTERS_EMPTY)}
              title="Remover filtros avançados"
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-ig-border bg-ig-panel px-2.5 text-[11px] font-semibold text-ig-fg transition-colors hover:bg-ig-panel-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--ig-accent)_45%,transparent)]"
            >
              <span className="truncate">
                {advancedCount} {advancedCount === 1 ? 'filtro avançado' : 'filtros avançados'}
              </span>
              <X className="h-3 w-3 shrink-0" />
            </button>
          )}
          <span className="text-[11px] text-ig-fg-muted tabular-nums">
            · {filteredItems.length} {filteredItems.length === 1 ? 'resultado' : 'resultados'}
          </span>
        </div>
      )}

      <HudTabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} variant="underline" />

      <DecisionDetailDrawer
        deliberacao={selectedDeliberacao}
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        canVote={!permissionsLoading && canVote}
        canRequestOpinion={!permissionsLoading && canRequestOpinion}
        canAttachEvidence={!permissionsLoading && canAttachEvidence}
        canExecute={!permissionsLoading && canExecute}
        canMinutes={!permissionsLoading && canMinutes}
        busy={busy}
        readOnly={isDemo}
        onVote={selectedDeliberacao ? handleVote(selectedDeliberacao.id) : undefined}
        onRequestOpinion={selectedDeliberacao ? handleRequestOpinion(selectedDeliberacao.id) : undefined}
        onAttachEvidence={selectedDeliberacao ? handleAttachEvidence(selectedDeliberacao.id) : undefined}
        onGenerateMinutes={selectedDeliberacao ? handleGenerateMinutes(selectedDeliberacao.id) : undefined}
        onCreateTask={selectedDeliberacao ? handleCreateTask(selectedDeliberacao.id) : undefined}
        onExecutionToggle={selectedDeliberacao ? handleExecutionToggle(selectedDeliberacao.id) : undefined}
        onExport={
          selectedDeliberacao
            ? () =>
                openDeliberationReport({
                  deliberations: [toReportDeliberation(selectedDeliberacao)],
                  source: isDemo ? 'demonstração' : 'Supabase',
                })
            : undefined
        }
      />

      <NewDeliberationModal
        open={newDeliberationOpen}
        onOpenChange={setNewDeliberationOpen}
        onCreateDeliberation={handleCreateDeliberation}
        allowedCommitteeIds={isDemo || isOwnerAdmin ? undefined : policyCommitteeIds}
      />
    </HudPageLayout>
  );
}
