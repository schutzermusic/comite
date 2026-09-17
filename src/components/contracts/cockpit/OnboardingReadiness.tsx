'use client';

/**
 * Readiness is registration coverage, not compliance. Pending setup is amber;
 * unknown stays slate. Completed steps remain available in a compact disclosure.
 * All states come from trust/onboarding.ts.
 */

import { DossierDisclosure } from '../shell/DossierPrimitives';
import { cn } from '@/lib/utils';
import {
  Check, CircleDashed, Minus, TriangleAlert, HelpCircle, ChevronRight, ListChecks,
} from 'lucide-react';
import type {
  OnboardingReadiness as Readiness,
  OnboardingStep,
  OnboardingStepKey,
  OnboardingStepState,
} from '@/lib/contracts/trust/onboarding';

/** Tom da linha. `idle` = sem leitura, e sem severidade. */
type StepTone = 'success' | 'warning' | 'idle' | 'off';

const STATE_LOOK: Record<OnboardingStepState, {
  icon: React.ReactNode;
  /** Amber indicates setup to register; it never asserts a breach. */
  tone: StepTone;
  label: string;
}> = {
  complete:       { icon: <Check className="h-3.5 w-3.5" />,         tone: 'success', label: 'Registrado' },
  pending:        { icon: <CircleDashed className="h-3.5 w-3.5" />,  tone: 'warning', label: 'A registrar' },
  unknown:        { icon: <HelpCircle className="h-3.5 w-3.5" />,    tone: 'idle',    label: 'Não apurado' },
  errored:        { icon: <TriangleAlert className="h-3.5 w-3.5" />, tone: 'warning', label: 'Leitura falhou' },
  not_applicable: { icon: <Minus className="h-3.5 w-3.5" />,         tone: 'off',     label: 'Não se aplica' },
};

