'use client';

/**
 * O ÚNICO ponto onde um `Official<T>` vira pixel.
 *
 * Existe para que a redação de "não apurado" e "dados indisponíveis" seja uma
 * só em toda a interface, e para que nenhum componente precise (ou consiga)
 * inventar um fallback próprio. Um `?? 0` distraído em qualquer card
 * reintroduziria exatamente o problema que P0.3 eliminou.
 *
 * A distinção visual entre os estados é deliberada e não depende só de cor
 * (docs/DESIGN_SYSTEM.md · MD §63): ausência é um travessão discreto, falha é
 * um texto em tom de perigo com ícone. Nunca se parecem.
 */

import { cn } from '@/lib/utils';
import { AlertTriangle } from 'lucide-react';
import {
  renderOfficial, hasOfficialValue, isError,
  type Official,
} from '@/lib/contracts/trust/trusted';
import { officialProvenance } from '@/lib/contracts/trust/format';

export type TrustedValueSize = 'hero' | 'lg' | 'md' | 'sm';

/**
 * Escala da métrica, alinhada à família do produto (P2G).
 *
 * Contratos vinha uma marcha acima dos demais módulos: herói em 38px contra os
 * 32px de `ig-display`, que é o topo da escala executiva do sistema. Sofisticação
 * aqui não vem de tamanho — vem de hierarquia, densidade e proveniência à vista.
 * Um número maior que o do Dashboard não torna o módulo mais avançado; torna-o
 * estrangeiro dentro do próprio produto.
 *
 * Os tokens do sistema (`ig-kpi-lg` 32px, `ig-kpi-md` 22px) cobrem a faixa, e usá-los
 * faz esta escala acompanhar o design system em vez de divergir dele em silêncio.
 */
const SIZE_CLASS: Record<TrustedValueSize, string> = {
  hero: 'text-ig-kpi-lg',
  lg: 'text-[26px] leading-[1.1] font-semibold',
  md: 'text-ig-kpi-md',
  sm: 'text-ig-body-sm font-semibold',
};

const FALLBACK_SIZE_CLASS: Record<TrustedValueSize, string> = {
  // O estado sem valor não herda o tamanho do número: um "Não apurado" no
  // corpo do herói grita mais alto que os dados que de fato existem.
  hero: 'text-ig-h3 leading-tight font-medium',
  lg: 'text-ig-body leading-tight font-medium',
  md: 'text-ig-body-sm font-medium',
  sm: 'text-ig-caption font-medium',
};

export interface TrustedValueProps<T> {
  value: Official<T>;
  /** Como desenhar o valor apurado. */
  format: (value: T) => string;
  size?: TrustedValueSize;
  /** Texto quando não há apuração. Padrão: "Não apurado". */
  missingLabel?: string;
  className?: string;
  /** Aplica o acabamento metálico do design system a valores apurados. */
  metallic?: boolean;
  /** Expõe a proveniência no title do elemento. */
  showProvenance?: boolean;
}

export function TrustedValue<T>({
  value,
  format,
  size = 'md',
  missingLabel = 'Não apurado',
  className,
  metallic = false,
  showProvenance = true,
}: TrustedValueProps<T>) {
  const provenance = showProvenance ? officialProvenance(value as Official<unknown>) : undefined;

  return renderOfficial(value, {
    onValue: (v) => (
      <span
        title={provenance}
        className={cn(
          'ig-tabular block truncate text-ig-fg-strong',
          SIZE_CLASS[size],
          metallic && 'ig-text-metal-accent',
          className,
        )}
      >
        {format(v)}
      </span>
    ),
    onMissing: () => (
      <span
        title={provenance}
        className={cn('block truncate text-ig-fg-subtle', FALLBACK_SIZE_CLASS[size], className)}
      >
        {missingLabel}
      </span>
    ),
    onError: () => (
      <span
        title={provenance}
        className={cn(
          'flex items-center gap-1.5 truncate text-ig-danger',
          FALLBACK_SIZE_CLASS[size],
          className,
        )}
      >
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
        Dados indisponíveis
      </span>
    ),
  });
}

/**
 * Selo de proveniência.
 *
 * Só aparece quando ACRESCENTA informação: um valor lido da fonte é o caso
 * normal e não merece selo — marcar o normal transforma o selo em ruído e faz
 * o olho parar de enxergá-lo justamente quando ele importa.
 */
export function TrustedProvenanceBadge({ value, className }: { value: Official<unknown>; className?: string }) {
  if (hasOfficialValue(value) && value.trust === 'live') return null;

  const label = isError(value)
    ? 'Indisponível'
    : hasOfficialValue(value)
      ? 'Calculado'
      : 'Não apurado';

  const tone = isError(value)
    ? 'border-[color-mix(in_oklab,var(--ig-danger)_38%,transparent)] text-ig-danger'
    : hasOfficialValue(value)
      ? 'border-[color-mix(in_oklab,var(--ig-info)_34%,transparent)] text-ig-info'
      : 'border-ig-border-subtle text-ig-fg-subtle';

  return (
    <span
      title={officialProvenance(value)}
      className={cn(
        'inline-flex shrink-0 items-center rounded-[6px] border px-1.5 py-px text-[11px] font-medium',
        tone,
        className,
      )}
    >
      {label}
    </span>
  );
}

/**
 * Cobertura de um cálculo agregado — "3 de 5 contribuíram".
 *
 * Um total parcial continua verdadeiro, desde que se saiba que é parcial. Sem
 * isto, `sumTrusted` produziria um número que parece completo.
 */
export function TrustedCoverage({ value, className }: { value: Official<unknown>; className?: string }) {
  if (!hasOfficialValue(value) || value.trust !== 'derived') return null;
  const coverage = value.derivation.coverage;
  if (!coverage || coverage.counted === coverage.total) return null;

  return (
    <span
      className={cn('text-ig-caption text-ig-warning', className)}
      title={`${coverage.counted} de ${coverage.total} itens tinham o indicador apurado`}
    >
      parcial · {coverage.counted}/{coverage.total}
    </span>
  );
}
