'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { Vote, CircleCheck, CircleX, CircleMinus, AlertCircle, type LucideIcon } from 'lucide-react';
import { DeliberationItem, VoteOption } from '@/lib/types';
import { HudButton, HudPanel } from '@/components/hud';
import { Checkbox } from '@/components/ui/checkbox';

interface VotingConsoleProps {
  item: DeliberationItem;
  currentUserId: string;
  onCastVote: (vote: VoteOption, justification?: string, hasConflict?: boolean) => void;
  onCloseVoting: () => void;
  onOpenVoting: () => void;
}

const voteOptions: Array<{
  value: VoteOption;
  label: string;
  icon: LucideIcon;
  activeColorClass: string;
  activeBgClass: string;
}> = [
  {
    value: 'yes',
    label: 'Sim',
    icon: CircleCheck,
    activeColorClass: 'text-ig-success',
    activeBgClass: 'bg-[color-mix(in_oklab,var(--ig-success)_12%,transparent)] border-[color-mix(in_oklab,var(--ig-success)_40%,transparent)]',
  },
  {
    value: 'no',
    label: 'Não',
    icon: CircleX,
    activeColorClass: 'text-ig-danger',
    activeBgClass: 'bg-[color-mix(in_oklab,var(--ig-danger)_12%,transparent)] border-[color-mix(in_oklab,var(--ig-danger)_40%,transparent)]',
  },
  {
    value: 'abstain',
    label: 'Abstenção',
    icon: CircleMinus,
    activeColorClass: 'text-ig-fg-muted',
    activeBgClass: 'bg-ig-panel-hover border-ig-border-strong',
  },
];

