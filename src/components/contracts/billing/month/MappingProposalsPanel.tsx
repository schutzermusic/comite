'use client';

/**
 * A FILA DE REVISÃO das propostas de mapeamento marco ↔ cronograma.
 *
 * ─── Por que esta fila existe ─────────────────────────────────────────────
 *
 * A data prevista de faturamento de um marco vem do cronograma do projeto —
 * mas só através de uma ponte que alguém ACEITOU. Sem esta tela, a proposta
 * automática nascia e morria invisível, e a única forma de governar o vínculo
 * era um comando no banco.
 *
 * ─── Por que aceitar é um botão, e não um padrão ──────────────────────────
 *
 * Aceitar define a data de faturamento de um valor contratual. A confiança do
 * sistema ordena a fila e nada mais: nem o 0,95 é aceito sozinho. Propostas
 * AMBÍGUAS aparecem marcadas, e a confiança delas já vem rebaixada pelo
 * matcher exatamente para não subirem ao topo com cara de certeza.
 */

import { useState } from 'react';
import { Check, X, Loader2, AlertTriangle, Link2 } from 'lucide-react';
import { createClient } from '@/utils/supabase/client';
import type { MappingProposalRow } from '@/lib/contracts/billing/planning/month-plan-service';
import { PROPOSAL_HIGH_CONFIDENCE } from '@/lib/contracts/billing/planning/milestone-timeline-matcher';
import { PlanChip } from './PlanChip';

interface Props {
  readonly proposals: readonly MappingProposalRow[];
  readonly canReview: boolean;
  readonly milestoneTitle: (ruleId: string) => string;
  readonly timelineTitle: (timelineItemId: string) => string;
  readonly contractLabel: (contractId: string) => string;
  readonly onReviewed: () => void;
  readonly onNotify: (message: string, variant: 'success' | 'error') => void;
}

export function MappingProposalsPanel({
  proposals, canReview, milestoneTitle, timelineTitle, contractLabel,
  onReviewed, onNotify,
}: Props) {
  const [busyId, setBusyId] = useState<string | null>(null);

  if (proposals.length === 0) {
    return (
      <p className="py-4 text-center text-ig-caption text-ig-fg-muted">
        Nenhuma proposta de mapeamento pendente. Marcos com ponte já aceita
        recebem a data do cronograma automaticamente.
      </p>
    );
  }

  const review = async (id: string, decision: 'accepted' | 'rejected') => {
    setBusyId(id);
    try {
      const { error } = await createClient().rpc('contract_measurement_rule_timeline_review', {
        p_mapping_id: id,
        p_decision: decision,
      });
      if (error) throw new Error(error.message);
      onNotify(
        decision === 'accepted'
          ? 'Mapeamento aceito — a data do cronograma passa a alimentar a previsão.'
          : 'Proposta rejeitada.',
        'success',
      );
      onReviewed();
    } catch (e) {
      onNotify(e instanceof Error ? e.message : 'Falha ao revisar a proposta.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-2">
      <p className="dossier-meta">
        {proposals.length} proposta(s) do sistema aguardando revisão. Nenhuma delas alimenta a
        previsão antes de ser aceita.
      </p>
      {proposals.map((p) => {
        const confidence = p.confidence ?? 0;
        const highConfidence = confidence >= PROPOSAL_HIGH_CONFIDENCE;
        return (
          <div
            key={p.id}
            className="grid gap-3 rounded-lg border border-ig-border-subtle bg-ig-panel/45 p-3 md:grid-cols-[1fr_auto_auto] md:items-center"
          >
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-1.5 text-ig-body-sm text-ig-fg-strong">
                <span className="font-semibold">{milestoneTitle(p.ruleId)}</span>
                <Link2 className="h-3.5 w-3.5 text-ig-fg-muted" aria-hidden />
                <span>{timelineTitle(p.timelineItemId)}</span>
              </p>
              <p className="dossier-meta">
                {contractLabel(p.contractId)} · {p.projectId}
              </p>
              {p.note && <p className="mt-1 text-ig-caption text-ig-fg-muted">{p.note}</p>}
            </div>

            <PlanChip
              tone={highConfidence ? 'accent' : 'attention'}
              dashed={!highConfidence}
              title={highConfidence
                ? 'Alta confiança — conferência rápida. Continua exigindo aceite humano.'
                : 'Confiança baixa ou casamento ambíguo — requer atenção.'}
            >
              {highConfidence ? 'Conferência rápida' : 'Requer atenção'}
              {' · '}
              {Math.round(confidence * 100)}%
            </PlanChip>

            {canReview ? (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  className="portfolio-action"
                  disabled={busyId === p.id}
                  onClick={() => review(p.id, 'accepted')}
                >
                  {busyId === p.id
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    : <Check className="h-3.5 w-3.5" aria-hidden />}
                  Aceitar
                </button>
                <button
                  type="button"
                  className="portfolio-action"
                  disabled={busyId === p.id}
                  onClick={() => review(p.id, 'rejected')}
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                  Rejeitar
                </button>
              </div>
            ) : (
              <span className="dossier-meta flex items-center gap-1">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                Sem permissão para revisar
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
