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
  HudKpiStrip,
  HudPageLayout,
  HudPanel,
  HudTabs,
  useHudToast,
  type KpiItem,
} from '@/components/hud';
import { usePermissions } from '@/hooks/use-permissions';
import { formatCents } from '@/lib/services/cost';
import { getProjectsAsync } from '@/lib/services/projects';
import {
  generateWeeklyAllowancePreview,
  getLatestWeek,
  listDailyAllowancesByWeek,
  nextWeekBounds,
  weekLabel,
} from '@/lib/services/allowances';
import {
  classifyReason,
  DAILY_ALLOWANCE_STATUS_LABELS,
  ELIGIBILITY_REASON_LABELS,
  SCHEDULE_MODE_LABELS,
  type AllowanceWeek,
  type DailyAllowance,
  type DayClassification,
  type EligibilityReason,
} from '@/lib/types/allowances';

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

        <div className="flex flex-wrap items-center gap-2">
          <HudBadge variant="info">modo simulação</HudBadge>
          <span className="text-xs text-ig-fg-muted">
            Fase 1 — nenhum pagamento é executado. A prévia calibra as regras contra a rotina atual.
          </span>
          {week && (
            <span className="ml-auto text-xs text-ig-fg-muted">
              Versão {week.version} · {DAILY_ALLOWANCE_STATUS_LABELS.planned && ''}
              {week.generatedAt
                ? `gerada em ${new Date(week.generatedAt).toLocaleString('pt-BR')}`
                : ''}
            </span>
          )}
        </div>

        {error && (
          <HudPanel state="critical">
            <p className="text-sm text-ig-danger">{error}</p>
          </HudPanel>
        )}

        <HudKpiStrip kpis={kpis} columns={5} />

        <HudTabs
          tabs={[
            { id: 'planning', label: 'Planejamento semanal', content: null },
            { id: 'operation', label: 'Operação do dia', disabled: true, content: null },
            { id: 'batches', label: 'Lotes de pagamento', disabled: true, content: null },
            { id: 'exceptions', label: 'Exceções', disabled: true, content: null },
            { id: 'policies', label: 'Políticas', disabled: true, content: null },
            { id: 'history', label: 'Histórico e conciliação', disabled: true, content: null },
          ]}
          activeTab="planning"
          onTabChange={() => undefined}
        />

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
      </div>

      <EvidenceDrawer
        item={selected}
        projectName={selected ? projectNames[selected.projectId] ?? selected.projectId : ''}
        onClose={() => setSelected(null)}
      />
    </HudPageLayout>
  );
}

/* ─────────────────────── evidence drawer ─────────────────────── */

function EvidenceDrawer({
  item,
  projectName,
  onClose,
}: {
  item: DailyAllowance | null;
  projectName: string;
  onClose: () => void;
}) {
  if (!item) return null;
  const reason = (item.eligibilityReason ?? 'planned_eligible') as EligibilityReason;
  const klass = classifyReason(reason);
  const meta = CLASS_META[klass];
  const ev = item.plannedEvidence as Record<string, unknown>;

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

        <div className="rounded-lg border border-ig-warning/30 bg-[color-mix(in_oklab,var(--ig-warning)_8%,transparent)] px-4 py-3 text-xs text-ig-fg-muted">
          Evidências de execução (jornada, geofence, apontamento) e conciliação chegam na Fase 4.
        </div>
      </div>
    </HudDrawer>
  );
}
