'use client';

import { useMemo, useState, useCallback, Suspense, useEffect } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Wallet, Calendar, AlertTriangle, Tag, Activity, Clock3, CheckCircle, Link2,
  ArrowUpRight, ArrowUpDown,
} from 'lucide-react';
import {
  HudPageLayout, HudHeader, HudKpiStrip, HudButton,
  HudPanel, HudTable, HudStatusPill, HudDrawer, HudBadge, HudInput,
  type KpiItem, type HudTableColumn, type HudStatusPillVariant,
} from '@/components/hud';
import {
  FinanceFilterBar, FinanceFilterChip, FinanceFilterDateField,
  FinanceBarChart, FinanceDonutChart,
  fmtBRL, fmtCompactBRL,
} from '@/components/finance/shared';
import {
  getTaxObligations, getTaxObligation, getLedgerEntry,
  recordTaxPayment, formatBRL, formatCompactBRL, reaisToCents, centsToReais,
} from '@/lib/finance/finance-store';
import {
  selectTaxSummary, selectTaxAging, selectTaxesByType, selectProjectedTaxCashOut,
  filterTaxes, sortTaxesByDueDate, isTaxOverdue, daysOverdueTax, remainingTaxCents,
  type TaxFilter,
} from '@/lib/finance/selectors/taxes';
import { ExportReportButton } from '@/components/reports/ExportReportButton';
import { openFinanceReport, kpiFromHud } from '@/lib/reports/modules/finance-report';
import type { TaxObligation, TaxStatus, TaxType, LedgerEntry } from '@/lib/types/finance';

const STATUS_VARIANT: Record<TaxStatus, HudStatusPillVariant> = {
  open: 'info',
  scheduled: 'pending',
  partial: 'warning',
  paid: 'completed',
  overdue: 'error',
  cancelled: 'error',
};
const STATUS_LABEL: Record<TaxStatus, string> = {
  open: 'Em aberto',
  scheduled: 'Agendado',
  partial: 'Parcial',
  paid: 'Pago',
  overdue: 'Vencido',
  cancelled: 'Cancelado',
};

const TAX_TYPES: TaxType[] = ['ISS', 'INSS', 'IRRF', 'CSLL', 'IRPJ', 'PIS', 'COFINS', 'ICMS', 'DIFAL', 'FGTS', 'CSRF', 'OTHER'];

export default function ImpostosPage() {
  return (
    <Suspense>
      <ImpostosContent />
    </Suspense>
  );
}

