'use client';

import { useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Wallet, FileText, ArrowDownUp } from 'lucide-react';
import {
  HudPageLayout, HudHeader, HudKpiStrip, HudTable, HudStatusPill,
  type KpiItem, type HudTableColumn,
} from '@/components/hud';
import { getLedgerEntries, formatBRL, formatCompactBRL } from '@/lib/finance/finance-store';
import type { LedgerEntry } from '@/lib/types/finance';

const TAB_OPTIONS = [
  { value: 'provisions', label: 'Provisões' },
  { value: 'payments', label: 'Pagamentos' },
];

export default function TributosPage() {
  const t = useTranslations('finance');
  const [activeTab, setActiveTab] = useState('provisions');

  const taxEntries = useMemo(() =>
    getLedgerEntries().filter(e => e.category?.group_key === 'taxes' && e.entry_type === 'actual'), []
  );

  const provisions = taxEntries.filter(e => !e.template_key?.includes('payment'));
  const payments = taxEntries.filter(e => e.template_key?.includes('payment'));

  const totalProvisioned = provisions.reduce((s, e) => s + e.amount_cents, 0);
  const totalPaid = payments.reduce((s, e) => s + e.amount_cents, 0);
  const difference = totalProvisioned - totalPaid;

  const kpis: KpiItem[] = [
    { id: 'prov', label: t('totalProvisioned'), value: formatCompactBRL(Math.abs(totalProvisioned)), icon: <FileText className="w-5 h-5" /> },
    { id: 'paid', label: t('totalPaid'), value: formatCompactBRL(Math.abs(totalPaid)), icon: <Wallet className="w-5 h-5" /> },
    { id: 'diff', label: t('difference'), value: formatCompactBRL(Math.abs(difference)), variant: difference === 0 ? 'success' : 'danger', icon: <ArrowDownUp className="w-5 h-5" /> },
  ];

  const currentData = activeTab === 'provisions' ? provisions : payments;

  const columns: HudTableColumn<LedgerEntry>[] = [
    { key: 'entry_date', header: t('entryDate'), cell: (e) => <span className="text-white/70 text-xs font-mono">{e.entry_date}</span> },
    { key: 'description', header: t('description'), cell: (e) => <span className="text-white/80 text-xs">{e.description}</span> },
    { key: 'category', header: t('category'), cell: (e) => <span className="text-white/50 text-xs">{e.category?.name || '—'}</span> },
    { key: 'amount_cents', header: t('amount'), cell: (e) => <span className="text-white/80 text-xs font-mono">{formatBRL(e.amount_cents)}</span> },
    { key: 'status', header: 'Status', cell: (e) => <HudStatusPill variant={e.status === 'posted' ? 'completed' : 'pending'} size="sm">{e.status}</HudStatusPill> },
  ];

  return (
    <HudPageLayout>
      <HudHeader title={t('taxes')} icon={<Wallet className="w-5 h-5" />}
        breadcrumbs={[{ label: t('title'), href: '/financeiro' }, { label: t('taxes') }]} />
      <HudKpiStrip kpis={kpis} columns={3} />
      <div className="flex gap-1.5 mt-4">
        {TAB_OPTIONS.map(tab => (
          <button key={tab.value} onClick={() => setActiveTab(tab.value)}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-medium uppercase tracking-wider transition-all ${
              activeTab === tab.value
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                : 'bg-white/[0.04] text-white/40 border border-white/[0.06] hover:bg-white/[0.06]'
            }`}>
            {tab.label}
          </button>
        ))}
      </div>
      <div className="mt-4">
        <HudTable columns={columns} data={currentData} keyExtractor={(e) => e.id} compact stickyHeader />
      </div>
    </HudPageLayout>
  );
}
