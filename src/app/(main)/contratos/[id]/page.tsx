'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { getProjectsAsync } from '@/lib/services/projects';
import { useContractDetail } from '@/hooks/use-contract-detail';
import { usePermissions } from '@/hooks/use-permissions';
import { useContractActionModals } from '@/components/contracts/useContractActionModals';
import { useContractCreateModals } from '@/components/contracts/useContractCreateModals';
import type { Project } from '@/lib/types';
import {
  enrichContractsForGovernance,
  formatCurrencyCompact,
  formatCurrencyFull,
  type ContractGovernanceRecord,
} from '@/components/contracts/contract-governance-data';
import { contractRowToLegacyContract, createProjectFromContract, type ContractDetail } from '@/lib/contracts/contract-service';
import { triggerContractAiScan } from '@/lib/services/risks';
import { openContractDossierReport } from '@/lib/reports/modules/contract-dossier-report';
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
  useHudToast,
  type HudTab,
  type KpiItem,
} from '@/components/hud';
import {
  ArrowLeft,
  Archive,
  BrainCircuit,
  Building2,
  CalendarClock,
  ClipboardCheck,
  Download,
  FileSignature,
  FileText,
  GanttChartSquare,
  Plus,
  Receipt,
  Scale,
  ShieldAlert,
  ShieldCheck,
  Workflow,
} from 'lucide-react';
import { format } from 'date-fns';
import { pt } from 'date-fns/locale';

type DetailTab = 'summary' | 'clauses' | 'obligations' | 'risks' | 'finance' | 'documents' | 'audit' | 'ai';

const DETAIL_TABS: DetailTab[] = ['summary', 'clauses', 'obligations', 'risks', 'finance', 'documents', 'audit', 'ai'];

const riskLabels = { high: 'Alto', medium: 'Médio', low: 'Baixo' } as const;

function riskVariant(risk: ContractGovernanceRecord['contract']['riskClassification']) {
  return risk === 'high' ? 'critical' : risk === 'medium' ? 'warning' : 'active';
}

