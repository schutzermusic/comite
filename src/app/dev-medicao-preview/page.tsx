'use client';

/**
 * Harness visual da aba MEDIÇÃO & FATURAMENTO — DEV ONLY.
 *
 * Mesmo motivo de `dev-cockpit-preview` e `dev-intelligence-preview`:
 * inspecionar hierarquia, densidade, contraste, paridade claro/escuro e
 * comportamento responsivo sem depender de base semeada nem de sessão.
 *
 * ─── Por que a fixture é a real ────────────────────────────────────────────
 *
 * As seis linhas abaixo são a leitura EXATA de `contract_milestone_workbench`
 * para JA10182283/2025 em 17.09.2026: direito registrado, exigência registrada,
 * mapeamento de cronograma ausente, medição ausente, faturamento ausente. Se
 * alguém quebrar a derivação e os marcos passarem a aparecer como "pronto para
 * medir", isso aparece NA TELA — e não só num teste.
 *
 * O segundo bloco é sintético e existe para exercitar os estágios que o
 * contrato real ainda não alcançou. Está rotulado como tal na página, para que
 * ninguém o confunda com dado de produção.
 *
 * Não é rota de produto e não aparece na navegação.
 */

import { useState } from 'react';
import { notFound } from 'next/navigation';
import { HudPageLayout } from '@/components/hud';
import { CashPipeline } from '@/components/contracts/billing/CashPipeline';
import { ExposureRail, type ExposureMetric } from '@/components/contracts/billing/ExposureRail';
import { MilestoneBoard } from '@/components/contracts/measurement/MilestoneBoard';
import { GuidedEmpty } from '@/components/contracts/shell/GuidedEmpty';
import { DossierSection } from '@/components/contracts/shell/DossierPrimitives';
import {
  computeExposure, computeRevenueBlock, diagnoseBottleneck, reconcileEntitlement,
} from '@/lib/contracts/measurement/milestone-exposure';
import type { MilestoneWorkbenchRow } from '@/lib/contracts/measurement/milestone-workbench-types';
import type { CashStage } from '@/lib/contracts/trust/contract-to-cash';
import { derived, missing } from '@/lib/contracts/trust/trusted';

const CONTRACT_TOTAL = 8032339.76;
const PROJECT_ID = 'proj-3a445bb5-c576-445d-bb49-adcddd52dc1d';

/** Base da fixture: tudo que o contrato afirma, nada que a operação não afirmou. */
const row = (over: Partial<MilestoneWorkbenchRow>): MilestoneWorkbenchRow => ({
  id: 'x', organizationId: 'ea674f46', contractId: '0a795a7b', projectId: PROJECT_ID,
  title: 'Evento', description: null, milestoneType: 'evento_contratual',
  status: 'pending', dueDate: null, completedAt: null,
  billingAmount: 0, measuredAmount: null,
  ownerUserId: null, evidence: null, evidenceDocumentId: null,
  entitlementAmount: 0, entitlementCurrency: 'BRL',
  entitlementSourceDocumentId: '3665b62e', entitlementSourcePage: 1,
  entitlementSourceReference: 'Parte A, item 4', entitlementRuleCount: 1,
  requirementId: 'req', requirementCount: 1,
  customerAcceptanceRequired: true, evidenceRequired: true,
  requiredDocumentType: 'boletim_medicao', reportRequired: false, technicalReportRequired: false,
  governedMappingCount: 0, timelineItemId: null, timelineProjectId: null,
  timelineTitle: null, timelineWbsCode: null, timelineStatus: null,
  timelinePercentComplete: null, timelinePlannedFinish: null, timelineActualFinish: null,
  measurementId: null, measurementStatus: null, measurementReadiness: null,
  measurementReadinessReasons: [], measurementExpectedAt: null,
  measurementSubmittedAt: null, measurementAcceptedAt: null,
  acceptedValue: null, acceptedCurrency: null,
  measurementEvidenceCount: null, measurementMissingRequirementCount: null,
  billingEventId: null, billingEligibilityState: null, billingReleaseState: null,
  billingEligibleAmount: null, billingCurrency: null, billingAmountSource: null,
  billingFiscalDocumentStatus: null, billingReceivableStatus: null, billingFinanceLinkState: null,
  ...over,
});

