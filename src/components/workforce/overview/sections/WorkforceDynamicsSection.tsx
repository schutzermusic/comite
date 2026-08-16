'use client';

/**
 * Seção 3 — Dinâmica do quadro.
 *
 * Movimentação, rotatividade, absenteísmo e horas extras, mais a distribuição
 * por lotação. Antes eram duas seções separadas ("Dinâmica de Headcount" e
 * "Distribuição por Área") que respondiam à mesma pergunta em dois lugares —
 * quem entra, quem sai, quem falta, e onde isso se concentra.
 */

import { HeadcountDynamicsPanel } from '../../HeadcountDynamicsPanel';
import { TurnoverByAreaPanel } from '../../TurnoverByAreaPanel';
import { WorkforceSectionHeader } from '../WorkforceSectionHeader';
import { WorkforceEmptyPanel } from '../WorkforceEmptyPanel';
import type { WorkforceOverviewModel } from '@/lib/workforce/overview/types';

interface WorkforceDynamicsSectionProps {
  model: WorkforceOverviewModel;
}

export function WorkforceDynamicsSection({ model }: WorkforceDynamicsSectionProps) {
  const { dynamics } = model;

  const hasMovement =
    dynamics.movement.length > 0 ||
    dynamics.turnover.length > 0 ||
    dynamics.absenteeismByArea.length > 0 ||
    dynamics.overtime.length > 0;

  const hasAreaBreakdown =
    dynamics.turnoverByArea.length > 0 || dynamics.absenteeismMonthly.length > 0;

  return (
    <section id="wf-dinamica" className="space-y-3">
      <WorkforceSectionHeader
        eyebrow="Seção 03"
        title="Dinâmica do Quadro"
        subtitle="Admissões e desligamentos, rotatividade, absenteísmo e horas extras — e onde se concentram"
      />

      {hasMovement ? (
        <HeadcountDynamicsPanel
          admissions={dynamics.movement}
          turnover={dynamics.turnover}
          absenteeism={dynamics.absenteeismByArea}
          overtime={dynamics.overtime}
        />
      ) : (
        <WorkforceEmptyPanel
          title="Movimentação não apurada"
          description="Admissões, desligamentos e afastamentos vêm dos eventos do eSocial (S-2200, S-2299 e S-2230). Nenhuma competência do período trouxe esses eventos apurados."
        />
      )}

      {hasAreaBreakdown && (
        <TurnoverByAreaPanel
          turnoverByArea={dynamics.turnoverByArea}
          absenteeismMonthly={dynamics.absenteeismMonthly}
        />
      )}
    </section>
  );
}
