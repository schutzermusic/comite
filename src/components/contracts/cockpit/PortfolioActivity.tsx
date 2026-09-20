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
import { History, AlertTriangle } from 'lucide-react';
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
  /**
   * A saída para a trilha completa passou a ser a AÇÃO DO BLOCO, no cabeçalho
   * da seção, junto com todas as outras saídas da Visão Geral. Aqui dentro ela
   * era um segundo botão numa lista que já é clicável linha a linha.
   */
  /**
   * Quatro eventos. A trilha inteira mora atrás de "Trilha completa": uma
   * coluna de recado recente não precisa competir em altura com a área de
   * ação, e a partir do sexto item ninguém está mais lendo — está rolando.
   */
  max?: number;
  className?: string;
  now?: Date;
}

export function PortfolioActivity({
  events, error, codeById, onOpenContract, max = 4, className, now = new Date(),
}: PortfolioActivityProps) {
  if (error) {
    return (
      <p className={cn('flex items-start gap-2 py-2 text-ig-caption text-ig-warning', className)}>
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        Falha ao ler a trilha de auditoria. A ausência de linhas aqui é incidente de leitura, não ausência de atividade.
      </p>
    );
  }

  if (events.length === 0) {
    return (
      <p className={cn('flex items-center gap-2 py-2 text-ig-caption text-ig-fg-subtle', className)}>
        <History className="h-3.5 w-3.5 shrink-0" aria-hidden />
        Nenhuma atividade registrada ainda nesta carteira.
      </p>
    );
  }

  const shown = events.slice(0, max);

  /*
    Sem moldura e sem cabeçalho próprios: o bloco da Visão Geral já nomeia a
    seção e já é a superfície. Antes havia um retângulo com borda e um segundo
    título dentro de uma seção que tinha os dois — duas molduras e dois títulos
    para uma lista de seis linhas.
  */
  return (
    <div className={className}>
      <ol className="space-y-0" aria-label="Atividade recente da carteira">
        {shown.map((e, i) => (
          /*
            `py-1.5` — a MESMA altura de linha de "Operações conectadas", que
            divide a linha da grade com este bloco. Duas listas lado a lado com
            ritmos diferentes fazem a dupla parecer desalinhada mesmo quando as
            bordas coincidem.
          */
          <li key={e.id} className="relative flex items-baseline gap-2.5 py-1.5">
            {/* Trilho de tempo: liga os eventos, some no último. */}
            <span className="relative flex w-2 shrink-0 justify-center self-stretch" aria-hidden>
              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ig-accent/70" />
              {i < shown.length - 1 && (
                <span className="absolute left-1/2 top-[11px] h-[calc(100%+6px)] w-px -translate-x-1/2 bg-ig-border-subtle" />
              )}
            </span>

            {/*
              UMA linha por evento: o que aconteceu, em que contrato e quando.
              O código do contrato ocupava uma segunda altura por evento, e
              seis eventos viravam doze linhas de texto numa coluna de apoio.
            */}
            <span className="min-w-0 flex-1 truncate text-ig-caption text-ig-fg-default">
              {auditActionLabel(e.action)}
              {onOpenContract ? (
                <button
                  type="button"
                  onClick={() => onOpenContract(e.entity_id)}
                  className="ig-code ig-code-quiet ml-1.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--ig-accent)_45%,transparent)]"
                >
                  {codeById.get(e.entity_id) ?? '—'}
                </button>
              ) : (
                <span className="ig-code ig-code-quiet ml-1.5">{codeById.get(e.entity_id) ?? '—'}</span>
              )}
            </span>
            <span className="shrink-0 text-ig-caption text-ig-fg-subtle">{ago(e.created_at, now)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
