'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Landmark, TrendingDown, CreditCard } from 'lucide-react';
import {
  HudPageLayout, HudHeader, HudKpiStrip, HudTable, HudStatusPill,
  type KpiItem, type HudTableColumn,
} from '@/components/hud';
import { getLedgerEntries, formatBRL, formatCompactBRL } from '@/lib/finance/finance-store';
import type { LedgerEntry } from '@/lib/types/finance';
import { ExportReportButton } from '@/components/reports/ExportReportButton';
import { openFinanceReport, kpiFromHud } from '@/lib/reports/modules/finance-report';

export default function BancosPage() {
  const t = useTranslations('finance');

  const entries = useMemo(() =>
    getLedgerEntries().filter(e => e.category?.group_key === 'financial' && e.entry_type === 'actual'), []
  );

  const totalFees = entries.filter(e => e.category?.code?.startsWith('D.1.2') || e.category?.code?.startsWith('D.1.3')).reduce((s, e) => s + e.amount_cents, 0);
  const totalInterest = entries.filter(e => e.category?.code?.startsWith('D.1.1') || e.category?.code?.startsWith('D.2')).reduce((s, e) => s + e.amount_cents, 0);
  const totalFinancial = entries.reduce((s, e) => s + e.amount_cents, 0);

  const kpis: KpiItem[] = [
    { id: 'fees', label: t('totalFeesMonth'), value: Math.abs(totalFees) / 100, format: 'compactCurrency', icon: <CreditCard className="w-5 h-5" /> },
    { id: 'interest', label: t('totalInterestMonth'), value: Math.abs(totalInterest) / 100, format: 'compactCurrency', icon: <TrendingDown className="w-5 h-5" /> },
    { id: 'total', label: t('financialCosts'), value: Math.abs(totalFinancial) / 100, format: 'compactCurrency', icon: <Landmark className="w-5 h-5" /> },
  ];

  const columns: HudTableColumn<LedgerEntry>[] = [
    { key: 'entry_date', header: t('entryDate'), cell: (e) => <span className="text-ig-text-secondary text-xs font-mono">{e.entry_date}</span> },
    { key: 'description', header: t('description'), cell: (e) => <span className="text-ig-text-primary text-xs">{e.description}</span> },
    { key: 'category', header: t('category'), cell: (e) => <span className="text-ig-text-primary/50 text-xs">{e.category?.name || '—'}</span> },
    { key: 'amount_cents', header: t('amount'), cell: (e) => <span className="text-ig-text-primary text-xs font-mono">{formatBRL(e.amount_cents)}</span> },
    { key: 'status', header: 'Status', cell: (e) => <HudStatusPill variant={e.status === 'posted' ? 'completed' : 'pending'} size="sm">{e.status}</HudStatusPill> },
    { key: 'source_ref', header: 'Ref. Extrato', cell: (e) => <span className="text-ig-text-tertiary text-xs">{e.source_ref || '—'}</span> },
  ];

  return (
    <HudPageLayout>
      <HudHeader title={t('banks')} icon={<Landmark className="w-5 h-5" />}
        iconTint="#14B8A6"
        breadcrumbs={[{ label: t('title'), href: '/financeiro' }, { label: t('banks') }]}
        actions={
          <ExportReportButton
            size="md"
            variant="glass"
            permission="finance.export"
            fallbackPermission="finance.view"
            build={() => openFinanceReport({
              title: 'Bancos & Custos Financeiros',
              fileContext: 'bancos',
              context: 'Tarifas, juros e custos financeiros do período',
              kpis: kpis.map((k) => kpiFromHud(k)),
              sections: [{
                title: 'Lançamentos Financeiros',
                tables: [{
                  columns: [
                    { key: 'data', label: 'Data' },
                    { key: 'desc', label: 'Descrição' },
                    { key: 'cat', label: 'Categoria' },
                    { key: 'valor', label: 'Valor', num: true },
                    { key: 'status', label: 'Status' },
                    { key: 'ref', label: 'Ref. Extrato' },
                  ],
                  rows: entries.slice(0, 120).map((e) => ({
                    data: { html: `<span class="mono">${e.entry_date}</span>` },
                    desc: e.description,
                    cat: e.category?.name || '—',
                    valor: { html: `<span class="mono">${formatBRL(e.amount_cents)}</span>` },
                    status: { html: `<span class="pill ${e.status === 'posted' ? 'ok' : 'warn'}">${e.status}</span>` },
                    ref: e.source_ref || '—',
                  })),
                }],
              }],
            })}
          />
        } />
      <HudKpiStrip kpis={kpis} columns={3} />
      <div className="mt-4">
        <HudTable columns={columns} data={entries} keyExtractor={(e) => e.id} compact stickyHeader />
      </div>
    </HudPageLayout>
  );
}
