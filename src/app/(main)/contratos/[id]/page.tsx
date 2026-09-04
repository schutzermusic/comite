'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
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
  DEMO_PREVIEW_INTENT,
  formatCurrencyCompact,
  formatCurrencyFull,
  type ContractGovernanceRecord,
} from '@/components/contracts/contract-governance-data';
import { contractRowToLegacyContract, createProjectFromContract, type ContractDetail } from '@/lib/contracts/contract-service';
import { triggerContractAiScan } from '@/lib/services/risks';
import { openContractDossierReport } from '@/lib/reports/modules/contract-dossier-report';
import { trustedContractFromDetail, type TrustedContract } from '@/lib/contracts/trust/read-model';
import {
  contractHealth, renewalState, approvalRoute, RENEWAL_LABEL, approvalSla,
  missingDocuments as trustedMissingDocs,
} from '@/lib/contracts/trust/signals';
import { officialCurrencyCompact, officialCurrencyFull, officialProvenance } from '@/lib/contracts/trust/format';
import {
  ContractIdentity, ProjectRelation, FinancialPulse, ConnectedOperations, OnboardingReadinessPanel,
  ContractHealthDrivers, RequiresAttention, RecentActivity,
  type ConnectedOperationKey,
} from '@/components/contracts/cockpit';
import { attentionItems, type AttentionActionKey } from '@/lib/contracts/trust/attention';
import { live, failed, hasOfficialValue, type Official, isError, ratioTrusted, renderOfficial } from '@/lib/contracts/trust/trusted';
import { buildOnboardingReadiness, type OnboardingStepKey } from '@/lib/contracts/trust/onboarding';
import { effectiveContractState } from '@/lib/contracts/trust/amendments';
import { ContractInstrumentsPanel } from '@/components/contracts/intelligence/ContractInstrumentsPanel';
import { useContractAmendmentModals } from '@/components/contracts/useContractAmendmentModals';
import { contractToCash } from '@/lib/contracts/trust/contract-to-cash';
import { buildClauseRiskIntelligence } from '@/lib/contracts/trust/clause-risk-intelligence';
import { ClauseRiskIntelligencePanel } from '@/components/contracts/intelligence/ClauseRiskIntelligencePanel';
import { ClauseProposalsPanel } from '@/components/contracts/intelligence/ClauseProposalsPanel';
import { ClauseOpsPanel } from '@/components/contracts/intelligence/ClauseOpsPanel';
import { documentAnalysisStates, contractCoverage } from '@/lib/contracts/trust/clause-operations';
import { MeasurementPanel } from '@/components/contracts/intelligence/MeasurementPanel';
import { useContractInstrumentationModals } from '@/components/contracts/useContractInstrumentationModals';
import { buildApprovalIntelligence, type ApprovalIntelligence } from '@/lib/contracts/trust/approval-intelligence';
import { ContractToCashFlow } from '@/components/contracts/intelligence/ContractToCashFlow';
import { createBillingEventFromMilestone, requestClauseExtraction, type ContractAmendmentRow, type ContractDocumentRow, listContractAiAnalyses, type ContractAiAnalysisRow, type ContractMilestoneRow, listContractAuditEvents, listContractRelatedTasks, computeApprovalSla, type ContractAuditEventRow, type ContractRelatedTask } from '@/lib/contracts/contract-service';
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
  FileClock,
  CheckCircle2,
  XCircle,
  Clock3,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { MoreHorizontal } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { format } from 'date-fns';
import { pt } from 'date-fns/locale';

type DetailTab = 'summary' | 'clauses' | 'obligations' | 'risks' | 'finance' | 'documents' | 'approvals' | 'audit';

