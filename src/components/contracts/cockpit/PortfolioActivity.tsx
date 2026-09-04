'use client';

/**
 * Atividade recente da carteira — de `audit_logs`, a fonte autoritativa.
 *
 * Existe para ocupar com INFORMAÇÃO o espaço que sobrava sob a prontidão
 * operacional. A distinção importa: o vazio não foi preenchido com uma métrica
 * inventada nem com um gráfico de ocasião — foi preenchido com o registro real
 * do que aconteceu na carteira, que é exatamente o tipo de coisa que alguém
 * abrindo o módulo quer saber e que já estava gravada sem ser lida aqui.
 *
 * Sem atividade, o painel encolhe para uma linha em vez de manter uma moldura
 * grande e vazia: uma carteira recém-criada não tem histórico, e isso não é
 * uma falha a ser disfarçada com altura.
 */

import { cn } from '@/lib/utils';
import { History, ArrowRight, AlertTriangle } from 'lucide-react';
import { auditActionLabel } from '@/lib/contracts/audit-labels';
import type { ContractAuditEventRow } from '@/lib/contracts/contract-service';

export type PortfolioActivityEvent = ContractAuditEventRow & { entity_id: string };

/** Distância em linguagem natural, curta. */
function ago(iso: string, now: Date): string {
  const ms = now.getTime() - new Date(iso).getTime();
  const min = Math.round(ms / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  if (d < 30) return `há ${d} d`;
  return new Date(iso).toLocaleDateString('pt-BR');
}

export interface PortfolioActivityProps {
  events: readonly PortfolioActivityEvent[];
  error?: string | null;
  /** Código do contrato por id, para nomear cada linha. */
  codeById: Map<string, string>;
  onOpenContract?: (contractId: string) => void;
  /** Abre a trilha completa do contrato mais recente, quando há um. */
  onOpenAudit?: (contractId: string) => void;
  max?: number;
  className?: string;
  now?: Date;
}

export function PortfolioActivity({
  events, error, codeById, onOpenContract, onOpenAudit, max = 6, className, now = new Date(),
}: PortfolioActivityProps) {
  if (error) {
    return (
      <p className={cn('flex items-start gap-2 rounded-[12px] border border-ig-border-subtle bg-ig-panel/40 px-3 py-2.5 text-ig-caption text-ig-warning', className)}>
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        Falha ao ler a trilha de auditoria. A ausência de linhas aqui é incidente de leitura, não ausência de atividade.
      </p>
    );
  }

  if (events.length === 0) {
    return (
      <p className={cn('flex items-center gap-2 rounded-[12px] border border-ig-border-subtle bg-ig-panel/40 px-3 py-2.5 text-ig-caption text-ig-fg-subtle', className)}>
        <History className="h-3.5 w-3.5 shrink-0" aria-hidden />
        Nenhuma atividade registrada ainda nesta carteira.
      </p>
    );
  }

  const shown = events.slice(0, max);
  const latest = shown[0]?.entity_id;

  return (
    <div className={cn('rounded-[14px] border border-ig-border-subtle bg-ig-panel/40 px-3.5 py-3', className)}>
      <header className="mb-2 flex items-baseline gap-2">
        <span className="flex items-center gap-1.5 text-ig-label text-ig-fg-muted">
          <History className="h-3.5 w-3.5 text-ig-fg-subtle" aria-hidden />
          Atividade recente
        </span>
        {onOpenAudit && latest && (
          <button
            type="button"
            onClick={() => onOpenAudit(latest)}
            className="ml-auto inline-flex items-center gap-1 rounded text-ig-caption font-medium text-ig-accent transition-transform hover:translate-x-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--ig-accent)_45%,transparent)]"
          >
            Trilha completa
            <ArrowRight className="h-3 w-3" aria-hidden />
          </button>
        )}
      </header>

      <ol className="space-y-0" aria-label="Atividade recente da carteira">
        {shown.map((e, i) => (
          <li key={e.id} className="relative flex items-start gap-2.5 py-1.5">
            {/* Trilho de tempo: liga os eventos, some no último. */}
            <span className="relative flex w-3 shrink-0 justify-center" aria-hidden>
              <span className="mt-[7px] h-1.5 w-1.5 rounded-full bg-ig-accent/70" />
              {i < shown.length - 1 && (
                <span className="absolute left-1/2 top-[13px] h-[calc(100%+6px)] w-px -translate-x-1/2 bg-ig-border-subtle" />
              )}
            </span>

            <span className="min-w-0 flex-1">
              <span className="block truncate text-ig-body-sm text-ig-fg-strong">
                {auditActionLabel(e.action)}
              </span>
              <span className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-ig-caption text-ig-fg-muted">
                {onOpenContract ? (
                  <button
                    type="button"
                    onClick={() => onOpenContract(e.entity_id)}
                    className="rounded font-mono text-ig-fg-muted hover:text-ig-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--ig-accent)_45%,transparent)]"
                  >
                    {codeById.get(e.entity_id) ?? '—'}
                  </button>
                ) : (
                  <span className="font-mono">{codeById.get(e.entity_id) ?? '—'}</span>
                )}
                <span className="text-ig-fg-subtle">{ago(e.created_at, now)}</span>
              </span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
