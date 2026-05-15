'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Contract, Project } from '@/lib/types';
import { deleteProject, getProjectsAsync } from '@/lib/services/projects';
import { useContracts } from '@/hooks/use-contracts';
import { usePermissions } from '@/hooks/use-permissions';
import { ContractList } from '@/components/contracts/contract-list';
import { ContractUpload } from '@/components/contracts/contract-upload';
import {
  enrichContractsForGovernance,
  formatCurrencyCompact,
  type ContractGovernanceRecord,
} from '@/components/contracts/contract-governance-data';
import { contractRowToLegacyContract, createProjectFromContract } from '@/lib/contracts/contract-service';
import {
  HudBadge,
  HudButton,
  HudHeader,
  HudKpiStrip,
  HudPageLayout,
  HudPanel,
  HudProgressBar,
  HudStatusPill,
  HudTabs,
  type HudTab,
  type KpiItem,
} from '@/components/hud';
import {
  AlertTriangle,
  Archive,
  BarChart3,
  BrainCircuit,
  Building2,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Eye,
  FileSearch,
  FileSignature,
  FileText,
  GanttChartSquare,
  LayoutGrid,
  ListFilter,
  Plus,
  RefreshCcw,
  Scale,
  Search,
  ShieldAlert,
  ShieldCheck,
  Table2,
  Upload,
  Workflow,
} from 'lucide-react';
import { format } from 'date-fns';
import { pt } from 'date-fns/locale';

type SectionId = 'overview' | 'contracts' | 'ai' | 'renewals' | 'obligations' | 'risks' | 'documents' | 'audit';
type ViewMode = 'table' | 'cards' | 'risk';
type ExpiryFilter = 'all' | 'expired' | '30' | '90' | '180';

const sectionLabels: Record<SectionId, string> = {
  overview: 'Visão Geral',
  contracts: 'Contratos',
  ai: 'Análise IA',
  renewals: 'Renovações',
  obligations: 'Obrigações',
  risks: 'Riscos & Cláusulas',
  documents: 'Documentos',
  audit: 'Auditoria',
};

const riskLabels = { high: 'Alto', medium: 'Médio', low: 'Baixo' } as const;

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="mb-1.5 block text-ig-label text-ig-fg-muted">{children}</span>;
}

function SelectField({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="min-w-0">
      <FieldLabel>{label}</FieldLabel>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full rounded-lg border border-ig-border-strong bg-ig-panel px-3 text-xs font-medium text-ig-fg-strong outline-none transition-colors focus:border-ig-border-focus"
      >
        {children}
      </select>
    </label>
  );
}

function riskVariant(risk: Contract['riskClassification']) {
  return risk === 'high' ? 'critical' : risk === 'medium' ? 'warning' : 'active';
}

function renewalVariant(status: ContractGovernanceRecord['renewalStatus']) {
  if (status === 'expired' || status === 'critical') return 'critical';
  if (status === 'attention') return 'warning';
  if (status === 'planned') return 'info';
  return 'active';
}

