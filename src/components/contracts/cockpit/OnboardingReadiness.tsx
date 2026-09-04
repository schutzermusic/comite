'use client';

/**
 * Prontidão de entrada — o que já foi registrado neste contrato e o que falta.
 *
 * O painel é informativo, nunca acusatório. Nenhum passo pendente recebe tom
 * de perigo, nenhum aparece em vermelho e não há nota de conformidade: um
 * contrato sem obrigações registradas não está em falta com coisa alguma —
 * pode simplesmente não ter obrigações a acompanhar. A escolha de cor É a
 * decisão de produto aqui, e alarme sobre ausência legítima ensina a equipe a
 * registrar linha vazia só para apagar alerta.
 *
 * Toda a lógica vive em `trust/onboarding.ts`, testável sem DOM. Este arquivo
 * só desenha.
 */

import { HudPanel, HudSignal } from '@/components/hud';
import { Check, CircleDashed, Minus, TriangleAlert, HelpCircle } from 'lucide-react';
import type {
  OnboardingReadiness as Readiness,
  OnboardingStep,
  OnboardingStepKey,
  OnboardingStepState,
} from '@/lib/contracts/trust/onboarding';

const STATE_LOOK: Record<OnboardingStepState, {
  icon: React.ReactNode;
  /** Cor do ícone. Pendente é NEUTRO de propósito — ausência não é alarme. */
  className: string;
  label: string;
}> = {
  complete: { icon: <Check className="h-3.5 w-3.5" />, className: 'text-ig-success', label: 'Registrado' },
  pending: { icon: <CircleDashed className="h-3.5 w-3.5" />, className: 'text-ig-fg-subtle', label: 'A registrar' },
  unknown: { icon: <HelpCircle className="h-3.5 w-3.5" />, className: 'text-ig-fg-subtle', label: 'Não apurado' },
  errored: { icon: <TriangleAlert className="h-3.5 w-3.5" />, className: 'text-ig-warning', label: 'Leitura falhou' },
  not_applicable: { icon: <Minus className="h-3.5 w-3.5" />, className: 'text-ig-fg-subtle', label: 'Não se aplica' },
};

export function OnboardingReadinessPanel({
  readiness,
  onNavigate,
}: {
  readiness: Readiness;
  onNavigate?: (key: OnboardingStepKey) => void;
}) {
  const { steps, essentialComplete, essentialTotal, operable, hasErrors } = readiness;

  return (
    <HudPanel
      title="Prontidão do contrato"
      subtitle="O que já está registrado"
      interactive={false}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <HudSignal
          label="Essencial"
          value={`${essentialComplete}/${essentialTotal}`}
          tone={operable ? 'success' : 'neutral'}
          size="sm"
        />
        {/*
          A frase inteira virou `title`. A regra que ela protege — ausência de
          registro não é irregularidade — continua dita, sem ocupar duas linhas
          em todo contrato da carteira.
        */}
        <span
          className="text-ig-caption text-ig-fg-muted"
          title="Ausência aqui não é irregularidade: indica registro pendente, não descumprimento."
        >
          {operable ? 'Essencial registrado — contrato plenamente operável' : 'Falta registrar o essencial'}
        </span>
      </div>

      {hasErrors && (
        <p
          className="mb-3 text-ig-caption text-ig-warning"
          title="A lista está incompleta por falha de leitura, não por ausência de registro."
        >
          Alguma relação não pôde ser lida.
        </p>
      )}

      {/*
        A lista é nomeada: "Obrigações" e "Riscos" também aparecem em Operações
        conectadas, e sem esta âncora qualquer seletor por texto casa com o
        painel errado.
      */}
      <ul className="space-y-1" aria-label="Prontidão do contrato">
        {steps.map((step) => (
          <StepRow key={step.key} step={step} onNavigate={onNavigate} />
        ))}
      </ul>
    </HudPanel>
  );
}

function StepRow({
  step,
  onNavigate,
}: {
  step: OnboardingStep;
  onNavigate?: (key: OnboardingStepKey) => void;
}) {
  const look = STATE_LOOK[step.state];
  const clickable = Boolean(onNavigate);

  const body = (
    <>
      <span className={`mt-0.5 shrink-0 ${look.className}`} aria-hidden>{look.icon}</span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-ig-body-sm font-semibold text-ig-fg-strong">{step.label}</span>
          {step.essential && (
            <span className="text-ig-label uppercase tracking-[0.12em] text-ig-fg-subtle">essencial</span>
          )}
          <span className="text-ig-label uppercase tracking-[0.12em] text-ig-fg-subtle">· {step.owner}</span>
        </span>
        {step.detail && (
          <span className="mt-0.5 block text-ig-caption text-ig-fg-muted">{step.detail}</span>
        )}
      </span>
      <span className="shrink-0 self-center text-ig-label uppercase tracking-[0.12em] text-ig-fg-subtle">
        {look.label}
      </span>
    </>
  );

  return (
    <li>
      {clickable ? (
        <button
          type="button"
          onClick={() => onNavigate?.(step.key)}
          className="flex w-full items-start gap-2.5 rounded-lg border border-ig-border-subtle bg-ig-panel/45 px-3 py-2 text-left transition-colors hover:bg-ig-panel-hover/50"
        >
          {body}
        </button>
      ) : (
        <div className="flex w-full items-start gap-2.5 rounded-lg border border-ig-border-subtle bg-ig-panel/45 px-3 py-2">
          {body}
        </div>
      )}
    </li>
  );
}