export function OnboardingReadinessPanel({
  readiness,
  onNavigate,
  className,
}: {
  readiness: Readiness;
  onNavigate?: (key: OnboardingStepKey) => void;
  className?: string;
}) {
  const { steps, essentialComplete, essentialTotal, operable, hasErrors } = readiness;
  const essentials = steps.filter((s) => s.essential);

  return (
    <section className={cn('ig-lp', className)} aria-labelledby="ig-readiness-title">
      {/* ── Cabeçalho ──────────────────────────────────────────────── */}
      <header className="ig-lp-head flex items-start gap-3 px-4 pb-3 pt-4 sm:px-5">
        <span className="ig-lp-mark" aria-hidden>
          <ListChecks className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 id="ig-readiness-title" className="text-ig-body-sm font-semibold text-ig-fg-strong">
            Prontidão do contrato
          </h3>
          <p className="mt-0.5 text-ig-caption leading-relaxed text-ig-fg-muted">
            Base documental e configuração operacional.
          </p>
        </div>
      </header>

      {/* ── Régua do essencial ─────────────────────────────────────────
          O número é a resposta do painel, e por isso tem porte de métrica.
          O medidor ao lado mostra QUAIS essenciais — um contador sozinho diz
          "faltam dois" sem dizer dois de quê. */}
      <div className="ig-lp-rule flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 sm:px-5">
        <div className="flex items-baseline gap-2">
          <span className="text-ig-label uppercase tracking-[0.14em] text-ig-fg-muted">
            Essencial
          </span>
          <span
            className={cn(
              'ig-tabular text-ig-h3 font-semibold leading-none',
              operable ? 'text-ig-success' : 'text-ig-fg-strong',
            )}
          >
            {essentialComplete}<span className="text-ig-fg-subtle">/{essentialTotal}</span>
          </span>
        </div>

        {essentials.length > 0 && (
          <div
            className="ig-lp-meter w-[88px] shrink-0"
            role="img"
            aria-label={`${essentialComplete} de ${essentialTotal} passos essenciais registrados`}
          >
            {essentials.map((step) => (
              <i
                key={step.key}
                data-on={
                  step.state === 'complete' ? 'assessed'
                    : step.state === 'errored' ? 'attention'
                      : undefined
                }
              />
            ))}
          </div>
        )}

        {/*
          A regra fica como texto visível: "ausência de registro não é
          irregularidade" governa a leitura do painel inteiro, e uma regra
          dessas não pode depender de hover — no toque ela não existiria.
        */}
        {/*
          "Contrato plenamente operável" era um VEREDITO, e esta contagem não
          o sustenta: ela mede três passos de cadastro — identidade, projeto,
          documento — e nada sobre obrigações, faturamento ou risco. A frase
          aparecia intacta ao lado de itens em atenção no mesmo painel, o que
          é a contradição mais cara que uma tela de governança pode cometer:
          afirmar saúde com a autoridade de um resumo.

          O que os três passos atestam é a BASE. A frase agora diz isso e
          para aí.
        */}
        <p className="min-w-0 flex-1 text-ig-caption font-medium text-ig-fg-default sm:text-right">
          {operable
            ? 'Base essencial do contrato registrada'
            : 'Falta registrar a base essencial do contrato'}
        </p>
      </div>

      {hasErrors && (
        <p
          className="ig-lp-notice mx-4 mt-3 px-3 py-2 text-ig-caption leading-relaxed text-ig-fg-muted sm:mx-5"
          title="A lista está incompleta por falha de leitura, não por ausência de registro."
        >
          Alguma relação não pôde ser lida — a lista abaixo está incompleta por
          incidente de leitura, não por ausência de registro.
        </p>
      )}

      {/*
        A lista é nomeada: "Obrigações" e "Riscos" também aparecem em Operações
        conectadas, e sem esta âncora qualquer seletor por texto casa com o
        painel errado.
      */}
      <ul className="px-1.5 py-1.5" aria-label="Prontidão do contrato">
        {steps.filter((step) => step.state !== 'complete').map((step) => (
          <StepRow key={step.key} step={step} onNavigate={onNavigate} />
        ))}
      </ul>
      {steps.some((step) => step.state === 'complete') && (
        <DossierDisclosure title="Já registrado" count={steps.filter((step) => step.state === 'complete').length}>
          <ul>{steps.filter((step) => step.state === 'complete').map((step) => <StepRow key={step.key} step={step} onNavigate={onNavigate} />)}</ul>
        </DossierDisclosure>
      )}
    </section>
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
      <span className="ig-lp-glyph" data-tone={look.tone} aria-hidden>
        {look.icon}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-ig-body-sm font-semibold text-ig-fg-strong">{step.label}</span>
          {step.essential && (
            <span className="ig-lp-tag text-ig-label font-semibold" data-tone="accent">
              essencial
            </span>
          )}
          <span className="text-ig-label text-ig-fg-muted">{step.owner}</span>
        </span>
        {step.detail && (
          <span className="mt-0.5 block text-ig-caption leading-relaxed text-ig-fg-default">
            {step.detail}
          </span>
        )}
      </span>

      {/*
        Largura fixa: sem ela a coluna de estado dança entre "Registrado" e
        "Não se aplica", e a varredura vertical — que é o uso real deste
        painel — deixa de existir.
      */}
      <span
        className="ig-lp-state w-[92px] self-center text-ig-caption font-medium"
        data-tone={look.tone}
      >
        <i aria-hidden />
        {look.label}
      </span>

      {clickable && (
        <ChevronRight className="ig-lp-go h-3.5 w-3.5 shrink-0 self-center" aria-hidden />
      )}
    </>
  );

  const shell = cn(
    'flex w-full items-start gap-3 rounded-[9px] px-3 py-2.5 text-left',
    clickable && 'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ig-border-focus',
  );
  /* O trilho de estado só aparece onde há estado a marcar. */
  const rowTone = look.tone === 'success' ? 'success' : look.tone === 'warning' ? 'warning' : undefined;

  return (
    <li className="ig-lp-row" data-tone={rowTone} data-interactive={clickable ? 'true' : undefined}>
      {clickable ? (
        <button type="button" onClick={() => onNavigate?.(step.key)} className={shell}>
          {body}
        </button>
      ) : (
        <div className={shell}>{body}</div>
      )}
    </li>
  );
}
