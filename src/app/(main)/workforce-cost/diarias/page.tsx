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
  RefreshCw,
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
  createAllowancePolicy,
  generateWeeklyAllowancePreview,
  getLatestWeek,
  listAllowancePolicies,
  listDailyAllowancesByWeek,
  nextWeekBounds,
  performWeekAction,
  reviewException,
  setAllowancePolicyStatus,
  weekLabel,
  type ExceptionDecision,
} from '@/lib/services/allowances';
import { WEEK_ACTIONS, type WeekAction } from '@/lib/services/allowance-workflow';
import type { PermissionKey } from '@/lib/auth/types';
import {
  ALLOWANCE_WEEK_STATUS_LABELS,
  classifyReason,
  ELIGIBILITY_REASON_LABELS,
  SCHEDULE_MODE_LABELS,
  type AllowancePolicy,
  type AllowanceWeek,
  type DailyAllowance,
  type DayClassification,
  type EligibilityReason,
  type ScheduleMode,
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
  const { hasPermission } = usePermissions();
  const { notify } = useHudToast();
  const canManage = hasPermission('allowances.manage');
  const canReview = hasPermission('allowances.review_exception') || canManage;

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
  const [activeTab, setActiveTab] = useState<'planning' | 'policies'>('planning');

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
      setItems(existing ? await listDailyAllowancesByWeek(existing.id) : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar diárias');
    } finally {
      setLoading(false);
    }
  }, [bounds]);

  useEffect(() => {
    void reload();
  }, [reload]);

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
        const updated = await performWeekAction(week.id, action);
        setWeek(updated);
        setItems(await listDailyAllowancesByWeek(updated.id));
        notify(`${WEEK_ACTIONS[action].label} — concluído`, { variant: 'success' });
      } catch (e) {
        notify(e instanceof Error ? e.message : 'Erro na transição', { variant: 'error' });
      } finally {
        setActionBusy(false);
      }
    },
    [week, notify],
  );

  const handleReview = useCallback(
    async (item: DailyAllowance, decision: ExceptionDecision, reason: string) => {
      setActionBusy(true);
      try {
        const updated = await reviewException(item.id, decision, reason);
        setItems((prev) => prev.map((it) => (it.id === updated.id ? updated : it)));
        setSelected(updated);
        notify(decision === 'include' ? 'Diária incluída' : 'Diária bloqueada', {
          variant: 'success',
        });
      } catch (e) {
        notify(e instanceof Error ? e.message : 'Erro ao revisar', { variant: 'error' });
      } finally {
        setActionBusy(false);
      }
    },
    [notify],
  );

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
          title="Diárias de Campo"
          subtitle={`Planejamento semanal · ${weekLabel(bounds.weekStart, bounds.weekEnd)}`}
          icon={<UtensilsCrossed className="h-5 w-5" />}
          breadcrumbs={[{ label: 'Pessoas & Custos', href: '/workforce-cost' }, { label: 'Diárias' }]}
          actions={
            canManage ? (
              <HudButton onClick={handleGenerate} disabled={generating} variant="primary" size="sm">
                <RefreshCw className={`h-4 w-4 ${generating ? 'animate-spin' : ''}`} />
                {week ? 'Recalcular prévia' : 'Gerar prévia'}
              </HudButton>
            ) : undefined
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
            { id: 'operation', label: 'Operação do dia', disabled: true, content: null },
            { id: 'batches', label: 'Lotes de pagamento', disabled: true, content: null },
            { id: 'exceptions', label: 'Exceções', disabled: true, content: null },
            { id: 'policies', label: 'Políticas', content: null },
            { id: 'history', label: 'Histórico e conciliação', disabled: true, content: null },
          ]}
          activeTab={activeTab}
          onTabChange={(id) => {
            if (id === 'planning' || id === 'policies') setActiveTab(id);
          }}
        />

        {activeTab === 'policies' && <PoliciesPanel />}

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

        <div className="rounded-lg border border-ig-warning/30 bg-[color-mix(in_oklab,var(--ig-warning)_8%,transparent)] px-4 py-3 text-xs text-ig-fg-muted">
          Evidências de execução (jornada, geofence, apontamento) e conciliação chegam na Fase 4.
        </div>
      </div>
    </HudDrawer>
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
                {['Política', 'Projeto', 'Valor', 'Escala', 'Vigência', 'Status', ''].map((h) => (
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
  const { notify } = useHudToast();
  const today = new Date().toISOString().slice(0, 10);
  const [name, setName] = useState('');
  const [projectId, setProjectId] = useState('');
  const [geofenceId, setGeofenceId] = useState('');
  const [amount, setAmount] = useState('45,00');
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>('derived');
  const [activateNow, setActivateNow] = useState(true);
  const [saving, setSaving] = useState(false);

  const projectGeofences = geofences.filter((g) => g.projectId === projectId);

  function parseAmountCents(v: string): number {
    const normalized = v.replace(/\./g, '').replace(',', '.');
    return Math.round(Number(normalized) * 100);
  }

  async function handleSave() {
    if (!name.trim()) {
      notify('Informe o nome da política', { variant: 'warning' });
      return;
    }
    const cents = parseAmountCents(amount);
    if (!Number.isFinite(cents) || cents <= 0) {
      notify('Valor inválido', { variant: 'warning' });
      return;
    }
    setSaving(true);
    try {
      await createAllowancePolicy({
        name: name.trim(),
        projectId: projectId || null,
        geofenceId: geofenceId || null,
        amountCents: cents,
        effectiveFrom,
        scheduleMode,
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
      subtitle="Valor, escopo e regras de elegibilidade (ADR-005 — regras configuráveis)"
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <HudButton variant="ghost" onClick={onClose}>
            Cancelar
          </HudButton>
          <HudButton variant="primary" onClick={() => void handleSave()} disabled={saving}>
            {saving ? 'Salvando…' : 'Criar'}
          </HudButton>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <HudInput
            label="Nome"
            placeholder="Ex.: Diária Alimentação CEMIG"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <HudSelect
          label="Projeto"
          value={projectId}
          onChange={(v) => {
            setProjectId(v);
            setGeofenceId('');
          }}
          options={[
            { value: '', label: 'Todos (fallback da organização)' },
            ...projects.map((p) => ({ value: p.id, label: p.label })),
          ]}
        />
        <HudSelect
          label="Obra (geofence)"
          value={geofenceId}
          onChange={setGeofenceId}
          options={[
            { value: '', label: 'Qualquer / não exigir' },
            ...projectGeofences.map((g) => ({ value: g.id, label: g.name })),
          ]}
        />
        <HudInput
          label="Valor (R$)"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="45,00"
        />
        <HudInput
          label="Vigência a partir de"
          type="date"
          value={effectiveFrom}
          onChange={(e) => setEffectiveFrom(e.target.value)}
        />
        <HudSelect
          label="Escala"
          value={scheduleMode}
          onChange={(v) => setScheduleMode(v as ScheduleMode)}
          options={Object.entries(SCHEDULE_MODE_LABELS).map(([value, label]) => ({ value, label }))}
        />
        <label className="flex items-center gap-2 text-sm text-ig-fg sm:col-span-2">
          <input
            type="checkbox"
            checked={activateNow}
            onChange={(e) => setActivateNow(e.target.checked)}
            className="h-4 w-4 rounded border-ig-border"
          />
          Ativar imediatamente (necessário para a prévia gerar diárias)
        </label>
      </div>
    </HudModal>
  );
}
