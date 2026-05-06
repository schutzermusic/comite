'use client';

import { Eye, Trash2, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Project } from '@/lib/types';
import type { ProjectV2 } from '@/lib/types/project-v2';
import { compactBRL } from '@/lib/utils/project-utils';
import { HudStatusPill, HudProgressBar, HudButton } from '@/components/hud';
import { ProjectClientLogo } from './ProjectClientLogo';
import { ProjectHealthIndicator } from './ProjectHealthIndicator';

interface ProjectTableProps {
  projects: Project[];
  v2Map: Map<string, ProjectV2>;
  onView: (p: Project) => void;
  onDelete: (id: string) => void;
  highlightedId?: string | null;
}

const STATUS_VARIANT: Record<string, 'active' | 'completed' | 'warning' | 'error' | 'neutral'> = {
  em_andamento: 'active',
  concluido: 'completed',
  pausado: 'warning',
  cancelado: 'error',
  planejamento: 'neutral',
};

const IMPACT_COLOR: Record<string, string> = {
  baixo: '#94A3B8',
  medio: '#22D3EE',
  alto: '#F59E0B',
  critico: '#EF4444',
};

function formatStatus(status: string) {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
}

export function ProjectTable({
  projects,
  v2Map,
  onView,
  onDelete,
  highlightedId,
}: ProjectTableProps) {
  return (
    <div className="glass-tile glass-tile-elevated glass-tile-sheen overflow-hidden">
      <div className="max-h-[70vh] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 backdrop-blur-md projects-table-head">
            <tr className="text-left text-[10px] uppercase tracking-[0.14em] hud-text-muted">
              <Th>Projeto</Th>
              <Th>Status</Th>
              <Th align="center">Health</Th>
              <Th>Progresso</Th>
              <Th align="right">Valor</Th>
              <Th>Impacto</Th>
              <Th align="center">Riscos</Th>
              <Th>Comitê</Th>
              <Th>Responsável</Th>
              <Th align="right">Ações</Th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => {
              const v2 = v2Map.get(p.id);
              const health = v2?.health_score ?? 100;
              const openHighRisks = (v2?.risks || []).filter(
                (r) => r.status !== 'resolved' && (r.severity === 'high' || r.severity === 'critical'),
              ).length;
              const impactColor = IMPACT_COLOR[p.impacto_financeiro] ?? '#94A3B8';
              const isHighlighted = highlightedId === p.id;
              return (
                <tr
                  key={p.id}
                  onClick={() => onView(p)}
                  className={cn(
                    'border-t hud-divider cursor-pointer transition-colors',
                    'hover:bg-emerald-500/[0.04]',
                    isHighlighted && 'bg-emerald-500/[0.06]',
                  )}
                >
                  <Td>
                    <div className="flex items-center gap-3 min-w-0">
                      <ProjectClientLogo client={p.cliente} logoUrl={p.clientLogoUrl} size="sm" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-semibold tabular-nums tracking-wide hud-text-muted">
                            {p.codigo || '—'}
                          </span>
                        </div>
                        <p className="font-medium hud-text truncate max-w-[260px]">{p.nome}</p>
                        <p className="text-xs hud-text-muted truncate max-w-[260px]">{p.cliente || '—'}</p>
                      </div>
                    </div>
                  </Td>
                  <Td>
                    <HudStatusPill variant={STATUS_VARIANT[p.status] ?? 'neutral'} size="sm">
                      {formatStatus(p.status)}
                    </HudStatusPill>
                  </Td>
                  <Td align="center">
                    <ProjectHealthIndicator score={health} variant="inline" />
                  </Td>
                  <Td>
                    <div className="min-w-[120px]">
                      <HudProgressBar value={p.progresso_percentual || 0} size="sm" showLabel />
                    </div>
                  </Td>
                  <Td align="right">
                    <span className="font-semibold tabular-nums hud-text">
                      {compactBRL(p.valor_total || 0)}
                    </span>
                  </Td>
                  <Td>
                    <span
                      className="inline-flex items-center gap-1.5 text-xs font-medium capitalize"
                      style={{ color: impactColor }}
                    >
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: impactColor }} />
                      {p.impacto_financeiro}
                    </span>
                  </Td>
                  <Td align="center">
                    {openHighRisks > 0 ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-400">
                        <ShieldAlert className="w-3.5 h-3.5" />
                        {openHighRisks}
                      </span>
                    ) : (
                      <span className="text-xs hud-text-muted">—</span>
                    )}
                  </Td>
                  <Td>
                    <span className="text-xs hud-text-secondary truncate max-w-[140px] inline-block">
                      {p.comite_nome || '—'}
                    </span>
                  </Td>
                  <Td>
                    <span className="text-xs hud-text-secondary truncate max-w-[140px] inline-block">
                      {p.responsavel?.nome || '—'}
                    </span>
                  </Td>
                  <Td align="right">
                    <div
                      className="inline-flex items-center gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <HudButton
                        variant="ghost"
                        size="sm"
                        leftIcon={<Eye className="w-3.5 h-3.5" />}
                        onClick={() => onView(p)}
                      >
                        Ver
                      </HudButton>
                      <HudButton
                        variant="ghost"
                        size="sm"
                        leftIcon={<Trash2 className="w-3.5 h-3.5" />}
                        onClick={() => onDelete(p.id)}
                      >
                        <span className="sr-only">Excluir</span>
                      </HudButton>
                    </div>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({
  children,
  align = 'left',
}: {
  children: React.ReactNode;
  align?: 'left' | 'right' | 'center';
}) {
  return (
    <th
      className="px-4 py-3 font-semibold whitespace-nowrap"
      style={{ textAlign: align }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = 'left',
}: {
  children: React.ReactNode;
  align?: 'left' | 'right' | 'center';
}) {
  return (
    <td className="px-4 py-3 align-middle" style={{ textAlign: align }}>
      {children}
    </td>
  );
}

export default ProjectTable;