/** Os 6 eventos reais, exatamente como a bancada os devolve hoje. */
const REAL: MilestoneWorkbenchRow[] = [
  ['e1', 'Evento 01 · Na assinatura do contrato e liberação para início', 803233.98],
  ['e2', 'Evento 02 · No transporte do equipamento para nossa fábrica (CIF)', 1606467.95],
  ['e3', 'Evento 03 · Sacar bobinas | Pedido de materiais', 2008084.94],
  ['e4', 'Evento 04 · Apresentação dos materiais em fábrica e projetos/ desenhos', 2008084.94],
  ['e5', 'Evento 05 · Montagem e fechamento do enrolamento estatórico', 803233.98],
  ['e6', 'Evento 06 · Na entrega do relatório final', 803233.98],
].map(([id, title, amount]) => row({
  id: id as string, title: title as string,
  billingAmount: amount as number, entitlementAmount: amount as number,
}));

/** SINTÉTICO — só para inspecionar os estágios que o contrato real não alcançou. */
const SYNTHETIC: MilestoneWorkbenchRow[] = [
  row({
    id: 's1', title: 'Evento 01 · Mobilização documental', billingAmount: 120000,
    entitlementAmount: 120000, governedMappingCount: 1, timelineItemId: 't1',
    timelineProjectId: PROJECT_ID, timelineTitle: 'Mobilização', timelineWbsCode: '1.1',
    timelineStatus: 'in_progress', timelinePercentComplete: 60,
    dueDate: '2026-12-01', ownerUserId: 'u1', evidence: 'Ofício de mobilização',
  }),
  row({
    id: 's2', title: 'Evento 02 · Transporte do estator', billingAmount: 340000,
    entitlementAmount: 340000, governedMappingCount: 1, timelineItemId: 't2',
    timelineProjectId: PROJECT_ID, timelineTitle: 'Transporte', timelineWbsCode: '3.2.1',
    timelineStatus: 'completed', timelineActualFinish: '2026-08-20',
    dueDate: '2026-08-15', ownerUserId: 'u1',
  }),
  row({
    id: 's3', title: 'Evento 03 · Sacar bobinas', billingAmount: 510000,
    entitlementAmount: 510000, governedMappingCount: 1, timelineItemId: 't3',
    timelineProjectId: PROJECT_ID, timelineTitle: 'Retirada', timelineWbsCode: '4.1',
    timelineStatus: 'completed', timelineActualFinish: '2026-09-01',
    measurementId: 'me3', measurementStatus: 'IN_PREPARATION', measurementReadiness: 'INCOMPLETE',
    measurementEvidenceCount: 0, ownerUserId: 'u2',
  }),
  row({
    id: 's4', title: 'Evento 04 · Apresentação dos materiais', billingAmount: 510000,
    entitlementAmount: 510000, governedMappingCount: 1, timelineItemId: 't4',
    timelineProjectId: PROJECT_ID, timelineTitle: 'Materiais', timelineWbsCode: '4.3',
    timelineStatus: 'completed', timelineActualFinish: '2026-09-05',
    measurementId: 'me4', measurementStatus: 'SUBMITTED', measurementReadiness: 'READY',
    measurementSubmittedAt: '2026-09-06T10:00:00Z', measurementEvidenceCount: 3, ownerUserId: 'u2',
  }),
  row({
    id: 's5', title: 'Evento 05 · Montagem do enrolamento', billingAmount: 200000,
    entitlementAmount: 200000, status: 'measured', measuredAmount: 198500,
    governedMappingCount: 1, timelineItemId: 't5', timelineProjectId: PROJECT_ID,
    timelineTitle: 'Montagem', timelineWbsCode: '6.1', timelineStatus: 'completed',
    timelineActualFinish: '2026-09-10',
    measurementId: 'me5', measurementStatus: 'ACCEPTED', measurementReadiness: 'READY',
    measurementAcceptedAt: '2026-09-12T10:00:00Z', acceptedValue: 198500,
    acceptedCurrency: 'BRL', measurementEvidenceCount: 5, ownerUserId: 'u3',
  }),
  row({
    id: 's6', title: 'Evento 06 · Relatório final', billingAmount: 150000,
    entitlementAmount: 150000, status: 'approved', measuredAmount: 150000,
    governedMappingCount: 1, timelineItemId: 't6', timelineProjectId: PROJECT_ID,
    timelineTitle: 'Relatório', timelineWbsCode: '9.9', timelineStatus: 'completed',
    timelineActualFinish: '2026-09-14', acceptedValue: 150000, acceptedCurrency: 'BRL',
    billingEventId: 'be6', billingEligibilityState: 'ELIGIBLE', billingReleaseState: 'RELEASED',
    billingEligibleAmount: 150000, billingCurrency: 'BRL',
    billingAmountSource: 'ACCEPTED_MEASUREMENT', ownerUserId: 'u3',
    measurementEvidenceCount: 7,
  }),
  row({
    id: 's7', title: 'Evento 07 · Ensaios finais', billingAmount: 90000,
    entitlementAmount: 90000, governedMappingCount: 1, timelineItemId: 't7',
    timelineProjectId: PROJECT_ID, timelineTitle: 'Ensaios', timelineWbsCode: '8.4',
    timelineStatus: 'blocked', timelineActualFinish: '2026-09-02',
    measurementId: 'me7', measurementStatus: 'IN_PREPARATION', measurementReadiness: 'BLOCKED',
    measurementReadinessReasons: ['missing_required_evidence'],
    dueDate: '2026-09-01', ownerUserId: 'u1',
  }),
  row({
    id: 's8', title: 'Evento 08 · Sobressalentes', billingAmount: 60000,
    entitlementAmount: null, entitlementRuleCount: 0,
    requirementId: null, requirementCount: 0, evidenceRequired: null,
  }),
];