function ImpostosContent() {
  const t = useTranslations('finance');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const focusTaxId = searchParams.get('taxId');

  const [refreshKey, setRefreshKey] = useState(0);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [filterType, setFilterType] = useState<TaxType | 'all'>('all');
  const [filterStatus, setFilterStatus] = useState<TaxStatus | 'all'>('all');
  const [filterCompetence, setFilterCompetence] = useState('');
  const [filterDueFrom, setFilterDueFrom] = useState('');
  const [filterDueTo, setFilterDueTo] = useState('');
  const [settleAmount, setSettleAmount] = useState('');
  const [settleDate, setSettleDate] = useState(new Date().toISOString().slice(0, 10));
  const [processing, setProcessing] = useState(false);
  const [deepLinkMissing, setDeepLinkMissing] = useState<string | null>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const allTaxes = useMemo(() => getTaxObligations(), [refreshKey]);

  useEffect(() => {
    if (!focusTaxId) return;
    const obligation = getTaxObligation(focusTaxId);
    if (obligation) { setDetailId(obligation.id); setDeepLinkMissing(null); }
    else setDeepLinkMissing(focusTaxId);
    router.replace(pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTaxId]);

  const filter: TaxFilter = useMemo(() => ({
    taxType: filterType,
    status: filterStatus,
    competenceMonth: filterCompetence || undefined,
    dueFrom: filterDueFrom || undefined,
    dueTo: filterDueTo || undefined,
  }), [filterType, filterStatus, filterCompetence, filterDueFrom, filterDueTo]);

  const filtered = useMemo(() => sortTaxesByDueDate(filterTaxes(allTaxes, filter), sortDir), [allTaxes, filter, sortDir]);

  const summary = useMemo(() => selectTaxSummary(filtered), [filtered]);
  const aging = useMemo(() => selectTaxAging(filtered), [filtered]);
  const byType = useMemo(() => selectTaxesByType(filtered), [filtered]);
  const projected = useMemo(() => selectProjectedTaxCashOut(filtered), [filtered]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const detail = useMemo(() => (detailId ? getTaxObligation(detailId) : undefined), [detailId, refreshKey]);
  const settlementEntries: LedgerEntry[] = useMemo(() => {
    if (!detail?.settlement_entry_ids?.length) return [];
    return detail.settlement_entry_ids
      .map(id => getLedgerEntry(id))
      .filter((e): e is LedgerEntry => !!e)
      .sort((a, b) => b.entry_date.localeCompare(a.entry_date));
  }, [detail]);
  // P&L accrual (competence recognition) — distinct from the clearing cash legs.
  const accrualEntry: LedgerEntry | undefined = useMemo(
    () => (detail?.accrual_entry_id ? getLedgerEntry(detail.accrual_entry_id) : undefined),
    [detail],
  );

  const competenceOptions = useMemo(() => {
    const set = new Set(allTaxes.map(x => x.competence_month));
    return [{ value: '', label: 'Todas' }, ...Array.from(set).sort().reverse().map(c => ({ value: c, label: c }))];
  }, [allTaxes]);

  const hasActiveFilters = !!(filterType !== 'all' || filterStatus !== 'all' || filterCompetence || filterDueFrom || filterDueTo);
  const clearFilters = () => {
    setFilterType('all'); setFilterStatus('all'); setFilterCompetence('');
    setFilterDueFrom(''); setFilterDueTo('');
  };

  const handleSettle = useCallback((obligation: TaxObligation, amountCents?: number) => {
    if (processing) return;
    if (obligation.status === 'paid' || obligation.status === 'cancelled') return;
    if (amountCents !== undefined && amountCents <= 0) return;
    setProcessing(true);
    try {
      recordTaxPayment(obligation.id, amountCents, settleDate);
      setSettleAmount('');
      setRefreshKey(k => k + 1);
    } finally {
      setProcessing(false);
    }
  }, [processing, settleDate]);

  const goToLedgerEntry = useCallback((entryId: string) => {
    router.push(`/financeiro/lancamentos?entryId=${encodeURIComponent(entryId)}`);
  }, [router]);

  const kpis: KpiItem[] = [
    { id: 'p', label: 'Provisionado', value: summary.totalProvisioned / 100, format: 'compactCurrency', variant: 'info' },
    { id: 'pd', label: 'Pago', value: summary.totalPaid / 100, format: 'compactCurrency', variant: 'success' },
    { id: 'o', label: 'Em aberto', value: summary.totalOpen / 100, format: 'compactCurrency', variant: 'warning' },
    { id: 'ov', label: 'Vencidos', value: summary.overdueTotal / 100, format: 'compactCurrency', variant: summary.overdueTotal > 0 ? 'danger' : 'success', icon: <AlertTriangle className="h-5 w-5" /> },
    { id: 'wk', label: 'Vence em 7 dias', value: summary.dueThisWeek / 100, format: 'compactCurrency', variant: summary.dueThisWeek > 0 ? 'warning' : 'success', icon: <Clock3 className="h-5 w-5" /> },
    { id: 'mo', label: 'Vence em 30 dias', value: summary.dueThisMonth / 100, format: 'compactCurrency', variant: 'info', icon: <Calendar className="h-5 w-5" /> },
  ];

  const columns: HudTableColumn<TaxObligation>[] = [
    { key: 'tax_type', header: 'Imposto', cell: (x) => (
      <div className="min-w-0">
        <span className="block truncate text-xs font-semibold text-ig-fg-strong">{x.tax_type}</span>
        <span className="block max-w-[280px] truncate text-[11px] text-ig-fg-muted">{x.title}</span>
      </div>
    ) },
    { key: 'competence_month', header: 'Competência', cell: (x) => <span className="font-mono text-xs text-ig-fg-muted">{x.competence_month}</span> },
    { key: 'due_date', header: t('dueDate'), cell: (x) => {
      const overdue = isTaxOverdue(x);
      return (
        <div className="flex flex-col">
          <span className={`font-mono text-xs ${overdue ? 'font-semibold text-ig-danger' : 'text-ig-fg-muted'}`}>{x.due_date}</span>
          {overdue && <span className="text-[10px] font-medium text-ig-danger">{daysOverdueTax(x)}d {t('overdue').toLowerCase()}</span>}
        </div>
      );
    } },
    { key: 'amount_cents', header: 'Provisionado', align: 'right', cell: (x) => <span className="block font-mono text-xs text-ig-fg-strong">{formatBRL(x.amount_cents)}</span> },
    { key: 'paid_amount_cents', header: 'Pago', align: 'right', cell: (x) => <span className="block font-mono text-xs text-ig-fg-muted">{formatBRL(x.paid_amount_cents)}</span> },
    { key: 'remaining', header: 'Em aberto', align: 'right', cell: (x) => <span className="block font-mono text-xs text-ig-fg-strong">{formatBRL(remainingTaxCents(x))}</span> },
    { key: 'status', header: 'Status', cell: (x) => (
      <div className="flex items-center gap-1.5">
        <HudStatusPill variant={isTaxOverdue(x) ? 'error' : STATUS_VARIANT[x.status]} size="sm">
          {isTaxOverdue(x) ? STATUS_LABEL.overdue : STATUS_LABEL[x.status]}
        </HudStatusPill>
        {x.linked_entry_id && <Link2 className="h-3 w-3 text-ig-accent" aria-label="Vinculado a lançamento" />}
      </div>
    ) },
  ];

  const donutData = byType.slice(0, 8).map((row, i) => ({
    name: row.tax_type,
    value: row.provisioned / 100,
    tone: (['accent', 'info', 'success', 'warning', 'danger', 'budget'] as const)[i % 6],
  }));

  return (
    <HudPageLayout>
      <HudHeader
        title="Impostos & Retenções"
        subtitle="Obrigações tributárias — apuração, vencimentos e liquidação"
        icon={<Wallet className="w-5 h-5" />}
        iconTint="#A855F7"
        breadcrumbs={[{ label: t('title'), href: '/financeiro' }, { label: 'Impostos & Retenções' }]}
        actions={
          <ExportReportButton
            size="md"
            variant="glass"
            permission="finance.export"
            fallbackPermission="finance.view"
            build={() => openFinanceReport({
              title: 'Impostos & Retenções',
              fileContext: 'impostos',
              context: 'Obrigações tributárias — apuração, vencimentos e liquidação',
              kpis: kpis.map((k) => kpiFromHud(k)),
              sections: [{
                title: 'Tributos por Tipo',
                charts: [{
                  title: 'Provisionado por tipo de tributo',
                  spec: { kind: 'donut', valueFmt: 'compactCurrency', slices: byType.slice(0, 8).map((r) => ({ label: r.tax_type, value: r.provisioned / 100 })) },
                }],
                tables: [{
                  title: 'Obrigações',
                  columns: [
                    { key: 'tipo', label: 'Tributo' },
                    { key: 'venc', label: 'Vencimento' },
                    { key: 'prov', label: 'Provisionado', num: true },
                    { key: 'pago', label: 'Pago', num: true },
                    { key: 'aberto', label: 'Em aberto', num: true },
                    { key: 'status', label: 'Status' },
                  ],
                  rows: filtered.slice(0, 150).map((x) => ({
                    tipo: x.tax_type,
                    venc: { html: `<span class="mono" style="${isTaxOverdue(x) ? 'color:#B91C1C;font-weight:700' : ''}">${x.due_date}</span>` },
                    prov: { html: `<span class="mono">${formatBRL(x.amount_cents)}</span>` },
                    pago: { html: `<span class="mono">${formatBRL(x.paid_amount_cents)}</span>` },
                    aberto: { html: `<span class="mono">${formatBRL(remainingTaxCents(x))}</span>` },
                    status: { html: `<span class="pill ${isTaxOverdue(x) ? 'crit' : x.status === 'paid' ? 'ok' : 'warn'}">${isTaxOverdue(x) ? 'vencido' : x.status}</span>` },
                  })),
                }],
              }],
            })}
          />
        }
      />

      {deepLinkMissing && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-[color-mix(in_oklab,var(--ig-warning)_28%,transparent)] bg-[color-mix(in_oklab,var(--ig-warning)_12%,transparent)] p-3">
          <AlertTriangle className="h-4 w-4 shrink-0 text-ig-warning" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-ig-warning">Obrigação <span className="font-mono">{deepLinkMissing}</span> não encontrada.</p>
          </div>
        </div>
      )}

      <HudKpiStrip kpis={kpis} columns={6} size="sm" />

      <div className="mt-4">
        <FinanceFilterBar
          showPeriod={false}
          showScenario={false}
          extra={
            <>
              <FinanceFilterChip
                icon={<Tag className="h-3.5 w-3.5" />}
                label="Tipo"
                value={filterType}
                onChange={(v) => setFilterType(v as TaxType | 'all')}
                options={[{ value: 'all', label: 'Todos' }, ...TAX_TYPES.map(tt => ({ value: tt, label: tt }))]}
              />
              <FinanceFilterChip
                icon={<Activity className="h-3.5 w-3.5" />}
                label="Status"
                value={filterStatus}
                onChange={(v) => setFilterStatus(v as TaxStatus | 'all')}
                options={[
                  { value: 'all', label: 'Todos' },
                  { value: 'open', label: STATUS_LABEL.open },
                  { value: 'scheduled', label: STATUS_LABEL.scheduled },
                  { value: 'partial', label: STATUS_LABEL.partial },
                  { value: 'paid', label: STATUS_LABEL.paid },
                  { value: 'overdue', label: STATUS_LABEL.overdue },
                  { value: 'cancelled', label: STATUS_LABEL.cancelled },
                ]}
              />
              <FinanceFilterChip
                icon={<Calendar className="h-3.5 w-3.5" />}
                label="Competência"
                value={filterCompetence}
                onChange={setFilterCompetence}
                options={competenceOptions}
              />
              <FinanceFilterDateField
                icon={<Calendar className="h-3.5 w-3.5" />}
                label="Vence de"
                value={filterDueFrom}
                onChange={setFilterDueFrom}
              />
              <FinanceFilterDateField
                icon={<Calendar className="h-3.5 w-3.5" />}
                label="Até"
                value={filterDueTo}
                onChange={setFilterDueTo}
              />
            </>
          }
          rightSlot={hasActiveFilters ? (
            <HudButton variant="ghost" size="sm" onClick={clearFilters}>Limpar</HudButton>
          ) : undefined}
        />
      </div>

      {/* Aging + projected cash-out */}
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[1fr_360px]">
        <HudPanel title="Aging tributário" subtitle="Saldo em aberto por bucket de vencimento" icon={<Clock3 className="h-4 w-4" />} sweep halo>
          <FinanceBarChart
            categories={aging.map(b => b.label)}
            series={[{ name: 'Em aberto', data: aging.map(b => b.amount / 100), tone: 'warning' }]}
            height={240}
          />
        </HudPanel>
        <HudPanel title="Composição" subtitle="Provisionado por imposto" icon={<Tag className="h-4 w-4" />} sweep>
          <FinanceDonutChart
            data={donutData}
            centerLabel="Provisionado"
            centerValue={fmtCompactBRL(summary.totalProvisioned / 100)}
            height={240}
          />
        </HudPanel>
      </div>

      {/* Projected cash-out + by type roll-up */}
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1fr]">
        <HudPanel title="Cash-out tributário projetado" subtitle="Por mês de vencimento — obrigações em aberto" icon={<ArrowUpRight className="h-4 w-4" />} sweep>
          {projected.length === 0 ? (
            <p className="text-xs text-ig-fg-muted">Sem obrigações em aberto para os filtros atuais.</p>
          ) : (
            <FinanceBarChart
              categories={projected.map(p => p.month)}
              series={[{ name: 'Projeção', data: projected.map(p => p.amount / 100), tone: 'danger' }]}
              height={220}
            />
          )}
        </HudPanel>
        <HudPanel title="Provisionado × Pago por imposto" subtitle="Roll-up por tipo de tributo" icon={<Tag className="h-4 w-4" />} sweep>
          {byType.length === 0 ? (
            <p className="text-xs text-ig-fg-muted">Sem dados para os filtros atuais.</p>
          ) : (
            <FinanceBarChart
              categories={byType.map(r => r.tax_type)}
              series={[
                { name: 'Pago', data: byType.map(r => r.paid / 100), tone: 'success' },
                { name: 'Em aberto', data: byType.map(r => r.open / 100), tone: 'warning' },
              ]}
              height={220}
            />
          )}
        </HudPanel>
      </div>

      {/* Obligations table */}
      <div className="mt-4">
        <HudPanel
          noPadding
          title="Apuração tributária"
          subtitle={`${filtered.length} obrigação(ões) • ${summary.activeCount} ativa(s) • ${summary.overdueCount} vencida(s)`}
          icon={<Wallet className="h-4 w-4" />}
          sweep
          headerActions={
            <HudButton variant="ghost" size="sm" leftIcon={<ArrowUpDown className="w-4 h-4" />} onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}>
              {t('dueDate')} {sortDir === 'asc' ? '↑' : '↓'}
            </HudButton>
          }
        >
          <HudTable
            columns={columns}
            data={filtered}
            keyExtractor={(x) => x.id}
            onRowClick={(x) => setDetailId(x.id)}
            selectedRowId={detailId}
            compact
            stickyHeader
          />
        </HudPanel>
      </div>

      {/* Detail drawer */}
      <HudDrawer isOpen={!!detailId} onClose={() => setDetailId(null)} title="Detalhe da obrigação" width="md">
        {detail && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[10px] uppercase text-ig-fg-subtle">Imposto</p>
                <p className="font-mono text-sm text-ig-fg-strong">{detail.tax_type}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase text-ig-fg-subtle">Status</p>
                <HudStatusPill variant={isTaxOverdue(detail) ? 'error' : STATUS_VARIANT[detail.status]} size="sm">
                  {isTaxOverdue(detail) ? STATUS_LABEL.overdue : STATUS_LABEL[detail.status]}
                </HudStatusPill>
              </div>
            </div>

            <div>
              <p className="text-[10px] uppercase text-ig-fg-subtle">{t('description')}</p>
              <p className="text-sm text-ig-fg-strong">{detail.title}</p>
              {detail.description && <p className="mt-1 text-xs text-ig-fg-muted">{detail.description}</p>}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[10px] uppercase text-ig-fg-subtle">Competência</p>
                <p className="font-mono text-sm text-ig-fg-strong">{detail.competence_month}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase text-ig-fg-subtle">{t('dueDate')}</p>
                <p className={`font-mono text-sm ${isTaxOverdue(detail) ? 'font-semibold text-ig-danger' : 'text-ig-fg-strong'}`}>{detail.due_date}</p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div><p className="text-[10px] uppercase text-ig-fg-subtle">Provisionado</p><p className="font-mono text-sm text-ig-fg-strong">{formatBRL(detail.amount_cents)}</p></div>
              <div><p className="text-[10px] uppercase text-ig-fg-subtle">Pago</p><p className="font-mono text-sm text-ig-fg-muted">{formatBRL(detail.paid_amount_cents)}</p></div>
              <div><p className="text-[10px] uppercase text-ig-fg-subtle">Em aberto</p><p className="font-mono text-sm text-ig-fg-strong">{formatBRL(remainingTaxCents(detail))}</p></div>
            </div>

            {(detail.client?.name || detail.invoice_number) && (
              <div className="rounded-lg border border-ig-border-subtle bg-ig-panel/40 p-3 text-xs">
                {detail.client?.name && <p><span className="text-ig-fg-subtle">Cliente: </span><span className="text-ig-fg-strong">{detail.client.name}</span></p>}
                {detail.invoice_number && <p><span className="text-ig-fg-subtle">NF/Doc: </span><span className="font-mono text-ig-fg-strong">{detail.invoice_number}</span></p>}
                {detail.contract_id && <p><span className="text-ig-fg-subtle">Contrato: </span><span className="font-mono text-ig-fg-strong">{detail.contract_id}</span></p>}
                {detail.notes && <p className="mt-1 text-ig-fg-muted">{detail.notes}</p>}
              </div>
            )}

            {isTaxOverdue(detail) && (
              <div className="flex items-center gap-2 rounded-lg border border-[color-mix(in_oklab,var(--ig-danger)_28%,transparent)] bg-[color-mix(in_oklab,var(--ig-danger)_10%,transparent)] px-3 py-2">
                <AlertTriangle className="h-4 w-4 text-ig-danger" />
                <span className="text-xs font-medium text-ig-danger">{daysOverdueTax(detail)} {t('overdue').toLowerCase()}</span>
              </div>
            )}

            {/* Accrual recognition (P&L competence) — separate from cash settlement */}
            <div className="rounded-lg border border-ig-border-subtle bg-ig-panel/40 p-3">
              <p className="text-[10px] uppercase text-ig-fg-subtle">Lançamento de competência (accrual)</p>
              {!accrualEntry ? (
                <p className="mt-1 text-sm text-ig-fg-muted">Sem lançamento de competência vinculado.</p>
              ) : (
                <button
                  type="button"
                  onClick={() => goToLedgerEntry(accrualEntry.id)}
                  title={t('viewLinkedEntry')}
                  className="mt-2 flex w-full items-center justify-between gap-2 rounded-md px-1 py-1.5 text-left transition-colors hover:bg-ig-panel/60 focus:bg-ig-panel/60 focus:outline-none"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <Link2 className="h-3 w-3 shrink-0 text-ig-accent" />
                    <span className="truncate text-xs text-ig-fg-strong">{accrualEntry.entry_date}</span>
                    <span className="text-[10px] uppercase tracking-[0.12em] text-ig-fg-subtle">Competência</span>
                  </div>
                  <span className="shrink-0 font-mono text-xs font-semibold text-ig-fg-strong">{formatBRL(accrualEntry.amount_cents)}</span>
                </button>
              )}
            </div>

            {/* Settlement history */}
            <div className="rounded-lg border border-ig-border-subtle bg-ig-panel/40 p-3">
              <div className="flex items-center justify-between">
                <p className="text-[10px] uppercase text-ig-fg-subtle">{t('settlementHistory')}</p>
                {settlementEntries.length > 0 && <HudBadge variant="default" size="sm">{settlementEntries.length}</HudBadge>}
              </div>
              {settlementEntries.length === 0 ? (
                <p className="mt-1 text-sm text-ig-fg-muted">{t('noLinkedEntry')}</p>
              ) : (
                <ul className="mt-2 divide-y divide-ig-border-subtle/60">
                  {settlementEntries.map((e) => (
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
                          <span className="text-[10px] uppercase tracking-[0.12em] text-ig-fg-subtle">{t('cashOut')}</span>
                        </div>
                        <span className="shrink-0 font-mono text-xs font-semibold text-ig-danger">−{formatBRL(e.amount_cents)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Settlement actions */}
            {detail.status !== 'paid' && detail.status !== 'cancelled' ? (
              (() => {
                const remaining = remainingTaxCents(detail);
                const parsed = settleAmount ? reaisToCents(parseFloat(settleAmount)) : 0;
                const partialValid = parsed > 0 && parsed <= remaining;
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
                        {t('fullPayment')}
                      </HudButton>
                    </div>
                  </div>
                );
              })()
            ) : (
              <div className="border-t border-ig-border-subtle pt-4">
                <HudBadge variant="default" size="sm">{STATUS_LABEL[detail.status]}</HudBadge>
              </div>
            )}
          </div>
        )}
      </HudDrawer>

      {/* Footer KPI tile */}
      <div className="mt-4 text-right text-[10.5px] text-ig-text-tertiary">
        Total provisionado nos filtros: <span className="font-mono">{fmtBRL(summary.totalProvisioned / 100)}</span> • pago <span className="font-mono">{fmtBRL(summary.totalPaid / 100)}</span>
      </div>
    </HudPageLayout>
  );
}