export default function ContractDossierPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const contractId = String(params.id || '');
  const { detail, loading, error, refresh } = useContractDetail(contractId);
  const { hasPermission } = usePermissions();
  const { notify } = useHudToast();
  const [projects, setProjects] = useState<Project[]>([]);
  const initialTab = searchParams.get('tab') as DetailTab | null;
  const [activeTab, setActiveTab] = useState<DetailTab>(initialTab && DETAIL_TABS.includes(initialTab) ? initialTab : 'summary');
  const [creatingProject, setCreatingProject] = useState(false);
  const [flowNotice, setFlowNotice] = useState<string | null>(null);
  const [scanningAi, setScanningAi] = useState(false);

  const canScanAi = hasPermission('risks.ai_scan');

  const handleAiScan = async () => {
    if (!contractId) return;
    if (!window.confirm('Disparar análise de risco com IA? Isso pode levar até 1 minuto e consome tokens.')) return;
    setScanningAi(true);
    setFlowNotice(null);
    try {
      const { count } = await triggerContractAiScan(contractId);
      setFlowNotice(`${count} risco(s) gerado(s) pela IA. Veja em /riscos.`);
    } catch (err) {
      setFlowNotice(err instanceof Error ? err.message : 'Erro na análise IA.');
    } finally {
      setScanningAi(false);
    }
  };

  useEffect(() => {
    getProjectsAsync()
      .then(setProjects)
      .catch(() => setProjects([]));
  }, []);

  const records = useMemo(() => {
    if (!detail) return [];
    const legacy = {
      ...contractRowToLegacyContract(detail.contract, detail.files),
      status: detail.contract.status as ContractGovernanceRecord['contract']['status'],
      projectId: detail.contract.project_id || undefined,
      contractType: detail.contract.contract_type || undefined,
      disableProjectAutoMatch: true,
    };
    return enrichContractsForGovernance([legacy], projects);
  }, [detail, projects]);
  const record = useMemo(() => {
    return records.find((item) => item.contract.id === contractId) || records[0] || null;
  }, [contractId, records]);

  const refreshDetailAndProjects = async () => {
    const [nextProjects] = await Promise.all([getProjectsAsync(), refresh()]);
    setProjects(nextProjects);
  };

  const { actions: contractActions, modals: contractActionModals } = useContractActionModals({
    projects,
    onRefresh: refreshDetailAndProjects,
  });

  const canEditContract = hasPermission('contracts.edit') || hasPermission('admin.manage_organization');
  const { openObligation, openBilling, modals: contractCreateModals } = useContractCreateModals({
    contractId,
    ownerUserId: detail?.contract.owner_user_id ?? null,
    onRefresh: async () => {
      await refresh();
    },
  });

  const handleExportPdf = () => {
    if (!record) return;
    const result = openContractDossierReport({ record, source: 'Supabase' });
    if (!result.ok) {
      notify('Não foi possível gerar o PDF', { description: result.message ?? 'Falha ao montar o dossiê.', variant: 'error' });
    }
  };

  if (loading || error || !record || !detail) {
    return (
      <HudPageLayout>
        <HudPanel title={loading ? 'Carregando contrato' : 'Contrato não encontrado'} state={error ? 'critical' : 'default'} interactive={false}>
          <p className="mb-4 text-ig-body-sm text-ig-fg-muted">
            {error || (loading ? 'Lendo dossie contratual do Supabase...' : 'Nenhum contrato acessivel foi encontrado para este identificador.')}
          </p>
          <HudButton variant="secondary" leftIcon={<ArrowLeft className="h-4 w-4" />} onClick={() => router.push('/contratos')}>
            Voltar para contratos
          </HudButton>
        </HudPanel>
      </HudPageLayout>
    );
  }

  // KPIs clicáveis (padrão Contratos): atalhos para a aba do dossiê correspondente.
  const kpis: KpiItem[] = [
    { id: 'total', label: 'Valor total', value: formatCurrencyCompact(record.totalValue), variant: 'info', icon: <FileSignature className="h-4 w-4" />, onClick: () => setActiveTab('finance'), active: activeTab === 'finance' },
    { id: 'billed', label: 'Faturado', value: formatCurrencyCompact(record.billedValue), variant: 'success', icon: <Receipt className="h-4 w-4" />, onClick: () => setActiveTab('finance'), active: activeTab === 'finance' },
    { id: 'remaining', label: 'Saldo', value: formatCurrencyCompact(record.remainingValue), variant: 'warning', icon: <GanttChartSquare className="h-4 w-4" />, onClick: () => setActiveTab('finance'), active: activeTab === 'finance' },
    { id: 'renewal', label: 'Vencimento', value: record.daysUntilExpiration === null ? 'sem data' : record.daysUntilExpiration < 0 ? 'vencido' : `${record.daysUntilExpiration}d`, variant: record.daysUntilExpiration !== null && record.daysUntilExpiration <= 90 ? 'warning' : 'default', icon: <CalendarClock className="h-4 w-4" />, onClick: () => setActiveTab('obligations'), active: activeTab === 'obligations' },
    { id: 'risk', label: 'Risk score', value: `${record.riskScore}/100`, variant: record.riskScore >= 70 ? 'danger' : record.riskScore >= 50 ? 'warning' : 'success', icon: <ShieldAlert className="h-4 w-4" />, onClick: () => setActiveTab('risks'), active: activeTab === 'risks' },
  ];

  const contractStatusLabel =
    detail.contract.status === 'negotiation' ? 'Em negociação'
      : detail.contract.status === 'legal_review' ? 'Revisão jurídica'
        : detail.contract.status === 'commercial_review' ? 'Revisão comercial'
          : detail.contract.status === 'signed' ? 'Assinado'
            : detail.contract.status === 'active' ? 'Ativo'
              : detail.contract.status === 'closed' ? 'Encerrado'
                : detail.contract.status === 'cancelled' ? 'Cancelado'
                  : detail.contract.status;

  const canCreateProjectFromContract =
    !detail.contract.project_id
    && ['signed', 'active'].includes(detail.contract.status)
    && (hasPermission('contracts.edit') || hasPermission('projects.create'));

  const handleCreateProject = async () => {
    setCreatingProject(true);
    setFlowNotice(null);
    try {
      const project = await createProjectFromContract(contractId);
      await refresh();
      const nextProjects = await getProjectsAsync();
      setProjects(nextProjects);
      setFlowNotice(`Projeto ${project.codigo} criado e vinculado ao contrato.`);
    } catch (err) {
      setFlowNotice(err instanceof Error ? err.message : 'Erro ao criar projeto a partir do contrato.');
    } finally {
      setCreatingProject(false);
    }
  };

  const tabs: HudTab[] = [
    { id: 'summary', label: 'Resumo', icon: <FileText className="h-4 w-4" />, content: <SummaryTab record={record} /> },
    { id: 'clauses', label: 'Cláusulas', icon: <Scale className="h-4 w-4" />, content: <ClausesTab record={record} detail={detail} /> },
    { id: 'obligations', label: 'Timeline', icon: <ClipboardCheck className="h-4 w-4" />, badge: detail.milestones.filter((item) => item.status !== 'completed').length, content: <ObligationsTab record={record} detail={detail} onNewObligation={canEditContract ? openObligation : undefined} /> },
    { id: 'risks', label: 'Mapa de Riscos', icon: <ShieldAlert className="h-4 w-4" />, content: <RisksTab record={record} detail={detail} /> },
    { id: 'finance', label: 'Billing', icon: <Receipt className="h-4 w-4" />, content: <FinanceTab record={record} detail={detail} onNewBilling={canEditContract ? openBilling : undefined} /> },
    { id: 'documents', label: 'Arquivos', icon: <Archive className="h-4 w-4" />, badge: detail.files.length + detail.documents.length, content: <DocumentsTab record={record} detail={detail} /> },
    { id: 'audit', label: 'Auditoria', icon: <ShieldCheck className="h-4 w-4" />, content: <AuditTab record={record} detail={detail} /> },
    { id: 'ai', label: 'Análise IA', icon: <BrainCircuit className="h-4 w-4" />, content: <AiTab record={record} detail={detail} /> },
  ];

  return (
    <HudPageLayout>
      <HudHeader
        title={record.contract.name}
        subtitle="Dossiê contratual com vínculos, exposição financeira, obrigações, riscos, documentos, auditoria e análise IA mock/pendente."
        icon={<FileSignature className="h-5 w-5" />}
        breadcrumbs={[{ label: 'Contratos', href: '/contratos' }, { label: record.code }]}
        statusChips={[
          { label: `Risco ${riskLabels[record.contract.riskClassification]}`, variant: record.contract.riskClassification === 'high' ? 'critical' : record.contract.riskClassification === 'medium' ? 'warning' : 'success' },
          { label: contractStatusLabel, variant: detail.contract.status === 'cancelled' || detail.contract.status === 'expired' ? 'critical' : detail.contract.status.includes('review') || detail.contract.status === 'negotiation' ? 'warning' : 'success' },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <HudButton variant="secondary" size="md" leftIcon={<ArrowLeft className="h-4 w-4" />} onClick={() => router.push('/contratos')}>
              Voltar
            </HudButton>
            {canCreateProjectFromContract && (
              <HudButton variant="primary" size="md" leftIcon={<Workflow className="h-4 w-4" />} disabled={creatingProject} onClick={handleCreateProject}>
                {creatingProject ? 'Criando...' : 'Criar projeto'}
              </HudButton>
            )}
            {canScanAi && (
              <HudButton variant="glass" size="md" leftIcon={<BrainCircuit className="h-4 w-4" />} disabled={scanningAi} onClick={handleAiScan}>
                {scanningAi ? 'Analisando...' : 'Analisar com IA'}
              </HudButton>
            )}
            <HudButton variant="secondary" size="md" leftIcon={<Workflow className="h-4 w-4" />} onClick={() => contractActions.linkProject(record)}>
              Vincular projeto
            </HudButton>
            <HudButton variant="secondary" size="md" leftIcon={<ClipboardCheck className="h-4 w-4" />} onClick={() => contractActions.createTask(record)}>
              Criar tarefa
            </HudButton>
            <HudButton variant="secondary" size="md" leftIcon={<ShieldAlert className="h-4 w-4" />} onClick={() => contractActions.createRisk(record)}>
              Criar risco
            </HudButton>
            <HudButton variant="secondary" size="md" leftIcon={<Scale className="h-4 w-4" />} onClick={() => contractActions.sendToLegal(record)}>
              Enviar ao jurídico
            </HudButton>
            <HudButton variant="glass" size="md" leftIcon={<Archive className="h-4 w-4" />} onClick={() => contractActions.attachDocument(record)}>
              Anexar documento
            </HudButton>
            <HudButton variant="glass" size="md" leftIcon={<Download className="h-4 w-4" />} onClick={handleExportPdf}>
              Exportar PDF
            </HudButton>
          </div>
        }
      />

      {!detail.contract.project_id && ['signed', 'active'].includes(detail.contract.status) && (
        <HudPanel elevation={1} state="warning" interactive={false}>
          <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
            <div>
              <p className="text-ig-body-sm font-semibold text-ig-fg-strong">Contrato assinado sem projeto vinculado</p>
              <p className="mt-1 text-ig-caption text-ig-fg-muted">O contrato ja pode abrir projeto de execucao. O projeto herdara cliente, valor, escopo e datas principais.</p>
            </div>
            {canCreateProjectFromContract && (
              <HudButton variant="primary" size="sm" leftIcon={<Workflow className="h-4 w-4" />} disabled={creatingProject} onClick={handleCreateProject}>
                Criar projeto
              </HudButton>
            )}
          </div>
        </HudPanel>
      )}

      {flowNotice && (
        <HudPanel elevation={1} state={flowNotice.includes('Erro') || flowNotice.includes('nao') || flowNotice.includes('não') ? 'critical' : 'success'} interactive={false}>
          <p className="text-ig-body-sm text-ig-fg-strong">{flowNotice}</p>
        </HudPanel>
      )}

      <HudKpiStrip kpis={kpis} columns={5} connected size="sm" />

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          <HudTabs
            tabs={tabs}
            activeTab={activeTab}
            onTabChange={(tabId) => setActiveTab(tabId as DetailTab)}
            variant="underline"
          />
        </div>
        <SideTimeline record={record} />
      </div>

      {contractActionModals}
      {contractCreateModals}
    </HudPageLayout>
  );
}

