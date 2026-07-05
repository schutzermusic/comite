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
} from 'lucide-react';
import {
  HudPageLayout,
  HudHeader,
  HudKpiStrip,
  HudTabs,
  HudButton,
  HudEmptyState,
  HudPanel,
  type KpiItem,
  type HudTab,
} from '@/components/hud';
import {
  DecisionPipeline,
  DecisionFilterRail,
  DecisionCard,
  DecisionDetailDrawer,
  NewDeliberationModal,
  DELIBERACOES_MOCK,
  countByStatus,
  countBySla,
  getOpenCount,
  getCriticalCount,
  type Deliberacao,
  type DeliberacaoStatus,
  type DeliberacaoPrioridade,
  type SlaStatus,
  type PipelineStage,
} from '@/components/deliberacoes';
import type { NewDeliberationPayload } from '@/components/deliberacoes/NewDeliberationModal';
import { usePermissions } from '@/hooks/use-permissions';
import { ExportReportButton } from '@/components/reports/ExportReportButton';
import { openDeliberationReport } from '@/lib/reports/modules/deliberation-report';
import type { DeliberationItem, DeliberationStatus } from '@/lib/types';

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

export default function DeliberacoesPage() {
  const { hasPermission, loading: permissionsLoading } = usePermissions();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [newDeliberationOpen, setNewDeliberationOpen] = useState(false);
  const [pendingDraft, setPendingDraft] = useState<NewDeliberationPayload | null>(null);
  const [activeTab, setActiveTab] = useState<string>('fila');
  const [activePipelineStage, setActivePipelineStage] = useState<DeliberacaoStatus | null>(null);
  const [statusFilter, setStatusFilter] = useState<DeliberacaoStatus | 'all'>('all');
  const [prioridadeFilter, setPrioridadeFilter] = useState<DeliberacaoPrioridade | 'all'>('all');
  const [comiteFilter, setComiteFilter] = useState<string>('all');
  const [slaFilter, setSlaFilter] = useState<SlaStatus | 'all'>('all');
  const [responsavelFilter, setResponsavelFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');

  const items = DELIBERACOES_MOCK;

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
    } else if (statusFilter !== 'all') {
      result = result.filter((d) => d.status === statusFilter);
    }

    if (prioridadeFilter !== 'all') {
      result = result.filter((d) => d.prioridade === prioridadeFilter);
    }
    if (comiteFilter !== 'all') {
      result = result.filter((d) => d.comite_nome === comiteFilter);
    }
    if (slaFilter !== 'all') {
      result = result.filter((d) => d.sla_status === slaFilter);
    }
    if (responsavelFilter !== 'all') {
      result = result.filter((d) => d.responsavel_nome === responsavelFilter);
    }

    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      result = result.filter(
        (d) =>
          d.titulo.toLowerCase().includes(term) ||
          d.comite_nome.toLowerCase().includes(term) ||
          d.responsavel_nome.toLowerCase().includes(term) ||
          d.proxima_acao.toLowerCase().includes(term),
      );
    }

    return result;
  }, [
    items,
    activePipelineStage,
    statusFilter,
    prioridadeFilter,
    comiteFilter,
    slaFilter,
    responsavelFilter,
    searchTerm,
  ]);

  const selectedDeliberacao = useMemo(
    () => items.find((d) => d.id === selectedId) ?? null,
    [items, selectedId],
  );

  const activeFilterCount =
    (statusFilter !== 'all' ? 1 : 0) +
    (prioridadeFilter !== 'all' ? 1 : 0) +
    (comiteFilter !== 'all' ? 1 : 0) +
    (slaFilter !== 'all' ? 1 : 0) +
    (responsavelFilter !== 'all' ? 1 : 0);

  const handleClearFilters = () => {
    setStatusFilter('all');
    setPrioridadeFilter('all');
    setComiteFilter('all');
    setSlaFilter('all');
    setResponsavelFilter('all');
  };

  const handleStatusChange = (v: DeliberacaoStatus | 'all') => {
    setStatusFilter(v);
    if (v !== 'all') setActivePipelineStage(null);
  };

  const handlePipelineClick = (s: DeliberacaoStatus | null) => {
    setActivePipelineStage(s);
    if (s !== null) setStatusFilter('all');
  };

  const handleCardClick = (id: string) => {
    setSelectedId(id);
    setDrawerOpen(true);
  };

  const canVote = hasPermission('deliberations.vote');
  const canView = hasPermission('deliberations.view');
  const canCreate = hasPermission('deliberations.create');

  const handleCreateDeliberation = (payload: NewDeliberationPayload) => {
    setPendingDraft(payload);
  };

  // KPIs clicáveis (padrão Contratos): alternam o filtro correspondente da fila.
  const toggleStatusKpi = (status: DeliberacaoStatus) =>
    handleStatusChange(statusFilter === status ? 'all' : status);

  const kpiItems: KpiItem[] = [
    {
      id: 'abertas',
      label: 'Abertas',
      value: getOpenCount(items),
      variant: 'info',
      icon: <FolderOpen className="w-4 h-4" />,
      tintValue: true,
      onClick: () => { handleClearFilters(); setActivePipelineStage(null); },
    },
    {
      id: 'criticas',
      label: 'Críticas',
      value: getCriticalCount(items),
      variant: 'danger',
      icon: <AlertTriangle className="w-4 h-4" />,
      tintValue: true,
      onClick: () => setPrioridadeFilter((current) => (current === 'critica' ? 'all' : 'critica')),
      active: prioridadeFilter === 'critica',
    },
    {
      id: 'aguardando_voto',
      label: 'Aguardando Voto',
      value: countByStatus(items, 'em_votacao'),
      variant: 'info',
      icon: <Vote className="w-4 h-4" />,
      onClick: () => toggleStatusKpi('em_votacao'),
      active: statusFilter === 'em_votacao',
    },
    {
      id: 'atrasadas',
      label: 'Atrasadas',
      value: countBySla(items, 'overdue'),
      variant: 'danger',
      icon: <AlarmClock className="w-4 h-4" />,
      tintValue: true,
      onClick: () => setSlaFilter((current) => (current === 'overdue' ? 'all' : 'overdue')),
      active: slaFilter === 'overdue',
    },
    {
      id: 'tempo_medio',
      label: 'Tempo Médio',
      value: '4.2d',
      variant: 'success',
      icon: <Timer className="w-4 h-4" />,
      onClick: () => { handleClearFilters(); setActivePipelineStage(null); },
    },
    {
      id: 'exec_pendentes',
      label: 'Execuções Pendentes',
      value: countByStatus(items, 'em_execucao'),
      variant: 'warning',
      icon: <PlayCircle className="w-4 h-4" />,
      onClick: () => toggleStatusKpi('em_execucao'),
      active: statusFilter === 'em_execucao',
    },
  ];

  const filaContent = (
    <div className="space-y-4">
      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ig-fg-muted pointer-events-none" />
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Buscar por título, comitê, responsável ou próxima ação..."
          className="w-full rounded-lg border border-ig-border bg-ig-panel/60 pl-10 pr-3 py-2 text-sm text-ig-fg-strong placeholder:text-ig-fg-muted focus:outline-none focus:border-ig-border-focus transition-colors"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="lg:col-span-1">
          <DecisionFilterRail
            statusFilter={statusFilter}
            onStatusChange={handleStatusChange}
            prioridadeFilter={prioridadeFilter}
            onPrioridadeChange={setPrioridadeFilter}
            comiteFilter={comiteFilter}
            onComiteChange={setComiteFilter}
            slaFilter={slaFilter}
            onSlaChange={setSlaFilter}
            responsavelFilter={responsavelFilter}
            onResponsavelChange={setResponsavelFilter}
            comiteOptions={comiteOptions}
            responsavelOptions={responsavelOptions}
            onClear={handleClearFilters}
            activeCount={activeFilterCount}
          />
        </div>
        <div className="lg:col-span-3 space-y-3">
          {filteredItems.length === 0 ? (
            <HudPanel elevation={2}>
              <HudEmptyState
                icon="inbox"
                title="Nenhuma deliberação encontrada"
                description="Ajuste os filtros ou o estágio ativo para ver outros itens."
                action={
                  activeFilterCount > 0 || activePipelineStage !== null
                    ? {
                        label: 'Limpar filtros',
                        onClick: () => {
                          handleClearFilters();
                          setActivePipelineStage(null);
                          setSearchTerm('');
                        },
                        variant: 'secondary',
                      }
                    : undefined
                }
                compact
              />
            </HudPanel>
          ) : (
            filteredItems.map((d) => (
              <DecisionCard
                key={d.id}
                deliberacao={d}
                isSelected={d.id === selectedId}
                onClick={() => handleCardClick(d.id)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );

  const votacaoItems = items.filter((d) => d.status === 'em_votacao');
  const votacaoContent =
    votacaoItems.length === 0 ? (
      <HudPanel elevation={2}>
        <HudEmptyState
          icon="inbox"
          title="Nenhuma deliberação em votação"
          description="Quando uma deliberação entrar em fase de votação, ela aparecerá aqui."
          compact
        />
      </HudPanel>
    ) : (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {votacaoItems.map((d) => (
          <DecisionCard
            key={d.id}
            deliberacao={d}
            isSelected={d.id === selectedId}
            onClick={() => handleCardClick(d.id)}
          />
        ))}
      </div>
    );

  const execucaoItems = items.filter((d) => d.status === 'em_execucao');
  const execucaoContent =
    execucaoItems.length === 0 ? (
      <HudPanel elevation={2}>
        <HudEmptyState
          icon="inbox"
          title="Nenhuma deliberação em execução"
          description="Deliberações aprovadas com plano de execução aparecerão aqui."
          compact
        />
      </HudPanel>
    ) : (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {execucaoItems.map((d) => (
          <DecisionCard
            key={d.id}
            deliberacao={d}
            isSelected={d.id === selectedId}
            onClick={() => handleCardClick(d.id)}
          />
        ))}
      </div>
    );

  const tabs: HudTab[] = [
    { id: 'fila', label: 'Fila', badge: filteredItems.length, content: filaContent },
    {
      id: 'votacao',
      label: 'Em votação',
      badge: votacaoItems.length,
      content: votacaoContent,
    },
    {
      id: 'execucao',
      label: 'Execução',
      badge: execucaoItems.length,
      content: execucaoContent,
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
                source: 'demonstração',
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

      <HudKpiStrip kpis={kpiItems} columns={6} connected size="sm" />

      <DecisionPipeline
        stages={pipelineStages}
        activeStage={activePipelineStage}
        onStageClick={handlePipelineClick}
      />

      {pendingDraft && (
        <HudPanel elevation={2} className="mb-4 border-ig-border-focus bg-ig-accent-weak/30">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-ig-fg-strong">
                Deliberação preparada, ainda não conectada ao Supabase
              </p>
              <p className="mt-1 text-sm text-ig-fg-muted">
                {pendingDraft.title} foi validada no fluxo local, mas não foi salva porque as tabelas reais de deliberações/votações ainda não foram migradas.
              </p>
            </div>
            <HudButton variant="ghost" size="sm" onClick={() => setPendingDraft(null)}>
              Dispensar
            </HudButton>
          </div>
        </HudPanel>
      )}

      <HudTabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} variant="underline" />

      <DecisionDetailDrawer
        deliberacao={selectedDeliberacao}
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        canVote={!permissionsLoading && canVote}
      />

      <NewDeliberationModal
        open={newDeliberationOpen}
        onOpenChange={setNewDeliberationOpen}
        onCreateDeliberation={handleCreateDeliberation}
      />
    </HudPageLayout>
  );
}