const DETAIL_TABS: DetailTab[] = ['summary', 'finance', 'obligations', 'documents', 'risks', 'approvals', 'audit', 'clauses'];

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
    // Preview sintético do dossiê. Migra para o read model confiável em P0.4.
    return enrichContractsForGovernance([legacy], projects, { intent: DEMO_PREVIEW_INTENT });
  }, [detail, projects]);
  const record = useMemo(() => {
    return records.find((item) => item.contract.id === contractId) || records[0] || null;
  }, [contractId, records]);

  /**
   * Contrato CONFIÁVEL — a fonte de todo valor operacional desta página.
   *
   * Passa pelo mesmo `buildTrustedContract` da listagem, o que encerra a
   * divergência histórica: até P0.4 a lista aplicava o merge live e o dossiê
   * não, então as duas telas podiam discordar sobre o mesmo contrato.
   */
  const trusted = useMemo<TrustedContract | null>(
    () => (detail ? trustedContractFromDetail(detail, projects) : null),
    [detail, projects],
  );

  /** Histórico real de `audit_logs` — escrito desde a Fase 3, lido só agora. */
  const [audit, setAudit] = useState<{ rows: ContractAuditEventRow[]; error: string | null }>({ rows: [], error: null });
  useEffect(() => {
    if (!contractId) return;
    let active = true;
    listContractAuditEvents(contractId)
      .then((result) => { if (active) setAudit(result); })
      .catch(() => { if (active) setAudit({ rows: [], error: 'Falha ao carregar o histórico.' }); });
    return () => { active = false; };
  }, [contractId]);

  /** Análise documental em curso — a leitura de um PDF leva alguns segundos. */
  const [extracting, setExtracting] = useState(false);
  const [analyzingDocId, setAnalyzingDocId] = useState<string | null>(null);

  /**
   * Dispara a análise de um documento.
   *
   * Compartilhado pelos dois painéis: o de operação (por documento) e a fila
   * de revisão. Duas cópias divergiriam no tratamento de erro.
   */
  const runExtraction = useCallback(async (documentId: string) => {
    setExtracting(true);
    setAnalyzingDocId(documentId);
    try {
      const result = await requestClauseExtraction(contractId, documentId);
      await refresh();
      const parts = [
        result.duplicateCount ? `${result.duplicateCount} leitura(s) idêntica(s) já registradas.` : null,
        result.rejectedCount ? `${result.rejectedCount} descartada(s) por falta de evidência.` : null,
      ].filter(Boolean).join(' ');
      notify(
        result.proposedCount === 0
          ? 'Nenhuma cláusula nova com evidência foi encontrada'
          : `${result.proposedCount} cláusula(s) propostas para revisão`,
        {
          description: parts || undefined,
          variant: result.proposedCount === 0 ? 'info' : 'success',
        },
      );
    } catch (err) {
      notify('A análise não pôde ser concluída', {
        description: err instanceof Error ? err.message : 'Erro inesperado.',
        variant: 'error',
      });
    } finally {
      setExtracting(false);
      setAnalyzingDocId(null);
    }
  }, [contractId, refresh, notify]);

  /** Histórico de análises, para o ciclo de vida por documento. */
  const [analyses, setAnalyses] = useState<ContractAiAnalysisRow[]>([]);
  useEffect(() => {
    if (!contractId) return;
    let active = true;
    listContractAiAnalyses(contractId)
      .then((rows) => { if (active) setAnalyses(rows); })
      .catch(() => { if (active) setAnalyses([]); });
    return () => { active = false; };
  }, [contractId, detail]);

  /** Tarefas da Agenda vinculadas — módulo dono, contagem sem cópia local. */
  const [tasks, setTasks] = useState<{ rows: ContractRelatedTask[]; error: string | null }>({ rows: [], error: null });
  useEffect(() => {
    if (!contractId) return;
    let active = true;
    listContractRelatedTasks(contractId)
      .then((result) => { if (active) setTasks(result); })
      .catch(() => { if (active) setTasks({ rows: [], error: 'Falha ao carregar as tarefas.' }); });
    return () => { active = false; };
  }, [contractId]);

  const refreshDetailAndProjects = async () => {
    const [nextProjects] = await Promise.all([getProjectsAsync(), refresh()]);
    setProjects(nextProjects);
  };

  const { actions: contractActions, modals: contractActionModals } = useContractActionModals({
    projects,
    onRefresh: refreshDetailAndProjects,
  });

  const canEditContract = hasPermission('contracts.edit') || hasPermission('admin.manage_organization');
  /** P2B — registro de marcos, cláusulas e penalidades. */
  const instrumentation = useContractInstrumentationModals({
    contractId,
    documents: detail?.documents ?? [],
    clauses: detail?.clauses ?? [],
    onRefresh: async () => { await refresh(); },
  });

  const { openAmendment, openReplaceDocument, modals: amendmentModals } = useContractAmendmentModals({
    contractId,
    onRefresh: async () => { await refresh(); },
  });

  const { openObligation, openBilling, modals: contractCreateModals } = useContractCreateModals({
    contractId,
    ownerUserId: detail?.contract.owner_user_id ?? null,
    onRefresh: async () => {
      await refresh();
    },
  });

  /**
   * Os aditivos como valor confiável — a MESMA leitura para tela e PDF.
   *
   * Uma falha de leitura vira `failed`, jamais lista vazia: "não consegui ler
   * os aditivos" e "este contrato não tem aditivos" levam a decisões opostas, e
   * um dossiê que confunde as duas afirma que o contrato vale o valor original
   * quando na verdade não sabe.
   */
  const amendmentsOfficial: Official<readonly ContractAmendmentRow[]> =
    detail?.amendmentsError
      ? failed<readonly ContractAmendmentRow[]>(detail.amendmentsError, 'contracts')
      : live((detail?.amendments ?? []) as readonly ContractAmendmentRow[], 'contracts');

  const handleExportPdf = () => {
    if (!trusted || !detail) return;
    // O PDF lê do MESMO contrato confiável que a tela — não há segundo cálculo.
    const result = openContractDossierReport({
      contract: trusted,
      sla: approvalSla(trusted, computeApprovalSla),
      auditEvents: audit.rows,
      auditError: audit.error,
      /*
        Os aditivos vão explicitamente. Omitir o campo faria o PDF dizer
        "não consultados" — o que seria verdade se não passássemos, e mentira
        se passássemos vazio quando na verdade não olhamos.
      */
      amendments: amendmentsOfficial,
      source: 'Supabase',
    });
    if (!result.ok) {
      notify('Não foi possível gerar o PDF', { description: result.message ?? 'Falha ao montar o dossiê.', variant: 'error' });
    }
  };

  if (loading || error || !record || !detail || !trusted) {
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
  const health = contractHealth(trusted);
  const kpis: KpiItem[] = [
    { id: 'total', label: 'Valor total', value: officialCurrencyCompact(trusted.totalValue), variant: 'info', icon: <FileSignature className="h-4 w-4" />, onClick: () => setActiveTab('finance'), active: activeTab === 'finance' },
    { id: 'billed', label: 'Faturado', value: officialCurrencyCompact(trusted.billedValue), variant: hasOfficialValue(trusted.billedValue) ? 'success' : 'default', icon: <Receipt className="h-4 w-4" />, onClick: () => setActiveTab('finance'), active: activeTab === 'finance' },
    { id: 'remaining', label: 'Saldo', value: officialCurrencyCompact(trusted.remainingValue), variant: hasOfficialValue(trusted.remainingValue) ? 'warning' : 'default', icon: <GanttChartSquare className="h-4 w-4" />, onClick: () => setActiveTab('finance'), active: activeTab === 'finance' },
    { id: 'renewal', label: 'Vencimento', value: renderOfficial(trusted.daysUntilExpiration, { onValue: (d) => (d < 0 ? 'vencido' : `${d}d`), onMissing: () => 'sem data', onError: () => 'indisponível' }), variant: hasOfficialValue(trusted.daysUntilExpiration) && trusted.daysUntilExpiration.value <= 90 ? 'warning' : 'default', icon: <CalendarClock className="h-4 w-4" />, onClick: () => setActiveTab('obligations'), active: activeTab === 'obligations' },
    // O KPI "Risk score NN/100" saiu: vinha de hash(id+nome) e não existe modelo
    // de pontuação aprovado para contratos. No lugar, a cobertura apurada da
    // avaliação de saúde — um fato, não um palpite.
    { id: 'health', label: 'Saúde apurada', value: `${health.coverage.assessed}/${health.coverage.total}`, variant: health.drivers.some((d) => d.adverse) ? 'warning' : 'default', icon: <ShieldAlert className="h-4 w-4" />, onClick: () => setActiveTab('risks'), active: activeTab === 'risks' },
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

  /**
   * Abas na ordem operacional pedida: Visão Geral → Financeiro → Obrigações →
   * Documentos → Riscos → Aprovações → Auditoria. Cláusulas e Análise IA ficam
   * ao final, como superfícies ainda dependentes de extração documental.
   *
   * "Aprovações" ganha aba própria: até aqui o fluxo de alçada só existia no
   * drawer, o que obrigava a voltar à listagem para ver a rota de um contrato
   * que já estava aberto.
   */
  const tabs: HudTab[] = [
    { id: 'summary', label: 'Visão geral', icon: <FileText className="h-4 w-4" />, content: <SummaryTab trusted={trusted} contractNotes={record.contract.notes ?? null} /> },
    {
      id: 'finance', label: 'Financeiro', icon: <Receipt className="h-4 w-4" />,
      badge: detail.billingEvents.length || undefined,
      content: (
        <FinanceTab
          trusted={trusted}
          detail={detail}
          onNewBilling={canEditContract ? openBilling : undefined}
          onNewMilestone={canEditContract ? () => instrumentation.openMilestone() : undefined}
          onEditMilestone={canEditContract ? instrumentation.openMilestone : undefined}
          onGenerateBilling={canEditContract ? async (milestone) => {
            try {
              await createBillingEventFromMilestone(milestone);
              await refresh();
              notify('Faturamento gerado a partir do marco', { variant: 'success' });
            } catch (err) {
              notify('Não foi possível gerar o faturamento', {
                description: err instanceof Error ? err.message : 'Erro inesperado.',
                variant: 'error',
              });
            }
          } : undefined}
        />
      ),
    },
    { id: 'obligations', label: 'Obrigações', icon: <ClipboardCheck className="h-4 w-4" />, badge: detail.obligations.filter((item) => item.status !== 'done').length || undefined, content: <ObligationsTab trusted={trusted} detail={detail} onNewObligation={canEditContract ? openObligation : undefined} /> },
    { id: 'documents', label: 'Documentos', icon: <Archive className="h-4 w-4" />, badge: (detail.files.length + detail.documents.length) || undefined, content: <DocumentsTab trusted={trusted} detail={detail} onReplace={canEditContract ? openReplaceDocument : undefined} /> },
    {
      id: 'risks', label: 'Riscos & Cláusulas', icon: <ShieldAlert className="h-4 w-4" />,
      badge: (detail.riskLinks.length + detail.clauses.length) || undefined,
      content: (
        <div className="space-y-5">
          <RisksTab trusted={trusted} detail={detail} />
          {/*
            A fila de revisão vem ANTES do inventário de cláusulas: proposta
            pendente é trabalho de alguém; cláusula validada é registro.
          */}
          {/*
            O estado da leitura vem antes da fila: saber o que ainda não foi
            lido é pré-requisito para confiar na ausência de propostas.
          */}
          <ClauseOpsPanel
            documents={documentAnalysisStates(detail.documents, analyses, detail.clauses)}
            coverage={contractCoverage(trusted, detail.documents, analyses)}
            canAnalyze={hasPermission('contracts.analyze_with_ai')}
            analyzingId={analyzingDocId}
            onAnalyze={(documentId) => { void runExtraction(documentId); }}
          />
          <ClauseProposalsPanel
            proposals={detail.clauses.filter(
              (c) => c.ai_flagged && (c.review_status === 'draft' || c.review_status === 'in_review'),
            )}
            documents={detail.documents}
            canEdit={canEditContract}
            canAnalyze={hasPermission('contracts.analyze_with_ai')}
            analyzing={extracting}
            onAnalyze={(documentId) => { void runExtraction(documentId); }}
            onValidate={instrumentation.openReview}
            onReject={instrumentation.openReview}
            onEdit={instrumentation.openSupersede}
          />
          <ClauseRiskIntelligencePanel
            intelligence={buildClauseRiskIntelligence([trusted], undefined, { officialOnly: false })}
            canEdit={canEditContract}
            onRegisterClause={() => instrumentation.openClause()}
            onRegisterPenalty={instrumentation.openPenalty}
            onReviewClause={instrumentation.openReview}
            onCreateRisk={() => contractActions.createRisk(record)}
            onLinkRisk={() => contractActions.linkExistingRisk(record)}
          />
        </div>
      ),
    },
    { id: 'approvals', label: 'Aprovações', icon: <ShieldCheck className="h-4 w-4" />, badge: detail.approvals.filter((a) => a.status !== 'approved').length || undefined, content: <ApprovalsTab trusted={trusted} detail={detail} onReview={hasPermission('contracts.approve') ? () => contractActions.reviewApproval(record) : undefined} /> },
    { id: 'audit', label: 'Auditoria', icon: <FileClock className="h-4 w-4" />, badge: audit.rows.length || undefined, content: <AuditTab audit={audit} /> },
    { id: 'clauses', label: 'Cláusulas', icon: <Scale className="h-4 w-4" />, badge: detail.clauses.length || undefined, content: <ClausesTab detail={detail} /> },
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
          /*
            Hierarquia no lugar de nove botões iguais (MD §12 do adendo).
            
            Primário: a ação que o estado do contrato pede — criar projeto
            quando ele é elegível, senão exportar o dossiê. Secundário: navegar
            e analisar. O resto vai para "Mais ações", que continua entregando
            TODAS as operações: nenhuma foi removida, só reordenada por
            frequência de uso.
          */
          <div className="flex flex-wrap items-center justify-end gap-2">
            <HudButton variant="secondary" size="md" leftIcon={<ArrowLeft className="h-4 w-4" />} onClick={() => router.push('/contratos')}>
              Voltar
            </HudButton>

            {canScanAi && (
              <HudButton variant="glass" size="md" leftIcon={<BrainCircuit className="h-4 w-4" />} disabled={scanningAi} onClick={handleAiScan}>
                {scanningAi ? 'Analisando...' : 'Analisar com IA'}
              </HudButton>
            )}

            <HudButton variant="glass" size="md" leftIcon={<Download className="h-4 w-4" />} onClick={handleExportPdf}>
              Exportar PDF
            </HudButton>

            {canCreateProjectFromContract && (
              <HudButton variant="primary" size="md" leftIcon={<Workflow className="h-4 w-4" />} disabled={creatingProject} onClick={handleCreateProject}>
                {creatingProject ? 'Criando...' : 'Criar projeto'}
              </HudButton>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <HudButton variant="secondary" size="md" leftIcon={<MoreHorizontal className="h-4 w-4" />}>
                  Mais ações
                </HudButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-[210px]">
                <DropdownMenuItem onClick={() => contractActions.linkProject(record)}>
                  <Workflow className="mr-2 h-4 w-4" /> Vincular projeto
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => contractActions.createTask(record)}>
                  <ClipboardCheck className="mr-2 h-4 w-4" /> Criar tarefa
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => contractActions.createRisk(record)}>
                  <ShieldAlert className="mr-2 h-4 w-4" /> Criar risco
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => contractActions.linkExistingRisk(record)}>
                  <ShieldCheck className="mr-2 h-4 w-4" /> Vincular risco
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => contractActions.attachDocument(record)}>
                  <Archive className="mr-2 h-4 w-4" /> Anexar documento
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => contractActions.sendToLegal(record)}>
                  <Scale className="mr-2 h-4 w-4" /> Enviar ao jurídico
                </DropdownMenuItem>
                {hasPermission('contracts.approve') && (
                  <DropdownMenuItem onClick={() => contractActions.reviewApproval(record)}>
                    <ShieldCheck className="mr-2 h-4 w-4" /> Aprovar / rejeitar
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                {canEditContract && (
                  <DropdownMenuItem onClick={openObligation}>
                    <ClipboardCheck className="mr-2 h-4 w-4" /> Criar obrigação
                  </DropdownMenuItem>
                )}
                {canEditContract && (
                  <DropdownMenuItem onClick={openBilling}>
                    <Receipt className="mr-2 h-4 w-4" /> Criar faturamento
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
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

      {/*
        Banda de contexto do dossiê — mesma linguagem do Quick Dossier e do
        Command Center.
        
        Composição assimétrica: identidade e projeto ocupam a coluna larga
        porque respondem "que contrato é este e a que ele pertence"; o pulso
        financeiro fica à direita, onde o olho o encontra depois. O antigo
        `HudKpiStrip` de 5 células saiu: repetia em miniatura o que estas duas
        superfícies dizem com hierarquia.
      */}
      <section className="mb-5 grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="relative overflow-hidden rounded-[20px] border border-ig-border-focus/35 bg-[linear-gradient(160deg,color-mix(in_oklab,var(--ig-bg-panel)_94%,transparent),color-mix(in_oklab,var(--ig-bg-raised)_48%,transparent))] px-5 py-4 shadow-[var(--ig-shadow-e2)]">
          <span className="pointer-events-none absolute inset-y-5 left-0 w-px bg-ig-accent shadow-[0_0_14px_color-mix(in_oklab,var(--ig-accent)_70%,transparent)]" aria-hidden />
          <ContractIdentity contract={trusted} />
          <ProjectRelation
            project={trusted.project}
            onLink={canEditContract ? () => contractActions.linkProject(record) : undefined}
            className="mt-4"
          />
        </div>

        <div className="rounded-[20px] border border-ig-border-subtle bg-[color-mix(in_oklab,var(--ig-bg-raised)_45%,transparent)] px-5 py-4">
          <FinancialPulse contract={trusted} />
        </div>
      </section>

      {/* Sinais e conexões: o dossiê responde "o que exige ação" e "a que se liga". */}
      <section className="mb-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <h3 className="mb-2.5 text-ig-label uppercase tracking-[0.14em] text-ig-fg-muted">Requer atenção</h3>
          <RequiresAttention
            items={attentionItems(trusted)}
            max={3}
            onAction={(key: AttentionActionKey) => {
              if (key === 'linkProject') contractActions.linkProject(record);
              else if (key === 'reviewApproval') contractActions.reviewApproval(record);
              else if (key === 'createObligation') openObligation();
              else if (key === 'createBilling') openBilling();
              else if (key === 'attachDocument') contractActions.attachDocument(record);
              else if (key === 'reviewClauseProposals') setActiveTab('risks');
              else if (key === 'openDocuments') setActiveTab('documents');
              else if (key === 'openBilling') setActiveTab('finance');
              else setActiveTab('obligations');
            }}
          />
          {/*
            A prontidão vive na coluna ESQUERDA. Empilhada à direita junto de
            operações conectadas, saúde e instrumentos, ela fazia a coluna
            direita ficar muito mais alta que a esquerda — e o dossiê abria com
            metade da tela em branco ao lado de uma pilha longa. Distribuir
            equilibra as duas colunas sem tirar nada de ninguém.
          */}
          <div className="mt-4">
            <OnboardingReadinessPanel
              readiness={buildOnboardingReadiness(trusted)}
              onNavigate={(key: OnboardingStepKey) => {
                // Cada passo entrega o assunto ao lugar onde ele se resolve.
                if (key === 'project' && hasOfficialValue(trusted.project)) router.push(`/projetos/${trusted.project.value.id}`);
                else if (key === 'documents') setActiveTab('documents');
                else if (key === 'clauses') setActiveTab('risks');
                else if (key === 'obligations') setActiveTab('obligations');
                else if (key === 'milestones') setActiveTab('finance');
                else if (key === 'approvals') setActiveTab('approvals');
                else if (key === 'risks') setActiveTab('risks');
                else setActiveTab('summary');
              }}
            />
          </div>
        </div>
        <div>
          <h3 className="mb-2.5 text-ig-label uppercase tracking-[0.14em] text-ig-fg-muted">Operações conectadas</h3>
          <ConnectedOperations
            contract={trusted}
            context={{
              tasks: { count: tasks.error ? null : tasks.rows.length, errored: Boolean(tasks.error) },
              auditEvents: { count: audit.error ? null : audit.rows.length, errored: Boolean(audit.error) },
            }}
            onNavigate={(key: ConnectedOperationKey) => {
              if (key === 'project' && hasOfficialValue(trusted.project)) router.push(`/projetos/${trusted.project.value.id}`);
              else if (key === 'billing') setActiveTab('finance');
              else if (key === 'documents') setActiveTab('documents');
              else if (key === 'obligations') setActiveTab('obligations');
              else if (key === 'risks') setActiveTab('risks');
              else if (key === 'approvals') setActiveTab('approvals');
              else if (key === 'audit') setActiveTab('audit');
              // P2B: medição vive no Financeiro (lastro do faturamento);
              // cláusulas, junto de riscos.
              else if (key === 'measurement') setActiveTab('finance');
              else if (key === 'clauses') setActiveTab('risks');
              // Os dois abaixo saem de Contratos: o módulo dono é outro.
              else if (key === 'tasks') router.push('/reunioes');
              else if (key === 'finance') router.push('/financeiro');
            }}
          />
          <div className="mt-4 rounded-[16px] border border-ig-border-subtle px-4 py-3.5">
            <ContractHealthDrivers health={contractHealth(trusted)} compact />
          </div>
          <div className="mt-4">
            <ContractInstrumentsPanel
              masterTitle={record.contract.name}
              masterNumber={record.code}
              state={effectiveContractState(trusted.totalValue, trusted.endDate, amendmentsOfficial)}
              onAddAmendment={canEditContract ? openAmendment : undefined}
            />
          </div>

        </div>
      </section>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          <HudTabs
            tabs={tabs}
            activeTab={activeTab}
            onTabChange={(tabId) => setActiveTab(tabId as DetailTab)}
            variant="underline"
          />
        </div>
        <SideTimeline code={trusted.code} audit={audit} />
      </div>

      {contractActionModals}
      {instrumentation.modals}
      {amendmentModals}
      {contractCreateModals}
    </HudPageLayout>
  );
}

/**
 * Resumo do contrato sobre dado confiável.
 *
 * Saíram: "Tarefas de agenda" e "Deliberações", que vinham do enricher. As
 * tarefas têm FK real (`tasks.related_contract_id`) mas não são carregadas
 * aqui; as deliberações NÃO têm vínculo nenhum no banco — a tabela
 * `deliberations` não referencia contrato, então a linha afirmava uma
 * governança que não existe.
 */
function SummaryTab({ trusted, contractNotes }: { trusted: TrustedContract; contractNotes: string | null }) {
  const route = approvalRoute(trusted);
  const text = (t: Parameters<typeof officialProvenance>[0], fallback: string) =>
    renderOfficial(t as never, {
      onValue: (v: unknown) => String(v),
      onMissing: () => fallback,
      onError: () => 'Dados indisponíveis',
    });
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_0.9fr]">
      <HudPanel title="Resumo executivo" icon={<FileText className="h-4 w-4" />} interactive={false}>
        <div className="space-y-4">
          <p className="text-ig-body-sm leading-relaxed text-ig-fg-muted">
            Este dossiê centraliza o contrato como fonte de verdade documental e de governança. Empresas e projetos aparecem como vínculos de referência, sem duplicar seus cadastros.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            <Metric label="Código" value={trusted.code} />
            <Metric label="Tipo" value={text(trusted.contractType, 'Não informado')} />
            <Metric label="Contraparte" value={text(trusted.counterparty, 'Não informada')} />
            <Metric label="Valor total" value={officialCurrencyCompact(trusted.totalValue)} />
          </div>
          {contractNotes && (
            <div className="rounded-lg border border-ig-border-subtle bg-ig-panel/45 p-3">
              <p className="text-ig-label text-ig-fg-muted">Observações</p>
              <p className="mt-1 text-ig-body-sm text-ig-fg-strong">{contractNotes}</p>
            </div>
          )}
        </div>
      </HudPanel>

      <HudPanel title="Entidades relacionadas" icon={<Workflow className="h-4 w-4" />} interactive={false}>
        <div className="space-y-3">
          <Relation icon={<Building2 className="h-4 w-4" />} label="Contraparte" value={text(trusted.counterparty, 'Não informada')} />
          {/* Vínculo de projeto SOMENTE de project_id ou contract_project_links. */}
          {hasOfficialValue(trusted.project) ? (
            <Link href={`/projetos/${trusted.project.value.id}`}>
              <Relation icon={<Workflow className="h-4 w-4" />} label="Projeto" value={`${trusted.project.value.codigo} · ${trusted.project.value.nome}`} link />
            </Link>
          ) : (
            <Relation icon={<Workflow className="h-4 w-4" />} label="Projeto" value={isError(trusted.project) ? 'Dados indisponíveis' : 'Sem projeto vinculado'} />
          )}
          <Relation icon={<Receipt className="h-4 w-4" />} label="Faturado" value={officialCurrencyCompact(trusted.billedValue)} />
          <Relation icon={<ShieldCheck className="h-4 w-4" />} label="Aprovação" value={text(route, 'Nenhuma etapa registrada')} />
        </div>
      </HudPanel>
    </div>
  );
}