function SummaryTab({ record }: { record: ContractGovernanceRecord }) {
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_0.9fr]">
      <HudPanel title="Resumo executivo" icon={<FileText className="h-4 w-4" />} interactive={false}>
        <div className="space-y-4">
          <p className="text-ig-body-sm leading-relaxed text-ig-fg-muted">
            Este dossiê centraliza o contrato como fonte de verdade documental e de governança. Empresas e projetos aparecem como vínculos de referência, sem duplicar seus cadastros.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            <Metric label="Código" value={record.code} />
            <Metric label="Tipo" value={record.contractType} />
            <Metric label="Empresa vinculada" value={record.companyName} />
            <Metric label="Responsável" value={record.owner} />
          </div>
          {record.contract.notes && (
            <div className="rounded-lg border border-ig-border-subtle bg-ig-panel/45 p-3">
              <p className="text-ig-label text-ig-fg-muted">Observações</p>
              <p className="mt-1 text-ig-body-sm text-ig-fg-strong">{record.contract.notes}</p>
            </div>
          )}
        </div>
      </HudPanel>

      <HudPanel title="Entidades relacionadas" icon={<Workflow className="h-4 w-4" />} interactive={false}>
        <div className="space-y-3">
          <Relation icon={<Building2 className="h-4 w-4" />} label="Empresa" value={record.companyReference} />
          {record.project ? (
            <Link href={`/projetos/${record.project.id}`}>
              <Relation icon={<Workflow className="h-4 w-4" />} label="Projeto" value={record.projectReference} link />
            </Link>
          ) : (
            <Relation icon={<Workflow className="h-4 w-4" />} label="Projeto" value="Sem projeto vinculado" />
          )}
          <Relation icon={<Receipt className="h-4 w-4" />} label="Financeiro" value="Referência de faturamento e backlog" />
          <Relation icon={<ShieldCheck className="h-4 w-4" />} label="Aprovação" value={record.approvalRoute} />
          {record.linkedTasks.length > 0 && (
            <Relation icon={<ClipboardCheck className="h-4 w-4" />} label="Tarefas de agenda" value={`${record.linkedTasks.length} tarefa(s) vinculada(s)`} />
          )}
          {record.linkedDeliberations.length > 0 && (
            <Relation icon={<Scale className="h-4 w-4" />} label="Deliberações" value={record.linkedDeliberations.map((d) => d.committeeName).join(' · ')} />
          )}
        </div>
      </HudPanel>
    </div>
  );
}

