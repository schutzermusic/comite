'use client';

/**
 * Instrumentos Contratuais — o contrato mestre e seus aditivos, em ordem.
 *
 * A seção existe para responder três perguntas que hoje se confundem numa só:
 * o que o contrato dizia ORIGINALMENTE, o que cada aditivo MUDOU, e o que vale
 * HOJE. Exibir apenas o último apagaria a trilha; exibir apenas o primeiro
 * mentiria sobre o presente.
 *
 * O valor e o prazo vigentes só aparecem quando puderam ser derivados. Quando
 * há aditivo em vigor cujo efeito não pôde ser aplicado — tipicamente por falta
 * de data de efeito —, o painel diz que não sabe, e diz por quê. Um total
 * calculado ignorando um aditivo pareceria correto e estaria errado.
 *
 * ─── O desenho ─────────────────────────────────────────────────────────────
 *
 * Três dobras, na ordem em que a pergunta é feita:
 *
 *   1 · SÍNTESE — original → vigente, lado a lado, com a seta entre os dois.
 *       O par é a informação; dois números soltos em linhas diferentes
 *       obrigavam o leitor a fazer a comparação de cabeça.
 *   2 · CADEIA — o mestre como PRIMEIRO ELO de uma linhagem governada, e cada
 *       aditivo pendurado nele por um fio. A hierarquia do documento vira
 *       geometria: um nó preenchido no mestre, nós menores nos instrumentos
 *       que o modificam.
 *   3 · RESSALVAS — o que a lista não afirma, em texto, fora de hover.
 *
 * O que saiu: o `HudPanel` de vidro com caixas `bg-ig-panel/45` por linha —
 * branco a 45% sobre branco, uma moldura cinza por instrumento e nenhuma
 * indicação de que um deles governa os outros.
 */

import { cn } from '@/lib/utils';
import { FileText, FileDiff, CircleDashed, Plus, ArrowRight, Check } from 'lucide-react';
import { deriveAmendmentEffectiveness } from '@/lib/contracts/amendments/ai-types';
import type { ContractAmendmentIngestionRequestRow } from '@/lib/contracts/contract-service';
import {
  SKIP_REASON_LABEL,
  declaresValueEffect,
  declaresTermEffect,
  type EffectiveContractState,
  type AmendmentStep,
} from '@/lib/contracts/trust/amendments';
import { hasOfficialValue, isError, type Official } from '@/lib/contracts/trust/trusted';
import { formatContractCurrency } from '@/lib/contracts/trust/format';

/*
  Instrumentos são documentais: o valor exibido aqui É o valor do papel, e
  arredondá-lo apresenta um número que o instrumento não contém.
*/
const currency = (n: number) => formatContractCurrency(n);

const dateLabel = (d: Date) => d.toLocaleDateString('pt-BR');

/**
 * Renderiza um `Official`, dizendo por que não sabe quando não sabe.
 *
 * Genérico em `T`: uma união `Official<number> | Official<Date>` faria o
 * compilador exigir que o formatador aceitasse os dois, e a única forma de
 * satisfazê-lo seria com `never` — que apaga justamente a checagem que torna
 * este componente seguro.
 */
function OfficialText<T>({
  official,
  format,
  strong = false,
}: {
  official: Official<T>;
  format: (v: T) => string;
  /** O vigente é a resposta do painel; o original é a referência. */
  strong?: boolean;
}) {
  if (isError(official)) {
    return <span className="text-ig-warning">indisponível</span>;
  }
  if (!hasOfficialValue(official)) {
    return (
      <span className="text-ig-fg-muted" title={official.trust === 'missing' ? official.note : undefined}>
        não apurado
      </span>
    );
  }
  return (
    <span className={cn('ig-tabular', strong ? 'text-ig-fg-strong' : 'text-ig-fg-default')}>
      {format(official.value)}
    </span>
  );
}

/**
 * Uma dobra da síntese: o que o papel original dizia → o que vale hoje.
 *
 * Os dois ficam na MESMA célula, separados por um fio tracejado e ligados por
 * uma seta. Quando o vigente difere do original, a seta acende em acento — é
 * a única marca de que um aditivo produziu efeito, e ela precisa estar onde a
 * comparação acontece.
 */
