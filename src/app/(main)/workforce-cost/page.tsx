'use client';

import { useMemo, useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  Download,
  Share2,
  AlertTriangle,
  CheckCircle,
  AlertCircle,
  Coins,
  HeartPulse,
  ShieldAlert,
  Users,
  FileSpreadsheet,
  ArrowRight,
  Building2,
} from 'lucide-react';
import { useCurrentUser } from '@/hooks/use-current-user';
import { hasAnyPermission, hasPermission } from '@/lib/auth/permissions';

import {
  WorkforceOverviewCards,
  CostConcentrationPanel,
  WorkforceTrendChart,
  CostCenterDrilldown,
  HiringSimulatorExpanded,
  PayrollRiskIndicator,
  WorkforcePeriodFilter,
  PayrollEvolutionPanel,
  HeadcountDynamicsPanel,
  WorkforceEfficiencyPanel,
  CollapsibleDetailPanel,
  PayrollCompliancePanel,
  EsocialCoverageNotice,
  WorkforceEmptyState,
  ManualHeadcountPanel,
  TurnoverByAreaPanel,
  WorkforceIndicatorMatrix,
} from '@/components/workforce';

import { RiskStatus } from '@/lib/workforce-data';
import {
  selectWorkforceViewWithClosings,
  selectPayrollComposition,
  selectPayrollSCurve,
  selectPayrollVsRevenue,
  selectBenefitsByType,
  selectAdmissionsVsDismissals,
  selectTurnoverTrend,
  selectAbsenteeismByArea,
  selectAbsenteeismMonthlyByArea,
  selectTurnoverByArea,
  selectMonthlyIndicatorMatrix,
  selectOvertimeTrend,
  selectWorkforceEfficiency,
  buildEffectiveSeries,
  enrichSeriesWithRevenue,
  enrichSeriesWithEsocial,
  DEFAULT_WORKFORCE_PERIOD,
  type WorkforcePeriodSelection,
} from '@/lib/workforce/period';
import { buildComplianceSnapshot, competenceLabel } from '@/lib/workforce/compliance';
import { useEsocialOverview } from '@/hooks/use-esocial-overview';
import { useWorkforceComplianceKpis } from '@/hooks/use-workforce-compliance-kpis';
import { repositoryMode } from '@/lib/payroll/closing-client';
import type { PayrollClosingBatch, PayrollClosingBatchApproved } from '@/lib/types/payroll-closing';
import { openWorkforceReport } from '@/lib/workforce/export-report';
import { getAPARTitles } from '@/lib/finance/finance-store';
import { selectMonthlyRevenue } from '@/lib/finance/selectors/apar';

import {
  HudPageLayout,
  HudHeader,
  HudButton,
  HudSignal,
} from '@/components/hud';
import { cn } from '@/lib/utils';

// ─── helpers ────────────────────────────────────────────────────────────────

const statusConfig: Record<RiskStatus, {
  icon: typeof CheckCircle;
  label: string;
  variant: 'active' | 'warning' | 'error';
}> = {
  healthy: { icon: CheckCircle, label: 'Saudável', variant: 'active' },
  attention: { icon: AlertTriangle, label: 'Atenção', variant: 'warning' },
  risk: { icon: AlertCircle, label: 'Risco', variant: 'error' },
};

const PAYROLL_PERMS = ['people.payroll_close', 'people.payroll_send', 'people.payroll_send_sensitive'];

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex items-center gap-3 mb-1">
      <div className="w-1 h-5 rounded-full bg-ig-accent/70 shrink-0" />
      <div>
        <h2 className="text-sm font-semibold text-ig-fg-strong tracking-tight">{title}</h2>
        {subtitle && <p className="text-xs text-ig-fg-muted">{subtitle}</p>}
      </div>
    </div>
  );
}

// ─── Navegação para as seções de detalhe ─────────────────────────────────────

/**
 * A faixa que mantém a Visão Geral como cockpit.
 *
 * Cada seção do módulo tem uma pergunta própria e um nível de detalhe próprio.
 * Trazer esse detalhe para cá seria o caminho mais curto para transformar o
 * cockpit numa página com todos os indicadores — que é exatamente o que ele
 * não pode ser. O número aparece nos KPIs acima; a análise mora atrás destes
 * links.
 */