export function VotingConsole({ item, currentUserId, onCastVote, onCloseVoting, onOpenVoting }: VotingConsoleProps) {
  const [selectedVote, setSelectedVote] = React.useState<VoteOption | null>(null);
  const [justification, setJustification] = React.useState('');
  const [hasConflict, setHasConflict] = React.useState(false);

  const votes = item.votes ?? [];
  const yesCount = votes.filter((v) => v.vote === 'yes').length;
  const noCount = votes.filter((v) => v.vote === 'no').length;
  const abstainCount = votes.filter((v) => v.vote === 'abstain').length;

  const currentStage = item.stages?.find((s) => s.id === item.currentStageId);
  const required = item.quorumRequired ?? 3;
  const present = item.quorumPresent ?? votes.length;
  const hasQuorum = present >= required;
  const hasUserVoted = votes.some((v) => v.voterId === currentUserId);

  const handleSubmitVote = () => {
    if (!selectedVote) return;
    onCastVote(selectedVote, justification || undefined, hasConflict);
    setSelectedVote(null);
    setJustification('');
    setHasConflict(false);
  };

  const totalVotes = yesCount + noCount + abstainCount;
  const yesPercent = totalVotes > 0 ? Math.round((yesCount / totalVotes) * 100) : 0;
  const noPercent = totalVotes > 0 ? Math.round((noCount / totalVotes) * 100) : 0;

  return (
    <HudPanel halo className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Vote className="w-4 h-4 text-ig-accent" />
          <h3 className="text-sm font-semibold text-ig-fg-strong">Votação</h3>
        </div>
        <span className="text-xs text-ig-fg-muted">
          Janela: {currentStage?.votingRule.votingWindowHours ?? 48}h
        </span>
      </div>

      {/* Vote tally */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="p-2.5 rounded-lg bg-[color-mix(in_oklab,var(--ig-success)_8%,transparent)] border border-[color-mix(in_oklab,var(--ig-success)_20%,transparent)]">
          <div className="text-lg font-semibold text-ig-success tabular-nums">{yesCount}</div>
          <div className="text-[10px] text-ig-fg-muted">Sim</div>
          {totalVotes > 0 && <div className="text-[10px] text-ig-success font-medium">{yesPercent}%</div>}
        </div>
        <div className="p-2.5 rounded-lg bg-[color-mix(in_oklab,var(--ig-danger)_8%,transparent)] border border-[color-mix(in_oklab,var(--ig-danger)_20%,transparent)]">
          <div className="text-lg font-semibold text-ig-danger tabular-nums">{noCount}</div>
          <div className="text-[10px] text-ig-fg-muted">Não</div>
          {totalVotes > 0 && <div className="text-[10px] text-ig-danger font-medium">{noPercent}%</div>}
        </div>
        <div className="p-2.5 rounded-lg bg-ig-panel border border-ig-border">
          <div className="text-lg font-semibold text-ig-fg tabular-nums">{abstainCount}</div>
          <div className="text-[10px] text-ig-fg-muted">Abstenção</div>
        </div>
      </div>

      {/* Quorum indicator */}
      <div className="p-3 rounded-lg border border-ig-border bg-ig-panel">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-ig-fg-muted uppercase tracking-wide">Quorum</span>
          <span className={cn('text-xs font-semibold tabular-nums', hasQuorum ? 'text-ig-success' : 'text-ig-warning')}>
            {present}/{required} {hasQuorum ? '✓ Atingido' : '— Pendente'}
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-ig-panel-hover overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all', hasQuorum ? 'bg-ig-success' : 'bg-ig-warning')}
            style={{ width: `${Math.min(100, (present / required) * 100)}%` }}
          />
        </div>
      </div>

      {/* Voting action */}
      {!item.votingStartedAt ? (
        <HudButton variant="primary" fullWidth onClick={onOpenVoting} leftIcon={<Vote className="w-4 h-4" />}>
          Abrir Votação
        </HudButton>
      ) : (
        <>
          {!hasUserVoted && (
            <>
              <div className="grid grid-cols-3 gap-2">
                {voteOptions.map((option) => {
                  const Icon = option.icon;
                  const active = selectedVote === option.value;
                  return (
                    <button
                      key={option.value}
                      onClick={() => setSelectedVote(option.value)}
                      className={cn(
                        'p-2.5 rounded-lg border text-sm transition-all font-medium',
                        active
                          ? cn(option.activeColorClass, option.activeBgClass)
                          : 'border-ig-border bg-ig-panel text-ig-fg-muted hover:border-ig-border-strong hover:text-ig-fg'
                      )}
                    >
                      <Icon className="w-4 h-4 mx-auto mb-1" />
                      {option.label}
                    </button>
                  );
                })}
              </div>

              <textarea
                value={justification}
                onChange={(e) => setJustification(e.target.value)}
                placeholder="Justificativa (opcional)"
                className="w-full p-3 text-sm rounded-lg bg-ig-panel border border-ig-border text-ig-fg placeholder:text-ig-fg-subtle resize-none focus:border-ig-border-focus focus:outline-none"
                rows={2}
              />

              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-[color-mix(in_oklab,var(--ig-warning)_8%,transparent)] border border-[color-mix(in_oklab,var(--ig-warning)_24%,transparent)]">
                <Checkbox
                  id="conflict"
                  checked={hasConflict}
                  onCheckedChange={(checked) => setHasConflict(Boolean(checked))}
                />
                <label htmlFor="conflict" className="text-xs text-ig-warning flex items-center gap-1 cursor-pointer">
                  <AlertCircle className="w-3.5 h-3.5" />
                  Declarar conflito de interesse
                </label>
              </div>

              <HudButton
                variant="primary"
                fullWidth
                onClick={handleSubmitVote}
                disabled={!selectedVote}
              >
                Registrar Voto
              </HudButton>
            </>
          )}

          {hasUserVoted && (
            <div className="p-3 rounded-lg bg-[color-mix(in_oklab,var(--ig-success)_8%,transparent)] border border-[color-mix(in_oklab,var(--ig-success)_20%,transparent)] text-center">
              <p className="text-sm text-ig-success font-medium">✓ Voto registrado</p>
              <p className="text-xs text-ig-fg-muted mt-0.5">Aguardando demais membros</p>
            </div>
          )}

          <HudButton variant="ghost" fullWidth onClick={onCloseVoting} className="border border-ig-border">
            Encerrar Janela de Votação
          </HudButton>
        </>
      )}
    </HudPanel>
  );
}