export default function ContratosPage() {
  const router = useRouter();
  const { contracts: contractRows, loading, error, refresh, createContract: persistContract, deleteContract } = useContracts();
  const { hasPermission, loading: permissionsLoading } = usePermissions();
  const [projects, setProjects] = useState<Project[]>([]);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<SectionId>('overview');
  const [viewMode, setViewMode] = useState<ViewMode>('table');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [companyFilter, setCompanyFilter] = useState('all');
  const [projectFilter, setProjectFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [riskFilter, setRiskFilter] = useState('all');
  const [expiryFilter, setExpiryFilter] = useState<ExpiryFilter>('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    getProjectsAsync()
      .then(setProjects)
      .catch(() => setProjects([]));
  }, []);

  const contracts = useMemo(() => {
    return contractRows.map((row) => ({
      ...contractRowToLegacyContract(row),
      status: row.status as Contract['status'],
      projectId: row.project_id || undefined,
      contractType: row.contract_type || undefined,
      disableProjectAutoMatch: true,
    }));
  }, [contractRows]);

  const records = useMemo(() => enrichContractsForGovernance(contracts, projects), [contracts, projects]);
  const companies = useMemo(() => Array.from(new Set(records.map((record) => record.companyName))).sort(), [records]);
  const contractTypes = useMemo(() => Array.from(new Set(records.map((record) => record.contractType))).sort(), [records]);

  const filteredRecords = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return records.filter((record) => {
      const matchesQuery = !query
        || record.contract.name.toLowerCase().includes(query)
        || record.code.toLowerCase().includes(query)
        || record.companyName.toLowerCase().includes(query)
        || record.projectReference.toLowerCase().includes(query);
      const matchesCompany = companyFilter === 'all' || record.companyName === companyFilter;
      const matchesProject = projectFilter === 'all' || record.project?.id === projectFilter;
      const matchesStatus = statusFilter === 'all' || record.contract.status === statusFilter;
      const matchesRisk = riskFilter === 'all' || record.contract.riskClassification === riskFilter;
      const matchesType = typeFilter === 'all' || record.contractType === typeFilter;
      const matchesExpiry =
        expiryFilter === 'all'
        || (expiryFilter === 'expired' && record.daysUntilExpiration !== null && record.daysUntilExpiration < 0)
        || (expiryFilter !== 'expired' && record.daysUntilExpiration !== null && record.daysUntilExpiration >= 0 && record.daysUntilExpiration <= Number(expiryFilter));

      return matchesQuery && matchesCompany && matchesProject && matchesStatus && matchesRisk && matchesType && matchesExpiry;
    });
  }, [companyFilter, expiryFilter, projectFilter, records, riskFilter, searchTerm, statusFilter, typeFilter]);

  const selectedRecord = useMemo(() => {
    return filteredRecords.find((record) => record.contract.id === selectedId)
      || filteredRecords[0]
      || records[0]
      || null;
  }, [filteredRecords, records, selectedId]);

  const stats = useMemo(() => {
    const totalValue = records.reduce((sum, record) => sum + record.totalValue, 0);
    const billedValue = records.reduce((sum, record) => sum + record.billedValue, 0);
    const remainingValue = records.reduce((sum, record) => sum + record.remainingValue, 0);
    const expiring = records.filter((record) => record.daysUntilExpiration !== null && record.daysUntilExpiration >= 0 && record.daysUntilExpiration <= 90).length;
    const highRisk = records.filter((record) => record.contract.riskClassification === 'high').length;
    const missingDocs = records.reduce((sum, record) => sum + record.missingDocuments.length, 0);
    const legalReview = records.filter((record) => record.legalStatus !== 'approved').length;
    const obligations = records.flatMap((record) => record.obligations);
    const overdue = obligations.filter((obligation) => obligation.status === 'overdue').length;
    const avgSla = Math.round(18 + records.reduce((sum, record) => sum + (record.riskScore > 70 ? 8 : 2), 0) / Math.max(records.length, 1));

    return { totalValue, billedValue, remainingValue, expiring, highRisk, missingDocs, legalReview, overdue, avgSla };
  }, [records]);

  const kpis: KpiItem[] = [
    { id: 'exposure', label: 'Exposição total', value: formatCurrencyCompact(stats.totalValue), variant: 'info', icon: <FileSignature className="h-4 w-4" /> },
    { id: 'backlog', label: 'Backlog contratual', value: formatCurrencyCompact(stats.remainingValue), variant: 'warning', icon: <Clock3 className="h-4 w-4" /> },
    { id: 'billed', label: 'Valor faturado', value: formatCurrencyCompact(stats.billedValue), variant: 'success', icon: <CheckCircle2 className="h-4 w-4" /> },
    { id: 'renewals', label: 'Contratos a vencer', value: stats.expiring, variant: stats.expiring ? 'warning' : 'default', icon: <RefreshCcw className="h-4 w-4" /> },
    { id: 'high-risk', label: 'Alto risco', value: stats.highRisk, variant: stats.highRisk ? 'danger' : 'default', icon: <ShieldAlert className="h-4 w-4" /> },
    { id: 'missing-docs', label: 'Docs faltantes', value: stats.missingDocs, variant: stats.missingDocs ? 'warning' : 'default', icon: <Archive className="h-4 w-4" /> },
    { id: 'legal', label: 'Em revisão jurídica', value: stats.legalReview, variant: stats.legalReview ? 'warning' : 'default', icon: <Scale className="h-4 w-4" /> },
    { id: 'sla', label: 'SLA médio aprovação', value: `${stats.avgSla}h`, variant: 'info', icon: <ClipboardCheck className="h-4 w-4" /> },
  ];

  const clearFilters = () => {
    setSearchTerm('');
    setCompanyFilter('all');
    setProjectFilter('all');
    setStatusFilter('all');
    setRiskFilter('all');
    setExpiryFilter('all');
    setTypeFilter('all');
  };

  // owner_admin holds every permission via the catch-all CTE in
  // 005_auth_rbac_foundation.sql, so a permission-only check covers it
  // without inspecting role keys (RBAC audit R10).
  const canDeleteLinkedProject =
    hasPermission('projects.delete')
    || hasPermission('admin.manage_organization');

  const canDeleteContract =
    hasPermission('contracts.delete')
    || hasPermission('admin.manage_organization');

  const handleDeleteLinkedProject = async (record: ContractGovernanceRecord) => {
    if (!record.project) return;

    const confirmed = window.confirm(
      `Excluir o projeto vinculado "${record.project.nome}"?\n\nEssa ação remove o projeto do módulo Projetos e o contrato ficará sem projeto vinculado.`,
    );
    if (!confirmed) return;

    try {
      await deleteProject(record.project.id);
      const [nextProjects] = await Promise.all([
        getProjectsAsync(),
        refresh(),
      ]);
      setProjects(nextProjects);
      setSelectedId(record.contract.id);
      setNotice(`Projeto "${record.project.nome}" excluído. O contrato ficou sem projeto vinculado.`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Erro ao excluir projeto vinculado.');
    }
  };

  const handleDeleteContract = async (record: ContractGovernanceRecord) => {
    const confirmed = window.confirm(
      `Excluir o contrato "${record.contract.name}"?\n\nEssa ação remove o contrato e ele deixará de aparecer na lista, independentemente do status atual.`,
    );
    if (!confirmed) return;

    try {
      await deleteContract(record.contract.id);
      setSelectedId(null);
      setNotice(`Contrato "${record.contract.name}" excluído.`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Erro ao excluir contrato.');
    }
  };

  const handleContractCreated = async (
    contract: Contract,
    autoGeneratedRisk?: unknown,
    metadata?: { file?: File | null; projectId?: string | null; contractType?: string; status?: string; aiPlaceholderRequested?: boolean },
  ) => {
    const row = await persistContract({
      title: contract.name,
      counterpartyName: contract.vendorOrParty,
      contractType: metadata?.contractType || null,
      projectId: metadata?.projectId || null,
      status: metadata?.status || contract.status,
      lifecycleStage: metadata?.status || 'created',
      signedDate: contract.signingDate ? format(contract.signingDate, 'yyyy-MM-dd') : null,
      endDate: contract.expirationDate ? format(contract.expirationDate, 'yyyy-MM-dd') : null,
      renewalDate: contract.renewalDate ? format(contract.renewalDate, 'yyyy-MM-dd') : null,
      currency: contract.currency,
      totalValue: contract.value,
      scopeSummary: contract.notes || null,
      riskLevel: contract.riskClassification,
      file: metadata?.file || null,
      aiPlaceholderRequested: metadata?.aiPlaceholderRequested || false,
    });
    const shouldAutoCreateProject =
      !metadata?.projectId
      && ['signed', 'active'].includes(metadata?.status || contract.status);

    if (shouldAutoCreateProject) {
      try {
        const project = await createProjectFromContract(row.id);
        const [nextProjects] = await Promise.all([
          getProjectsAsync(),
          refresh(),
        ]);
        setProjects(nextProjects);
        setSelectedId(row.id);
        setActiveSection('contracts');
        setNotice(`Contrato salvo e projeto "${project.codigo}" criado automaticamente.`);
        return;
      } catch (err) {
        setSelectedId(row.id);
        setActiveSection('contracts');
        setNotice(err instanceof Error ? `Contrato salvo, mas o projeto automático falhou: ${err.message}` : 'Contrato salvo, mas o projeto automático falhou.');
        return;
      }
    }

    setSelectedId(row.id);
    setActiveSection('contracts');
    setNotice(autoGeneratedRisk ? 'Contrato salvo no Supabase. Risco de triagem permanece pendente para o modulo Riscos.' : 'Contrato salvo no Supabase com analise IA em placeholder seguro.');
  };

  const tabs: HudTab[] = [
    {
      id: 'overview',
      label: sectionLabels.overview,
      icon: <BarChart3 className="h-4 w-4" />,
      content: (
        <OverviewSection
          records={filteredRecords}
          selectedRecord={selectedRecord}
          canDeleteLinkedProject={canDeleteLinkedProject}
          canDeleteContract={canDeleteContract}
          onSelect={setSelectedId}
          onView={(record) => router.push(`/contratos/${record.contract.id}`)}
          onDeleteLinkedProject={handleDeleteLinkedProject}
          onDeleteContract={handleDeleteContract}
        />
      ),
    },
    {
      id: 'contracts',
      label: sectionLabels.contracts,
      icon: <Table2 className="h-4 w-4" />,
      badge: filteredRecords.length,
      content: (
        <ContractsSection
          records={filteredRecords}
          selectedId={selectedRecord?.contract.id || null}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          onSelect={(record) => setSelectedId(record.contract.id)}
          onView={(record) => router.push(`/contratos/${record.contract.id}`)}
          canDeleteLinkedProject={canDeleteLinkedProject}
          canDeleteContract={canDeleteContract}
          onDeleteLinkedProject={handleDeleteLinkedProject}
          onDeleteContract={handleDeleteContract}
        />
      ),
    },
    {
      id: 'ai',
      label: sectionLabels.ai,
      icon: <BrainCircuit className="h-4 w-4" />,
      content: <AiAnalysisSection selectedRecord={selectedRecord} />,
    },
    {
      id: 'renewals',
      label: sectionLabels.renewals,
      icon: <CalendarClock className="h-4 w-4" />,
      badge: stats.expiring,
      content: <RenewalsSection records={records} />,
    },
    {
      id: 'obligations',
      label: sectionLabels.obligations,
      icon: <ClipboardCheck className="h-4 w-4" />,
      badge: stats.overdue,
      content: <ObligationsSection records={records} />,
    },
    {
      id: 'risks',
      label: sectionLabels.risks,
      icon: <ShieldAlert className="h-4 w-4" />,
      badge: stats.highRisk,
      content: <RisksSection records={records} />,
    },
    {
      id: 'documents',
      label: sectionLabels.documents,
      icon: <FileText className="h-4 w-4" />,
      badge: stats.missingDocs,
      content: <DocumentsSection records={records} />,
    },
    {
      id: 'audit',
      label: sectionLabels.audit,
      icon: <ShieldCheck className="h-4 w-4" />,
      content: <AuditSection records={records} />,
    },
  ];

  return (
    <HudPageLayout>
      <HudHeader
        title="Gestão de Contratos"
        subtitle="Control room de governança contratual, documentos, obrigações, riscos, renovações e análise IA assistida."
        icon={<FileSignature className="h-5 w-5" />}
        breadcrumbs={[{ label: 'Gestão de Contratos' }]}
        actions={
          hasPermission('contracts.create') && !permissionsLoading ? (
          <HudButton variant="primary" size="md" leftIcon={<Plus className="h-4 w-4" />} onClick={() => setUploadOpen(true)}>
            Novo Contrato
          </HudButton>
          ) : null
        }
      />

      {(loading || error) && (
        <HudPanel elevation={1} state={error ? 'critical' : 'default'} interactive={false}>
          <p className="text-ig-body-sm text-ig-fg-strong">
            {error || 'Carregando contratos do Supabase...'}
          </p>
        </HudPanel>
      )}

      {notice && (
        <HudPanel elevation={1} state="warning" interactive={false}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2">
              <BrainCircuit className="mt-0.5 h-4 w-4 shrink-0 text-ig-warning" />
              <p className="text-ig-body-sm text-ig-fg-strong">{notice}</p>
            </div>
            <button className="text-ig-caption text-ig-fg-muted hover:text-ig-fg-strong" onClick={() => setNotice(null)}>
              dispensar
            </button>
          </div>
        </HudPanel>
      )}

      <HudKpiStrip kpis={kpis} columns={4} connected size="sm" className="mb-5" />

      <HudPanel title="Filtros de governança" icon={<ListFilter className="h-4 w-4" />} interactive={false}>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1.4fr_repeat(6,minmax(0,1fr))_auto] xl:items-end">
          <label className="min-w-0">
            <FieldLabel>Busca</FieldLabel>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ig-fg-subtle" />
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Contrato, código, empresa ou projeto"
                className="h-9 w-full rounded-lg border border-ig-border-strong bg-ig-panel pl-9 pr-3 text-xs font-medium text-ig-fg-strong outline-none transition-colors placeholder:text-ig-fg-subtle focus:border-ig-border-focus"
              />
            </div>
          </label>
          <SelectField label="Empresa vinculada" value={companyFilter} onChange={setCompanyFilter}>
            <option value="all">Todas</option>
            {companies.map((company) => <option key={company} value={company}>{company}</option>)}
          </SelectField>
          <SelectField label="Projeto vinculado" value={projectFilter} onChange={setProjectFilter}>
            <option value="all">Todos</option>
            {projects.slice(0, 80).map((project) => <option key={project.id} value={project.id}>{project.codigo}</option>)}
          </SelectField>
          <SelectField label="Status" value={statusFilter} onChange={setStatusFilter}>
            <option value="all">Todos</option>
            <option value="negotiation">Em negociação</option>
            <option value="legal_review">Revisão jurídica</option>
            <option value="commercial_review">Revisão comercial</option>
            <option value="signed">Assinado</option>
            <option value="active">Ativo</option>
            <option value="expiring_soon">Expirando</option>
            <option value="expired">Expirado</option>
            <option value="closed">Encerrado</option>
            <option value="cancelled">Cancelado</option>
          </SelectField>
          <SelectField label="Risco" value={riskFilter} onChange={setRiskFilter}>
            <option value="all">Todos</option>
            <option value="high">Alto</option>
            <option value="medium">Médio</option>
            <option value="low">Baixo</option>
          </SelectField>
          <SelectField label="Vencimento" value={expiryFilter} onChange={(value) => setExpiryFilter(value as ExpiryFilter)}>
            <option value="all">Todos</option>
            <option value="expired">Vencidos</option>
            <option value="30">Até 30d</option>
            <option value="90">Até 90d</option>
            <option value="180">Até 180d</option>
          </SelectField>
          <SelectField label="Tipo" value={typeFilter} onChange={setTypeFilter}>
            <option value="all">Todos</option>
            {contractTypes.map((type) => <option key={type} value={type}>{type}</option>)}
          </SelectField>
          <HudButton variant="ghost" size="sm" onClick={clearFilters}>
            Limpar
          </HudButton>
        </div>
      </HudPanel>

      <HudTabs
        tabs={tabs}
        activeTab={activeSection}
        onTabChange={(tabId) => setActiveSection(tabId as SectionId)}
        variant="underline"
        className="mt-5"
        contentClassName="mt-5"
      />

      <ContractUpload
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onContractCreated={handleContractCreated}
        projects={projects}
        companies={companies}
      />
    </HudPageLayout>
  );
}

