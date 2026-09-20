'use client';

/**
 * EXPOSIÇÃO POR CLASSIFICAÇÃO DE RISCO.
 *
 * Barras horizontais, e não rosca. A comparação aqui é entre três magnitudes
 * de dinheiro — o tipo de leitura em que o comprimento ganha do ângulo com
 * folga — e cada faixa precisa carregar DOIS números ao mesmo tempo (contratos
 * e BRL), que numa rosca não cabem sem legenda separada.
 *
 * Clicar numa faixa liga o recorte da carteira: o gráfico é uma ferramenta de
 * navegação, não uma ilustração.
 *
 * ─── A quarta linha ───────────────────────────────────────────────────────
 *
 * "Exposição não apurada" fica ABAIXO da régua das três faixas, com um fio
 * separando, porque não é uma quarta classe de risco — é a cobertura do eixo
 * financeiro. `contracts.risk_level` é NOT NULL: todo contrato tem classe. O
 * que pode faltar é o valor, e um contrato sem valor conta na sua faixa e não
 * entra na soma dela. Desenhá-lo como faixa própria o contaria duas vezes.
 */

import { cn } from '@/lib/utils';
import { ShieldAlert } from 'lucide-react';
import type { RiskBandKey, RiskExposureBands } from '@/lib/contracts/analytics/risk-exposure-bands';
import { ChartHead, ChartCoverage, ChartAbsent, ChartBar, money, moneyFull, pct, type ChartTone } from './ChartPrimitives';

export interface RiskExposureChartProps {
  readonly bands: RiskExposureBands;
  /** Clique numa faixa → carteira filtrada por aquele risco. */
  readonly onSelectBand?: (band: RiskBandKey) => void;
  readonly activeBand?: RiskBandKey | null;
  readonly className?: string;
}

const TONE: Record<RiskBandKey, ChartTone> = {
  high: 'critical',
  medium: 'attention',
  low: 'positive',
};

export function RiskExposureChart({
  bands, onSelectBand, activeBand, className,
}: RiskExposureChartProps) {
  if (bands.contractCount === 0) {
    return (
      <div className={className}>
        <ChartHead question="Onde está o dinheiro exposto a risco?" source="Classificação registrada no instrumento." />
        <ChartAbsent
          title="Nenhum contrato no recorte"
          detail="Ajuste o escopo ou remova o filtro ativo para ver a repartição por risco."
        />
      </div>
    );
  }

  /** A escala é a MAIOR faixa, não o total: barras de 3% não se comparam. */
  const max = Math.max(...bands.bands.map((b) => b.exposure ?? 0), 0) || null;
  const high = bands.bands.find((b) => b.key === 'high');

  return (
    <div className={cn('flex h-full flex-col', className)}>
      <ChartHead
        question="Onde está o dinheiro exposto a risco?"
        source="Contratos e exposição em BRL por classificação. Clique numa faixa para filtrar a carteira."
        aside={
          high && high.exposure !== null ? (
            <span className="ig-chart-aside is-critical ig-tabular" title="Soma do valor dos contratos classificados como risco alto.">
              <ShieldAlert className="h-3.5 w-3.5" aria-hidden />
              {money(high.exposure)} em alto risco
            </span>
          ) : undefined
        }
      />

      <ul className="ig-risk-bands">
        {bands.bands.map((band) => {
          const clickable = Boolean(onSelectBand) && band.count > 0;
          const Row: React.ElementType = clickable ? 'button' : 'div';
          return (
            <li key={band.key}>
              <Row
                type={clickable ? 'button' : undefined}
                onClick={clickable ? () => onSelectBand?.(band.key) : undefined}
                aria-pressed={clickable ? activeBand === band.key : undefined}
                className={cn('ig-risk-band', clickable && 'is-clickable', activeBand === band.key && 'is-active')}
                title={
                  band.exposure === null
                    ? `${band.label}: ${band.count} contrato(s); nenhum com valor apurado.`
                    : `${band.label}: ${band.count} contrato(s) · ${moneyFull(band.exposure)}`
                      + (band.pricedCount < band.count
                        ? ` · ${band.count - band.pricedCount} sem valor apurado, fora da soma.`
                        : '')
                }
              >
                <div className="ig-risk-band-head">
                  <span className="ig-risk-band-label">{band.label}</span>
                  <span className="ig-risk-band-count ig-tabular">
                    {band.count} contrato{band.count === 1 ? '' : 's'}
                  </span>
                  {/*
                    Faixa VAZIA mostra "—": nenhum contrato ali é um fato, não
                    uma lacuna. "Não apurado" fica reservado para a faixa que
                    TEM contrato e não tem valor legível.
                  */}
                  <span className={cn('ig-risk-band-money ig-tabular', band.exposure === null && 'is-absent')}>
                    {band.count === 0 ? '—' : money(band.exposure)}
                  </span>
                  <span className="ig-risk-band-pct ig-tabular">{pct(band.share)}</span>
                </div>
                <ChartBar
                  value={band.exposure}
                  max={max}
                  tone={TONE[band.key]}
                  absentLabel={`${band.label}: exposição não apurada`}
                />
                {band.pricedCount < band.count && (
                  <span className="ig-risk-band-gap">
                    {band.count - band.pricedCount} sem valor apurado — fora da soma
                  </span>
                )}
              </Row>
            </li>
          );
        })}
      </ul>

      {bands.unpriced.count > 0 && (
        <div className="ig-risk-unpriced">
          <span className="ig-risk-unpriced-label">Exposição não apurada</span>
          <span className="ig-tabular">
            {bands.unpriced.count} contrato{bands.unpriced.count === 1 ? '' : 's'}
          </span>
          <span className="ig-risk-unpriced-note">
            classificados, sem valor legível — cobertura, não uma quarta faixa
          </span>
        </div>
      )}

      <ChartCoverage>
        {bands.total === null
          ? 'Nenhum contrato do recorte teve o valor contratado apurado — as barras são trilhos, não zeros.'
          : `${money(bands.total)} de exposição apurada em ${bands.contractCount} contrato(s).`}
        {bands.erroredContracts.length > 0
          && ` Leitura de valor falhou em ${bands.erroredContracts.length} contrato(s).`}
      </ChartCoverage>
    </div>
  );
}
