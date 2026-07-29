'use client';

/**
 * Diárias de Campo — Planejamento semanal (Fase 1, modo simulação).
 *
 * Uma diária por pessoa/dia (ADR-001) agrupada num lote semanal.
 * Fase 1 gera a prévia e destaca exceções em modo shadow: nenhum
 * pagamento é executado. As demais abas (aprovação, lote, conciliação)
 * chegam nas fases seguintes.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Ban,
  CalendarRange,
  CheckCircle2,
  Clock,
  Download,
  RefreshCw,
  UserMinus,
  UtensilsCrossed,
  Users,
} from 'lucide-react';
import {
  HudBadge,
  HudButton,
  HudDrawer,
  HudEmptyState,
  HudHeader,
  HudInput,
  HudKpiStrip,
  HudModal,
  HudPageLayout,
  HudPanel,
  HudSelect,
  HudTabs,
  useHudToast,
  type KpiItem,
} from '@/components/hud';
import { usePermissions } from '@/hooks/use-permissions';
import { formatCents } from '@/lib/services/cost';
import { getProjectsAsync } from '@/lib/services/projects';
import { listGeofences } from '@/lib/services/geofence';
import {
  closeWeek,
  computeWeekIntelligence,
  createAllowancePolicy,
  exportBatchCsv,
  generatePaymentBatch,
  generateWeeklyAllowancePreview,
  getLatestWeek,
  listAllowancePolicies,
  listDailyAllowancesByWeek,
  listPaymentBatchesByWeek,
  nextWeekBounds,
  performWeekAction,
  reconcileWeek,
  removePersonFromAllowanceWeek,
  reviewException,
  setAllowancePolicyStatus,
  weekLabel,
  type ExceptionDecision,
  type WeekIntelligence,
} from '@/lib/services/allowances';
import { RECONCILIATION_REASON_LABELS } from '@/lib/services/allowance-reconciliation';
import { openAllowanceReport } from '@/lib/reports/modules/allowance-report';
import { ALERT_SEVERITY_LABELS, type AlertSeverity } from '@/lib/services/allowance-intelligence';
import {
  decideAllowanceOverride,
  listAllowanceOverrides,
  requestAllowanceOverride,
} from '@/lib/services/allowance-overrides';
import { WEEK_ACTIONS, type WeekAction } from '@/lib/services/allowance-workflow';
import type { PermissionKey } from '@/lib/auth/types';
import {
  ALLOWANCE_WEEK_STATUS_LABELS,
  classifyReason,
  ELIGIBILITY_REASON_LABELS,
  PAYMENT_BATCH_STATUS_LABELS,
  SCHEDULE_MODE_LABELS,
  TRAVEL_ELIGIBILITY_MODE_LABELS,
  type AllowancePaymentBatch,
  type AllowanceEligibilityOverride,
  type AllowancePolicy,
  type AllowanceWeek,
  type DailyAllowance,
  type DayClassification,
  type EligibilityReason,
  type ScheduleMode,
  type TravelEligibilityMode,
} from '@/lib/types/allowances';
import type { ProjectGeofence } from '@/lib/types/people';

/* ─────────────────────── date helpers ───────────────────────── */

