/**
 * Formatação de indicadores confiáveis.
 *
 * Este é o ÚNICO lugar onde um `Official<T>` vira texto na interface. Existe
 * para que "não apurado" e "dados indisponíveis" tenham uma redação só, e para
 * que ninguém precise (nem consiga) escrever `formatCurrency(x.value)`.
 *
 * A distinção entre os dois rótulos é a correção semântica exigida em P0.3:
 * uma falha de leitura NÃO pode se apresentar como "estimado", porque estimado
 * sugere um número aproximado, e não existe número nenhum.
 *
 * Sem React. Testável em Node.
 */

import {
  renderOfficial, hasOfficialValue, isError,
  TRUST_FALLBACK_LABEL,
  type Official,
} from './trusted';

const CURRENCY_COMPACT = new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL', notation: 'compact',
  minimumFractionDigits: 0, maximumFractionDigits: 1,
});

const CURRENCY_FULL = new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL',
  minimumFractionDigits: 0, maximumFractionDigits: 0,
});

/** Texto curto usado dentro de células compactas da band. */
export const SHORT_FALLBACK = {
  missing: '—',
  error: 'indisponível',
} as const;

/** Quantia compacta (R$ 1,2 mi) ou o rótulo do estado. */
export function officialCurrencyCompact(t: Official<number>): string {
  return renderOfficial(t, {
    onValue: (v) => CURRENCY_COMPACT.format(v),
    onMissing: () => TRUST_FALLBACK_LABEL.missing,
    onError: () => TRUST_FALLBACK_LABEL.error,
  });
}

/** Quantia por extenso (R$ 1.200.000) ou o rótulo do estado. */
export function officialCurrencyFull(t: Official<number>): string {
  return renderOfficial(t, {
    onValue: (v) => CURRENCY_FULL.format(v),
    onMissing: () => TRUST_FALLBACK_LABEL.missing,
    onError: () => TRUST_FALLBACK_LABEL.error,
  });
}

/** Contagem inteira, ou o traço curto. Zero apurado imprime "0". */
export function officialCount(t: Official<number>): string {
  return renderOfficial(t, {
    onValue: (v) => String(Math.round(v)),
    onMissing: () => SHORT_FALLBACK.missing,
    onError: () => SHORT_FALLBACK.error,
  });
}

/** Percentual a partir de uma razão 0..1. */
export function officialPercent(t: Official<number>): string {
  return renderOfficial(t, {
    onValue: (v) => `${Math.round(v * 100)}%`,
    onMissing: () => SHORT_FALLBACK.missing,
    onError: () => SHORT_FALLBACK.error,
  });
}

/**
 * Valor 0..100 para barra de progresso, ou `undefined`.
 *
 * `undefined` é deliberado: a barra deve ficar vazia/neutra, jamais em 0%, que
 * o olho lê como "nada executado" em vez de "não sabemos".
 */
export function officialProgress(t: Official<number>): number | undefined {
  return hasOfficialValue(t) ? Math.max(0, Math.min(100, Math.round(t.value * 100))) : undefined;
}

/** Número cru para consumidores que já trataram o estado (gráficos, PDF). */
export function officialNumberOr(t: Official<number>, fallback: number): number {
  return hasOfficialValue(t) ? t.value : fallback;
}

/**
 * Tom semântico de uma célula da band.
 *
 * Um indicador em erro nunca herda o tom "tudo certo": erro é `danger`, e
 * ausência é neutra — nenhuma das duas pode parecer um resultado bom.
 */
export function officialTone<T extends string>(
  t: Official<number>,
  toneWhenPositive: T,
  toneWhenZero: T,
  toneWhenUnavailable: T,
): T {
  if (isError(t)) return toneWhenUnavailable;
  if (!hasOfficialValue(t)) return toneWhenZero === toneWhenPositive ? toneWhenZero : toneWhenUnavailable;
  return t.value > 0 ? toneWhenPositive : toneWhenZero;
}

/** Frase de proveniência para tooltip/legenda, explicando de onde o número veio. */
export function officialProvenance(t: Official<unknown>): string {
  return renderOfficial(t, {
    onValue: (_v, state) => state === 'live' ? 'Lido da fonte' : 'Calculado a partir de dado apurado',
    onMissing: (reason, note) => {
      const base: Record<string, string> = {
        'no-rows': 'Nenhum registro na fonte',
        'null-in-source': 'Campo vazio na origem',
        'not-integrated': 'Depende de integração ainda inexistente',
        'not-attributable': 'Não se reparte pelo recorte aplicado',
        'not-comparable': 'Falta uma das pontas do cálculo',
        'no-permission': 'Sua permissão não alcança esta fonte',
        'demo-excluded': 'Valor de demonstração, descartado em superfície oficial',
        'unclassified-contract': 'Origem do contrato ainda não validada — fora da carteira oficial',
      };
      return note ? `${base[reason] ?? 'Não apurado'} — ${note}` : (base[reason] ?? 'Não apurado');
    },
    onError: (message) => `Falha na leitura: ${message}`,
  });
}
