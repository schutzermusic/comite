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

export default function BancosPage() {
  const t = useTranslations('finance');

  const entries = useMemo(() =>
    getLedgerEntries().filter(e => e.category?.group_key === 'financial' && e.entry_type === 'actual'), []
  );

  const totalFees = entries.filter(e => e.category?.code?.startsWith('D.1.2') || e.category?.code?.startsWith('D.1.3')).reduce((s, e) => s + e.amount_cents, 0);
  const totalInterest = entries.filter(e => e.category?.code?.startsWith('D.1.1') || e.category?.code?.startsWith('D.2')).reduce((s, e) => s + e.amount_cents, 0);
  const totalFinancial = entries.reduce((s, e) => s + e.amount_cents, 0);

  const kpis: KpiItem[] = [
    { id: 'fees', label: t('totalFeesMonth'), value: formatCompactBRL(Math.abs(totalFees)), icon: <CreditCard className="w-5 h-5" /> },
    { id: 'interest', label: t('totalInterestMonth'), value: formatCompactBRL(Math.abs(totalInterest)), icon: <TrendingDown className="w-5 h-5" /> },
    { id: 'total', label: t('financialCosts'), value: formatCompactBRL(Math.abs(totalFinancial)), icon: <Landmark className="w-5 h-5" /> },
  ];

  const columns: HudTableColumn<LedgerEntry>[] = [
    { key: 'entry_date', header: t('entryDate'), cell: (e) => <span className="text-white/70 text-xs font-mono">{e.entry_date}</span> },
    { key: 'description', header: t('description'), cell: (e) => <span className="text-white/80 text-xs">{e.description}</span> },
    { key: 'category', header: t('category'), cell: (e) => <span className="text-white/50 text-xs">{e.category?.name || '—'}</span> },
    { key: 'amount_cents', header: t('amount'), cell: (e) => <span className="text-white/80 text-xs font-mono">{formatBRL(e.amount_cents)}</span> },
    { key: 'status', header: 'Status', cell: (e) => <HudStatusPill variant={e.status === 'posted' ? 'completed' : 'pending'} size="sm">{e.status}</HudStatusPill> },
    { key: 'source_ref', header: 'Ref. Extrato', cell: (e) => <span className="text-white/40 text-xs">{e.source_ref || '—'}</span> },
  ];

  return (
    <HudPageLayout>
      <HudHeader title={t('banks')} icon={<Landmark className="w-5 h-5" />}
        iconTint="#14B8A6"
        breadcrumbs={[{ label: t('title'), href: '/financeiro' }, { label: t('banks') }]} />
      <HudKpiStrip kpis={kpis} columns={3} />
      <div className="mt-4">
        <HudTable columns={columns} data={entries} keyExtractor={(e) => e.id} compact stickyHeader />
      </div>
    </HudPageLayout>
  );
}