function EffectPair<T>({
  title,
  originalLabel,
  currentLabel,
  original,
  current,
  format,
  changed,
}: {
  title: string;
  originalLabel: string;
  currentLabel: string;
  original: Official<T>;
  current: Official<T>;
  format: (v: T) => string;
  changed: boolean;
}) {
  return (
    <div className="ig-lp-tile px-3.5 py-3">
      <p className="flex items-center gap-2 text-ig-label uppercase tracking-[0.12em] text-ig-fg-muted">
        {title}
        {changed && (
          <span className="ig-lp-tag text-ig-label font-semibold" data-tone="accent">
            alterado por aditivo
          </span>
        )}
      </p>

      <div className="mt-2 flex items-baseline justify-between gap-2">
        <span className="text-ig-caption text-ig-fg-muted">{originalLabel}</span>
        <span className="text-ig-body-sm font-medium">
          <OfficialText official={original} format={format} />
        </span>
      </div>

      <div className="ig-lp-tile-split mt-2 flex items-baseline justify-between gap-2 pt-2">
        <span className="flex items-center gap-1.5 text-ig-caption text-ig-fg-muted">
          <ArrowRight
            className={cn('h-3 w-3 shrink-0', changed ? 'text-ig-accent' : 'text-ig-fg-subtle')}
            aria-hidden
          />
          {currentLabel}
        </span>
        <span className="text-ig-body-sm font-semibold">
          <OfficialText official={current} format={format} strong />
        </span>
      </div>
    </div>
  );
}

