'use client';

/**
 * Ação recomendada — a resposta do cockpit para "o que fazer agora?".
 *
 * A prioridade é DETERMINÍSTICA (MD §57): sai do item mais grave da central de
 * atenção, por uma ordem fixa de severidade. Nenhum modelo decide uma operação
 * básica de contrato.
 *
 * Some quando não há nada exigindo atenção — um contrato saudável não deve
 * inventar tarefa para o usuário.
 */

import { cn } from '@/lib/utils';
import { Sparkles, ArrowRight } from 'lucide-react';
import { HudButton } from '@/components/hud';
import type { RecommendedAction as RecommendedActionModel } from '@/lib/contracts/trust/attention';

export interface RecommendedActionProps {
  action: RecommendedActionModel | null;
  onRun?: () => void;
  disabled?: boolean;
  className?: string;
  /**
   * Quantos itens exigem atenção. O painel só se justifica quando há mais de
   * um: com um único item, ele repetiria palavra por palavra o card logo acima
   * — e um bloco que só duplica o vizinho gasta a atenção do leitor sem
   * acrescentar nada.
   */
  attentionCount?: number;
}

export function RecommendedActionPanel({
  action, onRun, disabled, className, attentionCount,
}: RecommendedActionProps) {
  if (!action) return null;
  if (attentionCount !== undefined && attentionCount <= 1) return null;

  const critical = action.severity === 'critical';

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-[16px] border px-4 py-4',
        critical
          ? 'border-[color-mix(in_oklab,var(--ig-danger)_34%,transparent)] bg-[color-mix(in_oklab,var(--ig-danger)_7%,transparent)]'
          : 'border-ig-border-focus/45 bg-[color-mix(in_oklab,var(--ig-accent)_6%,transparent)]',
        className,
      )}
    >
      {/* Realce superior discreto — profundidade sem neon (MD §73). */}
      <span
        className={cn(
          'pointer-events-none absolute inset-x-6 top-0 h-px',
          critical
            ? 'bg-[linear-gradient(90deg,transparent,var(--ig-danger),transparent)]'
            : 'bg-[linear-gradient(90deg,transparent,var(--ig-accent),transparent)]',
        )}
        aria-hidden
      />

      <p
        className={cn(
          'flex items-center gap-1.5 text-ig-label font-semibold',
          critical ? 'text-ig-danger' : 'text-ig-accent',
        )}
      >
        <Sparkles className="h-3.5 w-3.5" aria-hidden />
        Comece por aqui
      </p>

      {/*
        O painel prioriza, não repete: a razão do item já foi lida acima, então
        aqui basta dizer POR QUE este vem primeiro entre os demais.
      */}
      <h4 className="mt-2 text-[15px] font-semibold leading-snug text-ig-fg-strong">{action.title}</h4>
      <p className="mt-1 text-ig-body-sm leading-relaxed text-ig-fg-muted">
        {attentionCount !== undefined
          ? `Item mais grave entre os ${attentionCount} que exigem atenção neste contrato.`
          : action.reason}
      </p>

      {onRun && (
        <HudButton
          variant={critical ? 'primary' : 'secondary'}
          size="sm"
          className="mt-3"
          onClick={onRun}
          disabled={disabled}
        >
          {action.label}
          <ArrowRight className="ml-1.5 h-3.5 w-3.5" aria-hidden />
        </HudButton>
      )}
    </div>
  );
}
