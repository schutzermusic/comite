'use client';

import { useState, useMemo, useCallback, useEffect, Suspense } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import {
  Receipt, Plus, CheckCircle, XCircle,
  Send, FileText, ArrowDownLeft, ArrowUpRight, AlertTriangle, WalletCards,
  Activity, Search, Layers, Link2, CalendarRange,
} from 'lucide-react';
import {
  HudPageLayout, HudHeader, HudTable,
  HudButton, HudStatusPill, HudDrawer, HudInput, HudSelect,
  HudEmptyState, HudModal, HudBadge, HudPanel, HudKpiStrip,
  type HudTableColumn, type KpiItem,
} from '@/components/hud';
import { FinanceFilterBar, FinanceFilterChip, FinanceFilterRange } from '@/components/finance/shared';
import { generatePeriodOptions } from '@/components/finance/control-room/helpers';
import {
  getLedgerEntries, getLedgerEntry, createLedgerEntry, updateLedgerEntry, transitionEntryStatus,
  linkEntriesToProject,
  formatBRL, getCostCenters, getBusinessUnits, getSuppliers,
  getProjects, getContracts, getScenarios,
  reaisToCents, centsToReais, getCategories,
  validateLedgerEntryInput, type LedgerEntryValidationError,
} from '@/lib/finance/finance-store';
import { ExportReportButton } from '@/components/reports/ExportReportButton';
import { openFinanceReport, kpiFromHud } from '@/lib/reports/modules/finance-report';
import { entryTemplates, managementCategories } from '@/data/finance/seed-categories';
import type { LedgerEntry, LedgerEntryStatus, LedgerEntryType, FinanceScenarioKey, LedgerAllocationStatus } from '@/lib/types/finance';

const ALLOCATION_MAP: Record<LedgerAllocationStatus, { label: string; variant: string }> = {
  allocated: { label: 'Alocado', variant: 'completed' },
  pending_project: { label: 'Projeto pendente', variant: 'warning' },
  unallocated: { label: 'Não alocado', variant: 'neutral' },
};
const ALLOCATION_FILTER_OPTIONS = [
  { value: 'all', label: 'Todas alocações' },
  { value: 'allocated', label: 'Alocado' },
  { value: 'pending_project', label: 'Projeto pendente' },
  { value: 'unallocated', label: 'Não alocado' },
];

const STATUS_MAP: Record<string, { label: string; variant: string }> = {
  draft: { label: 'Rascunho', variant: 'pending' },
  in_review: { label: 'Em Revisão', variant: 'warning' },
  approved: { label: 'Aprovado', variant: 'info' },
  posted: { label: 'Postado', variant: 'completed' },
  reconciled: { label: 'Reconciliado', variant: 'active' },
  void: { label: 'Anulado', variant: 'error' },
};

