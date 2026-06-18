'use client';

import { useMemo, useState, useCallback, Suspense, useEffect } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import {
  FileSpreadsheet, Users, Layers, Calendar, Activity, Building2, Briefcase,
  AlertTriangle, CheckCircle, Link2, ArrowUpRight, ArrowUpDown, Send, PieChart, Scale,
} from 'lucide-react';
import {
  HudPageLayout, HudHeader, HudKpiStrip, HudButton,
  HudPanel, HudTable, HudStatusPill, HudDrawer, HudBadge, HudProgressBar,
  type KpiItem, type HudTableColumn, type HudStatusPillVariant,
} from '@/components/hud';
import {
  FinanceFilterBar, FinanceFilterChip,
  FinanceBarChart, FinanceDonutChart,
  fmtBRL, fmtCompactBRL,
} from '@/components/finance/shared';
import {
  getPayrollAllocations, getPayrollAllocation, getLedgerEntry, getPayrollBatches,
  approvePayrollAllocation, postPayrollAllocation, cancelPayrollAllocation,
  hydratePayrollBatchesFromServer,
  formatBRL, formatCompactBRL,
} from '@/lib/finance/finance-store';
import {
  selectPayrollSummary, selectPayrollByProject, selectPayrollByDepartment,
  selectPayrollByCostCenter, selectPayrollByContract, selectPayrollByCompetence,
  selectPayrollBatchReconciliation, reconcilePayrollBatch,
  filterPayrollAllocations, sortPayrollByCost, canApprovePayroll, canPostPayroll,
  type PayrollAllocationListFilter, type PayrollReconciliationStatus,
} from '@/lib/finance/selectors/payroll';
import type { PayrollAllocation, PayrollAllocationStatus, LedgerEntry } from '@/lib/types/finance';
import { ExportReportButton } from '@/components/reports/ExportReportButton';
import { openFinanceReport, kpiFromHud } from '@/lib/reports/modules/finance-report';

const STATUS_VARIANT: Record<PayrollAllocationStatus, HudStatusPillVariant> = {
  draft: 'neutral',
  allocated: 'info',
  approved: 'pending',
  posted: 'completed',
  cancelled: 'error',
};
const STATUS_LABEL: Record<PayrollAllocationStatus, string> = {
  draft: 'Rascunho',
  allocated: 'Alocado',
  approved: 'Aprovado',
  posted: 'Lançado (DRE)',
  cancelled: 'Cancelado',
};
const ALLOC_STATUSES: PayrollAllocationStatus[] = ['draft', 'allocated', 'approved', 'posted', 'cancelled'];

function allocBarVariant(pct: number): 'success' | 'warning' | 'danger' {
  if (pct >= 80) return 'success';
  if (pct >= 40) return 'warning';
  return 'danger';
}

const RECON_VARIANT: Record<PayrollReconciliationStatus, HudStatusPillVariant> = {
  fully_allocated: 'completed',
  underallocated: 'warning',
  overallocated: 'error',
};
const RECON_LABEL: Record<PayrollReconciliationStatus, string> = {
  fully_allocated: 'Totalmente alocado',
  underallocated: 'Subalocado',
  overallocated: 'Superalocado',
};
const RECON_BAR: Record<PayrollReconciliationStatus, 'success' | 'warning' | 'danger'> = {
  fully_allocated: 'success',
  underallocated: 'warning',
  overallocated: 'danger',
};

export default function FolhaAlocacaoPage() {
  return (
    <Suspense>
      <FolhaAlocacaoContent />
    </Suspense>
  );
}

function FolhaAlocacaoContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const focusAllocId = searchParams.get('allocId');

  const [refreshKey, setRefreshKey] = useState(0);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [filterCompetence, setFilterCompetence] = useState('2026-04');
  const [filterStatus, setFilterStatus] = useState<PayrollAllocationStatus | 'all'>('all');
  const [filterProject, setFilterProject] = useState('all');
  const [filterCostCenter, setFilterCostCenter] = useState('all');
  const [filterDepartment, setFilterDepartment] = useState('all');
  const [processing, setProcessing] = useState(false);
  const [deepLinkMissing, setDeepLinkMissing] = useState<string | null>(null);

  // Hydrate the in-memory finance store with persisted Supabase PayrollBatch
  // records so batches sent from the payroll closing survive a reload. No-op in
  // mock mode; on failure the existing in-memory batches are kept (fallback).
  useEffect(() => {
    hydratePayrollBatchesFromServer().then((added) => { if (added > 0) setRefreshKey((k) => k + 1); });
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const allAllocations = useMemo(() => getPayrollAllocations(), [refreshKey]);

  useEffect(() => {
    if (!focusAllocId) return;
    const alloc = getPayrollAllocation(focusAllocId);
    if (alloc) { setDetailId(alloc.id); setDeepLinkMissing(null); }
    else setDeepLinkMissing(focusAllocId);
    router.replace(pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusAllocId]);

  // Filter option lists derived from the full dataset.
  const competenceOptions = useMemo(() => {
    const set = new Set(allAllocations.map(a => a.competence_month));
    return [{ value: 'all', label: 'Todas' }, ...Array.from(set).sort().reverse().map(c => ({ value: c, label: c }))];
  }, [allAllocations]);
  const projectOptions = useMemo(() => {
    const map = new Map<string, string>();
    allAllocations.forEach(a => { if (a.project_id) map.set(a.project_id, a.project_name || a.project_id); });
    return [{ value: 'all', label: 'Todos' }, ...Array.from(map.entries()).map(([value, label]) => ({ value, label }))];
  }, [allAllocations]);
  const costCenterOptions = useMemo(() => {
    const map = new Map<string, string>();
    allAllocations.forEach(a => { if (a.cost_center_id) map.set(a.cost_center_id, a.cost_center?.name || a.cost_center_id); });
    return [{ value: 'all', label: 'Todos' }, ...Array.from(map.entries()).map(([value, label]) => ({ value, label }))];
  }, [allAllocations]);
  const departmentOptions = useMemo(() => {
    const map = new Map<string, string>();
    allAllocations.forEach(a => { if (a.department_id) map.set(a.department_id, a.department_name || a.department_id); });
    return [{ value: 'all', label: 'Todos' }, ...Array.from(map.entries()).map(([value, label]) => ({ value, label }))];
  }, [allAllocations]);

  const filter: PayrollAllocationListFilter = useMemo(() => ({
    competenceMonth: filterCompetence === 'all' ? undefined : filterCompetence,
    status: filterStatus,
    projectId: filterProject === 'all' ? undefined : filterProject,
    costCenterId: filterCostCenter === 'all' ? undefined : filterCostCenter,
    departmentId: filterDepartment === 'all' ? undefined : filterDepartment,
  }), [filterCompetence, filterStatus, filterProject, filterCostCenter, filterDepartment]);

  const filtered = useMemo(
    () => sortPayrollByCost(filterPayrollAllocations(allAllocations, filter), sortDir),
    [allAllocations, filter, sortDir],
  );

  const summary = useMemo(() => selectPayrollSummary(filtered), [filtered]);
  const byProject = useMemo(() => selectPayrollByProject(filtered), [filtered]);
  const byDepartment = useMemo(() => selectPayrollByDepartment(filtered), [filtered]);
  const byCostCenter = useMemo(() => selectPayrollByCostCenter(filtered), [filtered]);
  const byContract = useMemo(() => selectPayrollByContract(filtered), [filtered]);
  const byCompetence = useMemo(() => selectPayrollByCompetence(allAllocations), [allAllocations]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const allBatches = useMemo(() => getPayrollBatches(), [refreshKey]);
  const competenceBatches = useMemo(
    () => (filterCompetence === 'all' ? allBatches : allBatches.filter(b => b.period_key === filterCompetence)),
    [allBatches, filterCompetence],
  );
  const batchRecon = useMemo(
    () => selectPayrollBatchReconciliation(allAllocations, competenceBatches),
    [allAllocations, competenceBatches],
  );
  const hasOverallocation = batchRecon.some(r => r.status === 'overallocated');

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const detail = useMemo(() => (detailId ? getPayrollAllocation(detailId) : undefined), [detailId, refreshKey]);
  const linkedEntry: LedgerEntry | undefined = useMemo(
    () => (detail?.linked_entry_id ? getLedgerEntry(detail.linked_entry_id) : undefined),
    [detail],
  );
  const detailRecon = useMemo(
    () => reconcilePayrollBatch(allAllocations, allBatches.find(b => b.id === detail?.payroll_batch_id)),
    [allAllocations, allBatches, detail],
  );
  const detailBatchBlocksPost = detailRecon?.status === 'overallocated';

  const postableCount = useMemo(() => filtered.filter(canPostPayroll).length, [filtered]);

  const hasActiveFilters = filterStatus !== 'all' || filterProject !== 'all' || filterCostCenter !== 'all' || filterDepartment !== 'all';
  const clearFilters = () => {
    setFilterStatus('all'); setFilterProject('all'); setFilterCostCenter('all'); setFilterDepartment('all');
  };

  const handleApprove = useCallback((alloc: PayrollAllocation) => {
    if (processing || !canApprovePayroll(alloc)) return;
    setProcessing(true);
    try { approvePayrollAllocation(alloc.id); setRefreshKey(k => k + 1); }
    finally { setProcessing(false); }
  }, [processing]);

  const handlePost = useCallback((alloc: PayrollAllocation) => {
    if (processing || !canPostPayroll(alloc)) return;
    setProcessing(true);
    try { postPayrollAllocation(alloc.id); setRefreshKey(k => k + 1); }
    finally { setProcessing(false); }
  }, [processing]);

  const handleCancel = useCallback((alloc: PayrollAllocation) => {
    if (processing || alloc.status === 'posted' || alloc.status === 'cancelled') return;
    setProcessing(true);
    try { cancelPayrollAllocation(alloc.id, 'Cancelado pelo operador'); setRefreshKey(k => k + 1); }
    finally { setProcessing(false); }
  }, [processing]);

  const handlePostAll = useCallback(() => {
    if (processing || postableCount === 0) return;
    setProcessing(true);
    try {
      filtered.filter(canPostPayroll).forEach(a => postPayrollAllocation(a.id));
      setRefreshKey(k => k + 1);
    } finally { setProcessing(false); }
  }, [processing, postableCount, filtered]);

  const goToLedgerEntry = useCallback((entryId: string) => {
    router.push(`/financeiro/lancamentos?entryId=${encodeURIComponent(entryId)}`);
  }, [router]);

  const kpis: KpiItem[] = [
    { id: 'tc', label: 'Custo total (carregado)', value: summary.totalCost / 100, format: 'compactCurrency', variant: 'info' },
    { id: 'al', label: 'Custo alocado', value: summary.allocatedCost / 100, format: 'compactCurrency', variant: 'success' },
    { id: 'un', label: 'Não alocado', value: summary.unallocatedCost / 100, format: 'compactCurrency', variant: summary.unallocatedCost > 0 ? 'warning' : 'success', icon: <AlertTriangle className="h-5 w-5" /> },
    { id: 'rt', label: 'Taxa de alocação', value: summary.allocationRate, format: 'percent', variant: summary.allocationRate >= 70 ? 'success' : 'warning' },
    { id: 'hc', label: 'Headcount', value: summary.headcount, variant: 'info', icon: <Users className="h-5 w-5" /> },
    { id: 'ac', label: 'Custo médio / colaborador', value: summary.avgCostPerEmployee / 100, format: 'compactCurrency', variant: 'info' },
  ];

  const columns: HudTableColumn<PayrollAllocation>[] = [
    { key: 'employee', header: 'Colaborador', cell: (a) => (
      <div className="min-w-0">
        <span className="block truncate text-xs font-semibold text-ig-fg-strong">{a.employee_name}</span>
        <span className="block max-w-[220px] truncate text-[11px] text-ig-fg-muted">{a.role} • {a.department_name}</span>
      </div>
    ) },
    { key: 'competence_month', header: 'Competência', cell: (a) => <span className="font-mono text-xs text-ig-fg-muted">{a.competence_month}</span> },
    { key: 'destination', header: 'Destino', cell: (a) => (
      <div className="min-w-0">
        <span className="block truncate text-xs text-ig-fg-strong">{a.project_name || 'Estrutural'}</span>
        <span className="block truncate text-[11px] text-ig-fg-muted">{a.cost_center?.name || a.cost_center_id || '—'}</span>
      </div>
    ) },
    { key: 'total_cost_cents', header: 'Custo total', align: 'right', cell: (a) => <span className="block font-mono text-xs text-ig-fg-strong">{formatBRL(a.total_cost_cents)}</span> },
    { key: 'allocated_amount_cents', header: 'Alocado', align: 'right', cell: (a) => <span className="block font-mono text-xs text-ig-fg-muted">{formatBRL(a.allocated_amount_cents)}</span> },
    { key: 'allocation_percentage', header: 'Alocação', cell: (a) => (
      <div className="w-[120px]">
        <HudProgressBar value={a.allocation_percentage} variant={allocBarVariant(a.allocation_percentage)} size="sm" showLabel={false} />
        <span className="mt-0.5 block text-[10px] font-mono text-ig-fg-muted">{a.allocation_percentage.toFixed(0)}%</span>
      </div>
    ) },
    { key: 'status', header: 'Status', cell: (a) => (
      <div className="flex items-center gap-1.5">
        <HudStatusPill variant={STATUS_VARIANT[a.status]} size="sm">{STATUS_LABEL[a.status]}</HudStatusPill>
        {a.linked_entry_id && <Link2 className="h-3 w-3 text-ig-accent" aria-label="Vinculado ao DRE" />}
      </div>
    ) },
  ];

  const projectDonut = byProject.slice(0, 8).map((row, i) => ({
    name: row.label,
    value: row.allocatedCost / 100,
    tone: (['accent', 'info', 'success', 'warning', 'danger', 'budget'] as const)[i % 6],
  }));

  return (
    <HudPageLayout>
      <HudHeader
        title="Folha & Alocação"
        subtitle="Custo de força de trabalho alocado por colaborador, projeto e centro de custo — reconhecido no DRE por competência"
        icon={<FileSpreadsheet className="w-5 h-5" />}
        iconTint="#14B8A6"
        breadcrumbs={[{ label: 'Financeiro', href: '/financeiro' }, { label: 'Folha & Alocação' }]}
      />

      {deepLinkMissing && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-[color-mix(in_oklab,var(--ig-warning)_28%,transparent)] bg-[color-mix(in_oklab,var(--ig-warning)_12%,transparent)] p-3">
          <AlertTriangle className="h-4 w-4 shrink-0 text-ig-warning" />
          <p className="text-xs font-medium text-ig-warning">Alocação <span className="font-mono">{deepLinkMissing}</span> não encontrada.</p>
        </div>
      )}

      <HudKpiStrip kpis={kpis} columns={6} size="sm" />

      <div className="mt-4">
        <FinanceFilterBar
          showPeriod={false}
          showScenario={false}
          extra={
            <>
              <FinanceFilterChip icon={<Calendar className="h-3.5 w-3.5" />} label="Competência" value={filterCompetence} onChange={setFilterCompetence} options={competenceOptions} />
              <FinanceFilterChip icon={<Activity className="h-3.5 w-3.5" />} label="Status" value={filterStatus} onChange={(v) => setFilterStatus(v as PayrollAllocationStatus | 'all')} options={[{ value: 'all', label: 'Todos' }, ...ALLOC_STATUSES.map(s => ({ value: s, label: STATUS_LABEL[s] }))]} />
              <FinanceFilterChip icon={<Briefcase className="h-3.5 w-3.5" />} label="Projeto" value={filterProject} onChange={setFilterProject} options={projectOptions} maxValueChars={18} />
              <FinanceFilterChip icon={<Layers className="h-3.5 w-3.5" />} label="C. Custo" value={filterCostCenter} onChange={setFilterCostCenter} options={costCenterOptions} maxValueChars={16} />
              <FinanceFilterChip icon={<Building2 className="h-3.5 w-3.5" />} label="Depto" value={filterDepartment} onChange={setFilterDepartment} options={departmentOptions} maxValueChars={14} />
            </>
          }
          rightSlot={
            <>
              {hasActiveFilters && <HudButton variant="ghost" size="sm" onClick={clearFilters}>Limpar</HudButton>}
              <ExportReportButton
                size="sm"
                variant="glass"
                permission="finance.export"
                fallbackPermission="finance.view"
                build={() => openFinanceReport({
                  title: 'Folha & Alocação',
                  fileContext: 'folha-alocacao',
                  context: 'Distribuição da folha por projeto e centro de custo',
                  kpis: kpis.map((k) => kpiFromHud(k)),
                  sections: [{
                    title: 'Alocações',
                    tables: [{
                      columns: [
                        { key: 'proj', label: 'Projeto' },
                        { key: 'cc', label: 'Centro de Custo' },
                        { key: 'total', label: 'Custo total', num: true },
                        { key: 'aloc', label: 'Alocado', num: true },
                        { key: 'pct', label: 'Alocação %', num: true },
                      ],
                      rows: filtered.slice(0, 150).map((a) => ({
                        proj: a.project_name || 'Estrutural',
                        cc: a.cost_center?.name || a.cost_center_id || '—',
                        total: { html: `<span class="mono">${formatBRL(a.total_cost_cents)}</span>` },
                        aloc: { html: `<span class="mono">${formatBRL(a.allocated_amount_cents)}</span>` },
                        pct: `${a.allocation_percentage.toFixed(0)}%`,
                      })),
                    }],
                  }],
                })}
              />
              <HudButton variant="primary" size="sm" leftIcon={<Send className="w-4 h-4" />} onClick={handlePostAll} disabled={processing || postableCount === 0}>
                Lançar aprovados{postableCount > 0 ? ` (${postableCount})` : ''}
              </HudButton>
            </>
          }
        />
      </div>

      {/* Posted vs pending banner */}
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <HudPanel title="Lançado no DRE" subtitle="Custo já reconhecido por competência" icon={<CheckCircle className="h-4 w-4" />}>
          <p className="font-mono text-xl font-semibold text-ig-success">{fmtBRL(summary.postedCost / 100)}</p>
          <p className="mt-1 text-[11px] text-ig-fg-muted">{summary.postedCount} alocação(ões) lançada(s)</p>
        </HudPanel>
        <HudPanel title="Pendente de lançamento" subtitle="Custo alocado ainda fora do DRE" icon={<ArrowUpRight className="h-4 w-4" />}>
          <p className="font-mono text-xl font-semibold text-ig-warning">{fmtBRL(summary.pendingCost / 100)}</p>
          <p className="mt-1 text-[11px] text-ig-fg-muted">{summary.pendingCount} pendente(s) • {postableCount} pronta(s) p/ lançar</p>
        </HudPanel>
        <HudPanel title="Composição do custo" subtitle="Bruto · encargos · benefícios" icon={<PieChart className="h-4 w-4" />}>
          <div className="space-y-1 text-[11px]">
            <div className="flex items-center justify-between"><span className="text-ig-fg-muted">Bruto</span><span className="font-mono text-ig-fg-strong">{fmtCompactBRL(summary.grossTotal / 100)}</span></div>
            <div className="flex items-center justify-between"><span className="text-ig-fg-muted">Encargos</span><span className="font-mono text-ig-fg-strong">{fmtCompactBRL(summary.taxesTotal / 100)}</span></div>
            <div className="flex items-center justify-between"><span className="text-ig-fg-muted">Benefícios</span><span className="font-mono text-ig-fg-strong">{fmtCompactBRL(summary.benefitsTotal / 100)}</span></div>
          </div>
        </HudPanel>
      </div>

      {/* Payroll batch reconciliation guard */}
      {batchRecon.length > 0 && (
        <div className="mt-4">
          <HudPanel
            title="Reconciliação de lotes de folha"
            subtitle="Custo alocado × total do lote — bloqueia lançamento quando superalocado"
            icon={<Scale className="h-4 w-4" />}
            sweep
          >
            {hasOverallocation && (
              <div className="mb-3 flex items-center gap-2 rounded-lg border border-[color-mix(in_oklab,var(--ig-danger)_28%,transparent)] bg-[color-mix(in_oklab,var(--ig-danger)_10%,transparent)] px-3 py-2">
                <AlertTriangle className="h-4 w-4 shrink-0 text-ig-danger" />
                <span className="text-xs font-medium text-ig-danger">Há lote(s) superalocado(s) — corrija as alocações antes de aprovar/lançar.</span>
              </div>
            )}
            <div className="space-y-3">
              {batchRecon.map((r) => (
                <div key={r.batch_id} className="rounded-lg border border-ig-border-subtle bg-ig-panel/40 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <span className="font-mono text-xs text-ig-fg-strong">{r.batch_id}</span>
                      <span className="ml-2 text-[11px] text-ig-fg-muted">{r.period_key} • {r.headcount} colab. • {r.allocationCount} alocação(ões)</span>
                    </div>
                    <HudStatusPill variant={RECON_VARIANT[r.status]} size="sm">{RECON_LABEL[r.status]}</HudStatusPill>
                  </div>
                  <div className="mt-2">
                    <HudProgressBar value={Math.min(r.utilizationPct, 100)} variant={RECON_BAR[r.status]} size="sm" showLabel={false} />
                    <div className="mt-1 flex items-center justify-between text-[10.5px] text-ig-fg-muted">
                      <span>Alocado <span className="font-mono text-ig-fg-strong">{fmtBRL(r.allocatedTotalCents / 100)}</span> / {fmtBRL(r.batchTotalCents / 100)}</span>
                      <span className={r.status === 'overallocated' ? 'font-mono text-ig-danger' : 'font-mono'}>
                        {r.utilizationPct.toFixed(0)}%{r.varianceCents > 0 ? ` • +${fmtCompactBRL(r.varianceCents / 100)}` : ''}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </HudPanel>
        </div>
      )}

      {/* Breakdown charts */}
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[360px_1fr]">
        <HudPanel title="Alocação por projeto" subtitle="Custo alocado por projeto" icon={<Briefcase className="h-4 w-4" />} sweep>
          {projectDonut.length === 0 ? (
            <p className="text-xs text-ig-fg-muted">Sem custo alocado para os filtros atuais.</p>
          ) : (
            <FinanceDonutChart data={projectDonut} centerLabel="Alocado" centerValue={fmtCompactBRL(summary.allocatedCost / 100)} height={240} />
          )}
        </HudPanel>
        <HudPanel title="Folha por departamento" subtitle="Custo total × alocado por departamento" icon={<Building2 className="h-4 w-4" />} sweep>
          {byDepartment.length === 0 ? (
            <p className="text-xs text-ig-fg-muted">Sem dados para os filtros atuais.</p>
          ) : (
            <FinanceBarChart
              categories={byDepartment.map(r => r.label)}
              series={[
                { name: 'Alocado', data: byDepartment.map(r => r.allocatedCost / 100), tone: 'success' },
                { name: 'Não alocado', data: byDepartment.map(r => r.unallocatedCost / 100), tone: 'warning' },
              ]}
              height={240}
            />
          )}
        </HudPanel>
      </div>

      {/* Cost center + competence trend */}
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <HudPanel title="Folha por centro de custo" subtitle="Custo alocado por CC" icon={<Layers className="h-4 w-4" />} sweep>
          {byCostCenter.length === 0 ? (
            <p className="text-xs text-ig-fg-muted">Sem dados para os filtros atuais.</p>
          ) : (
            <FinanceBarChart categories={byCostCenter.map(r => r.label)} series={[{ name: 'Alocado', data: byCostCenter.map(r => r.allocatedCost / 100), tone: 'accent' }]} height={220} />
          )}
        </HudPanel>
        <HudPanel title="Evolução por competência" subtitle="Custo total × alocado (todas as competências)" icon={<Calendar className="h-4 w-4" />} sweep>
          {byCompetence.length === 0 ? (
            <p className="text-xs text-ig-fg-muted">Sem histórico disponível.</p>
          ) : (
            <FinanceBarChart
              categories={byCompetence.map(r => r.competence_month)}
              series={[
                { name: 'Custo total', data: byCompetence.map(r => r.totalCost / 100), tone: 'info' },
                { name: 'Alocado', data: byCompetence.map(r => r.allocatedCost / 100), tone: 'success' },
              ]}
              height={220}
            />
          )}
        </HudPanel>
      </div>

      {/* Allocation table */}
      <div className="mt-4">
        <HudPanel
          noPadding
          title="Alocação de folha"
          subtitle={`${filtered.length} alocação(ões) • ${summary.headcount} colaborador(es) • ${summary.postedCount} lançada(s)`}
          icon={<Users className="h-4 w-4" />}
          sweep
          headerActions={
            <HudButton variant="ghost" size="sm" leftIcon={<ArrowUpDown className="w-4 h-4" />} onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}>
              Custo {sortDir === 'asc' ? '↑' : '↓'}
            </HudButton>
          }
        >
          <HudTable
            columns={columns}
            data={filtered}
            keyExtractor={(a) => a.id}
            onRowClick={(a) => setDetailId(a.id)}
            selectedRowId={detailId}
            compact
            stickyHeader
          />
        </HudPanel>
      </div>

      {/* Detail drawer */}
      <HudDrawer isOpen={!!detailId} onClose={() => setDetailId(null)} title="Detalhe da alocação" width="md">
        {detail && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[10px] uppercase text-ig-fg-subtle">Colaborador</p>
                <p className="text-sm font-semibold text-ig-fg-strong">{detail.employee_name}</p>
                <p className="text-xs text-ig-fg-muted">{detail.role}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase text-ig-fg-subtle">Status</p>
                <HudStatusPill variant={STATUS_VARIANT[detail.status]} size="sm">{STATUS_LABEL[detail.status]}</HudStatusPill>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div><p className="text-[10px] uppercase text-ig-fg-subtle">Competência</p><p className="font-mono text-sm text-ig-fg-strong">{detail.competence_month}</p></div>
              <div><p className="text-[10px] uppercase text-ig-fg-subtle">Departamento</p><p className="text-sm text-ig-fg-strong">{detail.department_name}</p></div>
            </div>

            {/* Cost composition */}
            <div className="grid grid-cols-3 gap-3 rounded-lg border border-ig-border-subtle bg-ig-panel/40 p-3">
              <div><p className="text-[10px] uppercase text-ig-fg-subtle">Bruto</p><p className="font-mono text-sm text-ig-fg-strong">{formatBRL(detail.gross_amount_cents)}</p></div>
              <div><p className="text-[10px] uppercase text-ig-fg-subtle">Encargos</p><p className="font-mono text-sm text-ig-fg-muted">{formatBRL(detail.taxes_amount_cents)}</p></div>
              <div><p className="text-[10px] uppercase text-ig-fg-subtle">Benefícios</p><p className="font-mono text-sm text-ig-fg-muted">{formatBRL(detail.benefits_amount_cents)}</p></div>
            </div>

            {/* Allocation */}
            <div>
              <div className="mb-1 flex items-center justify-between">
                <p className="text-[10px] uppercase text-ig-fg-subtle">Alocação ({detail.allocation_percentage.toFixed(0)}%)</p>
                <span className="font-mono text-xs text-ig-fg-strong">{formatBRL(detail.allocated_amount_cents)} / {formatBRL(detail.total_cost_cents)}</span>
              </div>
              <HudProgressBar value={detail.allocation_percentage} variant={allocBarVariant(detail.allocation_percentage)} size="md" showLabel={false} />
            </div>

            {/* Destination dimensions */}
            <div className="rounded-lg border border-ig-border-subtle bg-ig-panel/40 p-3 text-xs space-y-1">
              <p><span className="text-ig-fg-subtle">Projeto: </span><span className="text-ig-fg-strong">{detail.project_name || 'Estrutural (não alocado)'}</span></p>
              {detail.contract_name && <p><span className="text-ig-fg-subtle">Contrato: </span><span className="font-mono text-ig-fg-strong">{detail.contract_name}</span></p>}
              <p><span className="text-ig-fg-subtle">Centro de custo: </span><span className="text-ig-fg-strong">{detail.cost_center?.name || detail.cost_center_id || '—'}</span></p>
              <p><span className="text-ig-fg-subtle">Business unit: </span><span className="text-ig-fg-strong">{detail.business_unit?.name || detail.business_unit_id || '—'}</span></p>
              {detail.payroll_batch_id && <p><span className="text-ig-fg-subtle">Lote de folha: </span><span className="font-mono text-ig-fg-strong">{detail.payroll_batch_id}</span></p>}
              {detail.notes && <p className="mt-1 text-ig-fg-muted">{detail.notes}</p>}
            </div>

            {/* Linked DRE entry */}
            <div className="rounded-lg border border-ig-border-subtle bg-ig-panel/40 p-3">
              <div className="flex items-center justify-between">
                <p className="text-[10px] uppercase text-ig-fg-subtle">Lançamento no DRE</p>
                {linkedEntry && <HudBadge variant="default" size="sm">1</HudBadge>}
              </div>
              {!linkedEntry ? (
                <p className="mt-1 text-sm text-ig-fg-muted">Nenhum lançamento vinculado.</p>
              ) : (
                <button
                  type="button"
                  onClick={() => goToLedgerEntry(linkedEntry.id)}
                  title="Ver lançamento vinculado"
                  className="mt-2 flex w-full items-center justify-between gap-2 rounded-md px-1 py-1.5 text-left transition-colors hover:bg-ig-panel/60 focus:bg-ig-panel/60 focus:outline-none"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <Link2 className="h-3 w-3 shrink-0 text-ig-accent" />
                    <span className="truncate text-xs text-ig-fg-strong">{linkedEntry.entry_date}</span>
                    <span className="text-[10px] uppercase tracking-[0.12em] text-ig-fg-subtle">Custo P&L</span>
                  </div>
                  <span className="shrink-0 font-mono text-xs font-semibold text-ig-fg-strong">{formatBRL(linkedEntry.amount_cents)}</span>
                </button>
              )}
            </div>

            {/* Lifecycle actions */}
            {detail.status === 'posted' || detail.status === 'cancelled' ? (
              <div className="border-t border-ig-border-subtle pt-4">
                <HudBadge variant="default" size="sm">{STATUS_LABEL[detail.status]}</HudBadge>
              </div>
            ) : (
              <div className="space-y-2 border-t border-ig-border-subtle pt-4">
                <div className="flex gap-2">
                  {canApprovePayroll(detail) && (
                    <HudButton variant="secondary" leftIcon={<CheckCircle className="w-4 h-4" />} onClick={() => handleApprove(detail)} disabled={processing || detailBatchBlocksPost} fullWidth>
                      Aprovar
                    </HudButton>
                  )}
                  <HudButton
                    variant="primary"
                    leftIcon={<Send className="w-4 h-4" />}
                    onClick={() => handlePost(detail)}
                    disabled={processing || !canPostPayroll(detail) || detailBatchBlocksPost}
                    fullWidth
                  >
                    Lançar no DRE
                  </HudButton>
                </div>
                {detailBatchBlocksPost && (
                  <p className="flex items-center gap-1.5 text-[11px] text-ig-danger">
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                    Lote {detail.payroll_batch_id} superalocado ({detailRecon ? `${detailRecon.utilizationPct.toFixed(0)}%` : ''}) — corrija antes de lançar.
                  </p>
                )}
                {!canPostPayroll(detail) && detail.status !== 'approved' && (
                  <p className="text-[11px] text-ig-fg-muted">Aprove a alocação antes de lançar no DRE.</p>
                )}
                {detail.allocated_amount_cents <= 0 && (
                  <p className="text-[11px] text-ig-warning">Sem valor alocado — nada a reconhecer no DRE.</p>
                )}
                <HudButton variant="ghost" size="sm" onClick={() => handleCancel(detail)} disabled={processing} fullWidth>
                  Cancelar alocação
                </HudButton>
              </div>
            )}
          </div>
        )}
      </HudDrawer>

      {/* Footer summary */}
      <div className="mt-4 text-right text-[10.5px] text-ig-text-tertiary">
        Custo total nos filtros: <span className="font-mono">{fmtBRL(summary.totalCost / 100)}</span> • alocado <span className="font-mono">{fmtBRL(summary.allocatedCost / 100)}</span> • contratos: {byContract.filter(c => c.key !== '_none').length}
      </div>
    </HudPageLayout>
  );
}
