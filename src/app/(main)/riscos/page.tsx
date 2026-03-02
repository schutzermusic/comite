'use client';

import { useState, useMemo } from "react";
import type { Risk } from "@/lib/types";
import { useTranslations } from "next-intl";
import {
  ShieldAlert,
  Plus,
  Search,
  TrendingUp,
  AlertCircle,
  CheckCircle,
  BarChart3,
  LayoutGrid,
  List,
} from "lucide-react";

// Components
import { RiskMatrix } from "@/components/risks/risk-matrix";
import { RiskList } from "@/components/risks/risk-list";

// New Glass HUD Components
import {
  HudPageLayout,
  HudHeader,
  HudKpiStrip,
  HudFilterBar,
  HudPanel,
  HudButton,
  HudModal,
  HudInput,
  HudSelect,
  HudTabs,
  type KpiItem,
  type FilterGroup,
  type HudTab,
} from "@/components/hud";

// Mock data
const mockRisks: Risk[] = [
  {
    id: '1',
    title: 'Risco de Atraso em Projeto Crítico',
    description: 'Projeto de infraestrutura com potencial de atraso devido a falta de recursos',
    category: 'Operational',
    probability: 4,
    impact: 5,
    level: 20,
    severity: 'critical',
    origin: 'project',
    referenceId: 'proj-123',
    status: 'open',
    createdAt: new Date('2024-01-10'),
    updatedAt: new Date('2024-01-10'),
  },
  {
    id: '2',
    title: 'Exposição Cambial em Contrato Internacional',
    description: 'Variação cambial pode impactar negativamente o valor do contrato',
    category: 'Financial',
    probability: 3,
    impact: 4,
    level: 12,
    severity: 'high',
    origin: 'contract',
    referenceId: 'contract-456',
    status: 'mitigating',
    createdAt: new Date('2024-01-15'),
    updatedAt: new Date('2024-01-25'),
  },
  {
    id: '3',
    title: 'Não Conformidade com LGPD',
    description: 'Processos de tratamento de dados pessoais não atendem requisitos da LGPD',
    category: 'Legal',
    probability: 2,
    impact: 5,
    level: 10,
    severity: 'medium',
    origin: 'manual',
    status: 'open',
    createdAt: new Date('2024-01-20'),
    updatedAt: new Date('2024-01-20'),
  },
  {
    id: '4',
    title: 'Cláusula Contratual Desfavorável',
    description: 'Contrato com fornecedor contém penalidades elevadas',
    category: 'Contractual',
    probability: 4,
    impact: 4,
    level: 16,
    severity: 'critical',
    origin: 'contract',
    referenceId: 'contract-789',
    status: 'open',
    createdAt: new Date('2024-01-22'),
    updatedAt: new Date('2024-01-22'),
  },
  {
    id: '5',
    title: 'Falta de Auditoria Interna',
    description: 'Ausência de controles de auditoria pode gerar problemas de compliance',
    category: 'Compliance',
    probability: 3,
    impact: 3,
    level: 9,
    severity: 'medium',
    origin: 'manual',
    status: 'resolved',
    createdAt: new Date('2024-01-05'),
    updatedAt: new Date('2024-01-28'),
  },
];

