'use client';

import { useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { CreditCard, Plus, ArrowDownLeft, ArrowUpRight, CalendarRange, AlertTriangle, Clock3, ShieldCheck } from 'lucide-react';
import {
  HudPageLayout, HudHeader, HudKpiStrip, HudTable, HudButton,
  HudStatusPill, HudDrawer, HudInput, HudSelect,
  HudPanel, HudFilterBar,
  type KpiItem, type HudTableColumn,
} from '@/components/hud';
import { FinanceBarChart, FinanceSparkline } from '@/components/finance/shared';
import {
  getAPARTitles, createAPARTitle, getSuppliers, getClients,
  computeAgingBuckets, formatBRL, formatCompactBRL, reaisToCents,
} from '@/lib/finance/finance-store';
import type { APARTitle } from '@/lib/types/finance';

const STATUS_VARIANTS: Record<string, string> = { open: 'info', partial: 'warning', paid: 'completed', overdue: 'error', cancelled: 'error' };
const STATUS_LABELS: Record<string, string> = { open: 'Aberto', partial: 'Parcial', paid: 'Pago', overdue: 'Vencido', cancelled: 'Cancelado', pending: 'Pendente' };

export default function ContasPage() {
  const t = useTranslations('finance');
  const [activeTab, setActiveTab] = useState('receivable');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterDateField, setFilterDateField] = useState<'due_date' | 'issue_date'>('due_date');
  const [filterStatus, setFilterStatus] = useState('');

  const [formType, setFormType] = useState<'payable' | 'receivable'>('payable');
  const [formTitleNumber, setFormTitleNumber] = useState('');
  const [formEntity, setFormEntity] = useState('');
  const [formIssueDate, setFormIssueDate] = useState('');
  const [formDueDate, setFormDueDate] = useState('');
  const [formAmount, setFormAmount] = useState('');

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const payables = useMemo(() => getAPARTitles('payable'), [refreshKey]);
  const receivables = useMemo(() => getAPARTitles('receivable'), [refreshKey]);
  const agingBuckets = useMemo(() => computeAgingBuckets(), [refreshKey]);

  const filteredPayables = useMemo(() => {
    let result: APARTitle[] = payables;
    if (filterDateFrom) result = result.filter(t => (t[filterDateField] || '') >= filterDateFrom);
    if (filterDateTo) result = result.filter(t => (t[filterDateField] || '') <= filterDateTo);
    if (filterStatus) result = result.filter(t => t.status === filterStatus);
    return result;
  }, [payables, filterDateFrom, filterDateTo, filterDateField, filterStatus]);

  const filteredReceivables = useMemo(() => {
    let result: APARTitle[] = receivables;
    if (filterDateFrom) result = result.filter(t => (t[filterDateField] || '') >= filterDateFrom);
    if (filterDateTo) result = result.filter(t => (t[filterDateField] || '') <= filterDateTo);
    if (filterStatus) result = result.filter(t => t.status === filterStatus);
    return result;
  }, [receivables, filterDateFrom, filterDateTo, filterDateField, filterStatus]);

  const totalPayable = filteredPayables.filter(t => t.status !== 'cancelled' && t.status !== 'paid').reduce((s, t) => s + (t.amount_cents - t.paid_amount_cents), 0);
  const totalReceivable = filteredReceivables.filter(t => t.status !== 'cancelled' && t.status !== 'paid').reduce((s, t) => s + (t.amount_cents - t.paid_amount_cents), 0);
  const overdueExposure = [...filteredPayables, ...filteredReceivables]
    .filter(title => title.status === 'overdue')
    .reduce((sum, title) => sum + (title.amount_cents - title.paid_amount_cents), 0);
  const partialTitles = [...filteredPayables, ...filteredReceivables].filter(title => title.status === 'partial').length;
  const activeTitles = [...filteredPayables, ...filteredReceivables].filter(title => !['cancelled', 'paid'].includes(title.status)).length;
  const agingTrend = agingBuckets.map(bucket => bucket.receivable - bucket.payable);

  const kpis: KpiItem[] = [
    { id: 'ar', label: t('receivable'), value: totalReceivable / 100, format: 'compactCurrency', icon: <ArrowDownLeft className="w-5 h-5" />, variant: 'success' },
    { id: 'ap', label: t('payable'), value: totalPayable / 100, format: 'compactCurrency', icon: <ArrowUpRight className="w-5 h-5" />, variant: 'danger' },
    { id: 'bal', label: 'Saldo', value: (totalReceivable - totalPayable) / 100, format: 'compactCurrency', variant: totalReceivable > totalPayable ? 'success' : 'danger', icon: <CreditCard className="w-5 h-5" /> },
  ];

  const tabOptions = [
    { value: 'receivable', label: t('receivable') },
    { value: 'payable', label: t('payable') },
    { value: 'aging', label: t('aging') },
  ];

  const hasActiveFilters = !!(filterDateFrom || filterDateTo || filterStatus);

  const clearFilters = () => {
    setFilterDateFrom('');
    setFilterDateTo('');
    setFilterStatus('');
  };

  const currentData = activeTab === 'receivable' ? filteredReceivables : filteredPayables;

  const columns: HudTableColumn<APARTitle>[] = [
    { key: 'title_number', header: t('titleNumber'), cell: (title) => <span className="font-mono text-xs text-ig-fg-strong">{title.title_number}</span> },
    { key: 'entity', header: activeTab === 'receivable' ? 'Cliente' : t('supplier'), cell: (title) => (
      <div className="min-w-0">
        <span className="block truncate text-xs font-medium text-ig-fg-strong">{title.client?.name || title.supplier?.name || '—'}</span>
        <span className="text-[10px] uppercase tracking-[0.14em] text-ig-fg-subtle">{title.type === 'receivable' ? 'Recebível' : 'Pagável'}</span>
      </div>
    ) },
    { key: 'issue_date', header: t('issueDate'), cell: (title) => <span className="font-mono text-xs text-ig-fg-muted">{title.issue_date}</span> },
    { key: 'due_date', header: t('dueDate'), cell: (title) => <span className="font-mono text-xs text-ig-fg-muted">{title.due_date}</span> },
    { key: 'amount_cents', header: t('amount'), align: 'right', cell: (title) => <span className="block font-mono text-xs text-ig-fg-strong">{formatBRL(title.amount_cents)}</span> },
    { key: 'paid_amount_cents', header: t('paidAmount'), align: 'right', cell: (title) => <span className="block font-mono text-xs text-ig-fg-muted">{formatBRL(title.paid_amount_cents)}</span> },
    { key: 'status', header: 'Status', cell: (title) => <HudStatusPill variant={STATUS_VARIANTS[title.status] as any} size="sm">{STATUS_LABELS[title.status] ?? title.status}</HudStatusPill> },
  ];

  const handleSave = () => {
    if (!formTitleNumber || !formAmount || !formDueDate) return;
    createAPARTitle({
      type: formType,
      title_number: formTitleNumber,
      supplier_id: formType === 'payable' ? formEntity : undefined,
      client_id: formType === 'receivable' ? formEntity : undefined,
      issue_date: formIssueDate,
      due_date: formDueDate,
      amount_cents: reaisToCents(parseFloat(formAmount)),
    });
    setDrawerOpen(false);
    setRefreshKey(k => k + 1);
  };

  return (
    <HudPageLayout>
      <HudHeader
        title={t('accounts')}
        icon={<CreditCard className="w-5 h-5" />}
        iconTint="#14B8A6"
        breadcrumbs={[{ label: t('title'), href: '/financeiro' }, { label: t('accounts') }]}
        actions={<HudButton variant="primary" leftIcon={<Plus className="w-4 h-4" />} onClick={() => setDrawerOpen(true)}>Novo Título</HudButton>}
      />
      <HudKpiStrip kpis={kpis} columns={3} />

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        {[
          { label: 'Títulos ativos', value: activeTitles.toString(), meta: `${partialTitles} parciais`, icon: <ShieldCheck className="h-4 w-4" />, tone: 'var(--ig-info)' },
          { label: 'Exposição vencida', value: formatCompactBRL(overdueExposure), meta: 'Aging consolidado', icon: <AlertTriangle className="h-4 w-4" />, tone: 'var(--ig-danger)' },
          { label: 'Saldo por vencimento', value: formatCompactBRL(totalReceivable - totalPayable), meta: 'Receber menos pagar', icon: <Clock3 className="h-4 w-4" />, tone: 'var(--ig-accent)' },
        ].map((item) => (
          <div key={item.label} className="ig-glass relative overflow-hidden rounded-2xl p-4" data-elev={2} data-sweep>
            <span data-ig-noise="" />
            <span data-ig-specular="" />
            <div data-ig-content="" className="relative flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ig-fg-subtle">{item.label}</p>
                <p className="mt-1 font-mono text-lg font-semibold text-ig-fg-strong">{item.value}</p>
                <p className="mt-1 text-xs text-ig-fg-muted">{item.meta}</p>
              </div>
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-[10px]" style={{ color: item.tone, background: `color-mix(in oklab, ${item.tone} 12%, transparent)` }}>
                {item.icon}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4">
        <HudFilterBar
          compact
          filterGroups={[
            {
              id: 'dateField',
              label: 'Filtrar por',
              value: filterDateField,
              onChange: (value) => setFilterDateField(value as 'due_date' | 'issue_date'),
              options: [
                { value: 'due_date', label: t('dueDate') },
                { value: 'issue_date', label: t('issueDate') },
              ],
            },
            {
              id: 'status',
              label: 'Status',
              value: filterStatus,
              onChange: setFilterStatus,
              options: [
                { value: '', label: 'Todos' },
                { value: 'open', label: 'Aberto' },
                { value: 'partial', label: 'Parcial' },
                { value: 'paid', label: 'Pago' },
                { value: 'overdue', label: 'Vencido' },
                { value: 'cancelled', label: 'Cancelado' },
              ],
            },
          ]}
          activeFiltersCount={[filterDateFrom, filterDateTo, filterStatus].filter(Boolean).length}
          onClearFilters={clearFilters}
          rightContent={
            <div className="flex flex-wrap items-center gap-2">
              <label className="hud-filter-block flex min-h-9 items-center gap-2 px-2.5 py-1.5">
                <CalendarRange className="h-3.5 w-3.5 text-ig-fg-subtle" />
                <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ig-fg-subtle">De</span>
                <input type="date" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)} className="hud-filter-input border-0 bg-transparent text-sm text-ig-fg-strong focus:outline-none focus:ring-0" />
              </label>
              <label className="hud-filter-block flex min-h-9 items-center gap-2 px-2.5 py-1.5">
                <CalendarRange className="h-3.5 w-3.5 text-ig-fg-subtle" />
                <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ig-fg-subtle">Até</span>
                <input type="date" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)} className="hud-filter-input border-0 bg-transparent text-sm text-ig-fg-strong focus:outline-none focus:ring-0" />
              </label>
            </div>
          }
        />
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {tabOptions.map(tab => (
          <button key={tab.value} onClick={() => setActiveTab(tab.value)}
            className={`rounded-lg border px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider transition-all ${
              activeTab === tab.value
                ? 'border-ig-border-focus bg-ig-accent-weak text-ig-accent finance-tab-active'
                : 'border-ig-border-subtle bg-ig-panel text-ig-fg-muted hover:bg-ig-raised finance-tab-inactive'
            }`}>
            {tab.label}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {activeTab === 'aging' ? (
          <HudPanel
            title={t('aging')}
            subtitle="Mapa executivo de vencimentos por fluxo"
            icon={<Clock3 className="h-4 w-4" />}
            sweep
            halo
          >
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_220px]">
              <FinanceBarChart
                categories={agingBuckets.map(b => b.label)}
                series={[
                  { name: t('receivable'), data: agingBuckets.map(b => b.receivable), tone: 'success' },
                  { name: t('payable'), data: agingBuckets.map(b => -b.payable), tone: 'danger' },
                ]}
                height={320}
              />
              <div className="flex flex-col justify-between rounded-xl border border-ig-border-subtle bg-ig-panel/45 p-4">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ig-fg-subtle">Curva líquida</p>
                  <p className="mt-1 text-sm text-ig-fg-muted">Pressão de caixa por bucket.</p>
                </div>
                <FinanceSparkline values={agingTrend.length ? agingTrend : [0]} tone={totalReceivable >= totalPayable ? 'success' : 'warning'} height={82} />
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <p className="text-ig-fg-subtle">Receber</p>
                    <p className="font-mono text-ig-success">{formatCompactBRL(totalReceivable)}</p>
                  </div>
                  <div>
                    <p className="text-ig-fg-subtle">Pagar</p>
                    <p className="font-mono text-ig-danger">{formatCompactBRL(totalPayable)}</p>
                  </div>
                </div>
              </div>
            </div>
          </HudPanel>
        ) : (
          <HudPanel noPadding title={activeTab === 'receivable' ? t('receivable') : t('payable')} subtitle="Carteira operacional com risco, vencimento e liquidação" sweep>
            <HudTable columns={columns} data={currentData} keyExtractor={(title) => title.id} compact stickyHeader />
          </HudPanel>
        )}
      </div>

      <HudDrawer isOpen={drawerOpen} onClose={() => setDrawerOpen(false)} title="Novo Título" width="md">
        <div className="space-y-4">
          <HudSelect label="Tipo" value={formType} onChange={(v) => setFormType(v as any)}
            options={[{ value: 'payable', label: t('payable') }, { value: 'receivable', label: t('receivable') }]} />
          <HudInput label={t('titleNumber')} value={formTitleNumber} onChange={(e) => setFormTitleNumber(e.target.value)} />
          <HudSelect label={formType === 'payable' ? t('supplier') : 'Cliente'} value={formEntity} onChange={setFormEntity}
            options={[{ value: '', label: 'Selecionar...' }, ...(formType === 'payable' ? getSuppliers() : getClients()).map(e => ({ value: e.id, label: e.name }))]} />
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