/** A esteira, na forma que o contrato real produz hoje. */
const REAL_STAGES: CashStage[] = [
  {
    key: 'contracted', label: 'Contratado',
    amount: derived(CONTRACT_TOTAL, { rule: 'valor registrado do contrato', from: ['contracts'] }),
    count: derived(1, { rule: 'o próprio contrato', from: ['contracts'] }),
    state: 'measured', note: null, shareOfContracted: 1,
  },
  {
    key: 'measured', label: 'Medido',
    amount: missing<number>('no-rows'), count: derived(0, { rule: 'marcos medidos', from: ['contract_milestones'] }),
    state: 'unmeasured',
    note: 'Nenhum dos 6 marcos registrados foi medido. Zero marcos medidos não é R$ 0 medido: é ausência de apuração.',
    shareOfContracted: null,
  },
  {
    key: 'approved', label: 'Aprovado',
    amount: missing<number>('no-rows'), count: missing<number>('no-rows'),
    state: 'unmeasured', note: 'Nenhuma etapa de alçada registrada.', shareOfContracted: null,
  },
  {
    key: 'billed', label: 'Faturado',
    amount: missing<number>('no-rows'), count: missing<number>('no-rows'),
    state: 'unmeasured',
    note: 'Nenhum evento de faturamento registrado. Zero eventos não é R$ 0 faturado.',
    shareOfContracted: null,
  },
  {
    key: 'received', label: 'Recebido',
    amount: missing<number>('not-integrated'), count: missing<number>('not-integrated'),
    state: 'not-integrated',
    note: 'O razão financeiro não está conciliado com os eventos de faturamento.',
    shareOfContracted: null,
  },
];