function SectionNavStrip({ canSeePayroll }: { canSeePayroll: boolean }) {
  const targets = [
    {
      href: '/workforce-cost/custos',
      icon: Coins,
      title: 'Folha & Encargos',
      description: 'Composição da folha, INSS/FGTS/IRRF, custo por lotação e variação salarial.',
    },
    {
      href: '/workforce-cost/sst',
      icon: HeartPulse,
      title: 'SST / ASO & CAT',
      description: 'Acidentes, saúde ocupacional e exposição a agentes nocivos.',
    },
    {
      href: '/workforce-cost/governanca',
      icon: ShieldAlert,
      title: 'Governança',
      description: 'Exceções operacionais classificadas para análise.',
    },
    ...(canSeePayroll
      ? [
          {
            href: '/workforce-cost/fechamento-folha',
            icon: FileSpreadsheet,
            title: 'Fechamento da Folha',
            description: 'Importar folha, anexar holerites, enviar ao financeiro — e o Controle eSocial.',
          },
        ]
      : []),
  ];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {targets.map((t) => {
        const Icon = t.icon;
        return (
          <Link
            key={t.href}
            href={t.href}
            className="group relative flex items-start gap-3 overflow-hidden rounded-2xl border border-ig-border-subtle bg-ig-panel p-4 transition-colors hover:border-ig-border-focus"
          >
            <span className="pointer-events-none absolute inset-y-0 left-0 w-0.5 bg-ig-accent/50 opacity-0 transition-opacity group-hover:opacity-100" />
            <span className="shrink-0 rounded-xl bg-ig-accent-weak p-2">
              <Icon className="h-4 w-4 text-ig-accent" />
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-1 text-sm font-semibold text-ig-fg-strong">
                {t.title}
                <ArrowRight className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
              </span>
              <span className="mt-0.5 block text-[11px] leading-relaxed text-ig-fg-muted">
                {t.description}
              </span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}

// ─── Executive signal strip ──────────────────────────────────────────────────

/**
 * Indicadores ausentes chegam como `undefined`, não como `0`.
 *
 * A diferença importa: "0% de horas extras" afirma que ninguém fez hora extra;
 * "—" afirma que não se sabe. O sinal correspondente é omitido em vez de
 * aparecer verde por falta de dado.
 */
interface WorkforceSignalStripProps {
  alerts: { id: string; type?: string; severity: 'warning' | 'error'; title: string; description: string; value?: number; costCenterId?: string }[];
  payrollGrowth: number;
  revenueGrowth: number;
  turnoverPct?: number;
  absenteeismMax?: number;
  overtimePct?: number;
  payrollRevenuePct?: number;
  payrollRevenueThreshold: number;
  top3Concentration?: number;
}

function WorkforceSignalStrip({
  alerts, payrollGrowth, revenueGrowth, turnoverPct, absenteeismMax,
  overtimePct, payrollRevenuePct, payrollRevenueThreshold, top3Concentration,
}: WorkforceSignalStripProps) {
  const signals: { level: 'ok' | 'warn' | 'error'; label: string; detail: string }[] = [];

  if (payrollGrowth - revenueGrowth > 5)
    signals.push({ level: 'error', label: 'Crescimento', detail: `Folha +${payrollGrowth.toFixed(1)}% > Rec. +${revenueGrowth.toFixed(1)}%` });
  else if (payrollGrowth - revenueGrowth > 2)
    signals.push({ level: 'warn', label: 'Crescimento', detail: 'Folha acima da receita' });
  else
    signals.push({ level: 'ok', label: 'Crescimento', detail: 'Alinhado com receita' });

  if (overtimePct !== undefined) {
    if (overtimePct > 12)
      signals.push({ level: 'warn', label: 'H. Extras', detail: `${overtimePct.toFixed(1)}%` });
    else
      signals.push({ level: 'ok', label: 'H. Extras', detail: `${overtimePct.toFixed(1)}%` });
  }

  if (absenteeismMax !== undefined) {
    if (absenteeismMax > 5)
      signals.push({ level: 'error', label: 'Absenteísmo', detail: `Pico ${absenteeismMax.toFixed(1)}%` });
    else if (absenteeismMax > 4)
      signals.push({ level: 'warn', label: 'Absenteísmo', detail: `${absenteeismMax.toFixed(1)}%` });
    else
      signals.push({ level: 'ok', label: 'Absenteísmo', detail: `${absenteeismMax.toFixed(1)}%` });
  }

  if (turnoverPct !== undefined) {
    if (turnoverPct > 3)
      signals.push({ level: 'error', label: 'Turnover', detail: `${turnoverPct.toFixed(2)}%/mês` });
    else if (turnoverPct > 2)
      signals.push({ level: 'warn', label: 'Turnover', detail: `${turnoverPct.toFixed(2)}%/mês` });
    else
      signals.push({ level: 'ok', label: 'Turnover', detail: `${turnoverPct.toFixed(2)}%/mês` });
  }

  if (top3Concentration !== undefined) {
    if (top3Concentration > 80)
      signals.push({ level: 'error', label: 'Concentração', detail: `Top-3: ${top3Concentration.toFixed(0)}%` });
    else if (top3Concentration > 70)
      signals.push({ level: 'warn', label: 'Concentração', detail: `Top-3: ${top3Concentration.toFixed(0)}%` });
    else
      signals.push({ level: 'ok', label: 'Concentração', detail: `Top-3: ${top3Concentration.toFixed(0)}%` });
  }

  if (payrollRevenuePct !== undefined) {
    if (payrollRevenuePct >= payrollRevenueThreshold + 5)
      signals.push({ level: 'error', label: 'Folha/Rec.', detail: `${payrollRevenuePct.toFixed(1)}% (limite ${payrollRevenueThreshold}%)` });
    else if (payrollRevenuePct >= payrollRevenueThreshold)
      signals.push({ level: 'warn', label: 'Folha/Rec.', detail: `${payrollRevenuePct.toFixed(1)}% no limite` });
    else
      signals.push({ level: 'ok', label: 'Folha/Rec.', detail: `${payrollRevenuePct.toFixed(1)}%` });
  }

  const errorCount = signals.filter((s) => s.level === 'error').length;
  const warnCount  = signals.filter((s) => s.level === 'warn').length;
  const allGood    = errorCount === 0 && warnCount === 0;

  const levelIcon = { ok: CheckCircle, warn: AlertTriangle, error: AlertCircle };
  const chipCls = {
    ok:    'bg-ig-success/8 border-ig-success/20',
    warn:  'bg-ig-warning/8 border-ig-warning/20',
    error: 'bg-ig-danger/8  border-ig-danger/20',
  };
  const iconCls = {
    ok:    'text-ig-success',
    warn:  'text-ig-warning',
    error: 'text-ig-danger',
  };
  const valueCls = {
    ok:    'text-ig-fg-muted',
    warn:  'text-ig-warning',
    error: 'text-ig-danger',
  };

  const ccAlerts = alerts.filter((a) => a.type === 'abnormal_growth' || !a.type);

  return (
    <div className="rounded-xl border border-ig-border-subtle overflow-hidden">
      {/* ── Header bar: title + severity summary ──────────────────────────── */}
      <div className={cn(
        'flex items-center justify-between px-4 py-2.5 border-b border-ig-border-subtle/70',
        allGood
          ? 'bg-ig-success/[0.04]'
          : errorCount > 0
            ? 'bg-ig-danger/[0.04]'
            : 'bg-ig-warning/[0.04]',
      )}>
        <div className="flex items-center gap-2">
          <div className={cn(
            'w-1.5 h-1.5 rounded-full shrink-0',
            allGood
              ? 'bg-ig-success'
              : errorCount > 0
                ? 'bg-ig-danger animate-pulse'
                : 'bg-ig-warning animate-pulse',
          )} />
          <span className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-ig-fg-muted">
            Radar de Riscos
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {allGood ? (
            <span className="flex items-center gap-1.5 text-[11px] font-semibold text-ig-success">
              <CheckCircle className="w-3.5 h-3.5" />
              Todos os indicadores saudáveis
            </span>
          ) : (
            <>
              {errorCount > 0 && (
                <HudSignal
                  tone="critical"
                  size="sm"
                  icon={<AlertCircle />}
                  label={`Crítico${errorCount !== 1 ? 's' : ''}`}
                  value={errorCount}
                />
              )}
              {warnCount > 0 && (
                <HudSignal
                  tone="warning"
                  size="sm"
                  icon={<AlertTriangle />}
                  label={`Alerta${warnCount !== 1 ? 's' : ''}`}
                  value={warnCount}
                />
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Signal chips body ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-1.5 px-4 py-2.5 bg-ig-panel">
        {signals.map((s) => {
          const Icon = levelIcon[s.level];
          return (
            <div
              key={s.label}
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] shrink-0',
                chipCls[s.level],
              )}
            >
              <Icon className={cn('w-3 h-3 shrink-0', iconCls[s.level])} />
              <span className="font-semibold text-ig-fg-strong">{s.label}</span>
              <span className="text-ig-fg-subtle opacity-50">·</span>
              <span className={cn('font-medium ig-tabular', valueCls[s.level])}>
                {s.detail}
              </span>
            </div>
          );
        })}

        {ccAlerts.length > 0 && (
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] shrink-0 bg-ig-warning/8 border-ig-warning/20">
            <Building2 className="w-3 h-3 shrink-0 text-ig-warning" />
            <span className="font-semibold text-ig-fg-strong">
              {ccAlerts.length} centro{ccAlerts.length !== 1 ? 's' : ''}
            </span>
            <span className="text-ig-fg-subtle opacity-50">·</span>
            <span className="font-medium text-ig-warning ig-tabular">
              crescimento anormal
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

function WorkforceCostPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const costCenterId = searchParams.get('costCenterId');

  const { roles, permissions } = useCurrentUser();
  const canSeePayroll =
    roles.some((r) => r.key === 'owner_admin') ||
    hasPermission(permissions, 'admin.manage_users') ||
    hasAnyPermission(permissions, PAYROLL_PERMS);
  const canManageIntegrations =
    roles.some((r) => r.key === 'owner_admin') ||
    hasPermission(permissions, 'admin.manage_integrations');
  const goToPayrollClosing = () => router.push('/workforce-cost/fechamento-folha');

  const [approvedBatches, setApprovedBatches] = useState<PayrollClosingBatchApproved[]>([]);
  const [allBatches, setAllBatches] = useState<PayrollClosingBatch[]>([]);
  useEffect(() => {
    if (repositoryMode() !== 'supabase') return;
    fetch('/api/payroll/batches?approved=true')
      .then((r) => r.json())
      .then((d: { ok: boolean; batches?: PayrollClosingBatchApproved[] }) => {
        if (d.ok) setApprovedBatches(d.batches ?? []);
      })
      .catch(() => {});
  }, []);

  // Todos os lotes (qualquer status) alimentam o compliance: uma competência sem
  // lote aprovado ainda precisa aparecer como pendência, não como ausência.
  useEffect(() => {
    if (repositoryMode() !== 'supabase' || !canSeePayroll) return;
    fetch('/api/payroll/batches')
      .then((r) => r.json())
      .then((d: { ok: boolean; batches?: PayrollClosingBatch[] }) => {
        if (d.ok) setAllBatches(d.batches ?? []);
      })
      .catch(() => {});
  }, [canSeePayroll]);

  // eSocial: puxado automaticamente, em modo tolerante a falha.
  const esocial = useEsocialOverview();

  const [period, setPeriod] = useState<WorkforcePeriodSelection>(DEFAULT_WORKFORCE_PERIOD);

  const arTitles = useMemo(() => getAPARTitles('receivable'), []);
  const monthlyRevenue = useMemo(() => selectMonthlyRevenue(arTitles), [arTitles]);

  /**
   * Série efetiva, da fonte mais fraca para a mais forte:
   * folha importada → receita real (AR) → apurado do eSocial.
   *
   * Não há camada de demonstração embaixo: competência sem nenhuma dessas
   * fontes simplesmente não existe na série.
   */
  const effectiveSeries = useMemo(
    () =>
      enrichSeriesWithEsocial(
        enrichSeriesWithRevenue(buildEffectiveSeries(approvedBatches), monthlyRevenue),
        esocial.competences,
        esocial.areas,
        esocial.manualHeadcountByCompetence,
      ),
    [
      approvedBatches,
      monthlyRevenue,
      esocial.competences,
      esocial.areas,
      esocial.manualHeadcountByCompetence,
    ],
  );

  const workforce = useMemo(
    () => selectWorkforceViewWithClosings(period, approvedBatches, effectiveSeries),
    [period, approvedBatches, effectiveSeries],
  );

  const composition = useMemo(() => selectPayrollComposition(period, effectiveSeries), [period, effectiveSeries]);
  const scurve = useMemo(() => selectPayrollSCurve(period, effectiveSeries), [period, effectiveSeries]);
  const vsRevenue = useMemo(() => selectPayrollVsRevenue(period, effectiveSeries), [period, effectiveSeries]);
  const benefits = useMemo(() => selectBenefitsByType(period, effectiveSeries), [period, effectiveSeries]);
  const admissions = useMemo(() => selectAdmissionsVsDismissals(period, effectiveSeries), [period, effectiveSeries]);
  const turnoverTrend = useMemo(() => selectTurnoverTrend(period, effectiveSeries), [period, effectiveSeries]);
  const absenteeism = useMemo(() => selectAbsenteeismByArea(period, effectiveSeries), [period, effectiveSeries]);
  const overtime = useMemo(() => selectOvertimeTrend(period, effectiveSeries), [period, effectiveSeries]);
  const efficiency = useMemo(() => selectWorkforceEfficiency(period, effectiveSeries), [period, effectiveSeries]);
  const turnoverByArea = useMemo(() => selectTurnoverByArea(period, effectiveSeries), [period, effectiveSeries]);
  const absenteeismMonthly = useMemo(() => selectAbsenteeismMonthlyByArea(period, effectiveSeries), [period, effectiveSeries]);
  const indicatorMatrix = useMemo(() => selectMonthlyIndicatorMatrix(period, effectiveSeries), [period, effectiveSeries]);

  // ── Compliance da competência: folha → eSocial → guias ──
  const batchByCompetence = useMemo(() => {
    const map = new Map<string, PayrollClosingBatch>();
    // `allBatches` cobre qualquer status; os aprovados entram como fallback.
    for (const b of [...approvedBatches, ...allBatches]) {
      if (b.status === 'cancelled') continue;
      map.set(b.competence_month, b);
    }
    return map;
  }, [approvedBatches, allBatches]);

  /** Competência corrente do compliance: a mais recente APURADA. */
  const currentCompetence = useMemo(
    () =>
      effectiveSeries[effectiveSeries.length - 1]?.competenceMonth ??
      indicatorMatrix.rows[indicatorMatrix.rows.length - 1]?.competenceMonth ??
      new Date().toISOString().slice(0, 7),
    [effectiveSeries, indicatorMatrix],
  );

  /**
   * Ciclo da competência sempre a partir do lote REAL.
   *
   * Sem lote, `batch` fica indefinido e o snapshot classifica a folha como
   * "sem lote na competência" — que é o estado verdadeiro. Antes havia aqui um
   * ciclo demonstrativo que fabricava um lote aprovado e enviado ao financeiro,
   * com relógio ancorado dentro do mês para não vencer: a tela mostrava um
   * fechamento em dia que nunca tinha acontecido.
   */
  const complianceSnapshot = useMemo(
    () =>
      buildComplianceSnapshot({
        competence: currentCompetence,
        batch: batchByCompetence.get(currentCompetence),
        esocial: esocial.link,
        figures: esocial.figuresByCompetence[currentCompetence],
      }),
    [currentCompetence, batchByCompetence, esocial.link, esocial.figuresByCompetence],
  );

  /** Estado de envio por competência, para a coluna "Folha & Guias" da matriz. */
  const complianceByCompetence = useMemo(() => {
    const out: Record<string, { payrollStatus: PayrollClosingBatch['status'] | 'missing'; score: number }> = {};
    for (const row of indicatorMatrix.rows) {
      const snap = buildComplianceSnapshot({
        competence: row.competenceMonth,
        batch: batchByCompetence.get(row.competenceMonth),
        esocial: esocial.link,
        figures: esocial.figuresByCompetence[row.competenceMonth],
      });
      out[row.competenceMonth] = { payrollStatus: snap.payrollStatus, score: snap.score };
    }
    return out;
  }, [indicatorMatrix, batchByCompetence, esocial.link, esocial.figuresByCompetence]);

  /**
   * Conformidade: SST e série salarial, cada uma com a própria permissão.
   *
   * Fica fora do `useEsocialOverview` porque uma pode responder e a outra não;
   * o hook resolve isso deixando cada indicador ausente por conta própria.
   */
  const complianceKpis = useWorkforceComplianceKpis(currentCompetence);
  const currentCoverage = esocial.coverageByCompetence[currentCompetence];
  const currentMetric = esocial.metricsByCompetence[currentCompetence];

  const latestEfficiency = efficiency[efficiency.length - 1];
  const latestTurnover = turnoverTrend[turnoverTrend.length - 1];
  const latestOvertime = overtime[overtime.length - 1];
  const maxAbsenteeism = absenteeism.length > 0 ? absenteeism[0].pct : undefined;
  const latestComposition = composition[composition.length - 1];
  const benefitsTotal = latestComposition ? latestComposition.benefits : undefined;
  const chargesTotal = latestComposition ? latestComposition.charges : undefined;
  // Sem composição classificada não há divisão direto/indireto. O 68,5% que
  // ficava aqui como padrão era o mesmo número do modelo por senoide.
  const directPct = latestComposition
    ? (latestComposition.salary / (latestComposition.salary + latestComposition.benefits + latestComposition.charges)) * 100
    : undefined;
  const indirectPct = directPct === undefined ? undefined : 100 - directPct;

  /** Nenhuma fonte real produziu competência: a tela não tem o que afirmar. */
  const hasData = effectiveSeries.length > 0;

  /**
   * Competências oferecidas ao ajuste manual de quadro, da mais recente para a
   * mais antiga — quem vai corrigir procura o mês que acabou de estranhar.
   */
  const adjustableCompetences = useMemo(
    () =>
      [...effectiveSeries]
        .reverse()
        .map((r) => {
          const manual = esocial.manualHeadcountByCompetence[r.competenceMonth];
          return {
            competence: r.competenceMonth,
            esocialHeadcount: esocial.metricsByCompetence[r.competenceMonth]?.headcount ?? 0,
            payroll: r.payroll,
            manualHeadcount: manual?.headcount,
            manualNote: manual?.sourceNote,
          };
        }),
    [effectiveSeries, esocial.manualHeadcountByCompetence, esocial.metricsByCompetence],
  );

  const saveManualHeadcount = async (competence: string, headcount: number, sourceNote: string) => {
    const res = await fetch('/api/workforce/manual-headcount', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ competence, headcount, sourceNote }),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !body.ok) throw new Error(body.error ?? 'Falha ao gravar o ajuste.');
    await esocial.reload();
  };

  const removeManualHeadcount = async (competence: string) => {
    const res = await fetch(
      `/api/workforce/manual-headcount?competence=${encodeURIComponent(competence)}`,
      { method: 'DELETE' },
    );
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !body.ok) throw new Error(body.error ?? 'Falha ao remover o ajuste.');
    await esocial.reload();
  };

  const riskStatus = workforce.payrollRisk.status;
  const config = statusConfig[riskStatus];

  const selectedCostCenter = useMemo(() => {
    if (!costCenterId) return null;
    return workforce.costConcentration.costCenters.find((c) => c.id === costCenterId) || null;
  }, [costCenterId, workforce]);

  return (
    <HudPageLayout>
      {/* ── Header ── */}
      <HudHeader
        title="Pessoas & Custos"
        subtitle="Cockpit Executivo de Workforce — Inteligência de Custos, Eficiência e Risco"
        icon={<Users className="w-5 h-5" />}
        iconTint="#10B981"
        breadcrumbs={[{ label: 'Pessoas & Custos' }]}
        statusChips={[
          { label: workforce.meta.periodLabel, variant: 'info' },
          // Sem receita não há risco de folha a pontuar — o chip diz isso em
          // vez de exibir "Saudável 0/100", que afirmaria o contrário.
          workforce.payrollRisk.comparable
            ? {
                label: `${config.label} ${workforce.payrollRisk.riskScore}/100`,
                variant: config.variant === 'active' ? 'success' : config.variant === 'warning' ? 'warning' : 'critical',
              }
            : { label: 'risco de folha não apurado', variant: 'neutral' as const },
          {
            label: `Compliance ${complianceSnapshot.score}/100`,
            variant:
              complianceSnapshot.score >= 85 ? 'success' as const
                : complianceSnapshot.score >= 60 ? 'warning' as const
                  : 'critical' as const,
          },
          {
            label: esocial.link.connected
              ? `eSocial ${esocial.link.automationEnabled ? 'ao vivo' : 'manual'}`
              : 'eSocial off',
            variant: esocial.link.connected
              ? (esocial.link.automationEnabled ? 'success' as const : 'warning' as const)
              : 'neutral' as const,
          },
          ...(hasData
            ? [{ label: 'folha importada', variant: 'success' as const }]
            : [{ label: 'sem competência apurada', variant: 'neutral' as const }]),
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <WorkforcePeriodFilter value={period} onChange={setPeriod} series={effectiveSeries} />
            <HudButton variant="secondary" size="sm" leftIcon={<Share2 className="w-4 h-4" />}>
              Compartilhar
            </HudButton>
            <HudButton
              variant="secondary"
              size="sm"
              leftIcon={<Download className="w-4 h-4" />}
              onClick={() => openWorkforceReport(workforce)}
            >
              Exportar PDF
            </HudButton>
          </div>
        }
      />

      {/* Cost Center Drilldown (conditional) */}
      {selectedCostCenter && (
        <section>
          <CostCenterDrilldown
            costCenter={selectedCostCenter}
            currency={workforce.costConcentration.currency}
          />
        </section>
      )}

      {/* Procedência antes dos números: um mês incompleto e um mês completo são
          indistinguíveis quando só o valor aparece. */}
      {hasData && esocial.link.connected && (
        <EsocialCoverageNotice
          coverage={esocial.coverageByCompetence[currentCompetence]}
          summary={esocial.coverageSummary}
        />
      )}

      {/* Sem nenhuma fonte real não há cockpit: o vazio é a leitura correta. */}
      {!hasData && !esocial.loading && (
        <WorkforceEmptyState canManageIntegrations={canManageIntegrations} />
      )}

      {/* ── A. Cockpit Executivo — KPI Strip ── */}
      <section>
        <WorkforceOverviewCards
          data={workforce.metrics}
          meta={workforce.meta}
          extended={{
            turnoverPct: latestTurnover?.turnoverPct,
            overtimePct: latestOvertime?.overtimePct,
            benefitsTotal,
            chargesTotal,
            revenuePerEmployee: latestEfficiency?.revenuePerEmployee,
            directPayrollPct: directPct,
            indirectPayrollPct: indirectPct,
          }}
          compliance={{
            admissions: currentMetric?.admissions,
            terminations: currentMetric?.terminations,
            activeAbsences: currentMetric?.absence_events,
            catsInMonth: complianceKpis.catsInMonth,
            asoExpired: complianceKpis.asoExpired,
            asoExpiring: complianceKpis.asoExpiring,
            workersWithoutAso: complianceKpis.workersWithoutAso,
            withoutRaise12m: complianceKpis.withoutRaise12m,
            competenceState: currentCoverage?.detail,
            competenceLabel: currentCoverage ? competenceLabel(currentCompetence) : undefined,
          }}
          onKpiClick={(id) => {
            // Indicadores de conformidade vivem em outra seção do módulo: o
            // clique leva para lá em vez de rolar dentro do cockpit.
            const route =
              id === 'cats' || id === 'aso' ? '/workforce-cost/sst'
                : id === 'raise' ? '/workforce-cost/custos'
                  : id === 'competence' ? '/workforce-cost/fechamento-folha?tab=esocial'
                    : null;
            if (route) {
              router.push(route);
              return;
            }
            // KPI clicável leva à seção com o detalhe correspondente.
            const target =
              id === 'payroll' ? 'wf-folha'
                : id === 'headcount' || id === 'clt-pj' || id === 'turnover' || id === 'overtime' || id === 'movement' || id === 'absences' ? 'wf-headcount'
                  : id === 'payroll-rev' ? 'wf-risco'
                    : 'wf-eficiencia';
            document.getElementById(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}
        />
      </section>

      {/* ── Navegação para as seções de detalhe ──
          Substitui a tentação de trazer o detalhe para o cockpit: o número
          aparece aqui, a análise mora na seção. */}
      <section>
        <SectionNavStrip canSeePayroll={canSeePayroll} />
      </section>

      {/* ── Ciclo obrigatório: folha → eSocial → guias ── */}
      <section id="wf-compliance" className="space-y-3">
        <SectionHeader
          title="Folha, eSocial & Guias"
          subtitle="Estado do envio da competência — cada indicador acima só fecha quando este ciclo fecha"
        />
        <PayrollCompliancePanel
          snapshot={complianceSnapshot}
          loading={esocial.loading}
          onSyncEsocial={esocial.reload}
        />
      </section>

      {/* ── Sinais de Risco (strip compacto) ── */}
      <section>
        <WorkforceSignalStrip
          alerts={workforce.alerts}
          payrollGrowth={workforce.payrollRisk.payrollGrowth}
          revenueGrowth={workforce.payrollRisk.revenueGrowth}
          turnoverPct={latestTurnover?.turnoverPct}
          absenteeismMax={maxAbsenteeism}
          overtimePct={latestOvertime?.overtimePct}
          payrollRevenuePct={
            workforce.metrics.payrollAsRevenuePercent.value > 0
              ? workforce.metrics.payrollAsRevenuePercent.value
              : undefined
          }
          payrollRevenueThreshold={workforce.metrics.payrollAsRevenuePercent.threshold}
          top3Concentration={
            workforce.costConcentration.totalPayroll > 0
              ? workforce.costConcentration.top3Concentration
              : undefined
          }
        />
      </section>

      {/* ── B. Payroll Evolution + S-Curve ── */}
      <section id="wf-folha" className="space-y-3">
        <SectionHeader title="Evolução da Folha" subtitle="Tendência, composição salarial, Curva S acumulada e comparativo com receita" />
        <PayrollEvolutionPanel
          composition={composition}
          scurve={scurve}
          vsRevenue={vsRevenue}
          benefits={benefits}
          currency={workforce.costConcentration.currency}
        />
      </section>

      {/* Ação de fechamento. O card descritivo que existia aqui virou uma das
          entradas da faixa de navegação, no topo — o que sobra é o atalho. */}
      {canSeePayroll && (
        <section>
          <div className="flex justify-end">
            <HudButton
              variant="primary"
              leftIcon={<FileSpreadsheet className="h-4 w-4" />}
              rightIcon={<ArrowRight className="h-4 w-4" />}
              onClick={goToPayrollClosing}
            >
              Novo fechamento
            </HudButton>
          </div>
        </section>
      )}

      {/* ── D. Headcount Dynamics ── */}
      <section id="wf-headcount" className="space-y-3">
        <SectionHeader title="Dinâmica de Headcount" subtitle="Admissões, desligamentos, turnover, absenteísmo e horas extras" />
        <HeadcountDynamicsPanel
          admissions={admissions}
          turnover={turnoverTrend}
          absenteeism={absenteeism}
          overtime={overtime}
        />
      </section>

      {/* ── D2. Distribuição por Área ── */}
      <section id="wf-areas" className="space-y-3">
        <SectionHeader
          title="Distribuição por Área"
          subtitle="Onde a rotatividade e as faltas se concentram — participação nos desligamentos, turnover e absenteísmo mês a mês"
        />
        <TurnoverByAreaPanel
          turnoverByArea={turnoverByArea}
          absenteeismMonthly={absenteeismMonthly}
        />
      </section>

      {/* ── D3. Matriz mensal consolidada ── */}
      <section id="wf-matriz" className="space-y-3">
        <SectionHeader
          title="Matriz Mensal de Indicadores"
          subtitle="Uma linha por competência — indicadores do cockpit e estado do envio da folha e das guias"
        />
        <WorkforceIndicatorMatrix
          matrix={indicatorMatrix}
          compliance={complianceByCompetence}
        />
      </section>

      {/* ── E. Cost Concentration (full width) ── */}
      <section className="space-y-3">
        <SectionHeader title="Concentração por Centro de Custo" subtitle="Ranking Pareto da folha — barras com acumulado e destaque Top-3" />
        <CostConcentrationPanel data={workforce.costConcentration} />
      </section>

      {/* ── F. Efficiency & Productivity ── */}
      <section id="wf-eficiencia" className="space-y-3">
        <SectionHeader title="Eficiência & Produtividade" subtitle="Receita por colaborador, custo médio e índice folha/receita ao longo do tempo" />
        <WorkforceEfficiencyPanel
          data={efficiency}
          currency={workforce.costConcentration.currency}
        />
      </section>

      {/* ── G. Payroll Risk + Trend ── */}
      <section id="wf-risco" className="space-y-3">
        <SectionHeader title="Risco de Folha & Tendência" subtitle="Score de risco, evolução histórica e comparativo payroll vs receita" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
          <PayrollRiskIndicator data={workforce.payrollRisk} />
          <WorkforceTrendChart
            data={workforce.trend}
            currency={workforce.costConcentration.currency}
          />
        </div>
      </section>

      {/* ── H. Hiring Simulator ── */}
      <section className="space-y-3">
        <SectionHeader title="Simulador de Contratação" subtitle="Análise de impacto estratégico para decisão do board" />
        <HiringSimulatorExpanded
          initialAvgCost={workforce.metrics.avgCostPerEmployee.value}
          currentPayroll={workforce.metrics.monthlyPayroll.value}
          currentRevenue={latestEfficiency?.revenue ?? 0}
          currentHeadcount={workforce.metrics.headcount.total}
          payrollRevenueThreshold={workforce.metrics.payrollAsRevenuePercent.threshold}
        />
      </section>

      {/* ── I. Collapsible Detail Tables ── */}
      <section className="space-y-3">
        <SectionHeader title="Detalhamento" subtitle="Tabelas detalhadas — expanda conforme necessário" />
        <CollapsibleDetailPanel
          costConcentration={workforce.costConcentration}
          trend={workforce.trend}
        />
      </section>

      {/* Ajuste de quadro — só administrador, e só quando há competência. */}
      {canManageIntegrations && hasData && (
        <section id="wf-ajuste-quadro" className="space-y-3">
          <SectionHeader
            title="Ajuste manual de quadro"
            subtitle="Para competências em que o eSocial não entregou o detalhe por trabalhador — restrito a administradores"
          />
          <ManualHeadcountPanel
            competences={adjustableCompetences}
            onSave={saveManualHeadcount}
            onRemove={removeManualHeadcount}
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
        <HudPageLayout>
          <div className="flex items-center justify-center min-h-[60vh]">
            <div className="text-center">
              <Users className="w-12 h-12 text-ig-fg-subtle mx-auto mb-3 animate-pulse" />
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
