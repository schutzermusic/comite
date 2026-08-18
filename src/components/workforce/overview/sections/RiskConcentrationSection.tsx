'use client';

/**
 * Seção 5 — Risco & Concentração.
 *
 * Duas perguntas com a mesma raiz: a folha está crescendo mais rápido que a
 * receita, e ela depende demais de poucos centros?
 *
 * O score de risco só aparece quando é apurável. Sem receita lançada, o
 * diagnóstico seria a folha comparada a zero — e "Atenção 70/100" é um
 * veredito, não um espaço em branco elegante. O modelo devolve
 * `risk.score` não apurado, e a seção diz isso com todas as letras.
 */

import { CostConcentrationPanel } from '../../CostConcentrationPanel';
import { PayrollRiskIndicator } from '../../PayrollRiskIndicator';
import { WorkforceTrendChart } from '../../WorkforceTrendChart';
import { CostCenterDrilldown } from '../../CostCenterDrilldown';
import { WorkforceSectionHeader } from '../WorkforceSectionHeader';
import { WorkforceEmptyPanel } from '../WorkforceEmptyPanel';
import type { WorkforceOverviewModel } from '@/lib/workforce/overview/types';

interface RiskConcentrationSectionProps {
  model: WorkforceOverviewModel;
}

export function RiskConcentrationSection({ model }: RiskConcentrationSectionProps) {
  const { concentration, executive, costStructure } = model;
  const trend = costStructure.trend;
  const hasCostCenters = concentration.data.costCenters.length > 0;
  const riskApurable = executive.risk.score.measured;

  return (
    <section id="wf-risco" className="space-y-3">
      <WorkforceSectionHeader
        eyebrow="Seção 05"
        title="Risco & Concentração"
        subtitle="Pressão da folha sobre a receita e dependência dos maiores centros de custo"
      />

      {concentration.drilldown && (
        <CostCenterDrilldown
          costCenter={concentration.drilldown}
          currency={concentration.data.currency}
        />
      )}

      <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-2">
        {riskApurable ? (
          <PayrollRiskIndicator data={executive.risk.raw} />
        ) : (
          <WorkforceEmptyPanel
            title="Risco de folha não apurável"
            description="O score compara o crescimento da folha com o crescimento da receita. Sem a segunda ponta lançada no contas a receber, qualquer nota seria a folha comparada a zero — um veredito sem base."
            minHeight={240}
          />
        )}

        {trend.length >= 2 ? (
          <WorkforceTrendChart data={trend} currency={concentration.data.currency} />
        ) : (
          <WorkforceEmptyPanel
            title="Tendência indisponível"
            description="A evolução precisa de pelo menos duas competências apuradas no período selecionado."
            minHeight={240}
          />
        )}
      </div>

      {hasCostCenters ? (
        <CostConcentrationPanel
          data={concentration.data}
          hasBaseline={concentration.hasBaseline}
        />
      ) : (
        <WorkforceEmptyPanel
          title="Sem abertura por centro de custo"
          description="A concentração vem do rateio do lote de folha aprovado ou da lotação tributária apurada no eSocial. Nenhuma das duas trouxe abertura para as competências do período."
        />
      )}
    </section>
  );
}
