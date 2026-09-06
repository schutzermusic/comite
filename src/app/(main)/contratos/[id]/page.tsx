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
  ProjectRelation, FinancialPulse, ConnectedOperations, OnboardingReadinessPanel,
  ContractHealthDrivers, RequiresAttention,
  type ConnectedOperationKey,
} from '@/components/contracts/cockpit';
import { attentionItems, type AttentionActionKey } from '@/lib/contracts/trust/attention';
import { live, failed, hasOfficialValue, type Official, isError, ratioTrusted, renderOfficial } from '@/lib/contracts/trust/trusted';
import { buildOnboardingReadiness, type OnboardingStepKey } from '@/lib/contracts/trust/onboarding';
import { effectiveContractState } from '@/lib/contracts/trust/amendments';
import { ContractInstrumentsPanel } from '@/components/contracts/intelligence/ContractInstrumentsPanel';
import { useContractAmendmentModals } from '@/components/contracts/useContractAmendmentModals';
import { useContractProvenanceModal } from '@/components/contracts/useContractProvenanceModal';
import type { ContractDataClass } from '@/lib/contracts/trust/trusted';
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
  useHudToast,
  type HudTab,
  type KpiItem,
} from '@/components/hud';
import {
  Archive,
  ArrowLeft,
  BadgeCheck,
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
import { SectionHeader, HistoryDrawer, InlineEmpty, DossierNav } from '@/components/contracts/shell';
import { format } from 'date-fns';
import { ContractStructuredObligations } from '@/components/contracts/ContractStructuredObligations';
import { pt } from 'date-fns/locale';

/*
  Seis domínios de negócio, não oito superfícies técnicas.

  Saíram duas abas:

  - `audit` — a auditoria virou a gaveta "Histórico". Ela aparecia DUAS vezes
    ao mesmo tempo (aba + painel fixo de 360px à direita), dizendo a mesma
    coisa e comprimindo a área de trabalho em toda sessão.
  - `clauses` — competia de frente com "Riscos & Cláusulas". Duas abas
    primárias disputando o mesmo assunto obrigavam o usuário a adivinhar em
    qual delas a cláusula que ele procura foi parar. O inventário virou seção
    interna de Riscos & Cláusulas: nada saiu do produto, só deixou de ser uma
    escolha de navegação.

  Links antigos com `?tab=audit` ou `?tab=clauses` continuam funcionando —
  ver `resolveInitialTab`.
*/
type DetailTab = 'summary' | 'obligations' | 'risks' | 'finance' | 'documents' | 'approvals';

const DETAIL_TABS: DetailTab[] = ['summary', 'finance', 'obligations', 'documents', 'risks', 'approvals'];

/** Abas aposentadas -> onde o assunto vive agora. */
const RETIRED_TAB_TARGET: Record<string, DetailTab> = { clauses: 'risks', audit: 'summary' };

function resolveInitialTab(raw: string | null): DetailTab {
  if (!raw) return 'summary';
  if ((DETAIL_TABS as string[]).includes(raw)) return raw as DetailTab;
  return RETIRED_TAB_TARGET[raw] ?? 'summary';
}

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
  const rawTab = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState<DetailTab>(() => resolveInitialTab(rawTab));
  // `?tab=audit` continua levando ao histórico — que agora é gaveta, não aba.
  const [historyOpen, setHistoryOpen] = useState(rawTab === 'audit');
  const [creatingProject, setCreatingProject] = useState(false);
  const [flowNotice, setFlowNotice] = useState<string | null>(null);
  const [scanningAi, setScanningAi] = useState(false);

  const canScanAi = hasPermission('risks.ai_scan');

  /*
    A reavaliação de risco continua existindo — mesma rota, mesma permissão
    (`risks.ai_scan`), mesmo efeito. O que mudou é o enquadramento: saiu do
    header como "Analisar com IA", ação primária que anunciava a TECNOLOGIA, e
    entrou em "Mais ações" como "Reavaliar riscos do contrato", que anuncia o
    RESULTADO. A IA é transversal e automática; não é uma etapa do ciclo de
    vida que o usuário dispara à mão.
  */
  const handleRiskReassessment = async () => {
    if (!contractId) return;
    if (!window.confirm('Reavaliar os riscos deste contrato? A leitura pode levar até 1 minuto.')) return;
    setScanningAi(true);
    setFlowNotice(null);
    try {
      const { count } = await triggerContractAiScan(contractId);
      setFlowNotice(`${count} risco(s) identificado(s). Veja em /riscos.`);
    } catch (err) {
      setFlowNotice(err instanceof Error ? err.message : 'A reavaliação de riscos não pôde ser concluída.');
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
  /*
    Classificar origem NÃO é a autoridade de quem cadastra.

    `contracts.delete` / `admin.manage_organization` são, nos papéis semeados,
    owner_admin — e deliberadamente não `juridico_contratos`, que é quem cria.
    Autocertificação foi exatamente o defeito corrigido na Fase 0.7, e repeti-lo
    aqui reintroduziria o problema por outra porta. É também a única autoridade
    que a política de UPDATE de `contracts` já aceita para este tipo de ato.
  */
  const canClassifyProvenance = hasPermission('contracts.delete') || hasPermission('admin.manage_organization');
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

  const { open: openProvenance, modal: provenanceModal } = useContractProvenanceModal({
    contractId,
    contractTitle: detail?.contract.title ?? 'Contrato',
    current: (detail?.contract.data_class as ContractDataClass | undefined) ?? 'unclassified',
    onRefresh: async () => { await refresh(); },
  });

  /**
   * As origens possíveis de uma obrigação: as cláusulas e os documentos DESTE
   * contrato. A lista existe porque a origem é obrigatória — sem ela o banco
   * recusa a definição, e é melhor oferecer a escolha do que explicar a recusa.
   */
  const obligationOrigins = useMemo(() => [
    ...(detail?.clauses ?? []).map((clause) => ({
      value: `clause:${clause.id}`,
      label: `Cláusula · ${clause.title}${clause.source_page ? ` (p. ${clause.source_page})` : ''}`,
    })),
    ...(detail?.documents ?? []).map((document) => ({
      value: `document:${document.id}`,
      label: `Documento · ${document.title}`,
    })),
  ], [detail?.clauses, detail?.documents]);

  const { openObligation, openBilling, modals: contractCreateModals } = useContractCreateModals({
    contractId,
    ownerUserId: detail?.contract.owner_user_id ?? null,
    origins: obligationOrigins,
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
    /*
      "Cobertura", não "Saúde": o número é `assessed/total` — quantas das seis
      dimensões têm dado suficiente para serem avaliadas. Lido como "Saúde 5/6"
      vira NOTA, e um contrato com 6/6 de cobertura pode estar péssimo, assim
      como um 2/6 pode estar impecável e só mal cadastrado. O componente já
      havia sido renomeado; o chip do cabeçalho tinha ficado para trás.
    */
    { id: 'health', label: 'Cobertura apurada', value: `${health.coverage.assessed}/${health.coverage.total}`, variant: health.drivers.some((d) => d.adverse) ? 'warning' : 'default', icon: <ShieldAlert className="h-4 w-4" />, onClick: () => setActiveTab('risks'), active: activeTab === 'risks' },
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

  /*
    UMA fonte para o vínculo de projeto (§20 do gate).
    A faixa de ação e o botão do cabeçalho liam `contracts.project_id`; o
    resumo lia `trusted.project`, que resolve `contracts.project_id` OU
    `contract_project_links` — ambos vínculos reais. Um contrato ligado pela
    tabela de vínculo aparecia então como "assinado sem projeto vinculado"
    logo acima do projeto ao qual está ligado. Os dois passam a derivar da
    mesma relação resolvida.
  */
  const hasLinkedProject = hasOfficialValue(trusted.project);

  const canCreateProjectFromContract =
    !hasLinkedProject
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
   * Documentos → Riscos → Aprovações. Cláusulas ficam
   * ao final, como superfícies ainda dependentes de extração documental.
   *
   * "Aprovações" ganha aba própria: até aqui o fluxo de alçada só existia no
   * drawer, o que obrigava a voltar à listagem para ver a rota de um contrato
   * que já estava aberto.
   */
  const tabs: HudTab[] = [
    {
      id: 'summary', label: 'Visão geral', icon: <FileText className="h-4 w-4" />,
      /*
        Prontidão, cobertura, operações conectadas e instrumentos desceram do
        topo da página para cá. São quatro superfícies de LEITURA, não de
        urgência: quem quer o panorama vem à Visão geral; quem quer faturamento
        não deveria ter de rolar por elas para alcançar a aba Financeiro.
        Nenhuma mudou de conteúdo.
      */
      content: (
        <div className="space-y-6">
          <SummaryTab trusted={trusted} contractNotes={record.contract.notes ?? null} />

          <div className="grid gap-6 xl:grid-cols-2">
            <div className="space-y-6">
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
              <section data-testid="contract-coverage">
                <ContractHealthDrivers health={contractHealth(trusted)} />
              </section>
            </div>

            <div className="space-y-6">
              <section data-testid="contract-connected-ops">
                <SectionHeader title="Operações conectadas" hint="o contrato como objeto central" />
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
                    // Auditoria deixou de ser aba: mesmo destino, agora gaveta.
                    else if (key === 'audit') setHistoryOpen(true);
                    // P2B: medição vive no Financeiro (lastro do faturamento);
                    // cláusulas, junto de riscos.
                    else if (key === 'measurement') setActiveTab('finance');
                    else if (key === 'clauses') setActiveTab('risks');
                    // Os dois abaixo saem de Contratos: o módulo dono é outro.
                    else if (key === 'tasks') router.push('/reunioes');
                    else if (key === 'finance') router.push('/financeiro');
                  }}
                />
              </section>

              <ContractInstrumentsPanel
                masterTitle={record.contract.name}
                masterNumber={record.code}
                state={effectiveContractState(trusted.totalValue, trusted.endDate, amendmentsOfficial)}
                onAddAmendment={canEditContract ? openAmendment : undefined}
              />
            </div>
          </div>
        </div>
      ),
    },
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
          {/*
            O inventário fecha a aba: proposta pendente é trabalho de alguém,
            cláusula validada é acervo. A antiga aba "Cláusulas" mostrava
            exatamente isto — só que como um destino concorrente.
          */}
          <ClausesTab detail={detail} />
        </div>
      ),
    },
    { id: 'approvals', label: 'Aprovações', icon: <ShieldCheck className="h-4 w-4" />, badge: detail.approvals.filter((a) => a.status !== 'approved').length || undefined, content: <ApprovalsTab trusted={trusted} detail={detail} onReview={hasPermission('contracts.approve') ? () => contractActions.reviewApproval(record) : undefined} /> },
  ];

  return (
    // `ig-dossier-page`: sem isto o scrollport mais próximo é a raiz do layout,
    // e a subnav grudenta não teria onde grudar. Ver surfaces.css.
    <HudPageLayout className="ig-dossier-page">
      <HudHeader
        title={record.contract.name}
        /*
          O subtítulo agora IDENTIFICA o contrato — contraparte · código · tipo.
          O texto anterior descrevia a arquitetura da página para um leitor de
          negócio, e ainda citava um estado "mock/pendente" que já não existia.
        */
        subtitle={[
          hasOfficialValue(trusted.counterparty) ? trusted.counterparty.value : null,
          trusted.code,
          hasOfficialValue(trusted.contractType) ? trusted.contractType.value : null,
        ].filter(Boolean).join(' · ')}
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
            {/*
              "Voltar" saiu: o breadcrumb acima já leva a /contratos, e dois
              caminhos idênticos lado a lado gastavam a posição mais visível do
              header com a ação menos importante da tela.

              Sobram três afordâncias, em prioridade decrescente: exportar (ou
              criar projeto, quando o contrato pede isso), histórico, e o menu
              com TODO o resto — nenhuma operação saiu do dossiê, só foi
              reordenada.
            */}
            <HudButton
              variant={canCreateProjectFromContract ? 'glass' : 'primary'}
              size="md"
              leftIcon={<Download className="h-4 w-4" />}
              onClick={handleExportPdf}
            >
              Exportar PDF
            </HudButton>

            <HudButton
              variant="secondary"
              size="md"
              leftIcon={<FileClock className="h-4 w-4" />}
              onClick={() => setHistoryOpen(true)}
            >
              Histórico
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
                {canScanAi && (
                  <DropdownMenuItem disabled={scanningAi} onClick={() => { void handleRiskReassessment(); }}>
                    <ShieldAlert className="mr-2 h-4 w-4" />
                    {scanningAi ? 'Reavaliando...' : 'Reavaliar riscos do contrato'}
                  </DropdownMenuItem>
                )}
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
                {canClassifyProvenance && (
                  <DropdownMenuItem onClick={openProvenance}>
                    <BadgeCheck className="mr-2 h-4 w-4" /> Classificar origem
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

      {!hasLinkedProject && ['signed', 'active'].includes(detail.contract.status) && (
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
      {/*
        ─── A DOBRA ─────────────────────────────────────────────────────────

        Entre o header e a barra de abas havia OITO painéis com borda:
        identidade, projeto, pulso financeiro, requer atenção, prontidão,
        operações conectadas, saúde e instrumentos. A navegação do dossiê só
        aparecia depois de rolar — num contrato bem cadastrado, bem depois.
        Quem abria o dossiê para conferir faturamento tinha de atravessar tudo
        isso para achar a aba Financeiro.

        Ficaram DUAS faixas, sem moldura própria:

          1. o pulso financeiro em quatro métricas alinhadas, mais o projeto;
          2. o que exige ação.

        `ContractIdentity` saiu daqui porque o header passou a dizer a mesma
        coisa (contraparte · código · tipo, mais os chips de status): eram dois
        títulos do mesmo contrato, um em cima do outro. O componente segue vivo
        e em uso no Quick Dossier, onde não há header de página.
      */}
      <section className="mb-5 border-y border-ig-border-subtle py-4" aria-label="Resumo do contrato">
        <FinancialPulse contract={trusted} compact />
        <ProjectRelation
          project={trusted.project}
          onLink={canEditContract ? () => contractActions.linkProject(record) : undefined}
          className="mt-4 border-t border-ig-border-subtle pt-3"
        />
      </section>

      {/*
        Três componentes disputavam a mesma frase — "requer atenção",
        "prontidão" e "saúde do contrato". Agora são DOIS conceitos, separados
        pela pergunta que respondem, não pelo componente:

          · REQUER AÇÃO (aqui, na dobra) — o que precisa ser feito agora.
          · PRONTIDÃO + COBERTURA (na Visão geral) — o que ainda não foi
            registrado, e quantas dimensões já dá para avaliar.

        O primeiro é urgente e cabe acima das abas; o segundo é panorama e cabe
        onde se procura panorama.
      */}
      <section className="mb-5" data-testid="contract-attention" aria-label="Requer ação">
        <h2 className="mb-2.5 text-ig-body-sm font-semibold text-ig-fg-strong">Requer ação</h2>
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
      </section>

      {/*
        Largura inteira. O painel "Timeline auditável" ocupava 360px fixos à
        direita das abas — toda sessão, para todo mundo, dizendo o mesmo que a
        aba "Auditoria" logo ao lado. Uma tabela de faturamento perdia um quarto
        da tela para um histórico que ninguém pediu. Agora o histórico é a
        gaveta abaixo, e o dossiê tem a largura que sempre precisou.
      */}
      {/*
        Subnav horizontal, grudenta, logo abaixo da identidade do contrato.

        O rail vertical saiu: depois que a carteira subiu para a sidebar do
        Apex, havia DUAS colunas de navegação lado a lado — a do módulo e a do
        objeto — e o dossiê ficava espremido entre elas. A distinção entre os
        dois níveis passa a ser de eixo e de peso: a sidebar é vertical,
        persistente, com fundo; esta é horizontal, presa ao contrato e sem
        superfície nenhuma.
      */}
      <div className="mt-4 min-w-0">
        <DossierNav
          items={tabs.map(({ id, label, icon, badge }) => ({ id, label, icon, badge }))}
          activeId={activeTab}
          onSelect={(tabId) => setActiveTab(tabId as DetailTab)}
          panelId="dossier-panel"
          data-testid="contract-dossier-tabs"
        />
        <div
          id="dossier-panel"
          role="tabpanel"
          aria-labelledby={`dossier-tab-${activeTab}`}
          tabIndex={0}
          className="mt-5 min-w-0 focus-visible:outline-none"
        >
          {tabs.find((tab) => tab.id === activeTab)?.content}
        </div>
      </div>

      <HistoryDrawer
        isOpen={historyOpen}
        onClose={() => setHistoryOpen(false)}
        subject={trusted.code}
        rows={audit.rows}
        error={audit.error}
      />

      {contractActionModals}
      {instrumentation.modals}
      {amendmentModals}
      {provenanceModal}
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
    <div className="grid gap-x-8 gap-y-5 lg:grid-cols-2">
      <section className="min-w-0">
        <SectionHeader title="Resumo executivo" />
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
            <div className="border-t border-ig-border-subtle pt-2">
              <p className="text-ig-caption text-ig-fg-muted">Observações</p>
              <p className="mt-1 text-ig-body-sm text-ig-fg-strong">{contractNotes}</p>
            </div>
          )}
        </div>
      </section>

      <section className="min-w-0">
        <SectionHeader title="Entidades relacionadas" />
        <div className="divide-y divide-ig-border-subtle border-y border-ig-border-subtle">
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
      </section>
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
      <section>
        <SectionHeader title="Cláusulas monitoradas" />
        <p className="text-ig-body-sm text-ig-fg-muted">
          Nenhuma cláusula extraída para este contrato. A extração documental por IA ainda não está
          integrada — quando estiver, as cláusulas aparecerão aqui com página e trecho de origem.
        </p>
      </section>
    );
  }

  return (
    <section>
      <SectionHeader title="Cláusulas monitoradas" hint={`${clauses.length} cláusula(s) em contract_clauses`} />
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
    </section>
  );
}

/**
 * Obrigações do contrato.
 *
 * Duas listas, e a ordem não é acidental. Primeiro o modelo ESTRUTURADO da
 * Fase 3, que responde o que o contrato exige, de quem, desde quando, com que
 * prazo e por qual cláusula. Depois a lista de tarefas anterior, rotulada como
 * legado: as linhas que existem nela são reais, e fazê-las sumir sem explicação
 * seria pior que mostrá-las no lugar certo.
 *
 * O fallback que exibia MARCOS como se fossem obrigações saiu na Fase 0. Eram
 * dois domínios diferentes desenhados na mesma lista, e o mapeamento de status
 * comparava contra `'completed'`/`'overdue'` — valores que nunca existiram no
 * vocabulário de marco.
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
      ? `${detail.obligations.length} item(ns) da lista de tarefas anterior à Fase 3`
      : 'A lista anterior está vazia';

  return (
    <section className="space-y-6">
      <div>
        <SectionHeader title="Obrigações contratuais" hint="O que o contrato exige, com origem e prazo" />
        <ContractStructuredObligations contractId={detail.contract.id} />
      </div>

      <div>
      <SectionHeader title="Lista anterior (legado)" hint={subtitle} />
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
      </div>
    </section>
  );
}

/**
 * Riscos do contrato.
 *
 * O círculo "Risk score NN" saiu na Fase 0: o número vinha de `hash(id+nome)`
 * e a legenda dizia ser "derivado de risco cadastral, vencimento e documentos
 * faltantes" — metodologia descrita para um cálculo que não existia.
 *
 * Agora sai também o que ficou no lugar dele: um SEGUNDO desenho de cobertura,
 * um círculo "5/6 dimensões" reimplementado à mão aqui, ao lado do
 * `ContractHealthDrivers` que a Visão geral já mostrava. O mesmo contrato
 * exibia a mesma fração em duas abas, com dois desenhos e duas redações. A
 * cobertura tem um dono — a Visão geral. Esta aba fala de risco.
 */
function RisksTab({ trusted, detail }: { trusted: TrustedContract; detail: ContractDetail }) {
  const contractRisks = detail.risks;
  const health = contractHealth(trusted);
  const adverse = health.drivers.filter((d) => d.adverse);
  return (
    <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
      <div>
        <SectionHeader title="Risco cadastral" />
        <p className="text-ig-kpi-md text-ig-fg-strong">{riskLabels[trusted.riskLevel]}</p>

        <div className="mt-4">
          <SectionHeader title="Dimensões em atenção" count={adverse.length} />
          {adverse.length === 0 ? (
            <InlineEmpty message="Nenhuma dimensão apurada em atenção." />
          ) : (
            <ul className="space-y-2">
              {adverse.map((d) => (
                <li key={d.dimension} className="border-l-2 border-ig-warning pl-2.5">
                  <p className="text-ig-body-sm font-medium text-ig-fg-strong">{d.label}</p>
                  <p className="mt-0.5 text-ig-caption text-ig-fg-muted">{d.detail}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="space-y-5">
        <section>
          <SectionHeader title="Riscos legais e financeiros" />
          <div className="grid gap-3 md:grid-cols-2">
            <Metric label="Riscos persistidos" value={contractRisks.length} />
            <Metric label="Riscos abertos" value={contractRisks.filter((risk) => risk.status === 'open').length} />
            <Metric label="Cláusulas de alto risco" value={detail.clauses.filter((clause) => clause.risk_level === 'high').length} />
            <Metric label="Mitigações cadastradas" value={contractRisks.filter((risk) => risk.mitigation_plan).length} />
          </div>
        </section>

        <section>
          <SectionHeader title="Riscos vinculados ao contrato" hint={contractRisks.length ? `${contractRisks.length} risco(s) persistido(s)` : 'Nenhum risco persistido para este contrato'} />
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
        </section>
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
      <section>
        <SectionHeader title="Contract-to-Cash" hint="Contratado → Medido → Aprovado → Faturado → Recebido" />
        <ContractToCashFlow stages={contractToCash(trusted)} compact />
      </section>

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

      <section>
        <SectionHeader title="Exposição financeira" />
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
      </section>

      <section>
        <SectionHeader title="Cronograma de faturamento" hint={persistedBilling ? `${detail.billingEvents.length} evento(s) · ${formatCurrencyFull(billingTotal)} cadastrados` : 'Nenhum evento de faturamento registrado'} />
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
      </section>
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
    <section>
      <SectionHeader title="Repositório documental" hint={hasPersisted ? `${items.length} documento(s) no repositório` : 'Documentos obrigatórios pendentes'} />
      {hasPersisted ? (
        /*
          Documento é linha, não cartão (§7 do gate). Numa grade de dois, o
          nome do arquivo, o status e a ação ficavam em posições diferentes a
          cada célula; em lista, nome, versão, status e ação alinham em
          colunas e o repositório se lê de cima a baixo.
        */
        <div className="ig-rows">
          {items.map((item) => (
            <div
              key={item.id}
              className="grid gap-x-4 gap-y-1 py-2.5 md:grid-cols-[minmax(0,1fr)_110px_auto] md:items-center"
            >
              <div className="min-w-0">
                <p className="truncate text-ig-body-sm font-medium text-ig-fg-strong">{item.name}</p>
                <p className="truncate text-ig-caption text-ig-fg-muted">
                  {item.kind}
                  {item.doc && item.doc.version > 1 && ` · v${item.doc.version}`}
                  {item.doc?.superseded_by_document_id && ' · substituído por versão mais recente'}
                </p>
              </div>
              <HudBadge variant={item.status.variant} size="sm">{item.status.label}</HudBadge>
              {/*
                Só o documento VIGENTE é substituível. Substituir um já
                substituído criaria duas versões apontando para o mesmo
                antecessor, e a linhagem deixaria de ser uma linha.
              */}
              {onReplace && item.doc && !item.doc.superseded_by_document_id ? (
                <button
                  type="button"
                  onClick={() => onReplace(item.doc!)}
                  className="justify-self-start text-ig-caption font-medium text-ig-accent transition-colors hover:text-ig-accent-strong md:justify-self-end"
                >
                  Substituir por nova versão
                </button>
              ) : (
                <span />
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
    </section>
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
      <section>
        <SectionHeader title="Fluxo de aprovação" />
        <p className="text-ig-body-sm text-ig-fg-muted">
          Nenhuma etapa de aprovação registrada para este contrato. Sem etapa cadastrada não há
          rota nem SLA — o fluxo ainda não foi iniciado.
        </p>
        {onReview && (
          <HudButton variant="secondary" size="sm" className="mt-3" leftIcon={<ShieldCheck className="h-4 w-4" />} onClick={onReview}>
            Registrar decisão
          </HudButton>
        )}
      </section>
    );
  }

  return (
    <div className="space-y-5">
      {/*
        Etapa corrente, gargalo e atraso vêm antes da jornada: a jornada conta a
        história inteira, mas quem abre a aba quer saber onde está parado agora.
      */}
      <ApprovalPulse intelligence={intelligence} />

      <section>
        <SectionHeader title="Jornada de aprovação" hint={hasOfficialValue(route) ? route.value : undefined} action={onReview ? (
          <HudButton variant="secondary" size="sm" onClick={onReview}>Registrar decisão</HudButton>
        ) : undefined} />
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
      </section>

      <section>
        <SectionHeader title="SLA do fluxo" />
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
      </section>
    </div>
  );
}

/*
  Saíram daqui `AuditTab`, `SideTimeline`, `Timeline` e uma cópia privada de
  `AUDIT_ACTION_LABELS`.

  Eram QUATRO peças para um assunto só. As três primeiras desenhavam a mesma
  timeline em três marcações diferentes, já divergentes entre si; a quarta era
  um mapa de rótulos que parava em `contract.changes_requested`, de modo que
  eventos mais novos — `contract.reclassified`, por exemplo — chegavam crus ao
  usuário de negócio.

  Tudo isso virou `components/contracts/shell/AuditTimeline` sobre
  `lib/contracts/audit-labels`, exibido pela gaveta `HistoryDrawer`.

  Os DADOS não mudaram: seguem sendo as linhas de `audit_logs` lidas por
  `listContractAuditEvents`, na mesma ordem — e agora sem corte, já que a
  antiga `SideTimeline` mostrava só as 8 primeiras.
*/

/*
  Relação como LINHA de lista de definição (§9 do gate).
  Cada vínculo era um cartão com borda e um ícone dentro de outra caixa de
  36px: seis relações produziam seis molduras e doze bordas para dizer seis
  pares rótulo/valor. Rótulo à esquerda em largura fixa, valor à direita —
  os valores alinham entre si, que é o que torna a lista varrível.
*/
function Relation({ icon, label, value, link = false }: { icon: React.ReactNode; label: string; value: string; link?: boolean }) {
  return (
    <div className="flex items-baseline gap-3 py-2">
      <span className="flex w-28 shrink-0 items-center gap-1.5 text-ig-caption text-ig-fg-muted">
        <span className="shrink-0 text-ig-fg-subtle" aria-hidden>{icon}</span>
        <span className="truncate">{label}</span>
      </span>
      <span className={`min-w-0 flex-1 truncate text-ig-body-sm font-medium ${link ? 'text-ig-accent' : 'text-ig-fg-strong'}`}>
        {value}
      </span>
    </div>
  );
}

/* Campo de identidade: par rótulo/valor alinhado, sem moldura própria. */
function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0 border-t border-ig-border-subtle pt-2">
      <p className="truncate text-ig-caption text-ig-fg-muted">{label}</p>
      <p className="ig-tabular mt-0.5 truncate text-ig-body-sm font-semibold text-ig-fg-strong">{value}</p>
    </div>
  );
}
