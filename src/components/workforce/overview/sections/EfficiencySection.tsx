'use client';

/**
 * Seção 2 — Eficiência & Produtividade.
 *
 * Responde "quanto a empresa produz por pessoa e quanto disso a folha
 * consome". As três leituras dependem de receita; sem ela, a seção diz o que
 * falta em vez de desenhar um eixo vazio.
 */

import { WorkforceEfficiencyPanel } from '../../WorkforceEfficiencyPanel';
import { WorkforceSectionHeader } from '../WorkforceSectionHeader';
import { WorkforceEmptyPanel } from '../WorkforceEmptyPanel';
import type { WorkforceOverviewModel } from '@/lib/workforce/overview/types';

interface EfficiencySectionProps {
  model: WorkforceOverviewModel;
}

export function EfficiencySection({ model }: EfficiencySectionProps) {
  const { efficiency, concentration } = model;
  const hasSeries = efficiency.series.length > 0;

  return (
    <section id="wf-eficiencia" className="space-y-3">
      <WorkforceSectionHeader
        eyebrow="Seção 02"
        title="Eficiência & Produtividade"
        subtitle="Receita por colaborador, custo médio e a parcela da receita comprometida com a folha"
      />

      {hasSeries ? (
        <WorkforceEfficiencyPanel
          data={efficiency.series}
          currency={concentration.data.currency}
          threshold={efficiency.threshold}
        />
      ) : (
        <WorkforceEmptyPanel
          title="Eficiência não apurável no período"
          description={
            efficiency.payrollAsRevenuePct.measured
              ? 'Não há competências suficientes na série para desenhar a evolução.'
              : 'A eficiência compara folha com receita. Sem receita lançada no contas a receber para as competências do período, receita por colaborador e folha sobre receita ficam sem a segunda ponta — e um gráfico com zero afirmaria faturamento nulo, que é diferente de faturamento não lançado.'
          }
        />
      )}
    </section>
  );
}
