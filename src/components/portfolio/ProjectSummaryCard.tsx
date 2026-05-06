'use client';

/**
 * ProjectSummaryCard
 *
 * A compact, reusable project summary tile. Designed to be consumed by:
 *   - the 3D Operations map side panel (`/projetos/operations-3d`)
 *   - dashboard widgets that need a quick "snapshot" of a project
 *   - any context outside the main /projetos route
 *
 * Reuses the same primitives as ProjectCard (logo, health, progress, status pill)
 * so visuals stay consistent across the product.
 */

import Link from 'next/link';
import { ArrowUpRight, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Project } from '@/lib/types';
import type { ProjectV2 } from '@/lib/types/project-v2';
import { compactBRL } from '@/lib/utils/project-utils';
import { HudStatusPill, HudProgressBar } from '@/components/hud';
import { ProjectClientLogo } from './ProjectClientLogo';
import { ProjectHealthIndicator } from './ProjectHealthIndicator';

const STATUS_VARIANT: Record<string, 'active' | 'completed' | 'warning' | 'error' | 'neutral'> = {
  em_andamento: 'active',
  concluido: 'completed',
  pausado: 'warning',
  cancelado: 'error',
  planejamento: 'neutral',
};

function formatStatus(status: string) {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
}

interface ProjectSummaryCardProps {
  project: Project;
  v2?: ProjectV2;
  /** When provided, the whole card becomes a link to this href. */
  href?: string;
  /** Override click handler (mutually exclusive with href). */
  onClick?: (project: Project) => void;
  /** Compact mode for tight side-panels (e.g. 3D map drawer). */
  density?: 'comfortable' | 'compact';
  className?: string;
}

export function ProjectSummaryCard({
  project,
  v2,
  href,
  onClick,
  density = 'comfortable',
  className,
}: ProjectSummaryCardProps) {
  const health = v2?.health_score ?? 100;
  const progress = Math.max(0, Math.min(100, project.progresso_percentual || 0));
  const openHighRisks = (v2?.risks || []).filter(
    (r) => r.status !== 'resolved' && (r.severity === 'high' || r.severity === 'critical'),
  ).length;
  const isCompact = density === 'compact';

  const inner = (
    <div
      className={cn(
        'group relative w-full text-left rounded-xl border hud-surface overflow-hidden',
        'transition-all duration-200 hover:-translate-y-0.5',
        isCompact ? 'p-3 space-y-2.5' : 'p-4 space-y-3',
        className,
      )}
    >
      <div className="flex items-start gap-2.5">
        <ProjectClientLogo
          client={project.cliente}
          logoUrl={project.clientLogoUrl}
          size={isCompact ? 'sm' : 'md'}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] font-semibold tabular-nums tracking-wide hud-text-muted">
              {project.codigo || '—'}
            </span>
            <HudStatusPill variant={STATUS_VARIANT[project.status] ?? 'neutral'} size="sm">
              {formatStatus(project.status)}
            </HudStatusPill>
          </div>
          <h4
            className={cn(
              'font-semibold hud-text leading-snug line-clamp-2',
              isCompact ? 'text-xs mt-1' : 'text-sm mt-1',
            )}
          >
            {project.nome}
          </h4>
          <p className="text-[11px] hud-text-muted truncate">{project.cliente || '—'}</p>
        </div>
        <ProjectHealthIndicator score={health} variant="ring" size="sm" />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] uppercase tracking-wider hud-text-muted">Progresso</span>
          <span className="text-[11px] font-semibold hud-text tabular-nums">{progress}%</span>
        </div>
        <HudProgressBar value={progress} size="sm" />
      </div>

      <div className="flex items-center justify-between text-[11px]">
        <span className="hud-text font-semibold tabular-nums">
          {compactBRL(project.valor_total || 0)}
        </span>
        {openHighRisks > 0 ? (
          <span className="inline-flex items-center gap-1 text-red-400 font-semibold">
            <ShieldAlert className="w-3 h-3" />
            {openHighRisks}
          </span>
        ) : (
          <span className="hud-text-muted">Sem riscos altos</span>
        )}
        {(href || onClick) && (
          <ArrowUpRight className="w-3.5 h-3.5 hud-text-muted group-hover:hud-text transition-colors" />
        )}
      </div>
    </div>
  );

  if (href) {
    return (
      <Link href={href} aria-label={`Abrir ${project.nome}`}>
        {inner}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button
        type="button"
        onClick={() => onClick(project)}
        className="w-full"
        aria-label={`Abrir ${project.nome}`}
      >
        {inner}
      </button>
    );
  }
  return inner;
}

export default ProjectSummaryCard;
