'use client';

/**
 * Inteligência Contratual — a leitura do Apex sobre o contrato do cliente.
 *
 * ─── O que este painel substitui ───────────────────────────────────────────
 *
 * "Cláusulas propostas para revisão — 47 propostas aguardando decisão humana."
 *
 * Essa tela dizia três coisas erradas de uma vez: que o Apex propôs a cláusula
 * (não propôs — o cliente escreveu e assinou), que nada valia até alguém
 * validar (a cláusula vale desde a assinatura), e que havia 47 unidades de
 * trabalho humano à espera (havia 2, e as outras 45 as escondiam).
 *
 * ─── A anatomia de um item ─────────────────────────────────────────────────
 *
 * Cada cartão separa VISUALMENTE quatro camadas, porque elas têm autoridades
 * diferentes e misturá-las é o defeito que este refactor existe para corrigir:
 *
 *   1. FONTE CONTRATUAL — o trecho literal e a página. Verdade documental.
 *   2. INTERPRETAÇÃO DO APEX — o que a máquina entendeu. Derivado.
 *   3. IMPACTO OPERACIONAL — o que isso faz o sistema monitorar.
 *   4. ATENÇÃO — só quando a política de exceção pede uma decisão.
 *
 * A camada 4 é a única que traz botões. Um cartão sem ela não pede nada de
 * ninguém: ele informa.
 */

import { useState } from 'react';
import { cn } from '@/lib/utils';
import {
  Quote, ScanSearch, ChevronDown, ChevronRight, AlertTriangle, Check, X, Eye,
} from 'lucide-react';
import { HudPanel, HudButton } from '@/components/hud';
import type { ContractClauseRow, ContractDocumentRow } from '@/lib/contracts/contract-service';
import { CLAUSE_CATEGORY_LABEL, type ClauseCategory } from '@/lib/contracts/clause-categories';
import {
  ATTENTION_REASON_ASK, ATTENTION_REASON_LABEL, interpretationDisclosure,
  type AttentionReason, type InterpretationState,
} from '@/lib/contracts/intelligence/attention-policy';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

const categoryLabel = (type: string | null): string =>
  (type && CLAUSE_CATEGORY_LABEL[type as ClauseCategory]) || type || 'categoria não informada';

/**
 * O efeito contratual em números — só o que está escrito no trecho.
 *
 * `null` nunca vira zero: zero significaria multa de 0% ou prazo de 0 dias, e
 * as duas coisas são afirmações que ninguém fez.
 */
function operationalEffect(clause: ContractClauseRow): string[] {
  const parts: string[] = [];
  const amount = clause.amount === null ? null : Number(clause.amount);
  const pct = clause.percentage === null ? null : Number(clause.percentage);
  if (amount !== null && Number.isFinite(amount)) parts.push(`Valor: ${BRL.format(amount)}`);
  if (pct !== null && Number.isFinite(pct)) parts.push(`Percentual: ${pct}%`);
  if (clause.term_days !== null) parts.push(`Prazo: ${clause.term_days} dia(s)`);
  return parts;
}

export type InterpretationDecision = 'confirm' | 'dismiss' | 'acknowledge';

export interface ContractInterpretationPanelProps {
  interpretations: readonly ContractClauseRow[];
  documents: readonly ContractDocumentRow[];
  canDecide?: boolean;
  canAnalyze?: boolean;
  analyzing?: boolean;
  onAnalyze?: (documentId: string) => void;
  onDecide?: (clause: ContractClauseRow, decision: InterpretationDecision) => void;
  onOpenSource?: (clause: ContractClauseRow) => void;
  className?: string;
}