const PERIOD_OPTIONS = generatePeriodOptions();

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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const initialTab = searchParams.get('tab') || 'all';
  const focusEntryId = searchParams.get('entryId');

  const [activeTab, setActiveTab] = useState(initialTab);
  const [periodFrom, setPeriodFrom] = useState('2026-01');
  const [periodTo, setPeriodTo] = useState('2026-06');
  const [allocFilter, setAllocFilter] = useState<LedgerAllocationStatus | 'all'>('all');
  const [allocProject, setAllocProject] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [detailDrawerOpen, setDetailDrawerOpen] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<LedgerEntry | null>(null);
  const [voidModalOpen, setVoidModalOpen] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [deepLinkMissing, setDeepLinkMissing] = useState<string | null>(null);

  // Deep-link: ?entryId=... opens the detail drawer for that entry.
  // Sourced from AP/AR settlement clicks. If the id no longer exists (rare —
  // e.g. void after the link was shared), show a soft notice instead of
  // failing silently. The query param is cleared after handling so refresh /
  // back navigation behaves naturally.
  useEffect(() => {
    if (!focusEntryId) return;
    const entry = getLedgerEntry(focusEntryId);
    if (entry) {
      setSelectedEntry(entry);
      setDetailDrawerOpen(true);
      setDeepLinkMissing(null);
    } else {
      setDeepLinkMissing(focusEntryId);
    }
    router.replace(pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusEntryId]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [formErrors, setFormErrors] = useState<LedgerEntryValidationError[]>([]);
  const [formTemplate, setFormTemplate] = useState('');
  const [formDate, setFormDate] = useState(new Date().toISOString().slice(0, 10));
  const [formCompetence, setFormCompetence] = useState(new Date().toISOString().slice(0, 7));
  const [formDueDate, setFormDueDate] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formAmount, setFormAmount] = useState('');
  const [formEntryType, setFormEntryType] = useState('actual');
  const [formScenario, setFormScenario] = useState('');
  const [formCategoryL1, setFormCategoryL1] = useState('');
  const [formCategoryL2, setFormCategoryL2] = useState('');
  const [formCategoryL3, setFormCategoryL3] = useState('');
  const [formCostCenter, setFormCostCenter] = useState('');
  const [formProject, setFormProject] = useState('');
  const [formContract, setFormContract] = useState('');
  const [formSupplier, setFormSupplier] = useState('');
  const [formBusinessUnit, setFormBusinessUnit] = useState('bu-rj');
  const [formAccount, setFormAccount] = useState('');
  const [formNotes, setFormNotes] = useState('');

  const fieldError = (field: string) => formErrors.find(e => e.field === field)?.message;

  // Prefill deep-link: ?projectId=&contractId=&entryType=&nature= opens the
  // create drawer with project/contract/type/category pre-set. Sourced from the
  // project detail FinanceView shortcut actions. Params cleared after handling.
  const prefillProjectId = searchParams.get('projectId');
  const prefillContractId = searchParams.get('contractId');
  const prefillEntryType = searchParams.get('entryType');
  const prefillNature = searchParams.get('nature');
  useEffect(() => {
    if (!prefillProjectId && !prefillContractId && !prefillNature && !prefillEntryType) return;
    // Resolve contract from the project when not explicitly provided.
    const proj = prefillProjectId ? getProjects().find(p => p.id === prefillProjectId) : undefined;
    const contractId = prefillContractId || proj?.contract_id || '';
    // nature → entry_type + (revenue) category preset.
    let entryType = prefillEntryType || 'actual';
    if (prefillNature === 'budget') entryType = 'budget';
    else if (prefillNature === 'forecast') entryType = 'forecast';
    setFormProject(prefillProjectId || '');
    setFormContract(contractId);
    setFormEntryType(entryType);
    if (prefillNature === 'revenue') { setFormCategoryL1('cat-a'); setFormCategoryL2(''); setFormCategoryL3(''); }
    setDrawerOpen(true);
    router.replace(pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillProjectId, prefillContractId, prefillEntryType, prefillNature]);

  const statusFilter = activeTab === 'all' ? undefined : activeTab as LedgerEntryStatus;
  const periodFilters = useMemo(
    () => ({ period_from: periodFrom, period_to: periodTo }),
    [periodFrom, periodTo],
  );
  const entries = useMemo(() => {
    let result = getLedgerEntries(periodFilters, statusFilter);
    if (allocFilter !== 'all') {
      result = result.filter(e => (e.allocation_status ?? 'unallocated') === allocFilter);
    }
    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      result = result.filter(e => e.description.toLowerCase().includes(lower) || e.category?.name?.toLowerCase().includes(lower));
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, allocFilter, searchTerm, refreshKey, periodFilters]);

  const pendingAllocationCount = useMemo(
    () => getLedgerEntries(periodFilters).filter(e => e.allocation_status === 'pending_project').length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [refreshKey, periodFilters],
  );

  const handleAllocateToProject = useCallback((entryId: string, projectId: string) => {
    if (!projectId) return;
    const result = linkEntriesToProject([entryId], projectId, 'Alocado via Lançamentos');
    if (result.linked[0]) setSelectedEntry(result.linked[0]);
    setAllocProject('');
    setRefreshKey(k => k + 1);
  }, []);

  const categories = getCategories();
  const l1Cats = categories.filter(c => c.level === 1);
  const l2Cats = useMemo(() => categories.filter(c => c.level === 2 && c.parent_id === formCategoryL1), [formCategoryL1]);
  const l3Cats = useMemo(() => categories.filter(c => c.level === 3 && c.parent_id === formCategoryL2), [formCategoryL2]);

  const revenueTotal = entries.filter(e => e.category?.sign === 1).reduce((sum, e) => sum + e.amount_cents, 0);
  const expenseTotal = entries.filter(e => e.category?.sign === -1).reduce((sum, e) => sum + e.amount_cents, 0);
  const reviewCount = entries.filter(e => e.status === 'draft' || e.status === 'in_review').length;

  const kpis: KpiItem[] = [
    { id: 'revenue', label: 'Créditos / Receita', value: formatBRL(revenueTotal), icon: <ArrowDownLeft className="h-5 w-5" />, variant: 'success' },
    { id: 'expense', label: 'Débitos / Despesa', value: formatBRL(expenseTotal), icon: <ArrowUpRight className="h-5 w-5" />, variant: 'danger' },
    { id: 'review', label: 'Fila de revisão', value: reviewCount.toString(), icon: <WalletCards className="h-5 w-5" />, variant: reviewCount > 0 ? 'warning' : 'success' },
    { id: 'pending_alloc', label: 'Projeto pendente', value: pendingAllocationCount.toString(), icon: <Layers className="h-5 w-5" />, variant: pendingAllocationCount > 0 ? 'warning' : 'success' },
  ];

  const columns: HudTableColumn<LedgerEntry>[] = [
    { key: 'entry_date', header: t('entryDate'), cell: (e) => <span className="font-mono text-xs text-ig-fg-muted">{e.entry_date}</span> },
    { key: 'description', header: t('description'), cell: (e) => (
      <div className="min-w-0">
        <span className="block max-w-[260px] truncate text-xs font-medium text-ig-fg-strong">{e.description}</span>
        <span className="text-[10px] uppercase tracking-[0.14em] text-ig-fg-subtle">{e.entry_type}</span>
      </div>
    ) },
    { key: 'category', header: t('category'), cell: (e) => (
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-xs text-ig-fg-muted">{e.category?.name || '—'}</span>
        {e.category?.group_key && <span className="text-[10px] uppercase tracking-[0.14em] text-ig-fg-subtle">{e.category.group_key}</span>}
      </div>
    ) },
    { key: 'project_id', header: t('project'), cell: (e) => {
      const alloc = e.allocation_status ?? 'unallocated';
      return (
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-xs text-ig-fg-muted">{e.project_id?.slice(0, 12) || (e.contract_id ? e.contract_id : '—')}</span>
          <HudStatusPill variant={ALLOCATION_MAP[alloc].variant as any} size="sm">{ALLOCATION_MAP[alloc].label}</HudStatusPill>
        </div>
      );
    } },
    { key: 'amount_cents', header: t('amount'), align: 'right', cell: (e) => (
      <span className={`block font-mono text-xs font-semibold ${e.category?.sign === 1 ? 'text-ig-success' : 'text-ig-danger'}`}>
        {e.category?.sign === 1 ? '+' : '-'}{formatBRL(e.amount_cents)}
      </span>
    ) },
    { key: 'status', header: 'Status', cell: (e) => (
      <HudStatusPill variant={STATUS_MAP[e.status]?.variant as any || 'pending'} size="sm">
        {STATUS_MAP[e.status]?.label || e.status}
      </HudStatusPill>
    )},
    { key: 'source_system', header: t('origin'), cell: (e) => <HudBadge variant="default" size="sm">{e.source_system}</HudBadge> },
  ];

  const resetForm = () => {
    setEditingId(null); setFormErrors([]);
    setFormTemplate(''); setFormDate(new Date().toISOString().slice(0, 10));
    setFormCompetence(new Date().toISOString().slice(0, 7)); setFormDueDate('');
    setFormDescription(''); setFormAmount(''); setFormEntryType('actual'); setFormScenario('');
    setFormCategoryL1(''); setFormCategoryL2(''); setFormCategoryL3('');
    setFormCostCenter(''); setFormProject(''); setFormContract(''); setFormSupplier('');
    setFormBusinessUnit('bu-rj'); setFormAccount(''); setFormNotes('');
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

  const handleEdit = (entry: LedgerEntry) => {
    setEditingId(entry.id);
    setFormErrors([]);
    setFormTemplate(entry.template_key || '');
    setFormDate(entry.entry_date);
    setFormCompetence(entry.competence_month || entry.period_key);
    setFormDueDate(entry.due_date || '');
    setFormDescription(entry.description);
    setFormAmount(String(centsToReais(entry.amount_cents)));
    setFormEntryType(entry.entry_type);
    setFormScenario(entry.scenario || '');
    const cat = managementCategories.find(c => c.id === entry.category_id);
    const l2 = cat ? managementCategories.find(c => c.id === cat.parent_id) : undefined;
    const l1 = l2 ? managementCategories.find(c => c.id === l2.parent_id) : undefined;
    setFormCategoryL1(l1?.id || (cat?.level === 1 ? cat.id : ''));
    setFormCategoryL2(l2?.id || (cat?.level === 2 ? cat.id : ''));
    setFormCategoryL3(cat?.level === 3 ? cat.id : '');
    setFormCostCenter(entry.cost_center_id || '');
    setFormProject(entry.project_id || '');
    setFormContract(entry.contract_id || '');
    setFormSupplier(entry.supplier_id || '');
    setFormBusinessUnit(entry.business_unit_id || 'bu-rj');
    setFormAccount(entry.account || '');
    setFormNotes(entry.notes || '');
    setDetailDrawerOpen(false);
    setDrawerOpen(true);
  };

  const handleSave = () => {
    const categoryId = formCategoryL3 || formCategoryL2 || formCategoryL1;
    const payload: Partial<LedgerEntry> = {
      entry_date: formDate,
      competence_month: formCompetence,
      due_date: formDueDate || undefined,
      description: formDescription,
      amount_cents: formAmount ? reaisToCents(parseFloat(formAmount)) : 0,
      entry_type: formEntryType as LedgerEntryType,
      scenario: (formScenario || undefined) as FinanceScenarioKey | undefined,
      category_id: categoryId,
      cost_center_id: formCostCenter,
      project_id: formProject || undefined,
      contract_id: formContract || undefined,
      supplier_id: formSupplier || undefined,
      business_unit_id: formBusinessUnit,
      account: formAccount || undefined,
      notes: formNotes || undefined,
      template_key: formTemplate || undefined,
      source_system: 'manual',
    };

    const errors = validateLedgerEntryInput(payload);
    if (errors.length > 0) { setFormErrors(errors); return; }
    setFormErrors([]);

    if (editingId) {
      updateLedgerEntry(editingId, payload);
    } else {
      createLedgerEntry(payload);
    }
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
          <div className="flex items-center gap-2">
            <ExportReportButton
              size="md"
              variant="glass"
              permission="finance.export"
              fallbackPermission="finance.view"
              build={() => openFinanceReport({
                title: 'Lançamentos Financeiros',
                fileContext: 'lancamentos',
                context: `${entries.length} lançamentos no recorte`,
                kpis: kpis.map((k) => kpiFromHud(k)),
                sections: [{
                  title: 'Lançamentos',
                  tables: [{
                    columns: [
                      { key: 'data', label: 'Data' },
                      { key: 'desc', label: 'Descrição' },
                      { key: 'tipo', label: 'Tipo' },
                      { key: 'cat', label: 'Categoria' },
                      { key: 'valor', label: 'Valor', num: true },
                    ],
                    rows: entries.slice(0, 200).map((e) => ({
                      data: { html: `<span class="mono">${e.entry_date}</span>` },
                      desc: e.description,
                      tipo: String(e.entry_type),
                      cat: e.category?.name || '—',
                      valor: { html: `<span class="mono" style="color:${e.category?.sign === 1 ? '#047857' : '#B91C1C'}">${e.category?.sign === 1 ? '+' : '-'}${formatBRL(e.amount_cents)}</span>` },
                    })),
                  }],
                }],
              })}
            />
            <HudButton variant="primary" leftIcon={<Plus className="w-4 h-4" />} onClick={() => { resetForm(); setDrawerOpen(true); }}>
              {t('newEntry')}
            </HudButton>
          </div>
        }
      />
      <HudKpiStrip kpis={kpis} columns={4} size="sm" />

      <FinanceFilterBar
        showPeriod={false}
        showScenario={false}
        extra={
          <>
            <FinanceFilterRange
              icon={<CalendarRange className="h-3.5 w-3.5" />}
              label="Período"
              fromValue={periodFrom}
              toValue={periodTo}
              options={PERIOD_OPTIONS}
              onChange={(from, to) => {
                setPeriodFrom(from);
                setPeriodTo(to);
              }}
            />
            <FinanceFilterChip
              icon={<Activity className="h-3.5 w-3.5" />}
              label="Status"
              value={activeTab}
              onChange={setActiveTab}
              options={TAB_OPTIONS}
            />
            <FinanceFilterChip
              icon={<Layers className="h-3.5 w-3.5" />}
              label="Alocação"
              value={allocFilter}
              onChange={(v) => setAllocFilter(v as LedgerAllocationStatus | 'all')}
              options={ALLOCATION_FILTER_OPTIONS}
            />
            <label className="flex items-center gap-1.5 rounded-lg border border-[color:var(--ig-border-strong)] bg-[color:var(--ig-bg-raised)]/60 px-2 h-9 backdrop-blur-sm">
              <Search className="h-3.5 w-3.5 text-[color:var(--ig-fg-subtle)]" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder={`${t('description')}, ${t('category')}...`}
                className="bg-transparent text-xs font-medium text-[color:var(--ig-fg-strong)] placeholder:text-[color:var(--ig-fg-subtle)] focus:outline-none w-56"
              />
            </label>
          </>
        }
      />


      {deepLinkMissing && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-[color-mix(in_oklab,var(--ig-warning)_28%,transparent)] bg-[color-mix(in_oklab,var(--ig-warning)_12%,transparent)] p-3">
          <AlertTriangle className="h-4 w-4 shrink-0 text-ig-warning" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-ig-warning">Lançamento <span className="font-mono">{deepLinkMissing}</span> não encontrado.</p>
            <p className="text-[11px] text-ig-fg-muted">Pode ter sido anulado ou removido. Verifique a carteira de origem.</p>
          </div>
          <button type="button" onClick={() => setDeepLinkMissing(null)} className="text-ig-fg-subtle hover:text-ig-fg-strong" aria-label="Dismiss">
            <XCircle className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="mt-4">
        {entries.length === 0 ? (
          <HudEmptyState title={t('noEntries')} description={t('noEntriesDescription')} icon="file"
            action={{ label: t('newEntry'), onClick: () => setDrawerOpen(true) }} />
        ) : (
          <HudPanel noPadding title="Ledger executivo" subtitle="Lançamentos com leitura por natureza, categoria e aprovação" icon={<Receipt className="h-4 w-4" />} sweep>
            <HudTable columns={columns} data={entries} keyExtractor={(e) => e.id}
              onRowClick={(e) => { setSelectedEntry(e); setAllocProject(''); setDetailDrawerOpen(true); }} compact stickyHeader />
          </HudPanel>
        )}
      </div>

      {/* New / Edit Entry Drawer */}
      <HudDrawer isOpen={drawerOpen} onClose={() => setDrawerOpen(false)} title={editingId ? t('editEntry') : t('newEntry')} width="lg">
        <div className="space-y-4">
          <HudSelect label={t('template')} value={formTemplate} onChange={handleTemplateChange} placeholder={t('selectTemplate')}
            options={[{ value: '', label: '— Sem template —' }, ...entryTemplates.map(tpl => ({ value: tpl.key, label: tpl.label }))]} />
          <div className="grid grid-cols-3 gap-3">
            <HudInput label={t('entryDate')} type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)} error={fieldError('entry_date')} />
            <HudInput label={t('competenceMonth')} type="month" value={formCompetence} onChange={(e) => setFormCompetence(e.target.value)} error={fieldError('competence_month')} />
            <HudInput label={t('dueDate')} type="date" value={formDueDate} onChange={(e) => setFormDueDate(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <HudSelect label={t('entryType')} value={formEntryType} onChange={setFormEntryType} error={fieldError('entry_type')}
              options={[{ value: 'actual', label: t('typeActual') }, { value: 'budget', label: t('typeBudget') }, { value: 'forecast', label: t('typeForecast') }, { value: 'adjustment', label: t('typeAdjustment') }]} />
            <HudSelect label={t('scenario')} value={formScenario} onChange={setFormScenario}
              options={[{ value: '', label: t('scenarioAuto') }, ...getScenarios().map(s => ({ value: s.key, label: s.name }))]} />
          </div>
          <HudInput label={t('description')} value={formDescription} onChange={(e) => setFormDescription(e.target.value)} error={fieldError('description')} />
          <HudInput label={t('amount')} type="number" value={formAmount} onChange={(e) => setFormAmount(e.target.value)} error={fieldError('amount_cents')} />
          <div className="grid grid-cols-3 gap-3">
            <HudSelect label="Grupo DRE" value={formCategoryL1} onChange={(v) => { setFormCategoryL1(v); setFormCategoryL2(''); setFormCategoryL3(''); }} error={fieldError('category_id')}
              options={[{ value: '', label: 'Selecionar...' }, ...l1Cats.map(c => ({ value: c.id, label: c.name }))]} />
            <HudSelect label="Categoria" value={formCategoryL2} onChange={(v) => { setFormCategoryL2(v); setFormCategoryL3(''); }}
              options={[{ value: '', label: 'Selecionar...' }, ...l2Cats.map(c => ({ value: c.id, label: c.name }))]} />
            <HudSelect label="Subcategoria" value={formCategoryL3} onChange={setFormCategoryL3}
              options={[{ value: '', label: 'Selecionar...' }, ...l3Cats.map(c => ({ value: c.id, label: c.name }))]} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <HudSelect label={t('costCenter')} value={formCostCenter} onChange={setFormCostCenter} error={fieldError('cost_center_id')}
              options={[{ value: '', label: t('selectCostCenter') }, ...getCostCenters().map(c => ({ value: c.id, label: `${c.code} — ${c.name}` }))]} />
            <HudSelect label={t('businessUnit')} value={formBusinessUnit} onChange={setFormBusinessUnit}
              options={getBusinessUnits().map(b => ({ value: b.id, label: b.name }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <HudSelect label={t('project')} value={formProject} onChange={setFormProject} placeholder={t('selectProject')} error={fieldError('project_id')}
              options={[{ value: '', label: '— Nenhum —' }, ...getProjects().map(p => ({ value: p.id, label: `${p.code} — ${p.name}` }))]} />
            <HudSelect label={t('contract')} value={formContract} onChange={setFormContract} placeholder={t('selectContract')} error={fieldError('contract_id')}
              options={[{ value: '', label: '— Nenhum —' }, ...getContracts().map(c => ({ value: c.id, label: `${c.code} — ${c.client_name}` }))]} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <HudSelect label={t('supplier')} value={formSupplier} onChange={setFormSupplier} placeholder={t('selectSupplier')}
              options={[{ value: '', label: '— Nenhum —' }, ...getSuppliers().map(s => ({ value: s.id, label: s.name }))]} />
            <HudInput label={t('account')} value={formAccount} onChange={(e) => setFormAccount(e.target.value)} placeholder="Ex.: 1.1.01 / Itaú CC" />
          </div>
          <HudInput label={t('notes')} value={formNotes} onChange={(e) => setFormNotes(e.target.value)} />

          {parseFloat(formAmount) > 5000 && (
            <div className="flex items-center gap-2 rounded-lg border border-[color-mix(in_oklab,var(--ig-warning)_28%,transparent)] bg-[color-mix(in_oklab,var(--ig-warning)_12%,transparent)] p-3">
              <FileText className="h-4 w-4 text-ig-warning" />
              <span className="text-xs text-ig-warning">{t('evidenceRequired')}</span>
            </div>
          )}

          {formErrors.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-[color-mix(in_oklab,var(--ig-danger)_28%,transparent)] bg-[color-mix(in_oklab,var(--ig-danger)_10%,transparent)] p-3">
              <AlertTriangle className="h-4 w-4 shrink-0 text-ig-danger" />
              <ul className="space-y-0.5 text-xs text-ig-danger">
                {formErrors.map((err) => <li key={err.field}>{err.message}</li>)}
              </ul>
            </div>
          )}

          <div className="flex gap-3 pt-4">
            <HudButton variant="secondary" onClick={() => setDrawerOpen(false)} fullWidth>Cancelar</HudButton>
            <HudButton variant="primary" onClick={handleSave} fullWidth>{editingId ? t('action') : t('saveAsDraft')}</HudButton>
          </div>
        </div>
      </HudDrawer>

      {/* Detail Drawer */}
      <HudDrawer isOpen={detailDrawerOpen} onClose={() => setDetailDrawerOpen(false)} title={t('entryDetails')} width="lg">
        {selectedEntry && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div><p className="text-[10px] uppercase text-ig-fg-subtle">{t('entryDate')}</p><p className="font-mono text-sm text-ig-fg-strong">{selectedEntry.entry_date}</p></div>
              <div><p className="text-[10px] uppercase text-ig-fg-subtle">Status</p><HudStatusPill variant={STATUS_MAP[selectedEntry.status]?.variant as any}>{STATUS_MAP[selectedEntry.status]?.label}</HudStatusPill></div>
            </div>
            <div><p className="text-[10px] uppercase text-ig-fg-subtle">{t('description')}</p><p className="text-sm text-ig-fg-strong">{selectedEntry.description}</p></div>
            <div className="grid grid-cols-2 gap-3">
              <div><p className="text-[10px] uppercase text-ig-fg-subtle">{t('amount')}</p><p className="font-mono text-lg text-ig-fg-strong">{formatBRL(selectedEntry.amount_cents)}</p></div>
              <div><p className="text-[10px] uppercase text-ig-fg-subtle">{t('category')}</p><p className="text-sm text-ig-fg-strong">{selectedEntry.category?.name || '—'}</p></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><p className="text-[10px] uppercase text-ig-fg-subtle">{t('costCenter')}</p><p className="text-sm text-ig-fg-strong">{selectedEntry.cost_center?.name || '—'}</p></div>
              <div><p className="text-[10px] uppercase text-ig-fg-subtle">{t('businessUnit')}</p><p className="text-sm text-ig-fg-strong">{selectedEntry.business_unit?.name || '—'}</p></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><p className="text-[10px] uppercase text-ig-fg-subtle">{t('competenceMonth')}</p><p className="font-mono text-sm text-ig-fg-strong">{selectedEntry.competence_month || selectedEntry.period_key}</p></div>
              <div><p className="text-[10px] uppercase text-ig-fg-subtle">{t('dueDate')}</p><p className="font-mono text-sm text-ig-fg-strong">{selectedEntry.due_date || '—'}</p></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><p className="text-[10px] uppercase text-ig-fg-subtle">{t('scenario')}</p><p className="text-sm text-ig-fg-strong">{selectedEntry.scenario || '—'}</p></div>
              <div><p className="text-[10px] uppercase text-ig-fg-subtle">{t('account')}</p><p className="text-sm text-ig-fg-strong">{selectedEntry.account || '—'}</p></div>
            </div>
            {selectedEntry.notes && (
              <div><p className="text-[10px] uppercase text-ig-fg-subtle">{t('notes')}</p><p className="text-sm text-ig-fg-strong">{selectedEntry.notes}</p></div>
            )}

            {/* Project allocation — controlled reclassification (dimension only, audited) */}
            <div className="rounded-lg border border-ig-border-subtle bg-ig-panel/40 p-3">
              <div className="flex items-center justify-between">
                <p className="text-[10px] uppercase text-ig-fg-subtle">Alocação de projeto</p>
                <HudStatusPill variant={ALLOCATION_MAP[selectedEntry.allocation_status ?? 'unallocated'].variant as any} size="sm">
                  {ALLOCATION_MAP[selectedEntry.allocation_status ?? 'unallocated'].label}
                </HudStatusPill>
              </div>
              {selectedEntry.project_id ? (
                <p className="mt-2 text-xs text-ig-fg-muted">Projeto: <span className="font-mono text-ig-fg-strong">{selectedEntry.project_id}</span>{selectedEntry.contract_id ? ` • Contrato ${selectedEntry.contract_id}` : ''}</p>
              ) : selectedEntry.status === 'void' ? (
                <p className="mt-2 text-xs text-ig-fg-muted">Lançamento anulado — não alocável.</p>
              ) : selectedEntry.category?.group_key === 'clearing' ? (
                <p className="mt-2 text-xs text-ig-fg-muted">Lançamento de tesouraria/clearing — nunca é custo de projeto.</p>
              ) : (
                <div className="mt-2 space-y-2">
                  {selectedEntry.contract_id && (
                    <p className="text-[11px] text-ig-warning">Custo pré-projeto do contrato <span className="font-mono">{selectedEntry.contract_id}</span> — vincule ao projeto correspondente.</p>
                  )}
                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <HudSelect
                        label="Vincular ao projeto"
                        value={allocProject}
                        onChange={setAllocProject}
                        placeholder={t('selectProject')}
                        options={[{ value: '', label: t('selectProject') }, ...getProjects().map(p => ({ value: p.id, label: `${p.code} — ${p.name}` }))]}
                      />
                    </div>
                    <HudButton
                      variant="primary"
                      size="sm"
                      leftIcon={<Link2 className="w-4 h-4" />}
                      disabled={!allocProject}
                      onClick={() => handleAllocateToProject(selectedEntry.id, allocProject)}
                    >
                      Vincular
                    </HudButton>
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-2 border-t border-ig-border-subtle pt-4">
              {selectedEntry.status === 'draft' && (
                <>
                  <HudButton variant="secondary" leftIcon={<FileText className="w-4 h-4" />} onClick={() => handleEdit(selectedEntry)} size="sm">{t('editEntry')}</HudButton>
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
        <p className="mb-4 text-sm text-ig-fg-muted">{t('confirmVoidDescription')}</p>
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
