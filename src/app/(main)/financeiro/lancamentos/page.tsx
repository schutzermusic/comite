'use client';

import { useState, useMemo, useCallback, Suspense } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import {
  Receipt, Plus, Eye, CheckCircle, XCircle,
  Send, FileText,
} from 'lucide-react';
import {
  HudPageLayout, HudHeader, HudFilterBar, HudTable,
  HudButton, HudStatusPill, HudDrawer, HudInput, HudSelect,
  HudEmptyState, HudModal, HudBadge,
  type HudTableColumn,
} from '@/components/hud';
import {
  getLedgerEntries, createLedgerEntry, transitionEntryStatus,
  formatBRL, getCostCenters, getBusinessUnits, getSuppliers,
  reaisToCents, getCategories,
} from '@/lib/finance/finance-store';
import { entryTemplates, managementCategories } from '@/data/finance/seed-categories';
import type { LedgerEntry, LedgerEntryStatus } from '@/lib/types/finance';

const STATUS_MAP: Record<string, { label: string; variant: string }> = {
  draft: { label: 'Rascunho', variant: 'pending' },
  in_review: { label: 'Em Revisão', variant: 'warning' },
  approved: { label: 'Aprovado', variant: 'info' },
  posted: { label: 'Postado', variant: 'completed' },
  reconciled: { label: 'Reconciliado', variant: 'active' },
  void: { label: 'Anulado', variant: 'error' },
};

const TAB_OPTIONS = [
  { value: 'all', label: 'Todos' },
  { value: 'draft', label: 'Rascunhos' },
  { value: 'in_review', label: 'Em Revisão' },
  { value: 'approved', label: 'Aprovados' },
  { value: 'void', label: 'Anulados' },
];

export default function LancamentosPage() {
  return (
    <Suspense>
      <LancamentosContent />
    </Suspense>
  );
}

