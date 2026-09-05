'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { hasOfficialValue, isError, type Official } from '@/lib/contracts/trust/trusted';
import type { TrustedPortfolioStats } from '@/lib/contracts/trust/portfolio';

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  notation: 'compact',
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

export interface PortfolioContextStripProps {
  stats: TrustedPortfolioStats;
  className?: string;
}

/** Ausência continua sendo ausência: nunca formatada como zero. */
function value(v: Official<number>, format: (n: number) => string): string {
  if (isError(v)) return 'indisponível';
  if (!hasOfficialValue(v)) return 'não apurado';
  return format(v.value);
}

/**
 * Contexto da carteira em UMA linha, para as áreas especializadas.
 *
 * O que havia antes: a faixa executiva completa — oito indicadores, exposição,
 * execução, barra de progresso — repetida acima de Contratos, Renovações,
 * Obrigações, Faturamentos, Aprovações, Riscos e Documentos. Ela ocupava a
 * primeira dobra inteira em sete áreas, de modo que clicar em "Faturamentos"
 * mostrava, antes de qualquer coisa de faturamento, o mesmo resumo que a Visão
 * Geral já dá. A área escolhida chegava abaixo da linha d'água.
 *
 * O resumo executivo completo continua existindo — na Visão Geral, que é o
 * lugar dele. Aqui fica só o que ancora o recorte: de que carteira estes
 * números falam, e qual o seu tamanho.
 *
 * Não é interativo por decisão: filtrar é ato da Visão Geral e da lista de
 * contratos. Um filtro escondido numa tira de contexto seria descoberto por
 * acidente, e o recibo de filtro ativo (com o X para limpar) segue logo abaixo
 * quando há um em vigor.
 */
export function PortfolioContextStrip({ stats, className }: PortfolioContextStripProps) {
  const items: { label: string; text: string; tone?: 'warning' }[] = [
    { label: 'Exposição', text: value(stats.totalValue, (n) => BRL.format(n)) },
    { label: 'Faturado', text: value(stats.billedValue, (n) => BRL.format(n)) },
    {
      label: 'Alto risco',
      text: value(stats.highRisk, (n) => String(n)),
      tone: hasOfficialValue(stats.highRisk) && stats.highRisk.value > 0 ? 'warning' : undefined,
    },
  ];

  return (
    <div
      className={cn(
        // Uma linha, um fio embaixo. Sem superfície, sem sombra: contexto não
        // compete com o conteúdo da área.
        'flex flex-wrap items-baseline gap-x-5 gap-y-1 border-b border-ig-border-subtle pb-2.5',
        className,
      )}
      aria-label="Contexto da carteira oficial"
    >
      <span className="text-ig-caption font-semibold text-ig-fg-strong">Carteira oficial</span>
      {items.map((item) => (
        <span key={item.label} className="flex items-baseline gap-1.5">
          <span className="text-ig-caption text-ig-fg-muted">{item.label}</span>
          <span
            className={cn(
              'ig-tabular text-ig-caption font-medium',
              item.tone === 'warning' ? 'text-ig-warning' : 'text-ig-fg-strong',
            )}
          >
            {item.text}
          </span>
        </span>
      ))}
      <span className="ml-auto text-ig-caption text-ig-fg-subtle">
        {stats.contractCount} contrato{stats.contractCount === 1 ? '' : 's'}
      </span>
    </div>
  );
}
