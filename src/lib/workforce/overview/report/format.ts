/**
 * Onde `Measured<T>` vira texto nos DOCUMENTOS.
 *
 * A tela tem o equivalente em `WorkforceMeasuredValue.tsx`, que devolve JSX;
 * este devolve string, porque o PDF, o deck e o PowerPoint montam markup e
 * XML, não árvore de componentes.
 *
 * São dois arquivos por necessidade técnica (um importa React, o outro precisa
 * rodar em Node), mas UMA regra: ausência tem sempre o mesmo glifo, o mesmo
 * peso e nenhuma cor semântica.
 */

import {
  UNMEASURED_DASH,
  wfCurrency,
  wfInt,
  wfPct,
} from './theme';
import { UNMEASURED_LABEL, type KpiFormat, type Measured } from '../types';

/** Formata um valor APURADO. Nunca recebe ausência. */
export function formatMeasuredNumber(value: number, format: KpiFormat): string {
  switch (format) {
    case 'currency':
      return wfCurrency(value);
    case 'pct':
      return wfPct(value);
    case 'ratio':
      return `${value.toFixed(2).replace('.', ',')}x`;
    case 'int':
      return wfInt(value);
    default:
      return String(value);
  }
}

/** Texto do indicador — apurado, ou o traço. */
export function measuredText(
  value: Measured<number>,
  format: KpiFormat,
  display?: Measured<string>,
): string {
  if (display) return display.measured ? display.value : UNMEASURED_DASH;
  return value.measured ? formatMeasuredNumber(value.value, format) : UNMEASURED_DASH;
}

/** Motivo da ausência, para nota de rodapé ou coluna auxiliar. */
export function unmeasuredNote(m: Measured<unknown>): string | undefined {
  if (m.measured) return undefined;
  return m.note ?? UNMEASURED_LABEL[m.reason];
}

/** Valor numérico apurado, ou `null` — para quem precisa decidir, não exibir. */
export function measuredValue(m: Measured<number>): number | null {
  return m.measured ? m.value : null;
}
