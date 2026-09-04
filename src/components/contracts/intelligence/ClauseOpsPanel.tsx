'use client';

/**
 * Operação da análise de cláusulas de um contrato: o estado de cada documento
 * e a cobertura por categoria.
 *
 * Responde duas perguntas que a fila de revisão sozinha não responde: "o que
 * ainda não foi lido?" e "de que o contrato ainda não tem cláusula validada?".
 *
 * A cobertura NÃO afirma que o contrato deveria ter as dez categorias. Ela
 * mostra o vocabulário inteiro e marca o que foi validado — decidir quais
 * categorias um contrato "deveria" ter exigiria padrão de carteira, que ainda
 * não existe e não pode ser fabricado.
 */

import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { pt } from 'date-fns/locale';
import {
  FileStack, AlertTriangle, Loader2, CircleCheck, CircleDashed, Layers, RotateCw,
} from 'lucide-react';
import { HudPanel } from '@/components/hud';
import { CLAUSE_CATEGORY_LABEL } from '@/lib/contracts/clause-categories';
import {
  LIFECYCLE_LABEL,
  type AnalysisLifecycle, type ContractCoverage, type DocumentAnalysisState,
} from '@/lib/contracts/trust/clause-operations';

const LIFECYCLE_STYLE: Record<AnalysisLifecycle, { icon: React.ReactNode; text: string; rail: string }> = {
  failed: {
    icon: <AlertTriangle className="h-3.5 w-3.5" aria-hidden />,
    text: 'text-ig-danger', rail: 'bg-ig-danger',
  },
  'proposals-available': {
    icon: <CircleDashed className="h-3.5 w-3.5" aria-hidden />,
    text: 'text-ig-warning', rail: 'bg-ig-warning',
  },
  'in-review': {
    icon: <CircleDashed className="h-3.5 w-3.5" aria-hidden />,
    text: 'text-ig-warning', rail: 'bg-ig-warning/70',
  },
  'not-analyzed': {
    icon: <CircleDashed className="h-3.5 w-3.5" aria-hidden />,
    text: 'text-ig-fg-subtle', rail: 'bg-ig-border-strong',
  },
  analyzing: {
    icon: <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />,
    text: 'text-ig-accent', rail: 'bg-ig-accent',
  },
  reviewed: {
    icon: <CircleCheck className="h-3.5 w-3.5" aria-hidden />,
    text: 'text-ig-success', rail: 'bg-ig-success',
  },
};

export interface ClauseOpsPanelProps {
  documents: readonly DocumentAnalysisState[];
  coverage: ContractCoverage;
  canAnalyze?: boolean;
  analyzingId?: string | null;
  onAnalyze?: (documentId: string) => void;
  className?: string;
}

