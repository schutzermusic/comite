'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { Eye, ShieldAlert, ArrowUpRight, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Project } from '@/lib/types';
import type { ProjectV2 } from '@/lib/types/project-v2';
import { compactBRL } from '@/lib/utils/project-utils';
import { useState } from 'react';
import { HudStatusPill } from '@/components/hud';
import { ProjectHealthIndicator } from './ProjectHealthIndicator';
import { getClientLogoUrl } from '@/lib/utils/client-logos';

interface ProjectCardProps {
  project: Project;
  v2?: ProjectV2;
  onView: (p: Project) => void;
  delay?: number;
}

const STATUS_VARIANT: Record<string, 'active' | 'completed' | 'warning' | 'error' | 'neutral'> = {
  em_andamento: 'active',
  concluido: 'completed',
  pausado: 'warning',
  cancelado: 'error',
  planejamento: 'neutral',
};

const ACCENT: Record<string, string> = {
  em_andamento: '#10B981',
  concluido: '#22D3EE',
  pausado: '#F59E0B',
  cancelado: '#EF4444',
  planejamento: '#94A3B8',
};

const IMPACT_LABEL: Record<string, { label: string; color: string }> = {
  baixo: { label: 'Baixo', color: '#94A3B8' },
  medio: { label: 'Médio', color: '#22D3EE' },
  alto: { label: 'Alto', color: '#F59E0B' },
  critico: { label: 'Crítico', color: '#EF4444' },
};

function formatStatus(status: string) {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
}