function ClausesTab({ record, detail }: { record: ContractGovernanceRecord; detail: ContractDetail }) {
  const clauses = detail.clauses.length > 0
    ? detail.clauses.map((clause) => ({
        id: clause.id,
        title: clause.title,
        category: clause.clause_type || 'Clausula',
        risk: clause.risk_level,
        status: clause.ai_flagged ? 'Em revisao' : 'Mapeada',
        note: clause.content || 'Clausula cadastrada sem conteudo detalhado.',
      }))
    : record.clauses.map((clause) => ({
        id: clause.id,
        title: clause.title,
        category: clause.category,
        risk: clause.risk,
        status: 'Placeholder',
        note: 'Placeholder ate haver clausulas persistidas no Supabase.',
      }));

  return (
    <HudPanel title="Cláusulas monitoradas" icon={<Scale className="h-4 w-4" />} interactive={false}>
      <div className="grid gap-3 md:grid-cols-2">
        {clauses.map((clause) => (
          <div key={clause.id} className="rounded-lg border border-ig-border-subtle bg-ig-panel/45 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-ig-body-sm font-semibold text-ig-fg-strong">{clause.title}</p>
                <p className="mt-1 text-ig-caption text-ig-fg-muted">{clause.category} · {clause.status}</p>
              </div>
              <HudStatusPill variant={riskVariant(clause.risk)} size="sm">{riskLabels[clause.risk]}</HudStatusPill>
            </div>
            <p className="mt-3 text-ig-caption leading-relaxed text-ig-fg-muted">{clause.note}</p>
          </div>
        ))}
      </div>
    </HudPanel>
  );
}

