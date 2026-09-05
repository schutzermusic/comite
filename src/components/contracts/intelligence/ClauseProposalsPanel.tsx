'use client';

/**
 * Fila de revisão de cláusulas propostas por análise documental.
 *
 * A decisão de desenho: **a evidência é o elemento central**, não a proposta.
 * O que ocupa mais espaço em cada item é o trecho literal do contrato e a
 * página onde ele está — porque a única pergunta que o revisor precisa
 * responder é "o documento diz isso mesmo?". A estruturação da máquina é o
 * secundário; ela existe para ser conferida contra o papel.
 *
 * Por isso não há card de IA, selo brilhante ou linguagem de assistente. Há um
 * trecho de contrato, uma página, e três decisões.
 */

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { pt } from 'date-fns/locale';
import {
  FileSearch, Quote, Check, X, Pencil, AlertTriangle, ChevronDown, ChevronRight,
} from 'lucide-react';
import { HudPanel, HudButton } from '@/components/hud';
import {
  CLAUSE_REVIEW_LABEL,
  type ContractClauseRow, type ContractDocumentRow,
} from '@/lib/contracts/contract-service';
import { CLAUSE_CATEGORY_LABEL, type ClauseCategory } from '@/lib/contracts/clause-categories';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

const categoryLabel = (type: string | null): string =>
  (type && CLAUSE_CATEGORY_LABEL[type as ClauseCategory]) || type || 'categoria não informada';

/** Confiança é do modelo sobre a leitura, não sobre a importância da cláusula. */
function confidenceTone(value: number): { label: string; tone: string } {
  if (value >= 0.85) return { label: 'leitura clara', tone: 'text-ig-success' };
  if (value >= 0.6) return { label: 'leitura provável', tone: 'text-ig-warning' };
  return { label: 'leitura duvidosa', tone: 'text-ig-danger' };
}

