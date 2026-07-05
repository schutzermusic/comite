'use client';

import { useState, useMemo, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import {
  CreditCard, Plus, ArrowDownLeft, ArrowUpRight, CalendarRange,
  AlertTriangle, Clock3, Wallet, Activity, Filter, X, Link2, CheckCircle, ArrowUpDown,
} from 'lucide-react';
import {
  HudPageLayout, HudHeader, HudKpiStrip, HudTable, HudButton,
  HudStatusPill, HudDrawer, HudInput, HudSelect, HudPanel, HudBadge,
  type KpiItem, type HudTableColumn,
} from '@/components/hud';
import { FinanceBarChart, FinanceFilterBar, FinanceFilterChip } from '@/components/finance/shared';
import {
  getAPARTitles, getAPARTitle, getLedgerEntry, getLedgerEntries, createAPARTitle, recordAPARPayment,
  getSuppliers, getClients, getProjects, getContracts,
  formatBRL, formatCompactBRL, reaisToCents, centsToReais,
} from '@/lib/finance/finance-store';
import {
  selectAparSummary, selectAparAging, filterAparTitles, sortByDueDate,
  isOverdue, daysOverdue, remainingCents,
  type AparFilter,
} from '@/lib/finance/selectors/apar';
import {
  selectCashFlowSummary, selectCashMovements, cashDirection,
} from '@/lib/finance/selectors/cash';
import type { APARTitle, APARType, LedgerEntry } from '@/lib/types/finance';
import { ExportReportButton } from '@/components/reports/ExportReportButton';
import { openFinanceReport, kpiFromHud } from '@/lib/reports/modules/finance-report';

const STATUS_VARIANTS: Record<string, string> = {
  open: 'info', partial: 'warning', paid: 'completed', overdue: 'error', cancelled: 'error',
};
const STATUS_LABELS: Record<string, string> = {
  open: 'Aberto', partial: 'Parcial', paid: 'Pago', overdue: 'Vencido', cancelled: 'Cancelado',
};

export default function ContasPagarReceberPage() {
  const t = useTranslations('finance');
  const router = useRouter();
  const [refreshKey, setRefreshKey] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // Filters
  const [filterType, setFilterType] = useState<APARType | 'all'>('all');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterEntity, setFilterEntity] = useState('');
  const [filterContract, setFilterContract] = useState('');
  const [filterProject, setFilterProject] = useState('');
  const [filterDateField, setFilterDateField] = useState<'due_date' | 'issue_date'>('due_date');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');

  // New-title form
  const [formType, setFormType] = useState<APARType>('payable');
  const [formTitleNumber, setFormTitleNumber] = useState('');
  const [formEntity, setFormEntity] = useState('');
  const [formIssueDate, setFormIssueDate] = useState('');
  const [formDueDate, setFormDueDate] = useState('');
  const [formAmount, setFormAmount] = useState('');

  // Settlement form (detail drawer)
  const [settleAmount, setSettleAmount] = useState('');
  const [settleDate, setSettleDate] = useState(new Date().toISOString().slice(0, 10));
  const [processing, setProcessing] = useState(false);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const allTitles = useMemo(() => getAPARTitles(), [refreshKey]);

  // Settlement cash legs live in the ledger (clearing group) — fetch the live
  // store array (not the static seed) so new settlements appear immediately.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ledgerEntries = useMemo(() => getLedgerEntries(), [refreshKey]);

  const filter: AparFilter = useMemo(() => ({
    type: filterType,
    status: filterStatus || undefined,
    entityId: filterEntity || undefined,
    contractId: filterContract || undefined,
    projectId: filterProject || undefined,
    dateField: filterDateField,
    dateFrom: filterDateFrom || undefined,
    dateTo: filterDateTo || undefined,
  }), [filterType, filterStatus, filterEntity, filterContract, filterProject, filterDateField, filterDateFrom, filterDateTo]);

  const filtered = useMemo(
    () => sortByDueDate(filterAparTitles(allTitles, filter), sortDir),
    [allTitles, filter, sortDir],
  );

  // All numbers derive from selectors over the *filtered* set so KPIs match the table.
  const summary = useMemo(() => selectAparSummary(filtered), [filtered]);
  const aging = useMemo(() => selectAparAging(filtered), [filtered]);

  // Cash flow is scoped to the *filtered* AP/AR portfolio: we collect every
  // settlement ledger entry produced by titles currently visible in the table,
  // then run cash selectors over only those. Settlements not tied to a visible
  // title are excluded — so changing supplier/contract/date filters reshapes
  // the cash panel consistently with the carteira.
  const filteredSettlementIds = useMemo(() => {
    const ids = new Set<string>();
    for (const tt of filtered) {
      tt.settlement_entry_ids?.forEach(id => ids.add(id));
    }
    return ids;
  }, [filtered]);
  const filteredCashEntries = useMemo(
    () => ledgerEntries.filter(e => filteredSettlementIds.has(e.id)),
    [ledgerEntries, filteredSettlementIds],
  );
  const cashSummary = useMemo(() => selectCashFlowSummary(filteredCashEntries), [filteredCashEntries]);
  const cashMovements = useMemo(() => selectCashMovements(filteredCashEntries), [filteredCashEntries]);
  const latestMovements = useMemo(
    () => [...cashMovements].sort((a, b) => b.entry_date.localeCompare(a.entry_date)).slice(0, 6),
    [cashMovements],
  );

  const goToLedgerEntry = useCallback((entryId: string) => {
    router.push(`/financeiro/lancamentos?entryId=${encodeURIComponent(entryId)}`);
  }, [router]);

  // refreshKey forces a re-fetch after a settlement mutates the store.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const detail = useMemo(() => (detailId ? getAPARTitle(detailId) : undefined), [detailId, refreshKey]);
  // Full settlement history — every cash entry produced by this title.
  const settlementEntries: LedgerEntry[] = useMemo(() => {
    if (!detail?.settlement_entry_ids?.length) return [];
    return detail.settlement_entry_ids
      .map(id => getLedgerEntry(id))
      .filter((e): e is LedgerEntry => !!e)
      .sort((a, b) => b.entry_date.localeCompare(a.entry_date));
  }, [detail]);

  // KPIs clicáveis (padrão Contratos): alternam o filtro correspondente da carteira.
  const toggleTypeKpi = (type: APARType) => {
    setFilterType(current => (current === type ? 'all' : type));
    setFilterEntity('');
  };
  const weekFrom = new Date().toISOString().slice(0, 10);
  const weekTo = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const dueWeekActive = filterDateField === 'due_date' && filterDateFrom === weekFrom && filterDateTo === weekTo;
  const toggleDueWeekKpi = () => {
    setFilterDateField('due_date');
    setFilterDateFrom(dueWeekActive ? '' : weekFrom);
    setFilterDateTo(dueWeekActive ? '' : weekTo);
  };

  const kpis: KpiItem[] = [
    { id: 'ar', label: t('receivable'), value: summary.totalReceivable / 100, format: 'compactCurrency', icon: <ArrowDownLeft className="w-5 h-5" />, variant: 'success', onClick: () => toggleTypeKpi('receivable'), active: filterType === 'receivable' },
    { id: 'ap', label: t('payable'), value: summary.totalPayable / 100, format: 'compactCurrency', icon: <ArrowUpRight className="w-5 h-5" />, variant: 'danger', onClick: () => toggleTypeKpi('payable'), active: filterType === 'payable' },
    { id: 'overdue', label: t('overdueExposure'), value: summary.overdueTotal / 100, format: 'compactCurrency', icon: <AlertTriangle className="w-5 h-5" />, variant: summary.overdueTotal > 0 ? 'danger' : 'success', onClick: () => setFilterStatus(filterStatus === 'overdue' ? '' : 'overdue'), active: filterStatus === 'overdue' },
    { id: 'due', label: t('dueThisWeek'), value: summary.dueThisWeek / 100, format: 'compactCurrency', icon: <Clock3 className="w-5 h-5" />, variant: summary.dueThisWeek > 0 ? 'warning' : 'success', onClick: toggleDueWeekKpi, active: dueWeekActive },
    { id: 'cash', label: t('cashImpact'), value: summary.cashImpact / 100, format: 'compactCurrency', icon: <Wallet className="w-5 h-5" />, variant: summary.cashImpact >= 0 ? 'success' : 'danger', onClick: () => setFilterStatus(filterStatus === 'paid' ? '' : 'paid'), active: filterStatus === 'paid' },
  ];

  const suppliers = getSuppliers();
  const clients = getClients();
  const entityOptions = useMemo(() => {
    const base = filterType === 'payable' ? suppliers
      : filterType === 'receivable' ? clients
      : [...suppliers, ...clients];
    return [{ value: '', label: 'Todos' }, ...base.map(e => ({ value: e.id, label: e.name }))];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterType]);

  const hasActiveFilters = !!(filterType !== 'all' || filterStatus || filterEntity || filterContract || filterProject || filterDateFrom || filterDateTo);
  const clearFilters = () => {
    setFilterType('all'); setFilterStatus(''); setFilterEntity('');
    setFilterContract(''); setFilterProject(''); setFilterDateFrom(''); setFilterDateTo('');
  };

  const columns: HudTableColumn<APARTitle>[] = [
    { key: 'title_number', header: t('titleNumber'), cell: (title) => (
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-xs text-ig-fg-strong">{title.title_number}</span>
        {title.linked_entry_id && <Link2 className="h-3 w-3 text-ig-accent" aria-label="Vinculado a lançamento" />}
      </div>
    ) },
    { key: 'entity', header: 'Fornecedor / Cliente', cell: (title) => (
      <div className="min-w-0">
        <span className="block truncate text-xs font-medium text-ig-fg-strong">{title.client?.name || title.supplier?.name || '—'}</span>
        <span className="text-[10px] uppercase tracking-[0.14em] text-ig-fg-subtle">{title.type === 'receivable' ? t('receivable') : t('payable')}</span>
      </div>
    ) },
    { key: 'issue_date', header: t('issueDate'), cell: (title) => <span className="tabular-nums text-xs text-ig-fg-muted">{title.issue_date}</span> },
    { key: 'due_date', header: t('dueDate'), cell: (title) => {
      const overdue = isOverdue(title);
      return (
        <div className="flex flex-col">
          <span className={`tabular-nums text-xs ${overdue ? 'font-semibold text-ig-danger' : 'text-ig-fg-muted'}`}>{title.due_date}</span>
          {overdue && <span className="text-[10px] font-medium text-ig-danger">{daysOverdue(title)}d {t('overdue').toLowerCase()}</span>}
        </div>
      );
    } },
    { key: 'amount_cents', header: t('amount'), align: 'right', cell: (title) => <span className="block tabular-nums text-xs text-ig-fg-strong">{formatBRL(title.amount_cents)}</span> },
    { key: 'remaining', header: t('remaining'), align: 'right', cell: (title) => <span className="block tabular-nums text-xs text-ig-fg-muted">{formatBRL(remainingCents(title))}</span> },
    { key: 'status', header: 'Status', cell: (title) => (
      <HudStatusPill variant={(isOverdue(title) ? 'error' : STATUS_VARIANTS[title.status]) as any} size="sm">
        {isOverdue(title) ? STATUS_LABELS.overdue : (STATUS_LABELS[title.status] ?? title.status)}
      </HudStatusPill>
    ) },
  ];

  const handleSave = () => {
    if (!formTitleNumber || !formAmount || !formDueDate) return;
    createAPARTitle({
      type: formType,
      title_number: formTitleNumber,
      supplier_id: formType === 'payable' ? formEntity || undefined : undefined,
      client_id: formType === 'receivable' ? formEntity || undefined : undefined,
      issue_date: formIssueDate || undefined,
      due_date: formDueDate,
      amount_cents: reaisToCents(parseFloat(formAmount)),
    });
    setDrawerOpen(false);
    setFormTitleNumber(''); setFormEntity(''); setFormIssueDate(''); setFormDueDate(''); setFormAmount('');
    setRefreshKey(k => k + 1);
  };

  // Settle a title. amountCents omitted → full settlement; otherwise partial.
  // Guards against duplicate clicks via `processing`; the store also rejects
  // paid/cancelled titles and caps the amount at the remaining balance.
  // TODO(supabase): the real backend must run (insert settlement LedgerEntry +
  // update APARTitle + write audit log) inside one transaction, and ideally
  // persist payment history in a normalized apar_payments table instead of
  // settlement_entry_ids[].
  const handleSettle = useCallback((title: APARTitle, amountCents?: number) => {
    if (processing) return;
    if (title.status === 'paid' || title.status === 'cancelled') return;
    if (amountCents !== undefined && amountCents <= 0) return;
    setProcessing(true);
    try {
      recordAPARPayment(title.id, amountCents, settleDate);
      setSettleAmount('');
      setRefreshKey(k => k + 1);
    } finally {
      setProcessing(false);
    }
  }, [processing, settleDate]);

  return (
    <HudPageLayout>
      <HudHeader
        title={t('accounts')}
        subtitle="Contas a Pagar e a Receber — carteira, aging e liquidação"
        icon={<CreditCard className="w-5 h-5" />}
        iconTint="#14B8A6"
        breadcrumbs={[{ label: t('title'), href: '/financeiro' }, { label: t('accounts') }]}
        actions={
          <div className="flex items-center gap-2">
            <ExportReportButton
              size="md"
              variant="glass"
              permission="finance.export"
              fallbackPermission="finance.view"
              build={() => openFinanceReport({
                title: 'Contas a Pagar / Receber',
                fileContext: 'contas-pagar-receber',
                context: 'Carteira, aging e liquidação de títulos',
                kpis: kpis.map((k) => kpiFromHud(k)),
                sections: [{
                  title: 'Títulos',
                  tables: [{
                    columns: [
                      { key: 'num', label: 'Título' },
                      { key: 'type', label: 'Tipo' },
                      { key: 'due', label: 'Vencimento' },
                      { key: 'amount', label: 'Valor', num: true },
                      { key: 'rem', label: 'Em aberto', num: true },
                      { key: 'status', label: 'Status' },
                    ],
                    rows: filtered.slice(0, 150).map((title) => ({
                      num: title.title_number,
                      type: title.type === 'receivable' ? t('receivable') : t('payable'),
                      due: { html: `<span class="mono" style="${isOverdue(title) ? 'color:#B91C1C;font-weight:700' : ''}">${title.due_date}</span>` },
                      amount: { html: `<span class="mono">${formatBRL(title.amount_cents)}</span>` },
                      rem: { html: `<span class="mono">${formatBRL(remainingCents(title))}</span>` },
                      status: { html: `<span class="pill ${isOverdue(title) ? 'crit' : title.status === 'paid' ? 'ok' : 'warn'}">${isOverdue(title) ? (STATUS_LABELS.overdue ?? 'vencido') : (STATUS_LABELS[title.status] ?? title.status)}</span>` },
                    })),
                  }],
                }],
              })}
            />
            <HudButton variant="primary" leftIcon={<Plus className="w-4 h-4" />} onClick={() => setDrawerOpen(true)}>{t('newTitle')}</HudButton>
          </div>
        }
      />

      <HudKpiStrip kpis={kpis} columns={5} size="sm" />

      <div className="mt-4">
        <FinanceFilterBar
          showPeriod={false}
          showScenario={false}
          extra={
            <>
              <FinanceFilterChip
                icon={<Filter className="h-3.5 w-3.5" />}
                label={t('type')}
                value={filterType}
                onChange={(v) => { setFilterType(v as APARType | 'all'); setFilterEntity(''); }}
                options={[
                  { value: 'all', label: t('allTypes') },
                  { value: 'payable', label: t('payable') },
                  { value: 'receivable', label: t('receivable') },
                ]}
              />
              <FinanceFilterChip
                icon={<Activity className="h-3.5 w-3.5" />}
                label="Status"
                value={filterStatus}
                onChange={setFilterStatus}
                options={[
                  { value: '', label: 'Todos' },
                  { value: 'open', label: STATUS_LABELS.open },
                  { value: 'partial', label: STATUS_LABELS.partial },
                  { value: 'paid', label: STATUS_LABELS.paid },
                  { value: 'overdue', label: STATUS_LABELS.overdue },
                  { value: 'cancelled', label: STATUS_LABELS.cancelled },
                ]}
              />
              <FinanceFilterChip
                icon={<CreditCard className="h-3.5 w-3.5" />}
                label="Fornec./Cliente"
                value={filterEntity}
                onChange={setFilterEntity}
                options={entityOptions}
              />
              <FinanceFilterChip
                icon={<Link2 className="h-3.5 w-3.5" />}
                label={t('contract')}
                value={filterContract}
                onChange={setFilterContract}
                options={[{ value: '', label: 'Todos' }, ...getContracts().map(c => ({ value: c.id, label: c.code }))]}
              />
              <FinanceFilterChip
                icon={<Link2 className="h-3.5 w-3.5" />}
                label={t('project')}
                value={filterProject}
                onChange={setFilterProject}
                options={[{ value: '', label: 'Todos' }, ...getProjects().map(p => ({ value: p.id, label: p.code }))]}
              />
              <FinanceFilterChip
                icon={<CalendarRange className="h-3.5 w-3.5" />}
                label="Data"
                value={filterDateField}
                onChange={(v) => setFilterDateField(v as 'due_date' | 'issue_date')}
                options={[
                  { value: 'due_date', label: t('dueDate') },
                  { value: 'issue_date', label: t('issueDate') },
                ]}
              />
              <label className="flex items-center gap-1.5 rounded-lg border border-[color:var(--ig-border-strong)] bg-[color:var(--ig-bg-raised)]/60 px-2 h-9 backdrop-blur-sm">
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--ig-fg-subtle)]">De</span>
                <input type="date" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)} className="bg-transparent text-xs font-medium text-[color:var(--ig-fg-strong)] focus:outline-none" />
              </label>
              <label className="flex items-center gap-1.5 rounded-lg border border-[color:var(--ig-border-strong)] bg-[color:var(--ig-bg-raised)]/60 px-2 h-9 backdrop-blur-sm">
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--ig-fg-subtle)]">Até</span>
                <input type="date" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)} className="bg-transparent text-xs font-medium text-[color:var(--ig-fg-strong)] focus:outline-none" />
              </label>
            </>
          }
          rightSlot={hasActiveFilters ? (
            <HudButton variant="ghost" size="sm" leftIcon={<X className="w-4 h-4" />} onClick={clearFilters}>Limpar</HudButton>
          ) : undefined}
        />
      </div>

      {/* Aging */}
      <div className="mt-4">
        <HudPanel title={t('aging')} subtitle="Mapa de vencimentos por bucket (a pagar × a receber)" icon={<Clock3 className="h-4 w-4" />} sweep halo>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_240px]">
            <FinanceBarChart
              categories={aging.map(b => b.label)}
              series={[
                { name: t('receivable'), data: aging.map(b => b.receivable / 100), tone: 'success' },
                { name: t('payable'), data: aging.map(b => -b.payable / 100), tone: 'danger' },
              ]}
              height={300}
            />
            <div className="flex flex-col justify-between gap-3 rounded-xl border border-ig-border-subtle bg-ig-panel/45 p-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ig-fg-subtle">Resumo de caixa</p>
                <p className="mt-1 text-xs text-ig-fg-muted">Totais sobre o filtro atual.</p>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div><p className="text-ig-fg-subtle">{t('receivable')}</p><p className="tabular-nums text-ig-success">{formatCompactBRL(summary.totalReceivable)}</p></div>
                <div><p className="text-ig-fg-subtle">{t('payable')}</p><p className="tabular-nums text-ig-danger">{formatCompactBRL(summary.totalPayable)}</p></div>
                <div><p className="text-ig-fg-subtle">{t('overdue')}</p><p className="tabular-nums text-ig-danger">{formatCompactBRL(summary.overdueTotal)}</p></div>
                <div><p className="text-ig-fg-subtle">{t('dueThisMonth')}</p><p className="tabular-nums text-ig-warning">{formatCompactBRL(summary.dueThisMonth)}</p></div>
                <div><p className="text-ig-fg-subtle">Recebido</p><p className="tabular-nums text-ig-fg-muted">{formatCompactBRL(summary.receivedTotal)}</p></div>
                <div><p className="text-ig-fg-subtle">Pago</p><p className="tabular-nums text-ig-fg-muted">{formatCompactBRL(summary.paidTotal)}</p></div>
              </div>
              <div className="border-t border-ig-border-subtle pt-2 text-xs">
                <p className="text-ig-fg-subtle">{t('cashImpact')}</p>
                <p className={`tabular-nums text-base font-semibold ${summary.cashImpact >= 0 ? 'text-ig-success' : 'text-ig-danger'}`}>{formatCompactBRL(summary.cashImpact)}</p>
              </div>
            </div>
          </div>
        </HudPanel>
      </div>

      {/* Cash Flow / Treasury — derived from clearing (settlement) ledger entries, kept out of P&L */}
      <div className="mt-4">
        <HudPanel title={t('cashFlow')} subtitle="Movimentos de liquidação (caixa) — fora do DRE" icon={<Wallet className="h-4 w-4" />} sweep>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-ig-border-subtle bg-ig-panel/45 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ig-fg-subtle">{t('cashIn')}</p>
                <p className="mt-1 tabular-nums text-base font-semibold text-ig-success">{formatCompactBRL(cashSummary.cashIn)}</p>
              </div>
              <div className="rounded-xl border border-ig-border-subtle bg-ig-panel/45 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ig-fg-subtle">{t('cashOut')}</p>
                <p className="mt-1 tabular-nums text-base font-semibold text-ig-danger">{formatCompactBRL(cashSummary.cashOut)}</p>
              </div>
              <div className="rounded-xl border border-ig-border-subtle bg-ig-panel/45 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ig-fg-subtle">{t('netCash')}</p>
                <p className={`mt-1 tabular-nums text-base font-semibold ${cashSummary.net >= 0 ? 'text-ig-success' : 'text-ig-danger'}`}>{formatCompactBRL(cashSummary.net)}</p>
              </div>
              <div className="rounded-xl border border-ig-border-subtle bg-ig-panel/45 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ig-fg-subtle">{t('movements')}</p>
                <p className="mt-1 tabular-nums text-base font-semibold text-ig-fg-strong">{cashSummary.count}</p>
              </div>
            </div>
            <div className="rounded-xl border border-ig-border-subtle bg-ig-panel/45 p-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-ig-fg-subtle">{t('latestMovements')}</p>
              {latestMovements.length === 0 ? (
                <p className="text-xs text-ig-fg-muted">{t('noMovements')}</p>
              ) : (
                <ul className="divide-y divide-ig-border-subtle/60">
                  {latestMovements.map((m) => {
                    const dir = cashDirection(m);
                    return (
                      <li key={m.id}>
                        <button
                          type="button"
                          onClick={() => goToLedgerEntry(m.id)}
                          title={t('viewLinkedEntry')}
                          className="flex w-full items-center justify-between gap-3 py-1.5 text-left transition-colors hover:bg-ig-panel/60 focus:bg-ig-panel/60 focus:outline-none rounded-md px-1"
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            {dir === 'in'
                              ? <ArrowDownLeft className="h-3.5 w-3.5 shrink-0 text-ig-success" />
                              : <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-ig-danger" />}
                            <span className="truncate text-xs text-ig-fg-strong">{m.description}</span>
                          </div>
                          <div className="flex shrink-0 items-center gap-3">
                            <span className="tabular-nums text-[11px] text-ig-fg-muted">{m.entry_date}</span>
                            <span className={`tabular-nums text-xs font-semibold ${dir === 'in' ? 'text-ig-success' : 'text-ig-danger'}`}>
                              {dir === 'in' ? '+' : '−'}{formatBRL(m.amount_cents)}
                            </span>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </HudPanel>
      </div>

      {/* Titles table */}
      <div className="mt-4">
        <HudPanel
          noPadding
          title="Carteira AP/AR"
          subtitle={`${filtered.length} título(s) • ${summary.activeCount} ativo(s)`}
          icon={<CreditCard className="h-4 w-4" />}
          sweep
          headerActions={
            <HudButton variant="ghost" size="sm" leftIcon={<ArrowUpDown className="w-4 h-4" />} onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}>
              {t('dueDate')} {sortDir === 'asc' ? '↑' : '↓'}
            </HudButton>
          }
        >
          <HudTable columns={columns} data={filtered} keyExtractor={(tt) => tt.id}
            onRowClick={(tt) => setDetailId(tt.id)} selectedRowId={detailId} compact stickyHeader />
        </HudPanel>
      </div>

      {/* Detail drawer */}
      <HudDrawer isOpen={!!detailId} onClose={() => setDetailId(null)} title={t('titleDetails')} width="md">
        {detail && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div><p className="text-[10px] uppercase text-ig-fg-subtle">{t('titleNumber')}</p><p className="font-mono text-sm text-ig-fg-strong">{detail.title_number}</p></div>
              <div><p className="text-[10px] uppercase text-ig-fg-subtle">Status</p>
                <HudStatusPill variant={(isOverdue(detail) ? 'error' : STATUS_VARIANTS[detail.status]) as any} size="sm">
                  {isOverdue(detail) ? STATUS_LABELS.overdue : (STATUS_LABELS[detail.status] ?? detail.status)}
                </HudStatusPill>
              </div>
            </div>
            <div>
              <p className="text-[10px] uppercase text-ig-fg-subtle">{detail.type === 'receivable' ? t('customer') : t('supplier')}</p>
              <p className="text-sm text-ig-fg-strong">{detail.client?.name || detail.supplier?.name || '—'}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><p className="text-[10px] uppercase text-ig-fg-subtle">{t('issueDate')}</p><p className="tabular-nums text-sm text-ig-fg-strong">{detail.issue_date}</p></div>
              <div><p className="text-[10px] uppercase text-ig-fg-subtle">{t('dueDate')}</p><p className={`tabular-nums text-sm ${isOverdue(detail) ? 'font-semibold text-ig-danger' : 'text-ig-fg-strong'}`}>{detail.due_date}</p></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><p className="text-[10px] uppercase text-ig-fg-subtle">{t('amount')}</p><p className="tabular-nums text-sm text-ig-fg-strong">{formatBRL(detail.amount_cents)}</p></div>
              <div><p className="text-[10px] uppercase text-ig-fg-subtle">{t('paidAmount')}</p><p className="tabular-nums text-sm text-ig-fg-muted">{formatBRL(detail.paid_amount_cents)}</p></div>
              <div><p className="text-[10px] uppercase text-ig-fg-subtle">{t('remaining')}</p><p className="tabular-nums text-sm text-ig-fg-strong">{formatBRL(remainingCents(detail))}</p></div>
            </div>
            {isOverdue(detail) && (
              <div className="flex items-center gap-2 rounded-lg border border-[color-mix(in_oklab,var(--ig-danger)_28%,transparent)] bg-[color-mix(in_oklab,var(--ig-danger)_10%,transparent)] px-3 py-2">
                <AlertTriangle className="h-4 w-4 text-ig-danger" />
                <span className="text-xs font-medium text-ig-danger">{daysOverdue(detail)} {t('overdue').toLowerCase()}</span>
              </div>
            )}

            {/* Settlement history — every cash leg generated by this title */}
            <div className="rounded-lg border border-ig-border-subtle bg-ig-panel/40 p-3">
              <div className="flex items-center justify-between">
                <p className="text-[10px] uppercase text-ig-fg-subtle">{t('settlementHistory')}</p>
                {settlementEntries.length > 0 && <HudBadge variant="default" size="sm">{settlementEntries.length}</HudBadge>}
              </div>
              {settlementEntries.length === 0 ? (
                <p className="mt-1 text-sm text-ig-fg-muted">{t('noLinkedEntry')}</p>
              ) : (
                <ul className="mt-2 divide-y divide-ig-border-subtle/60">
                  {settlementEntries.map((e) => {
                    const dir = cashDirection(e);
                    return (
                      <li key={e.id}>
                        <button
                          type="button"
                          onClick={() => goToLedgerEntry(e.id)}
                          title={t('viewLinkedEntry')}
                          className="flex w-full items-center justify-between gap-2 py-1.5 text-left transition-colors hover:bg-ig-panel/60 focus:bg-ig-panel/60 focus:outline-none rounded-md px-1"
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <Link2 className="h-3 w-3 shrink-0 text-ig-accent" />
                            <span className="truncate text-xs text-ig-fg-strong">{e.entry_date}</span>
                            <span className="text-[10px] uppercase tracking-[0.12em] text-ig-fg-subtle">{dir === 'in' ? t('cashIn') : t('cashOut')}</span>
                          </div>
                          <span className={`shrink-0 tabular-nums text-xs font-semibold ${dir === 'in' ? 'text-ig-success' : 'text-ig-danger'}`}>
                            {dir === 'in' ? '+' : '−'}{formatBRL(e.amount_cents)}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Settlement actions — full or partial; out-of-P&L clearing entry */}
            {detail.status !== 'paid' && detail.status !== 'cancelled' ? (
              (() => {
                const remaining = remainingCents(detail);
                const parsed = settleAmount ? reaisToCents(parseFloat(settleAmount)) : 0;
                const partialValid = parsed > 0 && parsed <= remaining;
                const settleVerb = detail.type === 'payable' ? t('markPaid') : t('markReceived');
                return (
                  <div className="space-y-3 border-t border-ig-border-subtle pt-4">
                    <div className="grid grid-cols-2 gap-3">
                      <HudInput
                        label={t('paymentAmount')}
                        type="number"
                        value={settleAmount}
                        onChange={(e) => setSettleAmount(e.target.value)}
                        placeholder={String(centsToReais(remaining))}
                        leftIcon={<span className="text-xs text-ig-fg-subtle">R$</span>}
                        error={settleAmount && !partialValid ? `≤ ${formatBRL(remaining)}` : undefined}
                      />
                      <HudInput label={t('paymentDate')} type="date" value={settleDate} onChange={(e) => setSettleDate(e.target.value)} />
                    </div>
                    <div className="flex gap-2">
                      <HudButton
                        variant="secondary"
                        leftIcon={<CheckCircle className="w-4 h-4" />}
                        onClick={() => handleSettle(detail, parsed)}
                        disabled={processing || !partialValid}
                        fullWidth
                      >
                        {t('registerPayment')}
                      </HudButton>
                      <HudButton
                        variant="primary"
                        leftIcon={<CheckCircle className="w-4 h-4" />}
                        onClick={() => handleSettle(detail)}
                        disabled={processing}
                        fullWidth
                      >
                        {t('fullPayment')} ({settleVerb.toLowerCase()})
                      </HudButton>
                    </div>
                  </div>
                );
              })()
            ) : (
              <div className="border-t border-ig-border-subtle pt-4">
                <HudBadge variant="default" size="sm">{STATUS_LABELS[detail.status]}</HudBadge>
              </div>
            )}
          </div>
        )}
      </HudDrawer>

      {/* New-title drawer */}
      <HudDrawer isOpen={drawerOpen} onClose={() => setDrawerOpen(false)} title={t('newTitle')} width="md">
        <div className="space-y-4">
          <HudSelect label={t('type')} value={formType} onChange={(v) => setFormType(v as APARType)}
            options={[{ value: 'payable', label: t('payable') }, { value: 'receivable', label: t('receivable') }]} />
          <HudInput label={t('titleNumber')} value={formTitleNumber} onChange={(e) => setFormTitleNumber(e.target.value)} />
          <HudSelect label={formType === 'payable' ? t('supplier') : t('customer')} value={formEntity} onChange={setFormEntity}
            options={[{ value: '', label: 'Selecionar...' }, ...(formType === 'payable' ? suppliers : clients).map(e => ({ value: e.id, label: e.name }))]} />
          <div className="grid grid-cols-2 gap-3">
            <HudInput label={t('issueDate')} type="date" value={formIssueDate} onChange={(e) => setFormIssueDate(e.target.value)} />
            <HudInput label={t('dueDate')} type="date" value={formDueDate} onChange={(e) => setFormDueDate(e.target.value)} />
          </div>
          <HudInput label={t('amount')} type="number" value={formAmount} onChange={(e) => setFormAmount(e.target.value)} leftIcon={<span className="text-xs text-ig-fg-subtle">R$</span>} />
          <div className="flex gap-3 pt-4">
            <HudButton variant="secondary" onClick={() => setDrawerOpen(false)} fullWidth>Cancelar</HudButton>
            <HudButton variant="primary" onClick={handleSave} fullWidth>Salvar</HudButton>
          </div>
        </div>
      </HudDrawer>
    </HudPageLayout>
  );
}
