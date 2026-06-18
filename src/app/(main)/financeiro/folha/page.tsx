'use client';

import { useState, useMemo, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { FileSpreadsheet, Plus, CheckCircle, Users } from 'lucide-react';
import {
  HudPageLayout, HudHeader, HudKpiStrip, HudTable, HudButton,
  HudStatusPill, HudDrawer, HudInput, HudSelect, HudEmptyState,
  type KpiItem, type HudTableColumn,
} from '@/components/hud';
import {
  getPayrollBatches, createPayrollBatch, approvePayrollBatch,
  getBusinessUnits, formatBRL, formatCompactBRL, reaisToCents,
  hydratePayrollBatchesFromServer,
} from '@/lib/finance/finance-store';
import type { PayrollBatch } from '@/lib/types/finance';
import { ExportReportButton } from '@/components/reports/ExportReportButton';
import { openFinanceReport, kpiFromHud } from '@/lib/reports/modules/finance-report';

const STATUS_VARIANTS: Record<string, string> = { draft: 'pending', approved: 'info', posted: 'completed' };

export default function FolhaPage() {
  const t = useTranslations('finance');
  const [selectedPeriod, setSelectedPeriod] = useState('2026-03');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Pull persisted Supabase PayrollBatch records into the in-memory store so
  // batches sent from the payroll closing survive a reload. No-op in mock mode;
  // failures keep the existing in-memory batches (fallback).
  useEffect(() => {
    hydratePayrollBatchesFromServer().then((added) => { if (added > 0) setRefreshKey((k) => k + 1); });
  }, []);

  const [formPeriod, setFormPeriod] = useState('2026-03');
  const [formBU, setFormBU] = useState('');
  const [formGross, setFormGross] = useState('');
  const [formCharges, setFormCharges] = useState('');
  const [formBenefits, setFormBenefits] = useState('');
  const [formHeadcount, setFormHeadcount] = useState('');
  const [formNotes, setFormNotes] = useState('');

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const batches = useMemo(() => getPayrollBatches(selectedPeriod), [selectedPeriod, refreshKey]);

  const totalGross = batches.reduce((s, b) => s + b.total_gross_cents, 0);
  const totalCharges = batches.reduce((s, b) => s + b.total_charges_cents, 0);
  const totalBenefits = batches.reduce((s, b) => s + b.total_benefits_cents, 0);
  const totalHeadcount = batches.reduce((s, b) => s + b.headcount, 0);

  const kpis: KpiItem[] = [
    { id: 'gross', label: t('grossSalary'), value: totalGross / 100, format: 'compactCurrency', icon: <FileSpreadsheet className="w-5 h-5" /> },
    { id: 'charges', label: t('charges'), value: totalCharges / 100, format: 'compactCurrency' },
    { id: 'benefits', label: t('benefits'), value: totalBenefits / 100, format: 'compactCurrency' },
    { id: 'total', label: t('totalPayroll'), value: (totalGross + totalCharges + totalBenefits) / 100, format: 'compactCurrency', icon: <Users className="w-5 h-5" /> },
    { id: 'hc', label: t('headcount'), value: totalHeadcount, icon: <Users className="w-5 h-5" /> },
  ];

  const columns: HudTableColumn<PayrollBatch>[] = [
    { key: 'period_key', header: t('period'), cell: (b) => <span className="text-ig-text-secondary text-xs font-mono">{b.period_key}</span> },
    { key: 'business_unit_id', header: t('businessUnit'), cell: (b) => <span className="text-ig-text-secondary text-xs">{b.business_unit?.name || b.business_unit_id}</span> },
    { key: 'total_gross_cents', header: t('grossSalary'), cell: (b) => <span className="text-ig-text-primary text-xs font-mono">{formatBRL(b.total_gross_cents)}</span> },
    { key: 'total_charges_cents', header: t('charges'), cell: (b) => <span className="text-ig-text-primary text-xs font-mono">{formatBRL(b.total_charges_cents)}</span> },
    { key: 'total_benefits_cents', header: t('benefits'), cell: (b) => <span className="text-ig-text-primary text-xs font-mono">{formatBRL(b.total_benefits_cents)}</span> },
    { key: 'headcount', header: t('headcount'), cell: (b) => <span className="text-ig-text-secondary text-xs">{b.headcount}</span> },
    { key: 'status', header: 'Status', cell: (b) => <HudStatusPill variant={STATUS_VARIANTS[b.status] as any} size="sm">{b.status}</HudStatusPill> },
    { key: 'actions', header: '', cell: (b) => b.status === 'draft' ? (
      <HudButton variant="ghost" size="sm" leftIcon={<CheckCircle className="w-3.5 h-3.5" />} onClick={(e) => { e.stopPropagation(); approvePayrollBatch(b.id); setRefreshKey(k => k + 1); }}>
        Aprovar
      </HudButton>
    ) : null },
  ];

  const handleSave = () => {
    if (!formBU || !formGross || !formCharges || !formBenefits || !formHeadcount) return;
    createPayrollBatch({
      period_key: formPeriod,
      business_unit_id: formBU,
      total_gross_cents: reaisToCents(parseFloat(formGross)),
      total_charges_cents: reaisToCents(parseFloat(formCharges)),
      total_benefits_cents: reaisToCents(parseFloat(formBenefits)),
      headcount: parseInt(formHeadcount),
      notes: formNotes,
    });
    setDrawerOpen(false);
    setRefreshKey(k => k + 1);
  };

  return (
    <HudPageLayout>
      <HudHeader
        title={t('payroll')}
        subtitle={`Período: ${selectedPeriod}`}
        icon={<FileSpreadsheet className="w-5 h-5" />}
        iconTint="#14B8A6"
        breadcrumbs={[{ label: t('title'), href: '/financeiro' }, { label: t('payroll') }]}
        actions={
          <div className="flex items-center gap-3">
            <HudSelect label="" value={selectedPeriod} onChange={setSelectedPeriod} size="sm"
              options={[{ value: '2026-01', label: 'Jan/2026' }, { value: '2026-02', label: 'Fev/2026' }, { value: '2026-03', label: 'Mar/2026' }]} />
            <ExportReportButton
              size="md"
              variant="glass"
              permission="finance.export"
              fallbackPermission="finance.view"
              build={() => openFinanceReport({
                title: 'Folha de Pagamento',
                fileContext: 'folha',
                periodLabel: selectedPeriod,
                context: `Lotes de folha do período <b>${selectedPeriod}</b>`,
                kpis: kpis.map((k) => kpiFromHud(k)),
                sections: [{
                  title: 'Lotes de Folha',
                  tables: [{
                    columns: [
                      { key: 'periodo', label: 'Período' },
                      { key: 'bu', label: 'Unidade' },
                      { key: 'gross', label: 'Salário Bruto', num: true },
                      { key: 'charges', label: 'Encargos', num: true },
                      { key: 'benefits', label: 'Benefícios', num: true },
                      { key: 'hc', label: 'Headcount', num: true },
                      { key: 'status', label: 'Status' },
                    ],
                    rows: batches.map((b) => ({
                      periodo: { html: `<span class="mono">${b.period_key}</span>` },
                      bu: b.business_unit?.name || b.business_unit_id,
                      gross: { html: `<span class="mono">${formatBRL(b.total_gross_cents)}</span>` },
                      charges: { html: `<span class="mono">${formatBRL(b.total_charges_cents)}</span>` },
                      benefits: { html: `<span class="mono">${formatBRL(b.total_benefits_cents)}</span>` },
                      hc: String(b.headcount),
                      status: { html: `<span class="pill ${b.status === 'posted' ? 'ok' : b.status === 'approved' ? 'info' : 'warn'}">${b.status}</span>` },
                    })),
                  }],
                }],
              })}
            />
            <HudButton variant="primary" leftIcon={<Plus className="w-4 h-4" />} onClick={() => setDrawerOpen(true)}>
              {t('newPayrollBatch')}
            </HudButton>
          </div>
        }
      />
      <HudKpiStrip kpis={kpis} columns={3} />
      <div className="mt-4">
        {batches.length === 0 ? (
          <HudEmptyState title="Nenhum lote de folha para este período" description="Crie um novo lote de folha de pagamento." icon="file"
            action={{ label: t('newPayrollBatch'), onClick: () => setDrawerOpen(true) }} />
        ) : (
          <HudTable columns={columns} data={batches} keyExtractor={(b) => b.id} compact stickyHeader />
        )}
      </div>

      <HudDrawer isOpen={drawerOpen} onClose={() => setDrawerOpen(false)} title={t('newPayrollBatch')} width="md">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <HudInput label={t('period')} type="month" value={formPeriod} onChange={(e) => setFormPeriod(e.target.value)} />
            <HudSelect label={t('businessUnit')} value={formBU} onChange={setFormBU}
              options={[{ value: '', label: t('selectBusinessUnit') }, ...getBusinessUnits().map(b => ({ value: b.id, label: b.name }))]} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <HudInput label={t('grossSalary')} type="number" value={formGross} onChange={(e) => setFormGross(e.target.value)} />
            <HudInput label={t('charges')} type="number" value={formCharges} onChange={(e) => setFormCharges(e.target.value)} />
            <HudInput label={t('benefits')} type="number" value={formBenefits} onChange={(e) => setFormBenefits(e.target.value)} />
          </div>
          <HudInput label={t('headcount')} type="number" value={formHeadcount} onChange={(e) => setFormHeadcount(e.target.value)} />
          <HudInput label={t('notes')} value={formNotes} onChange={(e) => setFormNotes(e.target.value)} />
          <div className="flex gap-3 pt-4">
            <HudButton variant="secondary" onClick={() => setDrawerOpen(false)} fullWidth>Cancelar</HudButton>
            <HudButton variant="primary" onClick={handleSave} fullWidth>Salvar</HudButton>
          </div>
        </div>
      </HudDrawer>
    </HudPageLayout>
  );
}
