'use client';

/**
 * Seção 6 — Conformidade.
 *
 * O ciclo obrigatório folha → eSocial → guias. É a seção que sustenta todas as
 * outras: cada indicador do cockpit só fecha quando este ciclo fecha, e um mês
 * com folha importada mas sem envio é um mês cujos números ainda podem mudar.
 */

import { PayrollCompliancePanel } from '../../PayrollCompliancePanel';
import { ManualHeadcountPanel } from '../../ManualHeadcountPanel';
import { WorkforceSectionHeader } from '../WorkforceSectionHeader';
import type { ManualHeadcountPanelProps } from '../../ManualHeadcountPanel';
import type { WorkforceOverviewModel } from '@/lib/workforce/overview/types';

interface ComplianceSectionProps {
  model: WorkforceOverviewModel;
  loading?: boolean;
  onSyncEsocial?: () => void;
  /** Ajuste manual de quadro — só administrador, e só quando há competência. */
  manualHeadcount?: ManualHeadcountPanelProps;
}

export function ComplianceSection({
  model,
  loading,
  onSyncEsocial,
  manualHeadcount,
}: ComplianceSectionProps) {
  return (
    <section id="wf-conformidade" className="space-y-3">
      <WorkforceSectionHeader
        eyebrow="Seção 06"
        title="Folha, eSocial & Guias"
        subtitle="Estado do envio da competência — cada indicador acima só fecha quando este ciclo fecha"
      />

      <PayrollCompliancePanel
        snapshot={model.compliance.snapshot}
        loading={loading}
        onSyncEsocial={onSyncEsocial}
      />

      {manualHeadcount && (
        <div id="wf-ajuste-quadro" className="space-y-2 pt-1">
          <WorkforceSectionHeader
            title="Ajuste manual de quadro"
            subtitle="Para competências em que o eSocial não entregou o detalhe por trabalhador — restrito a administradores"
          />
          <ManualHeadcountPanel {...manualHeadcount} />
        </div>
      )}
    </section>
  );
}
