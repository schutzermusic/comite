'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { Vote, CircleCheck, CircleX, CircleMinus, AlertCircle } from 'lucide-react';
import { DeliberationItem, VoteOption } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { HUDCard } from '@/components/ui/hud-card';

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
  icon: React.ElementType;
  color: string;
  bgColor: string;
}> = [
  { value: 'yes', label: 'Sim', icon: CircleCheck, color: 'var(--ig-success)', bgColor: 'rgba(16,185,129,0.08)' },
  { value: 'no', label: 'Não', icon: CircleX, color: 'var(--ig-danger)', bgColor: 'rgba(239,75,85,0.08)' },
  { value: 'abstain', label: 'Abstenção', icon: CircleMinus, color: 'var(--ig-fg-muted)', bgColor: 'var(--ig-accent-weak)' },
];

export function VotingConsole({ item, currentUserId, onCastVote, onCloseVoting, onOpenVoting }: VotingConsoleProps) {
  const [selectedVote, setSelectedVote] = React.useState<VoteOption | null>(null);
  const [justification, setJustification] = React.useState('');
  const [hasConflict, setHasConflict] = React.useState(false);

  const votes = item.votes ?? [];
  const yesCount = votes.filter((vote) => vote.vote === 'yes').length;
  const noCount = votes.filter((vote) => vote.vote === 'no').length;
  const abstainCount = votes.filter((vote) => vote.vote === 'abstain').length;

  const currentStage = item.stages?.find((stage) => stage.id === item.currentStageId);
  const required = item.quorumRequired ?? 3;
  const present = item.quorumPresent ?? votes.length;
  const hasQuorum = present >= required;
  const hasUserVoted = votes.some((vote) => vote.voterId === currentUserId);

  const handleSubmitVote = () => {
    if (!selectedVote) return;
    onCastVote(selectedVote, justification || undefined, hasConflict);
    setSelectedVote(null);
    setJustification('');
    setHasConflict(false);
  };

  return (
    <HUDCard glow glowColor="cyan" className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Vote className="w-4 h-4" style={{ color: 'var(--ig-info)' }} />
          <h3 className="text-sm font-semibold hud-text">Votação</h3>
        </div>
        <span className="text-xs hud-text-muted">
          Janela de votação: {currentStage?.votingRule.votingWindowHours ?? 48}h
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="p-2 rounded-lg" style={{ background: 'rgba(16,185,129,0.06)' }}>
          <div className="text-lg font-semibold" style={{ color: 'var(--ig-success)' }}>{yesCount}</div>
          <div className="text-[10px] hud-text-muted">Sim</div>
        </div>
        <div className="p-2 rounded-lg" style={{ background: 'rgba(239,75,85,0.06)' }}>
          <div className="text-lg font-semibold" style={{ color: 'var(--ig-danger)' }}>{noCount}</div>
          <div className="text-[10px] hud-text-muted">Não</div>
        </div>
        <div className="p-2 rounded-lg hud-surface">
          <div className="text-lg font-semibold hud-text">{abstainCount}</div>
          <div className="text-[10px] hud-text-muted">Abstenção</div>
        </div>
      </div>

      <div className="p-3 rounded-lg border hud-surface">
        <div className="flex items-center justify-between">
          <span className="text-xs hud-text-muted uppercase tracking-wide">Quorum</span>
          <span className={cn('text-xs font-medium', hasQuorum ? 'hud-accent-success' : 'hud-accent-warning')}>
            {present}/{required}
          </span>
        </div>
      </div>

      {!item.votingStartedAt ? (
        <Button onClick={onOpenVoting} className="w-full bg-[#00C8FF] hover:bg-[#00A8D9] text-[#050D0A] font-semibold">
          Abrir Votação
        </Button>
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
                      className={cn('p-2 rounded border text-sm transition-all', active ? 'border-current' : 'border-[var(--ig-border-default)]')}
                      style={{
                        color: active ? option.color : 'var(--ig-fg-default)',
                        backgroundColor: active ? option.bgColor : 'var(--ig-accent-weak)',
                      }}
                    >
                      <Icon className="w-4 h-4 mx-auto mb-1" />
                      {option.label}
                    </button>
                  );
                })}
              </div>

              <textarea
                value={justification}
                onChange={(event) => setJustification(event.target.value)}
                placeholder="Justificativa (opcional)"
                className="w-full p-3 text-sm rounded-lg bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.08)] text-white placeholder-[rgba(255,255,255,0.35)] resize-none"
                rows={2}
              />

              <div className="flex items-center gap-2 p-2 rounded-lg bg-[rgba(255,176,77,0.08)] border border-[rgba(255,176,77,0.2)]">
                <Checkbox
                  id="conflict"
                  checked={hasConflict}
                  onCheckedChange={(checked) => setHasConflict(Boolean(checked))}
                />
                <label htmlFor="conflict" className="text-xs text-[#FFB04D] flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" />
                  Declaração de conflito de interesse
                </label>
              </div>

              <Button onClick={handleSubmitVote} disabled={!selectedVote} className="w-full bg-[#00FFB4] hover:bg-[#00D89A] text-[#050D0A] font-semibold">
                Registrar Voto
              </Button>
            </>
          )}

          <Button onClick={onCloseVoting} variant="outline" className="w-full border-[rgba(255,255,255,0.15)] text-[rgba(255,255,255,0.85)]">
            Encerrar Janela de Votação
          </Button>
        </>
      )}
    </HUDCard>
  );
}
