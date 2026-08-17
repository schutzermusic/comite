'use client';

/**
 * Seção 7 — Simulador de contratação.
 *
 * A única seção que projeta em vez de apurar, e por isso fecha a página: tudo
 * acima é o que aconteceu, isto é o que aconteceria.
 *
 * As sementes vêm do modelo como `Measured`. A página alimentava o simulador
 * com `latestEfficiency?.revenue ?? 0`, e uma receita ausente virava receita
 * zero — a simulação então mostrava qualquer contratação estourando o limite
 * de folha sobre receita, por um motivo que ninguém tinha medido. Sem semente
 * apurada, a seção pede o número em vez de supor.
 */

import { HiringSimulatorExpanded } from '../../HiringSimulatorExpanded';
import { WorkforceSectionHeader } from '../WorkforceSectionHeader';
import { WorkforceEmptyPanel } from '../WorkforceEmptyPanel';
import type { WorkforceOverviewModel } from '@/lib/workforce/overview/types';

interface SimulatorSectionProps {
  model: WorkforceOverviewModel;
}

export function SimulatorSection({ model }: SimulatorSectionProps) {
  const { simulator } = model;

  // O custo médio é a semente mínima: sem ele não há o que simular.
  const canSimulate = simulator.avgCostPerEmployee.measured;

  return (
    <section id="wf-simulador" className="space-y-3">
      <WorkforceSectionHeader
        eyebrow="Seção 07"
        title="Simulador de contratação"
        subtitle="Impacto de novas contratações sobre folha, margem e o limite de folha sobre receita"
      />

      {canSimulate ? (
        <>
          {!simulator.currentRevenue.measured && (
            <p className="rounded-lg border border-ig-warning/25 bg-ig-warning/[0.05] px-3.5 py-2 text-[11.5px] leading-relaxed text-ig-fg-muted">
              Sem receita apurada no período, a simulação projeta apenas o efeito sobre a folha —
              o impacto sobre margem e sobre o limite de folha/receita fica fora do alcance.
            </p>
          )}
          <HiringSimulatorExpanded
            initialAvgCost={simulator.avgCostPerEmployee.value}
            currentPayroll={
              simulator.currentPayroll.measured ? simulator.currentPayroll.value : undefined
            }
            currentRevenue={
              simulator.currentRevenue.measured ? simulator.currentRevenue.value : undefined
            }
            currentHeadcount={
              simulator.currentHeadcount.measured ? simulator.currentHeadcount.value : undefined
            }
            payrollRevenueThreshold={simulator.payrollRevenueThreshold}
          />
        </>
      ) : (
        <WorkforceEmptyPanel
          title="Simulação indisponível"
          description="O simulador parte do custo médio por colaborador, que precisa de folha e quadro apurados na mesma competência. Sem essa base, qualquer projeção partiria de um número inventado."
        />
      )}
    </section>
  );
}