function Scenario({
  title, note, rows, stages, total, hasTimeline,
}: {
  title: string; note: string;
  rows: MilestoneWorkbenchRow[]; stages: CashStage[];
  total: number | null; hasTimeline: boolean;
}) {
  const exposure = computeExposure(rows);
  const block = computeRevenueBlock(rows, total);
  const diagnosis = diagnoseBottleneck(rows, PROJECT_ID, hasTimeline);
  const reconciliation = reconcileEntitlement(total, exposure.entitlementTotal);

  const metrics: ExposureMetric[] = [
    { key: 'contracted', label: 'Contratado', value: total, source: 'contracts.total_value', emphasis: true },
    { key: 'entitlement', label: 'Direito contratual', value: exposure.entitlementTotal, source: 'entitlement_rules', absentLabel: 'Sem registro', emphasis: true },
    { key: 'measured', label: 'Medido', value: exposure.measuredTotal, source: 'marcos apurados' },
    { key: 'accepted', label: 'Aceito', value: exposure.acceptedTotal, source: 'medição aceita' },
    { key: 'billed', label: 'Faturado', value: exposure.billedTotal, source: 'billing_events' },
    { key: 'received', label: 'Recebido', value: null, source: 'razão financeiro', absentLabel: 'Não integrado' },
  ];

  return (
    <section className="space-y-5">
      <header className="border-b border-ig-border-subtle pb-3">
        <h2 className="text-ig-body font-semibold text-ig-fg-strong">{title}</h2>
        <p className="mt-1 text-ig-caption text-ig-fg-muted">{note}</p>
      </header>

      <CashPipeline stages={stages} bottleneckNote={diagnosis?.note ?? null} />

      <ExposureRail
        metrics={metrics}
        segments={[
          { key: 'accepted', label: 'Aceito', amount: block.accepted },
          { key: 'measured_pending', label: 'Apurado, aguardando aceite', amount: block.measuredPending },
          { key: 'unassessed', label: 'Não apurado', amount: block.unassessed, absent: true },
        ]}
        base={total}
        reconciliation={reconciliation}
      />

      <MilestoneBoard
        rows={rows}
        contractTotal={total}
        projectId={PROJECT_ID}
        canEdit
        onCreate={() => {}}
        onAction={() => {}}
        onEdit={() => {}}
      />
    </section>
  );
}

export default function DevMedicaoPreview() {
  if (process.env.NODE_ENV === 'production') notFound();
  const [showSynthetic, setShowSynthetic] = useState(true);

  return (
    <HudPageLayout className="ig-dossier-page ig-dossier-theme">
      <div className="mx-auto max-w-[1180px] space-y-9 px-6 py-8">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-ig-h3 font-semibold text-ig-fg-strong">
              Medição &amp; Faturamento — harness visual
            </h1>
            <p className="mt-1 text-ig-caption text-ig-fg-muted">
              Rota de desenvolvimento. Não aparece na navegação e não existe em produção.
            </p>
          </div>
          <button
            type="button"
            className="dossier-empty-action"
            onClick={() => setShowSynthetic((v) => !v)}
          >
            {showSynthetic ? 'Ocultar' : 'Mostrar'} cenário sintético
          </button>
        </div>

        <Scenario
          title="JA10182283/2025 — leitura real (17.09.2026)"
          note="Direito e exigência registrados; cronograma, medição e faturamento ausentes. Os 6 eventos permanecem NÃO APURADOS."
          rows={REAL}
          stages={REAL_STAGES}
          total={CONTRACT_TOTAL}
          hasTimeline={false}
        />

        {showSynthetic && (
          <Scenario
            title="Cenário SINTÉTICO — estágios que o contrato real ainda não alcançou"
            note="Dados fabricados apenas para inspeção visual dos estágios mapeado, pronto para medir, em aceite, bloqueado, elegível e faturado. Não é dado de produção."
            rows={SYNTHETIC}
            stages={REAL_STAGES}
            total={1980000}
            hasTimeline
          />
        )}

        <DossierSection title="Vazio guiado" hint="Como a aba explica uma ausência.">
          <GuidedEmpty
            title="Nenhuma medição operacional para este contrato"
            cause="As 6 exigências de medição deste contrato não geraram instâncias porque o projeto vinculado não possui itens de cronograma."
            consequence="Sem etapa mapeada, o Apex não cria medição — e nenhum marco pode sair de 'não apurado'."
            chain={['Exigência ✓', 'Cronograma ✗', 'Medição —', 'Faturamento —']}
            primary={{ label: 'Importar cronograma', href: `/projetos/${PROJECT_ID}?tab=timeline` }}
            secondary={{ label: 'Ver projeto vinculado', href: `/projetos/${PROJECT_ID}` }}
          />
        </DossierSection>
      </div>
    </HudPageLayout>
  );
}