function LancamentosContent() {
  const t = useTranslations('finance');
  const searchParams = useSearchParams();
  const initialTab = searchParams.get('tab') || 'all';

  const [activeTab, setActiveTab] = useState(initialTab);
  const [searchTerm, setSearchTerm] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [detailDrawerOpen, setDetailDrawerOpen] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<LedgerEntry | null>(null);
  const [voidModalOpen, setVoidModalOpen] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  const [formTemplate, setFormTemplate] = useState('');
  const [formDate, setFormDate] = useState(new Date().toISOString().slice(0, 10));
  const [formDescription, setFormDescription] = useState('');
  const [formAmount, setFormAmount] = useState('');
  const [formEntryType, setFormEntryType] = useState('actual');
  const [formCategoryL1, setFormCategoryL1] = useState('');
  const [formCategoryL2, setFormCategoryL2] = useState('');
  const [formCategoryL3, setFormCategoryL3] = useState('');
  const [formCostCenter, setFormCostCenter] = useState('');
  const [formProject, setFormProject] = useState('');
  const [formSupplier, setFormSupplier] = useState('');
  const [formBusinessUnit, setFormBusinessUnit] = useState('bu-rj');
  const [formNotes, setFormNotes] = useState('');

  const statusFilter = activeTab === 'all' ? undefined : activeTab as LedgerEntryStatus;
  const entries = useMemo(() => {
    let result = getLedgerEntries(undefined, statusFilter);
    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      result = result.filter(e => e.description.toLowerCase().includes(lower) || e.category?.name?.toLowerCase().includes(lower));
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, searchTerm, refreshKey]);

  const categories = getCategories();
  const l1Cats = categories.filter(c => c.level === 1);
  const l2Cats = useMemo(() => categories.filter(c => c.level === 2 && c.parent_id === formCategoryL1), [formCategoryL1]);
  const l3Cats = useMemo(() => categories.filter(c => c.level === 3 && c.parent_id === formCategoryL2), [formCategoryL2]);

  const columns: HudTableColumn<LedgerEntry>[] = [
    { key: 'entry_date', header: t('entryDate'), cell: (e) => <span className="text-white/70 text-xs font-mono">{e.entry_date}</span> },
    { key: 'description', header: t('description'), cell: (e) => <span className="text-white/80 text-xs truncate max-w-[200px] block">{e.description}</span> },
    { key: 'category', header: t('category'), cell: (e) => <span className="text-white/50 text-xs">{e.category?.name || '—'}</span> },
    { key: 'project_id', header: t('project'), cell: (e) => <span className="text-white/50 text-xs">{e.project_id?.slice(0, 10) || '—'}</span> },
    { key: 'amount_cents', header: t('amount'), cell: (e) => <span className="text-white/80 text-xs font-mono text-right block">{formatBRL(e.amount_cents)}</span> },
    { key: 'status', header: 'Status', cell: (e) => (
      <HudStatusPill variant={STATUS_MAP[e.status]?.variant as any || 'pending'} size="sm">
        {STATUS_MAP[e.status]?.label || e.status}
      </HudStatusPill>
    )},
    { key: 'source_system', header: t('origin'), cell: (e) => <HudBadge variant="default" size="sm">{e.source_system}</HudBadge> },
  ];

  const resetForm = () => {
    setFormTemplate(''); setFormDate(new Date().toISOString().slice(0, 10)); setFormDescription('');
    setFormAmount(''); setFormEntryType('actual'); setFormCategoryL1(''); setFormCategoryL2('');
    setFormCategoryL3(''); setFormCostCenter(''); setFormProject(''); setFormSupplier('');
    setFormBusinessUnit('bu-rj'); setFormNotes('');
  };

  const handleTemplateChange = (key: string) => {
    setFormTemplate(key);
    const tpl = entryTemplates.find(tp => tp.key === key);
    if (tpl) {
      const cat = managementCategories.find(c => c.code === tpl.category_code);
      if (cat) {
        setFormCategoryL3(cat.id);
        const l2 = managementCategories.find(c => c.id === cat.parent_id);
        if (l2) { setFormCategoryL2(l2.id); const l1p = managementCategories.find(c => c.id === l2.parent_id); if (l1p) setFormCategoryL1(l1p.id); }
      }
      setFormDescription(tpl.label);
    }
  };

  const handleSave = () => {
    if (!formDescription || !formAmount || !formBusinessUnit) return;
    createLedgerEntry({
      entry_date: formDate,
      description: formDescription,
      amount_cents: reaisToCents(parseFloat(formAmount)),
      entry_type: formEntryType as any,
      category_id: formCategoryL3 || formCategoryL2 || formCategoryL1,
      cost_center_id: formCostCenter,
      project_id: formProject || undefined,
      supplier_id: formSupplier || undefined,
      business_unit_id: formBusinessUnit,
      template_key: formTemplate || undefined,
      source_system: 'manual',
    });
    setDrawerOpen(false);
    resetForm();
    setRefreshKey(k => k + 1);
  };

  const handleTransition = useCallback((id: string, status: LedgerEntryStatus, reason?: string) => {
    transitionEntryStatus(id, status, reason);
    setRefreshKey(k => k + 1);
    setDetailDrawerOpen(false);
    setVoidModalOpen(false);
    setVoidReason('');
  }, []);

  return (
    <HudPageLayout>
      <HudHeader
        title={t('ledgerEntries')}
        subtitle={`${entries.length} lançamentos`}
        icon={<Receipt className="w-5 h-5" />}
        iconTint="#14B8A6"
        breadcrumbs={[{ label: t('title'), href: '/financeiro' }, { label: t('ledgerEntries') }]}
        actions={
          <HudButton variant="primary" leftIcon={<Plus className="w-4 h-4" />} onClick={() => { resetForm(); setDrawerOpen(true); }}>
            {t('newEntry')}
          </HudButton>
        }
      />

      {/* Tab filter as pills */}
      <div className="flex gap-1.5 mt-4">
        {TAB_OPTIONS.map(tab => (
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
        <HudFilterBar
          searchPlaceholder={`${t('description')}, ${t('category')}...`}
          searchValue={searchTerm}
          onSearchChange={setSearchTerm}
          filterGroups={[]}
        />
      </div>

      <div className="mt-4">
        {entries.length === 0 ? (
          <HudEmptyState title={t('noEntries')} description={t('noEntriesDescription')} icon="file"
            action={{ label: t('newEntry'), onClick: () => setDrawerOpen(true) }} />
        ) : (
          <HudTable columns={columns} data={entries} keyExtractor={(e) => e.id}
            onRowClick={(e) => { setSelectedEntry(e); setDetailDrawerOpen(true); }} compact stickyHeader />
        )}
      </div>

      {/* New Entry Drawer */}
      <HudDrawer isOpen={drawerOpen} onClose={() => setDrawerOpen(false)} title={t('newEntry')} width="lg">
        <div className="space-y-4">
          <HudSelect label={t('template')} value={formTemplate} onChange={handleTemplateChange} placeholder={t('selectTemplate')}
            options={[{ value: '', label: '— Sem template —' }, ...entryTemplates.map(tpl => ({ value: tpl.key, label: tpl.label }))]} />
          <div className="grid grid-cols-2 gap-3">
            <HudInput label={t('entryDate')} type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)} />
            <HudSelect label={t('entryType')} value={formEntryType} onChange={setFormEntryType}
              options={[{ value: 'actual', label: t('typeActual') }, { value: 'budget', label: t('typeBudget') }, { value: 'forecast', label: t('typeForecast') }, { value: 'adjustment', label: t('typeAdjustment') }]} />
          </div>
          <HudInput label={t('description')} value={formDescription} onChange={(e) => setFormDescription(e.target.value)} />
          <HudInput label={t('amount')} type="number" value={formAmount} onChange={(e) => setFormAmount(e.target.value)} />
          <div className="grid grid-cols-3 gap-3">
            <HudSelect label="Nível 1" value={formCategoryL1} onChange={(v) => { setFormCategoryL1(v); setFormCategoryL2(''); setFormCategoryL3(''); }}
              options={[{ value: '', label: 'Selecionar...' }, ...l1Cats.map(c => ({ value: c.id, label: c.name }))]} />
            <HudSelect label="Nível 2" value={formCategoryL2} onChange={(v) => { setFormCategoryL2(v); setFormCategoryL3(''); }}
              options={[{ value: '', label: 'Selecionar...' }, ...l2Cats.map(c => ({ value: c.id, label: c.name }))]} />
            <HudSelect label="Nível 3" value={formCategoryL3} onChange={setFormCategoryL3}
              options={[{ value: '', label: 'Selecionar...' }, ...l3Cats.map(c => ({ value: c.id, label: c.name }))]} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <HudSelect label={t('costCenter')} value={formCostCenter} onChange={setFormCostCenter}
              options={[{ value: '', label: t('selectCostCenter') }, ...getCostCenters().map(c => ({ value: c.id, label: `${c.code} — ${c.name}` }))]} />
            <HudSelect label={t('businessUnit')} value={formBusinessUnit} onChange={setFormBusinessUnit}
              options={getBusinessUnits().map(b => ({ value: b.id, label: b.name }))} />
          </div>
          <HudSelect label={t('project')} value={formProject} onChange={setFormProject} placeholder={t('selectProject')}
            options={[{ value: '', label: '— Nenhum —' }, { value: 'proj-1', label: 'Petrobras FPSO P-80' }, { value: 'proj-2', label: 'Shell FPSO Mero' }, { value: 'proj-3', label: 'Equinor Bacalhau' }]} />
          <HudSelect label={t('supplier')} value={formSupplier} onChange={setFormSupplier} placeholder={t('selectSupplier')}
            options={[{ value: '', label: '— Nenhum —' }, ...getSuppliers().map(s => ({ value: s.id, label: s.name }))]} />
          <HudInput label={t('notes')} value={formNotes} onChange={(e) => setFormNotes(e.target.value)} />

          {parseFloat(formAmount) > 5000 && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <FileText className="w-4 h-4 text-amber-400" />
              <span className="text-amber-300 text-xs">{t('evidenceRequired')}</span>
            </div>
          )}

          <div className="flex gap-3 pt-4">
            <HudButton variant="secondary" onClick={() => setDrawerOpen(false)} fullWidth>Cancelar</HudButton>
            <HudButton variant="primary" onClick={handleSave} fullWidth>{t('saveAsDraft')}</HudButton>
          </div>
        </div>
      </HudDrawer>

      {/* Detail Drawer */}
      <HudDrawer isOpen={detailDrawerOpen} onClose={() => setDetailDrawerOpen(false)} title={t('entryDetails')} width="lg">
        {selectedEntry && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div><p className="text-white/30 text-[10px] uppercase">{t('entryDate')}</p><p className="text-white/80 text-sm font-mono">{selectedEntry.entry_date}</p></div>
              <div><p className="text-white/30 text-[10px] uppercase">Status</p><HudStatusPill variant={STATUS_MAP[selectedEntry.status]?.variant as any}>{STATUS_MAP[selectedEntry.status]?.label}</HudStatusPill></div>
            </div>
            <div><p className="text-white/30 text-[10px] uppercase">{t('description')}</p><p className="text-white/80 text-sm">{selectedEntry.description}</p></div>
            <div className="grid grid-cols-2 gap-3">
              <div><p className="text-white/30 text-[10px] uppercase">{t('amount')}</p><p className="text-white font-mono text-lg">{formatBRL(selectedEntry.amount_cents)}</p></div>
              <div><p className="text-white/30 text-[10px] uppercase">{t('category')}</p><p className="text-white/80 text-sm">{selectedEntry.category?.name || '—'}</p></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><p className="text-white/30 text-[10px] uppercase">{t('costCenter')}</p><p className="text-white/80 text-sm">{selectedEntry.cost_center?.name || '—'}</p></div>
              <div><p className="text-white/30 text-[10px] uppercase">{t('businessUnit')}</p><p className="text-white/80 text-sm">{selectedEntry.business_unit?.name || '—'}</p></div>
            </div>

            <div className="flex gap-2 pt-4 border-t border-white/[0.06]">
              {selectedEntry.status === 'draft' && (
                <>
                  <HudButton variant="primary" leftIcon={<Send className="w-4 h-4" />} onClick={() => handleTransition(selectedEntry.id, 'in_review')} fullWidth>{t('submitForReview')}</HudButton>
                  <HudButton variant="danger" leftIcon={<XCircle className="w-4 h-4" />} onClick={() => setVoidModalOpen(true)} size="sm">{t('void')}</HudButton>
                </>
              )}
              {selectedEntry.status === 'in_review' && (
                <>
                  <HudButton variant="primary" leftIcon={<CheckCircle className="w-4 h-4" />} onClick={() => handleTransition(selectedEntry.id, 'approved')} fullWidth>{t('approve')}</HudButton>
                  <HudButton variant="secondary" onClick={() => handleTransition(selectedEntry.id, 'draft')} size="sm">{t('reject')}</HudButton>
                </>
              )}
              {selectedEntry.status === 'approved' && (
                <HudButton variant="primary" leftIcon={<CheckCircle className="w-4 h-4" />} onClick={() => handleTransition(selectedEntry.id, 'posted')} fullWidth>{t('post')}</HudButton>
              )}
            </div>
          </div>
        )}
      </HudDrawer>

      {/* Void Modal */}
      <HudModal isOpen={voidModalOpen} onClose={() => setVoidModalOpen(false)} title={t('confirmVoid')} size="sm">
        <p className="text-white/60 text-sm mb-4">{t('confirmVoidDescription')}</p>
        <HudInput label={t('voidReason')} value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
        <div className="flex gap-2 mt-4">
          <HudButton variant="secondary" onClick={() => setVoidModalOpen(false)} fullWidth>Cancelar</HudButton>
          <HudButton variant="danger" onClick={() => selectedEntry && handleTransition(selectedEntry.id, 'void', voidReason)} fullWidth disabled={!voidReason}>
            Confirmar Anulação
          </HudButton>
        </div>
      </HudModal>
    </HudPageLayout>
  );
}