function ObligationsTab({ record, detail, onNewObligation }: { record: ContractGovernanceRecord; detail: ContractDetail; onNewObligation?: () => void }) {
  const items = detail.obligations.length > 0
    ? detail.obligations.map((obligation) => ({
        id: obligation.id,
        title: obligation.title,
        evidence: obligation.evidence || obligation.description || 'Obrigação contratual',
        owner: record.owner,
        status: obligation.status,
        dueDate: obligation.due_date ? new Date(`${obligation.due_date}T00:00:00`) : new Date(),
      }))
    : detail.milestones.length > 0
      ? detail.milestones.map((milestone) => ({
          id: milestone.id,
          title: milestone.title,
          evidence: milestone.description || milestone.milestone_type || 'Marco contratual',
          owner: record.owner,
          status: milestone.status === 'completed' ? 'done' : milestone.status === 'overdue' ? 'overdue' : 'open',
          dueDate: milestone.due_date ? new Date(`${milestone.due_date}T00:00:00`) : new Date(),
        }))
      : record.obligations.map((obligation) => ({ ...obligation, evidence: `${obligation.evidence} (placeholder)` }));

  const isPersisted = detail.obligations.length > 0;

  return (
    <HudPanel
      title="Obrigações por responsável"
      subtitle={isPersisted ? `${detail.obligations.length} obrigações persistidas` : 'Marcos e obrigações do dossiê'}
      icon={<ClipboardCheck className="h-4 w-4" />}
      interactive={false}
    >
      {onNewObligation && (
        <div className="mb-3 flex justify-end">
          <HudButton variant="secondary" size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={onNewObligation}>
            Nova obrigação
          </HudButton>
        </div>
      )}
      <div className="space-y-2">
        {items.map((obligation) => (
          <div key={obligation.id} className="grid gap-3 rounded-lg border border-ig-border-subtle bg-ig-panel/45 p-3 md:grid-cols-[1fr_180px_120px_130px] md:items-center">
            <div className="min-w-0">
              <p className="truncate text-ig-body-sm font-semibold text-ig-fg-strong">{obligation.title}</p>
              <p className="truncate text-ig-caption text-ig-fg-muted">{obligation.evidence}</p>
            </div>
            <span className="truncate text-ig-body-sm text-ig-fg-muted">{obligation.owner}</span>
            <HudStatusPill variant={obligation.status === 'overdue' ? 'critical' : obligation.status === 'due_soon' ? 'warning' : obligation.status === 'done' ? 'active' : 'neutral'} size="sm">
              {obligation.status === 'overdue' ? 'Atrasada' : obligation.status === 'due_soon' ? 'Próxima' : obligation.status === 'done' ? 'Concluída' : 'Aberta'}
            </HudStatusPill>
            <span className="text-ig-caption text-ig-fg-muted">{format(new Date(obligation.dueDate), 'dd/MM/yyyy', { locale: pt })}</span>
          </div>
        ))}
      </div>
    </HudPanel>
  );
}

function RisksTab({ record, detail }: { record: ContractGovernanceRecord; detail: ContractDetail }) {
  const contractRisks = detail.risks;
  return (
    <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
      <HudPanel title="Risk score" icon={<ShieldAlert className="h-4 w-4" />} interactive={false}>
        <div className="text-center">
          <div className="mx-auto flex h-28 w-28 items-center justify-center rounded-full border border-ig-border-focus bg-ig-accent-weak">
            <span className="text-3xl font-semibold tabular-nums text-ig-accent">{record.riskScore}</span>
          </div>
          <p className="mt-3 text-ig-body-sm font-semibold text-ig-fg-strong">Classificação {riskLabels[record.contract.riskClassification]}</p>
          <p className="mt-1 text-ig-caption text-ig-fg-muted">Score derivado de risco cadastral, vencimento e documentos faltantes.</p>
        </div>
      </HudPanel>
      <div className="space-y-5">
        <HudPanel title="Riscos legais e financeiros" icon={<Scale className="h-4 w-4" />} interactive={false}>
          <div className="grid gap-3 md:grid-cols-2">
            <Metric label="Riscos persistidos" value={contractRisks.length} />
            <Metric label="Riscos abertos" value={contractRisks.filter((risk) => risk.status === 'open').length} />
            <Metric label="Cláusulas de alto risco" value={detail.clauses.filter((clause) => clause.risk_level === 'high').length || record.clauses.filter((clause) => clause.risk === 'high').length} />
            <Metric label="Mitigações cadastradas" value={contractRisks.filter((risk) => risk.mitigation_plan).length} />
          </div>
        </HudPanel>

        <HudPanel
          title="Riscos vinculados ao contrato"
          subtitle={contractRisks.length ? `${contractRisks.length} riscos persistidos` : `${record.linkedRisks.length} riscos do dossiê (placeholder)`}
          icon={<ShieldAlert className="h-4 w-4" />}
          interactive={false}
        >
          <div className="space-y-2">
            {(contractRisks.length
              ? contractRisks.map((risk) => ({
                  id: risk.id,
                  title: risk.title,
                  category: risk.category || 'Geral',
                  score: risk.risk_score ?? 0,
                  severity: (risk.risk_score ?? 0) >= 16 ? 'critical' : (risk.risk_score ?? 0) >= 12 ? 'high' : (risk.risk_score ?? 0) >= 6 ? 'medium' : 'low',
                  mitigation: risk.mitigation_plan,
                }))
              : record.linkedRisks.map((risk) => ({
                  id: risk.id,
                  title: risk.title,
                  category: risk.category,
                  score: risk.riskScore,
                  severity: risk.severity,
                  mitigation: risk.mitigationPlan,
                }))
            ).map((risk) => (
              <div key={risk.id} className="rounded-lg border border-ig-border-subtle bg-ig-panel/45 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-ig-body-sm font-semibold text-ig-fg-strong">{risk.title}</p>
                    <p className="mt-1 text-ig-caption text-ig-fg-muted">{risk.category}</p>
                  </div>
                  <HudStatusPill variant={risk.severity === 'critical' || risk.severity === 'high' ? 'critical' : risk.severity === 'medium' ? 'warning' : 'active'} size="sm">
                    {risk.score}
                  </HudStatusPill>
                </div>
                {risk.mitigation && <p className="mt-2 text-ig-caption leading-relaxed text-ig-fg-muted">{risk.mitigation}</p>}
              </div>
            ))}
          </div>
        </HudPanel>
      </div>
    </div>
  );
}