function OverviewSection({
  records,
  selectedRecord,
  canDeleteLinkedProject,
  canDeleteContract,
  onSelect,
  onView,
  onDeleteLinkedProject,
  onDeleteContract,
}: {
  records: ContractGovernanceRecord[];
  selectedRecord: ContractGovernanceRecord | null;
  canDeleteLinkedProject: boolean;
  canDeleteContract: boolean;
  onSelect: (id: string) => void;
  onView: (record: ContractGovernanceRecord) => void;
  onDeleteLinkedProject: (record: ContractGovernanceRecord) => void;
  onDeleteContract: (record: ContractGovernanceRecord) => void;
}) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
      <div className="space-y-5">
        <ContractList
          records={records}
          selectedRecordId={selectedRecord?.contract.id || null}
          onSelectRecord={(record) => onSelect(record.contract.id)}
          onViewContract={onView}
          canDeleteLinkedProject={canDeleteLinkedProject}
          canDeleteContract={canDeleteContract}
          onDeleteLinkedProject={onDeleteLinkedProject}
          onDeleteContract={onDeleteContract}
        />
        <AnalyticsBand records={records} />
      </div>
      <ContractIntelligencePanel record={selectedRecord} onView={onView} />
    </div>
  );
}

function ContractsSection({
  records,
  selectedId,
  viewMode,
  onViewModeChange,
  onSelect,
  onView,
  canDeleteLinkedProject,
  canDeleteContract,
  onDeleteLinkedProject,
  onDeleteContract,
}: {
  records: ContractGovernanceRecord[];
  selectedId: string | null;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onSelect: (record: ContractGovernanceRecord) => void;
  onView: (record: ContractGovernanceRecord) => void;
  canDeleteLinkedProject: boolean;
  canDeleteContract: boolean;
  onDeleteLinkedProject: (record: ContractGovernanceRecord) => void;
  onDeleteContract: (record: ContractGovernanceRecord) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
        <div>
          <p className="text-ig-body-sm font-semibold text-ig-fg-strong">Fila de controle contratual</p>
          <p className="text-ig-caption text-ig-fg-muted">Tabela, cartões e visão de risco usam os mesmos registros filtrados.</p>
        </div>
        <div className="ig-glass inline-flex w-fit items-center gap-1 rounded-lg p-1" data-elev="1">
          <span data-ig-noise="" />
          <span data-ig-specular="" />
          <div data-ig-content="" className="flex gap-1">
            {[
              { id: 'table', icon: Table2, label: 'Tabela' },
              { id: 'cards', icon: LayoutGrid, label: 'Cards' },
              { id: 'risk', icon: ShieldAlert, label: 'Risco' },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => onViewModeChange(item.id as ViewMode)}
                className={`flex h-8 items-center gap-2 rounded-md px-3 text-xs font-semibold transition-colors ${viewMode === item.id ? 'bg-ig-accent-weak text-ig-accent' : 'text-ig-fg-muted hover:bg-ig-panel-hover hover:text-ig-fg-strong'}`}
              >
                <item.icon className="h-3.5 w-3.5" />
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {viewMode === 'table' && (
        <ContractList
          records={records}
          selectedRecordId={selectedId}
          onSelectRecord={onSelect}
          onViewContract={onView}
          canDeleteLinkedProject={canDeleteLinkedProject}
          canDeleteContract={canDeleteContract}
          onDeleteLinkedProject={onDeleteLinkedProject}
          onDeleteContract={onDeleteContract}
        />
      )}
      {viewMode === 'cards' && <ContractCards records={records} onSelect={onSelect} onView={onView} />}
      {viewMode === 'risk' && <RiskBoard records={records} onSelect={onSelect} />}
    </div>
  );
}

function ContractCards({
  records,
  onSelect,
  onView,
}: {
  records: ContractGovernanceRecord[];
  onSelect: (record: ContractGovernanceRecord) => void;
  onView: (record: ContractGovernanceRecord) => void;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {records.map((record) => (
        <div
          key={record.contract.id}
          role="button"
          tabIndex={0}
          onClick={() => onSelect(record)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onSelect(record);
            }
          }}
          className="text-left"
        >
          <HudPanel interactive sweep className="h-full">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <HudBadge variant="outline" size="sm">{record.code}</HudBadge>
                <p className="mt-2 line-clamp-2 text-ig-body-sm font-semibold text-ig-fg-strong">{record.contract.name}</p>
                <p className="mt-1 truncate text-ig-caption text-ig-fg-muted">{record.companyName}</p>
              </div>
              <HudStatusPill variant={riskVariant(record.contract.riskClassification)} size="sm">
                {riskLabels[record.contract.riskClassification]}
              </HudStatusPill>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Metric label="Total" value={formatCurrencyCompact(record.totalValue)} />
              <Metric label="Saldo" value={formatCurrencyCompact(record.remainingValue)} />
            </div>
            <div className="mt-4 flex items-center justify-between gap-2">
              <HudBadge variant={record.missingDocuments.length ? 'warning' : 'success'} size="sm">
                {record.missingDocuments.length} docs pendentes
              </HudBadge>
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  onView(record);
                }}
                className="flex items-center gap-1 text-ig-label text-ig-accent hover:text-ig-accent-strong"
              >
                <Eye className="h-3.5 w-3.5" />
                Dossiê
              </button>
            </div>
          </HudPanel>
        </div>
      ))}
    </div>
  );
}