function effect(clause: ContractClauseRow): string | null {
  const parts: string[] = [];
  const amount = clause.amount === null ? null : Number(clause.amount);
  const pct = clause.percentage === null ? null : Number(clause.percentage);
  if (amount !== null && Number.isFinite(amount)) parts.push(BRL.format(amount));
  if (pct !== null && Number.isFinite(pct)) parts.push(`${pct}%`);
  if (clause.term_days !== null) parts.push(`${clause.term_days} dia(s)`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

export interface ClauseProposalsPanelProps {
  proposals: readonly ContractClauseRow[];
  documents: readonly ContractDocumentRow[];
  canEdit?: boolean;
  canAnalyze?: boolean;
  analyzing?: boolean;
  onAnalyze?: (documentId: string) => void;
  onValidate?: (clause: ContractClauseRow) => void;
  onReject?: (clause: ContractClauseRow) => void;
  onEdit?: (clause: ContractClauseRow) => void;
  className?: string;
}

export function ClauseProposalsPanel({
  proposals, documents, canEdit = false, canAnalyze = false, analyzing = false,
  onAnalyze, onValidate, onReject, onEdit, className,
}: ClauseProposalsPanelProps) {
  const [selectedDoc, setSelectedDoc] = useState('');
  const pdfDocuments = documents.filter((d) => d.file_path.toLowerCase().endsWith('.pdf'));

  return (
    <HudPanel
      title="Cláusulas propostas para revisão"
      subtitle={proposals.length > 0
        ? `${proposals.length} proposta(s) aguardando decisão humana`
        : 'Nenhuma proposta pendente'}
      icon={<FileSearch className="h-4 w-4" />}
      interactive={false}
      className={className}
    >
      <div className="space-y-4">
        {/* Disparo da análise — atrelado a um documento, sempre. */}
        {canAnalyze && onAnalyze && (
          <div className="rounded-[14px] border border-ig-border-subtle bg-ig-panel/45 p-3">
            <p className="text-ig-body-sm font-semibold text-ig-fg-strong">Analisar documento</p>
            <p className="mt-0.5 text-ig-caption text-ig-fg-muted">
              A leitura propõe cláusulas estruturadas a partir do PDF. Toda proposta cita a página e o
              trecho de origem; o que não tem evidência no documento é descartado antes de chegar aqui.
            </p>
            {pdfDocuments.length === 0 ? (
              <p className="mt-2 text-ig-caption text-ig-fg-subtle">
                Nenhum documento PDF anexado a este contrato. A análise lê do documento — sem ele, não há o que ler.
              </p>
            ) : (
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <select
                  value={selectedDoc}
                  onChange={(e) => setSelectedDoc(e.target.value)}
                  aria-label="Documento a analisar"
                  className="h-9 min-w-[220px] rounded-lg border border-ig-border-subtle bg-ig-panel px-3 text-ig-body-sm text-ig-fg-strong"
                >
                  <option value="">Selecione um documento…</option>
                  {pdfDocuments.map((d) => (
                    <option key={d.id} value={d.id}>{d.title}</option>
                  ))}
                </select>
                <HudButton
                  variant="secondary"
                  size="sm"
                  disabled={!selectedDoc || analyzing}
                  isLoading={analyzing}
                  onClick={() => selectedDoc && onAnalyze(selectedDoc)}
                >
                  {analyzing ? 'Lendo documento…' : 'Extrair cláusulas'}
                </HudButton>
              </div>
            )}
          </div>
        )}

        {proposals.length === 0 ? (
          <p className="py-4 text-center text-ig-caption text-ig-fg-muted">
            Nenhuma cláusula proposta aguardando decisão.
          </p>
        ) : (
          <ul className="space-y-2">
            {proposals.map((clause) => (
              <ProposalItem
                key={clause.id}
                clause={clause}
                documents={documents}
                canEdit={canEdit}
                onValidate={onValidate}
                onReject={onReject}
                onEdit={onEdit}
              />
            ))}
          </ul>
        )}
      </div>
    </HudPanel>
  );
}

function ProposalItem({
  clause, documents, canEdit, onValidate, onReject, onEdit,
}: {
  clause: ContractClauseRow;
  documents: readonly ContractDocumentRow[];
  canEdit: boolean;
  onValidate?: (clause: ContractClauseRow) => void;
  onReject?: (clause: ContractClauseRow) => void;
  onEdit?: (clause: ContractClauseRow) => void;
}) {
  const [open, setOpen] = useState(false);
  const confidence = clause.ai_confidence === null ? null : Number(clause.ai_confidence);
  const tone = confidence === null ? null : confidenceTone(confidence);
  const document = documents.find((d) => d.id === clause.source_document_id);
  const contractEffect = effect(clause);

  /**
   * Um humano já mexeu no estruturado? Então há duas versões, e a comparação
   * deixa de ser opcional: é o registro de que a pessoa concluiu diferente da
   * máquina.
   */
  const edited =
    (clause.ai_proposed_title !== null && clause.ai_proposed_title !== clause.title)
    || (clause.ai_proposed_content !== null && clause.ai_proposed_content !== clause.content);

  return (
    <li className="overflow-hidden rounded-[14px] border border-ig-border-subtle bg-ig-panel/45">
      <div className="flex flex-wrap items-start gap-3 px-3.5 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-ig-body-sm font-semibold text-ig-fg-strong">{clause.title}</p>
          <p className="truncate text-ig-caption text-ig-fg-muted">
            {categoryLabel(clause.clause_type)}
            {contractEffect ? ` · ${contractEffect}` : ''}
            {` · risco ${clause.risk_level}`}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {tone && (
            <span className={cn('text-ig-label font-semibold', tone.tone)} title={`Confiança do modelo: ${(confidence! * 100).toFixed(0)}%`}>
              {tone.label}
            </span>
          )}
          <span className="rounded-full border border-ig-border-strong px-2 py-px text-ig-label font-semibold text-ig-fg-muted">
            {CLAUSE_REVIEW_LABEL[clause.review_status]}
          </span>
        </div>
      </div>

      {/*
        A EVIDÊNCIA. Ocupa a maior superfície do item de propósito: é contra o
        trecho que a decisão é tomada, não contra o resumo da máquina.
      */}
      <div className="border-t border-ig-border-subtle bg-[color-mix(in_oklab,var(--ig-accent)_4%,transparent)] px-3.5 py-3">
        <div className="flex items-center gap-2 text-ig-label font-semibold text-ig-fg-muted">
          <Quote className="h-3 w-3" aria-hidden />
          Trecho do contrato
          <span className="ml-auto normal-case tracking-normal text-ig-fg-subtle">
            {document ? document.title : 'documento não localizado'}
            {clause.source_page ? ` · p. ${clause.source_page}` : ''}
          </span>
        </div>
        <blockquote className="mt-1.5 border-l-2 border-ig-accent/50 pl-3 text-ig-body-sm italic text-ig-fg-strong">
          {clause.source_excerpt ?? 'Trecho não registrado'}
        </blockquote>
        {clause.ai_proposed_at && (
          <p className="mt-1.5 text-ig-label text-ig-fg-subtle">
            Lido por {clause.ai_model ?? 'modelo não identificado'} em{' '}
            {format(new Date(clause.ai_proposed_at), "dd/MM/yyyy 'às' HH:mm", { locale: pt })}
          </p>
        )}
      </div>

      {/* Comparação proposta × estruturado vigente. */}
      {(clause.content || edited) && (
        <div className="border-t border-ig-border-subtle px-3.5 py-2">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex w-full items-center gap-1.5 text-ig-caption font-medium text-ig-fg-muted transition-colors hover:text-ig-fg-strong"
          >
            {open ? <ChevronDown className="h-3.5 w-3.5" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden />}
            {edited ? 'Comparar leitura da máquina com o texto validado' : 'Ver estruturação proposta'}
            {edited && (
              <span className="ml-1 rounded-full border border-ig-warning/45 px-1.5 text-ig-label font-semibold text-ig-warning">
                editado por pessoa
              </span>
            )}
          </button>

          {open && (
            <div className={cn('mt-2 grid gap-2', edited && 'md:grid-cols-2')}>
              <div className="rounded-lg border border-dashed border-ig-border-strong px-3 py-2">
                <p className="text-ig-label font-semibold text-ig-fg-subtle">
                  Proposto pela leitura
                </p>
                <p className="mt-1 text-ig-caption text-ig-fg-muted">
                  {clause.ai_proposed_title ?? clause.title}
                </p>
                <p className="mt-1 text-ig-caption text-ig-fg-subtle">
                  {clause.ai_proposed_content ?? clause.content ?? 'sem resumo'}
                </p>
              </div>
              {edited && (
                <div className="rounded-lg border border-ig-border-subtle px-3 py-2">
                  <p className="text-ig-label font-semibold text-ig-fg-muted">
                    Estruturado vigente
                  </p>
                  <p className="mt-1 text-ig-caption text-ig-fg-strong">{clause.title}</p>
                  <p className="mt-1 text-ig-caption text-ig-fg-muted">{clause.content ?? 'sem resumo'}</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {canEdit && (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-ig-border-subtle px-3.5 py-2.5">
          <p className="mr-auto flex items-center gap-1.5 text-ig-label text-ig-fg-subtle">
            <AlertTriangle className="h-3 w-3 shrink-0 text-ig-warning" aria-hidden />
            Proposta não vale como cláusula até ser validada.
          </p>
          {onEdit && (
            <button
              type="button"
              onClick={() => onEdit(clause)}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-ig-border-subtle px-2.5 text-ig-label font-semibold text-ig-fg-muted transition-colors hover:border-ig-border-focus hover:text-ig-fg-strong"
            >
              <Pencil className="h-3.5 w-3.5" /> Corrigir
            </button>
          )}
          {onReject && (
            <button
              type="button"
              onClick={() => onReject(clause)}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-ig-border-subtle px-2.5 text-ig-label font-semibold text-ig-fg-muted transition-colors hover:border-ig-danger/50 hover:text-ig-danger"
            >
              <X className="h-3.5 w-3.5" /> Rejeitar
            </button>
          )}
          {onValidate && (
            <button
              type="button"
              onClick={() => onValidate(clause)}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-ig-success/45 px-2.5 text-ig-label font-semibold text-ig-success transition-colors hover:bg-[color-mix(in_oklab,var(--ig-success)_10%,transparent)]"
            >
              <Check className="h-3.5 w-3.5" /> Validar
            </button>
          )}
        </div>
      )}
    </li>
  );
}