export function ContractInstrumentsPanel({
  masterTitle,
  masterNumber,
  state,
  onAddAmendment,
  onOpenAmendment,
  className,
  ingestionRequests = [],
}: {
  masterTitle: string;
  masterNumber: string;
  state: EffectiveContractState;
  onAddAmendment?: () => void;
  onOpenAmendment?: (step: AmendmentStep) => void;
  className?: string;
  ingestionRequests?: readonly ContractAmendmentIngestionRequestRow[];
}) {
  const { timeline, unapplied } = state;
  const changed =
    hasOfficialValue(state.currentValue) && hasOfficialValue(state.originalValue)
      ? state.currentValue.value !== state.originalValue.value
      : false;
  const termChanged =
    hasOfficialValue(state.currentEndDate) && hasOfficialValue(state.originalEndDate)
      ? state.currentEndDate.value.getTime() !== state.originalEndDate.value.getTime()
      : false;

  const pending = ingestionRequests.filter((request) => !request.amendment_id);

  return (
    <section className={cn('ig-lp', className)} aria-labelledby="ig-instruments-title">
      <header className="ig-lp-head flex flex-wrap items-start gap-3 px-4 pb-3 pt-4 sm:px-5">
        <span className="ig-lp-mark" aria-hidden>
          <FileDiff className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 id="ig-instruments-title" className="text-ig-body-sm font-semibold text-ig-fg-strong">
            Instrumentos contratuais
          </h3>
          <p className="mt-0.5 text-ig-caption leading-relaxed text-ig-fg-muted">
            Contrato mestre e aditivos, na ordem de efeito.
          </p>
        </div>
        {onAddAmendment && (
          <button
            type="button"
            onClick={onAddAmendment}
            className="ig-lp-action px-2.5 py-1 text-ig-caption font-semibold"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Adicionar aditivo
          </button>
        )}
      </header>

      {/* ── 1 · Síntese: o que o papel dizia → o que vale hoje ─────────── */}
      <div className="ig-lp-rule grid gap-2.5 px-4 py-3.5 sm:grid-cols-2 sm:px-5">
        <EffectPair
          title="Valor"
          originalLabel="Valor original"
          currentLabel="Valor vigente"
          original={state.originalValue}
          current={state.currentValue}
          format={(v: number) => currency(v)}
          changed={changed}
        />
        <EffectPair
          title="Vigência"
          originalLabel="Vigência original"
          currentLabel="Vigência vigente"
          original={state.originalEndDate}
          current={state.currentEndDate}
          format={(v: Date) => dateLabel(v)}
          changed={termChanged}
        />
      </div>

      {unapplied.some((s) => s.skipReason === 'undated') && (
        <p className="ig-lp-notice mx-4 mt-3 px-3 py-2.5 text-ig-caption leading-relaxed text-ig-fg-muted sm:mx-5">
          Há aditivo em vigor sem data de efeito registrada. Enquanto isso durar, o valor ou o prazo
          vigente permanece <strong className="font-semibold text-ig-fg-strong">não apurado</strong>:
          aplicá-lo em ordem arbitrária produziria um número que parece confiável e não é.
        </p>
      )}

      {/* ── 2 · A cadeia ───────────────────────────────────────────────── */}
      <ol className="ig-lp-chain px-3 py-2.5 sm:px-4" aria-label="Instrumentos contratuais">
        <li className="flex items-start gap-3 px-1 py-2">
          <span className="ig-lp-node" data-tone="master" aria-hidden>
            <FileText className="h-3.5 w-3.5" />
          </span>
          <span className="min-w-0 flex-1 pt-0.5">
            <span className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-ig-body-sm font-semibold text-ig-fg-strong">Contrato mestre</span>
              <span className="ig-tabular text-ig-caption font-medium text-ig-accent">{masterNumber}</span>
              <span className="ig-lp-tag text-ig-label font-semibold" data-tone="accent">instrumento base</span>
            </span>
            <span className="mt-0.5 block truncate text-ig-caption text-ig-fg-default">{masterTitle}</span>
          </span>
          {changed && (
            <span className="ig-lp-tag shrink-0 self-center text-ig-label font-semibold">
              alterado por aditivo
            </span>
          )}
        </li>

        {timeline.map((step) => (
          <AmendmentRow key={step.amendment.id} step={step} onOpen={onOpenAmendment} />
        ))}

        {pending.map((request) => (
          <li key={request.id} className="flex items-start gap-3 px-1 py-2">
            <span
              className="ig-lp-node"
              data-tone={request.status === 'FAILED' ? 'warning' : undefined}
              aria-hidden
            >
              <CircleDashed
                className={cn('h-3.5 w-3.5', request.status !== 'FAILED' && 'animate-pulse text-ig-accent')}
              />
            </span>
            <span className="min-w-0 flex-1 pt-0.5">
              <span className="text-ig-body-sm font-semibold text-ig-fg-strong">Aditivo em análise</span>
              <span className="mt-0.5 block text-ig-caption leading-relaxed text-ig-fg-muted">
                {request.status === 'FAILED'
                  ? `Leitura falhou · ${request.error_safe ?? 'o PDF permanece registrado para nova tentativa'}`
                  : request.status === 'REQUIRES_ATTENTION' ? 'Requer atenção'
                    : 'Apex processando o documento canônico'}
              </span>
            </span>
          </li>
        ))}
      </ol>

      {/* ── 3 · O que a lista NÃO afirma ───────────────────────────────── */}
      {/*
        Três ausências distintas, três frases distintas. Dizer "nenhum aditivo
        registrado" quando a leitura falhou afirmaria sobre o contrato algo que
        ninguém verificou.
      */}
      {timeline.length === 0 && state.readFailed && (
        <p className="ig-lp-notice mx-4 mb-3.5 px-3 py-2.5 text-ig-caption leading-relaxed text-ig-fg-muted sm:mx-5">
          Falha ao ler os aditivos deste contrato. A lista está incompleta por incidente de leitura —
          não porque o contrato não tenha aditivos.
        </p>
      )}
      {timeline.length === 0 && state.notMeasured && (
        <p
          className="ig-lp-notice mx-4 mb-3.5 px-3 py-2.5 text-ig-caption leading-relaxed text-ig-fg-muted sm:mx-5"
          data-tone="neutral"
        >
          Aditivos não consultados neste contexto.
        </p>
      )}
      {timeline.length === 0 && ingestionRequests.length === 0 && !state.readFailed && !state.notMeasured && (
        /*
          A ressalva fica visível: "nenhum aditivo registrado" lido sozinho
          afirma que não existem aditivos, que é justamente o que o dado não
          diz. Um guarda contra leitura errada não pode viver em hover.
        */
        <p
          className="ig-lp-notice mx-4 mb-3.5 px-3 py-2.5 text-ig-caption leading-relaxed text-ig-fg-muted sm:mx-5"
          data-tone="neutral"
        >
          Nenhum aditivo registrado — o que não significa que não existam, e sim
          que nenhum foi registrado até agora.
        </p>
      )}
    </section>
  );
}

