'use client';

import React from 'react';
import {
  ArrowRight,
  CalendarClock,
  ChevronRight,
  Vote,
  FileText,
  MessageSquarePlus,
  Paperclip,
  Eye,
} from 'lucide-react';
import {
  HudPanel,
  HudStatusPill,
  HudBadge,
  HudButton,
  type HudStatusPillVariant,
  type HudBadgeVariant,
  type HudPanelProps,
} from '@/components/hud';
import { cn } from '@/lib/utils';
import type {
  Deliberacao,
  DeliberacaoStatus,
  DeliberacaoPrioridade,
} from './types';
import { DecisionSlaBadge } from './DecisionSlaBadge';
import { DecisionRiskBadge } from './DecisionRiskBadge';
import { CommitteeBadge } from './CommitteeBadge';

export type DecisionCardAction = 'open' | 'vote' | 'parecer' | 'evidence' | 'ata';

interface DecisionCardProps {
  deliberacao: Deliberacao;
  isSelected: boolean;
  onClick: () => void;
  /** Called with the quick-action id; defaults to opening the dossier. */
  onAction?: (action: DecisionCardAction) => void;
  /** RBAC: gates the "Votar" quick action. */
  canVote?: boolean;
}

const STATUS_PILL: Record<
  DeliberacaoStatus,
  { variant: HudStatusPillVariant; label: string }
> = {
  rascunho: { variant: 'neutral', label: 'Rascunho' },
  em_revisao: { variant: 'warning', label: 'Em Revisão' },
  em_votacao: { variant: 'info', label: 'Em Votação' },
  aguardando_ata: { variant: 'pending', label: 'Aguardando Ata' },
  em_execucao: { variant: 'active', label: 'Em Execução' },
  concluida: { variant: 'completed', label: 'Concluída' },
};

const PRIORIDADE_BADGE: Record<
  DeliberacaoPrioridade,
  { variant: HudBadgeVariant; label: string }
> = {
  critica: { variant: 'danger', label: 'Crítica' },
  alta: { variant: 'warning', label: 'Alta' },
  media: { variant: 'info', label: 'Média' },
  baixa: { variant: 'subtle', label: 'Baixa' },
};

