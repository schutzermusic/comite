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
  { value: 'yes', label: 'Sim', icon: CircleCheck, color: '#00FFB4', bgColor: 'rgba(0,255,180,0.1)' },
  { value: 'no', label: 'Não', icon: CircleX, color: '#FF5860', bgColor: 'rgba(255,88,96,0.1)' },
  { value: 'abstain', label: 'Abstenção', icon: CircleMinus, color: 'rgba(255,255,255,0.7)', bgColor: 'rgba(255,255,255,0.08)' },
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
          <Vote className="w-4 h-4 text-[#00C8FF]" />
          <h3 className="text-sm font-semibold text-white">Votação</h3>
        </div>
        <span className="text-xs text-[rgba(255,255,255,0.55)]">
          Janela de votação: {currentStage?.votingRule.votingWindowHours ?? 48}h
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="p-2 rounded-lg bg-[rgba(0,255,180,0.08)]">
          <div className="text-lg font-semibold text-[#00FFB4]">{yesCount}</div>
          <div className="text-[10px] text-[rgba(255,255,255,0.55)]">Sim</div>
        </div>
        <div className="p-2 rounded-lg bg-[rgba(255,88,96,0.08)]">
          <div className="text-lg font-semibold text-[#FF5860]">{noCount}</div>
          <div className="text-[10px] text-[rgba(255,255,255,0.55)]">Não</div>
        </div>
        <div className="p-2 rounded-lg bg-[rgba(255,255,255,0.08)]">
          <div className="text-lg font-semibold text-white">{abstainCount}</div>
          <div className="text-[10px] text-[rgba(255,255,255,0.55)]">Abstenção</div>
        </div>
      </div>

      <div className="p-3 rounded-lg border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.02)]">
        <div className="flex items-center justify-between">
          <span className="text-xs text-[rgba(255,255,255,0.65)] uppercase tracking-wide">Quorum</span>
          <span className={cn('text-xs font-medium', hasQuorum ? 'text-[#00FFB4]' : 'text-[#FFB04D]')}>
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
                      className={cn('p-2 rounded border text-sm transition-all', active ? 'border-current' : 'border-[rgba(255,255,255,0.12)]')}
                      style={{
                        color: active ? option.color : 'rgba(255,255,255,0.8)',
                        backgroundColor: active ? option.bgColor : 'rgba(255,255,255,0.02)',
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
