'use client';

/**
 * O que a tela mostra enquanto o Apex está lendo um contrato.
 *
 * ─── O defeito que este componente existe para corrigir ────────────────────
 *
 * A análise de um contrato inteiro leva minutos, e o dossiê mostrava apenas um
 * ícone girando ao lado da palavra "Analisando". Um giro sem tempo decorrido e
 * sem fim previsível é indistinguível de uma tela travada: o usuário não sabe
 * se espera, se recarrega, ou se algo morreu há meia hora. Recarregar, então,
 * reiniciava o giro — reforçando a impressão de que nada havia acontecido.
 *
 * ─── O que ele afirma, e com base em quê ───────────────────────────────────
 *
 * Só o que está PERSISTIDO. O tempo decorrido vem de `started_at`, gravado pela
 * execução; a etapa vem do `kind` da análise viva. Nada aqui é calculado a
 * partir da montagem do componente, e é por isso que sair da página e voltar
 * mostra o mesmo relógio que ficou correndo — porque o relógio nunca foi do
 * componente.
 *
 * ─── O que ele NUNCA mostra ────────────────────────────────────────────────
 *
 * Contagem regressiva, porcentagem, número de páginas processadas, previsão de
 * término. A duração de uma leitura destas não é determinística, e um "faltam
 * 02:00" que chega a zero com o trabalho ainda em curso não é uma estimativa
 * imprecisa: é uma afirmação falsa, e a próxima coisa que o usuário faz é
 * concluir que o sistema quebrou. Tempo decorrido é verdade observável;
 * tempo restante, aqui, não seria.
 *
 * Também não mostra provedor, modelo, fila ou identificador de trabalho. Quem
 * lê um contrato precisa saber o que vai existir no dossiê quando isto
 * terminar, não por qual infraestrutura passou.
 */

import { useEffect, useState } from 'react';
import { Loader2, CircleCheck, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  LONGER_THAN_USUAL_MS, STAGE_DESCRIPTION, STAGE_STEPS,
  elapsedSince, formatElapsed, type AnalysisStage,
} from '@/lib/contracts/trust/clause-operations';

/*
  Nada de lógica aqui. Formato do decorrido, limiar de "mais que o habitual" e
  rótulos de etapa vivem em `trust/clause-operations.ts`, que é puro e testável
  sem DOM — o vitest deste repositório roda em `node`, e uma regra que só possa
  ser verificada renderizando React é uma regra que não será verificada.
*/

export interface ContractAnalysisProgressProps {
  /** Início persistido da execução — `contract_ai_analyses.started_at`. */
  readonly startedAt: string | null;
  readonly stage: AnalysisStage | null;
  readonly className?: string;
}

export function ContractAnalysisProgress({
  startedAt, stage, className,
}: ContractAnalysisProgressProps) {
  /*
    O relógio de parede, e só ele. `now` é o que se move; o início continua
    sendo o valor persistido. Trocar isto por um contador incremental faria o
    número depender de quanto tempo a aba ficou aberta, e não de quanto tempo a
    análise está rodando.
  */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const elapsedMs = elapsedSince(startedAt, now);
  const steps = stage ? STAGE_STEPS[stage] : null;
  const longerThanUsual =
    stage !== null && elapsedMs !== null && elapsedMs >= LONGER_THAN_USUAL_MS[stage];

  return (
    <div
      className={cn(
        'rounded-lg border border-ig-border-subtle bg-ig-panel/45 p-3.5',
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <p className="flex items-center gap-2 text-ig-body-sm font-semibold text-ig-fg-strong">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-ig-accent" aria-hidden />
        Analisando contrato
      </p>

      {stage && (
        <p className="mt-1 pl-6 text-ig-caption text-ig-fg-muted">
          {STAGE_DESCRIPTION[stage]}
        </p>
      )}

      {steps && (
        <ul className="mt-2.5 space-y-1 pl-6">
          <li className="flex items-center gap-1.5 text-ig-caption text-ig-fg-muted">
            <CircleCheck className="h-3.5 w-3.5 shrink-0 text-ig-success" aria-hidden />
            {steps.done}
          </li>
          <li className="flex items-center gap-1.5 text-ig-caption text-ig-accent">
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
            {steps.active}
          </li>
        </ul>
      )}

      {elapsedMs !== null && (
        <p className="mt-2.5 flex items-center gap-1.5 pl-6 text-ig-caption text-ig-fg-subtle">
          <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {/*
            `data-testid` porque este número é a afirmação central do
            componente: que o tempo mostrado é o tempo real da execução, e não
            o tempo desta aba.
          */}
          Tempo decorrido: <span data-testid="analysis-elapsed">{formatElapsed(elapsedMs)}</span>
        </p>
      )}

      <div className="mt-2.5 border-t border-ig-border-subtle pt-2 pl-6">
        {longerThanUsual ? (
          <p className="text-ig-caption text-ig-fg-muted">
            A análise está levando mais tempo que o habitual. O Apex continua
            processando o contrato — você pode sair desta página e voltar depois.
          </p>
        ) : (
          <p className="text-ig-caption text-ig-fg-subtle">
            Esta análise pode levar alguns minutos. Você pode sair desta página:
            o processamento continua em segundo plano.
          </p>
        )}
      </div>
    </div>
  );
}
