'use client';

/**
 * O único lugar da TELA onde `Measured<T>` vira pixel.
 *
 * Centralizar não é preciosismo de arquitetura: é o que garante que "não
 * apurado" tenha sempre a mesma aparência e o mesmo peso visual — discreto,
 * sem tom semântico, e legível como ausência e não como zero. Espalhar essa
 * decisão por vinte componentes é como o traço vira `0` de novo, um descuido
 * de cada vez.
 *
 * Os três documentos exportados têm o equivalente deles em
 * `overview/report/charts.ts`, pela mesma razão.
 */

import { cn } from '@/lib/utils';
import { formatWorkforceCurrency } from '@/lib/workforce-data';
import {
  UNMEASURED_LABEL,
  type KpiFormat,
  type Measured,
} from '@/lib/workforce/overview/types';

/** Formata um valor APURADO. Nunca recebe ausência. */
export function formatMeasuredNumber(value: number, format: KpiFormat): string {
  switch (format) {
    case 'currency':
      return formatWorkforceCurrency(value);
    case 'pct':
      return `${value.toFixed(1).replace('.', ',')}%`;
    case 'ratio':
      return `${value.toFixed(2).replace('.', ',')}x`;
    case 'int':
      return new Intl.NumberFormat('pt-BR').format(Math.round(value));
    default:
      return String(value);
  }
}

/** Texto do indicador, apurado ou não. Usado por KPIs, tabelas e eixos. */
export function measuredText(
  m: Measured<number>,
  format: KpiFormat,
  display?: Measured<string>,
): string {
  if (display) return display.measured ? display.value : '–';
  return m.measured ? formatMeasuredNumber(m.value, format) : '–';
}

/** Motivo da ausência, pronto para `title=` ou linha auxiliar. */
export function unmeasuredNote(m: Measured<unknown>): string | undefined {
  if (m.measured) return undefined;
  return m.note ?? UNMEASURED_LABEL[m.reason];
}

interface WorkforceMeasuredValueProps {
  value: Measured<number>;
  format: KpiFormat;
  display?: Measured<string>;
  className?: string;
  /** Classe aplicada só quando o valor existe — o traço nunca ganha cor. */
  measuredClassName?: string;
}

export function WorkforceMeasuredValue({
  value,
  format,
  display,
  className,
  measuredClassName,
}: WorkforceMeasuredValueProps) {
  const isMeasured = display ? display.measured : value.measured;
  const note = unmeasuredNote(display ?? value);

  return (
    <span
      className={cn(
        'ig-tabular',
        className,
        isMeasured ? measuredClassName : 'text-ig-fg-subtle font-normal',
      )}
      title={note}
    >
      {measuredText(value, format, display)}
    </span>
  );
}
