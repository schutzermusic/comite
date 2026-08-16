'use client';

/**
 * Pessoas & Custos — Visão Geral.
 *
 * Cockpit executivo de workforce em sete seções, com uma ordem de leitura
 * deliberada: resumo → eficiência → dinâmica → custo → risco → conformidade →
 * simulação. Do resumo até o risco a página conta o que aconteceu; a
 * conformidade explica o quanto disso já está fechado; o simulador é o único
 * bloco que projeta.
 *
 * Toda a composição de dados vive em `useWorkforceOverview`, que devolve UM
 * modelo — o mesmo consumido pelo PDF, pelo deck HTML e pelo PowerPoint. Esta
 * página não calcula indicador nenhum; ela dispõe seções.
 */

import { Suspense, useCallback, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowRight, FileSpreadsheet, Users } from 'lucide-react';

import { useCurrentUser } from '@/hooks/use-current-user';
import { hasAnyPermission, hasPermission } from '@/lib/auth/permissions';
import { useWorkforceOverview } from '@/hooks/use-workforce-overview';

import {
  CollapsibleDetailPanel,
  EsocialCoverageNotice,
  WorkforceEmptyState,
} from '@/components/workforce';
import {
  ComplianceSection,
  CostStructureSection,
  EfficiencySection,
  ExecutiveSummarySection,
  RiskConcentrationSection,
  SectionNavStrip,
  SimulatorSection,
  WorkforceCommandBar,
  WorkforceDynamicsSection,
  WorkforceExportMenu,
  WorkforceScopeNotice,
  WorkforceSectionHeader,
} from '@/components/workforce/overview';

import { openWorkforceOverviewPdf } from '@/lib/reports/modules/workforce-overview-report';
import {
  buildWorkforceOverviewPresentationHtml,
  downloadWorkforceOverviewHtml,
} from '@/lib/workforce/overview/report/presentation';
import { WorkforcePresentationOverlay } from '@/components/workforce/overview/WorkforcePresentationOverlay';
import type { WorkforceReportTheme } from '@/lib/workforce/overview/types';

import { HudButton, HudHeader, HudPageLayout } from '@/components/hud';

const PAYROLL_PERMS = [
  'people.payroll_close',
  'people.payroll_send',
  'people.payroll_send_sensitive',
];

function WorkforceCostPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const costCenterId = searchParams.get('costCenterId');

  const { roles, permissions } = useCurrentUser();
  const canSeePayroll =
    roles.some((r) => r.key === 'owner_admin') ||
    hasPermission(permissions, 'admin.manage_users') ||
    hasAnyPermission(permissions, PAYROLL_PERMS);
  const canManageIntegrations =
    roles.some((r) => r.key === 'owner_admin') ||
    hasPermission(permissions, 'admin.manage_integrations');

  const [reportTheme, setReportTheme] = useState<WorkforceReportTheme>('dark');
  const [presentationHtml, setPresentationHtml] = useState<string | null>(null);

  const {
    model,
    loading,
    period,
    setPeriod,
    comparison,
    setComparison,
    filters,
    setFilters,
    rawSeries,
    reloadEsocial,
    saveManualHeadcount,
    removeManualHeadcount,
    adjustableCompetences,
  } = useWorkforceOverview({ canSeePayroll, drilldownCostCenterId: costCenterId });

  const { meta, scope, compliance } = model;
  const hasData = scope.hasData;

  // Fecha sobre o modelo ATUAL: o documento reflete sempre o período, o
  // recorte e a comparação que estão na tela neste momento.
  const buildPdf = useMemo(
    () => () => openWorkforceOverviewPdf(model, { theme: reportTheme }),
    [model, reportTheme],
  );

  /**
   * O PowerPoint envia o MODELO para o servidor em vez de pedir que ele
   * re-derive: dois caminhos de cálculo divergiriam, e o slide passaria a
   * mostrar número que a tela não mostrou.
   */
  const downloadPptx = useCallback(async () => {
    const res = await fetch('/api/workforce/overview/pptx', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? 'Falha ao gerar o PowerPoint.');
    }
    const disposition = res.headers.get('content-disposition') ?? '';
    const match = /filename="([^"]+)"/.exec(disposition);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = match?.[1] ?? 'relatorio-pessoas-e-custos.pptx';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [model]);

  return (
    <HudPageLayout maxWidth="2xl">
      <HudHeader
        title="Pessoas & Custos"
        subtitle="Cockpit executivo de workforce — custo, eficiência, risco e conformidade"
        icon={<Users className="h-5 w-5" />}
        iconTint="#10B981"
        breadcrumbs={[{ label: 'Pessoas & Custos' }]}
        statusChips={[
          { label: meta.periodLabel, variant: 'info' },
          // Sem receita não há risco de folha a pontuar. O chip diz isso em vez
          // de exibir "Saudável 0/100", que afirmaria o contrário.
          model.executive.risk.score.measured
            ? {
                label: `Risco de folha ${model.executive.risk.score.value}/100`,
                variant:
                  model.executive.risk.raw.status === 'healthy'
                    ? ('success' as const)
                    : model.executive.risk.raw.status === 'attention'
                      ? ('warning' as const)
                      : ('critical' as const),
              }
            : { label: 'risco de folha não apurado', variant: 'neutral' as const },
          {
            label: `Conformidade ${compliance.snapshot.score}/100`,
            variant:
              compliance.snapshot.score >= 85
                ? ('success' as const)
                : compliance.snapshot.score >= 60
                  ? ('warning' as const)
                  : ('critical' as const),
          },
          {
            label: compliance.esocialLink.connected
              ? `eSocial ${compliance.esocialLink.automationEnabled ? 'ao vivo' : 'manual'}`
              : 'eSocial off',
            variant: compliance.esocialLink.connected
              ? compliance.esocialLink.automationEnabled
                ? ('success' as const)
                : ('warning' as const)
              : ('neutral' as const),
          },
          hasData
            ? { label: 'folha importada', variant: 'success' as const }
            : { label: 'sem competência apurada', variant: 'neutral' as const },
        ]}
      />

      <WorkforceCommandBar
        period={period}
        onPeriodChange={setPeriod}
        comparison={comparison}
        onComparisonChange={setComparison}
        filters={filters}
        onFiltersChange={setFilters}
        units={scope.allUnits}
        series={rawSeries}
        reportTheme={reportTheme}
        onReportThemeChange={setReportTheme}
        exportSlot={
          <WorkforceExportMenu
            buildPdf={buildPdf}
            buildPresentation={() => buildWorkforceOverviewPresentationHtml(model)}
            onPresent={setPresentationHtml}
            downloadPptx={downloadPptx}
            disabled={!hasData}
          />
        }
      />

      {presentationHtml && (
        <WorkforcePresentationOverlay
          html={presentationHtml}
          onClose={() => setPresentationHtml(null)}
          onDownload={() => downloadWorkforceOverviewHtml(model)}
        />
      )}

      {/* Procedência antes dos números: um mês incompleto e um mês completo são
          indistinguíveis quando só o valor aparece. */}
      {hasData && compliance.esocialLink.connected && meta.coverage.measured && (
        <EsocialCoverageNotice coverage={meta.coverage.value} />
      )}

      {/* O que o recorte custou — só aparece quando um filtro derrubou algo. */}
      <WorkforceScopeNotice degradations={scope.degradations} />

      {/* Sem nenhuma fonte real não há cockpit: o vazio é a leitura correta. */}
      {!hasData && !loading && (
        <WorkforceEmptyState canManageIntegrations={canManageIntegrations} />
      )}

      <section id="wf-executivo">
        <ExecutiveSummarySection
          model={model}
          onKpiClick={(kpi) => {
            if (!kpi.target) return;
            if (kpi.target.kind === 'route') {
              router.push(kpi.target.to);
              return;
            }
            document
              .getElementById(kpi.target.to)
              ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}
        />
      </section>

      {/* O número aparece no cockpit; a análise mora atrás destes links. */}
      <section>
        <SectionNavStrip canSeePayroll={canSeePayroll} />
      </section>

      <EfficiencySection model={model} />

      <WorkforceDynamicsSection model={model} />

      <CostStructureSection model={model} />

      {canSeePayroll && (
        <section>
          <div className="flex justify-end">
            <HudButton
              variant="primary"
              leftIcon={<FileSpreadsheet className="h-4 w-4" />}
              rightIcon={<ArrowRight className="h-4 w-4" />}
              onClick={() => router.push('/workforce-cost/fechamento-folha')}
            >
              Novo fechamento
            </HudButton>
          </div>
        </section>
      )}

      <RiskConcentrationSection model={model} />

      <ComplianceSection
        model={model}
        loading={loading}
        onSyncEsocial={reloadEsocial}
        manualHeadcount={
          canManageIntegrations && hasData
            ? {
                competences: adjustableCompetences,
                onSave: saveManualHeadcount,
                onRemove: removeManualHeadcount,
              }
            : undefined
        }
      />

      <SimulatorSection model={model} />

      {hasData && (
        <section className="space-y-3">
          <WorkforceSectionHeader
            title="Detalhamento"
            subtitle="Tabelas completas por centro de custo e competência — expanda conforme necessário"
          />
          <CollapsibleDetailPanel
            costConcentration={model.concentration.data}
            trend={model.costStructure.trend}
          />
        </section>
      )}
    </HudPageLayout>
  );
}

export default function WorkforceCostPage() {
  return (
    <Suspense
      fallback={
        <HudPageLayout maxWidth="2xl">
          <div className="flex min-h-[60vh] items-center justify-center">
            <div className="text-center">
              <Users className="mx-auto mb-3 h-12 w-12 animate-pulse text-ig-fg-subtle" />
              <p className="text-sm text-ig-fg-muted">Carregando dados...</p>
            </div>
          </div>
        </HudPageLayout>
      }
    >
      <WorkforceCostPageInner />
    </Suspense>
  );
}
