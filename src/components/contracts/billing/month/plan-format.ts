/**
 * Formatação compartilhada do planejamento mensal.
 *
 * Mora num arquivo só porque os três níveis da tela (resumo, linha do tempo e
 * ledger) precisam escrever "não apurado" exatamente do mesmo jeito. Quando
 * cada componente formatava por conta própria, o mesmo `null` virava "—" num
 * lugar, "R$ 0,00" noutro e string vazia num terceiro — e o "R$ 0,00" era uma
 * afirmação falsa.
 */

import type { PlanTone } from '@/lib/contracts/billing/planning/monthly-planning';
import type { StageTone } from '@/lib/contracts/measurement/milestone-stage';

/** O texto de AUSÊNCIA. Um só, em toda a aba. Nunca "0". */
export const ABSENT = 'Não apurado';

export function money(value: number | null, currency: string | null = 'BRL'): string {
  if (value === null) return ABSENT;
  try {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency', currency: currency ?? 'BRL', maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency ?? ''} ${value.toFixed(2)}`.trim();
  }
}

/** Compacto para cartão de mês: R$ 8,0 mi. */
export function moneyCompact(value: number | null, currency: string | null = 'BRL'): string {
  if (value === null) return ABSENT;
  try {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency', currency: currency ?? 'BRL',
      notation: 'compact', maximumFractionDigits: 1,
    }).format(value);
  } catch {
    return money(value, currency);
  }
}

export function date(iso: string | null): string {
  if (!iso) return ABSENT;
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

/**
 * O tom do planejamento, traduzido para o vocabulário do chip do dossiê.
 *
 * `dashed` continua significando NÃO APURADO em toda a aba — e é ele que
 * impede que um marco apenas previsto tenha a mesma cara de uma nota emitida.
 */
export function chipTone(tone: PlanTone): { tone: StageTone | 'received'; dashed: boolean } {
  switch (tone) {
    case 'planned':   return { tone: 'neutral', dashed: true };
    case 'eligible':  return { tone: 'accent', dashed: false };
    case 'billed':    return { tone: 'positive', dashed: false };
    case 'received':  return { tone: 'received', dashed: false };
    case 'attention': return { tone: 'attention', dashed: false };
    case 'critical':  return { tone: 'critical', dashed: false };
  }
}
