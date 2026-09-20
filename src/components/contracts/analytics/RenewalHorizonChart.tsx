'use client';

/**
 * HORIZONTE DE VENCIMENTO E RENOVAÇÃO.
 *
 * Colunas por janela de tempo, da mais urgente à mais distante. O tempo é um
 * eixo ordenado, e colunas na ordem do calendário são a única forma em que o
 * olho lê "isto vem antes daquilo" sem precisar da legenda.
 *
 * Cada coluna carrega as duas leituras: quantos contratos e quanto dinheiro.
 * O NÚMERO DE CONTRATOS governa a altura da barra — porque é a contagem que
 * está sempre apurada — e a exposição aparece como valor sob o rótulo, com
 * "não apurado" quando nenhum contrato da janela tem valor legível.
 *
 * ─── Por que 91–180 é uma coluna só ───────────────────────────────────────
 *
 * `buildRenewalHorizon` mantém 120 e 180 separadas, e faz bem: a área de
 * Renovações opera nessa granularidade. Aqui, na leitura executiva, a decisão
 * de renovar a 100 e a 170 dias é a mesma decisão — "ainda não" —, e duas
 * colunas quase vazias lado a lado só tiram largura das janelas que pedem ação.
 * A agregação é de APRESENTAÇÃO: nada é somado que não venha das faixas.
 *
 * Clicar numa janela abre Renovações; a área já lista os contratos daquela
 * faixa, e duplicar a lista aqui seria uma segunda verdade para manter.
 */

import { cn } from '@/lib/utils';
import { CalendarClock } from 'lucide-react';
import type { HorizonBand, RenewalHorizon } from '@/lib/contracts/trust/renewal-horizon';
import { ChartHead, ChartCoverage, ChartAbsent, money, moneyFull, TONE_FILL, type ChartTone } from './ChartPrimitives';

export interface RenewalHorizonChartProps {
  readonly horizon: RenewalHorizon;
  /** Clique numa janela → área de Renovações. */
  readonly onOpenWindow?: (bands: readonly HorizonBand[]) => void;
  readonly className?: string;
}

/** As seis colunas da leitura executiva, cada uma sobre as faixas canônicas. */
const COLUMNS: readonly { key: string; label: string; short: string; bands: readonly HorizonBand[]; tone: ChartTone }[] = [
  { key: 'expired', label: 'Vencidos', short: 'venc.', bands: ['expired'], tone: 'critical' },
  { key: '30', label: '0–30 dias', short: '30d', bands: [30], tone: 'critical' },
  { key: '60', label: '31–60 dias', short: '60d', bands: [60], tone: 'attention' },
  { key: '90', label: '61–90 dias', short: '90d', bands: [90], tone: 'attention' },
  { key: '180', label: '91–180 dias', short: '180d', bands: [120, 180], tone: 'accent' },
  { key: 'beyond', label: '> 180 dias', short: '+180d', bands: ['beyond'], tone: 'neutral' },
];

export function RenewalHorizonChart({ horizon, onOpenWindow, className }: RenewalHorizonChartProps) {
  const byBand = new Map(horizon.bands.map((b) => [b.band, b]));

  const columns = COLUMNS.map((col) => {
    const parts = col.bands.map((b) => byBand.get(b));
    const count = parts.reduce((sum, p) => sum + (p?.count ?? 0), 0);
    const known = parts.map((p) => p?.exposure ?? null).filter((v): v is number => v !== null);
    return {
      ...col,
      count,
      // `null` quando nenhuma faixa da coluna teve exposição apurada.
      exposure: known.length > 0 ? known.reduce((a, b) => a + b, 0) : null,
    };
  });

  const maxCount = Math.max(...columns.map((c) => c.count), 0);
  const totalEntries = horizon.entries.length;

  if (totalEntries === 0 && horizon.undatedContracts.length === 0) {
    return (
      <div className={className}>
        <ChartHead question="Quando a carteira vence, e quanto está em jogo?" source="renewal_date, ou end_date na falta dela." />
        <ChartAbsent
          title="Nenhum contrato com vigência apurada"
          detail="Sem renewal_date nem end_date não há janela de decisão. Nada é inferido de duração típica ou de histórico."
        />
      </div>
    );
  }

  const urgent = columns
    .filter((c) => c.key === 'expired' || c.key === '30')
    .reduce((sum, c) => sum + c.count, 0);

  return (
    <div className={cn('flex h-full flex-col', className)}>
      <ChartHead
        question="Quando a carteira vence, e quanto está em jogo?"
        source="Janela governada por renewal_date; end_date entra só na falta dela. Clique para abrir Renovações."
        aside={
          urgent > 0 ? (
            <span className="ig-chart-aside is-critical ig-tabular" title="Contratos vencidos ou com decisão nos próximos 30 dias.">
              <CalendarClock className="h-3.5 w-3.5" aria-hidden />
              {urgent} exige decisão
            </span>
          ) : undefined
        }
      />

      <div className="ig-horizon-plot" role="img" aria-label="Contratos por janela de vencimento">
        {columns.map((col) => {
          const clickable = Boolean(onOpenWindow) && col.count > 0;
          const Col: React.ElementType = clickable ? 'button' : 'div';
          const height = maxCount > 0 ? Math.max((col.count / maxCount) * 100, col.count > 0 ? 6 : 0) : 0;
          return (
            <Col
              key={col.key}
              type={clickable ? 'button' : undefined}
              onClick={clickable ? () => onOpenWindow?.(col.bands) : undefined}
              className={cn('ig-horizon-col', clickable && 'is-clickable')}
              title={
                `${col.label}: ${col.count} contrato(s)`
                + (col.exposure === null
                  ? ' · exposição não apurada'
                  : ` · ${moneyFull(col.exposure)} em jogo`)
              }
            >
              {/* A contagem fica SEMPRE visível: o gráfico é legível sem hover. */}
              <span className="ig-horizon-count ig-tabular">{col.count}</span>
              <span className="ig-horizon-track">
                {col.count === 0 ? (
                  <i data-empty="" />
                ) : (
                  <i
                    style={{ height: `${height}%`, background: TONE_FILL[col.tone] }}
                    data-unpriced={col.exposure === null ? '' : undefined}
                  />
                )}
              </span>
              <span className="ig-horizon-label">{col.label}</span>
              <span className={cn('ig-horizon-money ig-tabular', col.exposure === null && 'is-absent')}>
                {col.count === 0 ? '—' : money(col.exposure)}
              </span>
            </Col>
          );
        })}
      </div>

      <ChartCoverage>
        {`${totalEntries} contrato(s) em janela, cobertura ${horizon.coverage.counted}/${horizon.coverage.total}.`}
        {horizon.undatedContracts.length > 0
          && ` ${horizon.undatedContracts.length} sem vigência registrada — lacuna de cadastro, fora das janelas.`}
        {horizon.erroredContracts.length > 0
          && ` Leitura de vigência falhou em ${horizon.erroredContracts.length}.`}
      </ChartCoverage>
    </div>
  );
}
