'use client';

/**
 * Seção 4 — Estrutura de custo.
 *
 * Como a folha se compõe e como evolui: salário, benefícios e encargos, Curva
 * S acumulada, comparativo com receita e a matriz mês a mês.
 *
 * A matriz é tabela de propósito. Ela é a única leitura do cockpit que suporta
 * uma janela longa sem virar sopa de rótulos — os gráficos têm teto de 24
 * competências justamente porque a tabela cobre o resto.
 */

import { PayrollEvolutionPanel } from '../../PayrollEvolutionPanel';
import { WorkforceIndicatorMatrix } from '../../WorkforceIndicatorMatrix';
import { WorkforceSectionHeader } from '../WorkforceSectionHeader';
import { WorkforceEmptyPanel } from '../WorkforceEmptyPanel';
import type { WorkforceOverviewModel } from '@/lib/workforce/overview/types';

interface CostStructureSectionProps {
  model: WorkforceOverviewModel;
}

export function CostStructureSection({ model }: CostStructureSectionProps) {
  const { costStructure, concentration, scope } = model;

  const hasEvolution =
    costStructure.composition.length > 0 ||
    costStructure.scurve.length > 0 ||
    costStructure.vsRevenue.length > 0 ||
    costStructure.benefits.length > 0;

  return (
    <section id="wf-custo" className="space-y-3">
      <WorkforceSectionHeader
        eyebrow="Seção 04"
        title="Estrutura de Custo"
        subtitle="Composição da folha, Curva S acumulada, comparativo com receita e benefícios por natureza"
      />

      {hasEvolution ? (
        <PayrollEvolutionPanel
          composition={costStructure.composition}
          scurve={costStructure.scurve}
          vsRevenue={costStructure.vsRevenue}
          benefits={costStructure.benefits}
          currency={concentration.data.currency}
        />
      ) : (
        <WorkforceEmptyPanel
          title="Composição da folha não classificada"
          description={
            scope.filters.unitIds.length > 0
              ? 'A composição é apurada para a competência inteira e não se reparte por lotação. Remova o recorte para vê-la.'
              : 'Separar salário, benefícios e encargos depende da tabela de rubricas do eSocial (S-1010) classificando a folha. Sem ela, as verbas não são identificáveis — e distribuí-las por percentual seria inventar a composição.'
          }
        />
      )}

      {costStructure.matrix.rows.length > 0 && (
        <div className="space-y-2 pt-1">
          <WorkforceSectionHeader
            title="Matriz mensal de indicadores"
            subtitle="Uma linha por competência — indicadores do cockpit e estado do envio da folha e das guias"
          />
          <WorkforceIndicatorMatrix
            matrix={costStructure.matrix}
            compliance={model.compliance.byCompetence}
          />
        </div>
      )}
    </section>
  );
}