export function ClauseOpsPanel({
  documents, coverage, canAnalyze = false, analyzingId = null, onAnalyze, className,
}: ClauseOpsPanelProps) {
  const current = documents.filter((d) => !d.superseded);
  const superseded = documents.filter((d) => d.superseded);

  return (
    <div className={cn('grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]', className)}>
      <HudPanel
        title="Análise documental"
        subtitle={documents.length === 0
          ? 'Nenhum documento anexado'
          : `${current.length} documento(s) vigente(s)${superseded.length ? ` · ${superseded.length} substituído(s)` : ''}`}
        icon={<FileStack className="h-4 w-4" />}
        interactive={false}
      >
        {documents.length === 0 ? (
          <p className="py-6 text-center text-ig-caption text-ig-fg-muted">
            Sem documento anexado não há o que analisar — e nenhuma cláusula pode ser proposta.
          </p>
        ) : (
          <ul className="space-y-2">
            {[...current, ...superseded].map((state) => {
              const style = LIFECYCLE_STYLE[state.lifecycle];
              const busy = analyzingId === state.documentId;
              return (
                <li
                  key={state.documentId}
                  className={cn(
                    'relative grid gap-3 overflow-hidden rounded-lg border p-3 md:grid-cols-[1fr_170px_auto] md:items-center',
                    state.superseded
                      ? 'border-dashed border-ig-border-strong opacity-70'
                      : 'border-ig-border-subtle bg-ig-panel/45',
                  )}
                >
                  <span className={cn('absolute inset-y-0 left-0 w-[2px]', style.rail)} aria-hidden />

                  <div className="min-w-0 pl-1.5">
                    <p className="truncate text-ig-body-sm font-semibold text-ig-fg-strong">
                      {state.documentTitle}
                      {state.version > 1 && (
                        <span className="ml-1.5 text-ig-label font-normal text-ig-fg-subtle">v{state.version}</span>
                      )}
                    </p>
                    <p className={cn('flex items-center gap-1.5 truncate text-ig-caption', style.text)}>
                      {style.icon}
                      {LIFECYCLE_LABEL[state.lifecycle]}
                      {state.superseded && (
                        <span className="text-ig-fg-subtle">· substituído por versão mais recente</span>
                      )}
                    </p>
                    {/* Falha silenciosa é pior que falha: o motivo fica à vista. */}
                    {state.errorMessage && (
                      <p className="mt-0.5 truncate text-ig-label text-ig-danger" title={state.errorMessage}>
                        {state.errorMessage}
                      </p>
                    )}
                  </div>

                  <div className="min-w-0">
                    {state.proposalsPending + state.proposalsValidated + state.proposalsRejected > 0 ? (
                      <p className="truncate text-ig-caption text-ig-fg-muted">
                        <span className="font-semibold text-ig-fg-strong">{state.proposalsPending}</span> pendente(s)
                        {' · '}{state.proposalsValidated} validada(s)
                        {state.proposalsRejected > 0 ? ` · ${state.proposalsRejected} rejeitada(s)` : ''}
                      </p>
                    ) : (
                      <p className="truncate text-ig-caption text-ig-fg-subtle">nenhuma proposta</p>
                    )}
                    {state.analysisAt && (
                      <p className="truncate text-ig-label text-ig-fg-subtle">
                        {format(new Date(state.analysisAt), 'dd/MM/yyyy HH:mm', { locale: pt })}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center justify-end">
                    {canAnalyze && onAnalyze && !state.superseded && (
                      <button
                        type="button"
                        disabled={busy || state.lifecycle === 'analyzing'}
                        onClick={() => onAnalyze(state.documentId)}
                        title={state.analysisId
                          ? 'Reanalisar: leituras idênticas não são duplicadas'
                          : 'Analisar documento'}
                        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-ig-border-subtle px-2.5 text-ig-label font-semibold text-ig-fg-muted transition-colors hover:border-ig-border-focus hover:text-ig-fg-strong disabled:opacity-50"
                      >
                        {busy
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                          : <RotateCw className="h-3.5 w-3.5" aria-hidden />}
                        {state.analysisId ? 'Reanalisar' : 'Analisar'}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </HudPanel>

      <HudPanel
        title="Cobertura por categoria"
        subtitle={coverage.coverageRatio === null
          ? 'Não apurável sem documento'
          : `${coverage.validatedCategories} de ${coverage.expectedCategories} com cláusula validada`}
        icon={<Layers className="h-4 w-4" />}
        interactive={false}
      >
        <ul className="space-y-1">
          {coverage.categories.map((cat) => (
            <li key={cat.category} className="flex items-center gap-2 py-0.5">
              <span
                className={cn(
                  'h-1.5 w-1.5 shrink-0 rounded-full',
                  cat.validated > 0 ? 'bg-ig-success' : cat.pending > 0 ? 'bg-ig-warning' : 'bg-ig-border-strong',
                )}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate text-ig-caption text-ig-fg-muted">
                {CLAUSE_CATEGORY_LABEL[cat.category]}
              </span>
              <span className={cn(
                'shrink-0 text-ig-label font-semibold',
                cat.validated > 0 ? 'text-ig-success' : cat.pending > 0 ? 'text-ig-warning' : 'text-ig-fg-subtle',
              )}>
                {cat.validated > 0
                  ? `${cat.validated} validada(s)`
                  : cat.pending > 0
                    ? `${cat.pending} pendente(s)`
                    : '—'}
              </span>
            </li>
          ))}
        </ul>

        {/*
          A ressalva que impede a leitura errada da coluna: ausência aqui não
          é lacuna do contrato, pode ser lacuna de revisão — ou a categoria
          simplesmente não existir naquele contrato.
        */}
        <p className="mt-2.5 border-t border-ig-border-subtle pt-2 text-ig-caption text-ig-fg-subtle">
          O vocabulário é o mesmo para todos os contratos. Categoria sem cláusula validada pode
          significar revisão pendente ou ausência real no contrato — este painel não distingue as duas,
          porque distinguir exigiria um padrão de carteira que ainda não existe.
        </p>
      </HudPanel>
    </div>
  );
}
