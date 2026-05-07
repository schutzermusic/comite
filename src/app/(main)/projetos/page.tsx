'use client';

import React, { useState, useEffect, useMemo, useCallback, Suspense } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Briefcase } from 'lucide-react';
import { useHudToast } from '@/hooks/useHudToast';
import { getProjects, getProjectsV2, deleteProject } from '@/lib/services/projects';
import type { Project } from '@/lib/types';
import type { ProjectV2 } from '@/lib/types/project-v2';

import { HudPageLayout, HudEmptyState } from '@/components/hud';
import {
  ProjectHeader,
  ProjectKpiGrid,
  ProjectFilterBar,
  ProjectCard,
  ProjectTable,
  ProjectDetailDrawer,
  openProjectPortfolioReport,
  type ProjectKpiSummary,
  type ProjectFilterGroup,
} from '@/components/portfolio';

function PortfolioProjetosInner() {
  const searchParams = useSearchParams();
  const { toast } = useHudToast();
  const t = useTranslations('projects');
  const tCommon = useTranslations('common');

  const stateParam = searchParams.get('state');
  const ufParam = searchParams.get('uf');
  const projectIdParam = searchParams.get('projectId');
  const contractIdParam = searchParams.get('contractId');

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [comiteFilter, setComiteFilter] = useState('all');
  const [impactoFilter, setImpactoFilter] = useState('all');
  const [clientFilter, setClientFilter] = useState('all');
  const [healthFilter, setHealthFilter] = useState('all');
  const [ufFilter, setUfFilter] = useState<string | null>(null);
  const [highlightedProjectId, setHighlightedProjectId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsV2, setProjectsV2] = useState<ProjectV2[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [projectDrawerOpen, setProjectDrawerOpen] = useState(false);

  useEffect(() => {
    setProjects(getProjects());
    try {
      setProjectsV2(getProjectsV2());
    } catch {
      /* v2 not available */
    }
  }, []);

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
    }
    if (contractIdParam) {
      setHighlightedProjectId(contractIdParam);
    }
  }, [contractIdParam, projectIdParam, stateParam, toast, t, ufParam]);

  useEffect(() => {
    if (!highlightedProjectId || projects.length === 0) return;
    const target = projects.find((p) => p.id === highlightedProjectId);
    if (target) {
      setSelectedProject(target);
      setProjectDrawerOpen(true);
    }
  }, [highlightedProjectId, projects]);

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

  const comites = useMemo(
    () =>
      projects
        .map((p) => ({ id: p.comite_id, nome: p.comite_nome }))
        .filter((v, i, a) => a.findIndex((x) => x.id === v.id) === i)
        .filter((c) => c.id && c.nome) as { id: string; nome: string }[],
    [projects],
  );

  const uniqueClients = useMemo(
    () => [...new Set(projects.map((p) => p.cliente).filter(Boolean))] as string[],
    [projects],
  );

  const v2Map = useMemo(() => {
    const m = new Map<string, ProjectV2>();
    projectsV2.forEach((p) => m.set(p.id, p));
    return m;
  }, [projectsV2]);

  const filteredProjects = useMemo(() => {
    return projects.filter((projeto) => {
      const term = searchTerm.toLowerCase();
      const searchMatch =
        !term ||
        projeto.nome?.toLowerCase().includes(term) ||
        projeto.codigo?.toLowerCase().includes(term) ||
        projeto.cliente?.toLowerCase().includes(term);

      const statusMatch = statusFilter === 'all' || projeto.status === statusFilter;
      const comiteMatch =
        comiteFilter === 'all' ||
        (comiteFilter === 'sem_comite' && !projeto.comite_id) ||
        projeto.comite_id === comiteFilter;
      const impactoMatch = impactoFilter === 'all' || projeto.impacto_financeiro === impactoFilter;
      const clientMatch = clientFilter === 'all' || projeto.cliente === clientFilter;

      let healthMatch = true;
      if (healthFilter !== 'all') {
        const score = v2Map.get(projeto.id)?.health_score ?? 100;
        if (healthFilter === 'critical') healthMatch = score < 40;
        else if (healthFilter === 'attention') healthMatch = score >= 40 && score < 60;
        else if (healthFilter === 'good') healthMatch = score >= 60 && score < 80;
        else if (healthFilter === 'excellent') healthMatch = score >= 80;
      }

      const stateMatch = !ufFilter || v2Map.get(projeto.id)?.uf === ufFilter;

      return searchMatch && statusMatch && comiteMatch && impactoMatch && clientMatch && healthMatch && stateMatch;
    });
  }, [projects, searchTerm, statusFilter, comiteFilter, impactoFilter, clientFilter, healthFilter, ufFilter, v2Map]);

  const kpiSummary: ProjectKpiSummary = useMemo(() => {
    const list = filteredProjects;
    const total = list.length;
    const inProgress = list.filter((p) => p.status === 'em_andamento').length;
    const completed = list.filter((p) => p.status === 'concluido').length;
    const totalValue = list.reduce((s, p) => s + (p.valor_total || 0), 0);
    const critical = list.filter(
      (p) => p.impacto_financeiro === 'alto' || p.impacto_financeiro === 'critico',
    ).length;

    const v2s = list.map((p) => v2Map.get(p.id)).filter(Boolean) as ProjectV2[];
    const avgHealth = v2s.length
      ? Math.round(v2s.reduce((s, p) => s + (p.health_score || 0), 0) / v2s.length)
      : 100;
    const avgProgress = total
      ? Math.round(list.reduce((s, p) => s + (p.progresso_percentual || 0), 0) / total)
      : 0;

    const now = new Date().toISOString();
    const openRisks = v2s.reduce(
      (s, p) =>
        s +
        (p.risks || []).filter(
          (r) => r.status !== 'resolved' && (r.severity === 'high' || r.severity === 'critical'),
        ).length,
      0,
    );
    const delayed = v2s.reduce(
      (s, p) =>
        s + (p.tasks || []).filter((tk) => tk.status !== 'completed' && tk.endDate < now).length,
      0,
    );

    return { total, inProgress, completed, delayed, critical, totalValue, avgHealth, avgProgress, openRisks };
  }, [filteredProjects, v2Map]);

  const filterGroups: ProjectFilterGroup[] = useMemo(
    () => [
      {
        id: 'status',
        label: tCommon('status'),
        value: statusFilter,
        onChange: setStatusFilter,
        options: [
          { value: 'all', label: t('allStatus') },
          { value: 'planejamento', label: t('planning') },
          { value: 'em_andamento', label: t('inProgress') },
          { value: 'pausado', label: t('paused') },
          { value: 'concluido', label: t('completed') },
          { value: 'cancelado', label: t('cancelled') },
        ],
      },
      {
        id: 'comite',
        label: tCommon('committee'),
        value: comiteFilter,
        onChange: setComiteFilter,
        options: [
          { value: 'all', label: t('allCommittees') },
          ...comites.map((c) => ({ value: c.id, label: c.nome })),
          { value: 'sem_comite', label: t('noSupervision') },
        ],
      },
      {
        id: 'impact',
        label: tCommon('impact'),
        value: impactoFilter,
        onChange: setImpactoFilter,
        options: [
          { value: 'all', label: t('allImpacts') },
          { value: 'baixo', label: t('low') },
          { value: 'medio', label: t('medium') },
          { value: 'alto', label: t('high') },
          { value: 'critico', label: t('critical') },
        ],
      },
      {
        id: 'client',
        label: tCommon('client'),
        value: clientFilter,
        onChange: setClientFilter,
        options: [
          { value: 'all', label: t('allClients') },
          ...uniqueClients.map((c) => ({ value: c, label: c })),
        ],
      },
      {
        id: 'health',
        label: tCommon('health'),
        value: healthFilter,
        onChange: setHealthFilter,
        options: [
          { value: 'all', label: t('allHealth') },
          { value: 'excellent', label: t('healthExcellent') },
          { value: 'good', label: t('healthGood') },
          { value: 'attention', label: t('healthAttention') },
          { value: 'critical', label: t('healthCritical') },
        ],
      },
    ],
    [statusFilter, comiteFilter, impactoFilter, clientFilter, healthFilter, comites, uniqueClients, t, tCommon],
  );

  const handleClearFilters = () => {
    setSearchTerm('');
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

  const exportToPdf = (mode: 'executive' | 'full') => {
    const result = openProjectPortfolioReport({
      projects: filteredProjects,
      v2Map,
      mode,
      filters: {
        search: searchTerm || undefined,
        status: statusFilter,
        client: clientFilter,
        health: healthFilter,
        impact: impactoFilter,
        committee:
          comiteFilter === 'all'
            ? undefined
            : comites.find((c) => c.id === comiteFilter)?.nome || comiteFilter,
      },
    });
    if (result.ok) {
      toast({
        title: 'Relatório gerado',
        description:
          mode === 'executive'
            ? 'Sumário executivo aberto em nova aba — use Imprimir / Salvar PDF.'
            : 'Portfólio completo aberto em nova aba — use Imprimir / Salvar PDF.',
      });
    } else {
      toast({
        title: 'Não foi possível exportar',
        description: result.message,
        variant: 'destructive',
      });
    }
  };

  const handleOpenProject = (p: Project) => {
    setSelectedProject(p);
    setProjectDrawerOpen(true);
  };

  return (
    <HudPageLayout>
      <ProjectHeader
        title={t('title')}
        subtitle={t('subtitle')}
        count={filteredProjects.length}
        onExportCsv={exportToCSV}
        onExportPdf={exportToPdf}
      />

      <ProjectKpiGrid summary={kpiSummary} className="mb-5" />

      <ProjectFilterBar
        searchValue={searchTerm}
        onSearchChange={setSearchTerm}
        searchPlaceholder={t('searchPlaceholder')}
        groups={filterGroups}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onClearFilters={handleClearFilters}
        className="mb-5"
      />

      {filteredProjects.length === 0 ? (
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
      ) : viewMode === 'cards' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredProjects.map((p, i) => (
            <ProjectCard
              key={p.id}
              project={p}
              v2={v2Map.get(p.id)}
              onView={handleOpenProject}
              delay={Math.min(i * 0.04, 0.4)}
            />
          ))}
        </div>
      ) : (
        <ProjectTable
          projects={filteredProjects}
          v2Map={v2Map}
          onView={handleOpenProject}
          onDelete={handleDeleteClick}
          highlightedId={highlightedProjectId}
        />
      )}

      <ProjectDetailDrawer
        project={selectedProject}
        open={projectDrawerOpen}
        onOpenChange={setProjectDrawerOpen}
        onLogoUpload={(projectId, url) => {
          setProjects((prev) =>
            prev.map((p) =>
              p.id === projectId ? { ...p, clientLogoUrl: url ?? undefined } : p,
            ),
          );
          setSelectedProject((prev) =>
            prev?.id === projectId ? { ...prev, clientLogoUrl: url ?? undefined } : prev,
          );
        }}
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
