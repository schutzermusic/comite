'use client';

/**
 * Seção 6 — Conformidade.
 *
 * O ciclo obrigatório folha → eSocial → guias. É a seção que sustenta todas as
 * outras: cada indicador do cockpit só fecha quando este ciclo fecha, e um mês
 * com folha importada mas sem envio é um mês cujos números ainda podem mudar.
 */

import { PayrollCompliancePanel } from '../../PayrollCompliancePanel';
import { WorkforceSectionHeader } from '../WorkforceSectionHeader';
import type { WorkforceOverviewModel } from '@/lib/workforce/overview/types';

interface ComplianceSectionProps {
  model: WorkforceOverviewModel;
  loading?: boolean;
  onSyncEsocial?: () => void;
}

export function ComplianceSection({ model, loading, onSyncEsocial }: ComplianceSectionProps) {
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
    </section>
  );
}
