'use client';

import { useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { CreditCard, Plus, ArrowDownLeft, ArrowUpRight, CalendarRange, X } from 'lucide-react';
import ReactECharts from 'echarts-for-react';
import { useTheme } from '@/contexts/ThemeContext';
import {
  HudPageLayout, HudHeader, HudKpiStrip, HudTable, HudButton,
  HudStatusPill, HudDrawer, HudInput, HudSelect,
  type KpiItem, type HudTableColumn,
} from '@/components/hud';
import {
  getAPARTitles, createAPARTitle, getSuppliers, getClients,
  computeAgingBuckets, formatBRL, formatCompactBRL, reaisToCents,
} from '@/lib/finance/finance-store';
import type { APARTitle } from '@/lib/types/finance';

const STATUS_VARIANTS: Record<string, string> = { open: 'info', partial: 'warning', paid: 'completed', overdue: 'error', cancelled: 'error' };

export default function ContasPage() {
  const t = useTranslations('finance');
  const { theme } = useTheme();
  const isLight = theme === 'light';
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

  const kpis: KpiItem[] = [
    { id: 'ar', label: t('receivable'), value: formatCompactBRL(totalReceivable), icon: <ArrowDownLeft className="w-5 h-5" />, variant: 'success' },
    { id: 'ap', label: t('payable'), value: formatCompactBRL(totalPayable), icon: <ArrowUpRight className="w-5 h-5" />, variant: 'danger' },
    { id: 'bal', label: 'Saldo', value: formatCompactBRL(totalReceivable - totalPayable), variant: totalReceivable > totalPayable ? 'success' : 'danger', icon: <CreditCard className="w-5 h-5" /> },
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
    { key: 'title_number', header: t('titleNumber'), cell: (title) => <span className="text-white/80 text-xs font-mono">{title.title_number}</span> },
    { key: 'entity', header: activeTab === 'receivable' ? 'Cliente' : t('supplier'), cell: (title) => <span className="text-white/70 text-xs">{title.client?.name || title.supplier?.name || '—'}</span> },
    { key: 'issue_date', header: t('issueDate'), cell: (title) => <span className="text-white/60 text-xs font-mono">{title.issue_date}</span> },
    { key: 'due_date', header: t('dueDate'), cell: (title) => <span className="text-white/60 text-xs font-mono">{title.due_date}</span> },
    { key: 'amount_cents', header: t('amount'), cell: (title) => <span className="text-white/80 text-xs font-mono">{formatBRL(title.amount_cents)}</span> },
    { key: 'paid_amount_cents', header: t('paidAmount'), cell: (title) => <span className="text-white/60 text-xs font-mono">{formatBRL(title.paid_amount_cents)}</span> },
    { key: 'status', header: 'Status', cell: (title) => <HudStatusPill variant={STATUS_VARIANTS[title.status] as any} size="sm">{title.status}</HudStatusPill> },
  ];

  const agingOption = {
    tooltip: {
      trigger: 'axis' as const,
      backgroundColor: isLight ? 'rgba(255,255,255,0.96)' : '#162522',
      borderColor: isLight ? 'rgba(0,0,0,0.08)' : 'rgba(200,220,235,0.12)',
      textStyle: { color: isLight ? '#1C1F24' : '#f0fdf8' },
    },
    legend: { data: [t('receivable'), t('payable')], textStyle: { color: isLight ? '#4B5563' : '#94a3b8', fontSize: 10 }, bottom: 0 },
    grid: { left: 60, right: 16, top: 16, bottom: 40 },
    xAxis: { type: 'category' as const, data: agingBuckets.map(b => b.label), axisLabel: { color: isLight ? '#4B5563' : '#64748b', fontSize: 10 }, axisLine: { lineStyle: { color: isLight ? 'rgba(0,0,0,0.08)' : '#1e293b' } } },
    yAxis: { type: 'value' as const, axisLabel: { color: isLight ? '#6B7280' : '#64748b', fontSize: 10, formatter: (v: number) => formatCompactBRL(v) }, splitLine: { lineStyle: { color: isLight ? 'rgba(0,0,0,0.05)' : '#1e293b' } } },
    series: [
      { name: t('receivable'), type: 'bar', data: agingBuckets.map(b => b.receivable), itemStyle: { color: '#10b981' } },
      { name: t('payable'), type: 'bar', data: agingBuckets.map(b => -b.payable), itemStyle: { color: '#ef4444' } },
    ],
  };

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

      {/* Period & Status Filters */}
      <div className="mt-4 flex flex-col md:flex-row items-stretch md:items-end gap-3 p-3 rounded-xl border border-white/[0.12] bg-[#0e1614] backdrop-blur-sm finance-filter-bar">
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-white/50 uppercase tracking-wider px-0.5">Filtrar por</span>
          <select
            value={filterDateField}
            onChange={(e) => setFilterDateField(e.target.value as any)}
            className="h-9 min-w-[140px] px-3 rounded-lg text-sm font-medium border border-white/[0.12] text-slate-100 focus:outline-none focus:border-cyan-500/40 focus:ring-1 focus:ring-cyan-500/20 hover:border-white/[0.18] transition-colors cursor-pointer appearance-none bg-no-repeat bg-[length:16px] bg-[right_8px_center] pr-8"
            style={{
              backgroundImage: "url(\"data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e\")",
              backgroundColor: '#121e1b',
            }}
          >
            <option value="due_date" className="bg-[#0e1614]">{t('dueDate')}</option>
            <option value="issue_date" className="bg-[#0e1614]">{t('issueDate')}</option>
          </select>
        </div>

        <div className="flex items-end gap-2">
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-white/50 uppercase tracking-wider px-0.5">De</span>
            <div className="relative">
              <CalendarRange className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" />
              <input
                type="date"
                value={filterDateFrom}
                onChange={(e) => setFilterDateFrom(e.target.value)}
                className="h-9 pl-8 pr-3 rounded-lg text-sm text-white border border-white/[0.12] focus:outline-none focus:border-cyan-500/40 focus:ring-1 focus:ring-cyan-500/20 transition-colors"
                style={{ backgroundColor: '#121e1b', colorScheme: 'dark' }}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-white/50 uppercase tracking-wider px-0.5">Até</span>
            <div className="relative">
              <CalendarRange className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" />
              <input
                type="date"
                value={filterDateTo}
                onChange={(e) => setFilterDateTo(e.target.value)}
                className="h-9 pl-8 pr-3 rounded-lg text-sm text-white border border-white/[0.12] focus:outline-none focus:border-cyan-500/40 focus:ring-1 focus:ring-cyan-500/20 transition-colors"
                style={{ backgroundColor: '#121e1b', colorScheme: 'dark' }}
              />
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-white/50 uppercase tracking-wider px-0.5">Status</span>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="h-9 min-w-[140px] px-3 rounded-lg text-sm font-medium border border-white/[0.12] text-slate-100 focus:outline-none focus:border-cyan-500/40 focus:ring-1 focus:ring-cyan-500/20 hover:border-white/[0.18] transition-colors cursor-pointer appearance-none bg-no-repeat bg-[length:16px] bg-[right_8px_center] pr-8"
            style={{
              backgroundImage: "url(\"data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e\")",
              backgroundColor: '#121e1b',
            }}
          >
            <option value="" className="bg-[#0e1614]">Todos</option>
            <option value="open" className="bg-[#0e1614]">Aberto</option>
            <option value="partial" className="bg-[#0e1614]">Parcial</option>
            <option value="paid" className="bg-[#0e1614]">Pago</option>
            <option value="overdue" className="bg-[#0e1614]">Vencido</option>
            <option value="cancelled" className="bg-[#0e1614]">Cancelado</option>
          </select>
        </div>

        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="h-9 flex items-center gap-1.5 px-3 rounded-lg border border-amber-500/30 bg-amber-500/15 text-amber-200 text-sm font-medium hover:bg-amber-500/20 hover:border-amber-500/40 transition-colors self-end"
          >
            <X className="w-3.5 h-3.5" />
            Limpar
          </button>
        )}
      </div>

      <div className="flex gap-1.5 mt-4">
        {tabOptions.map(tab => (
          <button key={tab.value} onClick={() => setActiveTab(tab.value)}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-medium uppercase tracking-wider transition-all ${
              activeTab === tab.value
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 finance-tab-active'
                : 'bg-white/[0.04] text-white/40 border border-white/[0.06] hover:bg-white/[0.06] finance-tab-inactive'
            }`}>
            {tab.label}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {activeTab === 'aging' ? (
          <ReactECharts option={agingOption} style={{ height: 320 }} opts={{ renderer: 'svg' }} />
        ) : (
          <HudTable columns={columns} data={currentData} keyExtractor={(title) => title.id} compact stickyHeader />
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
          <HudInput label={t('amount')} type="number" value={formAmount} onChange={(e) => setFormAmount(e.target.value)} leftIcon={<span className="text-white/30 text-xs">R$</span>} />
          <div className="flex gap-3 pt-4">
            <HudButton variant="secondary" onClick={() => setDrawerOpen(false)} fullWidth>Cancelar</HudButton>
            <HudButton variant="primary" onClick={handleSave} fullWidth>Salvar</HudButton>
          </div>
        </div>
      </HudDrawer>
    </HudPageLayout>
  );
}