function RiskBoard({ records, onSelect }: { records: ContractGovernanceRecord[]; onSelect: (record: ContractGovernanceRecord) => void }) {
  const lanes = [
    { id: 'high', label: 'Alto risco', variant: 'critical' },
    { id: 'medium', label: 'Risco médio', variant: 'warning' },
    { id: 'low', label: 'Baixo risco', variant: 'active' },
  ] as const;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {lanes.map((lane) => (
        <HudPanel key={lane.id} title={lane.label} badge={records.filter((record) => record.contract.riskClassification === lane.id).length} interactive={false}>
          <div className="space-y-2">
            {records.filter((record) => record.contract.riskClassification === lane.id).slice(0, 12).map((record) => (
              <button
                key={record.contract.id}
                onClick={() => onSelect(record)}
                className="w-full rounded-lg border border-ig-border-subtle bg-ig-panel/55 p-3 text-left transition-colors hover:border-ig-border-focus hover:bg-ig-panel-hover"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="line-clamp-2 text-ig-body-sm font-semibold text-ig-fg-strong">{record.contract.name}</p>
                  <HudStatusPill variant={lane.variant} size="sm">{record.riskScore}</HudStatusPill>
                </div>
                <p className="mt-1 truncate text-ig-caption text-ig-fg-muted">{record.companyName} · {record.owner}</p>
              </button>
            ))}
          </div>
        </HudPanel>
      ))}
    </div>
  );
}

