'use client';

import { useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/ui/status-pill';
import { HUDProgressBar } from '@/components/ui/hud-progress-bar';
import {
  Building2,
  Calendar,
  DollarSign,
  FileText,
  ExternalLink,
  Clock,
  TrendingUp,
  AlertTriangle,
  GanttChart,
  Heart,
  Activity,
  ChevronRight,
} from 'lucide-react';
import { Project } from '@/lib/types';
import type { ProjectV2 } from '@/lib/types/project-v2';
import { getProjectV2ById } from '@/lib/services/projects';
import { generateProjectAlerts, getHealthScoreColor, getHealthScoreLabel, getSeverityColor } from '@/lib/utils/project-utils';
import { cn } from '@/lib/utils';

interface ProjectDetailDrawerProps {
  project: Project | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * ProjectDetailDrawer
 * 
 * Right-side drawer showing full project details.
 * Enhanced with: last activity, top 3 alerts, health score, quick links.
 */
export function ProjectDetailDrawer({
  project,
  open,
  onOpenChange,
}: ProjectDetailDrawerProps) {
  const handleEscape = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape' && open) {
      onOpenChange(false);
    }
  }, [open, onOpenChange]);

  useEffect(() => {
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [handleEscape]);

  // Load v2 data for enhanced features
  const v2 = useMemo(() => {
    if (!project) return undefined;
    try {
      return getProjectV2ById(project.id);
    } catch {
      return undefined;
    }
  }, [project]);

  const alerts = useMemo(() => {
    if (!v2) return [];
    return generateProjectAlerts(v2).slice(0, 3);
  }, [v2]);

  if (!project) return null;

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value || 0);
  };

  const valorRestante = (project.valor_total || 0) - (project.valor_executado || 0);

  const getStatusVariant = (status: string) => {
    switch (status) {
      case 'em_andamento': return 'active';
      case 'concluido': return 'completed';
      case 'cancelado': return 'error';
      case 'pausado': return 'at_risk';
      default: return 'neutral';
    }
  };

  const getImpactoVariant = (impacto: string) => {
    switch (impacto) {
      case 'critico': return 'critical';
      case 'alto': return 'at_risk';
      case 'medio': return 'active';
      default: return 'neutral';
    }
  };

  const formatStatus = (status: string) => {
    return status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  const healthScore = v2?.health_score ?? 100;
  const healthColor = getHealthScoreColor(healthScore);

  const lastActivity = v2?.last_activity_at
    ? new Date(v2.last_activity_at).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
    : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className={cn(
          'w-[400px] sm:w-[450px] sm:max-w-[450px]',
          'bg-gradient-to-br from-[#07130F] to-[#030B09]',
          'border-l border-white/[0.08]',
          'overflow-y-auto'
        )}
      >
        {/* Header */}
        <SheetHeader className="pb-4 border-b border-white/[0.06]">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <Badge
                  variant="outline"
                  className="text-xs bg-white/[0.05] text-white/70 border-white/[0.12] shrink-0"
                >
                  {project.codigo}
                </Badge>
                {project.sankhya_integrado && (
                  <StatusPill variant="info" className="text-[10px]">Sankhya</StatusPill>
                )}
                {/* Health Score */}
                <div
                  className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0"
                  style={{
                    background: `${healthColor}15`,
                    color: healthColor,
                    border: `1px solid ${healthColor}30`,
                  }}
                >
                  <Heart className="w-3 h-3" />
                  {healthScore}
                </div>
              </div>
              <SheetTitle className="text-lg font-semibold text-white leading-tight">
                {project.nome}
              </SheetTitle>
              <SheetDescription className="text-sm text-white/50 mt-1">
                {project.cliente || 'Cliente não informado'}
              </SheetDescription>
            </div>
          </div>

          {/* Status + Impact badges */}
          <div className="flex items-center gap-2 mt-3">
            <StatusPill variant={getStatusVariant(project.status)}>
              {formatStatus(project.status)}
            </StatusPill>
            <StatusPill variant={getImpactoVariant(project.impacto_financeiro)}>
              {project.impacto_financeiro.charAt(0).toUpperCase() + project.impacto_financeiro.slice(1)}
            </StatusPill>
          </div>

          {/* Last Activity */}
          {lastActivity && (
            <div className="flex items-center gap-1.5 mt-2 text-[10px] text-white/40">
              <Activity className="w-3 h-3" />
              Última atividade: {lastActivity}
            </div>
          )}
        </SheetHeader>

        {/* Content Sections */}
        <div className="py-5 space-y-6">

          {/* ── Top 3 Alerts ────────────────────────────────── */}
          {alerts.length > 0 && (
            <section>
              <h3 className="text-[11px] font-medium uppercase tracking-wider text-white/40 mb-3 flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5" />
                Alertas ({alerts.length})
              </h3>
              <div className="space-y-2">
                {alerts.map((alert) => (
                  <div
                    key={alert.id}
                    className="flex items-center gap-2 p-2 rounded-lg bg-white/[0.02] border border-white/[0.04]"
                  >
                    <div
                      className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{ background: getSeverityColor(alert.severity) }}
                    />
                    <span className="text-xs text-white/70 flex-1 truncate">{alert.message}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Overview Section */}
          <section>
            <h3 className="text-[11px] font-medium uppercase tracking-wider text-white/40 mb-3 flex items-center gap-2">
              <Building2 className="w-3.5 h-3.5" />
              Visão Geral
            </h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-xs text-white/50">Cliente</span>
                <span className="text-sm text-white/90">{project.cliente || '—'}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-white/50">Comitê Supervisor</span>
                <span className="text-sm text-white/90">{project.comite_nome || 'Sem supervisão'}</span>
              </div>
              {project.comite_status && project.comite_nome && (
                <div className="flex justify-between items-center">
                  <span className="text-xs text-white/50">Status Comitê</span>
                  <StatusPill
                    variant={project.comite_status === 'ativo' ? 'active' : project.comite_status === 'atencao_necessaria' ? 'at_risk' : 'neutral'}
                    className="text-[10px]"
                  >
                    {formatStatus(project.comite_status)}
                  </StatusPill>
                </div>
              )}
              <div className="flex justify-between items-center">
                <span className="text-xs text-white/50">Risco Geral</span>
                <span className="text-sm text-white/90 capitalize">{project.risco_geral || '—'}</span>
              </div>
              {project.descricao && (
                <div className="pt-2">
                  <span className="text-xs text-white/50 block mb-1">Descrição</span>
                  <p className="text-sm text-white/70 leading-relaxed">{project.descricao}</p>
                </div>
              )}
            </div>
          </section>

          {/* Timeline Section */}
          <section>
            <h3 className="text-[11px] font-medium uppercase tracking-wider text-white/40 mb-3 flex items-center gap-2">
              <Calendar className="w-3.5 h-3.5" />
              Timeline
            </h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-xs text-white/50">Data de Início</span>
                <span className="text-sm text-white/90 tabular-nums">
                  {project.data_inicio
                    ? new Date(project.data_inicio).toLocaleDateString('pt-BR')
                    : '—'
                  }
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-white/50">Data de Criação</span>
                <span className="text-sm text-white/90 tabular-nums">
                  {project.created_date
                    ? new Date(project.created_date).toLocaleDateString('pt-BR')
                    : '—'
                  }
                </span>
              </div>

              {/* Progress */}
              <div className="pt-2">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs text-white/50">Progresso</span>
                  <span className="text-sm font-medium text-white tabular-nums">
                    {project.progresso_percentual || 0}%
                  </span>
                </div>
                <HUDProgressBar
                  value={project.progresso_percentual || 0}
                  variant={
                    project.progresso_percentual >= 80 ? 'completed' :
                      project.progresso_percentual >= 50 ? 'active' :
                        project.progresso_percentual >= 25 ? 'medium' : 'critical'
                  }
                />
              </div>
            </div>
          </section>

          {/* Financials Section */}
          <section>
            <h3 className="text-[11px] font-medium uppercase tracking-wider text-white/40 mb-3 flex items-center gap-2">
              <DollarSign className="w-3.5 h-3.5" />
              Financeiro
            </h3>
            <div className="grid grid-cols-1 gap-3">
              <div className="p-3 rounded-lg bg-white/[0.03] border border-white/[0.05]">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-white/50">Valor Total</span>
                  <TrendingUp className="w-3.5 h-3.5 text-cyan-400/60" />
                </div>
                <p className="text-lg font-semibold text-white mt-1 tabular-nums">
                  {formatCurrency(project.valor_total)}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-white/[0.03] border border-white/[0.05]">
                  <span className="text-[10px] text-white/50 block mb-1">Executado</span>
                  <p className="text-sm font-semibold text-emerald-400 tabular-nums">
                    {formatCurrency(project.valor_executado)}
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-white/[0.03] border border-white/[0.05]">
                  <span className="text-[10px] text-white/50 block mb-1">Restante</span>
                  <p className="text-sm font-semibold text-amber-400 tabular-nums">
                    {formatCurrency(valorRestante)}
                  </p>
                </div>
              </div>

              {project.roi_estimado && (
                <div className="flex justify-between items-center pt-1">
                  <span className="text-xs text-white/50">ROI Estimado</span>
                  <span className="text-sm font-medium text-cyan-400 tabular-nums">
                    {project.roi_estimado}%
                  </span>
                </div>
              )}
            </div>
          </section>

          {/* Docs Section */}
          <section>
            <h3 className="text-[11px] font-medium uppercase tracking-wider text-white/40 mb-3 flex items-center gap-2">
              <FileText className="w-3.5 h-3.5" />
              Documentos
            </h3>
            {v2?.documents && v2.documents.length > 0 ? (
              <div className="space-y-2">
                {v2.documents.slice(0, 4).map(doc => (
                  <div key={doc.id} className="flex items-center gap-2 p-2 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                    <FileText className="w-3.5 h-3.5 text-white/30 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="text-xs text-white/70 truncate block">{doc.name}</span>
                      <span className="text-[10px] text-white/30">v{doc.version} · {doc.category}</span>
                    </div>
                    {doc.url ? (
                      <div className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" title="Uploaded" />
                    ) : (
                      <div className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" title="Pendente" />
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-4 rounded-lg bg-white/[0.02] border border-white/[0.04] text-center">
                <FileText className="w-8 h-8 text-white/20 mx-auto mb-2" />
                <p className="text-xs text-white/40">Nenhum documento anexado</p>
              </div>
            )}
          </section>
        </div>

        {/* Footer with Quick Link CTAs */}
        <div className="pt-4 border-t border-white/[0.06] space-y-2">
          <Link href={`/projetos/${project.id}`}>
            <Button
              variant="outline"
              className="w-full border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10 hover:border-cyan-500/50"
            >
              <ExternalLink className="w-4 h-4 mr-2" />
              Abrir Página Completa
            </Button>
          </Link>
          <div className="grid grid-cols-3 gap-2">
            <Link href={`/projetos/${project.id}?tab=timeline`}>
              <Button variant="ghost" size="sm" className="w-full text-[10px] text-white/50 hover:text-white hover:bg-white/5 h-8">
                <GanttChart className="w-3 h-3 mr-1" />
                Timeline
              </Button>
            </Link>
            <Link href={`/projetos/${project.id}?tab=finance`}>
              <Button variant="ghost" size="sm" className="w-full text-[10px] text-white/50 hover:text-white hover:bg-white/5 h-8">
                <DollarSign className="w-3 h-3 mr-1" />
                Financeiro
              </Button>
            </Link>
            <Link href={`/projetos/${project.id}/analytics`}>
              <Button variant="ghost" size="sm" className="w-full text-[10px] text-white/50 hover:text-white hover:bg-white/5 h-8">
                <Activity className="w-3 h-3 mr-1" />
                Analytics
              </Button>
            </Link>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default ProjectDetailDrawer;