/**
 * Cláusulas reais de `contract_clauses`.
 *
 * O fallback sintético foi removido: ele fabricava três cláusulas fixas
 * ("Renovação e denúncia", "Condições de pagamento", "SLA e penalidades") com
 * classificação de risco derivada de hash — num painel intitulado "Cláusulas
 * monitoradas". Sem extração documental, o correto é dizer que não há.
 */
function ClausesTab({ detail }: { detail: ContractDetail }) {
  const clauses = detail.clauses.map((clause) => ({
    id: clause.id,
    title: clause.title,
    category: clause.clause_type || 'Cláusula',
    risk: clause.risk_level,
    status: clause.ai_flagged ? 'Em revisão' : 'Mapeada',
    note: clause.content || 'Cláusula cadastrada sem conteúdo detalhado.',
  }));

  if (clauses.length === 0) {
    return (
      <HudPanel title="Cláusulas monitoradas" icon={<Scale className="h-4 w-4" />} interactive={false}>
        <p className="text-ig-body-sm text-ig-fg-muted">
          Nenhuma cláusula extraída para este contrato. A extração documental por IA ainda não está
          integrada — quando estiver, as cláusulas aparecerão aqui com página e trecho de origem.
        </p>
      </HudPanel>
    );
  }

  return (
    <HudPanel title="Cláusulas monitoradas" subtitle={`${clauses.length} cláusula(s) em contract_clauses`} icon={<Scale className="h-4 w-4" />} interactive={false}>
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

/**
 * Obrigações reais de `contract_obligations`.
 *
 * O fallback que exibia MARCOS como se fossem obrigações saiu. Eram dois
 * domínios diferentes desenhados na mesma lista, e o mapeamento de status
 * comparava contra `'completed'`/`'overdue'` — valores que nunca existiram no
 * vocabulário de marco, o que o CHECK da migration 092 tornou demonstrável.
 * Marco agora tem superfície própria (Contract-to-Cash e painel de medição).
 */
function ObligationsTab({ trusted, detail, onNewObligation }: { trusted: TrustedContract; detail: ContractDetail; onNewObligation?: () => void }) {
  const obligationsErrored = isError(trusted.obligations);
  const items = detail.obligations.map((obligation) => ({
    id: obligation.id,
    title: obligation.title,
    evidence: obligation.evidence || obligation.description || 'Obrigação contratual',
    owner: obligation.owner_user_id ? 'Responsável vinculado' : 'Não atribuído',
    status: obligation.status as string,
    dueDate: obligation.due_date ? new Date(`${obligation.due_date}T00:00:00`) : null,
  }));

  const subtitle = obligationsErrored
    ? 'Falha ao ler as obrigações'
    : detail.obligations.length > 0
      ? `${detail.obligations.length} obrigação(ões) em contract_obligations`
      : 'Nenhuma obrigação mapeada';

  return (
    <HudPanel
      title="Obrigações por responsável"
      subtitle={subtitle}
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
            <span className="text-ig-caption text-ig-fg-muted">{obligation.dueDate ? format(obligation.dueDate, 'dd/MM/yyyy', { locale: pt }) : 'sem prazo'}</span>
          </div>
        ))}
      </div>
    </HudPanel>
  );
}