function ContractIntelligencePanel({ record, onView }: { record: ContractGovernanceRecord | null; onView: (record: ContractGovernanceRecord) => void }) {
  if (!record) {
    return (
      <HudPanel title="Inteligência contratual" icon={<BrainCircuit className="h-4 w-4" />} interactive={false}>
        <div className="py-12 text-center">
          <FileText className="mx-auto mb-3 h-10 w-10 text-ig-fg-muted" />
          <p className="text-ig-body-sm text-ig-fg-muted">Selecione um contrato para ver o resumo.</p>
        </div>
      </HudPanel>
    );
  }

  return (
    <HudPanel title="Inteligência contratual" subtitle="Resumo executivo e governança" icon={<BrainCircuit className="h-4 w-4" />} interactive={false} className="xl:sticky xl:top-5">
      <div className="space-y-4">
        <div>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <HudBadge variant="outline" size="sm">{record.code}</HudBadge>
              <h2 className="mt-2 line-clamp-3 text-lg font-semibold text-ig-fg-strong">{record.contract.name}</h2>
              <p className="mt-1 truncate text-ig-body-sm text-ig-fg-muted">{record.companyReference}</p>
            </div>
            <HudStatusPill variant={riskVariant(record.contract.riskClassification)}>
              Risco {riskLabels[record.contract.riskClassification]}
            </HudStatusPill>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Metric label="Exposição" value={formatCurrencyCompact(record.totalValue)} />
          <Metric label="Saldo" value={formatCurrencyCompact(record.remainingValue)} />
          <Metric label="Risk score" value={`${record.riskScore}/100`} />
          <Metric label="Confiança IA mock" value={`${record.confidenceScore}%`} />
        </div>

        <div className="rounded-lg border border-ig-border-subtle bg-ig-panel/55 p-3">
          <p className="text-ig-label text-ig-fg-muted">Projeto vinculado</p>
          {record.project ? (
            <Link href={`/projetos/${record.project.id}`} className="mt-1 flex min-w-0 items-center gap-2 text-ig-body-sm font-semibold text-ig-accent hover:text-ig-accent-strong">
              <Workflow className="h-4 w-4 shrink-0" />
              <span className="truncate">{record.projectReference}</span>
            </Link>
          ) : (
            <p className="mt-1 text-ig-body-sm text-ig-fg-muted">Sem projeto vinculado</p>
          )}
        </div>

        <div className="space-y-2">
          {[
            { label: 'Aprovação', value: record.approvalRoute, icon: ShieldCheck },
            { label: 'Jurídico', value: record.legalStatus === 'approved' ? 'Aprovado' : record.legalStatus === 'review' ? 'Em revisão' : 'Pendente', icon: Scale },
            { label: 'Financeiro', value: record.financialStatus === 'ok' ? 'Sem bloqueio' : record.financialStatus === 'attention' ? 'Atenção' : 'Bloqueado', icon: GanttChartSquare },
          ].map((item) => (
            <div key={item.label} className="flex items-center justify-between gap-3 rounded-lg border border-ig-border-subtle bg-ig-panel/45 px-3 py-2">
              <span className="flex min-w-0 items-center gap-2 text-ig-body-sm text-ig-fg-muted">
                <item.icon className="h-4 w-4 shrink-0 text-ig-fg-subtle" />
                {item.label}
              </span>
              <span className="truncate text-right text-ig-body-sm font-semibold text-ig-fg-strong">{item.value}</span>
            </div>
          ))}
        </div>

        <HudPanel elevation={1} state="warning" interactive={false}>
          <div className="flex items-start gap-2">
            <BrainCircuit className="mt-0.5 h-4 w-4 shrink-0 text-ig-warning" />
            <p className="text-ig-caption text-ig-fg-muted">
              Análise IA em estado mock/pendente. Nenhuma cláusula foi lida por backend nesta versão da tela.
            </p>
          </div>
        </HudPanel>

        <HudButton fullWidth variant="primary" leftIcon={<FileSearch className="h-4 w-4" />} onClick={() => onView(record)}>
          Abrir dossiê do contrato
        </HudButton>
      </div>
    </HudPanel>
  );
}