function getInitials(nome: string): string {
  return nome
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

function derivePanelState(d: Deliberacao): HudPanelProps['state'] {
  if (d.sla_status === 'overdue') return 'critical';
  if (d.sla_status === 'at_risk' || d.prioridade === 'critica') return 'warning';
  return 'default';
}

function quickActionsForStatus(
  status: DeliberacaoStatus,
): { id: DecisionCardAction; label: string; icon: React.ReactNode }[] {
  switch (status) {
    case 'rascunho':
      return [
        { id: 'open', label: 'Abrir', icon: <Eye className="w-3.5 h-3.5" /> },
        { id: 'evidence', label: 'Anexar', icon: <Paperclip className="w-3.5 h-3.5" /> },
      ];
    case 'em_revisao':
      return [
        { id: 'open', label: 'Abrir', icon: <Eye className="w-3.5 h-3.5" /> },
        { id: 'parecer', label: 'Solicitar parecer', icon: <MessageSquarePlus className="w-3.5 h-3.5" /> },
      ];
    case 'em_votacao':
      return [
        { id: 'vote', label: 'Votar', icon: <Vote className="w-3.5 h-3.5" /> },
        { id: 'open', label: 'Abrir', icon: <Eye className="w-3.5 h-3.5" /> },
        { id: 'parecer', label: 'Solicitar parecer', icon: <MessageSquarePlus className="w-3.5 h-3.5" /> },
      ];
    case 'aguardando_ata':
      return [
        { id: 'ata', label: 'Lavrar ata', icon: <FileText className="w-3.5 h-3.5" /> },
        { id: 'open', label: 'Abrir', icon: <Eye className="w-3.5 h-3.5" /> },
      ];
    case 'em_execucao':
      return [
        { id: 'open', label: 'Abrir', icon: <Eye className="w-3.5 h-3.5" /> },
        { id: 'evidence', label: 'Anexar evidência', icon: <Paperclip className="w-3.5 h-3.5" /> },
      ];
    case 'concluida':
      return [{ id: 'open', label: 'Abrir', icon: <Eye className="w-3.5 h-3.5" /> }];
  }
}

/**
 * Decision dossier card — a single cohesive surface: one identity row
 * (comitê · status · prioridade | risco/SLA), title, meta line (responsável ·
 * prazo · quórum), next action strip and a hairline-divided action footer that
 * opens the dossier drawer.
 */
export function DecisionCard({
  deliberacao,
  isSelected,
  onClick,
  onAction,
  canVote = true,
}: DecisionCardProps) {
  const statusCfg = STATUS_PILL[deliberacao.status];
  const prioCfg = PRIORIDADE_BADGE[deliberacao.prioridade];
  const panelState = derivePanelState(deliberacao);
  const quorumPct = Math.min(
    100,
    deliberacao.quorum_necessario > 0
      ? (deliberacao.quorum_atual / deliberacao.quorum_necessario) * 100
      : 0,
  );
  const execTotal = deliberacao.acoes_execucao.length;
  const execDone = deliberacao.acoes_execucao.filter((a) => a.status === 'concluida').length;
  const execPct = execTotal > 0 ? Math.round((execDone / execTotal) * 100) : 0;
  const actions = quickActionsForStatus(deliberacao.status);
  const handleAction = (id: DecisionCardAction) => (onAction ?? (() => onClick()))(id);

  return (
    <div
      className={cn(
        'w-full rounded-xl transition-shadow',
        isSelected && 'ring-1 ring-ig-accent/60',
      )}
    >
      <HudPanel
        elevation={isSelected ? 3 : 2}
        state={panelState}
        interactive
        sweep={isSelected}
        noPadding
      >
        <button
          type="button"
          onClick={onClick}
          aria-label={`Abrir dossiê: ${deliberacao.titulo}`}
          className="block w-full text-left px-4 pt-3.5 pb-3 space-y-2.5 rounded-t-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ig-accent/40"
        >
          {/* Identity row: committee · status · priority | risk + SLA */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 min-w-0 flex-wrap">
              <CommitteeBadge nome={deliberacao.comite_nome} cor={deliberacao.comite_cor} />
              <HudStatusPill variant={statusCfg.variant} size="sm">
                {statusCfg.label}
              </HudStatusPill>
              <HudBadge variant={prioCfg.variant} size="sm">
                <span title={`Prioridade ${prioCfg.label.toLowerCase()}`}>{prioCfg.label}</span>
              </HudBadge>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <DecisionRiskBadge risco={deliberacao.risco} size="sm" />
              <DecisionSlaBadge status={deliberacao.sla_status} size="sm" />
            </div>
          </div>

          {/* Title */}
          <h4 className="text-sm font-semibold text-ig-fg-strong leading-snug line-clamp-2">
            {deliberacao.titulo}
          </h4>

          {/* Meta row: owner · due date · quorum (quórum é destacado apenas em
              votação — nos demais estados não sugerimos que a votação começou) */}
          <div className="flex items-center justify-between gap-3 text-xs flex-wrap">
            <div className="flex items-center gap-3 min-w-0">
              <span className="flex items-center gap-2 min-w-0">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-ig-accent-weak text-[10px] font-semibold text-ig-accent shrink-0">
                  {getInitials(deliberacao.responsavel_nome)}
                </span>
                <span className="text-ig-fg-muted truncate">{deliberacao.responsavel_nome}</span>
              </span>
              <span className="flex items-center gap-1 text-ig-fg-muted shrink-0">
                <CalendarClock className="w-3.5 h-3.5" />
                <span className="tabular-nums">{formatDate(deliberacao.sla_deadline)}</span>
              </span>
            </div>
            {deliberacao.status === 'em_execucao' && execTotal > 0 && (
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-ig-fg-muted text-[11px]">Execução</span>
                <span className="text-ig-fg-strong tabular-nums font-medium">
                  {execDone}/{execTotal}
                </span>
                <div className="w-12 h-1.5 rounded-full bg-ig-panel-hover overflow-hidden">
                  <div
                    className="h-full bg-ig-accent rounded-full transition-all"
                    style={{ width: `${execPct}%` }}
                  />
                </div>
              </div>
            )}
            {deliberacao.status === 'em_votacao' && (
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-ig-fg-muted text-[11px]">Quórum</span>
                <span className="text-ig-fg-strong tabular-nums font-medium">
                  {deliberacao.quorum_atual}/{deliberacao.quorum_necessario}
                </span>
                <div className="w-12 h-1.5 rounded-full bg-ig-panel-hover overflow-hidden">
                  <div
                    className="h-full bg-ig-accent rounded-full transition-all"
                    style={{ width: `${quorumPct}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Próxima ação */}
          <div className="flex items-start gap-2 rounded-md bg-ig-panel/60 border border-ig-border-subtle px-2.5 py-1.5">
            <ArrowRight className="w-3.5 h-3.5 text-ig-accent mt-0.5 shrink-0" />
            <p className="text-[11.5px] text-ig-fg leading-snug line-clamp-2">
              {deliberacao.proxima_acao}
            </p>
          </div>
        </button>

        {/* Action footer */}
        <div className="flex items-center justify-between gap-2 border-t border-ig-border-subtle px-3 py-1.5">
          <div className="flex items-center gap-1 flex-wrap">
            {actions.map((a) => {
              const voteBlocked = a.id === 'vote' && !canVote;
              return (
                <HudButton
                  key={a.id}
                  variant="ghost"
                  size="sm"
                  leftIcon={a.icon}
                  disabled={voteBlocked}
                  title={voteBlocked ? 'Requer permissão deliberations.vote' : undefined}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!voteBlocked) handleAction(a.id);
                  }}
                >
                  {a.label}
                </HudButton>
              );
            })}
          </div>
          <button
            type="button"
            onClick={onClick}
            className="hidden sm:inline-flex items-center gap-0.5 text-[11px] font-medium text-ig-fg-muted hover:text-ig-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ig-accent/40 rounded-md px-1.5 py-1 shrink-0"
          >
            Dossiê
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </HudPanel>
    </div>
  );
}
