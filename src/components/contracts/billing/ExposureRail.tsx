'use client';

/**
 * EXPOSIÇÃO FINANCEIRA — o mini-cockpit.
 *
 * ─── Por que DIREITO CONTRATUAL é métrica permanente ───────────────────────
 *
 * `contracts.total_value` e a soma dos direitos por evento são DUAS fontes de
 * verdade distintas: uma é o número do cabeçalho do instrumento, a outra é o
 * rateio por evento da tabela de pagamento. Elas normalmente coincidem — e
 * quando não coincidem, alguém precisa decidir.
 *
 * JA10182283/2025 é o caso: o cabeçalho diz R$ 8.032.339,76 e os seis eventos
 * somam R$ 8.032.339,77, por arredondamento do rateio percentual no próprio
 * documento assinado. Exibir só o cabeçalho esconderia a pergunta; exibir só a
 * soma contradiria o contrato. Então os dois ficam, e a diferença vira um sinal
 * explícito — nunca uma reconciliação silenciosa.
 *
 * ─── A decomposição ────────────────────────────────────────────────────────
 *
 * O medidor responde "o que impede o reconhecimento de receita?" em três
 * segmentos: aceito, apurado-aguardando-aceite, e NÃO APURADO. O terceiro é
 * tracejado, porque é ausência de apuração — e uma barra sólida cinza ali
 * seria lida como "medido e deu zero".
 */

import { cn } from '@/lib/utils';
import { formatContractCurrency } from '@/lib/contracts/trust/format';
import { SignalChip } from '../measurement/SignalChip';

/** Uma métrica da régua. `value === null` significa NÃO APURADO, nunca zero. */
export interface ExposureMetric {
  readonly key: string;
  readonly label: string;
  readonly value: number | null;
  /** De onde o número vem, para quem precisa auditar a tela. */
  readonly source: string;
  /** Rótulo alternativo quando não há valor ("Não apurado", "Não integrado"…). */
  readonly absentLabel?: string;
  readonly emphasis?: boolean;
}

export interface RevenueBlockSegment {
  readonly key: 'accepted' | 'measured_pending' | 'unassessed';
  readonly label: string;
  readonly amount: number;
  /** Tracejado = não apurado. */
  readonly absent?: boolean;
}

export interface ExposureRailProps {
  readonly metrics: readonly ExposureMetric[];
  readonly segments: readonly RevenueBlockSegment[];
  readonly base: number | null;
  /** Divergência entre o total do instrumento e a soma dos direitos por evento. */
  readonly reconciliation?: {
    readonly delta: number;
    readonly headerTotal: number;
    readonly entitlementTotal: number;
  } | null;
  readonly className?: string;
}

export function ExposureRail({ metrics, segments, base, reconciliation, className }: ExposureRailProps) {
  const pct = (amount: number) => (base && base > 0 ? Math.max(0, Math.min(100, (amount / base) * 100)) : 0);

  return (
    <section className={cn('dossier-surface dossier-exposure', className)}>
      <header className="dossier-section-head">
        <div>
          <h3>Exposição financeira</h3>
          <p>Valores, execução e o que bloqueia o reconhecimento de receita.</p>
        </div>
        {reconciliation && reconciliation.delta !== 0 && (
          <SignalChip
            tone="attention"
            title={
              `Cabeçalho do contrato: ${formatContractCurrency(reconciliation.headerTotal)}. `
              + `Soma dos direitos por evento: ${formatContractCurrency(reconciliation.entitlementTotal)}. `
              + 'Divergência presente no documento assinado (arredondamento do rateio percentual). '
              + 'Nenhuma reconciliação foi aplicada.'
            }
          >
            Divergência {reconciliation.delta > 0 ? '+' : '−'}
            {formatContractCurrency(Math.abs(reconciliation.delta))}
          </SignalChip>
        )}
      </header>

      <div className="dossier-section-body">
        <div className="dossier-exposure-metrics">
          {metrics.map((metric) => (
            <div key={metric.key} className="dossier-exposure-metric" data-emphasis={metric.emphasis || undefined}>
              <span className="dossier-exposure-label">{metric.label}</span>
              <span className={cn('dossier-exposure-value ig-tabular', metric.value === null && 'is-absent')}>
                {metric.value === null
                  ? (metric.absentLabel ?? 'Não apurado')
                  : formatContractCurrency(metric.value)}
              </span>
              <span className="dossier-exposure-source">{metric.source}</span>
            </div>
          ))}
        </div>

        <div className="dossier-exposure-block">
          <div className="dossier-exposure-block-head">
            <span>O que bloqueia o reconhecimento de receita</span>
            {base !== null && <span className="ig-tabular">{formatContractCurrency(base)} contratado</span>}
          </div>

          <div className="dossier-exposure-meter" role="img" aria-label="Decomposição do valor contratado">
            {segments.map((segment) => (
              <i
                key={segment.key}
                data-segment={segment.key}
                data-absent={segment.absent || undefined}
                style={{ width: `${pct(segment.amount)}%` }}
              />
            ))}
          </div>

          <ul className="dossier-exposure-legend">
            {segments.map((segment) => (
              <li key={segment.key} data-segment={segment.key} data-absent={segment.absent || undefined}>
                <i aria-hidden />
                <span className="dossier-exposure-legend-label">{segment.label}</span>
                <span className="ig-tabular">{formatContractCurrency(segment.amount)}</span>
                {base !== null && base > 0 && (
                  <span className="ig-tabular dossier-exposure-legend-pct">
                    {pct(segment.amount).toFixed(pct(segment.amount) % 1 === 0 ? 0 : 1)}%
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
