'use client';

/**
 * Acompanhamento do Apex.
 *
 * ─── A frase que este painel precisa fazer o usuário pensar ────────────────
 *
 * "O Apex está cuidando disso."
 *
 * Não "tenho 12 tarefas". A diferença aparece no conteúdo de cada linha: em
 * vez de um checkbox e uma data, cada item diz o OBJETIVO, quem responde, o
 * que o Apex está esperando agora, e quando ele volta a falar. Um
 * acompanhamento em `WAITING_EXTERNAL_PARTY` mostra explicitamente que está
 * calado de propósito — porque a alternativa, cobrar todo dia, é o que faz
 * qualquer sistema de lembrete virar ruído em duas semanas.
 *
 * Conclusão nunca é um clique de "feito". É verificação: por evidência, quando
 * existe regra conferível; por confirmação humana, quando não existe. As duas
 * ficam visíveis e distintas no rodapé do item.
 */

import { cn } from '@/lib/utils';
import {
  Radar, UserPlus, PauseCircle, AlertOctagon, CheckCircle2, Clock,
} from 'lucide-react';
import { HudPanel, HudButton, HudEmptyState } from '@/components/hud';
import type { ApexFollowupRow } from '@/lib/platform/followups/types';
import {
  CLOSURE_BASIS_LABEL, FOLLOWUP_STATE_LABEL, isOpenFollowup,
} from '@/lib/platform/followups/types';
import { followupNarrative, nudgeDecision } from '@/lib/platform/followups/state';

const STATE_TONE: Record<string, string> = {
  ACTIVE: 'border-ig-accent/45 text-ig-accent',
  WAITING_EXTERNAL_PARTY: 'border-ig-border-strong text-ig-fg-muted',
  BLOCKED: 'border-ig-danger/45 text-ig-danger',
  ESCALATED: 'border-ig-danger/45 text-ig-danger',
  COMPLETED: 'border-ig-success/45 text-ig-success',
  CANCELLED: 'border-ig-border text-ig-fg-muted',
};

export interface ApexFollowupPanelProps {
  followups: readonly ApexFollowupRow[];
  asOf: string;
  error?: string | null;
  loading?: boolean;
  canAct?: boolean;
  onAssign?: (followup: ApexFollowupRow) => void;
  onWait?: (followup: ApexFollowupRow) => void;
  onEscalate?: (followup: ApexFollowupRow) => void;
  onComplete?: (followup: ApexFollowupRow) => void;
  className?: string;
}

