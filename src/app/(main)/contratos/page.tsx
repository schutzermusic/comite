'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { DossierDisclosure, DossierSection } from '@/components/contracts/shell/DossierPrimitives';
import { PortfolioEmpty, matchesPortfolioSearch } from '@/components/contracts/portfolio/PortfolioControls';
import { PortfolioCommandBar } from '@/components/contracts/portfolio/PortfolioCommandBar';
import { PortfolioDocuments } from '@/components/contracts/portfolio/PortfolioDocuments';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  type SectionId,
  sectionLabels,
  SECTION_BY_SLUG,
  sectionHref,
} from '@/lib/contracts/portfolio-sections';
import type { Contract, Project } from '@/lib/types';
import {
  deleteProject,
  getProjectsAsync,
  updateProjectV2,
  uploadProjectFile,
} from '@/lib/services/projects';
import { hasOfficialValue, isError } from '@/lib/contracts/trust/trusted';
import { cn } from '@/lib/utils';
import type { PortfolioActivityEvent } from '@/components/contracts/cockpit/PortfolioActivity';
import { listRisks } from '@/lib/services/risks';
import { useContracts } from '@/hooks/use-contracts';
import { usePermissions } from '@/hooks/use-permissions';
import { useCurrentUser } from '@/hooks/use-current-user';
import { ContractList } from '@/components/contracts/contract-list';
import { ContractUpload, type ContractOnboardingDraft } from '@/components/contracts/contract-upload';
import { finalizeContractIntake } from '@/lib/contracts/onboarding/client';
import { buildIntakeFinalValues } from '@/lib/contracts/onboarding/finalize-values';
import { ContractOnboardingContinuity } from '@/components/contracts/ContractOnboardingContinuity';
import { ApexMonitoringBand, type MonitoringCell } from '@/components/contracts/intelligence/ApexMonitoringBand';
import { usePortfolioFollowups } from '@/components/contracts/use-portfolio-followups';
import { isOpenFollowup } from '@/lib/platform/followups/types';
import { ContractCard } from '@/components/contracts/ContractCard';
import { ContractDossierDrawer } from '@/components/contracts/ContractDossierDrawer';
import { useContractActionModals } from '@/components/contracts/useContractActionModals';
import { useContractCreateModals } from '@/components/contracts/useContractCreateModals';
import { useContractAmendmentModals } from '@/components/contracts/useContractAmendmentModals';
import { useContractItemModals } from '@/components/contracts/useContractItemModals';
import {
  enrichContractsForGovernance,
  DEMO_PREVIEW_INTENT,
  formatCurrencyCompact,
  isBillingEventRealized,
  countOverdueBillingEvents,
  type ContractGovernanceRecord,
} from '@/components/contracts/contract-governance-data';
import { computeContractPortfolioStats } from '@/components/contracts/contract-portfolio-stats';
import { applyLiveGovernanceData, countLiveSections } from '@/components/contracts/contract-governance-live';
import { ContractExecutiveBand } from '@/components/contracts/ContractExecutiveBand';
import { computeApprovalSla, contractRowToLegacyContract, createTaskFromObligation, describeRelationErrors, fetchContractRelationsBatch, fetchPortfolioLinkCounts, getContractDocumentUrl, listContractAuditEvents, listPortfolioAuditEvents, requestClauseExtraction, submitContractApproval, updateContractDocumentStatus, uploadContractDocument, type ContractDocumentRow, type ContractRelationsBatch } from '@/lib/contracts/contract-service';
import { buildTrustedPortfolio, type TrustedContract } from '@/lib/contracts/trust/read-model';
import { computeTrustedPortfolioStats, type TrustedPortfolioStats } from '@/lib/contracts/trust/portfolio';
import { approvalSla } from '@/lib/contracts/trust/signals';
import { portfolioToCash } from '@/lib/contracts/trust/contract-to-cash';
import { buildObligationsTower } from '@/lib/contracts/trust/obligations-tower';
import { buildRenewalHorizon } from '@/lib/contracts/trust/renewal-horizon';
import { buildPortfolioApprovals } from '@/lib/contracts/trust/approval-intelligence';
import { buildClauseRiskIntelligence } from '@/lib/contracts/trust/clause-risk-intelligence';
import { ContractToCashFlow } from '@/components/contracts/intelligence/ContractToCashFlow';
import { ContractToCashPanel } from '@/components/contracts/billing/ContractToCashPanel';
import { PortfolioBillingMilestones } from '@/components/contracts/billing/PortfolioBillingMilestones';
import { BillingPlanningWorkspace } from '@/components/contracts/billing/month/BillingPlanningWorkspace';
import { ObligationsControlTower } from '@/components/contracts/intelligence/ObligationsControlTower';
import { StructuredObligationsPanel } from '@/components/contracts/intelligence/StructuredObligationsPanel';
import { useStructuredObligations } from '@/components/contracts/use-structured-obligations';
import { RenewalHorizonPanel } from '@/components/contracts/intelligence/RenewalHorizonPanel';
import { ApprovalIntelligencePanel } from '@/components/contracts/intelligence/ApprovalIntelligencePanel';
import { ApprovalEngineStatusBanner } from '@/components/contracts/intelligence/ApprovalEngineStatusBanner';
import { PortfolioApprovalRequirementsPanel } from '@/components/contracts/intelligence/PortfolioApprovalRequirementsPanel';
import { usePortfolioApprovalRequirements } from '@/components/contracts/use-portfolio-approval-requirements';
import { ClauseRiskIntelligencePanel } from '@/components/contracts/intelligence/ClauseRiskIntelligencePanel';
import { ScopeOriginNotice } from '@/components/contracts/intelligence/ScopeOriginNotice';
import { buildContractIntelligence } from '@/lib/contracts/intelligence/operational-interpretations';
import {
  PortfolioScopeNotice, PortfolioActivity, matchesScope, type PortfolioScopeKey,
  PortfolioHero, ModuleConnections, PortfolioHorizon, PortfolioAttention,
  ContractInstrumentCard, ContractSmartTable,
} from '@/components/contracts/cockpit';
import { OverviewBlock, OverviewBlockAction } from '@/components/contracts/cockpit/OverviewBlock';
import {
  portfolioAttention, portfolioConnections, portfolioHorizon,
  type ModuleKey, type ModuleConnection, type PortfolioAttentionItem, type HorizonEvent,
} from '@/lib/contracts/trust/command-center';
import { contractHealth } from '@/lib/contracts/trust/signals';
import { ExportReportButton } from '@/components/reports/ExportReportButton';
import { openContractReport } from '@/lib/reports/modules/contract-report';
import { openContractDossierReport } from '@/lib/reports/modules/contract-dossier-report';
import {
  HudBadge,
  HudButton,
  HudHeader,
  HudPageLayout,
  HudPanel,
  HudProgressBar,
  HudSignal,
  HudStatusPill,
  HudTabs,
  useHudToast,
  type HudTab,
} from '@/components/hud';
import {
  Archive,
  FileClock,
  BarChart3,
  BrainCircuit,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  FileSignature,
  FileText,
  LayoutGrid,
  ListFilter,
  Plus,
  Receipt,
  Scale,
  ShieldAlert,
  ShieldCheck,
  Table2,
  Upload,
  Workflow,
  X,
} from 'lucide-react';
import { SectionHeader, HistoryDrawer, InlineEmpty, ContractsKpiStrip } from '@/components/contracts/shell';
import { buildSectionKpis } from '@/lib/contracts/trust/section-kpis';
import { buildRiskExposureBands } from '@/lib/contracts/analytics/risk-exposure-bands';
import { buildCashTimeline } from '@/lib/contracts/analytics/cash-timeline';
import { usePortfolioBacklog } from '@/components/contracts/use-portfolio-backlog';
import { PortfolioIntelligence } from '@/components/contracts/analytics/PortfolioIntelligence';
import type { BacklogStageKey } from '@/lib/contracts/analytics/billing-backlog';
import type { RiskBandKey } from '@/lib/contracts/analytics/risk-exposure-bands';
import type { HorizonBand } from '@/lib/contracts/trust/renewal-horizon';
import { format } from 'date-fns';
import { pt } from 'date-fns/locale';

/*
  Oito destinos operacionais. "Auditoria" saiu da navegação primária: era o
  único item que não é um domínio de trabalho — ninguém "vai à auditoria"
  resolver algo, consulta-se o histórico a partir de onde já se está. Virou a
  gaveta "Histórico", alcançável do cabeçalho em qualquer aba.

  Documentos FICA: tem ciclo de vida próprio (versão, supersessão, aprovação) e
  é operado, não consultado. Nenhum workspace novo entra aqui só para casar com
  o roadmap — "Aditivos" espera a Fase 2, que é quem define o modelo final.
*/
type ViewMode = 'cards' | 'table' | 'risk';

const AREA_HINT: Record<SectionId, string> = {
  overview: 'Prioridades, próximos prazos e desempenho da carteira em um só lugar.',
  contracts: 'Encontre um contrato e abra seu dossiê para acompanhar a operação.',
  renewals: 'Antecipe decisões e acompanhe os prazos de renovação e vigência.',
  obligations: 'Acompanhe exigências, responsáveis, evidências e impedimentos.',
  faturamento: 'Da origem contratual ao recebimento: acompanhe cada evento.',
  aprovacoes: 'Veja onde cada decisão está, quem responde e quais prazos exigem atenção.',
  risks: 'Explore riscos, cláusulas e penalidades com sua origem documental.',
  documents: 'Encontre documentos, confira versões e acompanhe as aprovações.',
};

const riskLabels = { high: 'Alto', medium: 'Médio', low: 'Baixo' } as const;

/**
 * As abas operacionais leem o recorte escolhido, não só a carteira oficial —
 * e rotulam a origem na tela. Constante de módulo para não recriar o objeto a
 * cada render e invalidar os memos.
 */
const SCOPED = { officialOnly: false } as const;

/**
 * Single-select KPI filters — the Executive Band (and the Sinais operacionais
 * headers) are the only filtering system of this screen. Predicates mirror the
 * KPI counts shown in the band so "click the number → see those contracts".
 */
