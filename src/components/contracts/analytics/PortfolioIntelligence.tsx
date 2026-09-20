'use client';

/**
 * INTELIGÊNCIA DA CARTEIRA — quatro gráficos, e só quatro.
 *
 * ─── A regra de admissão ───────────────────────────────────────────────────
 *
 * Um gráfico entra aqui quando responde uma pergunta que a lista ao lado não
 * responde e que muda uma decisão. Os quatro que passaram:
 *
 *   · CONTRATO → CAIXA   — quanto do contratado virou dinheiro, e onde parou.
 *   · BACKLOG DE RECEITA — o que trava o que ainda não virou.
 *   · EXPOSIÇÃO POR RISCO— onde está o dinheiro que pode dar errado.
 *   · HORIZONTE          — quando a carteira vence, e quanto está em jogo.
 *
 * O que NÃO entrou, e por quê: distribuição por tipo de contrato (não muda
 * decisão nenhuma), contratos por status (a tabela já diz, melhor), evolução
 * do número de contratos (vaidade), e qualquer rosca de sete categorias.
 *
 * ─── A grade ───────────────────────────────────────────────────────────────
 *
 * 7 + 5 na primeira linha: a cadeia contrato→caixa é a leitura financeira
 * principal da página e carrega uma curva além das barras — ela precisa da
 * largura. 6 + 6 na segunda: risco e horizonte são a mesma pergunta em dois
 * eixos, e dar peso diferente a uma delas sugeriria uma prioridade que não
 * existe.
 */

import { BarChart3, Receipt, ShieldAlert, CalendarClock } from 'lucide-react';
import { OverviewBlock } from '../cockpit/OverviewBlock';
import { PortfolioCashChart } from './PortfolioCashChart';
import { BillingBacklogChart } from './BillingBacklogChart';
import { RiskExposureChart } from './RiskExposureChart';
import { RenewalHorizonChart } from './RenewalHorizonChart';
import type { CashStage } from '@/lib/contracts/trust/contract-to-cash';
import type { CashTimeline } from '@/lib/contracts/analytics/cash-timeline';
import type { BacklogStageKey, BillingBacklog } from '@/lib/contracts/analytics/billing-backlog';
import type { RiskBandKey, RiskExposureBands } from '@/lib/contracts/analytics/risk-exposure-bands';
import type { HorizonBand, RenewalHorizon } from '@/lib/contracts/trust/renewal-horizon';

const ROW = 'grid items-stretch gap-5 xl:grid-cols-12';

export interface PortfolioIntelligenceProps {
  readonly cashStages: readonly CashStage[];
  readonly cashTimeline: CashTimeline;
  readonly backlog: BillingBacklog | null;
  readonly backlogLoading: boolean;
  readonly backlogError: string | null;
  readonly riskBands: RiskExposureBands;
  readonly renewal: RenewalHorizon;
  readonly activeRiskBand?: RiskBandKey | null;
  readonly onOpenBilling?: () => void;
  readonly onOpenBillingStage?: (stage: BacklogStageKey) => void;
  readonly onSelectRiskBand?: (band: RiskBandKey) => void;
  readonly onOpenRenewalWindow?: (bands: readonly HorizonBand[]) => void;
}

export function PortfolioIntelligence({
  cashStages, cashTimeline, backlog, backlogLoading, backlogError,
  riskBands, renewal, activeRiskBand,
  onOpenBilling, onOpenBillingStage, onSelectRiskBand, onOpenRenewalWindow,
}: PortfolioIntelligenceProps) {
  return (
    <section className="space-y-5" aria-label="Inteligência da carteira">
      <div className={ROW}>
        <OverviewBlock
          className="xl:col-span-7"
          title="Contrato → caixa"
          hint="do valor assinado ao dinheiro em conta"
          icon={<BarChart3 aria-hidden />}
          emphasis="primary"
          stretch
        >
          <PortfolioCashChart
            stages={cashStages}
            timeline={cashTimeline}
            onOpenBilling={onOpenBilling}
          />
        </OverviewBlock>

        <OverviewBlock
          className="xl:col-span-5"
          title="Backlog de receita"
          hint="o que trava o faturamento"
          icon={<Receipt aria-hidden />}
          stretch
        >
          <BillingBacklogChart
            backlog={backlog}
            loading={backlogLoading}
            error={backlogError}
            onOpenStage={onOpenBillingStage}
          />
        </OverviewBlock>
      </div>

      <div className={ROW}>
        <OverviewBlock
          className="xl:col-span-6"
          title="Exposição por risco"
          hint="contratos e valor por classificação"
          icon={<ShieldAlert aria-hidden />}
          stretch
        >
          <RiskExposureChart
            bands={riskBands}
            onSelectBand={onSelectRiskBand}
            activeBand={activeRiskBand}
          />
        </OverviewBlock>

        <OverviewBlock
          className="xl:col-span-6"
          title="Horizonte de renovação"
          hint="vencimentos e valor em jogo"
          icon={<CalendarClock aria-hidden />}
          stretch
        >
          <RenewalHorizonChart horizon={renewal} onOpenWindow={onOpenRenewalWindow} />
        </OverviewBlock>
      </div>
    </section>
  );
}