export function ApexFollowupPanel({
  followups, asOf, error = null, loading = false, canAct = false,
  onAssign, onWait, onEscalate, onComplete, className,
}: ApexFollowupPanelProps) {
  const open = followups.filter((f) => isOpenFollowup(f.state));
  const closed = followups.filter((f) => !isOpenFollowup(f.state));

  return (
    <HudPanel
      title="Acompanhamento do Apex"
      subtitle={
        error ? 'Falha ao carregar' :
        open.length === 0
          ? 'Nada em acompanhamento neste contrato'
          : `${open.length} em acompanhamento${closed.length > 0 ? ` · ${closed.length} encerrado(s)` : ''}`
      }
      icon={<Radar className="h-4 w-4" />}
      interactive={false}
      className={className}
      data-testid="apex-followup-panel"
    >
      {/* Consulta que FALHOU não é lista vazia: as duas pedem ações diferentes. */}
      {error && (
        <p className="rounded-lg border border-ig-warning/35 p-3 text-ig-body-sm text-ig-warning">{error}</p>
      )}
      {!error && loading && (
        <p className="py-5 text-center text-ig-caption text-ig-fg-muted">Carregando acompanhamentos…</p>
      )}
      {!error && !loading && followups.length === 0 && (
        <HudEmptyState
          icon="inbox"
          compact
          title="Nenhum acompanhamento aberto"
          description="Quando o Apex identificar algo material e alguém disser quem responde por aquilo, o acompanhamento aparece aqui e passa a ser dele."
        />
      )}

      {!error && !loading && followups.length > 0 && (
        <div className="space-y-2.5">
          {[...open, ...closed].map((followup) => {
            const decision = nudgeDecision(followup, asOf);
            const unassigned =
              !followup.responsible_user_id && !followup.responsible_party_id && !followup.responsible_text;
            return (
              <article
                key={followup.id}
                className={cn(
                  'rounded-xl border bg-ig-panel/45 p-3',
                  followup.state === 'ESCALATED' || followup.state === 'BLOCKED'
                    ? 'border-ig-danger/35' : 'border-ig-border-subtle',
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-ig-body-sm font-semibold text-ig-fg-strong">{followup.goal}</p>
                    <p className="mt-0.5 text-ig-caption text-ig-fg-muted">
                      {followupNarrative(followup, asOf)}
                    </p>
                  </div>
                  <span className={cn(
                    'shrink-0 rounded-full border px-2 py-0.5 text-[10px]',
                    STATE_TONE[followup.state] ?? 'border-ig-border text-ig-fg-muted',
                  )}>
                    {FOLLOWUP_STATE_LABEL[followup.state]}
                  </span>
                </div>

                <dl className="mt-2 grid gap-x-4 gap-y-1 text-ig-caption sm:grid-cols-2">
                  <div className="flex gap-1.5">
                    <dt className="text-ig-fg-subtle">Responsável:</dt>
                    <dd className={unassigned ? 'text-ig-warning' : 'text-ig-fg-default'}>
                      {followup.responsible_text
                        ?? (followup.responsible_user_id ? 'Pessoa da organização' : null)
                        ?? (followup.responsible_party_id ? 'Parte externa' : 'não designado')}
                    </dd>
                  </div>
                  {followup.expected_evidence && (
                    <div className="flex gap-1.5">
                      <dt className="text-ig-fg-subtle">Evidência esperada:</dt>
                      <dd className="text-ig-fg-default">{followup.expected_evidence}</dd>
                    </div>
                  )}
                  {followup.due_date && (
                    <div className="flex gap-1.5">
                      <dt className="text-ig-fg-subtle">Prazo:</dt>
                      <dd className="text-ig-fg-default">{followup.due_date}</dd>
                    </div>
                  )}
                  {followup.closure_basis && (
                    <div className="flex gap-1.5">
                      <dt className="text-ig-fg-subtle">Encerrado por:</dt>
                      <dd className="text-ig-fg-default">{CLOSURE_BASIS_LABEL[followup.closure_basis]}</dd>
                    </div>
                  )}
                </dl>

                {/*
                  O silêncio DELIBERADO é dito em voz alta. Sem esta linha, um
                  acompanhamento parado parece esquecido — e é justamente o
                  contrário: ele está esperando a data que a pessoa informou.
                */}
                {isOpenFollowup(followup.state) && decision.silenceReason && (
                  <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-ig-border-subtle p-2 text-[11px] text-ig-fg-muted">
                    <Clock className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                    {decision.silenceReason}
                  </p>
                )}

                {canAct && isOpenFollowup(followup.state) && (
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    {onAssign && (
                      <HudButton
                        variant={unassigned ? 'primary' : 'ghost'} size="sm"
                        leftIcon={<UserPlus className="h-3.5 w-3.5" />}
                        onClick={() => onAssign(followup)}
                      >
                        {unassigned ? 'Designar responsável' : 'Trocar responsável'}
                      </HudButton>
                    )}
                    {onWait && followup.state !== 'WAITING_EXTERNAL_PARTY' && (
                      <HudButton
                        variant="secondary" size="sm"
                        leftIcon={<PauseCircle className="h-3.5 w-3.5" />}
                        onClick={() => onWait(followup)}
                      >
                        Aguardar contraparte
                      </HudButton>
                    )}
                    {onEscalate && followup.state !== 'ESCALATED' && (
                      <HudButton
                        variant="ghost" size="sm"
                        leftIcon={<AlertOctagon className="h-3.5 w-3.5" />}
                        onClick={() => onEscalate(followup)}
                      >
                        Escalar
                      </HudButton>
                    )}
                    {onComplete && (
                      <HudButton
                        variant="ghost" size="sm"
                        leftIcon={<CheckCircle2 className="h-3.5 w-3.5" />}
                        onClick={() => onComplete(followup)}
                      >
                        {followup.verification_mode === 'deterministic_evidence'
                          ? 'Verificar evidência' : 'Confirmar conclusão'}
                      </HudButton>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </HudPanel>
  );
}