function FinanceTab({ record, detail, onNewBilling }: { record: ContractGovernanceRecord; detail: ContractDetail; onNewBilling?: () => void }) {
  const billedPercent = record.totalValue ? Math.round((record.billedValue / record.totalValue) * 100) : 0;
  const persistedBilling = detail.billingEvents.length > 0;
  const billingTotal = detail.billingEvents.reduce((sum, event) => sum + Number(event.amount || 0), 0);
  const schedule = persistedBilling
    ? detail.billingEvents.map((event) => ({
        id: event.id,
        title: event.title,
        amount: Number(event.amount || 0),
        dueDate: event.due_date ? new Date(`${event.due_date}T00:00:00`) : null,
        status: event.status,
        paid: !!event.paid_at,
      }))
    : record.billingEvents.map((event) => ({
        id: event.id,
        title: event.title,
        amount: event.amount,
        dueDate: event.due_date,
        status: event.status,
        paid: !!event.paid_at,
      }));

  return (
    <div className="space-y-5">
      <HudPanel title="Exposição financeira" icon={<Receipt className="h-4 w-4" />} interactive={false}>
        <div className="grid gap-4 lg:grid-cols-3">
          <Metric label="Valor total" value={formatCurrencyFull(record.totalValue, record.contract.currency)} />
          <Metric label="Faturado" value={formatCurrencyFull(record.billedValue, record.contract.currency)} />
          <Metric label="Saldo a faturar" value={formatCurrencyFull(record.remainingValue, record.contract.currency)} />
          <Metric label="Margem estimada" value={`${record.margin}%`} />
          <Metric label="Adimplência" value={record.paymentStatus} />
          <Metric label="Reconhecimento" value={record.revenueRecognitionStatus} />
        </div>
        <div className="mt-5 rounded-lg border border-ig-border-subtle bg-ig-panel/45 p-4">
          <div className="mb-2 flex justify-between text-ig-body-sm">
            <span className="text-ig-fg-muted">Execução financeira</span>
            <span className="font-semibold tabular-nums text-ig-fg-strong">{billedPercent}%</span>
          </div>
          <HudProgressBar value={billedPercent} variant={record.financialStatus === 'blocked' ? 'danger' : record.financialStatus === 'attention' ? 'warning' : 'success'} />
        </div>
      </HudPanel>

      <HudPanel
        title="Cronograma de faturamento"
        subtitle={persistedBilling ? `${detail.billingEvents.length} eventos · ${formatCurrencyFull(billingTotal, record.contract.currency)} cadastrados` : 'Eventograma do dossiê (placeholder até billing persistido)'}
        icon={<GanttChartSquare className="h-4 w-4" />}
        interactive={false}
      >
        {onNewBilling && (
          <div className="mb-3 flex justify-end">
            <HudButton variant="secondary" size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={onNewBilling}>
              Novo evento
            </HudButton>
          </div>
        )}
        <div className="space-y-2">
          {schedule.map((event) => {
            const paid = event.paid || event.status === 'pago' || event.status === 'paid';
            return (
              <div key={event.id} className="grid gap-3 rounded-lg border border-ig-border-subtle bg-ig-panel/45 p-3 md:grid-cols-[1fr_160px_120px_120px] md:items-center">
                <p className="truncate text-ig-body-sm font-semibold text-ig-fg-strong">{event.title}</p>
                <span className="text-ig-body-sm font-semibold tabular-nums text-ig-fg-strong">{formatCurrencyFull(event.amount, record.contract.currency)}</span>
                <span className="text-ig-caption text-ig-fg-muted">{event.dueDate ? format(new Date(event.dueDate), 'dd/MM/yyyy', { locale: pt }) : 'Sem data'}</span>
                <HudStatusPill variant={paid ? 'active' : 'warning'} size="sm">{paid ? 'Pago' : 'Pendente'}</HudStatusPill>
              </div>
            );
          })}
        </div>
        {!persistedBilling && (
          <p className="mt-3 text-ig-caption text-ig-fg-muted">Nenhum evento de billing persistido. O cronograma acima é derivado do dossiê para manter a leitura visual.</p>
        )}
      </HudPanel>
    </div>
  );
}