export function ProjectCard({ project, v2, onView, delay = 0 }: ProjectCardProps) {
  const reduce = useReducedMotion();
  const accent = ACCENT[project.status] ?? '#94A3B8';
  const impact = IMPACT_LABEL[project.impacto_financeiro] ?? IMPACT_LABEL.baixo;
  const health = v2?.health_score ?? 100;
  const progress = Math.max(0, Math.min(100, project.progresso_percentual || 0));

  const openHighRisks = (v2?.risks || []).filter(
    (r) => r.status !== 'resolved' && (r.severity === 'high' || r.severity === 'critical'),
  ).length;

  const overdueTasks = v2
    ? (v2.tasks || []).filter(
        (t) => t.status !== 'completed' && t.endDate < new Date().toISOString(),
      ).length
    : 0;

  return (
    <motion.button
      type="button"
      onClick={() => onView(project)}
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        'group relative text-left w-full overflow-hidden',
        'glass-tile glass-tile-sheen glass-tile-depth glass-tile-interactive',
        'p-5 flex flex-col gap-4',
        'min-h-[280px]',
      )}
      style={
        {
          ['--rail-color' as string]: accent,
          ['--halo-color' as string]: `${accent}26`,
        } as React.CSSProperties
      }
    >
      {/* Vertical accent rail */}
      <span className="glass-tile-rail" />

      {/* Hover halo */}
      <span
        className="glass-tile-halo opacity-0 group-hover:opacity-100 transition-opacity duration-300"
      />

      {/* Transparent client logo watermark (only when logo exists) */}
      <ClientLogoWatermark client={project.cliente} logoUrl={project.clientLogoUrl} />

      {/* ── Title + status ────────────────────────────── */}
      <div className="relative flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <HudStatusPill variant={STATUS_VARIANT[project.status] ?? 'neutral'} size="sm">
            {formatStatus(project.status)}
          </HudStatusPill>
          <h3 className="mt-2 text-[15px] font-semibold hud-text leading-snug line-clamp-2 tracking-[-0.01em]">
            {project.nome}
          </h3>
          <p className="mt-0.5 text-[11px] hud-text-muted truncate">
            {project.cliente || 'Cliente não informado'}
          </p>
        </div>
        <div className="shrink-0">
          <ProjectHealthIndicator score={health} variant="ring" size="md" />
        </div>
      </div>

      {/* Description */}
      {project.descricao && (
        <p className="relative text-[12px] hud-text-secondary line-clamp-2 leading-relaxed">
          {project.descricao}
        </p>
      )}

      {/* ── Progress strip ────────────────────────────── */}
      <div className="relative">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] hud-text-muted">
            Progresso
          </span>
          <span
            className="text-[12px] font-bold hud-text tabular-nums"
            style={{ color: progress >= 75 ? accent : undefined }}
          >
            {progress}%
          </span>
        </div>
        <div
          className="h-2 rounded-full overflow-hidden relative"
          style={{
            background: 'rgba(255, 255, 255, 0.06)',
            boxShadow: 'inset 0 1px 1px rgba(0, 0, 0, 0.20)',
          }}
        >
          <motion.div
            className="h-full rounded-full relative"
            style={{
              background: `linear-gradient(90deg, ${accent} 0%, ${accent}cc 100%)`,
              boxShadow: `0 0 8px ${accent}88`,
            }}
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
          >
            <span
              className="absolute inset-0 rounded-full"
              style={{
                background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.35) 0%, transparent 50%)',
              }}
            />
          </motion.div>
        </div>
      </div>

      {/* ── Stats grid (premium inset) ───────────────── */}
      <div className="relative grid grid-cols-3 gap-2 p-2.5 glass-inset">
        <Stat label="Valor" value={compactBRL(project.valor_total || 0)} />
        <Stat label="Impacto" value={impact.label} valueStyle={{ color: impact.color }} />
        <Stat
          label="Riscos"
          value={openHighRisks}
          icon={openHighRisks > 0 ? ShieldAlert : undefined}
          valueStyle={{ color: openHighRisks > 0 ? '#EF4444' : undefined }}
        />
      </div>

      {/* ── Footer ──────────────────────────────────── */}
      <div className="relative flex items-center justify-between pt-1 mt-auto">
        <div className="flex items-center gap-2 text-[10.5px] hud-text-muted min-w-0">
          {overdueTasks > 0 && (
            <span className="inline-flex items-center gap-1 text-amber-400 font-medium shrink-0">
              <AlertTriangle className="w-3 h-3" />
              {overdueTasks} atrasada{overdueTasks > 1 ? 's' : ''}
            </span>
          )}
          {project.comite_nome && (
            <span className="truncate" title={project.comite_nome}>
              {project.comite_nome}
            </span>
          )}
        </div>
        <span
          className={cn(
            'inline-flex items-center gap-1 text-[11.5px] font-semibold shrink-0',
            'transition-all duration-200 group-hover:gap-1.5',
          )}
          style={{ color: accent }}
        >
          <Eye className="w-3.5 h-3.5" />
          Ver mais
          <ArrowUpRight className="w-3 h-3 opacity-70 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
        </span>
      </div>
    </motion.button>
  );
}

function Stat({
  label,
  value,
  icon: Icon,
  valueStyle,
}: {
  label: string;
  value: string | number;
  icon?: React.ComponentType<{ className?: string }>;
  valueStyle?: React.CSSProperties;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[9px] font-semibold uppercase tracking-[0.14em] hud-text-muted truncate">
        {label}
      </p>
      <p
        className="mt-1 text-[13px] font-semibold hud-text tabular-nums truncate inline-flex items-center gap-1 leading-tight"
        style={valueStyle}
      >
        {Icon && <Icon className="w-3 h-3" />}
        {value}
      </p>
    </div>
  );
}

/**
 * Renders the client logo as a faint watermark in the top-right corner of the card.
 * Invisible when no logo is available — no placeholder, no border.
 */
function ClientLogoWatermark({
  client,
  logoUrl,
}: {
  client?: string | null;
  logoUrl?: string | null;
}) {
  const [errored, setErrored] = useState(false);
  const resolved = getClientLogoUrl(client, logoUrl);

  if (!resolved || errored) return null;

  return (
    <span className="pointer-events-none absolute top-4 right-4 w-14 h-10 flex items-center justify-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={resolved}
        alt=""
        aria-hidden="true"
        onError={() => setErrored(true)}
        className="max-h-full max-w-full object-contain"
        style={{ opacity: 0.18, filter: 'grayscale(0.4)' }}
      />
    </span>
  );
}

export default ProjectCard;