export default function RiscosPage() {
  const t = useTranslations('risks');
  const tCommon = useTranslations('common');

  const [risks, setRisks] = useState<Risk[]>(mockRisks);
  const [view, setView] = useState<'list' | 'matrix'>('list');
  const [searchTerm, setSearchTerm] = useState('');
  const [severityFilter, setSeverityFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [newRisk, setNewRisk] = useState({
    title: '',
    description: '',
    category: 'Operational',
    probability: 3,
    impact: 3,
    severity: 'medium' as Risk['severity'],
    origin: 'manual' as Risk['origin'],
  });

  // Calculate KPIs
  const stats = useMemo(() => {
    const total = risks.length;
    const open = risks.filter((r) => r.status === 'open').length;
    const critical = risks.filter((r) => r.severity === 'critical').length;
    const high = risks.filter((r) => r.severity === 'high').length;
    const resolved = risks.filter((r) => r.status === 'resolved').length;
    const mitigating = risks.filter((r) => r.status === 'mitigating').length;
    return { total, open, critical, high, resolved, mitigating };
  }, [risks]);

  // Filter risks
  const filteredRisks = useMemo(() => {
    return risks.filter((risk) => {
      const matchesSearch =
        risk.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        risk.description.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesSeverity = severityFilter === 'all' || risk.severity === severityFilter;
      const matchesStatus = statusFilter === 'all' || risk.status === statusFilter;
      const matchesCategory = categoryFilter === 'all' || risk.category === categoryFilter;

      return matchesSearch && matchesSeverity && matchesStatus && matchesCategory;
    });
  }, [risks, searchTerm, severityFilter, statusFilter, categoryFilter]);

  // Handlers
  const handleResolveRisk = (riskId: string) => {
    setRisks((prev) =>
      prev.map((risk) =>
        risk.id === riskId ? { ...risk, status: 'resolved' as const, updatedAt: new Date() } : risk
      )
    );
  };

  const handleCreateRisk = () => {
    if (!newRisk.title || !newRisk.description) return;

    const probability = Number(newRisk.probability) || 0;
    const impact = Number(newRisk.impact) || 0;
    const level = probability * impact;

    const payload: Risk = {
      id: `new-${Date.now()}`,
      title: newRisk.title,
      description: newRisk.description,
      category: newRisk.category as Risk['category'],
      probability,
      impact,
      level,
      severity: newRisk.severity,
      origin: newRisk.origin,
      status: 'open',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    setRisks((prev) => [payload, ...prev]);
    setCreateOpen(false);
    setNewRisk({
      title: '',
      description: '',
      category: 'Operational',
      probability: 3,
      impact: 3,
      severity: 'medium',
      origin: 'manual',
    });
  };

  // KPI items
  const kpiItems: KpiItem[] = useMemo(
    () => [
      {
        id: 'total',
        value: stats.total,
        label: t('totalRisks'),
        variant: 'default',
        icon: <ShieldAlert className="w-5 h-5" />,
      },
      {
        id: 'open',
        value: stats.open,
        label: t('openRisks'),
        variant: stats.open > 0 ? 'warning' : 'default',
        icon: <AlertCircle className="w-5 h-5" />,
      },
      {
        id: 'critical',
        value: stats.critical,
        label: t('criticalRisks'),
        variant: stats.critical > 0 ? 'danger' : 'default',
        icon: <TrendingUp className="w-5 h-5" />,
      },
      {
        id: 'high',
        value: stats.high,
        label: t('highRisks'),
        variant: stats.high > 0 ? 'warning' : 'default',
        icon: <BarChart3 className="w-5 h-5" />,
      },
      {
        id: 'mitigating',
        value: stats.mitigating,
        label: t('mitigating'),
        variant: 'info',
        icon: <ShieldAlert className="w-5 h-5" />,
      },
      {
        id: 'resolved',
        value: stats.resolved,
        label: t('resolved'),
        variant: 'success',
        icon: <CheckCircle className="w-5 h-5" />,
      },
    ],
    [stats, t]
  );

  // Filter groups
  const filterGroups: FilterGroup[] = useMemo(
    () => [
      {
        id: 'severity',
        label: t('severity'),
        value: severityFilter,
        options: [
          { value: 'all', label: t('allSeverities') },
          { value: 'low', label: t('low') },
          { value: 'medium', label: t('medium') },
          { value: 'high', label: t('high') },
          { value: 'critical', label: t('critical') },
        ],
        onChange: setSeverityFilter,
      },
      {
        id: 'status',
        label: tCommon('status'),
        value: statusFilter,
        options: [
          { value: 'all', label: t('allStatuses') },
          { value: 'open', label: t('open') },
          { value: 'mitigating', label: t('mitigating') },
          { value: 'resolved', label: t('resolved') },
        ],
        onChange: setStatusFilter,
      },
      {
        id: 'category',
        label: t('category'),
        value: categoryFilter,
        options: [
          { value: 'all', label: t('allCategories') },
          { value: 'Operational', label: t('operational') },
          { value: 'Financial', label: t('financial') },
          { value: 'Legal', label: t('legal') },
          { value: 'Contractual', label: t('contractual') },
          { value: 'Compliance', label: t('compliance') },
        ],
        onChange: setCategoryFilter,
      },
    ],
    [severityFilter, statusFilter, categoryFilter, t, tCommon]
  );

  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (severityFilter !== 'all') count++;
    if (statusFilter !== 'all') count++;
    if (categoryFilter !== 'all') count++;
    return count;
  }, [severityFilter, statusFilter, categoryFilter]);

  const handleClearFilters = () => {
    setSeverityFilter('all');
    setStatusFilter('all');
    setCategoryFilter('all');
    setSearchTerm('');
  };

  // Tabs
  const tabs: HudTab[] = useMemo(
    () => [
      {
        id: 'list',
        label: t('listView'),
        icon: <List className="w-4 h-4" />,
        content: (
          <HudPanel noPadding>
            <RiskList
              risks={filteredRisks}
              onViewRisk={(risk) => console.log('View:', risk)}
              onEditRisk={(risk) => console.log('Edit:', risk)}
              onResolveRisk={handleResolveRisk}
            />
          </HudPanel>
        ),
      },
      {
        id: 'matrix',
        label: t('matrixView'),
        icon: <LayoutGrid className="w-4 h-4" />,
        content: (
          <HudPanel>
            <RiskMatrix risks={filteredRisks} onRiskClick={(risk) => console.log('Click:', risk)} />
          </HudPanel>
        ),
      },
    ],
    [filteredRisks, t]
  );

  // Category and origin options for the modal
  const categoryOptions = useMemo(
    () => [
      { value: 'Operational', label: t('operational') },
      { value: 'Financial', label: t('financial') },
      { value: 'Legal', label: t('legal') },
      { value: 'Contractual', label: t('contractual') },
      { value: 'Compliance', label: t('compliance') },
    ],
    [t]
  );

  const severityOptions = useMemo(
    () => [
      { value: 'low', label: t('low') },
      { value: 'medium', label: t('medium') },
      { value: 'high', label: t('high') },
      { value: 'critical', label: t('critical') },
    ],
    [t]
  );

  const originOptions = useMemo(
    () => [
      { value: 'manual', label: t('manual') },
      { value: 'project', label: t('project') },
      { value: 'contract', label: t('contract') },
    ],
    [t]
  );

  return (
    <HudPageLayout>
      {/* Header */}
      <HudHeader
        title={t('title')}
        subtitle={t('subtitle')}
        icon={<ShieldAlert className="w-5 h-5" />}
        breadcrumbs={[{ label: t('title') }]}
        actions={
          <HudButton
            variant="primary"
            size="md"
            leftIcon={<Plus className="w-4 h-4" />}
            onClick={() => setCreateOpen(true)}
          >
            {t('newRisk')}
          </HudButton>
        }
      />

      {/* KPI Strip */}
      <HudKpiStrip kpis={kpiItems} columns={6} className="mb-6" />

      {/* Filters */}
      <HudFilterBar
        searchPlaceholder={t('searchPlaceholder')}
        searchValue={searchTerm}
        onSearchChange={setSearchTerm}
        filterGroups={filterGroups}
        activeFiltersCount={activeFiltersCount}
        onClearFilters={handleClearFilters}
        className="mb-6"
      />

      {/* Tabs */}
      <HudTabs
        tabs={tabs}
        activeTab={view}
        onTabChange={(v) => setView(v as typeof view)}
        variant="default"
      />

      {/* Create Modal */}
      <HudModal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        title={t('newRisk')}
        size="lg"
        footer={
          <>
            <HudButton variant="ghost" onClick={() => setCreateOpen(false)}>
              {tCommon('cancel')}
            </HudButton>
            <HudButton
              variant="primary"
              onClick={handleCreateRisk}
              disabled={!newRisk.title || !newRisk.description}
            >
              {tCommon('save')}
            </HudButton>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <HudInput
              label={t('title')}
              value={newRisk.title}
              onChange={(e) => setNewRisk((prev) => ({ ...prev, title: e.target.value }))}
              placeholder={t('titlePlaceholder')}
            />
            <HudSelect
              label={t('category')}
              value={newRisk.category}
              options={categoryOptions}
              onChange={(value) => setNewRisk((prev) => ({ ...prev, category: value as Risk['category'] }))}
            />
          </div>

          <div>
            <label className="text-[11px] font-medium text-white/60 uppercase tracking-wider mb-1.5 block">
              {t('description')}
            </label>
            <textarea
              value={newRisk.description}
              onChange={(e) => setNewRisk((prev) => ({ ...prev, description: e.target.value }))}
              placeholder={t('descriptionPlaceholder')}
              rows={4}
              className="w-full px-4 py-3 rounded-lg bg-white/[0.03] border border-white/[0.08] text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-cyan-500/30 focus:bg-white/[0.05] transition-all resize-none"
            />
          </div>

          <div className="grid md:grid-cols-3 gap-3">
            <HudInput
              label={t('probability')}
              type="number"
              min={1}
              max={5}
              value={newRisk.probability}
              onChange={(e) => setNewRisk((prev) => ({ ...prev, probability: Number(e.target.value) }))}
            />
            <HudInput
              label={t('impact')}
              type="number"
              min={1}
              max={5}
              value={newRisk.impact}
              onChange={(e) => setNewRisk((prev) => ({ ...prev, impact: Number(e.target.value) }))}
            />
            <HudSelect
              label={t('severity')}
              value={newRisk.severity}
              options={severityOptions}
              onChange={(value) => setNewRisk((prev) => ({ ...prev, severity: value as Risk['severity'] }))}
            />
          </div>

          <HudSelect
            label={t('origin')}
            value={newRisk.origin}
            options={originOptions}
            onChange={(value) => setNewRisk((prev) => ({ ...prev, origin: value as Risk['origin'] }))}
          />
        </div>
      </HudModal>
    </HudPageLayout>
  );
}
