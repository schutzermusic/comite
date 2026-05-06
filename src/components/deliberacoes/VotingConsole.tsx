'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { Vote, CircleCheck, CircleX, CircleMinus, AlertCircle, Clock3, ShieldCheck, UserCheck, type LucideIcon } from 'lucide-react';
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
  const votingHoursLeft = item.dueDate ? Math.max(0, Math.ceil((new Date(item.dueDate).getTime() - Date.now()) / (60 * 60 * 1000))) : null;
  const votesByUser = new Map(votes.map((vote) => [vote.voterId, vote]));
  const roster = [
    { id: 'user-1', name: 'CFO', role: 'Presidente', eligible: true },
    { id: currentUserId, name: 'Membro Corporativo', role: 'Votante', eligible: true },
    { id: 'user-3', name: 'Diretoria de Operações', role: 'Votante', eligible: true },
    { id: 'user-7', name: 'Comitê de Riscos', role: 'Parecerista', eligible: true },
    { id: 'user-observer', name: 'Secretaria de Governança', role: 'Secretaria', eligible: false },
  ];

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
          <h3 className="text-sm font-semibold text-ig-fg-strong">Votação do Comitê</h3>
        </div>
        <div className="flex items-center gap-2 text-xs text-ig-fg-muted">
          <Clock3 className="h-3.5 w-3.5" />
          {votingHoursLeft === null ? `Janela ${currentStage?.votingRule.votingWindowHours ?? 48}h` : `${votingHoursLeft}h restantes`}
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <div className="rounded-lg border border-ig-border-subtle bg-ig-panel/60 p-2.5">
          <p className="text-[10px] uppercase tracking-[0.14em] text-ig-fg-subtle">Regra</p>
          <p className="mt-1 text-xs font-semibold text-ig-fg-strong">
            {currentStage?.votingRule.majorityType === 'qualified_two_thirds' ? 'Maioria 2/3' : currentStage?.votingRule.majorityType === 'unanimity' ? 'Unanimidade' : 'Maioria simples'}
          </p>
        </div>
        <div className="rounded-lg border border-ig-border-subtle bg-ig-panel/60 p-2.5">
          <p className="text-[10px] uppercase tracking-[0.14em] text-ig-fg-subtle">Elegíveis</p>
          <p className="mt-1 text-xs font-semibold text-ig-fg-strong">{roster.filter((member) => member.eligible).length} membros</p>
        </div>
        <div className="rounded-lg border border-ig-border-subtle bg-ig-panel/60 p-2.5">
          <p className="text-[10px] uppercase tracking-[0.14em] text-ig-fg-subtle">Próxima ação</p>
          <p className="mt-1 text-xs font-semibold text-ig-fg-strong">{hasQuorum ? 'Encerrar janela' : 'Completar quórum'}</p>
        </div>
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
          <span className="text-xs text-ig-fg-muted uppercase tracking-wide">Quórum</span>
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

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <UserCheck className="h-4 w-4 text-ig-accent" />
          <p className="text-xs font-semibold uppercase tracking-wide text-ig-fg-subtle">Registro de votos e elegibilidade</p>
        </div>
        <div className="divide-y divide-ig-border-subtle overflow-hidden rounded-lg border border-ig-border-subtle bg-ig-panel/55">
          {roster.map((member) => {
            const registeredVote = votesByUser.get(member.id);
            const voteText = registeredVote?.vote === 'yes' ? 'Sim' : registeredVote?.vote === 'no' ? 'Não' : registeredVote?.vote === 'abstain' ? 'Abstenção' : member.eligible ? 'Pendente' : 'Sem voto';
            return (
              <div key={member.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-ig-fg-strong">{member.name}</p>
                  <p className="text-[10px] text-ig-fg-subtle">{member.role} · {member.eligible ? 'Elegível' : 'Não votante'}</p>
                </div>
                <span className={cn(
                  'rounded-full border px-2 py-0.5 text-[10px] font-semibold',
                  registeredVote?.vote === 'yes' && 'border-[color-mix(in_oklab,var(--ig-success)_30%,transparent)] bg-[color-mix(in_oklab,var(--ig-success)_10%,transparent)] text-ig-success',
                  registeredVote?.vote === 'no' && 'border-[color-mix(in_oklab,var(--ig-danger)_30%,transparent)] bg-[color-mix(in_oklab,var(--ig-danger)_10%,transparent)] text-ig-danger',
                  registeredVote?.vote === 'abstain' && 'border-ig-border-subtle bg-ig-panel text-ig-fg-muted',
                  !registeredVote && member.eligible && 'border-[color-mix(in_oklab,var(--ig-warning)_30%,transparent)] bg-[color-mix(in_oklab,var(--ig-warning)_10%,transparent)] text-ig-warning',
                  !registeredVote && !member.eligible && 'border-ig-border-subtle bg-ig-panel text-ig-fg-subtle',
                )}>
                  {voteText}
                </span>
              </div>
            );
          })}
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
              <p className="text-sm text-ig-success font-medium">Voto registrado</p>
              <p className="text-xs text-ig-fg-muted mt-0.5">Aguardando demais membros</p>
            </div>
          )}

          <HudButton variant={hasQuorum ? 'primary' : 'ghost'} fullWidth onClick={onCloseVoting} className="border border-ig-border" leftIcon={<ShieldCheck className="h-4 w-4" />}>
            Encerrar Janela de Votação
          </HudButton>
        </>
      )}
    </HudPanel>
  );
}