const DOC_TYPE_LABELS: Record<string, string> = {
  contract: 'Contrato assinado',
  amendment: 'Aditivo',
  invoice: 'Nota / fatura',
  guarantee: 'Garantia bancária',
  insurance: 'Apólice de seguro',
  annex: 'Anexo',
  purchase_order: 'Ordem de compra',
  certificate: 'Certidão',
  approval: 'Aprovação',
  minutes: 'Ata',
};

const DOC_STATUS: Record<string, { label: string; variant: 'success' | 'warning' | 'danger' | 'info' | 'neutral' }> = {
  uploaded: { label: 'Disponível', variant: 'success' },
  missing: { label: 'Faltante', variant: 'warning' },
  expired: { label: 'Expirado', variant: 'danger' },
  expiring_soon: { label: 'Expirando', variant: 'warning' },
  pending_approval: { label: 'Em aprovação', variant: 'info' },
  rejected: { label: 'Rejeitado', variant: 'danger' },
};

function DocumentsTab({ record, detail }: { record: ContractGovernanceRecord; detail: ContractDetail }) {
  const items = [
    ...detail.documents.map((doc) => ({
      id: doc.id,
      name: doc.title,
      kind: DOC_TYPE_LABELS[doc.document_type] ?? doc.document_type,
      status: DOC_STATUS[doc.status] ?? { label: doc.status, variant: 'neutral' as const },
    })),
    ...detail.files.map((file) => ({
      id: file.id,
      name: file.file_name,
      kind: 'Arquivo do contrato',
      status: { label: 'Disponível', variant: 'success' as const },
    })),
  ];

  const hasPersisted = items.length > 0;

  return (
    <HudPanel
      title="Repositório documental"
      subtitle={hasPersisted ? `${items.length} documento(s) no repositório` : 'Documentos obrigatórios pendentes'}
      icon={<Archive className="h-4 w-4" />}
      interactive={false}
    >
      {hasPersisted ? (
        <div className="grid gap-3 md:grid-cols-2">
          {items.map((item) => (
            <div key={item.id} className="rounded-lg border border-ig-border-subtle bg-ig-panel/45 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-ig-body-sm font-semibold text-ig-fg-strong">{item.name}</p>
                  <p className="mt-1 text-ig-caption text-ig-fg-muted">{item.kind}</p>
                </div>
                <HudBadge variant={item.status.variant} size="sm">{item.status.label}</HudBadge>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {(record.missingDocuments.length ? record.missingDocuments : ['Documento assinado']).map((doc) => (
            <div key={doc} className="rounded-lg border border-ig-border-subtle bg-ig-panel/45 p-3">
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 truncate text-ig-body-sm font-semibold text-ig-fg-strong">{doc}</p>
                <HudBadge variant="warning" size="sm">faltante</HudBadge>
              </div>
            </div>
          ))}
        </div>
      )}
    </HudPanel>
  );
}

function AuditTab({ record, detail }: { record: ContractGovernanceRecord; detail: ContractDetail }) {
  const events = [
    {
      title: 'Contrato criado no Supabase',
      actor: record.owner,
      date: new Date(detail.contract.created_at),
      status: 'done' as const,
    },
    ...detail.files.map((file) => ({
      title: `Arquivo anexado: ${file.file_name}`,
      actor: 'Usuario autenticado',
      date: new Date(file.created_at),
      status: 'done' as const,
    })),
    ...detail.aiAnalyses.map((analysis) => ({
      title: 'Analise IA placeholder solicitada',
      actor: 'INSIGHT AI',
      date: new Date(analysis.created_at),
      status: 'warning' as const,
    })),
  ];

  return (
    <HudPanel title="Auditoria do contrato" icon={<ShieldCheck className="h-4 w-4" />} interactive={false}>
      <Timeline events={events} />
    </HudPanel>
  );
}

function AiTab({ record, detail }: { record: ContractGovernanceRecord; detail: ContractDetail }) {
  const output = [
    'Resumo executivo',
    'Cláusulas-chave',
    'Pagamento',
    'Renovação e rescisão',
    'Penalidades e multas',
    'SLA',
    'Riscos legais',
    'Riscos financeiros',
    'Informações faltantes',
    'Documentos requeridos',
    'Ações sugeridas',
    'Rota de aprovação',
  ];

  return (
    <HudPanel title="Análise IA assistida" subtitle="Estado mock/pendente, sem chamada de API" icon={<BrainCircuit className="h-4 w-4" />} interactive={false}>
      <div className="mb-4 rounded-lg border border-[color-mix(in_oklab,var(--ig-warning)_34%,transparent)] bg-[color-mix(in_oklab,var(--ig-warning)_10%,transparent)] p-3">
        <p className="text-ig-body-sm font-semibold text-ig-fg-strong">Análise IA pendente de backend</p>
        <p className="mt-1 text-ig-caption text-ig-fg-muted">Os campos abaixo são estrutura de produto para integração futura. Nenhuma leitura documental real foi executada.</p>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <Metric label="Estado IA" value={record.aiStatus === 'mock_ready' ? 'Pré-extraído' : record.aiStatus === 'manual_review' ? 'Revisão manual' : 'Pendente'} />
        <Metric label="Análises solicitadas" value={detail.aiAnalyses.length} />
        <Metric label="Risk score" value={`${record.riskScore}/100`} />
        <Metric label="Confiança" value={`${record.confidenceScore}%`} />
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {output.map((item) => (
          <div key={item} className="rounded-lg border border-ig-border-subtle bg-ig-panel/45 p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-ig-body-sm font-semibold text-ig-fg-strong">{item}</p>
              <HudBadge variant="neutral" size="sm">mock pendente</HudBadge>
            </div>
            <p className="mt-2 text-ig-caption text-ig-fg-muted">Aguardando motor de IA e documento fonte.</p>
          </div>
        ))}
      </div>
    </HudPanel>
  );
}

function SideTimeline({ record }: { record: ContractGovernanceRecord }) {
  const events = [
    { title: 'Uploaded', actor: record.owner, date: record.contract.uploadedAt, status: 'done' as const },
    { title: 'Analyzed', actor: 'INSIGHT AI mock', date: record.auditEvents[1]?.at || record.contract.uploadedAt, status: 'warning' as const },
    { title: 'Reviewed', actor: 'Jurídico Corporativo', date: record.auditEvents[2]?.at || record.contract.uploadedAt, status: record.legalStatus === 'approved' ? 'done' as const : 'pending' as const },
    { title: 'Approved', actor: record.approvalRoute, date: record.contract.signingDate || record.contract.uploadedAt, status: record.legalStatus === 'approved' ? 'done' as const : 'pending' as const },
    { title: 'Renewed', actor: 'Gestão de Contratos', date: record.contract.renewalDate || record.contract.expirationDate || record.contract.uploadedAt, status: 'pending' as const },
    { title: 'Expired', actor: 'Sistema', date: record.contract.expirationDate || record.contract.uploadedAt, status: record.contract.status === 'expired' ? 'warning' as const : 'pending' as const },
  ];

  return (
    <HudPanel title="Timeline auditável" subtitle={record.code} icon={<CalendarClock className="h-4 w-4" />} interactive={false} className="xl:sticky xl:top-5">
      <Timeline events={events} />
    </HudPanel>
  );
}

function Timeline({
  events,
}: {
  events: Array<{ title: string; actor: string; date: Date; status: 'done' | 'warning' | 'pending' }>;
}) {
  return (
    <div className="relative space-y-3">
      <div className="absolute bottom-0 left-[15px] top-0 w-px bg-ig-border-subtle" />
      {events.map((event) => (
        <div key={`${event.title}-${event.actor}`} className="relative flex gap-3">
          <span className={`mt-1 h-8 w-8 shrink-0 rounded-full border bg-ig-panel ${event.status === 'done' ? 'border-[color-mix(in_oklab,var(--ig-success)_40%,transparent)]' : event.status === 'warning' ? 'border-[color-mix(in_oklab,var(--ig-warning)_40%,transparent)]' : 'border-ig-border-strong'}`} />
          <div className="min-w-0 flex-1 rounded-lg border border-ig-border-subtle bg-ig-panel/45 p-3">
            <p className="truncate text-ig-body-sm font-semibold text-ig-fg-strong">{event.title}</p>
            <p className="truncate text-ig-caption text-ig-fg-muted">{event.actor}</p>
            <p className="mt-1 text-ig-caption text-ig-fg-subtle">{format(new Date(event.date), 'dd/MM/yyyy', { locale: pt })}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function Relation({ icon, label, value, link = false }: { icon: React.ReactNode; label: string; value: string; link?: boolean }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-ig-border-subtle bg-ig-panel/45 p-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-ig-border-subtle bg-ig-panel text-ig-accent">{icon}</span>
      <div className="min-w-0">
        <p className="text-ig-label text-ig-fg-muted">{label}</p>
        <p className={`truncate text-ig-body-sm font-semibold ${link ? 'text-ig-accent' : 'text-ig-fg-strong'}`}>{value}</p>
      </div>
    </div>
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
