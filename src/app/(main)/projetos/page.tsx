'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback, Suspense } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Briefcase,
  FolderKanban,
  Search,
  TrendingUp,
  DollarSign,
  AlertTriangle,
  Building2,
  Eye,
  Download,
  Trash2,
  Heart,
  Clock,
  ShieldAlert,
  BarChart3,
  LayoutGrid,
  Table2,
  Plus,
} from "lucide-react";
import { useHudToast } from "@/hooks/useHudToast";
import { getProjects, getProjectsV2, deleteProject } from "@/lib/services/projects";
import type { Project } from "@/lib/types";
import type { ProjectV2 } from "@/lib/types/project-v2";
import { ProjectDetailDrawer } from "@/components/portfolio/ProjectDetailDrawer";
import { getHealthScoreColor, formatMoney } from "@/lib/utils/project-utils";

// New Glass HUD Components
import {
  HudPageLayout,
  HudHeader,
  HudKpiStrip,
  HudFilterBar,
  HudPanel,
  HudTable,
  HudButton,
  HudBadge,
  HudStatusPill,
  HudProgressBar,
  HudEmptyState,
  type KpiItem,
  type HudTableColumn,
  type FilterGroup,
} from "@/components/hud";

function PortfolioProjetosInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useHudToast();
  const t = useTranslations('projects');
  const tCommon = useTranslations('common');
  const highlightedRowRef = useRef<HTMLTableRowElement>(null);

  // URL params
  const stateParam = searchParams.get('state');
  const ufParam = searchParams.get('uf');
  const projectIdParam = searchParams.get('projectId');
  const contractIdParam = searchParams.get('contractId');

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [comiteFilter, setComiteFilter] = useState("all");
  const [impactoFilter, setImpactoFilter] = useState("all");
  const [clientFilter, setClientFilter] = useState("all");
  const [healthFilter, setHealthFilter] = useState("all");
  const [contractFilter, setContractFilter] = useState("all");
  const [ufFilter, setUfFilter] = useState<string | null>(null);
  const [highlightedProjectId, setHighlightedProjectId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsV2, setProjectsV2] = useState<ProjectV2[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [projectDrawerOpen, setProjectDrawerOpen] = useState(false);

  // Load projects
  useEffect(() => {
    setProjects(getProjects());
    try {
      setProjectsV2(getProjectsV2());
    } catch { /* v2 not available */ }
  }, []);

  // Apply deep-link params
  useEffect(() => {
    const stateFromParam = stateParam || ufParam;
    if (stateFromParam) {
      setUfFilter(stateFromParam);
      toast({
        title: t('filteredBy', { param: stateFromParam }),
        description: projectIdParam
          ? t('projectSelected', { id: projectIdParam })
          : t('showingStateProjects', { uf: stateFromParam }),
      });
    }
    if (projectIdParam) {
      setHighlightedProjectId(projectIdParam);
      setViewMode('table');
    }
    if (contractIdParam) {
      setHighlightedProjectId(contractIdParam);
      setViewMode('table');
    }
  }, [contractIdParam, projectIdParam, stateParam, toast, t, ufParam]);

  // Scroll to highlighted row
  useEffect(() => {
    if (highlightedRowRef.current && highlightedProjectId) {
      highlightedRowRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlightedProjectId, viewMode]);

  // Open drawer for highlighted project
  useEffect(() => {
    if (!highlightedProjectId || projects.length === 0) return;
    const target = projects.find((p) => p.id === highlightedProjectId);
    if (target) {
      setSelectedProject(target);
      setProjectDrawerOpen(true);
    }
  }, [highlightedProjectId, projects]);

  // Sync filters to URL
  const updateURL = useCallback((overrides: Record<string, string>) => {
    const params = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(overrides)) {
      if (value === 'all' || !value) params.delete(key);
      else params.set(key, value);
    }
    const newURL = params.toString() ? `?${params.toString()}` : window.location.pathname;
    window.history.replaceState(null, '', newURL);
  }, []);

  useEffect(() => {
    updateURL({ status: statusFilter, client: clientFilter, health: healthFilter, view: viewMode });
  }, [statusFilter, clientFilter, healthFilter, viewMode, updateURL]);

  const comites = useMemo(() =>
    projects
      .map((p) => ({ id: p.comite_id, nome: p.comite_nome }))
      .filter((v, i, a) => a.findIndex((t) => t.id === v.id) === i)
      .filter((c) => c.id && c.nome) as { id: string; nome: string }[],
    [projects]
  );

  const uniqueClients = useMemo(
    () => [...new Set(projects.map((p) => p.cliente).filter(Boolean))] as string[],
    [projects]
  );

  const v2Map = useMemo(() => {
    const m = new Map<string, ProjectV2>();
    projectsV2.forEach((p) => m.set(p.id, p));
    return m;
  }, [projectsV2]);

  // Filter projects
  const filteredProjects = useMemo(() => {
    return projects.filter((projeto) => {
      const searchMatch =
        projeto.nome?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        projeto.codigo?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        projeto.cliente?.toLowerCase().includes(searchTerm.toLowerCase());

      const statusMatch = statusFilter === 'all' || projeto.status === statusFilter;
      const comiteMatch =
        comiteFilter === 'all' ||
        (comiteFilter === 'sem_comite' && !projeto.comite_id) ||
        projeto.comite_id === comiteFilter;
      const impactoMatch = impactoFilter === 'all' || projeto.impacto_financeiro === impactoFilter;
      const clientMatch = clientFilter === 'all' || projeto.cliente === clientFilter;

      let healthMatch = true;
      if (healthFilter !== 'all') {
        const v2 = v2Map.get(projeto.id);
        const score = v2?.health_score ?? 100;
        if (healthFilter === 'critical') healthMatch = score < 40;
        else if (healthFilter === 'attention') healthMatch = score >= 40 && score < 60;
        else if (healthFilter === 'good') healthMatch = score >= 60 && score < 80;
        else if (healthFilter === 'excellent') healthMatch = score >= 80;
      }

      let contractMatch = true;
      if (contractFilter !== 'all') {
        const v2 = v2Map.get(projeto.id);
        if (contractFilter === 'yes') contractMatch = !!v2?.contract_id;
        else if (contractFilter === 'no') contractMatch = !v2?.contract_id;
      }

      const stateMatch = !ufFilter || v2Map.get(projeto.id)?.uf === ufFilter;

      return searchMatch && statusMatch && comiteMatch && impactoMatch && clientMatch && healthMatch && contractMatch && stateMatch;
    });
  }, [projects, searchTerm, statusFilter, comiteFilter, impactoFilter, clientFilter, healthFilter, contractFilter, ufFilter, v2Map]);

  // Calculate stats
  const stats = useMemo(() => {
    const total = projects.length;
    const emAndamento = projects.filter((p) => p.status === 'em_andamento').length;
    const concluidos = projects.filter((p) => p.status === 'concluido').length;
    const valorTotal = projects.reduce((sum, p) => sum + (p.valor_total || 0), 0);
    const altoImpacto = projects.filter((p) => p.impacto_financeiro === 'alto' || p.impacto_financeiro === 'critico').length;

    // V2 stats
    let v2Stats = null;
    if (projectsV2.length > 0) {
      const now = new Date().toISOString();
      const overdueTasks = projectsV2.reduce(
        (sum, p) => sum + (p.tasks || []).filter((t) => t.status !== 'completed' && t.endDate < now).length, 0
      );
      const openHighRisks = projectsV2.reduce(
        (sum, p) =>
          sum +
          (p.risks || []).filter((r) => r.status !== 'resolved' && (r.severity === 'high' || r.severity === 'critical') && !r.mitigation).length,
        0
      );
      const budgetVarianceProjects = projectsV2.filter((p) => p.finance && p.finance.variancePercent > 5).length;
      const avgHealth = Math.round(projectsV2.reduce((sum, p) => sum + (p.health_score || 0), 0) / projectsV2.length);
      v2Stats = { overdueTasks, openHighRisks, budgetVarianceProjects, avgHealth };
    }

    return { total, emAndamento, concluidos, valorTotal, altoImpacto, v2Stats };
  }, [projects, projectsV2]);

  // KPI items for HudKpiStrip
  const kpiItems: KpiItem[] = useMemo(() => {
    const items: KpiItem[] = [
      {
        id: 'total',
        value: stats.total,
        label: tCommon('projects'),
        variant: 'info',
        icon: <Briefcase className="w-5 h-5" />,
      },
      {
        id: 'inProgress',
        value: stats.emAndamento,
        label: t('inProgress'),
        variant: 'success',
        icon: <TrendingUp className="w-5 h-5" />,
      },
      {
        id: 'value',
        value: formatMoney(stats.valorTotal),
        label: t('totalValue'),
        variant: 'default',
        icon: <DollarSign className="w-5 h-5" />,
      },
      {
        id: 'highImpact',
        value: stats.altoImpacto,
        label: t('highImpact'),
        variant: stats.altoImpacto > 0 ? 'warning' : 'default',
        icon: <AlertTriangle className="w-5 h-5" />,
      },
    ];

    if (stats.v2Stats) {
      items.push(
        {
          id: 'health',
          value: stats.v2Stats.avgHealth,
          label: t('healthScore'),
          variant: stats.v2Stats.avgHealth >= 80 ? 'success' : stats.v2Stats.avgHealth >= 60 ? 'info' : 'warning',
          icon: <Heart className="w-5 h-5" />,
          suffix: '%',
        },
        {
          id: 'risks',
          value: stats.v2Stats.openHighRisks,
          label: t('openRisks'),
          variant: stats.v2Stats.openHighRisks > 0 ? 'danger' : 'default',
          icon: <ShieldAlert className="w-5 h-5" />,
        }
      );
    }

    return items;
  }, [stats, t, tCommon]);

  // Filter groups for HudFilterBar
  const filterGroups: FilterGroup[] = useMemo(() => [
    {
      id: 'status',
      label: tCommon('status'),
      value: statusFilter,
      options: [
        { value: 'all', label: t('allStatus') },
        { value: 'planejamento', label: t('planning') },
        { value: 'em_andamento', label: t('inProgress') },
        { value: 'pausado', label: t('paused') },
        { value: 'concluido', label: t('completed') },
        { value: 'cancelado', label: t('cancelled') },
      ],
      onChange: setStatusFilter,
    },
    {
      id: 'comite',
      label: tCommon('committee'),
      value: comiteFilter,
      options: [
        { value: 'all', label: t('allCommittees') },
        ...comites.map((c) => ({ value: c.id, label: c.nome })),
        { value: 'sem_comite', label: t('noSupervision') },
      ],
      onChange: setComiteFilter,
    },
    {
      id: 'impact',
      label: tCommon('impact'),
      value: impactoFilter,
      options: [
        { value: 'all', label: t('allImpacts') },
        { value: 'baixo', label: t('low') },
        { value: 'medio', label: t('medium') },
        { value: 'alto', label: t('high') },
        { value: 'critico', label: t('critical') },
      ],
      onChange: setImpactoFilter,
    },
    {
      id: 'client',
      label: tCommon('client'),
      value: clientFilter,
      options: [
        { value: 'all', label: t('allClients') },
        ...uniqueClients.map((c) => ({ value: c, label: c })),
      ],
      onChange: setClientFilter,
    },
    {
      id: 'health',
      label: tCommon('health'),
      value: healthFilter,
      options: [
        { value: 'all', label: t('allHealth') },
        { value: 'excellent', label: t('healthExcellent') },
        { value: 'good', label: t('healthGood') },
        { value: 'attention', label: t('healthAttention') },
        { value: 'critical', label: t('healthCritical') },
      ],
      onChange: setHealthFilter,
    },
  ], [statusFilter, comiteFilter, impactoFilter, clientFilter, healthFilter, comites, uniqueClients, t, tCommon]);

  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (statusFilter !== 'all') count++;
    if (comiteFilter !== 'all') count++;
    if (impactoFilter !== 'all') count++;
    if (clientFilter !== 'all') count++;
    if (healthFilter !== 'all') count++;
    if (ufFilter) count++;
    return count;
  }, [statusFilter, comiteFilter, impactoFilter, clientFilter, healthFilter, ufFilter]);

  const handleClearFilters = () => {
    setStatusFilter('all');
    setComiteFilter('all');
    setImpactoFilter('all');
    setClientFilter('all');
    setHealthFilter('all');
    setUfFilter(null);
  };

  const handleDeleteClick = async (projectId: string) => {
    if (confirm(t('confirmDeleteDescription'))) {
      try {
        await deleteProject(projectId);
        setProjects(getProjects());
        toast({ title: t('projectDeleted'), description: t('projectDeletedDescription') });
      } catch (error) {
        toast({
          title: t('deleteError'),
          description: error instanceof Error ? error.message : t('deleteErrorDescription'),
          variant: 'destructive',
        });
      }
    }
  };

  const exportToCSV = () => {
    const headers = ['Código', 'Nome', 'Cliente', 'Status', 'Valor Total', 'Progresso', 'Comitê'];
    const rows = filteredProjects.map((p) => [
      p.codigo,
      p.nome,
      p.cliente,
      p.status,
      p.valor_total,
      `${p.progresso_percentual}%`,
      p.comite_nome || 'Sem supervisão',
    ]);
    const csv = [headers, ...rows].map((row) => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `projetos-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  // Table columns
  const tableColumns: HudTableColumn<Project>[] = useMemo(() => [
    {
      key: 'codigo',
      header: t('code'),
      width: '100px',
      cell: (project) => (
        <HudBadge variant="outline" size="sm">{project.codigo || '—'}</HudBadge>
      ),
    },
    {
      key: 'nome',
      header: t('project'),
      cell: (project) => (
        <div>
          <p className="font-medium hud-text">{project.nome}</p>
          <p className="text-xs hud-text-muted">{project.cliente}</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: tCommon('status'),
      width: '120px',
      cell: (project) => {
        const variantMap: Record<string, any> = {
          em_andamento: 'active',
          concluido: 'completed',
          pausado: 'warning',
          cancelado: 'error',
          planejamento: 'neutral',
        };
        return (
          <HudStatusPill variant={variantMap[project.status] || 'neutral'} size="sm">
            {project.status.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
          </HudStatusPill>
        );
      },
    },
    {
      key: 'health',
      header: tCommon('health'),
      width: '80px',
      cell: (project) => {
        const v2 = v2Map.get(project.id);
        const health = v2?.health_score ?? 100;
        const color = getHealthScoreColor(health);
        return (
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full" style={{ background: color }} />
            <span className="text-sm font-medium" style={{ color }}>{health}</span>
          </div>
        );
      },
    },
    {
      key: 'progress',
      header: tCommon('progress'),
      width: '120px',
      cell: (project) => (
        <HudProgressBar value={project.progresso_percentual || 0} size="sm" showLabel />
      ),
    },
    {
      key: 'valor',
      header: tCommon('value'),
      width: '120px',
      align: 'right',
      cell: (project) => (
        <div className="text-right">
          <p className="font-medium hud-text">{formatMoney(project.valor_total)}</p>
        </div>
      ),
    },
    {
      key: 'acoes',
      header: tCommon('actions'),
      width: '100px',
      align: 'right',
      cell: (project) => (
        <div className="flex items-center justify-end gap-2">
          <HudButton
            variant="ghost"
            size="sm"
            leftIcon={<Eye className="w-4 h-4" />}
            onClick={() => { setSelectedProject(project); setProjectDrawerOpen(true); }}
          >
            {tCommon('view')}
          </HudButton>
          <HudButton
            variant="ghost"
            size="sm"
            leftIcon={<Trash2 className="w-4 h-4" />}
            onClick={() => handleDeleteClick(project.id)}
          >
            {tCommon('delete')}
          </HudButton>
        </div>
      ),
    },
  ], [t, tCommon, v2Map]);

  return (
    <HudPageLayout>
      {/* Header */}
      <HudHeader
        title={t('title')}
        subtitle={t('subtitle')}
        icon={<FolderKanban className="w-5 h-5" />}
        iconTint="#10B981"
        breadcrumbs={[{ label: t('title') }]}
        actions={
          <div className="flex items-center gap-2">
            <HudButton
              variant="secondary"
              size="md"
              leftIcon={<Download className="w-4 h-4" />}
              onClick={exportToCSV}
            >
              {tCommon('export')}
            </HudButton>
            <Link href="/projetos/novo">
              <HudButton
                variant="primary"
                size="md"
                leftIcon={<Plus className="w-4 h-4" />}
              >
                {t('newProject')}
              </HudButton>
            </Link>
          </div>
        }
      />

      {/* KPI Strip */}
      <HudKpiStrip kpis={kpiItems} columns={4} className="mb-6" />

      {/* Filters */}
      <HudFilterBar
        searchPlaceholder={t('searchPlaceholder')}
        searchValue={searchTerm}
        onSearchChange={setSearchTerm}
        filterGroups={filterGroups}
        activeFiltersCount={activeFiltersCount}
        onClearFilters={handleClearFilters}
        rightContent={
          <div className="flex items-center gap-2">
            {/* View toggle */}
            <div className="flex items-center rounded-lg hud-surface border hud-divider p-1">
              <button
                onClick={() => setViewMode('cards')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors view-toggle-btn ${
                  viewMode === 'cards'
                    ? 'view-toggle-active'
                    : 'view-toggle-inactive'
                }`}
              >
                <LayoutGrid className="w-4 h-4" />
                {tCommon('cards')}
              </button>
              <button
                onClick={() => setViewMode('table')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors view-toggle-btn ${
                  viewMode === 'table'
                    ? 'view-toggle-active'
                    : 'view-toggle-inactive'
                }`}
              >
                <Table2 className="w-4 h-4" />
                {tCommon('table')}
              </button>
            </div>
          </div>
        }
        className="mb-6"
      />

      {/* Content */}
      {viewMode === 'cards' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredProjects.map((project, index) => {
            const v2 = v2Map.get(project.id);
            const health = v2?.health_score ?? 100;
            const healthColor = getHealthScoreColor(health);

            return (
              <HudPanel
                key={project.id}
                title={project.codigo || '—'}
                subtitle={project.nome}
                accentColor={project.status === 'em_andamento' ? 'emerald' : project.status === 'concluido' ? 'cyan' : 'amber'}
                delay={index * 0.05}
                headerActions={
                  <HudStatusPill
                    variant={
                      project.status === 'em_andamento'
                        ? 'active'
                        : project.status === 'concluido'
                        ? 'completed'
                        : project.status === 'cancelado'
                        ? 'error'
                        : 'neutral'
                    }
                    size="sm"
                  >
                    {project.status.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
                  </HudStatusPill>
                }
              >
                <div className="space-y-4">
                  {/* Client */}
                  <div>
                    <p className="text-xs hud-text-muted uppercase tracking-wider mb-1">{tCommon('client')}</p>
                    <p className="text-sm hud-text-secondary">{project.cliente || '—'}</p>
                  </div>

                  {/* Health & Progress */}
                  <div className="flex items-center gap-4">
                    <div>
                      <p className="text-xs hud-text-muted uppercase tracking-wider mb-1">{tCommon('health')}</p>
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full" style={{ background: healthColor }} />
                        <span className="text-sm font-medium" style={{ color: healthColor }}>{health}</span>
                      </div>
                    </div>
                    <div className="flex-1">
                      <p className="text-xs hud-text-muted uppercase tracking-wider mb-1">{tCommon('progress')}</p>
                      <HudProgressBar value={project.progresso_percentual || 0} size="sm" />
                    </div>
                  </div>

                  {/* Value */}
                  <div className="flex items-center justify-between pt-3 border-t hud-divider">
                    <div>
                      <p className="text-xs hud-text-muted uppercase tracking-wider">{t('totalValue')}</p>
                      <p className="text-lg font-semibold hud-text">{formatMoney(project.valor_total)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <HudButton
                        variant="ghost"
                        size="sm"
                        leftIcon={<Eye className="w-4 h-4" />}
                        onClick={() => { setSelectedProject(project); setProjectDrawerOpen(true); }}
                      >
                        {tCommon('view')}
                      </HudButton>
                    </div>
                  </div>
                </div>
              </HudPanel>
            );
          })}
        </div>
      ) : (
        <HudPanel noPadding>
          <HudTable
            columns={tableColumns}
            data={filteredProjects}
            keyExtractor={(p) => p.id}
            onRowClick={(p) => { setSelectedProject(p); setProjectDrawerOpen(true); }}
            selectedRowId={highlightedProjectId || undefined}
            emptyState={
              <HudEmptyState
                icon="search"
                title={t('noProjectFound')}
                description="Tente ajustar os filtros ou buscar por outro termo."
                action={{
                  label: t('clearFilters'),
                  onClick: handleClearFilters,
                  variant: 'primary',
                }}
              />
            }
          />
        </HudPanel>
      )}

      {/* Empty state when no results */}
      {filteredProjects.length === 0 && (
        <HudEmptyState
          icon="search"
          title={t('noProjectFound')}
          description="Tente ajustar os filtros ou buscar por outro termo."
          action={{
            label: t('clearFilters'),
            onClick: handleClearFilters,
            variant: 'primary',
          }}
        />
      )}

      {/* Project Detail Drawer */}
      <ProjectDetailDrawer
        project={selectedProject}
        open={projectDrawerOpen}
        onOpenChange={setProjectDrawerOpen}
      />
    </HudPageLayout>
  );
}

function PortfolioProjetosFallback() {
  const t = useTranslations('projects');
  return (
    <HudPageLayout>
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <Briefcase className="w-12 h-12 hud-text-muted mx-auto mb-3 animate-pulse" />
          <p className="text-sm hud-text-muted">{t('loadingPortfolio')}</p>
        </div>
      </div>
    </HudPageLayout>
  );
}

export default function PortfolioProjetos() {
  return (
    <Suspense fallback={<PortfolioProjetosFallback />}>
      <PortfolioProjetosInner />
    </Suspense>
  );
}