function AnalyticsBand({ records }: { records: ContractGovernanceRecord[] }) {
  const byRisk = ['high', 'medium', 'low'].map((risk) => ({
    risk,
    count: records.filter((record) => record.contract.riskClassification === risk).length,
  }));
  const maxRisk = Math.max(...byRisk.map((item) => item.count), 1);
  const upcoming = records
    .filter((record) => record.daysUntilExpiration !== null)
    .sort((a, b) => (a.daysUntilExpiration || 0) - (b.daysUntilExpiration || 0))
    .slice(0, 5);

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <HudPanel title="Contratos por risco" icon={<ShieldAlert className="h-4 w-4" />} interactive={false}>
        <div className="space-y-3">
          {byRisk.map((item) => (
            <div key={item.risk}>
              <div className="mb-1 flex justify-between text-ig-caption">
                <span className="text-ig-fg-muted">{riskLabels[item.risk as keyof typeof riskLabels]}</span>
                <span className="ig-tabular font-semibold text-ig-fg-strong">{item.count}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-ig-panel-hover">
                <div className="h-full rounded-full bg-ig-accent" style={{ width: `${(item.count / maxRisk) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      </HudPanel>
      <HudPanel title="Próximas renovações" icon={<CalendarClock className="h-4 w-4" />} interactive={false}>
        <div className="space-y-2">
          {upcoming.map((record) => (
            <div key={record.contract.id} className="flex items-center justify-between gap-3 rounded-lg border border-ig-border-subtle bg-ig-panel/45 px-3 py-2">
              <span className="truncate text-ig-body-sm text-ig-fg-strong">{record.code}</span>
              <HudStatusPill variant={renewalVariant(record.renewalStatus)} size="sm">
                {record.daysUntilExpiration !== null && record.daysUntilExpiration < 0 ? 'vencido' : `${record.daysUntilExpiration}d`}
              </HudStatusPill>
            </div>
          ))}
        </div>
      </HudPanel>
      <HudPanel title="Obrigações por status" icon={<ClipboardCheck className="h-4 w-4" />} interactive={false}>
        <div className="grid grid-cols-2 gap-3">
          {[
            ['overdue', 'Atrasadas'],
            ['due_soon', 'Próximas'],
            ['open', 'Abertas'],
            ['done', 'Concluídas'],
          ].map(([status, label]) => (
            <Metric
              key={status}
              label={label}
              value={records.flatMap((record) => record.obligations).filter((obligation) => obligation.status === status).length}
            />
          ))}
        </div>
      </HudPanel>
    </div>
  );
}

function AiAnalysisSection({ selectedRecord }: { selectedRecord: ContractGovernanceRecord | null }) {
  const sections = [
    'Resumo executivo',
    'Cláusulas-chave',
    'Condições de pagamento',
    'Renovação e rescisão',
    'Penalidades e multas',
    'Obrigações de SLA',
    'Riscos legais',
    'Riscos financeiros',
    'Informações faltantes',
    'Documentos requeridos',
    'Ações de governança sugeridas',
    'Rota de aprovação recomendada',
  ];

  return (
    <div className="grid gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
      <HudPanel title="Entrada de análise" subtitle="Fluxo seguro sem chamada real de IA" icon={<BrainCircuit className="h-4 w-4" />} interactive={false}>
        <div className="space-y-4">
          <div className="rounded-xl border border-dashed border-ig-border-focus bg-ig-accent-weak/20 p-5 text-center">
            <Upload className="mx-auto mb-3 h-8 w-8 text-ig-accent" />
            <p className="text-ig-body-sm font-semibold text-ig-fg-strong">Upload de contrato</p>
            <p className="mt-1 text-ig-caption text-ig-fg-muted">Conecte um documento no fluxo Novo Contrato. Esta área está pronta para backend futuro.</p>
          </div>
          <div className="grid gap-3">
            <Metric label="Contrato selecionado" value={selectedRecord?.code || 'Nenhum'} />
            <Metric label="Empresa" value={selectedRecord?.companyName || 'Selecione na lista'} />
            <Metric label="Projeto vinculado" value={selectedRecord?.project?.codigo || 'Referência opcional'} />
          </div>
          <HudButton fullWidth variant="primary" leftIcon={<BrainCircuit className="h-4 w-4" />}>
            Iniciar análise mock
          </HudButton>
        </div>
      </HudPanel>

      <HudPanel title="Saída esperada da IA" subtitle="Estrutura de dossiê, atualmente mock/pendente" icon={<FileSearch className="h-4 w-4" />} interactive={false}>
        <div className="mb-4 rounded-lg border border-[color-mix(in_oklab,var(--ig-warning)_34%,transparent)] bg-[color-mix(in_oklab,var(--ig-warning)_10%,transparent)] p-3">
          <p className="text-ig-body-sm font-semibold text-ig-fg-strong">Análise simulada não conectada</p>
          <p className="mt-1 text-ig-caption text-ig-fg-muted">Não há afirmações documentais nesta prévia. Os blocos abaixo são placeholders de produto para futura integração.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {sections.map((section) => (
            <div key={section} className="rounded-lg border border-ig-border-subtle bg-ig-panel/45 p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-ig-body-sm font-semibold text-ig-fg-strong">{section}</p>
                <HudBadge variant="neutral" size="sm">mock</HudBadge>
              </div>
              <p className="mt-2 text-ig-caption text-ig-fg-muted">Aguardando motor de análise documental e fonte do contrato.</p>
            </div>
          ))}
        </div>
      </HudPanel>
    </div>
  );
}

function RenewalsSection({ records }: { records: ContractGovernanceRecord[] }) {
  const renewalRecords = [...records].sort((a, b) => (a.daysUntilExpiration ?? 9999) - (b.daysUntilExpiration ?? 9999)).slice(0, 18);
  return (
    <HudPanel title="Radar de renovações" icon={<CalendarClock className="h-4 w-4" />} interactive={false}>
      <div className="space-y-2">
        {renewalRecords.map((record) => (
          <div key={record.contract.id} className="grid gap-3 rounded-lg border border-ig-border-subtle bg-ig-panel/45 p-3 md:grid-cols-[1fr_150px_150px_170px] md:items-center">
            <div className="min-w-0">
              <p className="truncate text-ig-body-sm font-semibold text-ig-fg-strong">{record.contract.name}</p>
              <p className="truncate text-ig-caption text-ig-fg-muted">{record.companyName} · {record.projectReference}</p>
            </div>
            <HudStatusPill variant={renewalVariant(record.renewalStatus)} size="sm">
              {record.daysUntilExpiration !== null && record.daysUntilExpiration < 0 ? 'Vencido' : `${record.daysUntilExpiration ?? '-'} dias`}
            </HudStatusPill>
            <span className="text-ig-caption text-ig-fg-muted">
              {record.contract.expirationDate ? format(new Date(record.contract.expirationDate), 'dd/MM/yyyy', { locale: pt }) : 'Sem data'}
            </span>
            <span className="text-ig-caption font-semibold text-ig-fg-strong">{record.approvalRoute}</span>
          </div>
        ))}
      </div>
    </HudPanel>
  );
}

function ObligationsSection({ records }: { records: ContractGovernanceRecord[] }) {
  const obligations = records.flatMap((record) => record.obligations.map((obligation) => ({ ...obligation, record })));
  return (
    <HudPanel title="Obrigações contratuais" icon={<ClipboardCheck className="h-4 w-4" />} interactive={false}>
      <div className="space-y-2">
        {obligations.slice(0, 36).map((item) => (
          <div key={item.id} className="grid gap-3 rounded-lg border border-ig-border-subtle bg-ig-panel/45 p-3 md:grid-cols-[1fr_180px_110px_180px] md:items-center">
            <div className="min-w-0">
              <p className="truncate text-ig-body-sm font-semibold text-ig-fg-strong">{item.title}</p>
              <p className="truncate text-ig-caption text-ig-fg-muted">{item.record.code} · {item.evidence}</p>
            </div>
            <span className="truncate text-ig-body-sm text-ig-fg-muted">{item.owner}</span>
            <HudStatusPill
              variant={item.status === 'overdue' ? 'critical' : item.status === 'due_soon' ? 'warning' : item.status === 'done' ? 'active' : 'neutral'}
              size="sm"
            >
              {item.status === 'overdue' ? 'Atrasada' : item.status === 'due_soon' ? 'Próxima' : item.status === 'done' ? 'Concluída' : 'Aberta'}
            </HudStatusPill>
            <span className="text-ig-caption text-ig-fg-muted">{format(new Date(item.dueDate), 'dd/MM/yyyy', { locale: pt })}</span>
          </div>
        ))}
      </div>
    </HudPanel>
  );
}

function RisksSection({ records }: { records: ContractGovernanceRecord[] }) {
  const clauses = records.flatMap((record) => record.clauses.map((clause) => ({ ...clause, record })));
  return (
    <div className="grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
      <HudPanel title="Mapa de risco" icon={<ShieldAlert className="h-4 w-4" />} interactive={false}>
        <div className="space-y-4">
          {['high', 'medium', 'low'].map((risk) => {
            const count = records.filter((record) => record.contract.riskClassification === risk).length;
            return (
              <div key={risk}>
                <div className="mb-1 flex justify-between text-ig-caption">
                  <span className="text-ig-fg-muted">{riskLabels[risk as keyof typeof riskLabels]}</span>
                  <span className="ig-tabular font-semibold text-ig-fg-strong">{count}</span>
                </div>
                <HudProgressBar value={Math.round((count / Math.max(records.length, 1)) * 100)} variant={risk === 'high' ? 'danger' : risk === 'medium' ? 'warning' : 'success'} />
              </div>
            );
          })}
        </div>
      </HudPanel>
      <HudPanel title="Cláusulas monitoradas" icon={<Scale className="h-4 w-4" />} interactive={false}>
        <div className="grid gap-3 md:grid-cols-2">
          {clauses.slice(0, 18).map((clause) => (
            <div key={clause.id} className="rounded-lg border border-ig-border-subtle bg-ig-panel/45 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-ig-body-sm font-semibold text-ig-fg-strong">{clause.title}</p>
                  <p className="mt-1 text-ig-caption text-ig-fg-muted">{clause.record.code} · {clause.category}</p>
                </div>
                <HudStatusPill variant={riskVariant(clause.risk)} size="sm">{riskLabels[clause.risk]}</HudStatusPill>
              </div>
              <p className="mt-2 text-ig-caption text-ig-fg-muted">{clause.note}</p>
            </div>
          ))}
        </div>
      </HudPanel>
    </div>
  );
}

function DocumentsSection({ records }: { records: ContractGovernanceRecord[] }) {
  return (
    <HudPanel title="Documentos e pendências" icon={<Archive className="h-4 w-4" />} interactive={false}>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {records.slice(0, 24).map((record) => (
          <div key={record.contract.id} className="rounded-lg border border-ig-border-subtle bg-ig-panel/45 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-ig-body-sm font-semibold text-ig-fg-strong">{record.code}</p>
                <p className="truncate text-ig-caption text-ig-fg-muted">{record.contract.fileName || record.contract.name}</p>
              </div>
              <HudBadge variant={record.missingDocuments.length ? 'warning' : 'success'} size="sm">
                {record.missingDocuments.length ? `${record.missingDocuments.length} faltando` : 'Completo'}
              </HudBadge>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {(record.missingDocuments.length ? record.missingDocuments : ['Documento assinado', 'Matriz de obrigações']).map((doc) => (
                <HudBadge key={doc} variant={record.missingDocuments.includes(doc) ? 'warning' : 'success'} size="sm">
                  {doc}
                </HudBadge>
              ))}
            </div>
          </div>
        ))}
      </div>
    </HudPanel>
  );
}

function AuditSection({ records }: { records: ContractGovernanceRecord[] }) {
  const events = records.flatMap((record) => record.auditEvents.map((event) => ({ ...event, record })))
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, 30);
  return (
    <HudPanel title="Linha auditável" subtitle="Upload, revisão, IA mock, aprovações e pendências" icon={<ShieldCheck className="h-4 w-4" />} interactive={false}>
      <div className="relative space-y-3">
        <div className="absolute bottom-0 left-[15px] top-0 w-px bg-ig-border-subtle" />
        {events.map((event) => (
          <div key={event.id} className="relative flex gap-3">
            <span className={`mt-1 h-8 w-8 shrink-0 rounded-full border bg-ig-panel ${event.status === 'done' ? 'border-[color-mix(in_oklab,var(--ig-success)_40%,transparent)]' : event.status === 'warning' ? 'border-[color-mix(in_oklab,var(--ig-warning)_40%,transparent)]' : 'border-[color-mix(in_oklab,var(--ig-danger)_40%,transparent)]'}`} />
            <div className="min-w-0 flex-1 rounded-lg border border-ig-border-subtle bg-ig-panel/45 p-3">
              <div className="flex flex-col justify-between gap-2 md:flex-row md:items-start">
                <div className="min-w-0">
                  <p className="truncate text-ig-body-sm font-semibold text-ig-fg-strong">{event.title}</p>
                  <p className="truncate text-ig-caption text-ig-fg-muted">{event.record.code} · {event.actor}</p>
                </div>
                <span className="shrink-0 text-ig-caption text-ig-fg-muted">{format(new Date(event.at), 'dd/MM/yyyy HH:mm', { locale: pt })}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </HudPanel>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-ig-border-subtle bg-ig-panel/45 p-3">
      <p className="truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-ig-fg-subtle">{label}</p>
      <p className="mt-1 truncate text-base font-semibold tabular-nums text-ig-fg-strong">{value}</p>
    </div>
  );
}