const KPI_FILTERS: Record<string, { label: string; predicate: (record: ContractGovernanceRecord) => boolean }> = {
  saldo_a_faturar: { label: 'Saldo a faturar', predicate: (r) => r.remainingValue > 0 },
  a_vencer: { label: 'Contratos a vencer', predicate: (r) => r.daysUntilExpiration !== null && r.daysUntilExpiration >= 0 && r.daysUntilExpiration <= 90 },
  alto_risco: { label: 'Alto risco', predicate: (r) => r.contract.riskClassification === 'high' },
  docs_pendentes: { label: 'Documentos pendentes', predicate: (r) => r.missingDocuments.length > 0 },
  revisao_juridica: { label: 'Revisão jurídica', predicate: (r) => r.contract.status === 'legal_review' || r.legalStatus !== 'approved' },
  sem_projeto: { label: 'Sem projeto', predicate: (r) => !r.project },
  sem_faturamento: { label: 'Sem faturamento', predicate: (r) => r.billedValue === 0 },
  // `aiStatus === 'mock_pending'` classificava como "sem análise" o contrato
  // que o enricher tivesse marcado assim a partir de `autoExtracted` — nada a
  // ver com o banco. Agora a pergunta é a real, e é a MESMA que alimenta o
  // contador da faixa executiva (`contractsWithoutAi`): existe linha em
  // `contract_ai_analyses`? `null` (relação não lida) não conta como ausência.
  sem_ia: { label: 'Leitura documental pendente', predicate: (r) => r.hasAiAnalysis === false },
  obrigacoes_atrasadas: { label: 'Obrigações atrasadas', predicate: (r) => r.obligations.some((o) => o.status === 'overdue') },
};

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
  const { organization } = useCurrentUser();
  const [projects, setProjects] = useState<Project[]>([]);
  const [riskOptions, setRiskOptions] = useState<{ id: string; title: string }[]>([]);
  const [uploadOpen, setUploadOpen] = useState(false);
  /*
    A área ativa vive na URL, não no componente: é ela que a sidebar aponta,
    que o voltar do navegador restaura e que um link compartilhado carrega.
  */
  const searchParams = useSearchParams();
  const activeSection: SectionId = SECTION_BY_SLUG[searchParams.get('view') ?? ''] ?? 'overview';
  const setActiveSection = useCallback(
    (next: SectionId) => {
      // `push` (não `replace`): trocar de área é navegação, e voltar tem de
      // devolver a área anterior em vez de sair da carteira.
      router.push(sectionHref(next), { scroll: false });
    },
    [router],
  );
  const [riskTargetId, setRiskTargetId] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('cards');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Single-select KPI filter driven by the Executive Band (null = full portfolio).
  const [activeKpiFilter, setActiveKpiFilter] = useState<string | null>(null);
  /**
   * Escopo da carteira. Default `live`: a pergunta normal do usuário é sobre a
   * carteira real, e nenhuma métrica oficial pode nascer de outra coisa.
   */
  const [scope, setScope] = useState<PortfolioScopeKey>('live');
  const { notify } = useHudToast();

  useEffect(() => {
    getProjectsAsync()
      .then(setProjects)
      .catch(() => setProjects([]));
  }, []);

  useEffect(() => {
    listRisks()
      .then((rows) => setRiskOptions(rows.map((risk) => ({ id: risk.id, title: risk.title }))))
      .catch(() => setRiskOptions([]));
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

  // Mock preview: fabricated from each contract's own columns (dev/instant paint).
  // Preview SINTÉTICO: alimenta apenas abas/drawer ainda não migrados. A
  // Executive Band e o PDF leem de `trustedStats`/`trustedPortfolio`.
  const mockRecords = useMemo(
    () => enrichContractsForGovernance(contracts, projects, { intent: DEMO_PREVIEW_INTENT }),
    [contracts, projects],
  );
  // Live merge: real migration-034 relation rows override the mock per section.
  const [liveRecords, setLiveRecords] = useState<ContractGovernanceRecord[] | null>(null);
  // O batch cru é guardado porque o read model confiável (P0.3) é construído a
  // partir DELE e das linhas de `contracts` — nunca do preview do enricher.
  const [relationsBatch, setRelationsBatch] = useState<ContractRelationsBatch | null>(null);
  /** Contagens dos módulos donos (agenda e auditoria) para o Command Center. */
  const [linkCounts, setLinkCounts] = useState<{ linkedTasks: number | null; auditEvents: number | null }>(
    { linkedTasks: null, auditEvents: null },
  );
  const [governance, setGovernance] = useState<{ error: string | null; live: number; total: number }>({ error: null, live: 0, total: 0 });

  useEffect(() => {
    const ids = mockRecords.map((record) => record.contract.id);
    if (ids.length === 0) return;
    let active = true;
    // State is only written from the async callbacks below (external-system sync),
    // never synchronously in the effect body.
    fetchContractRelationsBatch(ids)
      .then((batch) => {
        if (!active) return;
        setRelationsBatch(batch);
        void fetchPortfolioLinkCounts(ids)
          .then((counts) => { if (active) setLinkCounts(counts); })
          .catch(() => { if (active) setLinkCounts({ linkedTasks: null, auditEvents: null }); });
        setLiveRecords(applyLiveGovernanceData(mockRecords, batch, projects, {
          allowEstimated: organization?.is_demo === true,
        }));
        const { live, total } = countLiveSections(batch);
        // Uma seção que FALHOU não é uma seção vazia: sem isto, uma negativa de
        // RLS ou uma queda de rede caía no preview sintético sem nenhum aviso.
        setGovernance({ error: describeRelationErrors(batch), live, total });
      })
      .catch((err) => {
        if (!active) return;
        // Non-blocking: fall back to the mock preview if the live read fails.
        setRelationsBatch(null);
        setLiveRecords(null);
        setGovernance({ error: err instanceof Error ? err.message : 'Falha ao carregar governança ao vivo', live: 0, total: 0 });
      });
    return () => {
      active = false;
    };
  }, [mockRecords, organization?.is_demo, projects]);

  /**
   * Read model CONFIÁVEL — a fonte única da Executive Band e dos dois PDFs.
   *
   * Construído a partir das linhas de `contracts` e do batch de relações reais.
   * Não passa pelo enricher: nenhum valor aqui pode ter vindo de
   * `hash(id + nome)`. Enquanto o batch não chegou, a carteira confiável é
   * vazia e a band exibe "não apurado" — que é a verdade naquele instante —
   * em vez de um número de preview.
   */
  const trustedPortfolio = useMemo(
    () => (relationsBatch ? buildTrustedPortfolio(contractRows, relationsBatch, projects) : []),
    [contractRows, relationsBatch, projects],
  );

  // Compartilhado com o PDF (contract-report.ts) para que tela e export não
  // possam divergir: os dois leem deste mesmo objeto.
  /**
   * As MÉTRICAS sempre agregam a carteira inteira — `computeTrustedPortfolioStats`
   * aplica a fronteira de origem internamente e conta apenas `live`. O escopo
   * abaixo governa o que a LISTA exibe, não o que a band soma: mudar o recorte
   * visual nunca deve mudar a exposição oficial da empresa.
   */
  const trustedStats = useMemo(() => computeTrustedPortfolioStats(trustedPortfolio), [trustedPortfolio]);

  const connections = useMemo(
    () => portfolioConnections({
      contracts: trustedPortfolio,
      linkedTaskCount: linkCounts.linkedTasks,
      auditEventCount: linkCounts.auditEvents,
    }),
    [trustedPortfolio, linkCounts],
  );
  const horizon = useMemo(() => portfolioHorizon(trustedPortfolio, 90), [trustedPortfolio]);

  /** Cobertura de saúde somada sobre a carteira oficial. */
  const healthCoverage = useMemo(() => {
    const live = trustedPortfolio.filter((c) => c.dataClass === 'live');
    if (live.length === 0) return { assessed: 0, total: 6 };
    const per = live.map((c) => contractHealth(c).coverage);
    return {
      assessed: per.reduce((sum, c) => sum + c.assessed, 0),
      total: per.reduce((sum, c) => sum + c.total, 0),
    };
  }, [trustedPortfolio]);

  /** Índice por id — card e tabela leem daqui, e não do record sintético. */
  const trustedById = useMemo(
    () => new Map(trustedPortfolio.map((c) => [c.id, c])),
    [trustedPortfolio],
  );

  /** Origem por id, para filtrar a listagem e marcar as linhas. */
  const dataClassById = useMemo(
    () => new Map(trustedPortfolio.map((c) => [c.id, c.dataClass])),
    [trustedPortfolio],
  );

  const allRecords = useMemo(
    () => (mockRecords.length === 0
      ? []
      : liveRecords ?? (organization?.is_demo === true ? mockRecords : [])),
    [liveRecords, mockRecords, organization?.is_demo],
  );

  /**
   * A listagem respeita o escopo. Enquanto o batch não chegou, `dataClassById`
   * está vazio e nada é filtrado — melhor mostrar tudo por um instante do que
   * esconder a carteira real por não saber ainda a origem de ninguém.
   */
  const records = useMemo(() => {
    if (dataClassById.size === 0) return allRecords;
    return allRecords.filter((r) => matchesScope(dataClassById.get(r.contract.id) ?? 'unclassified', scope));
  }, [allRecords, dataClassById, scope]);
  /*
    Atividade recente da carteira. Lida à parte porque `audit_logs` pertence ao
    módulo Auditoria — Contratos consulta, não replica. Uma falha aqui não
    derruba a página: vira `error` e o painel diz que não conseguiu ler, em vez
    de exibir "nenhuma atividade" sobre uma carteira que pode ter dezenas.
  */
  const [activity, setActivity] = useState<{ rows: PortfolioActivityEvent[]; error: string | null }>(
    { rows: [], error: null },
  );

  const visibleContractIds = useMemo(
    () => records.map((r) => r.contract.id),
    [records],
  );

  /*
    Histórico da carteira é gaveta, não aba. Uma única leitura serve às duas
    superfícies: "Atividade recente", na Visão geral, corta em 6; a gaveta
    mostra a trilha inteira que veio.
  */
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    if (visibleContractIds.length === 0) {
      setActivity({ rows: [], error: null });
      return;
    }
    listPortfolioAuditEvents(visibleContractIds, 60)
      .then((res) => { if (alive) setActivity(res); })
      .catch((err: unknown) => {
        if (alive) setActivity({ rows: [], error: err instanceof Error ? err.message : 'Falha ao ler auditoria.' });
      });
    return () => { alive = false; };
  }, [visibleContractIds]);

  const codeById = useMemo(
    () => new Map(records.map((r) => [r.contract.id, trustedById.get(r.contract.id)?.code ?? r.contract.name])),
    [records, trustedById],
  );


  /**
   * Inteligência de carteira do Command Center. Toda ela deriva do portfólio
   * confiável e respeita a fronteira de origem: contrato de demonstração não
   * gera sinal nem entra em conexão.
   */
  const attention = useMemo(() => portfolioAttention(trustedPortfolio), [trustedPortfolio]);

  const governanceLoading = mockRecords.length > 0 && liveRecords === null && governance.error === null;
  const companies = useMemo(() => Array.from(new Set(records.map((record) => record.companyName))).sort(), [records]);

  // Click a KPI to filter, click it again to clear, click another to replace.
  const toggleKpiFilter = (filterKey: string) => {
    setActiveKpiFilter((current) => (current === filterKey ? null : filterKey));
  };

  const refreshContractsAndProjects = async () => {
    const [nextProjects] = await Promise.all([getProjectsAsync(), refresh()]);
    setProjects(nextProjects);
  };

  const { actions: contractActions, modals: contractActionModals } = useContractActionModals({
    projects,
    risks: riskOptions,
    onRefresh: refreshContractsAndProjects,
  });

  /**
   * PDF do dossiê a partir do contrato CONFIÁVEL, o mesmo que alimenta a tela.
   *
   * Se o batch de relações ainda não chegou, o contrato confiável não existe e
   * o export é recusado — melhor não gerar do que gerar um dossiê que não
   * corresponde ao que o usuário está vendo.
   */
  const handleExportPdf = async (record: ContractGovernanceRecord) => {
    const trusted = trustedPortfolio.find((c) => c.id === record.contract.id);
    if (!trusted) {
      notify('Dossiê indisponível', {
        description: 'As relações do contrato ainda não foram lidas. Tente novamente em instantes.',
        variant: 'error',
      });
      return;
    }
    const auditResult = await listContractAuditEvents(record.contract.id).catch(() => ({ rows: [], error: 'Falha ao ler o histórico.' }));
    const result = openContractDossierReport({
      contract: trusted,
      sla: approvalSla(trusted, computeApprovalSla),
      auditEvents: auditResult.rows,
      auditError: auditResult.error,
      source: 'Apex',
    });
    if (!result.ok) {
      notify('Não foi possível gerar o PDF', {
        description: result.message ?? 'Falha ao montar o dossiê do contrato.',
        variant: 'error',
      });
    }
  };

  /**
   * Abre o ARQUIVO ORIGINAL de um documento do acervo.
   *
   * A mesma mecânica do dossiê (`getContractDocumentUrl`): URL assinada e
   * curta sobre o bucket privado, de modo que o RLS do armazenamento continue
   * sendo quem autoriza e o link não sobreviva a um copiar-e-colar para fora
   * da sessão. Nada é gerado, reconstruído ou reenviado — o que abre é o PDF
   * que foi recebido, com a proveniência que o registro já guarda.
   */
  const handleOpenDocumentFile = async (doc: ContractDocumentRow) => {
    if (!doc.file_path) {
      notify('Arquivo original indisponível', {
        description: 'Este registro não tem arquivo vinculado no repositório.',
        variant: 'error',
      });
      return;
    }
    try {
      const url = await getContractDocumentUrl(doc.file_path);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      notify('Não foi possível abrir o arquivo original', {
        description: err instanceof Error ? err.message : 'Erro inesperado.',
        variant: 'error',
      });
    }
  };

  const openDossierDrawer = (record: ContractGovernanceRecord) => {
    setSelectedId(record.contract.id);
    setDrawerOpen(true);
  };

  const handleViewContract = (record: ContractGovernanceRecord) => {
    router.push(`/contratos/${record.contract.id}`);
  };

  const handleOpenFinance = (record: ContractGovernanceRecord) => {
    router.push(`/contratos/${record.contract.id}?tab=finance`);
  };

  const handleOpenBilling = (record: ContractGovernanceRecord) => {
    router.push(`/contratos/${record.contract.id}?tab=finance`);
  };

  const handleViewDocuments = (record: ContractGovernanceRecord) => {
    router.push(`/contratos/${record.contract.id}?tab=documents`);
  };

  const filteredRecords = useMemo(() => {
    const filter = activeKpiFilter ? KPI_FILTERS[activeKpiFilter] : null;
    if (!filter) return records;
    return records.filter(filter.predicate);
  }, [records, activeKpiFilter]);

  /**
   * A carteira CONFIÁVEL correspondente ao recorte atual da tela.
   *
   * As abas operacionais (renovações, obrigações, faturamento, aprovações,
   * riscos) leem daqui — nunca de `filteredRecords`, que carrega o preview
   * sintético do enricher. O recorte visual muda o que se vê; a proveniência
   * do que se vê não muda com ele.
   */
  const filteredTrusted = useMemo(
    () => filteredRecords
      .map((record) => trustedById.get(record.contract.id))
      .filter((c): c is NonNullable<typeof c> => Boolean(c)),
    [filteredRecords, trustedById],
  );

  /** Inteligência operacional de P2A, toda derivada da carteira confiável. */
  //
  // As abas OPERACIONAIS respeitam o escopo escolhido (`officialOnly: false`) e
  // rotulam a origem do recorte com `ScopeOriginNotice`. Quem protege a métrica
  // oficial da empresa é a Executive Band e o PDF, que aplicam a fronteira
  // dentro do próprio agregador e não mudam com o recorte visual.
  const cashFlow = useMemo(() => portfolioToCash(filteredTrusted, SCOPED), [filteredTrusted]);
  const obligationsTower = useMemo(() => buildObligationsTower(filteredTrusted), [filteredTrusted]);
  /**
   * O modelo canônico da Fase 3, resolvido no servidor.
   *
   * Vem por rota própria, e não do mesmo carregamento da carteira, porque a
   * resolução `asOf` cruza definição, ocorrência, evidência, dispensa e
   * dependência — trabalho de servidor, não de navegador. Sem `asOf` explícito,
   * a rota usa a data de hoje e a devolve, para que a tela mostre a data que
   * foi de fato usada.
   */
  const structuredObligations = useStructuredObligations();
  const portfolioFollowups = usePortfolioFollowups();
  const renewalHorizon = useMemo(() => buildRenewalHorizon(filteredTrusted, new Date(), SCOPED), [filteredTrusted]);
  const portfolioApprovals = useMemo(() => buildPortfolioApprovals(filteredTrusted, new Date(), SCOPED), [filteredTrusted]);
  const clauseRiskIntel = useMemo(
    () => buildClauseRiskIntelligence(filteredTrusted, undefined, { ...SCOPED, riskDetails: relationsBatch?.riskDetails }),
    [filteredTrusted, relationsBatch],
  );
  const portfolioSyncKey = useMemo(
    () => `${filteredTrusted.map((c) => c.id).sort().join(',')}:${relationsBatch ? 'live' : 'pending'}`,
    [filteredTrusted, relationsBatch],
  );
  const approvalRequirements = usePortfolioApprovalRequirements(filteredTrusted, portfolioSyncKey);

  /*
    ─── INTELIGÊNCIA DA CARTEIRA ────────────────────────────────────────────

    Os quatro gráficos da Visão Geral derivam das MESMAS estruturas que as
    áreas operacionais já leem — `cashFlow`, `renewalHorizon`, o portfólio
    confiável e a bancada de marcos. Nenhum agregador novo de verdade de
    domínio nasce aqui: se o gráfico e a lista pudessem discordar, a discordância
    apareceria eventualmente, e o gráfico é justamente a superfície em que
    ninguém confere.
  */
  const backlog = usePortfolioBacklog(
    useMemo(() => filteredTrusted.map((c) => c.id), [filteredTrusted]),
    portfolioSyncKey,
  );
  const riskBands = useMemo(() => buildRiskExposureBands(filteredTrusted), [filteredTrusted]);
  const cashTimeline = useMemo(() => buildCashTimeline(filteredTrusted), [filteredTrusted]);

  /**
   * Os indicadores da área ATIVA.
   *
   * Um conjunto por área, e cada um lê do agregado da sua própria área. A tira
   * única de oito métricas que existia aqui mostrava faturamento em Documentos
   * e obrigações em Aprovações — números verdadeiros no lugar errado, que é a
   * forma mais eficiente de treinar alguém a não olhar para a primeira dobra.
   */
  const sectionKpis = useMemo(
    () => buildSectionKpis(activeSection, {
      stats: trustedStats,
      contracts: filteredTrusted,
      renewal: renewalHorizon,
      obligations: {
        portfolio: structuredObligations.portfolio,
        loading: structuredObligations.loading,
        error: structuredObligations.error,
      },
      cash: cashFlow,
      backlog: backlog.backlog,
      backlogError: backlog.error,
      approvals: portfolioApprovals,
      approvalRequirements: {
        // O hook guarda o AGREGADO sob `requirements`; a lista é um nível abaixo.
        requirements: approvalRequirements.requirements.requirements,
        loading: approvalRequirements.loading,
        error: approvalRequirements.error,
      },
      clauseRisk: clauseRiskIntel,
      riskBands,
    }),
    [
      activeSection, trustedStats, filteredTrusted, renewalHorizon,
      structuredObligations, cashFlow, backlog, portfolioApprovals,
      approvalRequirements, clauseRiskIntel, riskBands,
    ],
  );

  /**
   * Clique numa faixa do gráfico de risco → o recorte da carteira.
   *
   * Só "alto" tem filtro na Executive Band, e não se inventa um filtro novo
   * para médio e baixo: as duas outras faixas navegam para a lista, que é onde
   * o recorte por risco já existe como coluna ordenável.
   */
  const handleSelectRiskBand = useCallback((band: RiskBandKey) => {
    if (band === 'high') {
      setActiveKpiFilter((current) => (current === 'alto_risco' ? null : 'alto_risco'));
      setActiveSection('contracts');
      return;
    }
    setActiveKpiFilter(null);
    setActiveSection('contracts');
  }, [setActiveSection]);

  const handleOpenRenewalWindow = useCallback((_bands: readonly HorizonBand[]) => {
    // Renovações já abre listando as janelas; abrir a área é o destino certo.
    setActiveSection('renewals');
  }, [setActiveSection]);

  const handleOpenBillingStage = useCallback((_stage: BacklogStageKey) => {
    setActiveSection('faturamento');
  }, [setActiveSection]);


  /** Origem dos contratos do recorte — alimenta o aviso das abas operacionais. */
  const scopeOrigins = useMemo(() => filteredTrusted.map((c) => c.dataClass), [filteredTrusted]);

  const selectedRecord = useMemo(() => {
    return filteredRecords.find((record) => record.contract.id === selectedId)
      || filteredRecords[0]
      || records[0]
      || null;
  }, [filteredRecords, records, selectedId]);

  /**
   * Origens possíveis para uma obrigação do contrato selecionado.
   *
   * A origem é obrigatória na Fase 3 — sem cláusula, aditivo ou documento o
   * banco recusa a definição. Oferecer a lista aqui transforma a recusa numa
   * escolha; deixá-la de fora transformaria em erro no fim do formulário.
   */
  const obligationOrigins = useMemo(() => {
    const trusted = filteredTrusted.find((c) => c.id === selectedRecord?.contract.id);
    if (!trusted) return [];
    const clauses = hasOfficialValue(trusted.clauses) ? trusted.clauses.value : [];
    const documents = hasOfficialValue(trusted.documents) ? trusted.documents.value : [];
    return [
      ...clauses.map((clause) => ({
        value: `clause:${clause.id}`,
        label: `Cláusula · ${clause.title}${clause.source_page ? ` (p. ${clause.source_page})` : ''}`,
      })),
      ...documents.map((document) => ({
        value: `document:${document.id}`,
        label: `Documento · ${document.title}`,
      })),
    ];
  }, [filteredTrusted, selectedRecord?.contract.id]);

  // Create-obligation / create-billing modals, bound to the drawer's selected contract.
  /*
    Aditivo pelo dossiê rápido. `selectedId` é o contrato aberto no drawer —
    o hook precisa de um id concreto, e sem seleção não há o que aditar.
  */
  const amendmentModals = useContractAmendmentModals({
    contractId: selectedId ?? '',
    onRefresh: refreshContractsAndProjects,
  });

  const createModals = useContractCreateModals({
    contractId: selectedRecord?.contract.id ?? '',
    ownerUserId: selectedRecord?.contract.responsibleId ?? null,
    // A origem é obrigatória, e as cláusulas/documentos do contrato selecionado
    // são o que a carteira tem à mão sem abrir o dossiê inteiro.
    origins: obligationOrigins,
    onRefresh: refreshContractsAndProjects,
  });

  // RBAC gating for drawer + tab actions (UI-level; Supabase RLS enforces server-side).
  // Keys mirror the migration-034 RLS policies so UI gating == server enforcement:
  //  - documents manage: contracts.documents.upload OR contracts.edit
  //  - approvals manage: contracts.approve  (Fase 0.2 — `contracts.edit` NÃO aprova)
  //  - obligations/links manage: contracts.edit
  const contractPermissions = {
    edit: hasPermission('contracts.edit'),
    /*
      `|| hasPermission('contracts.edit')` foi removido na Fase 0.2.

      Nos papéis semeados, `juridico_contratos` tem `contracts.edit` e NÃO tem
      `contracts.approve` — ou seja, o papel que cadastra o contrato via ficava
      o botão de decidir sobre ele. A separação entre redigir e aprovar existia
      no catálogo de permissões e não existia em lugar nenhum que a aplicasse.

      Aqui é só a UX: quem manda é a RLS (`contract_approvals_insert` /
      `_update`) e o trigger `trg_contract_approval_safety`, que também barram
      autoaprovação e etapa fora de ordem — inclusive para a chave de serviço.
    */
    approve: hasPermission('contracts.approve'),
    uploadDoc: hasPermission('contracts.documents.upload') || hasPermission('contracts.edit'),
    delete: hasPermission('contracts.delete') || hasPermission('admin.manage_organization'),
  };

  // Shared item-action modals reused by the drawer's tabs (Obrigações/Documentos).
  const pageItemModals = useContractItemModals({ onSuccess: refreshContractsAndProjects });
  const [tabBusyId, setTabBusyId] = useState<string | null>(null);
  const runTabAction = async (key: string, action: () => Promise<unknown>, successMsg: string) => {
    setTabBusyId(key);
    try {
      await action();
      await refreshContractsAndProjects();
      notify(successMsg, { variant: 'success' });
    } catch (err) {
      notify('Não foi possível concluir', { description: err instanceof Error ? err.message : 'Erro inesperado.', variant: 'error' });
    } finally {
      setTabBusyId(null);
    }
  };


  // Badge counts for the tabs follow the active KPI recorte (band stays global).
  const tabCounts = useMemo(() => ({
    expiring: filteredRecords.filter((record) => record.daysUntilExpiration !== null && record.daysUntilExpiration >= 0 && record.daysUntilExpiration <= 90).length,
    overdue: filteredRecords.flatMap((record) => record.obligations).filter((obligation) => obligation.status === 'overdue').length,
    highRisk: filteredRecords.filter((record) => record.contract.riskClassification === 'high').length,
    missingDocs: filteredRecords.reduce((sum, record) => sum + record.missingDocuments.length, 0),
  }), [filteredRecords]);

  // owner_admin holds every permission via the catch-all CTE in
  // 005_auth_rbac_foundation.sql, so a permission-only check covers it
  // without inspecting role keys (RBAC audit R10).
  const canDeleteLinkedProject =
    hasPermission('projects.delete')
    || hasPermission('admin.manage_organization');

  const canDeleteContract = contractPermissions.delete;

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

  const handleContractLogoUpload = async (
    record: ContractGovernanceRecord,
    file: File | null,
  ): Promise<string | null> => {
    const trusted = trustedById.get(record.contract.id);
    const projectId =
      trusted && hasOfficialValue(trusted.project)
        ? trusted.project.value.id
        : record.project?.id
          ?? projects.find((project) => {
              const client = (project.cliente || '').trim().toLowerCase();
              const name = (record.companyName || '').trim().toLowerCase();
              return Boolean(client && name && (client === name || client.includes(name) || name.includes(client)));
            })?.id
          ?? null;

    if (!projectId) {
      notify('Vincule um projeto para gravar a logo do cliente', {
        description: 'A logo fica no projeto e aparece nos cards de contratos e de projetos.',
        variant: 'warning',
      });
      return null;
    }

    try {
      const url = file ? (await uploadProjectFile(projectId, file, 'logo')).publicUrl : null;
      await updateProjectV2(projectId, { clientLogoUrl: url ?? undefined }, 'current_user');
      await refreshContractsAndProjects();
      return url;
    } catch (error) {
      notify('Não foi possível salvar a logo', {
        description: error instanceof Error ? error.message : 'Tente enviar a imagem novamente.',
        variant: 'error',
      });
      return null;
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
      setDrawerOpen(false);
      setNotice(`Contrato "${record.contract.name}" excluído.`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Erro ao excluir contrato.');
    }
  };

  /**
   * Traz um contrato REAL para dentro do módulo.
   *
   * A ordem importa e é deliberada:
   *
   *   1. o contrato nasce — é o que dá identidade e id a tudo o mais;
   *   2. o documento original entra em `contract_documents`, versionado;
   *   3. a análise assistida roda por último, e SÓ se pedida.
   *
   * Cada etapa depois da primeira pode falhar sem levar junto o que já foi
   * gravado: um upload que falha não desfaz o contrato, e uma análise que
   * falha não desfaz o documento. O usuário é informado do que ficou pendente
   * e conclui pelo dossiê — que é onde essas ações existem de qualquer forma.
   * Desfazer tudo por causa do terceiro passo obrigaria a redigitar um cadastro
   * inteiro por causa de uma indisponibilidade de rede.
   */
  const handleContractOnboarded = async (draft: ContractOnboardingDraft) => {
    const creationPolicy = { dataClass: 'unclassified' as const };
    if (draft.onboardingIntakeId) {
      // A MESMA carga que a retomada envia — um cadastro concluído aqui ou por
      // `/contratos/onboarding/[intakeId]` produz exatamente o mesmo contrato.
      const result = await finalizeContractIntake(draft.onboardingIntakeId, buildIntakeFinalValues(draft));
      await refresh();
      setSelectedId(result.contractId);
      setActiveSection('contracts');
      setNotice(`Contrato "${draft.title}" criado. A operacionalização contratual continua em segundo plano.`);
      return;
    }
    const row = await persistContract({
      /**
       * O contrato nasce NÃO CLASSIFICADO. Sempre.
       *
       * Antes ele nascia `'live'` — a interface se autocertificava como origem
       * oficial. Isso contradizia a regra que a própria migration 091 escreveu
       * ao definir o default da coluna: "nenhum contrato nasce oficial: alguém
       * precisa afirmar que é". Cadastrar não é afirmar procedência; é só
       * cadastrar. Enquanto ninguém classifica, o contrato existe, é operável e
       * fica FORA de toda métrica oficial da carteira — que é exatamente o
       * comportamento seguro, porque o custo de um contrato de teste entrando
       * na exposição oficial é muito maior que o de um contrato real esperando
       * uma classificação explícita.
       *
       * Promover para `'live'` (ou marcar `'demo'`) é ato de governança, por
       * `reclassifyContract`: exige justificativa, carimba autor e deixa
       * `contract.reclassified` na auditoria com origem e destino.
       */
      dataClass: creationPolicy.dataClass,
      title: draft.title,
      contractNumber: draft.contractNumber,
      counterpartyName: draft.counterpartyName,
      // `null` quando o texto digitado não corresponde a nenhuma entidade
      // canônica — que é o caminho normal e continua criando o contrato.
      counterpartyPartyId: draft.counterpartyPartyId,
      contractType: draft.contractType,
      projectId: draft.projectId,
      status: draft.status,
      /*
        `lifecycle_stage` NÃO recebe o `status`. São vocabulários distintos:
        status é o estado comercial ('negotiation', 'active'), lifecycle_stage
        marca o avanço da orquestração ('created', 'legal_review',
        'project_created'). Copiar um no outro fazia o estágio de ciclo de vida
        exibir "negotiation", que não é estágio nenhum. Omitido aqui de
        propósito: `createContract` grava 'created', que é o estágio correto de
        um contrato recém-cadastrado.
      */
      startDate: draft.startDate,
      endDate: draft.endDate,
      signedDate: draft.signedDate,
      renewalDate: draft.renewalDate,
      currency: draft.currency,
      totalValue: draft.totalValue,
      monthlyValue: draft.monthlyValue,
      paymentTerms: draft.paymentTerms,
      scopeSummary: draft.scopeSummary,
      riskLevel: draft.riskLevel,
      ownerUserId: draft.ownerUserId,
      ownerPersonId: draft.ownerPersonId,
    });

    const pending: string[] = [];
    let documentId: string | null = null;

    if (draft.document) {
      try {
        const doc = await uploadContractDocument(
          row.id,
          draft.document.title,
          draft.document.file,
          draft.document.documentType,
        );
        documentId = doc.id;
      } catch (err) {
        pending.push(err instanceof Error ? `documento não anexado (${err.message})` : 'documento não anexado');
      }
    }

    if (draft.runExtraction && documentId) {
      try {
        // A extração agora é enfileirada: a resposta confirma o PEDIDO, não o
        // resultado. Dizer "N propostas" aqui afirmaria um número que ainda
        // não existe.
        await requestClauseExtraction(row.id, documentId);
        pending.push('análise de cláusulas enfileirada — as propostas aparecem na fila de revisão');
      } catch (err) {
        pending.push(err instanceof Error ? `análise não enfileirada (${err.message})` : 'análise não enfileirada');
      }
    }

    await refresh();
    setSelectedId(row.id);
    setActiveSection('contracts');
    setNotice(
      pending.length > 0
        ? `Contrato "${row.title}" criado — ${pending.join('; ')}.`
        : `Contrato "${row.title}" criado na carteira oficial.`,
    );
  };

  /*
    ─── TORRE DE CONTROLE ───────────────────────────────────────────────────

    Os números vêm todos de dado PERSISTIDO. Onde a leitura falhou, a célula
    recebe `null` e a torre mostra "—": "0 obrigações em atraso" e "não
    consegui ler as obrigações" levam a decisões opostas, e um zero
    tranquilizador sobre uma consulta quebrada é o pior resultado possível.
  */
  const monitoringCells = useMemo(() => {
    const obligationsFailed = Boolean(structuredObligations.error);
    const followupsFailed = Boolean(portfolioFollowups.error);
    const counts = structuredObligations.portfolio.counts;
    const open = portfolioFollowups.followups.filter((f) => isOpenFollowup(f.state));

    /*
      Interpretações que exigem atenção — mesma fonte da Inteligência
      Contratual (`operationalInterpretations` / migration 161). Contar
      `clauses.interpretation_state` reintroduz o "21" stale de JA10182283.
    */
    let attentionInterpretations: number | null = 0;
    for (const contract of trustedPortfolio) {
      if (isError(contract.operationalInterpretations)) { attentionInterpretations = null; break; }
      if (!hasOfficialValue(contract.operationalInterpretations)) continue;
      attentionInterpretations = (attentionInterpretations ?? 0)
        + buildContractIntelligence(contract.operationalInterpretations.value).attentionCount;
    }

    const requiresYou: MonitoringCell[] = [
      {
        label: 'Interpretações a decidir',
        value: attentionInterpretations,
        hint: 'Exceções de política: exposição material, ambiguidade ou alçada.',
        onClick: () => setActiveSection('risks'),
      },
      {
        label: 'Obrigações em atraso',
        value: obligationsFailed ? null : counts.OVERDUE,
        hint: 'O prazo passou e nada foi registrado como cumprido.',
        onClick: () => setActiveSection('obligations'),
      },
      {
        label: 'Faturamento bloqueado',
        value: obligationsFailed ? null : structuredObligations.portfolio.billingBlockedContracts.length,
        hint: 'Contratos com faturamento contratualmente travado.',
        onClick: () => setActiveSection('faturamento'),
      },
      {
        label: 'Acompanhamentos escalados',
        value: followupsFailed ? null : open.filter((f) => f.state === 'ESCALATED').length,
        hint: 'O prazo estourou a política de acompanhamento.',
        onClick: () => setActiveSection('obligations'),
      },
    ];

    const monitoring: MonitoringCell[] = [
      {
        label: 'Acompanhamentos ativos',
        value: followupsFailed ? null : open.filter((f) => f.state === 'ACTIVE').length,
        hint: 'Com dono e prazo; o Apex cobra conforme a cadência.',
      },
      {
        label: 'Aguardando a contraparte',
        value: followupsFailed ? null : open.filter((f) => f.state === 'WAITING_EXTERNAL_PARTY').length,
        hint: 'O Apex está calado de propósito até a data esperada.',
      },
      {
        label: 'Obrigações no prazo',
        value: obligationsFailed ? null : counts.UPCOMING,
        hint: 'Exigências ativas cujo prazo ainda está por vir.',
        onClick: () => setActiveSection('obligations'),
      },
      {
        label: 'Renovações no horizonte',
        value: tabCounts.expiring,
        hint: 'Contratos com vencimento ou renovação próximos.',
        onClick: () => setActiveSection('renewals'),
      },
    ];

    const awaitingSchedule: MonitoringCell[] = [
      {
        label: 'Exigências sem agenda',
        value: obligationsFailed ? null : counts.AWAITING_SCHEDULE_ANCHOR,
        hint: 'O Apex entendeu a regra; o prazo aparece quando Projetos agendar o evento.',
        onClick: () => setActiveSection('obligations'),
      },
      {
        label: 'Prazo não apurado',
        value: obligationsFailed ? null : counts.UNKNOWN,
        hint: 'Falta a âncora de vigência ou o calendário de dias úteis da organização.',
        onClick: () => setActiveSection('obligations'),
      },
    ];

    return { requiresYou, monitoring, awaitingSchedule };
  }, [structuredObligations, portfolioFollowups, trustedPortfolio, tabCounts.expiring, setActiveSection]);

  const tabs: HudTab[] = [
    {
      id: 'overview',
      label: sectionLabels.overview,
      icon: <BarChart3 className="h-4 w-4" />,
      content: (
        <OverviewSection
          records={filteredRecords}
          trustedById={trustedById}
          stats={trustedStats}
          monitoringCells={monitoringCells}
          /*
            A tira executiva da Visão Geral é a da PRÓPRIA área: exposição,
            contratos ativos, o que requer decisão, faturamento elegível,
            renovações e cobertura apurada. As outras sete áreas têm cada uma a
            sua, montada pelo mesmo `buildSectionKpis`.
          */
          kpiStrip={
            <ContractsKpiStrip
              kpis={sectionKpis}
              onNavigate={setActiveSection}
              onFilter={toggleKpiFilter}
              activeFilterId={activeKpiFilter}
            />
          }
          intelligence={
            <PortfolioIntelligence
              cashStages={cashFlow}
              cashTimeline={cashTimeline}
              backlog={backlog.backlog}
              backlogLoading={backlog.loading}
              backlogError={backlog.error}
              riskBands={riskBands}
              renewal={renewalHorizon}
              activeRiskBand={activeKpiFilter === 'alto_risco' ? 'high' : null}
              onOpenBilling={() => setActiveSection('faturamento')}
              onOpenBillingStage={handleOpenBillingStage}
              onSelectRiskBand={handleSelectRiskBand}
              onOpenRenewalWindow={handleOpenRenewalWindow}
            />
          }
          kpiBand={
            /*
              O disclosure genérico do dossiê saiu daqui. Ele desenhava uma
              linha de texto com um chevron solto sobre o fundo da página — no
              meio de blocos de vidro com cabeçalho, chip de ícone e contagem,
              a ferramenta mais densa da tela era a única sem nenhuma moldura,
              e lia como um link perdido.

              Agora é um `OverviewBlock` como os outros, só que recolhido: o
              mesmo cabeçalho, o mesmo material, a mesma altura de régua — e
              abre sozinho quando há filtro aplicado.
            */
            <OverviewBlock
              title="Indicadores e filtros da carteira"
              hint="resumo executivo · clique num indicador para filtrar"
              icon={<BarChart3 aria-hidden />}
              collapsible
              defaultOpen={Boolean(activeKpiFilter)}
            >
              <ContractExecutiveBand
                stats={trustedStats}
                contractCount={contractRows.length}
                activeFilter={activeKpiFilter}
                onToggleFilter={toggleKpiFilter}
                hideExposure
                compact
              />
            </OverviewBlock>
          }
          onOpenAudit={() => setHistoryOpen(true)}
          attention={attention}
          connections={connections}
          horizon={horizon}
          healthCoverage={healthCoverage}
          onOpenContractById={(id) => {
            const target = records.find((r) => r.contract.id === id);
            if (target) openDossierDrawer(target);
          }}
          onModuleNavigate={(key: ModuleKey) => {
            if (key === 'faturamento') setActiveSection('faturamento');
            else if (key === 'obrigacoes') setActiveSection('obligations');
            else if (key === 'documentos') setActiveSection('documents');
            else if (key === 'aprovacoes') setActiveSection('aprovacoes');
            // Auditoria deixou de ser aba: mesmo destino, agora gaveta.
            else if (key === 'auditoria') setHistoryOpen(true);
          }}
          selectedRecord={selectedRecord}
          onSelect={openDossierDrawer}
          onView={handleViewContract}
          onOpenPortfolio={() => setActiveSection('contracts')}
          activity={activity}
          codeById={codeById}
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
          trustedById={trustedById}
          selectedId={selectedRecord?.contract.id || null}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          onSelect={openDossierDrawer}
          onView={handleViewContract}
          canDeleteLinkedProject={canDeleteLinkedProject}
          canDeleteContract={canDeleteContract}
          onDeleteLinkedProject={handleDeleteLinkedProject}
          onDeleteContract={handleDeleteContract}
        />
      ),
    },
    {
      id: 'renewals',
      label: sectionLabels.renewals,
      icon: <CalendarClock className="h-4 w-4" />,
      badge: tabCounts.expiring,
      content: (
        <div className="space-y-4">
        <RenewalHorizonPanel
          horizon={renewalHorizon}
          onSelectContract={(contractId) => {
            const record = records.find((r) => r.contract.id === contractId);
            if (record) openDossierDrawer(record);
          }}
        />
        </div>
      ),
    },
    {
      id: 'obligations',
      label: sectionLabels.obligations,
      icon: <ClipboardCheck className="h-4 w-4" />,
      badge: tabCounts.overdue,
      content: (
        <div className="space-y-4">
        {/*
          O modelo canônico da Fase 3 vem PRIMEIRO: é ele que responde o que o
          contrato exige, de quem, desde quando, com que evidência e se bloqueia
          faturamento. A lista antiga fica abaixo, rotulada, porque as linhas
          que existem nela são reais e sumir com elas sem explicação seria pior
          que mantê-las visíveis no lugar certo.
        */}
        <p className="dossier-meta rounded-lg border border-ig-border bg-ig-raised px-4 py-3">Obrigações estruturadas: visão de todos os contratos da organização, incluindo demonstração. Use a busca abaixo para localizar um contrato.</p>
        {structuredObligations.loading ? <p role="status" className="dossier-meta p-4">Carregando obrigações estruturadas…</p> : structuredObligations.error ? (
          <HudPanel state="warning" title="Obrigações estruturadas indisponíveis">
            <p className="text-sm text-ig-warning">{structuredObligations.error}</p>
          </HudPanel>
        ) : (
          <StructuredObligationsPanel
            portfolio={structuredObligations.portfolio}
            onOpenContract={(contractId) => {
              const record = records.find((r) => r.contract.id === contractId);
              if (record) openDossierDrawer(record);
            }}
          />
        )}
        {/*
          Sem `onComplete`: a lista legada é somente-leitura desde a Fase 3, e
          um botão que só sabe falhar é pior que a sua ausência. Concluir uma
          obrigação passou a ser transição de OCORRÊNCIA, com base declarada e
          histórico — não um `status` marcado à mão.
        */}
        <DossierDisclosure title="Lista anterior de obrigações e tarefas">
        <ObligationsControlTower
          tower={obligationsTower}
          canEdit={contractPermissions.edit}
          busyId={tabBusyId}
          onCreateTask={(contractId, title, dueAt, ownerUserId, key) => runTabAction(key, () => createTaskFromObligation(contractId, title, dueAt, ownerUserId), 'Tarefa criada na agenda')}
        />
        </DossierDisclosure>
        </div>
      ),
    },
    {
      id: 'faturamento',
      label: sectionLabels.faturamento,
      icon: <Receipt className="h-4 w-4" />,
      content: (
        <div className="space-y-5">
          <DossierSection title="Do contrato ao caixa" hint="Acompanhe a origem e a disponibilidade dos valores em cada etapa.">
            <ContractToCashFlow stages={cashFlow} />
          </DossierSection>

          {/*
            ─── O COCKPIT MENSAL vem antes de tudo ──────────────────────────

            A primeira pergunta de quem abre Faturamentos é "quanto vamos
            faturar neste mês?" — e até aqui a aba respondia com uma lista de
            eventos já gerados, que é a ÚLTIMA etapa da cadeia. Contrato sem
            nenhum evento (o caso de JA10182283/2025) abria uma tela vazia,
            como se não houvesse R$ 8 milhões de direito contratual previsto.

            O cockpit lê a visão de planejamento (migration 179), que deriva
            data e mês previstos do cronograma GOVERNADO do projeto. Os painéis
            abaixo continuam intactos: marcos, eventos e histórico seguem sendo
            listas distintas, porque são fatos de etapas distintas.
          */}
          <BillingPlanningWorkspace
            contractIds={filteredRecords.map((record) => record.contract.id)}
            canEdit={contractPermissions.edit}
            refreshKey={portfolioSyncKey}
            contractLabel={(id) => {
              const found = filteredRecords.find((record) => record.contract.id === id);
              const trusted = trustedById.get(id);
              const os = trusted && hasOfficialValue(trusted.project) && trusted.project.value.codigo
                ? trusted.project.value.codigo
                : found?.projectReference && !found.projectReference.startsWith('Projeto não')
                  ? found.projectReference.split(' · ')[0]
                  : (found?.code ?? id);
              return os;
            }}
            clientLabel={(id) => {
              const found = filteredRecords.find((record) => record.contract.id === id);
              const trusted = trustedById.get(id);
              if (trusted && hasOfficialValue(trusted.project) && trusted.project.value.cliente) {
                return trusted.project.value.cliente;
              }
              if (trusted && hasOfficialValue(trusted.counterparty)) return trusted.counterparty.value;
              return found?.companyName ?? id;
            }}
            onOpenContract={(contractId) => {
              const record = records.find((r) => r.contract.id === contractId);
              if (record) openDossierDrawer(record);
            }}
            onNotify={(message, variant) => notify(message, { variant })}
          />

          {/*
            Marcos CONTRATOUAIS primeiro. Zero eventos de faturamento não esvazia
            o módulo: o direito previsto (ex.: 6 eventos de JA10182283) continua
            visível. Eventos gerados ficam no painel canônico abaixo.
          */}
          <DossierSection
            title="Marcos contratuais de faturamento"
            hint="Direito, exigência, medição e elegibilidade — mesmo read model do dossiê."
          >
            <PortfolioBillingMilestones
              contractIds={filteredRecords.map((record) => record.contract.id)}
              refreshKey={portfolioSyncKey}
              contractLabel={(id) => {
                const found = filteredRecords.find((record) => record.contract.id === id);
                const trusted = trustedById.get(id);
                const company = found?.companyName
                  ?? (trusted && hasOfficialValue(trusted.counterparty) ? trusted.counterparty.value : null)
                  ?? id;
                // Ordem de serviço do projeto — não o CTR-* gerado do id.
                const os = trusted && hasOfficialValue(trusted.project) && trusted.project.value.codigo
                  ? trusted.project.value.codigo
                  : found?.projectReference && !found.projectReference.startsWith('Projeto não')
                    ? found.projectReference.split(' · ')[0]
                    : (found?.code ?? id);
                return `${os} · ${company}`;
              }}
              contractBrand={(id) => {
                const trusted = trustedById.get(id);
                if (!trusted) {
                  const found = filteredRecords.find((record) => record.contract.id === id);
                  return found ? { client: found.companyName } : null;
                }
                const linked = hasOfficialValue(trusted.project);
                return {
                  client: linked && trusted.project.value.cliente
                    ? trusted.project.value.cliente
                    : (hasOfficialValue(trusted.counterparty) ? trusted.counterparty.value : trusted.title),
                  logoUrl: linked ? trusted.project.value.clientLogoUrl : undefined,
                };
              }}
              onOpenContract={(contractId) => {
                const record = records.find((r) => r.contract.id === contractId);
                if (record) openDossierDrawer(record);
              }}
            />
          </DossierSection>

          <DossierSection title="Eventos de faturamento" hint="Só aparecem quando o evento foi gerado. Abra para conferir elegibilidade, liberação e vínculo financeiro.">
            <ContractToCashPanel
              compact
              contractIds={filteredRecords.map((record) => record.contract.id)}
              contractLabel={(id) => {
                const found = filteredRecords.find((record) => record.contract.id === id);
                const trusted = trustedById.get(id);
                const company = found?.companyName
                  ?? (trusted && hasOfficialValue(trusted.counterparty) ? trusted.counterparty.value : null)
                  ?? id;
                const os = trusted && hasOfficialValue(trusted.project) && trusted.project.value.codigo
                  ? trusted.project.value.codigo
                  : found?.projectReference && !found.projectReference.startsWith('Projeto não')
                    ? found.projectReference.split(' · ')[0]
                    : (found?.code ?? id);
                return `${os} · ${company}`;
              }}
              onNotify={(message, variant) => notify(message, { variant })}
            />
          </DossierSection>

          <DossierDisclosure title="Registros históricos de faturamento">
          <FaturamentoSection
            records={filteredRecords}
            canEdit={contractPermissions.edit}
            busyId={tabBusyId}
            onRealize={(event) => pageItemModals.openRealizeBilling(event)}
            onFollowUp={(record) => contractActions.createTask(record)}
          />
          </DossierDisclosure>
        </div>
      ),
    },
    {
      id: 'aprovacoes',
      label: sectionLabels.aprovacoes,
      icon: <ShieldCheck className="h-4 w-4" />,
      content: (
        <div className="space-y-4">
        <ApprovalEngineStatusBanner />
        <PortfolioApprovalRequirementsPanel
          requirements={approvalRequirements.requirements}
          loading={approvalRequirements.loading}
          error={approvalRequirements.error}
          onOpenContract={(contractId) => {
            const record = records.find((r) => r.contract.id === contractId);
            if (record) openDossierDrawer(record);
          }}
        />
        <ApprovalIntelligencePanel
          approvals={portfolioApprovals}
          canApprove={contractPermissions.approve}
          onReview={(contractId) => {
            const record = records.find((r) => r.contract.id === contractId);
            if (record) contractActions.reviewApproval(record);
          }}
        />
        </div>
      ),
    },
    {
      id: 'risks',
      label: sectionLabels.risks,
      icon: <ShieldAlert className="h-4 w-4" />,
      badge: tabCounts.highRisk,
      content: (
        <div className="space-y-5">
          <RisksSection records={filteredRecords} />
          {contractPermissions.edit && <DossierSection title="Gerenciar risco de um contrato" hint="Escolha o contrato que receberá o vínculo de risco.">
            <div className="flex flex-wrap items-center gap-3">
              <select className="portfolio-select" aria-label="Contrato para gerenciar riscos" value={filteredRecords.some((r) => r.contract.id === riskTargetId) ? riskTargetId : ''} onChange={(e) => setRiskTargetId(e.target.value)}>
                <option value="">Selecione um contrato</option>{filteredRecords.map((r) => <option key={r.contract.id} value={r.contract.id}>{r.code} · {r.contract.name}</option>)}
              </select>
              {filteredRecords.some((r) => r.contract.id === riskTargetId) && <>
                <button type="button" className="portfolio-action" onClick={() => { const target = filteredRecords.find((r) => r.contract.id === riskTargetId); if (target) contractActions.createRisk(target); }}>Criar risco</button>
                <button type="button" className="portfolio-action" onClick={() => { const target = filteredRecords.find((r) => r.contract.id === riskTargetId); if (target) contractActions.linkExistingRisk(target); }}>Vincular existente</button>
              </>}
            </div>
          </DossierSection>}
          <ClauseRiskIntelligencePanel
            intelligence={clauseRiskIntel}
            onOpenContract={(id) => { const target = filteredRecords.find((r) => r.contract.id === id); if (target) handleViewContract(target); }}
          />
        </div>
      ),
    },
    {
      id: 'documents',
      label: sectionLabels.documents,
      icon: <FileText className="h-4 w-4" />,
      badge: tabCounts.missingDocs,
      content: (
        <PortfolioDocuments
          records={filteredRecords}
          canUploadDoc={contractPermissions.uploadDoc}
          busyId={tabBusyId}
          onApprove={(docId, key) => runTabAction(key, () => updateContractDocumentStatus(docId, 'approved'), 'Documento aprovado')}
          onSendToApproval={(docId, key) => runTabAction(key, () => updateContractDocumentStatus(docId, 'pending_approval'), 'Documento enviado para aprovação')}
          onReject={(doc) => pageItemModals.openRejectDoc(doc)}
          onOpenContract={handleViewContract}
          onOpenDocumentFile={handleOpenDocumentFile}
        />
      ),
    },
  ];

  return (
    <HudPageLayout className="ig-dossier-theme ig-portfolio-page">
      <HudHeader
        title={sectionLabels[activeSection]}
        subtitle={AREA_HINT[activeSection]}
        icon={<FileSignature className="h-5 w-5" />}
        breadcrumbs={[{ label: 'Gestão de Contratos' }, { label: sectionLabels[activeSection] }]}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {/*
              Origem dos dados de governança, no HudSignal do sistema.

              Era uma cápsula outline com um ponto colorido dentro — o desenho
              que o HudSignal existe justamente para substituir. O ponto
              pulsante da sincronização sobrevive como `pulse`, que é a mesma
              ideia expressa pelo primitivo em vez de por uma classe local.

              Correção semântica de P0.3: uma FALHA de leitura não é uma
              estimativa. "Estimado" sugere um número aproximado; aqui não há
              número nenhum. Erro e demonstração nunca compartilham rótulo.
            */}
            <HudSignal
              size="sm"
              className="hidden md:inline-flex"
              tone={governanceLoading ? 'neutral' : governance.error ? 'critical' : governance.live > 0 ? 'live' : 'neutral'}
              pulse={governanceLoading}
              title="Fonte dos dados de governança (obrigações, faturamento, documentos, aprovações, vínculos)"
              label={
                governanceLoading
                  ? 'Sincronizando…'
                  : governance.error
                    ? 'Dados indisponíveis'
                    : governance.live > 0
                      ? 'Ao vivo'
                      : 'Sem dado apurado'
              }
              value={
                !governanceLoading && !governance.error && governance.live > 0
                  ? `${governance.live}/${governance.total}`
                  : undefined
              }
            />
            {/*
              "Histórico" e "Exportar PDF" saíram do cabeçalho da CARTEIRA.

              Ambos respondem a perguntas sobre um objeto, não sobre o módulo:
              o histórico de auditoria e o dossiê em PDF são de um contrato.
              No nível da carteira eram ambíguos — "histórico de quê?", "PDF de
              qual recorte?" — e o PDF ainda dependia do filtro em vigor, de
              modo que o mesmo botão gerava documentos diferentes conforme o
              que estivesse selecionado. Ambos seguem no dossiê do contrato,
              onde o sujeito é inequívoco.
            */}
            {/*
              "Adicionar contrato", e não "Novo contrato".

              A diferença não é de estilo. "Novo" descreve um contrato que
              NASCE aqui — e não nasce: o cliente escreveu, assinou e mandou.
              O que acontece nesta tela é a entrada daquele documento no Apex,
              para que ele seja entendido e passe a ser monitorado. O rótulo
              anterior treinava o usuário a pensar em cadastro manual; este
              descreve o que o produto realmente faz.
            */}
            {hasPermission('contracts.create') && !permissionsLoading ? (
              <HudButton variant="primary" size="md" leftIcon={<Plus className="h-4 w-4" />} onClick={() => setUploadOpen(true)}>
                Adicionar contrato
              </HudButton>
            ) : null}
          </div>
        }
      />

      <label className="flex items-center gap-3 text-xs text-ig-fg-muted lg:hidden">Área de trabalho
        <select className="portfolio-select flex-1" aria-label="Área de contratos" value={activeSection} onChange={(event) => setActiveSection(event.target.value as SectionId)}>
          {Object.entries(sectionLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </label>
      {(loading || error) && (
        <HudPanel elevation={1} state={error ? 'critical' : 'default'} interactive={false}>
          <p className="text-ig-body-sm text-ig-fg-strong">
            {error || 'Carregando contratos...'}
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

      {/*
        O SELETOR de origem saiu do cabeçalho. No lugar, um aviso contextual que
        só existe quando há registro fora da carteira oficial — e que abre o
        controle avançado sob demanda. A área nobre volta a ser operação.
      */}
      {/*
        Fronteira de origem em UM lugar persistente, não repetida em cinco abas.
        O indicador compacto acompanha o controle de escopo logo abaixo do
        cabeçalho e segue com o usuário por toda a navegação — mais difícil de
        ignorar do que um bloco que o olho já aprendeu a pular.
      */}
      <div className="mb-3 flex flex-wrap items-center gap-2" data-testid="portfolio-scope">
        <PortfolioScopeNotice
          scope={scope}
          onScopeChange={setScope}
          counts={trustedStats.scope}
          className="min-w-0 flex-1"
        />
        <ScopeOriginNotice dataClasses={scopeOrigins} compact />
      </div>

      {/*
        O resumo executivo COMPLETO pertence à Visão Geral, e só a ela.

        A faixa executiva vinha acima de todas as outras sete áreas: clicar em
        "Faturamentos" mostrava, antes de qualquer coisa de faturamento, o
        mesmo panorama que a Visão Geral já dá — e empurrava o conteúdo da área
        escolhida para fora da primeira dobra. Nas áreas especializadas fica
        apenas a tira de contexto: de que carteira estes números falam.
      */}
      {/*
        A Visão Geral monta a SUA primeira dobra por dentro — inclusive a tira
        de indicadores, que lá entra depois da torre de controle.

        Nas demais áreas, a tira fica aqui e é ESPECÍFICA DA ÁREA. Antes era
        uma só, com oito métricas fixas, repetida acima de sete telas: abrir
        "Documentos" mostrava faturamento e obrigações antes de qualquer coisa
        de documento. Os números eram verdadeiros e estavam no lugar errado, o
        que é a maneira mais eficiente de treinar alguém a pular a primeira
        dobra inteira. `buildSectionKpis` decide o conjunto por área.
      */}
      {activeSection !== 'overview' && (
        <ContractsKpiStrip
          kpis={sectionKpis}
          className="mb-5"
          onNavigate={setActiveSection}
          onFilter={toggleKpiFilter}
          activeFilterId={activeKpiFilter}
        />
      )}

      {/*
        Recibo do filtro ativo — a banda É o filtro; isto só confirma o recorte.
        No Signal do sistema, não numa cápsula outline desenhada só aqui.
      */}
      {activeKpiFilter && KPI_FILTERS[activeKpiFilter] && (
        <div className="-mt-1 mb-4 flex flex-wrap items-center gap-2">
          <HudSignal
            size="sm"
            tone="accent"
            active
            icon={<ListFilter aria-hidden />}
            onClick={() => setActiveKpiFilter(null)}
            title="Remover filtro"
            label={KPI_FILTERS[activeKpiFilter].label}
            value={`${filteredRecords.length} contrato${filteredRecords.length === 1 ? '' : 's'}`}
          />
          <span className="inline-flex items-center gap-1 text-ig-caption text-ig-fg-subtle">
            <X className="h-3 w-3" aria-hidden />
            clique para remover
          </span>
        </div>
      )}

      {/*
        A navegação da carteira mora na sidebar da aplicação (§1/§2 do gate).
        Havia duas formas de apresentar a MESMA hierarquia — a barra horizontal
        aqui e o módulo na sidebar — e duas maneiras de dizer a mesma coisa
        obrigam o usuário a descobrir que são a mesma coisa. A sidebar é a
        canônica; aqui fica só o conteúdo da área ativa.
      */}
      {/*
        Cadastros que já entraram e ainda não terminaram ficam VISÍVEIS, acima
        da área ativa: sem isto, um cadastro interrompido existia apenas no
        banco e a única saída aparente era enviar o mesmo PDF outra vez. A
        faixa some sozinha quando não há nada em andamento.
      */}
      <ContractOnboardingContinuity className="mt-5" />

      <div className="mt-5 min-w-0" data-testid="portfolio-workspace" aria-live="polite">
        {tabs.find((tab) => tab.id === activeSection)?.content}
      </div>

      <HistoryDrawer
        isOpen={historyOpen}
        onClose={() => setHistoryOpen(false)}
        subject="Carteira de contratos"
        rows={activity.rows}
        error={activity.error}
        codeById={codeById}
      />

      <ContractUpload
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onSubmit={handleContractOnboarded}
        projects={projects.map((project) => ({
          id: project.id,
          name: project.nome,
          code: project.codigo,
          counterparty: project.cliente ?? null,
          scopeSummary: project.descricao ?? null,
          responsiblePersonId: project.responsiblePersonId ?? null,
        }))}
        companies={companies}
      />

      <ContractDossierDrawer
        record={selectedRecord}
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onView={handleViewContract}
        onLinkProject={contractActions.linkProject}
        onCreateTask={contractActions.createTask}
        onCreateRisk={contractActions.createRisk}
        onLinkExistingRisk={contractActions.linkExistingRisk}
        onAttachDocument={contractActions.attachDocument}
        onSendToLegal={contractActions.sendToLegal}
        onReviewApproval={contractActions.reviewApproval}
        onCreateObligation={createModals.openObligation}
        onCreateBilling={createModals.openBilling}
        onAddAmendment={selectedId && contractPermissions.edit && hasPermission('contracts.analyze_with_ai')
          ? amendmentModals.openAmendment : undefined}
        onViewDocuments={handleViewDocuments}
        onExportPdf={handleExportPdf}
        onOpenFinance={handleOpenFinance}
        onOpenBilling={handleOpenBilling}
        onDelete={handleDeleteContract}
        permissions={contractPermissions}
        onDataChanged={refreshContractsAndProjects}
        onLogoUpload={handleContractLogoUpload}
      />

      {contractActionModals}
      {amendmentModals.modals}
      {createModals.modals}
      {pageItemModals.modals}
    </HudPageLayout>
  );
}

/**
 * Command Center da carteira.
 *
 * ─── Leitura progressiva, em quatro tempos ─────────────────────────────────
 *
 * A Visão Geral tinha seis superfícies de peso semelhante empilhadas, e quem
 * abria a página precisava decidir sozinho por onde começar. A ordem agora é
 * declarada, e cada tempo responde uma pergunta diferente:
 *
 *   1. QUANTO      exposição, execução, faturado, backlog e cobertura — a
 *                  única superfície de destaque da primeira dobra.
 *   2. DE QUEM É A BOLA   a torre de controle, com os três grupos comparáveis
 *                  na mesma escala.
 *   3. O QUE FAZER AGORA  atenção operacional (o bloco de maior peso da
 *                  página) ao lado do horizonte de 90 dias.
 *   4. CONTEXTO    operações conectadas, atividade recente e a carteira em
 *                  destaque — leitura de apoio, nunca competindo com (3).
 *
 * Os indicadores/filtros da carteira entram RECOLHIDOS entre (2) e (3): são
 * uma ferramenta de recorte, não uma leitura da primeira dobra. Quem já
 * aplicou um filtro os encontra abertos.
 *
 * Todo bloco daqui para baixo usa `OverviewBlock` — uma superfície por
 * assunto, zero molduras aninhadas.
 */
/**
 * Linha da Visão Geral — doze colunas, bordas alinhadas, um gutter só.
 *
 * `items-stretch` está explícito porque a intenção importa: com `h-full` no
 * `OverviewBlock`, os dois cards de uma linha terminam na MESMA borda de
 * baixo, e a altura sai do conteúdo mais alto — não de um `h-[320px]` chutado
 * que estoura ou sobra conforme o dado do dia.
 *
 * Abaixo de `xl` a grade some e os blocos empilham com a altura do próprio
 * conteúdo: sem irmão na linha, `h-full` não tem efeito, então não sobra
 * artefato de altura fixa no tablet nem no celular.
 *
 * O gutter é UM valor em toda a página — o mesmo entre colunas e o mesmo
 * `space-y-5` que separa os tempos verticais.
 */
const OVERVIEW_ROW = 'grid items-stretch gap-5 xl:grid-cols-12';

function OverviewSection({
  records,
  trustedById,
  stats,
  monitoringCells,
  kpiStrip,
  intelligence,
  kpiBand,
  attention,
  connections,
  horizon,
  healthCoverage,
  selectedRecord,
  onSelect,
  onView,
  onOpenPortfolio,
  onOpenContractById,
  onOpenAudit,
  onModuleNavigate,
  activity,
  codeById,
}: {
  records: ContractGovernanceRecord[];
  trustedById: Map<string, TrustedContract>;
  stats: TrustedPortfolioStats;
  monitoringCells: {
    requiresYou: MonitoringCell[];
    monitoring: MonitoringCell[];
    awaitingSchedule: MonitoringCell[];
  };
  kpiStrip: React.ReactNode;
  intelligence: React.ReactNode;
  kpiBand: React.ReactNode;
  attention: PortfolioAttentionItem[];
  connections: ModuleConnection[];
  horizon: HorizonEvent[];
  healthCoverage: { assessed: number; total: number };
  selectedRecord: ContractGovernanceRecord | null;
  onSelect: (record: ContractGovernanceRecord) => void;
  onView: (record: ContractGovernanceRecord) => void;
  onOpenPortfolio: () => void;
  onOpenContractById: (id: string) => void;
  onOpenAudit: () => void;
  onModuleNavigate: (key: ModuleKey) => void;
  activity: { rows: PortfolioActivityEvent[]; error: string | null };
  codeById: Map<string, string>;
}) {
  const criticalAttention = attention.filter((item) => item.severity === 'critical').length;
  const overdueHorizon = horizon.filter((event) => event.overdue).length;

  return (
    /*
      Ritmo da página: o espaço entre TEMPOS é maior que o espaço dentro de um
      tempo. `space-y-4` uniforme apertava tudo por igual e a página perdia as
      juntas — não dava para ver onde uma leitura terminava e a outra começava.
    */
    <div className="space-y-5">
      {/* ── 1. Quanto ──────────────────────────────────────────────────── */}
      <PortfolioHero stats={stats} healthCoverage={healthCoverage} className="portfolio-hero" />

      {/*
        ── 2. Os seis números da carteira ───────────────────────────────
        A tira executiva desta área — e só desta. Exposição, atividade,
        decisão pendente, dinheiro faturável, renovação e cobertura. Cada
        célula que leva a algum lugar leva ao lugar onde se age sobre ela.
      */}
      {kpiStrip}

      {/* ── 3. De quem é a bola ────────────────────────────────────────── */}
      <ApexMonitoringBand
        requiresYou={monitoringCells.requiresYou}
        monitoring={monitoringCells.monitoring}
        awaitingSchedule={monitoringCells.awaitingSchedule}
      />

      {/*
        ── 4. Inteligência da carteira ──────────────────────────────────
        Quatro gráficos, e a regra de admissão é estreita de propósito: entra
        o que responde uma pergunta que as listas abaixo não respondem E que
        muda uma decisão. Gráfico decorativo aqui custaria a primeira dobra de
        quem veio resolver alguma coisa.
      */}
      {intelligence}

      {/* Ferramenta de recorte, recolhida: não é leitura de primeira dobra. */}
      {kpiBand}

      {/*
        ── 5. O que fazer agora ─────────────────────────────────────────
        Grade de 12 colunas, 7 + 5. Atenção domina a largura porque é o único
        bloco da página que pede ação; o horizonte acompanha à direita porque
        é a mesma pergunta projetada no tempo.

        Sem `items-start`: os dois blocos ESTICAM até a linha da grade e
        compartilham as bordas de topo e de base. Proporções em `fr` davam
        larguras que variavam com o conteúdo; a divisão em doze é uma decisão
        de layout, e sempre a mesma.
      */}
      <div className={OVERVIEW_ROW}>
        <OverviewBlock
          className="xl:col-span-7"
          title="Requer atenção"
          count={attention.length}
          countTone={criticalAttention > 0 ? 'critical' : 'warning'}
          hint="o que pede decisão agora"
          icon={<ShieldAlert aria-hidden />}
          emphasis="primary"
        >
          <PortfolioAttention
            items={attention}
            liveContractCount={stats.contractCount}
            max={4}
            onOpenContract={onOpenContractById}
          />
        </OverviewBlock>

        <OverviewBlock
          className="xl:col-span-5"
          title="Próximos 90 dias"
          count={horizon.length}
          countTone={overdueHorizon > 0 ? 'critical' : 'neutral'}
          hint="marcos, prazos e vigências"
          icon={<CalendarClock aria-hidden />}
        >
          <PortfolioHorizon
            events={horizon}
            liveContractCount={stats.contractCount}
            onOpenContract={onOpenContractById}
          />
        </OverviewBlock>
      </div>

      {/*
        ── 6. Contexto ──────────────────────────────────────────────────
        6 + 6 na mesma grade de doze: nenhuma das duas é mais urgente que a
        outra, e dar peso diferente sugeriria uma prioridade que não existe.
      */}
      <div className={OVERVIEW_ROW}>
        <OverviewBlock
          className="xl:col-span-6"
          title="Operações conectadas"
          hint="integrações do contrato"
          icon={<Workflow aria-hidden />}
        >
          <ModuleConnections connections={connections} onNavigate={onModuleNavigate} />
        </OverviewBlock>

        {/*
          Colapsável: a trilha é leitura de CONSULTA, não de varredura. Aberta
          por padrão enquanto é curta; quem não a usa recolhe uma vez e a
          coluna de contexto encolhe para uma linha de cabeçalho.
        */}
        <OverviewBlock
          className="xl:col-span-6"
          title="Atividade recente"
          count={activity.rows.length}
          hint="trilha de auditoria"
          icon={<FileClock aria-hidden />}
          collapsible
          /*
            Estica só quando HÁ trilha. Emparelhar as bordas é o objetivo, mas
            uma carteira sem atividade esticaria meia tela de vidro em branco
            para acompanhar a altura do vizinho — alinhamento comprado com
            vazio é pior que a diferença de altura que ele corrige.
          */
          stretch={activity.rows.length > 0}
          action={
            activity.rows.length > 0
              ? <OverviewBlockAction label="Trilha completa" onClick={onOpenAudit} icon={<ChevronRight className="h-3.5 w-3.5" aria-hidden />} />
              : undefined
          }
        >
          <PortfolioActivity
            events={activity.rows}
            error={activity.error}
            codeById={codeById}
            max={4}
            onOpenContract={onOpenContractById}
          />
        </OverviewBlock>
      </div>

      <PriorityContracts
        records={records}
        trustedById={trustedById}
        selectedId={selectedRecord?.contract.id || null}
        onSelect={onSelect}
        onView={onView}
        onOpenAll={onOpenPortfolio}
      />
    </div>
  );
}

type SignalItem = { id: string; primary: string; secondary: string; badge?: React.ReactNode; onClick: () => void };

/** Keeps the rail shorter than the portfolio: 2 items visible per group by default. */
const SIGNAL_COLLAPSED_COUNT = 2;

/** One group inside the unified "Sinais operacionais" column — not a loose card. */
function SignalGroup({
  icon,
  title,
  metric,
  meta,
  tone,
  empty,
  items,
  filterActive,
  onToggleFilter,
}: {
  icon: React.ReactNode;
  title: string;
  metric: string;
  meta?: string;
  tone: 'success' | 'warning' | 'danger';
  empty: string;
  items: SignalItem[];
  /** When provided, the group header doubles as a KPI filter toggle. */
  filterActive?: boolean;
  onToggleFilter?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const visibleItems = expanded ? items : items.slice(0, SIGNAL_COLLAPSED_COUNT);
  const hiddenCount = items.length - SIGNAL_COLLAPSED_COUNT;
  const toneClass = tone === 'danger' ? 'text-ig-danger' : tone === 'warning' ? 'text-ig-warning' : 'text-ig-success';
  const iconChipClass =
    tone === 'danger'
      ? 'border-[color-mix(in_oklab,var(--ig-danger)_32%,transparent)] bg-[color-mix(in_oklab,var(--ig-danger)_10%,transparent)] text-ig-danger'
      : tone === 'warning'
        ? 'border-[color-mix(in_oklab,var(--ig-warning)_32%,transparent)] bg-[color-mix(in_oklab,var(--ig-warning)_10%,transparent)] text-ig-warning'
        : 'border-ig-border-subtle bg-ig-panel text-ig-success';
  const HeaderComp: React.ElementType = onToggleFilter ? 'button' : 'div';
  return (
    <div className="py-3.5 first:pt-0 last:pb-0">
      <HeaderComp
        type={onToggleFilter ? 'button' : undefined}
        onClick={onToggleFilter}
        aria-pressed={onToggleFilter ? filterActive : undefined}
        title={onToggleFilter ? (filterActive ? 'Remover filtro deste sinal' : 'Filtrar carteira por este sinal') : undefined}
        className={`flex w-full items-center justify-between gap-3 rounded-md transition-colors ${
          onToggleFilter
            ? `-mx-1.5 w-[calc(100%+0.75rem)] px-1.5 py-0.5 text-left hover:bg-ig-panel-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--ig-accent)_45%,transparent)] ${
                filterActive ? 'border border-[color-mix(in_oklab,var(--ig-accent)_45%,transparent)] bg-[color-mix(in_oklab,var(--ig-accent)_10%,transparent)]' : ''
              }`
            : ''
        }`}
      >
        <div className={`flex min-w-0 items-center gap-2 ${filterActive ? 'text-ig-accent' : 'text-ig-fg-muted'}`}>
          <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${iconChipClass}`}>{icon}</span>
          <span className="min-w-0 truncate text-ig-label font-semibold">{title}</span>
          {/* Non-color active indication (a11y) */}
          {filterActive && <ListFilter className="h-3 w-3 shrink-0 text-ig-accent" aria-hidden />}
        </div>
        <div className="flex shrink-0 items-baseline gap-1.5">
          <span className={`text-lg font-semibold leading-none tabular-nums ${toneClass}`}>{metric}</span>
          {meta && <span className="text-[11px] text-ig-fg-muted">{meta}</span>}
        </div>
      </HeaderComp>
      <div className="mt-2.5 space-y-1.5">
        {items.length === 0 ? (
          <p className="rounded-md border border-dashed border-ig-border-subtle px-2.5 py-1.5 text-[11px] text-ig-fg-subtle">{empty}</p>
        ) : (
          visibleItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={item.onClick}
              title="Abrir dossiê do contrato"
              className="group/item flex w-full items-center justify-between gap-2 rounded-md border border-ig-border-subtle bg-ig-panel/45 px-2.5 py-1.5 text-left transition-colors hover:border-ig-border-focus hover:bg-ig-panel-hover"
            >
              <span className="min-w-0">
                <span className="block truncate text-[12px] font-semibold text-ig-fg-strong">{item.primary}</span>
                <span className="block truncate text-[11px] text-ig-fg-muted">{item.secondary}</span>
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                {item.badge}
                <ChevronRight className="h-3.5 w-3.5 text-ig-fg-subtle transition-all group-hover/item:translate-x-0.5 group-hover/item:text-ig-accent" />
              </span>
            </button>
          ))
        )}
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            className="flex w-full items-center justify-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold text-ig-fg-muted transition-colors hover:text-ig-accent"
          >
            {expanded ? 'Ver menos' : `Ver mais ${hiddenCount}`}
            <ChevronDown className={`h-3 w-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>
    </div>
  );
}

function ExecutiveSignals({
  records,
  onSelect,
  activeKpiFilter,
  onToggleKpiFilter,
}: {
  records: ContractGovernanceRecord[];
  onSelect: (record: ContractGovernanceRecord) => void;
  activeKpiFilter: string | null;
  onToggleKpiFilter: (key: string) => void;
}) {
  const semProjeto = records.filter((record) => !record.project);
  const overdueObligations = records
    .flatMap((record) => record.obligations.filter((obligation) => obligation.status === 'overdue').map((obligation) => ({ obligation, record })))
    .sort((a, b) => new Date(a.obligation.dueDate).getTime() - new Date(b.obligation.dueDate).getTime());
  const pendingBilling = records.filter((record) => record.remainingValue > 0).sort((a, b) => b.remainingValue - a.remainingValue);
  const pendingBillingTotal = pendingBilling.reduce((sum, record) => sum + record.remainingValue, 0);
  const missingDocs = records.filter((record) => record.missingDocuments.length > 0).sort((a, b) => b.missingDocuments.length - a.missingDocuments.length);
  const missingDocsTotal = records.reduce((sum, record) => sum + record.missingDocuments.length, 0);

  return (
    <section>
      <SectionHeader title="Sinais operacionais" hint="Pendências que exigem ação — clique no título para filtrar, no item para abrir" />
      <div className="divide-y divide-ig-border-subtle">
        <SignalGroup
          icon={<Workflow className="h-3.5 w-3.5" />}
          title="Sem projeto"
          metric={String(semProjeto.length)}
          meta={semProjeto.length ? 'sem vínculo' : undefined}
          tone={semProjeto.length ? 'warning' : 'success'}
          empty="Todos os contratos vinculados"
          filterActive={activeKpiFilter === 'sem_projeto'}
          onToggleFilter={() => onToggleKpiFilter('sem_projeto')}
          items={semProjeto.slice(0, 6).map((record) => ({
            id: record.contract.id,
            primary: record.code,
            secondary: record.companyName,
            badge: <HudBadge variant="warning" size="sm">vincular</HudBadge>,
            onClick: () => onSelect(record),
          }))}
        />
        <SignalGroup
          icon={<ClipboardCheck className="h-3.5 w-3.5" />}
          title="Obrigações atrasadas"
          metric={String(overdueObligations.length)}
          meta={overdueObligations.length ? 'em atraso' : undefined}
          tone={overdueObligations.length ? 'danger' : 'success'}
          empty="Nenhuma obrigação atrasada"
          filterActive={activeKpiFilter === 'obrigacoes_atrasadas'}
          onToggleFilter={() => onToggleKpiFilter('obrigacoes_atrasadas')}
          items={overdueObligations.slice(0, 6).map(({ obligation, record }) => ({
            id: obligation.id,
            primary: obligation.title,
            secondary: `${record.code} · ${format(new Date(obligation.dueDate), 'dd/MM/yyyy', { locale: pt })}`,
            onClick: () => onSelect(record),
          }))}
        />
        <SignalGroup
          icon={<Receipt className="h-3.5 w-3.5" />}
          title="Faturamento pendente"
          metric={formatCurrencyCompact(pendingBillingTotal)}
          meta={pendingBilling.length ? `${pendingBilling.length} contrato${pendingBilling.length === 1 ? '' : 's'}` : undefined}
          tone={pendingBilling.length ? 'warning' : 'success'}
          empty="Sem saldo a faturar"
          filterActive={activeKpiFilter === 'saldo_a_faturar'}
          onToggleFilter={() => onToggleKpiFilter('saldo_a_faturar')}
          items={pendingBilling.slice(0, 6).map((record) => ({
            id: record.contract.id,
            primary: record.code,
            secondary: record.companyName,
            badge: <span className="ig-tabular text-[11px] font-semibold text-ig-fg-strong">{formatCurrencyCompact(record.remainingValue)}</span>,
            onClick: () => onSelect(record),
          }))}
        />
        <SignalGroup
          icon={<Archive className="h-3.5 w-3.5" />}
          title="Documentos pendentes"
          metric={String(missingDocsTotal)}
          meta={missingDocs.length ? `${missingDocs.length} contrato${missingDocs.length === 1 ? '' : 's'}` : undefined}
          tone={missingDocsTotal ? 'warning' : 'success'}
          empty="Documentação completa"
          filterActive={activeKpiFilter === 'docs_pendentes'}
          onToggleFilter={() => onToggleKpiFilter('docs_pendentes')}
          items={missingDocs.slice(0, 6).map((record) => ({
            id: record.contract.id,
            primary: record.code,
            secondary: record.companyName,
            badge: <HudBadge variant="warning" size="sm">{record.missingDocuments.length}</HudBadge>,
            onClick: () => onSelect(record),
          }))}
        />
      </div>
    </section>
  );
}

function priorityScore(record: ContractGovernanceRecord) {
  let score = record.riskScore / 5;
  if (record.contract.riskClassification === 'high') score += 40;
  if (record.daysUntilExpiration !== null && record.daysUntilExpiration < 0) score += 35;
  else if (record.daysUntilExpiration !== null && record.daysUntilExpiration <= 30) score += 25;
  else if (record.daysUntilExpiration !== null && record.daysUntilExpiration <= 90) score += 12;
  score += record.missingDocuments.length * 6;
  if (!record.project) score += 10;
  if (record.contract.status === 'legal_review') score += 10;
  return score;
}

function PriorityContracts({
  records,
  trustedById,
  selectedId,
  onSelect,
  onView,
  onOpenAll,
}: {
  records: ContractGovernanceRecord[];
  trustedById: Map<string, TrustedContract>;
  selectedId: string | null;
  onSelect: (record: ContractGovernanceRecord) => void;
  onView: (record: ContractGovernanceRecord) => void;
  onOpenAll?: () => void;
}) {
  const top = [...records].sort((a, b) => priorityScore(b) - priorityScore(a)).slice(0, 6);

  /*
    A carteira em destaque é o ÚLTIMO tempo da página e o único que não vive
    dentro de `OverviewBlock`: os cards já são superfícies de vidro, e envolvê-
    los numa superfície seria exatamente a moldura dentro de moldura que o
    resto da Visão Geral acabou de perder. Aqui basta o cabeçalho de seção.
  */
  if (top.length === 0) {
    return (
      <section>
        <SectionHeader title="Carteira em destaque" />
        <div className="py-10 text-center">
          <FileText className="mx-auto mb-2.5 h-8 w-8 text-ig-fg-subtle" />
          <p className="text-ig-body-sm text-ig-fg-muted">Nenhum contrato no recorte atual.</p>
        </div>
      </section>
    );
  }

  return (
    <section>
      <SectionHeader
        className="mb-3"
        title="Carteira em destaque"
        hint="priorizados por risco, vencimento e pendências"
        count={top.length}
        action={
          onOpenAll ? (
            <button
              type="button"
              onClick={onOpenAll}
              className="inline-flex items-center gap-1 rounded text-ig-caption font-semibold text-ig-fg-muted transition-colors hover:text-ig-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--ig-accent)_45%,transparent)]"
            >
              Ver carteira completa
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          ) : undefined
        }
      />
      {/*
        A grade acompanha a QUANTIDADE, como na aba Cards: com um contrato, a
        composição editorial larga; com dois, meio a meio; a partir de três,
        grade. Uma grade fixa de duas colunas com um único contrato deixava
        metade do painel em branco ao lado dele.
      */}
      <div className={cn('grid items-stretch gap-5', top.length === 1 ? 'grid-cols-1' : 'sm:grid-cols-2')}>
        {top.map((record) => {
          const trusted = trustedById.get(record.contract.id);
          if (!trusted) return null;
          return (
            <ContractInstrumentCard
              key={record.contract.id}
              contract={trusted}
              active={record.contract.id === selectedId}
              onSelect={() => onSelect(record)}
              onOpen={() => onView(record)}
              wide={top.length === 1}
            />
          );
        })}
      </div>
    </section>
  );
}

function ContractsSection({
  records,
  trustedById,
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
  trustedById: Map<string, TrustedContract>;
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
  const [query, setQuery] = useState('');
  const [risk, setRisk] = useState<'all' | 'high' | 'medium' | 'low'>('all');
  const visible = records.filter((r) => matchesPortfolioSearch(query, r.code, r.contract.name, r.companyName, r.owner, r.projectReference) && (risk === 'all' || r.contract.riskClassification === risk));

  /*
    Os três controles ("achar", "recortar", "ver de outro jeito") viraram UM
    instrumento. Antes eram três blocos empilhados com réguas verticais
    próprias — cabeçalho com alternador, linha de busca, linha de filtros —
    para uma única operação, e o controle mais usado tinha o mesmo peso dos
    outros dois.
  */
  return (
    <div className="space-y-4">
      <PortfolioCommandBar
        query={query}
        onQueryChange={setQuery}
        searchLabel="Buscar por contrato, contraparte, projeto ou responsável"
        resultCount={visible.length}
        totalCount={records.length}
        filterLabel="Risco"
        filterValue={risk}
        onFilterChange={setRisk}
        neutralFilter="all"
        filters={[
          { value: 'all' as const, label: 'Todos', count: records.length, tone: 'accent' as const },
          { value: 'high' as const, label: 'Alto', count: records.filter((r) => r.contract.riskClassification === 'high').length, tone: 'danger' as const },
          { value: 'medium' as const, label: 'Médio', count: records.filter((r) => r.contract.riskClassification === 'medium').length, tone: 'warning' as const },
          { value: 'low' as const, label: 'Baixo', count: records.filter((r) => r.contract.riskClassification === 'low').length, tone: 'success' as const },
        ]}
        view={viewMode}
        onViewChange={onViewModeChange}
        views={[
          { id: 'cards' as const, label: 'Cartões', icon: LayoutGrid },
          { id: 'table' as const, label: 'Tabela', icon: Table2 },
          { id: 'risk' as const, label: 'Risco', icon: ShieldAlert },
        ]}
      />

      {visible.length === 0 && <PortfolioEmpty title={records.length === 0 ? 'Nenhum contrato neste recorte' : undefined} description={records.length === 0 ? 'Ajuste a origem da carteira acima ou adicione um contrato.' : undefined} onReset={query || risk !== 'all' ? () => { setQuery(''); setRisk('all'); } : undefined} />}
      {visible.length > 0 && viewMode === 'table' && (
        <ContractSmartTable hideSearch
          contracts={visible
            .map((r) => trustedById.get(r.contract.id))
            .filter((c): c is TrustedContract => Boolean(c))}
          selectedId={selectedId}
          onSelect={(c) => {
            const target = records.find((r) => r.contract.id === c.id);
            if (target) onSelect(target);
          }}
        />
      )}
      {visible.length > 0 && viewMode === 'cards' && (
        <ContractCards
          records={visible}
          trustedById={trustedById}
          selectedId={selectedId}
          onSelect={onSelect}
          onView={onView}
          onDelete={canDeleteContract ? onDeleteContract : undefined}
        />
      )}
      {visible.length > 0 && viewMode === 'risk' && <RiskBoard records={visible} selectedId={selectedId} onSelect={onSelect} onView={onView} />}
    </div>
  );
}

function ContractCards({
  records,
  trustedById,
  selectedId,
  onSelect,
  onView,
  onDelete,
}: {
  records: ContractGovernanceRecord[];
  trustedById: Map<string, TrustedContract>;
  selectedId: string | null;
  onSelect: (record: ContractGovernanceRecord) => void;
  onView: (record: ContractGovernanceRecord) => void;
  onDelete?: (record: ContractGovernanceRecord) => void;
}) {
  /*
    A grade acompanha a QUANTIDADE (P2G).

    Uma grade fixa de três colunas com um contrato deixava dois terços da
    superfície vazios ao lado de um card estreito — e uma carteira de um
    contrato é o estado normal de quem acabou de começar, não uma exceção.
    Com um, o card ocupa a largura editorial; com dois, divide ao meio; a
    partir de três, vira grade.
  */
  const layout =
    records.length === 1 ? 'grid-cols-1'
      : records.length === 2 ? 'grid-cols-1 lg:grid-cols-2'
        : 'grid gap-4 md:grid-cols-2 xl:grid-cols-3';

  /*
    A grade também tem HIERARQUIA, não só quantidade.

    Vinha na ordem em que a carteira chegou — a ordem do banco. Num painel de
    instrumentos isso é ruído: o contrato de maior exposição e o de menor
    ocupavam a mesma posição de leitura. A ordenação é a mesma da tabela em
    repouso (exposição desc.), de modo que trocar de modo de visualização não
    reembaralha a carteira sob os olhos de quem estava lendo.
  */
  const ordered = [...records].sort((a, b) => b.totalValue - a.totalValue);

  return (
    <div className={cn('grid gap-4', layout)}>
      {ordered.map((record) => {
        const trusted = trustedById.get(record.contract.id);
        if (!trusted) return null;
        return (
          <ContractInstrumentCard
            key={record.contract.id}
            contract={trusted}
            active={record.contract.id === selectedId}
            onSelect={() => onSelect(record)}
            onOpen={() => onView(record)}
            onDelete={onDelete ? () => onDelete(record) : undefined}
            /* Com um único contrato o card ganha a composição larga. */
            wide={records.length === 1}
          />
        );
      })}
    </div>
  );
}

/**
 * Modo RISCO — três faixas de severidade, não três listas.
 *
 * O que havia: uma coluna por classificação, com um botão de borda fina por
 * contrato mostrando nome, contraparte e um pill repetindo o rótulo da própria
 * coluna. Três problemas: o pill não informava nada (todo card de "Alto risco"
 * dizia "Alto"), a faixa não dizia QUANTO dinheiro estava exposto naquela
 * severidade — que é a pergunta do modo — e o cartão não dizia o que fazer.
 *
 * Agora cada faixa declara a sua exposição no cabeçalho, e cada linha troca o
 * pill redundante por AÇÃO: o que naquele contrato exige alguém (obrigações
 * atrasadas, documentos faltando, vigência no limite). Mesmo material de vidro
 * e mesma gramática de Signal da tabela e dos cartões.
 */
function RiskBoard({ records, selectedId, onSelect, onView }: {
  records: ContractGovernanceRecord[];
  selectedId: string | null;
  onSelect: (record: ContractGovernanceRecord) => void;
  onView?: (record: ContractGovernanceRecord) => void;
}) {
  const lanes = [
    { id: 'high', label: 'Alto risco', tone: 'danger', accent: 'var(--ig-danger)' },
    { id: 'medium', label: 'Risco médio', tone: 'warning', accent: 'var(--ig-warning)' },
    { id: 'low', label: 'Baixo risco', tone: 'success', accent: 'var(--ig-success)' },
  ] as const;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {lanes.map((lane) => {
        const inLane = records
          .filter((record) => record.contract.riskClassification === lane.id)
          .sort((a, b) => b.totalValue - a.totalValue);
        const exposure = inLane.reduce((sum, record) => sum + record.totalValue, 0);

        return (
          <section
            key={lane.id}
            data-elev="1"
            style={{ ['--lane-tone' as string]: lane.accent }}
            className="ig-glass flex flex-col"
          >
            <span data-ig-noise="" />
            <span data-ig-specular="" />
            <div data-ig-content="" className="flex h-full flex-col p-3.5">
              <span
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-0 h-[3px] bg-[color:var(--lane-tone)] opacity-80"
              />
              <header className="flex items-baseline justify-between gap-2 border-b border-ig-border-subtle pb-2.5">
                <span className="flex min-w-0 items-center gap-2">
                  <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-[color:var(--lane-tone)]" />
                  <span className="truncate text-ig-body-sm font-semibold text-ig-fg-strong">{lane.label}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="ig-tabular block text-ig-h3 leading-none text-ig-fg-strong">{inLane.length}</span>
                  <span className="mt-0.5 block text-[10px] leading-none text-ig-fg-subtle">
                    {formatCurrencyCompact(exposure)}
                  </span>
                </span>
              </header>

              <div className="mt-2.5 space-y-2">
                {inLane.length === 0 && (
                  <p className="py-6 text-center text-ig-caption text-ig-fg-subtle">Nenhum contrato nesta faixa.</p>
                )}
                {inLane.map((record) => {
                  const overdue = record.obligations.filter((o) => o.status === 'overdue').length;
                  const missingDocs = record.missingDocuments.length;
                  const days = record.daysUntilExpiration;
                  const expiring = days !== null && days <= 30;
                  const selected = record.contract.id === selectedId;

                  return (
                    <button
                      key={record.contract.id}
                      type="button"
                      onClick={() => onSelect(record)}
                      onDoubleClick={onView ? () => onView(record) : undefined}
                      className={cn(
                        'group relative block w-full overflow-hidden rounded-[11px] border px-3 py-2.5 text-left',
                        'transition-[background-color,border-color,box-shadow] duration-150',
                        selected
                          ? 'border-ig-border-focus bg-[color-mix(in_oklab,var(--ig-accent)_11%,transparent)] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--ig-accent)_22%,transparent)]'
                          : 'border-ig-border-subtle bg-[color-mix(in_oklab,var(--ig-bg-raised)_60%,transparent)] hover:border-ig-border-focus hover:shadow-[0_8px_20px_-16px_rgba(0,0,0,0.65)]',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--ig-accent)_45%,transparent)]',
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          'pointer-events-none absolute inset-y-0 left-0 w-[2px] bg-[color:var(--lane-tone)] transition-opacity',
                          selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-70',
                        )}
                      />
                      <span className="flex items-start justify-between gap-2">
                        <span className="ig-code truncate !text-ig-fg-strong">{record.code}</span>
                        <span className="ig-tabular shrink-0 text-ig-body-sm font-bold leading-none text-ig-fg-strong">
                          {formatCurrencyCompact(record.totalValue)}
                        </span>
                      </span>
                      <span className="mt-1 block truncate text-ig-body-sm font-semibold text-ig-fg-strong" title={record.contract.name}>
                        {record.contract.name}
                      </span>
                      <span className="mt-0.5 block truncate text-ig-caption text-ig-fg-muted">
                        {record.companyName} · {record.owner}
                      </span>

                      {/* O que exige alguém neste contrato — a razão de o modo existir. */}
                      <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                        {overdue > 0 && <HudSignal variant="inline" size="sm" tone="danger" label="atrasadas" value={overdue} />}
                        {missingDocs > 0 && <HudSignal variant="inline" size="sm" tone="warning" label="docs" value={missingDocs} />}
                        {expiring && (
                          <HudSignal
                            variant="inline"
                            size="sm"
                            tone={days !== null && days < 0 ? 'danger' : 'warning'}
                            label="vigência"
                            value={days !== null && days < 0 ? `${Math.abs(days)}d vencida` : `${days}d`}
                          />
                        )}
                        {overdue === 0 && missingDocs === 0 && !expiring && (
                          <HudSignal variant="inline" size="sm" tone="success" label="sem pendência" />
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function AnalyticsBand({ records }: { records: ContractGovernanceRecord[] }) {
  const totalCount = Math.max(records.length, 1);
  const byRisk = (['high', 'medium', 'low'] as const).map((risk) => ({
    risk,
    count: records.filter((record) => record.contract.riskClassification === risk).length,
    exposure: records.filter((record) => record.contract.riskClassification === risk).reduce((sum, record) => sum + record.totalValue, 0),
    barClass: risk === 'high' ? 'bg-ig-danger' : risk === 'medium' ? 'bg-ig-warning' : 'bg-ig-success',
  }));
  const upcoming = records
    .filter((record) => record.daysUntilExpiration !== null)
    .sort((a, b) => (a.daysUntilExpiration ?? 0) - (b.daysUntilExpiration ?? 0))
    .slice(0, 5);
  const obligations = records.flatMap((record) => record.obligations);
  const obligationStats = [
    { key: 'overdue', label: 'Atrasadas', tone: 'danger' as const },
    { key: 'due_soon', label: 'Próximas', tone: 'warning' as const },
    { key: 'open', label: 'Abertas', tone: 'default' as const },
    { key: 'done', label: 'Concluídas', tone: 'success' as const },
  ].map((item) => ({ ...item, value: obligations.filter((o) => o.status === item.key).length }));

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <section>
        <SectionHeader title="Contratos por risco" hint="Distribuição e exposição" />
        <div className="space-y-3.5">
          {byRisk.map((item) => (
            <div key={item.risk}>
              <div className="mb-1.5 flex items-baseline justify-between gap-2 text-ig-caption">
                <span className="flex items-center gap-2 text-ig-fg-muted">
                  <span className={`h-2 w-2 rounded-full ${item.barClass}`} />
                  {riskLabels[item.risk]}
                </span>
                <span className="flex items-baseline gap-2">
                  <span className="ig-tabular font-semibold text-ig-fg-strong">{item.count}</span>
                  <span className="text-ig-fg-subtle">{formatCurrencyCompact(item.exposure)}</span>
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-ig-panel-hover">
                <div className={`h-full rounded-full ${item.barClass} transition-[width]`} style={{ width: `${(item.count / totalCount) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <SectionHeader title="Próximas renovações" hint="Janela mais próxima de vencimento" />
        <div className="space-y-2">
          {upcoming.length === 0 && <p className="py-6 text-center text-ig-caption text-ig-fg-muted">Sem datas de vencimento no recorte.</p>}
          {upcoming.map((record) => (
            <div key={record.contract.id} className="flex items-center justify-between gap-3 rounded-lg border border-ig-border-subtle bg-ig-panel/45 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-ig-body-sm font-semibold text-ig-fg-strong">{record.code}</p>
                <p className="truncate text-ig-caption text-ig-fg-muted">{record.companyName}</p>
              </div>
              <HudStatusPill variant={renewalVariant(record.renewalStatus)} size="sm">
                {record.daysUntilExpiration !== null && record.daysUntilExpiration < 0 ? `${Math.abs(record.daysUntilExpiration)}d vencido` : `${record.daysUntilExpiration}d`}
              </HudStatusPill>
            </div>
          ))}
        </div>
      </section>

      <section>
        <SectionHeader title="Obrigações por status" hint={`${obligations.length} obrigações mapeadas`} />
        <div className="grid grid-cols-2 gap-2.5">
          {obligationStats.map((item) => {
            const toneClass = item.tone === 'danger' ? 'text-ig-danger' : item.tone === 'warning' ? 'text-ig-warning' : item.tone === 'success' ? 'text-ig-success' : 'text-ig-fg-strong';
            return (
              <div key={item.key} className="rounded-lg border border-ig-border-subtle bg-ig-panel/45 px-3 py-2.5">
                <p className="text-ig-label font-semibold text-ig-fg-subtle">{item.label}</p>
                <p className={`mt-0.5 text-xl font-semibold tabular-nums ${toneClass}`}>{item.value}</p>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

/*
  `AiAnalysisSection` foi removida na Fase 0.6 junto com a aba "Análise IA".

  Ela renderizava doze caixas com o rótulo "mock" e um botão "Iniciar análise
  mock" que não tinha `onClick` — um workspace inteiro anunciando uma capacidade
  que a tela não possuía, ao lado da capacidade real, que existe e funciona:
  extração de cláusulas com evidência obrigatória (página + trecho), idempotência
  por fingerprint e supersessão de documento e de análise.

  A inteligência deixa de ser uma etapa do ciclo de vida com aba própria e
  passa a ser transversal: ela aparece onde produz consequência — na fila de
  propostas de cláusula, na cobertura por documento, nos sinais de atenção.
*/


/**
 * Distribuição de risco da carteira.
 *
 * `contracts.risk_level` é coluna REAL — esta é a única parte do antigo painel
 * de riscos que se sustentava. O painel "Cláusulas monitoradas" que ficava ao
 * lado saiu: as três cláusulas que ele exibia ("Renovação e denúncia",
 * "Condições de pagamento", "SLA e penalidades") eram fabricadas pelo enricher
 * e vinham com o próprio texto denunciando a origem ("Prévia mock", "sem API
 * ativa"). Elas contradiziam, na mesma tela, o painel de capacidades que
 * declara `contract_clauses` como não instrumentada.
 */
function RisksSection({ records }: { records: ContractGovernanceRecord[] }) {
  return (
    <section>
      <SectionHeader title="Mapa de risco" hint="Distribuição por classificação de risco registrada" />
      <div className="grid gap-4 md:grid-cols-3">
        {['high', 'medium', 'low'].map((risk) => {
          const count = records.filter((record) => record.contract.riskClassification === risk).length;
          return (
            <div key={risk}>
              <div className="mb-1 flex justify-between text-ig-caption">
                <span className="text-ig-fg-muted">{riskLabels[risk as keyof typeof riskLabels]}</span>
                <span className="ig-tabular font-semibold text-ig-fg-strong">{count}</span>
              </div>
              <HudProgressBar
                value={Math.round((count / Math.max(records.length, 1)) * 100)}
                variant={risk === 'high' ? 'danger' : risk === 'medium' ? 'warning' : 'success'}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}

function FaturamentoSection({
  records,
  canEdit,
  busyId,
  onRealize,
  onFollowUp,
}: {
  records: ContractGovernanceRecord[];
  canEdit: boolean;
  busyId: string | null;
  onRealize: (event: { id: string; title: string }) => void;
  onFollowUp: (record: ContractGovernanceRecord) => void;
}) {
  const events = records.flatMap((record) => record.billingEvents.map((event) => ({ event, record })));
  const overdue = countOverdueBillingEvents(events.map(({ event }) => event));

  /*
    ─── Os cartões "Realizado" e "Saldo a faturar" foram REMOVIDOS na Fase 7 ──

    Eles somavam `event.amount` filtrado por `isBillingEventRealized`, que lê
    `paid_at` e o `status` em texto livre da própria linha de Contratos. Isso
    afirmava RECEBIMENTO a partir de um campo que Contratos escrevia sozinho —
    a §58 e a §59 tiram essa autoridade daqui: pago é verdade de Finanças,
    derivada de liquidação com evidência.

    Enquanto os dois números existirem lado a lado, o da esquerda ("Realizado")
    é lido como caixa. A §121 proíbe R$ faturado e R$ recebido que não venham
    só de dado oficial real, e o dado oficial agora está no painel canônico
    acima, por evento, com o estado do vínculo financeiro ao lado de cada
    valor. Somar aqui recriaria a segunda interpretação.

    `Vencidos` permanece: é contagem de PRAZO, não afirmação de caixa.
  */
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-ig-border-subtle bg-ig-panel/45 px-3 py-2.5">
        <p className="text-ig-label font-semibold text-ig-fg-subtle">Eventos com vencimento passado</p>
        <p className={`mt-0.5 text-lg font-semibold tabular-nums ${overdue ? 'text-ig-danger' : 'text-ig-fg-strong'}`}>
          {overdue}
        </p>
        <p className="mt-1 text-ig-caption text-ig-fg-subtle">
          Recebido e saldo em aberto vêm de Finanças, por evento, no painel acima —
          Contratos não afirma caixa.
        </p>
      </div>
      <section>
        <SectionHeader title="Eventos de faturamento (registro histórico)" hint="Lista legada — a cadeia com procedência está no painel acima" />
        <div className="space-y-2">
          {events.length === 0 && <p className="py-6 text-center text-ig-caption text-ig-fg-muted">Nenhum evento de faturamento no recorte.</p>}
          {events.map(({ event, record }) => {
            const realized = isBillingEventRealized(event);
            const isLive = record.dataQuality?.billing === 'live';
            return (
              <div key={event.id} className="grid gap-3 rounded-lg border border-ig-border-subtle bg-ig-panel/45 p-3 md:grid-cols-[1fr_140px_120px_auto] md:items-center">
                <div className="min-w-0">
                  <p className="truncate text-ig-body-sm font-semibold text-ig-fg-strong">{event.title}</p>
                  <p className="truncate text-ig-caption text-ig-fg-muted">{record.code} · {record.companyName}</p>
                </div>
                <span className="ig-tabular text-ig-body-sm font-semibold text-ig-fg-strong">{formatCurrencyCompact(event.amount)}</span>
                <HudStatusPill variant={realized ? 'active' : 'warning'} size="sm">
                  {realized ? 'Faturado' : event.due_date ? format(event.due_date, 'dd/MM/yyyy', { locale: pt }) : 'Pendente'}
                </HudStatusPill>
                <div className="flex items-center justify-end gap-1.5">
                  {canEdit && isLive && !realized && (
                    <button type="button" title="Marcar como faturado" onClick={() => onRealize({ id: event.id, title: event.title })} className="inline-flex h-9 items-center gap-1 rounded-md border border-ig-border-subtle px-2 text-ig-label font-semibold text-ig-fg-muted transition-colors sm:h-7 hover:border-ig-border-focus hover:text-ig-success">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Faturar
                    </button>
                  )}
                  {canEdit && (
                    <button type="button" title="Criar tarefa de follow-up" disabled={busyId === `tab-bilfu-${event.id}`} onClick={() => onFollowUp(record)} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-ig-border-subtle text-ig-fg-muted transition-colors sm:h-7 sm:w-7 hover:border-ig-border-focus hover:text-ig-fg-strong disabled:opacity-50">
                      <CalendarClock className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

const APPROVAL_STEP_LABELS: Record<string, string> = { juridico: 'Jurídico', financeiro: 'Financeiro', comite: 'Comitê', diretoria: 'Diretoria' };

/*
  `AuditSection` foi removida junto com a aba "Auditoria".

  Reimplementava à mão o mesmo trilho de timeline que o dossiê já desenhava em
  outros dois lugares, sobre `record.auditEvents` (o enricher) em vez de
  `audit_logs`, e trazia no subtítulo "Upload, revisão, IA mock, aprovações e
  pendências" — anunciando ao usuário de negócio um estado mock que a Fase 0
  havia eliminado.

  O histórico da carteira agora é a gaveta `HistoryDrawer`, sobre as MESMAS
  linhas de `listPortfolioAuditEvents` que alimentam "Atividade recente".
*/