export function ContractInterpretationPanel({
  interpretations, documents, canDecide = false, canAnalyze = false, analyzing = false,
  onAnalyze, onDecide, onOpenSource, className,
}: ContractInterpretationPanelProps) {
  const [selectedDoc, setSelectedDoc] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const pdfDocuments = documents.filter((d) => d.file_path.toLowerCase().endsWith('.pdf'));

  const needingAttention = interpretations.filter(
    (c) => c.interpretation_state === 'requires_attention');
  const structured = interpretations.filter(
    (c) => c.interpretation_state !== 'requires_attention');

  const toggle = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <HudPanel
      title="Inteligência Contratual"
      /*
        O subtítulo conta o que o Apex FEZ, e só depois o que sobrou para uma
        pessoa. A ordem importa: começar por "N itens pendentes" faria a
        leitura inteira parecer uma dívida.
      */
      subtitle={
        interpretations.length === 0
          ? 'Nenhuma interpretação estruturada ainda'
          : needingAttention.length === 0
            ? `${interpretations.length} regra(s) contratual(is) estruturada(s) — nada requer sua atenção`
            : `${interpretations.length} regra(s) estruturada(s) · ${needingAttention.length} requer(em) sua atenção`
      }
      icon={<ScanSearch className="h-4 w-4" />}
      interactive={false}
      className={className}
      data-testid="contract-interpretation-panel"
    >
      <div className="space-y-4">
        {canAnalyze && onAnalyze && (
          <div className="rounded-[14px] border border-ig-border-subtle bg-ig-panel/45 p-3">
            <p className="text-ig-body-sm font-semibold text-ig-fg-strong">Ler um documento contratual</p>
            <p className="mt-0.5 text-ig-caption text-ig-fg-muted">
              O Apex lê o PDF original e estrutura as regras que ele já contém. Toda interpretação cita a
              página e o trecho de origem; o que não se confere no documento é descartado antes de chegar aqui.
            </p>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <select
                value={selectedDoc}
                onChange={(event) => setSelectedDoc(event.target.value)}
                className="h-9 min-w-[220px] rounded-md border border-ig-border-default bg-ig-bg-base px-2 text-ig-body-sm text-ig-fg-strong"
              >
                <option value="">Selecione o documento</option>
                {pdfDocuments.map((doc) => (
                  <option key={doc.id} value={doc.id}>{doc.title}</option>
                ))}
              </select>
              <HudButton
                variant="secondary"
                size="sm"
                disabled={!selectedDoc || analyzing}
                onClick={() => selectedDoc && onAnalyze(selectedDoc)}
              >
                {analyzing ? 'Lendo…' : 'Ler documento'}
              </HudButton>
            </div>
          </div>
        )}

        {/* ── 1. O que requer decisão. Sempre primeiro, sempre curto. ── */}
        {needingAttention.length > 0 && (
          <section aria-label="Requer sua atenção" data-testid="interpretation-attention">
            <h3 className="mb-2 flex items-center gap-2 text-ig-body-sm font-semibold text-ig-warning">
              <AlertTriangle className="h-4 w-4" />
              {needingAttention.length === 1
                ? '1 item requer sua atenção'
                : `${needingAttention.length} itens requerem sua atenção`}
            </h3>
            <div className="space-y-3">
              {needingAttention.map((clause) => (
                <InterpretationCard
                  key={clause.id}
                  clause={clause}
                  expanded={expanded.has(clause.id)}
                  onToggle={() => toggle(clause.id)}
                  canDecide={canDecide}
                  onDecide={onDecide}
                  onOpenSource={onOpenSource}
                />
              ))}
            </div>
          </section>
        )}

        {/* ── 2. O que o Apex já estruturou. Acervo, não fila. ── */}
        {structured.length > 0 && (
          <section aria-label="Estruturado pelo Apex" data-testid="interpretation-structured">
            <h3 className="mb-2 text-ig-body-sm font-semibold text-ig-fg-strong">
              Estruturado pelo Apex
              <span className="ml-2 font-normal text-ig-caption text-ig-fg-muted">
                em operação, sem pendência de decisão
              </span>
            </h3>
            <div className="space-y-2">
              {structured.map((clause) => (
                <InterpretationCard
                  key={clause.id}
                  clause={clause}
                  expanded={expanded.has(clause.id)}
                  onToggle={() => toggle(clause.id)}
                  canDecide={false}
                  onOpenSource={onOpenSource}
                  compact
                />
              ))}
            </div>
          </section>
        )}

        {interpretations.length === 0 && (
          <p className="rounded-lg border border-ig-border-subtle p-4 text-center text-ig-caption text-ig-fg-muted">
            Nenhum documento deste contrato foi lido ainda, ou nenhuma regra com evidência suficiente
            foi encontrada. Ausência de regra é informação — não uma lacuna a preencher à mão.
          </p>
        )}
      </div>
    </HudPanel>
  );
}