/**
 * Riscos e saúde do contrato.
 *
 * O círculo com "Risk score NN" saiu: o número vinha de `hash(id+nome)` e a
 * legenda afirmava ser "derivado de risco cadastral, vencimento e documentos
 * faltantes" — uma descrição de metodologia para um cálculo que não existia.
 * No lugar, os drivers apurados por dimensão.
 */
function RisksTab({ trusted, detail }: { trusted: TrustedContract; detail: ContractDetail }) {
  const contractRisks = detail.risks;
  const health = contractHealth(trusted);
  const adverse = health.drivers.filter((d) => d.adverse);
  return (
    <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
      <HudPanel title="Saúde do contrato" icon={<ShieldAlert className="h-4 w-4" />} interactive={false}>
        <div className="text-center">
          <div className="mx-auto flex h-28 w-28 flex-col items-center justify-center rounded-full border border-ig-border-focus bg-ig-accent-weak">
            <span className="text-ig-kpi-md tabular-nums text-ig-accent">{health.coverage.assessed}/{health.coverage.total}</span>
            <span className="text-ig-caption text-ig-fg-muted">dimensões</span>
          </div>
          <p className="mt-3 text-ig-body-sm font-semibold text-ig-fg-strong">
            Risco cadastral {riskLabels[trusted.riskLevel]}
          </p>
          <p className="mt-1 text-ig-caption text-ig-fg-muted">
            {adverse.length === 0
              ? 'Nenhuma dimensão apurada em atenção.'
              : `${adverse.length} dimensão(ões) em atenção.`}
          </p>
          <p className="mt-2 text-ig-caption text-ig-fg-subtle">
            Não há modelo de pontuação aprovado para contratos; os drivers abaixo são fatos apurados.
          </p>
        </div>
        {adverse.length > 0 && (
          <div className="mt-4 space-y-2">
            {adverse.map((d) => (
              <div key={d.dimension} className="rounded-lg border border-[color-mix(in_oklab,var(--ig-warning)_30%,transparent)] bg-[color-mix(in_oklab,var(--ig-warning)_8%,transparent)] p-2.5">
                <p className="text-ig-caption font-semibold text-ig-fg-strong">{d.label}</p>
                <p className="mt-0.5 text-ig-caption text-ig-fg-muted">{d.detail}</p>
              </div>
            ))}
          </div>
        )}
      </HudPanel>
      <div className="space-y-5">
        <HudPanel title="Riscos legais e financeiros" icon={<Scale className="h-4 w-4" />} interactive={false}>
          <div className="grid gap-3 md:grid-cols-2">
            <Metric label="Riscos persistidos" value={contractRisks.length} />
            <Metric label="Riscos abertos" value={contractRisks.filter((risk) => risk.status === 'open').length} />
            <Metric label="Cláusulas de alto risco" value={detail.clauses.filter((clause) => clause.risk_level === 'high').length} />
            <Metric label="Mitigações cadastradas" value={contractRisks.filter((risk) => risk.mitigation_plan).length} />
          </div>
        </HudPanel>

        <HudPanel
          title="Riscos vinculados ao contrato"
          subtitle={contractRisks.length ? `${contractRisks.length} risco(s) persistido(s)` : 'Nenhum risco persistido para este contrato'}
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
              : []
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

function FinanceTab({
  trusted, detail, onNewBilling, onNewMilestone, onEditMilestone, onGenerateBilling,
}: {
  trusted: TrustedContract;
  detail: ContractDetail;
  onNewBilling?: () => void;
  onNewMilestone?: () => void;
  onEditMilestone?: (milestone: ContractMilestoneRow) => void;
  onGenerateBilling?: (milestone: ContractMilestoneRow) => void;
}) {
  /** Marcos que já geraram evento — a ponte não pode ser atravessada duas vezes. */
  const billedMilestoneIds = new Set(
    detail.billingEvents.map((e) => e.milestone_id).filter((id): id is string => Boolean(id)),
  );
  const execution = ratioTrusted(trusted.billedValue, trusted.totalValue, 'faturado sobre total', ['contracts', 'contract_billing_events']);
  const billedPercent = hasOfficialValue(execution) ? Math.round(execution.value * 100) : null;
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
    // Sem evento persistido não há cronograma: o "eventograma do dossiê" era
    // a escada fixa 10/40/50% do enricher, exibida como se fosse plano real.
    : [];

  return (
    <div className="space-y-5">
      {/*
        A cadeia até o caixa abre a aba: ela mostra onde a rastreabilidade
        termina — medição não instrumentada, recebimento não integrado — antes
        de qualquer número, para que o leitor não tome o "faturado" por "recebido".
      */}
      <HudPanel
        title="Contract-to-Cash"
        subtitle="Contratado → Medido → Aprovado → Faturado → Recebido"
        icon={<Receipt className="h-4 w-4" />}
        interactive={false}
      >
        <ContractToCashFlow stages={contractToCash(trusted)} compact />
      </HudPanel>

      {/*
        A medição vem logo depois da cadeia: é ela que dá lastro ao estágio
        "Medido" e ao faturamento que vem em seguida.
      */}
      <MeasurementPanel
        milestones={trusted.milestones}
        billedMilestoneIds={billedMilestoneIds}
        canEdit={Boolean(onNewMilestone)}
        onCreate={onNewMilestone}
        onEdit={onEditMilestone}
        onGenerateBilling={onGenerateBilling}
      />

      <HudPanel title="Exposição financeira" icon={<Receipt className="h-4 w-4" />} interactive={false}>
        <div className="grid gap-4 lg:grid-cols-3">
          <Metric label="Valor total" value={officialCurrencyFull(trusted.totalValue)} />
          {/* "Margem estimada", "Adimplência" e "Reconhecimento" saíram: os três
              vinham do enricher (20+seed%25, seed%4, seed%3). Não há custo por
              contrato na base para margem, nem status de pagamento além dos
              eventos de faturamento. */}
          <Metric label="Faturado" value={officialCurrencyFull(trusted.billedValue)} />
          <Metric label="Saldo a faturar" value={officialCurrencyFull(trusted.remainingValue)} />
          <Metric label="Execução" value={billedPercent === null ? 'Não apurada' : `${billedPercent}%`} />
          <Metric label="Eventos registrados" value={hasOfficialValue(trusted.billingEvents) ? trusted.billingEvents.value.length : '—'} />
        </div>
        <div className="mt-5 rounded-lg border border-ig-border-subtle bg-ig-panel/45 p-4">
          <div className="mb-2 flex justify-between text-ig-body-sm">
            <span className="text-ig-fg-muted">Execução financeira</span>
            <span className="font-semibold tabular-nums text-ig-fg-strong">{billedPercent === null ? 'Não apurada' : `${billedPercent}%`}</span>
          </div>
          <HudProgressBar value={billedPercent ?? 0} showLabel={false} variant={billedPercent === null ? 'default' : 'success'} />
        </div>
      </HudPanel>

      <HudPanel
        title="Cronograma de faturamento"
        subtitle={persistedBilling ? `${detail.billingEvents.length} evento(s) · ${formatCurrencyFull(billingTotal)} cadastrados` : 'Nenhum evento de faturamento registrado'}
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
                <span className="text-ig-body-sm font-semibold tabular-nums text-ig-fg-strong">{formatCurrencyFull(event.amount)}</span>
                <span className="text-ig-caption text-ig-fg-muted">{event.dueDate ? format(new Date(event.dueDate), 'dd/MM/yyyy', { locale: pt }) : 'Sem data'}</span>
                <HudStatusPill variant={paid ? 'active' : 'warning'} size="sm">{paid ? 'Pago' : 'Pendente'}</HudStatusPill>
              </div>
            );
          })}
        </div>
        {!persistedBilling && (
          <p className="mt-3 text-ig-caption text-ig-fg-muted">
            Nenhum evento de faturamento registrado para este contrato. Sem eventos, a exposição
            faturada não pode ser apurada.
          </p>
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

function DocumentsTab({ trusted, detail, onReplace }: {
  trusted: TrustedContract;
  detail: ContractDetail;
  /** Substituir por nova versão. Ausente quando o usuário não pode editar. */
  onReplace?: (doc: ContractDocumentRow) => void;
}) {
  const items = [
    ...detail.documents.map((doc) => ({
      id: doc.id,
      name: doc.title,
      kind: DOC_TYPE_LABELS[doc.document_type] ?? doc.document_type,
      status: DOC_STATUS[doc.status] ?? { label: doc.status, variant: 'neutral' as const },
      doc,
    })),
    ...detail.files.map((file) => ({
      id: file.id,
      name: file.file_name,
      kind: 'Arquivo do contrato',
      status: { label: 'Disponível', variant: 'success' as const },
      doc: null,
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
                  <p className="mt-1 text-ig-caption text-ig-fg-muted">
                    {item.kind}
                    {item.doc && item.doc.version > 1 && ` · v${item.doc.version}`}
                    {item.doc?.superseded_by_document_id && ' · substituído por versão mais recente'}
                  </p>
                </div>
                <HudBadge variant={item.status.variant} size="sm">{item.status.label}</HudBadge>
              </div>
              {/*
                Só o documento VIGENTE é substituível. Substituir um já
                substituído criaria duas versões apontando para o mesmo
                antecessor, e a linhagem deixaria de ser uma linha.
              */}
              {onReplace && item.doc && !item.doc.superseded_by_document_id && (
                <button
                  type="button"
                  onClick={() => onReplace(item.doc!)}
                  className="mt-2.5 rounded-[8px] border border-ig-border-strong px-2.5 py-1 text-ig-caption font-semibold text-ig-fg-strong transition-colors hover:bg-ig-panel-hover/60"
                >
                  Substituir por nova versão
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {/* O fallback `['Documento assinado']` saiu: inventava um documento
              faltante para todo contrato sem registro. */}
          {(() => {
            const docs = trustedMissingDocs(trusted);
            const list = hasOfficialValue(docs) ? docs.value : [];
            if (list.length === 0) {
              return (
                <p className="text-ig-body-sm text-ig-fg-muted md:col-span-2">
                  {isError(docs) ? 'Falha ao ler os documentos do contrato.' : 'Nenhum documento registrado para este contrato.'}
                </p>
              );
            }
            return list.map((doc) => (
              <div key={doc} className="rounded-lg border border-ig-border-subtle bg-ig-panel/45 p-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 truncate text-ig-body-sm font-semibold text-ig-fg-strong">{doc}</p>
                  <HudBadge variant="warning" size="sm">faltante</HudBadge>
                </div>
              </div>
            ));
          })()}
        </div>
      )}
    </HudPanel>
  );
}

/**
 * Auditoria REAL, lida de `audit_logs`.
 *
 * `logAuditEvent` grava ali desde a Fase 3 — 23 ações distintas — e ninguém
 * lia. A aba montava três eventos a partir de `created_at` e das análises,
 * atribuindo um deles a um ator chamado "INSIGHT AI" que nunca existiu.
 */
/**
 * Fluxo de alçadas a partir de `contract_approvals`.
 *
 * Traz para o dossiê completo o que antes só existia no drawer — quem já
 * decidiu, quem falta, e há quanto tempo cada etapa está aberta.
 */
/**
 * Duração de uma etapa em horas. `now` é parâmetro com default AVALIADO FORA do
 * render — chamar `Date.now()` durante a renderização é impuro e o lint do
 * repositório recusa, pela mesma razão que `countOverdueBillingEvents` vive
 * fora de componente.
 */
function stepDurationHours(
  started: string | null | undefined,
  completed: string | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!started) return null;
  const end = completed ? new Date(completed).getTime() : now.getTime();
  return Math.round((end - new Date(started).getTime()) / 3_600_000);
}

/**
 * A resposta imediata da aba de aprovações: onde está parado, há quanto tempo,
 * e quanto passou do prazo. `null` em qualquer um significa não apurado — e o
 * painel escreve isso, em vez de zero.
 */
function ApprovalPulse({ intelligence }: { intelligence: ApprovalIntelligence }) {
  if (intelligence.unavailable) return null;
  const overdue = intelligence.overdueSteps.length;

  return (
    <div className="grid gap-2 sm:grid-cols-3">
      <Metric
        label="Etapa corrente"
        value={intelligence.currentStage?.label ?? 'Rota concluída'}
      />
      <Metric
        label="Gargalo"
        value={intelligence.bottleneck
          ? `${intelligence.bottleneck.label} · ${intelligence.bottleneck.elapsedHours ?? '—'}h`
          : 'Nenhuma etapa aberta'}
      />
      <Metric
        label="Etapas além do prazo"
        value={overdue === 0 ? 'Nenhuma' : `${overdue} etapa(s)`}
      />
    </div>
  );
}

function ApprovalsTab({
  trusted, detail, onReview,
}: {
  trusted: TrustedContract;
  detail: ContractDetail;
  onReview?: () => void;
}) {
  const route = approvalRoute(trusted);
  const sla = approvalSla(trusted, computeApprovalSla);
  const intelligence = buildApprovalIntelligence(trusted);
  const STEP_LABEL: Record<string, string> = {
    juridico: 'Jurídico', financeiro: 'Financeiro', comite: 'Comitê', diretoria: 'Diretoria',
  };
  const ORDER = ['juridico', 'financeiro', 'comite', 'diretoria'];
  const steps = [...detail.approvals].sort(
    (a, b) => ORDER.indexOf(a.step_name) - ORDER.indexOf(b.step_name),
  );

  if (steps.length === 0) {
    return (
      <HudPanel title="Fluxo de aprovação" icon={<ShieldCheck className="h-4 w-4" />} interactive={false}>
        <p className="text-ig-body-sm text-ig-fg-muted">
          Nenhuma etapa de aprovação registrada para este contrato. Sem etapa cadastrada não há
          rota nem SLA — o fluxo ainda não foi iniciado.
        </p>
        {onReview && (
          <HudButton variant="secondary" size="sm" className="mt-3" leftIcon={<ShieldCheck className="h-4 w-4" />} onClick={onReview}>
            Registrar decisão
          </HudButton>
        )}
      </HudPanel>
    );
  }

  return (
    <div className="space-y-5">
      {/*
        Etapa corrente, gargalo e atraso vêm antes da jornada: a jornada conta a
        história inteira, mas quem abre a aba quer saber onde está parado agora.
      */}
      <ApprovalPulse intelligence={intelligence} />

      <HudPanel
        title="Jornada de aprovação"
        subtitle={hasOfficialValue(route) ? route.value : undefined}
        icon={<ShieldCheck className="h-4 w-4" />}
        interactive={false}
        headerActions={onReview ? (
          <HudButton variant="secondary" size="sm" onClick={onReview}>Registrar decisão</HudButton>
        ) : undefined}
      >
        <ol className="space-y-0">
          {steps.map((step, index) => {
            const approved = step.status === 'approved';
            const rejected = step.status === 'rejected';
            const hours = stepDurationHours(step.started_at ?? step.created_at, step.completed_at);

            return (
              <li key={step.id} className="relative flex gap-4 pb-5 last:pb-0">
                {index < steps.length - 1 && (
                  <span className="absolute left-[11px] top-6 h-full w-px bg-ig-border-subtle" aria-hidden />
                )}
                <span
                  className={cn(
                    'relative mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2',
                    approved ? 'border-ig-success bg-[color-mix(in_oklab,var(--ig-success)_18%,transparent)]'
                      : rejected ? 'border-ig-danger bg-[color-mix(in_oklab,var(--ig-danger)_18%,transparent)]'
                        : 'border-ig-border-strong',
                  )}
                  aria-hidden
                >
                  {approved && <CheckCircle2 className="h-3.5 w-3.5 text-ig-success" />}
                  {rejected && <XCircle className="h-3.5 w-3.5 text-ig-danger" />}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2.5">
                    <p className="text-ig-body-sm font-semibold text-ig-fg-strong">
                      {STEP_LABEL[step.step_name] ?? step.step_name}
                    </p>
                    <span
                      className={cn(
                        'text-ig-caption font-semibold',
                        approved ? 'text-ig-success' : rejected ? 'text-ig-danger' : 'text-ig-warning',
                      )}
                    >
                      {approved ? 'Aprovado' : rejected ? 'Rejeitado' : step.status === 'under_review' ? 'Em análise' : 'Pendente'}
                    </span>
                    {hours !== null && (
                      <span className="ig-tabular text-ig-caption text-ig-fg-muted">
                        {hours}h {step.completed_at ? '' : 'em aberto'}
                      </span>
                    )}
                  </div>
                  {step.requested_changes_note && (
                    <p className="mt-1 text-ig-caption leading-relaxed text-ig-fg-muted">
                      {step.requested_changes_note}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </HudPanel>

      <HudPanel title="SLA do fluxo" icon={<Clock3 className="h-4 w-4" />} interactive={false}>
        <div className="grid gap-3 md:grid-cols-3">
          <Metric
            label="Duração média"
            value={hasOfficialValue(sla) && sla.value.avgHours !== null ? `${sla.value.avgHours}h` : 'Não apurada'}
          />
          <Metric
            label="Etapas em atraso"
            value={hasOfficialValue(sla) ? sla.value.overdueSteps : '—'}
          />
          <Metric
            label="Etapas rejeitadas"
            value={hasOfficialValue(sla) ? sla.value.rejectedSteps : '—'}
          />
        </div>
      </HudPanel>
    </div>
  );
}

function AuditTab({ audit }: { audit: { rows: ContractAuditEventRow[]; error: string | null } }) {
  if (audit.error) {
    return (
      <HudPanel title="Auditoria do contrato" state="critical" icon={<ShieldCheck className="h-4 w-4" />} interactive={false}>
        <p className="text-ig-body-sm text-ig-fg-strong">Falha ao ler o histórico de auditoria.</p>
        <p className="mt-1 text-ig-caption text-ig-fg-muted">{audit.error}</p>
      </HudPanel>
    );
  }

  if (audit.rows.length === 0) {
    return (
      <HudPanel title="Auditoria do contrato" icon={<ShieldCheck className="h-4 w-4" />} interactive={false}>
        <p className="text-ig-body-sm text-ig-fg-muted">
          Nenhum evento de auditoria registrado para este contrato em `audit_logs`.
        </p>
      </HudPanel>
    );
  }

  const events = audit.rows.map((row) => ({
    title: AUDIT_ACTION_LABELS[row.action] ?? row.action,
    actor: row.actor_user_id ? 'Usuário autenticado' : 'Sistema',
    date: new Date(row.created_at),
    status: row.action.includes('rejected') ? ('warning' as const) : ('done' as const),
  }));

  return (
    <HudPanel title="Auditoria do contrato" subtitle={`${audit.rows.length} evento(s) em audit_logs`} icon={<ShieldCheck className="h-4 w-4" />} interactive={false}>
      <Timeline events={events} />
    </HudPanel>
  );
}

/** Rótulos em pt-BR das ações gravadas por `logAuditEvent`. */
const AUDIT_ACTION_LABELS: Record<string, string> = {
  'contract.created': 'Contrato criado',
  'contract.updated': 'Contrato atualizado',
  'contract.deleted': 'Contrato excluído',
  'contract.file_uploaded': 'Arquivo anexado',
  'contract.document_uploaded': 'Documento enviado',
  'contract.document_approved': 'Documento aprovado',
  'contract.document_rejected': 'Documento rejeitado',
  'contract.document_status_changed': 'Situação de documento alterada',
  'contract.obligation_created': 'Obrigação criada',
  'contract.obligation_updated': 'Obrigação atualizada',
  'contract.obligation_completed': 'Obrigação concluída',
  'contract.billing_event_created': 'Evento de faturamento criado',
  'contract.billing_event_updated': 'Evento de faturamento atualizado',
  'contract.billing_event_realized': 'Faturamento realizado',
  'contract.linked_project': 'Projeto vinculado',
  'contract.unlinked_project': 'Projeto desvinculado',
  'contract.linked_risk': 'Risco vinculado',
  'contract.unlinked_risk': 'Risco desvinculado',
  'contract.project_created': 'Projeto criado a partir do contrato',
  'contract.agenda_task_created': 'Tarefa de agenda criada',
  'contract.ai_analysis_requested': 'Análise de IA solicitada',
  'contract.changes_requested': 'Ajustes solicitados',
};

/*
  `AiTab` foi removida na Fase 0.6 junto com a aba "Análise IA".

  O painel se anunciava como estado simulado, sem chamada de API, e listava doze
  seções seladas como pendentes de backend. A capacidade REAL de leitura assistida
  não estava ali e não foi tocada: ela vive na aba Cláusulas — extração por
  documento, fila de propostas sob revisão humana, portão de evidência e
  supersessão. É onde a inteligência tem consequência, e é onde ela fica.
*/


/**
 * Timeline auditável a partir de eventos REAIS.
 *
 * Antes eram seis estágios fixos — Uploaded/Analyzed/Reviewed/Approved/
 * Renewed/Expired — com datas caídas em `uploadedAt` quando não havia fonte, e
 * um ator literalmente chamado "INSIGHT AI mock". Num painel intitulado
 * "Timeline auditável", isso é o oposto de auditável.
 */
function SideTimeline({ code, audit }: { code: string; audit: { rows: ContractAuditEventRow[]; error: string | null } }) {
  if (audit.error || audit.rows.length === 0) {
    return (
      <HudPanel title="Timeline auditável" subtitle={code} icon={<CalendarClock className="h-4 w-4" />} interactive={false} className="xl:sticky xl:top-5">
        <p className="text-ig-body-sm text-ig-fg-muted">
          {audit.error ? 'Falha ao ler o histórico de auditoria.' : 'Nenhum evento registrado para este contrato.'}
        </p>
      </HudPanel>
    );
  }

  const events = audit.rows.slice(0, 8).map((row) => ({
    title: AUDIT_ACTION_LABELS[row.action] ?? row.action,
    actor: row.actor_user_id ? 'Usuário autenticado' : 'Sistema',
    date: new Date(row.created_at),
    status: row.action.includes('rejected') ? ('warning' as const) : ('done' as const),
  }));

  return (
    <HudPanel title="Timeline auditável" subtitle={`${code} · ${audit.rows.length} evento(s)`} icon={<CalendarClock className="h-4 w-4" />} interactive={false} className="xl:sticky xl:top-5">
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
      <p className="truncate text-ig-label font-semibold uppercase tracking-[0.14em] text-ig-fg-subtle">{label}</p>
      <p className="mt-1 truncate text-base font-semibold tabular-nums text-ig-fg-strong">{value}</p>
    </div>
  );
}