function parseDate(v: string): Date {
  return new Date(`${v}T00:00:00`);
}
function addDays(v: string, d: number): string {
  const dt = parseDate(v);
  dt.setDate(dt.getDate() + d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
function eachDate(start: string, end: string): string[] {
  const out: string[] = [];
  let c = start;
  while (c <= end) {
    out.push(c);
    c = addDays(c, 1);
  }
  return out;
}
const DOW_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
function dowLabel(v: string): string {
  return DOW_LABELS[parseDate(v).getDay()];
}
function dayNum(v: string): string {
  return String(parseDate(v).getDate()).padStart(2, '0');
}

/* ─────────────────── classification styling ──────────────────── */

const CLASS_META: Record<
  DayClassification,
  { label: string; cls: string; glyph: string }
> = {
  eligible: {
    label: 'Elegível',
    glyph: '✓',
    cls: 'bg-[color-mix(in_oklab,var(--ig-success)_14%,transparent)] text-ig-success',
  },
  review: {
    label: 'Em revisão',
    glyph: '?',
    cls: 'bg-[color-mix(in_oklab,var(--ig-warning)_16%,transparent)] text-ig-warning',
  },
  blocked: {
    label: 'Bloqueada',
    glyph: '✗',
    cls: 'bg-[color-mix(in_oklab,var(--ig-danger)_16%,transparent)] text-ig-danger',
  },
};

interface PersonRow {
  personId: string;
  name: string;
  projectId: string;
  byDate: Record<string, DailyAllowance>;
  totalCents: number;
  counts: Record<DayClassification, number>;
}

function buildRows(items: DailyAllowance[]): PersonRow[] {
  const map = new Map<string, PersonRow>();
  for (const it of items) {
    let row = map.get(it.personId);
    if (!row) {
      row = {
        personId: it.personId,
        name: it.person?.fullName ?? it.personId,
        projectId: it.projectId,
        byDate: {},
        totalCents: 0,
        counts: { eligible: 0, review: 0, blocked: 0 },
      };
      map.set(it.personId, row);
    }
    row.byDate[it.allowanceDate] = it;
    const klass = classifyReason((it.eligibilityReason ?? 'planned_eligible') as EligibilityReason);
    row.counts[klass] += 1;
    if (klass !== 'blocked') row.totalCents += it.amountCents;
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

function rowStatus(row: PersonRow): { label: string; variant: 'success' | 'warning' | 'danger' | 'default' } {
  if (row.counts.review > 0) return { label: 'Conflito', variant: 'warning' };
  if (row.counts.blocked > 0 && row.counts.eligible > 0) return { label: 'Parcial', variant: 'warning' };
  if (row.counts.blocked > 0) return { label: 'Bloqueado', variant: 'danger' };
  return { label: 'Elegível', variant: 'success' };
}

/* ─────────────────────────── page ───────────────────────────── */

export default function DiariasPage() {
  const { hasPermission, roles } = usePermissions();
  const { notify } = useHudToast();
  const isOwnerAdmin = roles.some((role) => role.key === 'owner_admin');
  const canManage = hasPermission('allowances.manage');
  const canReview = hasPermission('allowances.review_exception') || hasPermission('allowances.override_request') || canManage;
  const canApproveOverride = hasPermission('allowances.override_approve');

  const bounds = useMemo(() => nextWeekBounds(), []);
  const dates = useMemo(() => eachDate(bounds.weekStart, bounds.weekEnd), [bounds]);

  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [week, setWeek] = useState<AllowanceWeek | null>(null);
  const [items, setItems] = useState<DailyAllowance[]>([]);
  const [projectNames, setProjectNames] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<DayClassification | null>(null);
  const [selected, setSelected] = useState<DailyAllowance | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [activeTab, setActiveTab] = useState<
    'planning' | 'operation' | 'batches' | 'exceptions' | 'history' | 'intelligence' | 'policies'
  >('planning');
  const [intel, setIntel] = useState<WeekIntelligence | null>(null);
  const [intelLoading, setIntelLoading] = useState(false);
  const [batches, setBatches] = useState<AllowancePaymentBatch[]>([]);
  const [overrides, setOverrides] = useState<AllowanceEligibilityOverride[]>([]);
  const [exporting, setExporting] = useState(false);
  const canFinance = hasPermission('allowances.finance_approve');
  const canExportPdf =
    hasPermission('allowances.financial_export') ||
    hasPermission('allowances.audit_export') ||
    hasPermission('allowances.manage');

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [existing, projects] = await Promise.all([
        getLatestWeek(bounds.weekStart, bounds.weekEnd),
        getProjectsAsync().catch(() => []),
      ]);
      setProjectNames(
        Object.fromEntries(projects.map((p) => [p.id, p.codigo || p.nome || p.id])),
      );
      setWeek(existing);
      if (existing) {
        const [dailies, wkBatches, wkOverrides] = await Promise.all([
          listDailyAllowancesByWeek(existing.id),
          listPaymentBatchesByWeek(existing.id).catch(() => []),
          listAllowanceOverrides(bounds.weekStart, bounds.weekEnd).catch(() => []),
        ]);
        setItems(dailies);
        setBatches(wkBatches);
        setOverrides(wkOverrides);
      } else {
        setItems([]);
        setBatches([]);
        setOverrides([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar diárias');
    } finally {
      setLoading(false);
    }
  }, [bounds]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // carrega inteligência sob demanda (ao abrir a aba)
  useEffect(() => {
    if (activeTab !== 'intelligence' || !week) return;
    let cancelled = false;
    setIntelLoading(true);
    computeWeekIntelligence(week.id)
      .then((res) => {
        if (!cancelled) setIntel(res);
      })
      .catch((e) => {
        if (!cancelled)
          notify(e instanceof Error ? e.message : 'Erro na inteligência', { variant: 'error' });
      })
      .finally(() => {
        if (!cancelled) setIntelLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, week, notify]);

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await generateWeeklyAllowancePreview({
        weekStart: bounds.weekStart,
        weekEnd: bounds.weekEnd,
      });
      setWeek(res.week);
      setItems(res.items);
      const extra: string[] = [];
      if (res.skippedNoPolicy > 0) extra.push(`${res.skippedNoPolicy} dia(s) sem política`);
      if (res.skippedNoAllocation > 0) extra.push(`${res.skippedNoAllocation} pessoa(s) sem alocação`);
      notify(
        `Prévia gerada (v${res.week.version}) — ${res.week.totalItems} diárias${extra.length ? ' · ' + extra.join(' · ') : ''}`,
        { variant: 'success' },
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erro ao gerar prévia';
      setError(msg);
      notify(msg, { variant: 'error' });
    } finally {
      setGenerating(false);
    }
  }, [bounds, notify]);

  const handleWeekAction = useCallback(
    async (action: WeekAction) => {
      if (!week) return;
      setActionBusy(true);
      try {
        const updated = await performWeekAction(week.id, action, week);
        // A resposta do PATCH é a fonte consistente da transição. Um GET
        // imediato pode atingir uma réplica ainda defasada e regredir a UI.
        setWeek(updated);
        if (action === 'approve_finance') {
          setItems(await listDailyAllowancesByWeek(updated.id));
        }
        notify(`${WEEK_ACTIONS[action].label} — concluído`, { variant: 'success' });
      } catch (e) {
        notify(e instanceof Error ? e.message : 'Erro na transição', { variant: 'error' });
      } finally {
        setActionBusy(false);
      }
    },
    [week, notify],
  );

  const handleGenerateBatch = useCallback(async () => {
    if (!week) return;
    setActionBusy(true);
    try {
      const batch = await generatePaymentBatch(week.id);
      await reload();
      notify(`Lote ${batch.batchCode} gerado — ${batch.itemCount} diárias`, { variant: 'success' });
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Erro ao gerar lote', { variant: 'error' });
    } finally {
      setActionBusy(false);
    }
  }, [week, notify, reload]);

  const handleExportCsv = useCallback(
    async (batchId: string) => {
      setActionBusy(true);
      try {
        const { filename, csv } = await exportBatchCsv(batchId);
        const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        await reload();
        notify('Lote exportado (CSV)', { variant: 'success' });
      } catch (e) {
        notify(e instanceof Error ? e.message : 'Erro ao exportar', { variant: 'error' });
      } finally {
        setActionBusy(false);
      }
    },
    [notify, reload],
  );

  const handleExportPdf = useCallback(async () => {
    if (!week) return;
    setExporting(true);
    try {
      // usa a inteligência já carregada; senão calcula na hora (alertas + custo)
      const data = intel && intel.week.id === week.id ? intel : await computeWeekIntelligence(week.id);
      const result = openAllowanceReport({
        week,
        items,
        projectNames,
        alerts: data.alerts,
        costByProject: data.costByProject,
        previous: data.previous,
      });
      if (!result.ok) notify(result.message, { variant: 'error' });
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Erro ao gerar PDF', { variant: 'error' });
    } finally {
      setExporting(false);
    }
  }, [week, items, projectNames, intel, notify]);

  const handleReconcile = useCallback(async () => {
    if (!week) return;
    setActionBusy(true);
    try {
      const res = await reconcileWeek(week.id);
      setWeek(res.week);
      setItems(res.items);
      notify(`Conciliação concluída — ${res.confirmed} confirmadas, ${res.divergent} divergentes`, {
        variant: res.divergent > 0 ? 'warning' : 'success',
      });
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Erro ao conciliar', { variant: 'error' });
    } finally {
      setActionBusy(false);
    }
  }, [week, notify]);

  const handleCloseWeek = useCallback(async () => {
    if (!week) return;
    setActionBusy(true);
    try {
      const updated = await closeWeek(week.id);
      setWeek(updated);
      notify('Semana encerrada', { variant: 'success' });
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Erro ao encerrar', { variant: 'error' });
    } finally {
      setActionBusy(false);
    }
  }, [week, notify]);

  const handleReview = useCallback(
    async (item: DailyAllowance, decision: ExceptionDecision, reason: string) => {
      setActionBusy(true);
      try {
        const municipalityReasons: EligibilityReason[] = [
          'same_residence_and_service_municipality',
          'missing_or_unvalidated_residence_municipality',
          'missing_service_municipality',
          'manual_municipality_review_required',
        ];
        if (municipalityReasons.includes((item.eligibilityReason ?? 'planned_eligible') as EligibilityReason)) {
          await requestAllowanceOverride({
            personId: item.personId, allowanceDate: item.allowanceDate, projectId: item.projectId,
            geofenceId: item.geofenceId, action: decision, reason,
          });
          setOverrides(await listAllowanceOverrides(bounds.weekStart, bounds.weekEnd));
          notify('Exceção enviada para aprovação', { variant: 'success' });
        } else {
          const updated = await reviewException(item.id, decision, reason);
          setItems((prev) => prev.map((it) => (it.id === updated.id ? updated : it)));
          setSelected(updated);
          notify(decision === 'include' ? 'Diária incluída' : 'Diária bloqueada', { variant: 'success' });
        }
      } catch (e) {
        notify(e instanceof Error ? e.message : 'Erro ao revisar', { variant: 'error' });
      } finally {
        setActionBusy(false);
      }
    },
    [notify, bounds],
  );

  const handleRemovePerson = useCallback(
    async (row: PersonRow) => {
      if (!week || !isOwnerAdmin) return;
      const reason = window.prompt(
        `Informe o motivo para remover ${row.name} das diárias desta semana:`,
      );
      if (!reason?.trim()) return;

      const approved = ['finance_approved', 'scheduled', 'processing', 'paid', 'reconciliation', 'closed']
        .includes(week.status);
      const warning = approved
        ? 'As diárias serão estornadas, preservando a evidência aprovada. Se já houver processamento financeiro, será criada uma compensação.'
        : 'As diárias desta pessoa serão removidas da semana.';
      if (!window.confirm(`${warning}\n\nConfirmar remoção de ${row.name}?`)) return;

      setActionBusy(true);
      try {
        const result = await removePersonFromAllowanceWeek(week.id, row.personId, reason);
        await reload();
        setSelected(null);
        notify(result.mode === 'removed' ? 'Pessoa removida das diárias' : 'Diárias da pessoa estornadas', {
          description: result.compensationCents > 0
            ? `Compensação de ${formatCents(result.compensationCents)} criada e pendente de aprovação.`
            : `${result.affectedRows} diária(s) afetada(s).`,
          variant: result.compensationCents > 0 ? 'warning' : 'success',
        });
      } catch (e) {
        notify('Erro ao remover pessoa das diárias', {
          description: e instanceof Error ? e.message : undefined,
          variant: 'error',
        });
      } finally {
        setActionBusy(false);
      }
    },
    [week, isOwnerAdmin, notify, reload],
  );

  const handleOverrideDecision = useCallback(async (id: string, decision: 'approved' | 'rejected') => {
    setActionBusy(true);
    try {
      await decideAllowanceOverride(id, decision);
      setOverrides(await listAllowanceOverrides(bounds.weekStart, bounds.weekEnd));
      notify(decision === 'approved' ? 'Exceção aprovada; recalcule a prévia' : 'Exceção rejeitada', { variant: 'success' });
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Erro ao decidir exceção', { variant: 'error' });
    } finally {
      setActionBusy(false);
    }
  }, [bounds, notify]);

  /** Ações de fluxo disponíveis no estado atual, filtradas por permissão. */
  const weekActions = useMemo(() => {
    if (!week) return [] as WeekAction[];
    const byStatus: Partial<Record<AllowanceWeek['status'], WeekAction[]>> = {
      generated: ['send_to_manager_review'],
      manager_review: ['complete_manager_review'],
      hr_validation: week.hrValidatedAt ? ['approve_finance'] : ['validate_hr', 'approve_finance'],
    };
    return (byStatus[week.status] ?? []).filter((a) =>
      hasPermission(WEEK_ACTIONS[a].permission as PermissionKey),
    );
  }, [week, hasPermission]);

  const rows = useMemo(() => buildRows(items), [items]);

  const totals = useMemo(() => {
    let eligible = 0;
    let review = 0;
    let blocked = 0;
    let amount = 0;
    for (const it of items) {
      const klass = classifyReason((it.eligibilityReason ?? 'planned_eligible') as EligibilityReason);
      if (klass === 'eligible') {
        eligible += 1;
        amount += it.amountCents;
      } else if (klass === 'review') review += 1;
      else blocked += 1;
    }
    return { eligible, review, blocked, amount, people: rows.length };
  }, [items, rows.length]);

  const kpis: KpiItem[] = useMemo(
    () => [
      { id: 'people', label: 'Colaboradores', value: totals.people, icon: <Users className="h-4 w-4" /> },
      {
        id: 'eligible',
        label: 'Diárias previstas',
        value: totals.eligible,
        icon: <CheckCircle2 className="h-4 w-4" />,
        onClick: () => setFilter((f) => (f === 'eligible' ? null : 'eligible')),
        active: filter === 'eligible',
      } as KpiItem,
      { id: 'amount', label: 'Valor previsto', value: formatCents(totals.amount) },
      {
        id: 'review',
        label: 'Aguardando revisão',
        value: totals.review,
        variant: totals.review > 0 ? 'warning' : 'default',
        tintValue: totals.review > 0,
        icon: <Clock className="h-4 w-4" />,
        onClick: () => setFilter((f) => (f === 'review' ? null : 'review')),
        active: filter === 'review',
      } as KpiItem,
      {
        id: 'blocked',
        label: 'Bloqueadas',
        value: totals.blocked,
        variant: totals.blocked > 0 ? 'danger' : 'default',
        tintValue: totals.blocked > 0,
        icon: <Ban className="h-4 w-4" />,
        onClick: () => setFilter((f) => (f === 'blocked' ? null : 'blocked')),
        active: filter === 'blocked',
      } as KpiItem,
    ],
    [totals, filter],
  );

  const filteredRows = useMemo(() => {
    if (!filter) return rows;
    return rows.filter((r) => r.counts[filter] > 0);
  }, [rows, filter]);

  return (
    <HudPageLayout>
      <div className="space-y-6">
        <HudHeader
          title="Diárias de Alimentação"
          subtitle={`Planejamento semanal · ${weekLabel(bounds.weekStart, bounds.weekEnd)}`}
          icon={<UtensilsCrossed className="h-5 w-5" />}
          breadcrumbs={[{ label: 'Pessoas & Custos', href: '/workforce-cost' }, { label: 'Diárias de Alimentação' }]}
          actions={
            <div className="flex flex-wrap gap-2">
              {week && canExportPdf && (
                <HudButton onClick={handleExportPdf} disabled={exporting} variant="glass" size="sm">
                  <Download className="h-4 w-4" />
                  {exporting ? 'Gerando PDF…' : 'Exportar PDF'}
                </HudButton>
              )}
              {canManage && (
                <HudButton onClick={handleGenerate} disabled={generating} variant="primary" size="sm">
                  <RefreshCw className={`h-4 w-4 ${generating ? 'animate-spin' : ''}`} />
                  {week ? 'Recalcular prévia' : 'Gerar prévia'}
                </HudButton>
              )}
            </div>
          }
        />

        {error && (
          <HudPanel state="critical">
            <p className="text-sm text-ig-danger">{error}</p>
          </HudPanel>
        )}

        <HudTabs
          tabs={[
            { id: 'planning', label: 'Planejamento semanal', content: null },
            { id: 'operation', label: 'Operação do dia', content: null },
            { id: 'batches', label: 'Lotes de pagamento', content: null },
            { id: 'exceptions', label: 'Exceções', content: null },
            { id: 'history', label: 'Histórico e conciliação', content: null },
            { id: 'intelligence', label: 'Inteligência', content: null },
            { id: 'policies', label: 'Políticas', content: null },
          ]}
          activeTab={activeTab}
          onTabChange={(id) =>
            setActiveTab(
              id as
                | 'planning'
                | 'operation'
                | 'batches'
                | 'exceptions'
                | 'history'
                | 'intelligence'
                | 'policies',
            )
          }
        />

        {activeTab === 'policies' && <PoliciesPanel />}

        {activeTab === 'operation' && (
          <OperationPanel
            week={week}
            items={items}
            dates={dates}
            projectNames={projectNames}
            onSelect={setSelected}
          />
        )}

        {activeTab === 'exceptions' && (
          <ExceptionsPanel
            items={items}
            projectNames={projectNames}
            overrides={overrides}
            canApproveOverride={canApproveOverride}
            busy={actionBusy}
            onOverrideDecision={handleOverrideDecision}
            onSelect={setSelected}
          />
        )}

        {activeTab === 'batches' && (
          <BatchesPanel
            week={week}
            batches={batches}
            canFinance={canFinance}
            busy={actionBusy}
            onGenerate={handleGenerateBatch}
            onExport={handleExportCsv}
          />
        )}

        {activeTab === 'intelligence' && (
          <IntelligencePanel
            week={week}
            intel={intel}
            loading={intelLoading}
            projectNames={projectNames}
          />
        )}

        {activeTab === 'history' && (
          <ReconciliationPanel
            week={week}
            items={items}
            projectNames={projectNames}
            canManage={canManage}
            busy={actionBusy}
            onReconcile={handleReconcile}
            onClose={handleCloseWeek}
            onSelect={setSelected}
          />
        )}

        {activeTab === 'planning' && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <HudBadge variant="info">modo simulação</HudBadge>
              {week && (
                <HudBadge variant={week.status === 'finance_approved' ? 'success' : 'default'}>
                  {ALLOWANCE_WEEK_STATUS_LABELS[week.status]}
                </HudBadge>
              )}
              <span className="text-xs text-ig-fg-muted">
                Nenhum pagamento é executado nesta fase. A prévia calibra as regras contra a rotina
                atual.
              </span>
              {week && (
                <span className="ml-auto text-xs text-ig-fg-muted">
                  Versão {week.version}
                  {week.generatedAt
                    ? ` · gerada em ${new Date(week.generatedAt).toLocaleString('pt-BR')}`
                    : ''}
                </span>
              )}
            </div>

            {week && weekActions.length > 0 && (
              <HudPanel>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-xs font-medium uppercase tracking-wider text-ig-fg-muted">
                    Fluxo de aprovação
                  </span>
                  {week.managerReviewedAt && (
                    <HudBadge variant="success">revisão do gestor OK</HudBadge>
                  )}
                  {week.hrValidatedAt && <HudBadge variant="success">RH validou</HudBadge>}
                  <div className="ml-auto flex flex-wrap gap-2">
                    {weekActions.map((a) => (
                      <HudButton
                        key={a}
                        size="sm"
                        variant={a === 'approve_finance' ? 'primary' : 'secondary'}
                        disabled={actionBusy}
                        onClick={() => handleWeekAction(a)}
                      >
                        {WEEK_ACTIONS[a].label}
                      </HudButton>
                    ))}
                  </div>
                </div>
              </HudPanel>
            )}

            <HudKpiStrip kpis={kpis} columns={5} />

            <HudPanel title="Prévia por colaborador × dia" accentColor="emerald">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-ig-border border-t-ig-accent" />
            </div>
          ) : !week || rows.length === 0 ? (
            <HudEmptyState
              icon="inbox"
              title="Nenhuma prévia para esta semana"
              description={
                canManage
                  ? 'Clique em “Gerar prévia” para avaliar elegibilidade da próxima semana. Requer pessoas, alocações e ao menos uma política de diária ativa.'
                  : 'A prévia semanal ainda não foi gerada.'
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-ig-border">
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-ig-fg-muted">
                      Colaborador
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-ig-fg-muted">
                      Projeto
                    </th>
                    {dates.map((d) => (
                      <th
                        key={d}
                        className="px-2 py-3 text-center text-xs font-medium uppercase tracking-wider text-ig-fg-muted"
                      >
                        {dowLabel(d)}
                        <span className="block text-[10px] font-normal text-ig-fg-muted/70">
                          {dayNum(d)}
                        </span>
                      </th>
                    ))}
                    <th className="px-3 py-3 text-right text-xs font-medium uppercase tracking-wider text-ig-fg-muted">
                      Total
                    </th>
                    <th className="px-3 py-3 text-center text-xs font-medium uppercase tracking-wider text-ig-fg-muted">
                      Status
                    </th>
                    {isOwnerAdmin && (
                      <th className="w-12 px-2 py-3 text-center text-xs font-medium uppercase tracking-wider text-ig-fg-muted">
                        Ações
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => {
                    const st = rowStatus(row);
                    return (
                      <tr
                        key={row.personId}
                        className="border-b border-ig-border-subtle transition-colors hover:bg-ig-panel-hover/40"
                      >
                        <td className="px-4 py-2.5">
                          <p className="text-sm font-medium text-ig-fg-strong">{row.name}</p>
                        </td>
                        <td className="px-3 py-2.5 text-xs text-ig-fg-muted">
                          {projectNames[row.projectId] ?? row.projectId}
                        </td>
                        {dates.map((d) => {
                          const it = row.byDate[d];
                          if (!it) {
                            return (
                              <td key={d} className="px-2 py-2.5 text-center">
                                <span className="text-xs text-ig-fg-muted">—</span>
                              </td>
                            );
                          }
                          const klass = classifyReason(
                            (it.eligibilityReason ?? 'planned_eligible') as EligibilityReason,
                          );
                          const meta = CLASS_META[klass];
                          return (
                            <td key={d} className="px-2 py-2.5 text-center">
                              <button
                                type="button"
                                onClick={() => setSelected(it)}
                                title={
                                  ELIGIBILITY_REASON_LABELS[
                                    (it.eligibilityReason ?? 'planned_eligible') as EligibilityReason
                                  ]
                                }
                                className={`inline-flex h-6 w-6 items-center justify-center rounded-md text-xs font-bold transition-transform hover:scale-110 ${meta.cls}`}
                              >
                                {meta.glyph}
                              </button>
                            </td>
                          );
                        })}
                        <td className="px-3 py-2.5 text-right text-sm font-semibold tabular-nums text-ig-fg-strong">
                          {formatCents(row.totalCents)}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <HudBadge variant={st.variant}>{st.label}</HudBadge>
                        </td>
                        {isOwnerAdmin && (
                          <td className="px-2 py-2.5 text-center">
                            <button
                              type="button"
                              title="Remover pessoa das diárias da semana"
                              disabled={actionBusy}
                              onClick={() => void handleRemovePerson(row)}
                              className="rounded-md p-1.5 text-ig-fg-muted transition-colors hover:bg-ig-panel-hover hover:text-ig-danger disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <UserMinus className="h-4 w-4" />
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
            </HudPanel>
          </>
        )}
      </div>

      <EvidenceDrawer
        key={selected?.id ?? 'none'}
        item={selected}
        projectName={selected ? projectNames[selected.projectId] ?? selected.projectId : ''}
        canReview={canReview}
        busy={actionBusy}
        onReview={handleReview}
        onClose={() => setSelected(null)}
      />
    </HudPageLayout>
  );
}

/* ─────────────────────── evidence drawer ─────────────────────── */

const REVIEWABLE_STATUSES: DailyAllowance['status'][] = [
  'under_review',
  'under_review_missing_schedule',
  'blocked',
];

function EvidenceDrawer({
  item,
  projectName,
  canReview,
  busy,
  onReview,
  onClose,
}: {
  item: DailyAllowance | null;
  projectName: string;
  canReview: boolean;
  busy: boolean;
  onReview: (item: DailyAllowance, decision: ExceptionDecision, reason: string) => void;
  onClose: () => void;
}) {
  const [reviewReason, setReviewReason] = useState('');

  if (!item) return null;
  const reason = (item.eligibilityReason ?? 'planned_eligible') as EligibilityReason;
  const klass = classifyReason(reason);
  const meta = CLASS_META[klass];
  const ev = item.plannedEvidence as Record<string, unknown>;
  const municipality = (ev.municipality ?? {}) as Record<string, unknown>;
  const residence = (municipality.residence ?? null) as Record<string, unknown> | null;
  const service = (municipality.service ?? null) as Record<string, unknown> | null;
  const municipalityOverride = (municipality.override ?? null) as Record<string, unknown> | null;
  const showReview = canReview && REVIEWABLE_STATUSES.includes(item.status);

  const checks: Array<{ ok: boolean; label: string }> = [
    { ok: ev.active_employment === true, label: 'Vínculo ativo' },
    { ok: ev.active_allocation === true, label: 'Alocação ativa na data' },
    { ok: ev.eligible_worksite === true, label: 'Obra elegível (geofence)' },
    { ok: ev.on_leave !== true, label: 'Sem férias ou afastamento' },
    { ok: ev.demobilized !== true, label: 'Sem desmobilização anterior' },
  ];

  return (
    <HudDrawer
      isOpen={!!item}
      onClose={onClose}
      title={item.person?.fullName ?? 'Diária'}
      subtitle={`${new Date(`${item.allowanceDate}T00:00:00`).toLocaleDateString('pt-BR')} · ${projectName}`}
    >
      <div className="space-y-5">
        <div className="flex items-center justify-between rounded-lg border border-ig-border bg-ig-panel px-4 py-3">
          <div>
            <p className="text-xs uppercase tracking-wider text-ig-fg-muted">Valor</p>
            <p className="text-lg font-semibold tabular-nums text-ig-fg-strong">
              {formatCents(item.amountCents)}
            </p>
          </div>
          <span className={`rounded-md px-2.5 py-1 text-xs font-bold ${meta.cls}`}>
            {ELIGIBILITY_REASON_LABELS[reason]}
          </span>
        </div>

        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-ig-fg-muted">
            Evidências de planejamento
          </p>
          <ul className="space-y-1.5">
            {checks.map((c) => (
              <li key={c.label} className="flex items-center gap-2 text-sm">
                {c.ok ? (
                  <CheckCircle2 className="h-4 w-4 text-ig-success" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-ig-danger" />
                )}
                <span className={c.ok ? 'text-ig-fg' : 'text-ig-danger'}>{c.label}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-lg border border-ig-border-subtle px-4 py-3 text-xs text-ig-fg-muted">
          <div className="flex items-center gap-2">
            <CalendarRange className="h-3.5 w-3.5" />
            <span>
              Escala:{' '}
              {ev.schedule_mode
                ? SCHEDULE_MODE_LABELS[ev.schedule_mode as keyof typeof SCHEDULE_MODE_LABELS]
                : '—'}
            </span>
          </div>
          <p className="mt-1">
            Origem da evidência: {item.scheduleEvidenceSource ?? '—'} · Regra {item.ruleVersion}
          </p>
        </div>

        <div className="space-y-3 rounded-lg border border-ig-border-subtle px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wider text-ig-fg-muted">Elegibilidade de deslocamento</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-ig-fg-muted">Residência validada</p>
              <p className="text-sm font-medium text-ig-fg-strong">
                {residence ? `${String(residence.name ?? '—')} - ${String(residence.state_code ?? '—')}` : '—'}
              </p>
              <p className="text-xs text-ig-fg-muted">
                {residence ? `IBGE ${String(residence.code ?? '—')} - fonte ${String(residence.source ?? '—')}` : 'Dado ausente ou não validado'}
              </p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-ig-fg-muted">Local operacional</p>
              <p className="text-sm font-medium text-ig-fg-strong">
                {service ? `${String(service.name ?? '—')} - ${String(service.state_code ?? '—')}` : '—'}
              </p>
              <p className="text-xs text-ig-fg-muted">
                {service ? `IBGE ${String(service.code ?? '—')} - geofence ${String(municipality.project_geofence_id ?? '—')}` : 'Município da geofence ausente'}
              </p>
            </div>
          </div>
          <p className="text-xs text-ig-fg-muted">
            Resultado automático: {ELIGIBILITY_REASON_LABELS[(municipality.automatic_result ?? reason) as EligibilityReason] ?? String(municipality.automatic_result ?? reason)}
          </p>
          {municipalityOverride && (
            <HudBadge variant="info">Exceção aprovada - {String(municipalityOverride.reason ?? '')}</HudBadge>
          )}
        </div>

        {showReview && (
          <div className="space-y-2 rounded-lg border border-ig-border bg-ig-panel px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-wider text-ig-fg-muted">
              Revisão de exceção
            </p>
            <textarea
              value={reviewReason}
              onChange={(e) => setReviewReason(e.target.value)}
              placeholder="Motivo da decisão (obrigatório)…"
              rows={2}
              className="w-full rounded-md border border-ig-border bg-ig-bg px-3 py-2 text-sm text-ig-fg placeholder:text-ig-fg-muted focus:border-ig-accent focus:outline-none"
            />
            <div className="flex gap-2">
              <HudButton
                size="sm"
                variant="primary"
                disabled={busy || !reviewReason.trim()}
                onClick={() => onReview(item, 'include', reviewReason.trim())}
              >
                <CheckCircle2 className="h-4 w-4" />
                Incluir no lote
              </HudButton>
              <HudButton
                size="sm"
                variant="danger"
                disabled={busy || !reviewReason.trim()}
                onClick={() => onReview(item, 'exclude', reviewReason.trim())}
              >
                <Ban className="h-4 w-4" />
                Bloquear
              </HudButton>
            </div>
          </div>
        )}

        {item.reconciliationEvidence ? (
          <ReconciliationEvidence evidence={item.reconciliationEvidence} status={item.status} />
        ) : (
          <div className="rounded-lg border border-ig-warning/30 bg-[color-mix(in_oklab,var(--ig-warning)_8%,transparent)] px-4 py-3 text-xs text-ig-fg-muted">
            Evidências de execução (jornada, geofence, apontamento) aparecem aqui após a conciliação
            (aba Histórico e conciliação).
          </div>
        )}
      </div>
    </HudDrawer>
  );
}

function ReconciliationEvidence({
  evidence,
  status,
}: {
  evidence: Record<string, unknown>;
  status: DailyAllowance['status'];
}) {
  const signals = (evidence.signals ?? {}) as Record<string, boolean>;
  const reasons = (evidence.reasons ?? []) as Array<keyof typeof RECONCILIATION_REASON_LABELS>;
  const checks: Array<{ ok: boolean; label: string }> = [
    { ok: signals.clock_in === true, label: 'Entrada registrada (jornada)' },
    { ok: signals.within_geofence === true, label: 'Dentro da geofence da obra' },
    { ok: signals.project_time_entry === true, label: 'Apontamento no projeto correto' },
  ];
  const divergent = status === 'divergent';
  return (
    <div
      className={`space-y-2 rounded-lg border px-4 py-3 ${
        divergent
          ? 'border-ig-danger/30 bg-[color-mix(in_oklab,var(--ig-danger)_8%,transparent)]'
          : 'border-ig-success/30 bg-[color-mix(in_oklab,var(--ig-success)_8%,transparent)]'
      }`}
    >
      <p className="text-xs font-medium uppercase tracking-wider text-ig-fg-muted">
        Evidências de execução · {divergent ? 'divergente' : 'confirmada'}
      </p>
      <ul className="space-y-1.5">
        {checks.map((c) => (
          <li key={c.label} className="flex items-center gap-2 text-sm">
            {c.ok ? (
              <CheckCircle2 className="h-4 w-4 text-ig-success" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-ig-warning" />
            )}
            <span className={c.ok ? 'text-ig-fg' : 'text-ig-fg-muted'}>{c.label}</span>
          </li>
        ))}
      </ul>
      {reasons.length > 0 && (
        <div className="pt-1 text-xs text-ig-danger">
          {reasons.map((r) => RECONCILIATION_REASON_LABELS[r] ?? r).join(' · ')}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── policies ───────────────────────── */

const POLICY_STATUS_META: Record<
  AllowancePolicy['status'],
  { label: string; variant: 'success' | 'warning' | 'default' }
> = {
  active: { label: 'Ativa', variant: 'success' },
  draft: { label: 'Rascunho', variant: 'warning' },
  inactive: { label: 'Inativa', variant: 'default' },
};

function PoliciesPanel() {
  const { hasPermission } = usePermissions();
  const { notify } = useHudToast();
  const canManage = hasPermission('allowances.policy_manage');

  const [loading, setLoading] = useState(true);
  const [policies, setPolicies] = useState<AllowancePolicy[]>([]);
  const [projects, setProjects] = useState<Array<{ id: string; label: string }>>([]);
  const [geofences, setGeofences] = useState<ProjectGeofence[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [pols, projs, geos] = await Promise.all([
        listAllowancePolicies(),
        getProjectsAsync().catch(() => []),
        listGeofences().catch(() => []),
      ]);
      setPolicies(pols);
      setProjects(projs.map((p) => ({ id: p.id, label: p.codigo || p.nome || p.id })));
      setGeofences(geos);
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Erro ao carregar políticas', { variant: 'error' });
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const projectLabel = useCallback(
    (id: string | null) => (id ? projects.find((p) => p.id === id)?.label ?? id : 'Todos (fallback)'),
    [projects],
  );

  async function toggleStatus(policy: AllowancePolicy) {
    setBusyId(policy.id);
    try {
      const next = policy.status === 'active' ? 'inactive' : 'active';
      await setAllowancePolicyStatus(policy.id, next);
      notify(next === 'active' ? 'Política ativada' : 'Política desativada', { variant: 'success' });
      await reload();
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Erro ao atualizar', { variant: 'error' });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <HudPanel
      title="Políticas de diária"
      accentColor="emerald"
      headerActions={
        canManage ? (
          <HudButton size="sm" variant="primary" onClick={() => setShowCreate(true)}>
            Nova política
          </HudButton>
        ) : undefined
      }
    >
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-ig-border border-t-ig-accent" />
        </div>
      ) : policies.length === 0 ? (
        <HudEmptyState
          icon="file"
          title="Nenhuma política cadastrada"
          description={
            canManage
              ? 'Cadastre uma política ativa (valor + projeto + regras) para a prévia semanal poder gerar diárias.'
              : 'Nenhuma política de diária cadastrada.'
          }
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-ig-border">
                {['Política', 'Projeto', 'Valor', 'Escala', 'Deslocamento', 'Vigência', 'Status', ''].map((h) => (
                  <th
                    key={h}
                    className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-ig-fg-muted"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {policies.map((p) => {
                const meta = POLICY_STATUS_META[p.status];
                return (
                  <tr key={p.id} className="border-b border-ig-border-subtle">
                    <td className="px-3 py-2.5 text-sm font-medium text-ig-fg-strong">{p.name}</td>
                    <td className="px-3 py-2.5 text-xs text-ig-fg-muted">{projectLabel(p.projectId)}</td>
                    <td className="px-3 py-2.5 text-sm font-semibold tabular-nums text-ig-fg-strong">
                      {formatCents(p.amountCents)}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-ig-fg-muted">
                      {SCHEDULE_MODE_LABELS[p.scheduleMode]}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-ig-fg-muted">
                      {TRAVEL_ELIGIBILITY_MODE_LABELS[p.travelEligibilityMode]} - v{p.version}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-ig-fg-muted">
                      {new Date(`${p.effectiveFrom}T00:00:00`).toLocaleDateString('pt-BR')}
                      {p.effectiveUntil
                        ? ` – ${new Date(`${p.effectiveUntil}T00:00:00`).toLocaleDateString('pt-BR')}`
                        : ' →'}
                    </td>
                    <td className="px-3 py-2.5">
                      <HudBadge variant={meta.variant}>{meta.label}</HudBadge>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {canManage && (
                        <HudButton
                          size="sm"
                          variant="ghost"
                          disabled={busyId === p.id}
                          onClick={() => void toggleStatus(p)}
                        >
                          {p.status === 'active' ? 'Desativar' : 'Ativar'}
                        </HudButton>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <PolicyCreateModal
          projects={projects}
          geofences={geofences}
          onClose={() => setShowCreate(false)}
          onSaved={async () => {
            setShowCreate(false);
            await reload();
          }}
        />
      )}
    </HudPanel>
  );
}

function PolicyCreateModal({
  projects,
  geofences,
  onClose,
  onSaved,
}: {
  projects: Array<{ id: string; label: string }>;
  geofences: ProjectGeofence[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const ALL_PROJECTS = '__all__';
  const NO_GEOFENCE = '__none__';
  const { notify } = useHudToast();
  const today = new Date().toISOString().slice(0, 10);
  const [name, setName] = useState('');
  const [projectId, setProjectId] = useState(ALL_PROJECTS);
  const [geofenceId, setGeofenceId] = useState(NO_GEOFENCE);
  const [amount, setAmount] = useState('45,00');
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>('derived');
  const [travelEligibilityMode, setTravelEligibilityMode] = useState<TravelEligibilityMode>('different_municipality');
  const [residenceRequired, setResidenceRequired] = useState(true);
  const [serviceRequired, setServiceRequired] = useState(true);
  const [activateNow, setActivateNow] = useState(true);
  const [saving, setSaving] = useState(false);

  const projectGeofences = geofences.filter((g) => g.projectId === projectId);
  const amountCents = (() => {
    const n = Number(amount.replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) ? Math.round(n * 100) : NaN;
  })();
  const amountValid = Number.isFinite(amountCents) && amountCents > 0;

  async function handleSave() {
    if (!name.trim()) {
      notify('Informe o nome da política', { variant: 'warning' });
      return;
    }
    if (!amountValid) {
      notify('Valor inválido', { variant: 'warning' });
      return;
    }
    setSaving(true);
    try {
      await createAllowancePolicy({
        name: name.trim(),
        projectId: projectId === ALL_PROJECTS ? null : projectId,
        geofenceId: geofenceId === NO_GEOFENCE ? null : geofenceId,
        amountCents,
        effectiveFrom,
        scheduleMode,
        travelEligibilityMode,
        residenceMunicipalityRequired: residenceRequired,
        serviceMunicipalityRequired: serviceRequired,
        status: activateNow ? 'active' : 'draft',
      });
      notify('Política criada', { variant: 'success' });
      await onSaved();
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Erro ao criar política', { variant: 'error' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <HudModal
      isOpen
      onClose={onClose}
      title="Nova política de diária"
      subtitle="Valor, escopo e regras de elegibilidade"
      size="lg"
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <span className="text-xs text-ig-fg-muted">
            {amountValid ? formatCents(amountCents) : '—'} · {SCHEDULE_MODE_LABELS[scheduleMode]}
          </span>
          <div className="flex gap-2">
            <HudButton variant="ghost" onClick={onClose}>
              Cancelar
            </HudButton>
            <HudButton
              variant="primary"
              onClick={() => void handleSave()}
              disabled={saving || !name.trim() || !amountValid}
            >
              {saving ? 'Salvando…' : 'Criar política'}
            </HudButton>
          </div>
        </div>
      }
    >
      <div className="space-y-6">
        {/* Identificação */}
        <section className="space-y-3">
          <HudInput
            label="Nome da política"
            placeholder="Ex.: Diária Alimentação CEMIG"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </section>

        {/* Escopo */}
        <section className="space-y-3">
          <p className="text-[11px] font-medium uppercase tracking-wider text-ig-fg-muted">
            Escopo
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <HudSelect
              label="Projeto"
              value={projectId}
              onChange={(v) => {
                setProjectId(v);
                setGeofenceId(NO_GEOFENCE);
              }}
              options={[
                { value: ALL_PROJECTS, label: 'Todos os projetos (fallback)' },
                ...projects.map((p) => ({ value: p.id, label: p.label })),
              ]}
            />
            <HudSelect
              label="Obra (geofence)"
              value={geofenceId}
              onChange={setGeofenceId}
              options={[
                { value: NO_GEOFENCE, label: 'Qualquer / não exigir' },
                ...projectGeofences.map((g) => ({ value: g.id, label: g.name })),
              ]}
            />
          </div>
          {projectId !== ALL_PROJECTS && projectGeofences.length === 0 && (
            <p className="text-xs text-ig-fg-muted">
              Este projeto ainda não tem geofences cadastradas — a obra ficará como “qualquer”.
            </p>
          )}
        </section>

        <section className="space-y-3">
          <p className="text-[11px] font-medium uppercase tracking-wider text-ig-fg-muted">Elegibilidade de deslocamento</p>
          <HudSelect
            label="Regra municipal"
            value={travelEligibilityMode}
            onChange={(v) => setTravelEligibilityMode(v as TravelEligibilityMode)}
            options={Object.entries(TRAVEL_ELIGIBILITY_MODE_LABELS).map(([value, label]) => ({ value, label }))}
          />
          <div className="flex flex-wrap gap-5 text-sm text-ig-fg-muted">
            <label className="flex items-center gap-2"><input type="checkbox" checked={residenceRequired} onChange={(e) => setResidenceRequired(e.target.checked)} /> Residência validada obrigatória</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={serviceRequired} onChange={(e) => setServiceRequired(e.target.checked)} /> Município do serviço obrigatório</label>
          </div>
        </section>

        {/* Valor e vigência */}
        <section className="space-y-3">
          <p className="text-[11px] font-medium uppercase tracking-wider text-ig-fg-muted">
            Valor e vigência
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <HudInput
              label="Valor da diária"
              inputMode="decimal"
              leftIcon={<span className="text-xs font-semibold text-ig-fg-muted">R$</span>}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="45,00"
              error={amount && !amountValid ? 'Valor inválido' : undefined}
            />
            <HudInput
              label="Vigência a partir de"
              type="date"
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
            />
          </div>
        </section>

        {/* Regras */}
        <section className="space-y-3">
          <p className="text-[11px] font-medium uppercase tracking-wider text-ig-fg-muted">
            Regras
          </p>
          <HudSelect
            label="Modo de escala"
            value={scheduleMode}
            onChange={(v) => setScheduleMode(v as ScheduleMode)}
            options={Object.entries(SCHEDULE_MODE_LABELS).map(([value, label]) => ({ value, label }))}
          />
          <button
            type="button"
            onClick={() => setActivateNow((v) => !v)}
            className="flex w-full items-center justify-between gap-3 rounded-xl border border-ig-border bg-ig-panel px-4 py-3 text-left transition-colors hover:bg-ig-panel-hover/50"
          >
            <span>
              <span className="block text-sm font-medium text-ig-fg-strong">Ativar imediatamente</span>
              <span className="block text-xs text-ig-fg-muted">
                Necessário para a prévia semanal gerar diárias com esta política.
              </span>
            </span>
            <span
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                activateNow ? 'bg-ig-accent' : 'bg-ig-border'
              }`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                  activateNow ? 'translate-x-[22px]' : 'translate-x-0.5'
                }`}
              />
            </span>
          </button>
        </section>
      </div>
    </HudModal>
  );
}

/* ────────────────────── payment batches ─────────────────────── */

const BATCH_STATUS_VARIANT: Record<
  AllowancePaymentBatch['status'],
  'success' | 'warning' | 'danger' | 'default'
> = {
  draft: 'default',
  pending_approval: 'warning',
  approved: 'warning',
  exported: 'success',
  failed: 'danger',
  cancelled: 'default',
};

function BatchesPanel({
  week,
  batches,
  canFinance,
  busy,
  onGenerate,
  onExport,
}: {
  week: AllowanceWeek | null;
  batches: AllowancePaymentBatch[];
  canFinance: boolean;
  busy: boolean;
  onGenerate: () => void;
  onExport: (batchId: string) => void;
}) {
  const canGenerate = canFinance && week?.status === 'finance_approved' && batches.length === 0;

  return (
    <HudPanel
      title="Lotes de pagamento"
      accentColor="emerald"
      headerActions={
        canGenerate ? (
          <HudButton size="sm" variant="primary" disabled={busy} onClick={onGenerate}>
            Gerar lote
          </HudButton>
        ) : undefined
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <HudBadge variant="info">modo simulação</HudBadge>
        <span className="text-xs text-ig-fg-muted">
          O Financeiro aprova e exporta um único lote semanal. O pagamento é executado na ferramenta
          financeira atual — sem integração bancária nesta fase.
        </span>
      </div>

      {batches.length === 0 ? (
        <HudEmptyState
          icon="inbox"
          title="Nenhum lote gerado"
          description={
            week?.status === 'finance_approved'
              ? 'A semana está aprovada. Gere o lote único para exportação.'
              : 'O lote é gerado após a aprovação financeira da semana (aba Planejamento).'
          }
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-ig-border">
                {['Lote', 'Diárias', 'Valor', 'Status', 'Exportado em', ''].map((h) => (
                  <th
                    key={h}
                    className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-ig-fg-muted"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id} className="border-b border-ig-border-subtle">
                  <td className="px-3 py-2.5 font-mono text-xs text-ig-fg-strong">{b.batchCode}</td>
                  <td className="px-3 py-2.5 text-sm tabular-nums text-ig-fg">{b.itemCount}</td>
                  <td className="px-3 py-2.5 text-sm font-semibold tabular-nums text-ig-fg-strong">
                    {formatCents(b.totalAmountCents)}
                  </td>
                  <td className="px-3 py-2.5">
                    <HudBadge variant={BATCH_STATUS_VARIANT[b.status]}>
                      {PAYMENT_BATCH_STATUS_LABELS[b.status]}
                    </HudBadge>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-ig-fg-muted">
                    {b.exportedAt ? new Date(b.exportedAt).toLocaleString('pt-BR') : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {canFinance && (
                      <HudButton
                        size="sm"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => onExport(b.id)}
                      >
                        <Download className="h-4 w-4" />
                        Exportar CSV
                      </HudButton>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-4 text-xs text-ig-fg-muted">
        Use <b>Exportar PDF</b> (cabeçalho) para o relatório executivo da semana no padrão Insight.
      </p>
    </HudPanel>
  );
}

/* ─────────────────── reconciliation (Fase 4) ─────────────────── */

const RECONCILABLE_WEEK_STATUSES: AllowanceWeek['status'][] = [
  'scheduled',
  'paid',
  'reconciliation',
];
const RECONCILED_STATUSES: DailyAllowance['status'][] = ['confirmed', 'divergent'];

function ReconciliationPanel({
  week,
  items,
  projectNames,
  canManage,
  busy,
  onReconcile,
  onClose,
  onSelect,
}: {
  week: AllowanceWeek | null;
  items: DailyAllowance[];
  projectNames: Record<string, string>;
  canManage: boolean;
  busy: boolean;
  onReconcile: () => void;
  onClose: () => void;
  onSelect: (item: DailyAllowance) => void;
}) {
  const reconciled = useMemo(
    () => items.filter((it) => RECONCILED_STATUSES.includes(it.status)),
    [items],
  );
  const confirmed = reconciled.filter((it) => it.status === 'confirmed').length;
  const divergent = reconciled.filter((it) => it.status === 'divergent').length;

  const canReconcile = canManage && week != null && RECONCILABLE_WEEK_STATUSES.includes(week.status);
  const canClose = canManage && week?.status === 'reconciliation';

  return (
    <HudPanel
      title="Histórico e conciliação"
      accentColor="emerald"
      headerActions={
        <div className="flex gap-2">
          {canReconcile && (
            <HudButton size="sm" variant="primary" disabled={busy} onClick={onReconcile}>
              <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
              Conciliar semana
            </HudButton>
          )}
          {canClose && (
            <HudButton size="sm" variant="secondary" disabled={busy} onClick={onClose}>
              Encerrar semana
            </HudButton>
          )}
        </div>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <HudBadge variant="success">{confirmed} confirmadas</HudBadge>
        <HudBadge variant={divergent > 0 ? 'danger' : 'default'}>{divergent} divergentes</HudBadge>
        <span className="text-xs text-ig-fg-muted">
          Cruza jornada, geofence e apontamento com o previsto. Divergências são sinalizadas para
          análise — nenhum desconto é aplicado automaticamente.
        </span>
      </div>

      {reconciled.length === 0 ? (
        <HudEmptyState
          icon="inbox"
          title="Semana ainda não conciliada"
          description={
            canReconcile
              ? 'Clique em “Conciliar semana” para comparar o previsto com o realizado.'
              : 'A conciliação ocorre após o lote de pagamento da semana.'
          }
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-ig-border">
                {['Colaborador', 'Projeto', 'Data', 'Resultado', 'Motivos'].map((h) => (
                  <th
                    key={h}
                    className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-ig-fg-muted"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {reconciled.map((it) => {
                const ev = (it.reconciliationEvidence ?? {}) as Record<string, unknown>;
                const reasons = (ev.reasons ?? []) as Array<
                  keyof typeof RECONCILIATION_REASON_LABELS
                >;
                const div = it.status === 'divergent';
                return (
                  <tr
                    key={it.id}
                    onClick={() => onSelect(it)}
                    className="cursor-pointer border-b border-ig-border-subtle hover:bg-ig-panel-hover/40"
                  >
                    <td className="px-3 py-2.5 text-sm font-medium text-ig-fg-strong">
                      {it.person?.fullName ?? it.personId}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-ig-fg-muted">
                      {projectNames[it.projectId] ?? it.projectId}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-ig-fg-muted">
                      {new Date(`${it.allowanceDate}T00:00:00`).toLocaleDateString('pt-BR')}
                    </td>
                    <td className="px-3 py-2.5">
                      <HudBadge variant={div ? 'danger' : 'success'}>
                        {div ? 'Divergente' : 'Confirmada'}
                      </HudBadge>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-ig-fg-muted">
                      {reasons.length > 0
                        ? reasons.map((r) => RECONCILIATION_REASON_LABELS[r] ?? r).join(' · ')
                        : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </HudPanel>
  );
}

/* ─────────────────── operação do dia (por data) ──────────────── */

function OperationPanel({
  week,
  items,
  dates,
  projectNames,
  onSelect,
}: {
  week: AllowanceWeek | null;
  items: DailyAllowance[];
  dates: string[];
  projectNames: Record<string, string>;
  onSelect: (item: DailyAllowance) => void;
}) {
  const todayISO = new Date().toISOString().slice(0, 10);
  const defaultDay = dates.includes(todayISO) ? todayISO : dates[0];
  const [day, setDay] = useState(defaultDay);

  const dayItems = useMemo(
    () =>
      items
        .filter((it) => it.allowanceDate === day)
        .sort((a, b) => (a.person?.fullName ?? '').localeCompare(b.person?.fullName ?? '', 'pt-BR')),
    [items, day],
  );

  if (!week || items.length === 0) {
    return (
      <HudPanel title="Operação do dia" accentColor="emerald">
        <HudEmptyState
          icon="inbox"
          title="Sem diárias para operar"
          description="Gere a prévia semanal (aba Planejamento) para acompanhar a operação por dia."
        />
      </HudPanel>
    );
  }

  return (
    <HudPanel title="Operação do dia" accentColor="emerald">
      <div className="mb-4 flex flex-wrap gap-1.5">
        {dates.map((d) => {
          const active = d === day;
          const isToday = d === todayISO;
          return (
            <button
              key={d}
              type="button"
              onClick={() => setDay(d)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? 'border-ig-accent bg-ig-accent-weak text-ig-accent'
                  : 'border-ig-border text-ig-fg-muted hover:bg-ig-panel-hover/50'
              }`}
            >
              {DOW_LABELS[new Date(`${d}T00:00:00`).getDay()]} {dayNum(d)}
              {isToday && <span className="ml-1 text-[10px] opacity-70">hoje</span>}
            </button>
          );
        })}
      </div>

      {dayItems.length === 0 ? (
        <HudEmptyState icon="inbox" title="Nenhuma diária neste dia" description="" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-ig-border">
                {['Colaborador', 'Projeto', 'Valor', 'Situação'].map((h) => (
                  <th
                    key={h}
                    className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-ig-fg-muted"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dayItems.map((it) => {
                const klass = classifyReason(
                  (it.eligibilityReason ?? 'planned_eligible') as EligibilityReason,
                );
                return (
                  <tr
                    key={it.id}
                    onClick={() => onSelect(it)}
                    className="cursor-pointer border-b border-ig-border-subtle hover:bg-ig-panel-hover/40"
                  >
                    <td className="px-3 py-2.5 text-sm font-medium text-ig-fg-strong">
                      {it.person?.fullName ?? it.personId}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-ig-fg-muted">
                      {projectNames[it.projectId] ?? it.projectId}
                    </td>
                    <td className="px-3 py-2.5 text-sm font-semibold tabular-nums text-ig-fg-strong">
                      {formatCents(it.amountCents)}
                    </td>
                    <td className="px-3 py-2.5">
                      <HudBadge
                        variant={
                          klass === 'eligible' ? 'success' : klass === 'review' ? 'warning' : 'danger'
                        }
                      >
                        {ELIGIBILITY_REASON_LABELS[(it.eligibilityReason ?? 'planned_eligible') as EligibilityReason]}
                      </HudBadge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </HudPanel>
  );
}

/* ─────────────────────── exceções (fila) ─────────────────────── */

const EXCEPTION_STATUSES: DailyAllowance['status'][] = [
  'under_review',
  'under_review_missing_schedule',
  'blocked',
];

function ExceptionsPanel({
  items,
  projectNames,
  overrides,
  canApproveOverride,
  busy,
  onOverrideDecision,
  onSelect,
}: {
  items: DailyAllowance[];
  projectNames: Record<string, string>;
  overrides: AllowanceEligibilityOverride[];
  canApproveOverride: boolean;
  busy: boolean;
  onOverrideDecision: (id: string, decision: 'approved' | 'rejected') => void;
  onSelect: (item: DailyAllowance) => void;
}) {
  const exceptions = useMemo(
    () =>
      items
        .filter((it) => EXCEPTION_STATUSES.includes(it.status))
        .sort((a, b) => a.allowanceDate.localeCompare(b.allowanceDate)),
    [items],
  );

  return (
    <HudPanel title="Exceções" accentColor="emerald">
      {overrides.length > 0 && (
        <div className="mb-5 space-y-2 rounded-xl border border-ig-border bg-ig-panel p-3">
          <p className="text-xs font-medium uppercase tracking-wider text-ig-fg-muted">Exceções municipais auditáveis</p>
          {overrides.map((override) => (
            <div key={override.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ig-border-subtle px-3 py-2">
              <div>
                <p className="text-sm text-ig-fg-strong">{override.action === 'include' ? 'Incluir' : 'Excluir'} - {override.allowanceDate} - {projectNames[override.projectId] ?? override.projectId}</p>
                <p className="text-xs text-ig-fg-muted">{override.reason}</p>
              </div>
              <div className="flex items-center gap-2">
                <HudBadge variant={override.status === 'approved' ? 'success' : override.status === 'rejected' ? 'danger' : 'warning'}>{override.status}</HudBadge>
                {canApproveOverride && override.status === 'pending_approval' && <>
                  <HudButton size="sm" variant="primary" disabled={busy} onClick={() => onOverrideDecision(override.id, 'approved')}>Aprovar</HudButton>
                  <HudButton size="sm" variant="danger" disabled={busy} onClick={() => onOverrideDecision(override.id, 'rejected')}>Rejeitar</HudButton>
                </>}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <HudBadge variant={exceptions.length > 0 ? 'warning' : 'success'}>
          {exceptions.length} exceção(ões)
        </HudBadge>
        <span className="text-xs text-ig-fg-muted">
          Diárias que exigem decisão do gestor (revisão) ou já bloqueadas. Abra para incluir no lote
          ou bloquear com motivo.
        </span>
      </div>

      {exceptions.length === 0 ? (
        <HudEmptyState
          icon="search"
          title="Nenhuma exceção"
          description="Todos os casos da semana estão elegíveis ou já resolvidos."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-ig-border">
                {['Colaborador', 'Projeto', 'Data', 'Motivo'].map((h) => (
                  <th
                    key={h}
                    className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-ig-fg-muted"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {exceptions.map((it) => {
                const reason = (it.eligibilityReason ?? 'planned_eligible') as EligibilityReason;
                const klass = classifyReason(reason);
                return (
                  <tr
                    key={it.id}
                    onClick={() => onSelect(it)}
                    className="cursor-pointer border-b border-ig-border-subtle hover:bg-ig-panel-hover/40"
                  >
                    <td className="px-3 py-2.5 text-sm font-medium text-ig-fg-strong">
                      {it.person?.fullName ?? it.personId}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-ig-fg-muted">
                      {projectNames[it.projectId] ?? it.projectId}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-ig-fg-muted">
                      {new Date(`${it.allowanceDate}T00:00:00`).toLocaleDateString('pt-BR')}
                    </td>
                    <td className="px-3 py-2.5">
                      <HudBadge variant={klass === 'review' ? 'warning' : 'danger'}>
                        {ELIGIBILITY_REASON_LABELS[reason]}
                      </HudBadge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </HudPanel>
  );
}

/* ───────────────────── inteligência (Fase 5) ─────────────────── */

const ALERT_SEVERITY_VARIANT: Record<AlertSeverity, 'danger' | 'warning' | 'info'> = {
  critical: 'danger',
  warning: 'warning',
  info: 'info',
};

function IntelligencePanel({
  week,
  intel,
  loading,
  projectNames,
}: {
  week: AllowanceWeek | null;
  intel: WeekIntelligence | null;
  loading: boolean;
  projectNames: Record<string, string>;
}) {
  if (!week) {
    return (
      <HudPanel title="Inteligência" accentColor="emerald">
        <HudEmptyState
          icon="inbox"
          title="Sem dados para analisar"
          description="Gere a prévia semanal para ver alertas de inconsistência e custo por projeto."
        />
      </HudPanel>
    );
  }
  if (loading || !intel) {
    return (
      <HudPanel title="Inteligência" accentColor="emerald">
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-ig-border border-t-ig-accent" />
        </div>
      </HudPanel>
    );
  }

  const growth =
    intel.previous && intel.previous.totalCents > 0
      ? ((intel.totalCents - intel.previous.totalCents) / intel.previous.totalCents) * 100
      : null;

  return (
    <div className="space-y-6">
      <HudPanel title="Alertas de inconsistência" accentColor="emerald">
        <p className="mb-3 text-xs text-ig-fg-muted">
          Sinais para análise — nunca acusação de fraude. Cada alerta indica uma diária que merece
          revisão de RH/Financeiro.
        </p>
        {intel.alerts.length === 0 ? (
          <HudEmptyState
            icon="search"
            title="Nenhuma inconsistência detectada"
            description="A semana está consistente com alocação, escala e ausências conhecidas."
          />
        ) : (
          <div className="space-y-2">
            {intel.alerts.map((a, i) => (
              <div
                key={`${a.code}-${i}`}
                className="flex items-start gap-3 rounded-xl border border-ig-border bg-ig-panel px-4 py-3"
              >
                <HudBadge variant={ALERT_SEVERITY_VARIANT[a.severity]}>
                  {ALERT_SEVERITY_LABELS[a.severity]}
                </HudBadge>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ig-fg-strong">
                    {a.title}
                    {a.projectId ? ` · ${projectNames[a.projectId] ?? a.projectId}` : ''}
                  </p>
                  <p className="text-xs text-ig-fg-muted">{a.detail}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </HudPanel>

      <HudPanel title="Custo por projeto" accentColor="emerald">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <HudBadge variant="default">Total {formatCents(intel.totalCents)}</HudBadge>
          <HudBadge variant="default">{intel.totalPeople} colaborador(es)</HudBadge>
          {growth != null && (
            <HudBadge variant={growth > 25 ? 'warning' : 'default'}>
              {growth >= 0 ? '+' : ''}
              {growth.toFixed(0)}% vs. semana anterior
            </HudBadge>
          )}
        </div>
        {intel.costByProject.length === 0 ? (
          <HudEmptyState icon="inbox" title="Sem custo apropriado" description="" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-ig-border">
                  {['Projeto', 'Colaboradores', 'Diárias', 'Custo'].map((h) => (
                    <th
                      key={h}
                      className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-ig-fg-muted"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {intel.costByProject.map((r) => (
                  <tr key={r.projectId} className="border-b border-ig-border-subtle">
                    <td className="px-3 py-2.5 text-sm font-medium text-ig-fg-strong">
                      {projectNames[r.projectId] ?? r.projectId}
                    </td>
                    <td className="px-3 py-2.5 text-sm tabular-nums text-ig-fg">{r.people}</td>
                    <td className="px-3 py-2.5 text-sm tabular-nums text-ig-fg">{r.items}</td>
                    <td className="px-3 py-2.5 text-sm font-semibold tabular-nums text-ig-fg-strong">
                      {formatCents(r.amountCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </HudPanel>
    </div>
  );
}