function InterpretationCard({
  clause, expanded, onToggle, canDecide, onDecide, onOpenSource, compact = false,
}: {
  clause: ContractClauseRow;
  expanded: boolean;
  onToggle: () => void;
  canDecide: boolean;
  onDecide?: (clause: ContractClauseRow, decision: InterpretationDecision) => void;
  onOpenSource?: (clause: ContractClauseRow) => void;
  compact?: boolean;
}) {
  const state = (clause.interpretation_state ?? 'structured') as InterpretationState;
  const reasons = (clause.attention_reasons ?? []) as AttentionReason[];
  const effects = operationalEffect(clause);
  const needsAttention = state === 'requires_attention';

  return (
    <article
      className={cn(
        'rounded-xl border bg-ig-panel/45',
        needsAttention ? 'border-ig-warning/45' : 'border-ig-border-subtle',
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-start gap-2 p-3 text-left"
      >
        {expanded
          ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-ig-fg-muted" />
          : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-ig-fg-muted" />}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-ig-body-sm font-semibold text-ig-fg-strong">
            {clause.title}
          </span>
          <span className="mt-0.5 block text-ig-caption text-ig-fg-muted">
            {categoryLabel(clause.clause_type)}
            {clause.source_page !== null && ` · p. ${clause.source_page} do contrato`}
          </span>
        </span>
        {needsAttention && (
          <span className="shrink-0 rounded-full border border-ig-warning/45 px-2 py-0.5 text-[10px] text-ig-warning">
            Requer atenção
          </span>
        )}
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-ig-border-subtle p-3">
          {/* ── 1. FONTE CONTRATUAL ── */}
          <section>
            <h4 className="mb-1 text-ig-label uppercase tracking-wide text-ig-fg-subtle">
              Fonte contratual
            </h4>
            {clause.source_excerpt ? (
              <blockquote className="flex gap-2 rounded-lg border-l-2 border-ig-accent/60 bg-ig-bg-base/40 p-2.5">
                <Quote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ig-fg-subtle" aria-hidden />
                <p className="text-ig-caption italic text-ig-fg-default">{clause.source_excerpt}</p>
              </blockquote>
            ) : (
              <p className="text-ig-caption text-ig-fg-muted">
                Registro manual: não há trecho de documento associado.
              </p>
            )}
            {onOpenSource && clause.source_document_id && (
              <HudButton
                variant="ghost"
                size="sm"
                leftIcon={<Eye className="h-3.5 w-3.5" />}
                className="mt-1.5"
                onClick={() => onOpenSource(clause)}
              >
                Ver no documento original
              </HudButton>
            )}
          </section>

          {/* ── 2. INTERPRETAÇÃO DO APEX ── */}
          <section>
            <h4 className="mb-1 text-ig-label uppercase tracking-wide text-ig-fg-subtle">
              Interpretação do Apex
            </h4>
            <p className="text-ig-caption text-ig-fg-default">
              {clause.content?.trim() || 'Sem leitura estruturada registrada.'}
            </p>
            <p className="mt-1 text-[11px] text-ig-fg-subtle">{interpretationDisclosure(state)}</p>
          </section>

          {/* ── 3. IMPACTO OPERACIONAL ── */}
          {effects.length > 0 && (
            <section>
              <h4 className="mb-1 text-ig-label uppercase tracking-wide text-ig-fg-subtle">
                Impacto operacional
              </h4>
              <ul className="flex flex-wrap gap-1.5">
                {effects.map((effect) => (
                  <li
                    key={effect}
                    className="rounded-full border border-ig-border px-2 py-0.5 text-[11px] text-ig-fg-default"
                  >
                    {effect}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* ── 4. ATENÇÃO — só quando a política pede ── */}
          {needsAttention && reasons.length > 0 && (
            <section className="rounded-lg border border-ig-warning/35 bg-ig-warning/5 p-2.5">
              <h4 className="mb-1.5 text-ig-label uppercase tracking-wide text-ig-warning">
                Por que isto precisa de você
              </h4>
              <ul className="space-y-1">
                {reasons.map((reason) => (
                  <li key={reason} className="text-ig-caption text-ig-fg-default">
                    <span className="font-semibold">{ATTENTION_REASON_LABEL[reason]}</span>
                    {' — '}
                    {ATTENTION_REASON_ASK[reason]}
                  </li>
                ))}
              </ul>
              {canDecide && onDecide && (
                <div className="mt-2.5 flex flex-wrap gap-2">
                  <HudButton
                    variant="secondary" size="sm" leftIcon={<Eye className="h-3.5 w-3.5" />}
                    onClick={() => onDecide(clause, 'acknowledge')}
                  >
                    Ciente — seguir operando
                  </HudButton>
                  <HudButton
                    variant="primary" size="sm" leftIcon={<Check className="h-3.5 w-3.5" />}
                    onClick={() => onDecide(clause, 'confirm')}
                  >
                    Confirmar interpretação
                  </HudButton>
                  <HudButton
                    variant="ghost" size="sm" leftIcon={<X className="h-3.5 w-3.5" />}
                    onClick={() => onDecide(clause, 'dismiss')}
                  >
                    Descartar
                  </HudButton>
                </div>
              )}
            </section>
          )}

          {!compact && clause.attention_resolution_note && (
            <p className="text-[11px] text-ig-fg-subtle">
              Decisão registrada: {clause.attention_resolution_note}
            </p>
          )}
        </div>
      )}
    </article>
  );
}