function AmendmentRow({
  step,
  onOpen,
}: {
  step: AmendmentStep;
  onOpen?: (step: AmendmentStep) => void;
}) {
  const a = step.amendment;
  const effects: string[] = [];

  if (declaresValueEffect(a)) {
    const delta = a.value_delta === null ? null : Number(a.value_delta);
    const absolute = a.value_absolute === null ? null : Number(a.value_absolute);
    if (absolute !== null) effects.push(`valor passa a ${currency(absolute)}`);
    else if (delta !== null) effects.push(`${delta >= 0 ? '+' : ''}${currency(delta)}`);
  }
  if (declaresTermEffect(a)) {
    if (a.new_end_date) effects.push(`vigência até ${dateLabel(new Date(`${a.new_end_date}T00:00:00`))}`);
    else if (a.term_extension_days) effects.push(`+${a.term_extension_days} dias`);
  }
  if (a.scope_change) effects.push('altera escopo');
  const documentaryState = a.documentary_state ?? (a.status === 'signed' || a.status === 'active' ? 'signed' : a.status === 'draft' ? 'draft' : 'unknown');
  const effectiveness = deriveAmendmentEffectiveness({
    documentaryState,
    effectiveDate: a.effective_date,
    cancelled: a.status === 'cancelled',
  });
  const documentaryLabel = documentaryState === 'signed' ? 'assinado' : documentaryState === 'draft' ? 'rascunho' : 'estado documental desconhecido';
  const effectivenessLabel = effectiveness === 'effective' ? 'em vigor'
    : effectiveness === 'not_yet_effective' ? 'efeito futuro'
      : effectiveness === 'cancelled' ? 'cancelado' : 'eficácia indeterminada';

  /*
    O nó carrega o estado do ELO, não o do documento: aplicado (o efeito já
    entrou no vigente) contra ainda não aplicado. É a única coisa que o olho
    precisa distinguir ao descer a cadeia.
  */
  const nodeTone = step.applied ? 'applied' : undefined;
  const effectivenessTone = effectiveness === 'effective' ? 'success'
    : effectiveness === 'cancelled' ? undefined
      : 'warning';

  const body = (
    <>
      <span className="ig-lp-node" data-tone={nodeTone} aria-hidden>
        {step.applied
          ? <Check className="h-3.5 w-3.5" />
          : <CircleDashed className="h-3.5 w-3.5" />}
      </span>

      <span className="min-w-0 flex-1 pt-0.5">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="ig-tabular text-ig-body-sm font-semibold text-ig-fg-strong">
            {a.amendment_number}
          </span>
          {a.title && <span className="truncate text-ig-caption text-ig-fg-muted">{a.title}</span>}
        </span>

        <span className="mt-0.5 block text-ig-caption leading-relaxed text-ig-fg-default">
          {a.effective_date
            ? `efeito em ${dateLabel(new Date(`${a.effective_date}T00:00:00`))}`
            : 'sem data de efeito'}
          {effects.length > 0 && ` · ${effects.join(' · ')}`}
        </span>

        {/* Metadado documental como carimbo: lê-se de relance, não como frase. */}
        <span className="mt-1 flex flex-wrap items-center gap-1">
          <span className="ig-lp-tag text-ig-label font-semibold">{documentaryLabel}</span>
          <span className="ig-lp-tag text-ig-label font-semibold" data-tone={effectivenessTone}>
            {effectivenessLabel}
          </span>
          {a.analysis_state && (
            <span className="ig-lp-tag text-ig-label font-semibold">
              análise {a.analysis_state.replace('_', ' ')}
            </span>
          )}
          {(a.attention_count ?? 0) > 0 && (
            <span className="ig-lp-tag text-ig-label font-semibold" data-tone="warning">
              {a.attention_count} ponto(s) de atenção
            </span>
          )}
        </span>

        {step.skipReason && (
          <span className="mt-1 block text-ig-caption text-ig-fg-muted">
            {SKIP_REASON_LABEL[step.skipReason]}
          </span>
        )}
      </span>

      {step.applied && step.valueAfter !== null && (
        <span className="ig-tabular shrink-0 self-center text-ig-caption font-semibold text-ig-fg-strong">
          {currency(step.valueAfter)}
        </span>
      )}
    </>
  );

  return (
    <li>
      {onOpen ? (
        <button
          type="button"
          onClick={() => onOpen(step)}
          className="ig-lp-row flex w-full items-start gap-3 rounded-[9px] px-1 py-2 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ig-border-focus"
          data-interactive="true"
        >
          {body}
        </button>
      ) : (
        <div className="flex w-full items-start gap-3 px-1 py-2">{body}</div>
      )}
    </li>
  );
}
