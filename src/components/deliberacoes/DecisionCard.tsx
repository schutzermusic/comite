'use client';

import React from 'react';
import {
  ArrowRight,
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

interface DecisionCardProps {
  deliberacao: Deliberacao;
  isSelected: boolean;
  onClick: () => void;
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

function derivePanelState(d: Deliberacao): HudPanelProps['state'] {
  if (d.risco === 'critico' && d.sla_status === 'overdue') return 'critical';
  if (d.sla_status === 'overdue') return 'critical';
  if (d.sla_status === 'at_risk' || d.prioridade === 'critica') return 'warning';
  return 'default';
}

function quickActionsForStatus(
  status: DeliberacaoStatus,
): { id: string; label: string; icon: React.ReactNode }[] {
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
        { id: 'evidence', label: 'Anexar', icon: <Paperclip className="w-3.5 h-3.5" /> },
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

export function DecisionCard({ deliberacao, isSelected, onClick }: DecisionCardProps) {
  const statusCfg = STATUS_PILL[deliberacao.status];
  const prioCfg = PRIORIDADE_BADGE[deliberacao.prioridade];
  const panelState = derivePanelState(deliberacao);
  const quorumPct = Math.min(
    100,
    deliberacao.quorum_necessario > 0
      ? (deliberacao.quorum_atual / deliberacao.quorum_necessario) * 100
      : 0,
  );
  const actions = quickActionsForStatus(deliberacao.status);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full text-left rounded-xl transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ig-accent/40',
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
        <div className="px-4 py-3.5 space-y-3">
          {/* Header row: committee | status pill | risk */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <CommitteeBadge nome={deliberacao.comite_nome} cor={deliberacao.comite_cor} />
              <HudStatusPill variant={statusCfg.variant} size="sm">
                {statusCfg.label}
              </HudStatusPill>
            </div>
            <DecisionRiskBadge risco={deliberacao.risco} size="sm" />
          </div>

          {/* Title */}
          <h4 className="text-sm font-semibold text-ig-fg-strong leading-snug line-clamp-2">
            {deliberacao.titulo}
          </h4>

          {/* Meta row: owner | quorum */}
          <div className="flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-ig-accent-weak text-[10px] font-semibold text-ig-accent shrink-0">
                {getInitials(deliberacao.responsavel_nome)}
              </span>
              <span className="text-ig-fg-muted truncate">{deliberacao.responsavel_nome}</span>
            </div>
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
          </div>

          {/* Badges row */}
          <div className="flex items-center gap-2 flex-wrap">
            <DecisionSlaBadge status={deliberacao.sla_status} size="sm" />
            <HudBadge variant={prioCfg.variant} size="sm">
              {prioCfg.label}
            </HudBadge>
          </div>

          {/* Próxima ação */}
          <div className="flex items-start gap-2 rounded-md bg-ig-panel/60 border border-ig-border-subtle px-2.5 py-1.5">
            <ArrowRight className="w-3.5 h-3.5 text-ig-accent mt-0.5 shrink-0" />
            <p className="text-[11.5px] text-ig-fg leading-snug line-clamp-2">
              {deliberacao.proxima_acao}
            </p>
          </div>

          {/* Quick actions */}
          <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
            {actions.map((a) => (
              <HudButton
                key={a.id}
                variant="ghost"
                size="sm"
                leftIcon={a.icon}
                onClick={(e) => {
                  e.stopPropagation();
                }}
              >
                {a.label}
              </HudButton>
            ))}
          </div>
        </div>
      </HudPanel>
    </button>
  );
}
