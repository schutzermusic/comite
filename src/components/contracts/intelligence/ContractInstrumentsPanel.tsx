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
 */

import { HudPanel, HudSignal } from '@/components/hud';
import { FileText, FileDiff, CircleDashed } from 'lucide-react';
import {
  SKIP_REASON_LABEL,
  declaresValueEffect,
  declaresTermEffect,
  type EffectiveContractState,
  type AmendmentStep,
} from '@/lib/contracts/trust/amendments';
import { hasOfficialValue, isError, type Official } from '@/lib/contracts/trust/trusted';

const currency = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

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
}: {
  official: Official<T>;
  format: (v: T) => string;
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
  return <span className="text-ig-fg-strong">{format(official.value)}</span>;
}

export function ContractInstrumentsPanel({
  masterTitle,
  masterNumber,
  state,
  onAddAmendment,
  onOpenAmendment,
  className,
}: {
  masterTitle: string;
  masterNumber: string;
  state: EffectiveContractState;
  onAddAmendment?: () => void;
  onOpenAmendment?: (step: AmendmentStep) => void;
  className?: string;
}) {
  const { timeline, unapplied } = state;
  const changed =
    hasOfficialValue(state.currentValue) && hasOfficialValue(state.originalValue)
      ? state.currentValue.value !== state.originalValue.value
      : false;

  return (
    <HudPanel
      title="Instrumentos contratuais"
      subtitle="Contrato mestre e aditivos, na ordem em que produzem efeito"
      icon={<FileDiff className="h-4 w-4" />}
      interactive={false}
      className={className}
      headerActions={
        onAddAmendment ? (
          <button
            type="button"
            onClick={onAddAmendment}
            className="rounded-[8px] border border-ig-border-strong px-2.5 py-1 text-ig-caption font-semibold text-ig-fg-strong transition-colors hover:bg-ig-panel-hover/60"
          >
            Adicionar aditivo
          </button>
        ) : undefined
      }
    >
      {/* ── Estado original vs. vigente ── */}
      <div className="mb-4 grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg border border-ig-border-subtle bg-ig-panel/55 p-3">
          <p className="text-ig-label text-ig-fg-subtle">Valor original</p>
          <p className="mt-1 text-ig-body-sm font-semibold">
            <OfficialText official={state.originalValue} format={(v) => currency(v)} />
          </p>
          <p className="mt-2 text-ig-label text-ig-fg-subtle">Valor vigente</p>
          <p className="mt-1 text-ig-body-sm font-semibold">
            <OfficialText official={state.currentValue} format={(v) => currency(v)} />
          </p>
        </div>
        <div className="rounded-lg border border-ig-border-subtle bg-ig-panel/55 p-3">
          <p className="text-ig-label text-ig-fg-subtle">Vigência original</p>
          <p className="mt-1 text-ig-body-sm font-semibold">
            <OfficialText official={state.originalEndDate} format={(v) => dateLabel(v)} />
          </p>
          <p className="mt-2 text-ig-label text-ig-fg-subtle">Vigência vigente</p>
          <p className="mt-1 text-ig-body-sm font-semibold">
            <OfficialText official={state.currentEndDate} format={(v) => dateLabel(v)} />
          </p>
        </div>
      </div>

      {unapplied.some((s) => s.skipReason === 'undated') && (
        <p className="mb-3 rounded-lg border border-[color-mix(in_oklab,var(--ig-warning)_30%,transparent)] bg-[color-mix(in_oklab,var(--ig-warning)_9%,transparent)] p-3 text-ig-caption text-ig-fg-muted">
          Há aditivo em vigor sem data de efeito registrada. Enquanto isso durar, o valor ou o prazo
          vigente permanece <strong>não apurado</strong>: aplicá-lo em ordem arbitrária produziria um
          número que parece confiável e não é.
        </p>
      )}

      {/* ── A cadeia ── */}
      <ol className="space-y-1.5" aria-label="Instrumentos contratuais">
        <li className="flex items-start gap-2.5 rounded-lg border border-ig-border-subtle bg-ig-panel/45 px-3 py-2.5">
          <FileText className="mt-0.5 h-4 w-4 shrink-0 text-ig-accent" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-ig-body-sm font-semibold text-ig-fg-strong">Contrato mestre</span>
              <span className="text-ig-label text-ig-fg-subtle">{masterNumber}</span>
            </span>
            <span className="mt-0.5 block truncate text-ig-caption text-ig-fg-muted">{masterTitle}</span>
          </span>
          {changed && (
            <HudSignal label="alterado" value="por aditivo" tone="info" size="sm" />
          )}
        </li>

        {timeline.map((step) => (
          <AmendmentRow key={step.amendment.id} step={step} onOpen={onOpenAmendment} />
        ))}
      </ol>

      {/*
        Três ausências distintas, três frases distintas. Dizer "nenhum aditivo
        registrado" quando a leitura falhou afirmaria sobre o contrato algo que
        ninguém verificou.
      */}
      {timeline.length === 0 && state.readFailed && (
        <p className="mt-3 text-ig-caption text-ig-warning">
          Falha ao ler os aditivos deste contrato. A lista está incompleta por incidente de leitura —
          não porque o contrato não tenha aditivos.
        </p>
      )}
      {timeline.length === 0 && state.notMeasured && (
        <p className="mt-3 text-ig-caption text-ig-fg-muted">
          Aditivos não consultados neste contexto.
        </p>
      )}
      {timeline.length === 0 && !state.readFailed && !state.notMeasured && (
        /*
          A ressalva fica visível: "nenhum aditivo registrado" lido sozinho
          afirma que não existem aditivos, que é justamente o que o dado não
          diz. Um guarda contra leitura errada não pode viver em hover.
        */
        <p className="mt-3 text-ig-caption text-ig-fg-muted">
          Nenhum aditivo registrado — o que não significa que não existam, e sim
          que nenhum foi registrado até agora.
        </p>
      )}
    </HudPanel>
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

  const body = (
    <>
      <CircleDashed
        className={`mt-0.5 h-4 w-4 shrink-0 ${step.applied ? 'text-ig-success' : 'text-ig-fg-subtle'}`}
        aria-hidden
      />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-ig-body-sm font-semibold text-ig-fg-strong">{a.amendment_number}</span>
          {a.title && <span className="truncate text-ig-caption text-ig-fg-muted">{a.title}</span>}
        </span>
        <span className="mt-0.5 block text-ig-caption text-ig-fg-muted">
          {a.effective_date
            ? `efeito em ${dateLabel(new Date(`${a.effective_date}T00:00:00`))}`
            : 'sem data de efeito'}
          {effects.length > 0 && ` · ${effects.join(' · ')}`}
        </span>
        {step.skipReason && (
          <span className="mt-0.5 block text-ig-caption text-ig-fg-subtle">
            {SKIP_REASON_LABEL[step.skipReason]}
          </span>
        )}
      </span>
      {step.applied && step.valueAfter !== null && (
        <span className="shrink-0 self-center text-ig-caption font-semibold text-ig-fg-strong">
          {currency(step.valueAfter)}
        </span>
      )}
    </>
  );

  return (
    <li className="ml-4">
      {onOpen ? (
        <button
          type="button"
          onClick={() => onOpen(step)}
          className="flex w-full items-start gap-2.5 rounded-lg border border-ig-border-subtle bg-ig-panel/45 px-3 py-2.5 text-left transition-colors hover:bg-ig-panel-hover/50"
        >
          {body}
        </button>
      ) : (
        <div className="flex w-full items-start gap-2.5 rounded-lg border border-ig-border-subtle bg-ig-panel/45 px-3 py-2.5">
          {body}
        </div>
      )}
    </li>
  );
}
