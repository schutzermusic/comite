'use client';

/**
 * A PRÉ-ANÁLISE DO APEX, na tela.
 *
 * ─── O que este painel diz, e com que cuidado ──────────────────────────────
 *
 * Diz o que o Apex encontrou no documento comparado com as exigências REAIS
 * daquele marco — e diz, em toda parte, que isso não é aceite.
 *
 *   · "4/5 requisitos verificáveis atendidos" só aparece quando há
 *     denominador. "0/0" seria apresentar a ausência de análise como resultado.
 *   · INFORMAÇÃO NÃO LOCALIZADA é tom NEUTRO, não vermelho. Silêncio no papel
 *     não é negativa de fato, e pintá-lo de erro ensina a tratar os dois como
 *     a mesma coisa.
 *   · "Nunca analisado" é dito com essas palavras. Um painel vazio seria lido
 *     como "nada a apontar".
 */

import React, { useCallback, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, HelpCircle, ScanSearch, ShieldQuestion, Sparkles,
} from 'lucide-react';
import { HudBadge, HudButton, useHudToast } from '@/components/hud';
import { cn } from '@/lib/utils';
import {
  VERDICT_LABEL, VERDICT_TONE, groupFindings, preAnalysisHeadline, requiresHumanDecision,
  type PreAnalysisSummary, type PreAnalysisVerdict,
} from '@/lib/projects/measurements/preanalysis';
import { REQUIREMENT_KIND_LABEL } from '@/lib/projects/measurements/types';

const VERDICT_ICON: Record<PreAnalysisVerdict, React.ComponentType<{ className?: string }>> = {
  MET: CheckCircle2,
  NOT_MET: AlertTriangle,
  NOT_FOUND: HelpCircle,
  INCONSISTENT: AlertTriangle,
  NEEDS_HUMAN_REVIEW: ShieldQuestion,
};

const TONE_TEXT: Record<string, string> = {
  positive: 'text-ig-success',
  attention: 'text-ig-warning',
  critical: 'text-ig-danger',
  neutral: 'text-ig-fg-subtle',
};

export function MeasurementPreAnalysisPanel({
  measurementId, summary, canRun, onAnalyzed,
}: {
  readonly measurementId: string;
  readonly summary: PreAnalysisSummary | null;
  readonly canRun: boolean;
  readonly onAnalyzed: () => void;
}) {
  const { notify } = useHudToast();
  const [running, setRunning] = useState(false);

  const run = useCallback(async () => {
    setRunning(true);
    try {
      const res = await fetch(`/api/projects/measurements/${measurementId}/preanalysis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await res.json() as {
        ok: boolean; analyzed?: number; failures?: number; note?: string; error?: string;
      };
      if (!res.ok || !json.ok) {
        notify('A pré-análise não foi concluída', {
          description: json.error ?? 'Erro inesperado.', variant: 'error',
        });
        return;
      }
      if (json.note) {
        notify('Nada a pré-analisar', { description: json.note, variant: 'info' });
      } else {
        notify(`${json.analyzed ?? 0} documento(s) pré-analisado(s)`, {
          description: 'O parecer é insumo para decisão humana. Não valida evidência nem aceita a medição.',
          variant: (json.failures ?? 0) > 0 ? 'warning' : 'success',
        });
      }
      onAnalyzed();
    } catch (e) {
      notify('A pré-análise não foi concluída', {
        description: e instanceof Error ? e.message : String(e), variant: 'error',
      });
    } finally {
      setRunning(false);
    }
  }, [measurementId, notify, onAnalyzed]);

  const headline = summary ? preAnalysisHeadline(summary) : null;
  const groups = summary ? groupFindings(summary) : [];

  return (
    <section className="space-y-2 border-t border-ig-border-subtle pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ig-fg-muted">
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
          Pré-análise do Apex
        </h3>
        {canRun && (
          <HudButton
            variant="secondary"
            size="sm"
            isLoading={running}
            leftIcon={<ScanSearch className="h-4 w-4" />}
            onClick={() => void run()}
          >
            {summary?.analyzed ? 'Reanalisar pendentes' : 'Pré-analisar evidências'}
          </HudButton>
        )}
      </div>

      {!summary?.analyzed ? (
        /*
          A AUSÊNCIA, DITA. Sem esta frase, um painel vazio é lido como "o Apex
          conferiu e não achou nada" — que é o oposto do que aconteceu.
        */
        <p className="text-[12px] text-ig-fg-subtle">
          Nenhum documento desta medição foi pré-analisado ainda. A pré-análise compara o
          documento com as exigências contratuais deste evento — ela aponta o que falta e
          <strong className="font-medium"> não constitui aceite contratual</strong>.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {headline && (
              <HudBadge
                variant={summary.met === summary.verifiable && summary.verifiable > 0 ? 'success' : 'warning'}
                size="sm"
              >
                {headline}
              </HudBadge>
            )}
            {summary.inconsistent > 0 && (
              <HudBadge variant="danger" size="sm">{summary.inconsistent} inconsistência(s)</HudBadge>
            )}
            {summary.needsHumanReview > 0 && (
              <HudBadge variant="warning" size="sm">
                {summary.needsHumanReview} exige revisão humana
              </HudBadge>
            )}
            {summary.notFound > 0 && (
              <HudBadge variant="default" size="sm">
                {summary.notFound} informação(ões) não localizada(s)
              </HudBadge>
            )}
          </div>

          {requiresHumanDecision(summary) && (
            <p className="rounded border border-ig-warning/30 bg-ig-warning/5 px-2 py-1.5 text-[11px] text-ig-warning">
              O Apex não aprova inferência incerta. Os itens acima pedem decisão de uma pessoa
              antes de o pacote seguir para a Contratante.
            </p>
          )}

          <ul className="space-y-2">
            {groups.map((g) => (
              <li key={g.verdict}>
                <p className={cn('inline-flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide',
                  TONE_TEXT[VERDICT_TONE[g.verdict]])}>
                  {React.createElement(VERDICT_ICON[g.verdict], { className: 'h-3 w-3' })}
                  {VERDICT_LABEL[g.verdict]}
                </p>
                <ul className="mt-0.5 space-y-1 pl-4">
                  {g.findings.map((f) => (
                    <li key={f.requirementKind} className="text-[12px] text-ig-fg">
                      <span className="font-medium">{REQUIREMENT_KIND_LABEL[f.requirementKind]}</span>
                      {f.rationale ? <span className="text-ig-fg-muted"> — {f.rationale}</span> : null}
                      {/*
                        O trecho e a página são o que tornam o parecer conferível
                        em dez segundos. Sem eles, é opinião.
                      */}
                      {f.quote && (
                        <span className="mt-0.5 block border-l-2 border-ig-border-subtle pl-2 text-[11px] italic text-ig-fg-subtle">
                          “{f.quote}”{f.page ? ` (p. ${f.page})` : ''}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>

          <p className="text-[10px] text-ig-fg-subtle">
            Parecer de {summary.analyses} documento(s). A pré-análise não é aceite contratual, não
            valida evidência e não autoriza faturamento.
          </p>
        </>
      )}
    </section>
  );
}
