'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Contract, Project } from '@/lib/types';
import {
  deleteProject,
  getProjectsAsync,
  updateProjectV2,
  uploadProjectFile,
} from '@/lib/services/projects';
import { hasOfficialValue } from '@/lib/contracts/trust/trusted';
import { cn } from '@/lib/utils';
import type { PortfolioActivityEvent } from '@/components/contracts/cockpit/PortfolioActivity';
import { listRisks } from '@/lib/services/risks';
import { useContracts } from '@/hooks/use-contracts';
import { usePermissions } from '@/hooks/use-permissions';
import { ContractList } from '@/components/contracts/contract-list';
import { ContractUpload, type ContractOnboardingDraft } from '@/components/contracts/contract-upload';
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
import { computeApprovalSla, contractRowToLegacyContract, createTaskFromObligation, describeRelationErrors, fetchContractRelationsBatch, fetchPortfolioLinkCounts, listContractAuditEvents, listPortfolioAuditEvents, requestClauseExtraction, submitContractApproval, updateContractDocumentStatus, uploadContractDocument, type ContractRelationsBatch } from '@/lib/contracts/contract-service';
import { buildTrustedPortfolio, type TrustedContract } from '@/lib/contracts/trust/read-model';
import { computeTrustedPortfolioStats, type TrustedPortfolioStats } from '@/lib/contracts/trust/portfolio';
import { approvalSla } from '@/lib/contracts/trust/signals';
import { portfolioToCash } from '@/lib/contracts/trust/contract-to-cash';
import { buildObligationsTower } from '@/lib/contracts/trust/obligations-tower';
import { buildRenewalHorizon } from '@/lib/contracts/trust/renewal-horizon';
import { buildPortfolioApprovals } from '@/lib/contracts/trust/approval-intelligence';
import { buildClauseRiskIntelligence } from '@/lib/contracts/trust/clause-risk-intelligence';
import { ContractToCashFlow } from '@/components/contracts/intelligence/ContractToCashFlow';
import { ObligationsControlTower } from '@/components/contracts/intelligence/ObligationsControlTower';
import { RenewalHorizonPanel } from '@/components/contracts/intelligence/RenewalHorizonPanel';
import { ApprovalIntelligencePanel } from '@/components/contracts/intelligence/ApprovalIntelligencePanel';
import { ClauseRiskIntelligencePanel } from '@/components/contracts/intelligence/ClauseRiskIntelligencePanel';
import { ScopeOriginNotice } from '@/components/contracts/intelligence/ScopeOriginNotice';
import {
  PortfolioScopeNotice, PortfolioActivity, matchesScope, type PortfolioScopeKey,
  PortfolioHero, ModuleConnections, PortfolioHorizon, PortfolioAttention,
  ContractInstrumentCard, ContractSmartTable,
} from '@/components/contracts/cockpit';
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
import { SectionHeader, HistoryDrawer, InlineEmpty } from '@/components/contracts/shell';
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
type SectionId = 'overview' | 'contracts' | 'renewals' | 'obligations' | 'faturamento' | 'aprovacoes' | 'risks' | 'documents';
type ViewMode = 'table' | 'cards' | 'risk';

const sectionLabels: Record<SectionId, string> = {
  overview: 'Visão Geral',
  contracts: 'Contratos',
  renewals: 'Renovações',
  obligations: 'Obrigações',
  faturamento: 'Faturamento',
  aprovacoes: 'Aprovações',
  risks: 'Riscos & Cláusulas',
  documents: 'Documentos',
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
  const [projects, setProjects] = useState<Project[]>([]);
  const [riskOptions, setRiskOptions] = useState<{ id: string; title: string }[]>([]);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<SectionId>('overview');
  const [viewMode, setViewMode] = useState<ViewMode>('table');
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
        setLiveRecords(applyLiveGovernanceData(mockRecords, batch, projects));
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
  }, [mockRecords, projects]);

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

  const allRecords = useMemo(() => (mockRecords.length === 0 ? mockRecords : liveRecords ?? mockRecords), [liveRecords, mockRecords]);

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
      source: 'Supabase',
    });
    if (!result.ok) {
      notify('Não foi possível gerar o PDF', {
        description: result.message ?? 'Falha ao montar o dossiê do contrato.',
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
  const renewalHorizon = useMemo(() => buildRenewalHorizon(filteredTrusted, new Date(), SCOPED), [filteredTrusted]);
  const portfolioApprovals = useMemo(() => buildPortfolioApprovals(filteredTrusted, new Date(), SCOPED), [filteredTrusted]);
  const clauseRiskIntel = useMemo(
    () => buildClauseRiskIntelligence(filteredTrusted, [], { ...SCOPED, riskDetails: relationsBatch?.riskDetails }),
    [filteredTrusted, relationsBatch],
  );

  /** Origem dos contratos do recorte — alimenta o aviso das abas operacionais. */
  const scopeOrigins = useMemo(() => filteredTrusted.map((c) => c.dataClass), [filteredTrusted]);

  const selectedRecord = useMemo(() => {
    return filteredRecords.find((record) => record.contract.id === selectedId)
      || filteredRecords[0]
      || records[0]
      || null;
  }, [filteredRecords, records, selectedId]);

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
      dataClass: 'unclassified',
      title: draft.title,
      contractNumber: draft.contractNumber,
      counterpartyName: draft.counterpartyName,
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
        const result = await requestClauseExtraction(row.id, documentId);
        if (result.proposedCount) {
          pending.push(`${result.proposedCount} proposta(s) aguardando revisão`);
        }
      } catch (err) {
        pending.push(err instanceof Error ? `análise não concluída (${err.message})` : 'análise não concluída');
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
        <ObligationsControlTower
          tower={obligationsTower}
          canEdit={contractPermissions.edit}
          busyId={tabBusyId}
          onComplete={(item) => pageItemModals.openCompleteObligation(item)}
          onCreateTask={(contractId, title, dueAt, ownerUserId, key) => runTabAction(key, () => createTaskFromObligation(contractId, title, dueAt, ownerUserId), 'Tarefa criada na agenda')}
        />
        </div>
      ),
    },
    {
      id: 'faturamento',
      label: sectionLabels.faturamento,
      icon: <Receipt className="h-4 w-4" />,
      content: (
        <div className="space-y-5">
          {/*
            A cadeia vem antes da lista: ela responde "até onde este sistema
            enxerga o caminho até o caixa", que é a pergunta que a lista de
            eventos, sozinha, deixa o usuário responder por conta própria.
          */}
          <section>
            <SectionHeader title="Contract-to-Cash" hint="Contratado → Medido → Aprovado → Faturado → Recebido" />
            <ContractToCashFlow stages={cashFlow} />
          </section>

          <FaturamentoSection
            records={filteredRecords}
            canEdit={contractPermissions.edit}
            busyId={tabBusyId}
            onRealize={(event) => pageItemModals.openRealizeBilling(event)}
            onFollowUp={(record) => contractActions.createTask(record)}
          />
        </div>
      ),
    },
    {
      id: 'aprovacoes',
      label: sectionLabels.aprovacoes,
      icon: <ShieldCheck className="h-4 w-4" />,
      content: (
        <div className="space-y-4">
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
          <ClauseRiskIntelligencePanel
            intelligence={clauseRiskIntel}
            canEdit={contractPermissions.edit}
            onCreateRisk={() => selectedRecord && contractActions.createRisk(selectedRecord)}
            onLinkRisk={() => selectedRecord && contractActions.linkExistingRisk(selectedRecord)}
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
        <DocumentsSection
          records={filteredRecords}
          canUploadDoc={contractPermissions.uploadDoc}
          busyId={tabBusyId}
          onApprove={(docId, key) => runTabAction(key, () => updateContractDocumentStatus(docId, 'approved'), 'Documento aprovado')}
          onSendToApproval={(docId, key) => runTabAction(key, () => updateContractDocumentStatus(docId, 'pending_approval'), 'Documento enviado para aprovação')}
          onReject={(doc) => pageItemModals.openRejectDoc(doc)}
        />
      ),
    },
  ];

  return (
    <HudPageLayout>
      <HudHeader
        title="Gestão de Contratos"
        subtitle="Carteira, obrigações, faturamento, riscos e renovações."
        icon={<FileSignature className="h-5 w-5" />}
        breadcrumbs={[{ label: 'Gestão de Contratos' }]}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span
              className={`hidden items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium md:inline-flex ${
                governance.error
                  ? 'border-[color-mix(in_oklab,var(--ig-danger)_34%,transparent)] text-ig-danger'
                  : governance.live > 0
                    ? 'border-[color-mix(in_oklab,var(--ig-success)_30%,transparent)] text-ig-success'
                    : 'border-ig-border-subtle text-ig-fg-muted'
              }`}
              title="Fonte dos dados de governança (obrigações, faturamento, documentos, aprovações, vínculos)"
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  governanceLoading ? 'animate-pulse bg-ig-fg-subtle' : governance.error ? 'bg-ig-danger' : governance.live > 0 ? 'bg-ig-success' : 'bg-ig-fg-subtle'
                }`}
              />
              {/*
                Correção semântica de P0.3: uma FALHA de leitura não é uma
                estimativa. "Estimado" sugere um número aproximado; aqui não há
                número nenhum. Erro e demonstração nunca compartilham rótulo.
              */}
              {governanceLoading
                ? 'Sincronizando…'
                : governance.error
                  ? 'Dados indisponíveis'
                  : governance.live > 0
                    ? `Ao vivo · ${governance.live}/${governance.total}`
                    : 'Sem dado apurado'}
            </span>
            <HudButton
              variant="secondary"
              size="md"
              leftIcon={<FileClock className="h-4 w-4" />}
              onClick={() => setHistoryOpen(true)}
            >
              Histórico
            </HudButton>
            <ExportReportButton
              size="md"
              variant="glass"
              permission="contracts.export"
              fallbackPermission="contracts.view"
              build={() => openContractReport({
                // As tabelas de detalhe seguem listando os records; as MÉTRICAS
                // vêm do mesmo agregado confiável que a Executive Band, então
                // tela e PDF não podem divergir.
                records: filteredRecords,
                trusted: trustedStats,
                trustedContracts: trustedPortfolio,
                source: relationsBatch ? 'Supabase' : 'sem leitura de relações',
              })}
            />
            {hasPermission('contracts.create') && !permissionsLoading ? (
              <HudButton variant="primary" size="md" leftIcon={<Plus className="h-4 w-4" />} onClick={() => setUploadOpen(true)}>
                Novo Contrato
              </HudButton>
            ) : null}
          </div>
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
        Header CONTEXTUAL (MD §10): a band não se repete no Command Center,
        onde o hero já responde a mesma pergunta com mais hierarquia. Ela
        permanece nas demais abas, onde é o único resumo — e onde suas células
        seguem servindo de filtro da carteira.
      */}
      {activeSection !== 'overview' && (
      <ContractExecutiveBand
        stats={trustedStats}
        contractCount={contractRows.length}
        activeFilter={activeKpiFilter}
        onToggleFilter={toggleKpiFilter}
        className="mb-5"
      />
      )}

      {/* Active-filter indicator — the band is the filter; this is just the receipt */}
      {activeKpiFilter && KPI_FILTERS[activeKpiFilter] && (
        <div className="-mt-1 mb-4 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-ig-label text-ig-fg-muted">
            <ListFilter className="h-3.5 w-3.5" />
            Filtro ativo
          </span>
          <button
            type="button"
            onClick={() => setActiveKpiFilter(null)}
            title="Remover filtro"
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-ig-border-focus bg-ig-accent-weak px-2.5 text-[11px] font-semibold text-ig-accent transition-colors hover:bg-ig-panel-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--ig-accent)_45%,transparent)]"
          >
            <span className="truncate">
              {KPI_FILTERS[activeKpiFilter].label} · {filteredRecords.length} contrato{filteredRecords.length === 1 ? '' : 's'}
            </span>
            <X className="h-3 w-3 shrink-0" />
          </button>
        </div>
      )}

      <HudTabs
        tabs={tabs}
        activeTab={activeSection}
        onTabChange={(tabId) => setActiveSection(tabId as SectionId)}
        variant="underline"
        contentClassName="mt-5"
        label="Áreas da carteira de contratos"
        data-testid="portfolio-nav"
      />

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
        projects={projects}
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
        onAddAmendment={selectedId && contractPermissions.edit ? amendmentModals.openAmendment : undefined}
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
 * Composição assimétrica e deliberada (MD §37): o hero ocupa a largura inteira
 * porque exposição é a mensagem primária; abaixo, atenção domina a coluna
 * esquerda — é o que exige ação — e o horizonte acompanha à direita. As
 * conexões com o resto do Insight fecham a leitura, porque respondem "a que
 * este contrato está ligado", que é uma pergunta de contexto, não de urgência.
 */
function OverviewSection({
  records,
  trustedById,
  stats,
  attention,
  connections,
  horizon,
  healthCoverage,
  selectedRecord,
  onSelect,
  onView,
  onOpenPortfolio,
  onOpenContractById,
  onModuleNavigate,
  activity,
  codeById,
}: {
  records: ContractGovernanceRecord[];
  trustedById: Map<string, TrustedContract>;
  stats: TrustedPortfolioStats;
  attention: PortfolioAttentionItem[];
  connections: ModuleConnection[];
  horizon: HorizonEvent[];
  healthCoverage: { assessed: number; total: number };
  selectedRecord: ContractGovernanceRecord | null;
  onSelect: (record: ContractGovernanceRecord) => void;
  onView: (record: ContractGovernanceRecord) => void;
  onOpenPortfolio: () => void;
  onOpenContractById: (id: string) => void;
  onModuleNavigate: (key: ModuleKey) => void;
  activity: { rows: PortfolioActivityEvent[]; error: string | null };
  codeById: Map<string, string>;
}) {
  return (
    <div className="space-y-6">
      <PortfolioHero stats={stats} healthCoverage={healthCoverage} />

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <section>
          <SectionHeading
            title="Requer atenção"
            hint="sinais operacionais da carteira oficial"
            count={attention.length}
          />
          <PortfolioAttention
            items={attention}
            liveContractCount={stats.contractCount}
            max={4}
            onOpenContract={onOpenContractById}
          />

          {/*
            Atividade recente fecha a coluna esquerda com REGISTRO REAL, não com
            uma métrica inventada para ocupar altura: são as mesmas linhas de
            `audit_logs` que a aba Auditoria mostra, recortadas.
          */}
          <PortfolioActivity
            events={activity.rows}
            error={activity.error}
            codeById={codeById}
            className="mt-3"
            onOpenContract={onOpenContractById}
            onOpenAudit={onOpenContractById}
          />
        </section>

        {/*
          O horizonte e as operações conectadas dividem a coluna estreita.

          Antes, o horizonte ficava sozinho à direita e as operações abaixo, em
          largura inteira: com uma carteira sem eventos na janela, a coluna
          direita esvaziava depois de três linhas enquanto a esquerda seguia
          longa, e sobrava um retângulo em branco do tamanho de meia tela. As
          duas seções continuam distintas e nomeadas — só passaram a ocupar o
          espaço que já existia.
        */}
        <div className="space-y-6">
          <section>
            <SectionHeading title="Próximos 90 dias" hint="marcos, prazos e vigências reais" count={horizon.length} />
            <PortfolioHorizon
              events={horizon}
              liveContractCount={stats.contractCount}
              onOpenContract={onOpenContractById}
            />
          </section>

          <section>
            <SectionHeading
              title="Operações conectadas"
              hint="o contrato como objeto central da operação"
            />
            <ModuleConnections connections={connections} onNavigate={onModuleNavigate} />
          </section>
        </div>
      </div>

      <section>
        <SectionHeading title="Carteira em destaque" hint="contratos por prioridade operacional" />
        <PriorityContracts
          records={records}
          trustedById={trustedById}
          selectedId={selectedRecord?.contract.id || null}
          onSelect={onSelect}
          onView={onView}
          onOpenAll={onOpenPortfolio}
        />
      </section>
    </div>
  );
}

/** Cabeçalho de seção do Command Center — hierarquia sem card extra (MD §5). */
function SectionHeading({ title, hint, count }: { title: string; hint?: string; count?: number }) {
  return (
    <header className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h3 className="text-ig-h3 font-semibold text-ig-fg-strong">{title}</h3>
      {count !== undefined && count > 0 && (
        <span className="ig-tabular rounded-[6px] border border-ig-border-subtle px-1.5 py-px text-ig-caption font-semibold text-ig-fg-muted">
          {count}
        </span>
      )}
      {hint && <span className="text-ig-caption text-ig-fg-subtle">{hint}</span>}
      <span className="h-px flex-1 bg-ig-border-subtle" aria-hidden />
    </header>
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
          <span className="min-w-0 truncate text-ig-label font-semibold uppercase tracking-[0.12em]">{title}</span>
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

  if (top.length === 0) {
    return (
      <section>
        <SectionHeader title="Carteira em destaque" />
        <div className="py-12 text-center">
          <FileText className="mx-auto mb-3 h-10 w-10 text-ig-fg-muted" />
          <p className="text-ig-body-sm text-ig-fg-muted">Nenhum contrato no recorte atual.</p>
        </div>
      </section>
    );
  }

  return (
    <section>
      <SectionHeader title="Carteira em destaque" hint="Contratos priorizados por risco, vencimento e pendências — clique para abrir o dossiê" count={top.length} action={
        onOpenAll ? (
          <button
            type="button"
            onClick={onOpenAll}
            className="inline-flex items-center gap-1 text-ig-label font-semibold text-ig-fg-muted transition-colors hover:text-ig-accent"
          >
            Ver carteira completa
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        ) : undefined
      } />
      {/*
        A grade acompanha a QUANTIDADE, como na aba Cards: com um contrato, a
        composição editorial larga; com dois, meio a meio; a partir de três,
        grade. Uma grade fixa de duas colunas com um único contrato deixava
        metade do painel em branco ao lado dele.
      */}
      <div className={cn('grid gap-4', top.length === 1 ? 'grid-cols-1' : 'sm:grid-cols-2')}>
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
        <ContractSmartTable
          contracts={records
            .map((r) => trustedById.get(r.contract.id))
            .filter((c): c is TrustedContract => Boolean(c))}
          selectedId={selectedId}
          onSelect={(c) => {
            const target = records.find((r) => r.contract.id === c.id);
            if (target) onSelect(target);
          }}
        />
      )}
      {viewMode === 'cards' && (
        <ContractCards
          records={records}
          trustedById={trustedById}
          selectedId={selectedId}
          onSelect={onSelect}
          onView={onView}
          onDelete={canDeleteContract ? onDeleteContract : undefined}
        />
      )}
      {viewMode === 'risk' && <RiskBoard records={records} selectedId={selectedId} onSelect={onSelect} />}
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

  return (
    <div className={cn('grid gap-4', layout)}>
      {records.map((record) => {
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

function RiskBoard({ records, selectedId, onSelect }: { records: ContractGovernanceRecord[]; selectedId: string | null; onSelect: (record: ContractGovernanceRecord) => void }) {
  const lanes = [
    { id: 'high', label: 'Alto risco', variant: 'critical' },
    { id: 'medium', label: 'Risco médio', variant: 'warning' },
    { id: 'low', label: 'Baixo risco', variant: 'active' },
  ] as const;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {lanes.map((lane) => (
        <section key={lane.id}>
          <SectionHeader title={lane.label} count={records.filter((record) => record.contract.riskClassification === lane.id).length} />
          <div className="space-y-2">
            {records.filter((record) => record.contract.riskClassification === lane.id).slice(0, 12).map((record) => (
              <button
                key={record.contract.id}
                onClick={() => onSelect(record)}
                className={`w-full rounded-lg border p-3 text-left transition-colors ${record.contract.id === selectedId ? 'border-ig-border-focus bg-ig-accent-weak/15 ring-1 ring-ig-accent/40' : 'border-ig-border-subtle bg-ig-panel/55 hover:border-ig-border-focus hover:bg-ig-panel-hover'}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="line-clamp-2 text-ig-body-sm font-semibold text-ig-fg-strong">{record.contract.name}</p>
                  <HudStatusPill variant={lane.variant} size="sm">{record.riskScore}</HudStatusPill>
                </div>
                <p className="mt-1 truncate text-ig-caption text-ig-fg-muted">{record.companyName} · {record.owner}</p>
              </button>
            ))}
          </div>
        </section>
      ))}
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
                <p className="text-ig-label font-semibold uppercase tracking-[0.12em] text-ig-fg-subtle">{item.label}</p>
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
      <SectionHeader title="Mapa de risco" hint="Classificação registrada em contracts.risk_level" />
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

const DOC_TAB_STATUS: Record<string, { label: string; variant: 'active' | 'warning' | 'critical' | 'neutral' }> = {
  uploaded: { label: 'Enviado', variant: 'active' },
  missing: { label: 'Faltante', variant: 'warning' },
  expired: { label: 'Vencido', variant: 'critical' },
  expiring_soon: { label: 'A vencer', variant: 'warning' },
  pending_approval: { label: 'Em aprovação', variant: 'warning' },
  approved: { label: 'Aprovado', variant: 'active' },
  rejected: { label: 'Rejeitado', variant: 'critical' },
};

function DocumentsSection({
  records,
  canUploadDoc,
  busyId,
  onApprove,
  onSendToApproval,
  onReject,
}: {
  records: ContractGovernanceRecord[];
  canUploadDoc: boolean;
  busyId: string | null;
  onApprove: (docId: string, key: string) => void;
  onSendToApproval: (docId: string, key: string) => void;
  onReject: (doc: { id: string; title: string }) => void;
}) {
  // Live document rows (with real ids + status) come from the Phase-2 merge; records
  // without them fall back to the estimated missing-docs preview.
  const liveRows = records.flatMap((record) => (record.liveDocuments ?? []).map((doc) => ({ doc, record })));

  return (
    <div className="space-y-5">
      {liveRows.length > 0 && (
        <section>
          <SectionHeader title="Documentos ao vivo" hint="Ações por documento — aprovar, rejeitar, enviar para aprovação" />
          <div className="space-y-2">
            {liveRows.slice(0, 40).map(({ doc, record }) => {
              const meta = DOC_TAB_STATUS[doc.status] ?? { label: doc.status, variant: 'neutral' as const };
              return (
                <div key={doc.id} className="grid gap-3 rounded-lg border border-ig-border-subtle bg-ig-panel/45 p-3 md:grid-cols-[1fr_140px_auto] md:items-center">
                  <div className="min-w-0">
                    <p className="truncate text-ig-body-sm font-semibold text-ig-fg-strong">{doc.title}</p>
                    <p className="truncate text-ig-caption text-ig-fg-muted">{record.code}{doc.rejection_reason ? ` · ${doc.rejection_reason}` : ''}</p>
                  </div>
                  <HudStatusPill variant={meta.variant} size="sm">{meta.label}</HudStatusPill>
                  <div className="flex items-center justify-end gap-1.5">
                    {canUploadDoc && doc.status !== 'pending_approval' && doc.status !== 'approved' && doc.status !== 'rejected' && (
                      <button type="button" title="Enviar para aprovação" disabled={busyId === `tab-docp-${doc.id}`} onClick={() => onSendToApproval(doc.id, `tab-docp-${doc.id}`)} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-ig-border-subtle text-ig-fg-muted transition-colors sm:h-7 sm:w-7 hover:border-ig-border-focus hover:text-ig-fg-strong disabled:opacity-50">
                        <ClipboardCheck className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {canUploadDoc && doc.status !== 'approved' && (
                      <button type="button" title="Aprovar documento" disabled={busyId === `tab-doca-${doc.id}`} onClick={() => onApprove(doc.id, `tab-doca-${doc.id}`)} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-ig-border-subtle text-ig-fg-muted transition-colors sm:h-7 sm:w-7 hover:border-ig-border-focus hover:text-ig-success disabled:opacity-50">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {canUploadDoc && doc.status !== 'rejected' && (
                      <button type="button" title="Rejeitar documento" onClick={() => onReject({ id: doc.id, title: doc.title })} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-ig-border-subtle text-ig-fg-muted transition-colors sm:h-7 sm:w-7 hover:border-ig-border-focus hover:text-ig-danger">
                        <ShieldAlert className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <SectionHeader title="Documentos e pendências" hint="Visão de completude por contrato" />
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
      </section>
    </div>
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
  const totalPlanned = events.reduce((sum, { event }) => sum + event.amount, 0);
  const totalRealized = events.filter(({ event }) => isBillingEventRealized(event)).reduce((sum, { event }) => sum + event.amount, 0);
  const overdue = countOverdueBillingEvents(events.map(({ event }) => event));
  const cards = [
    { label: 'Planejado', value: formatCurrencyCompact(totalPlanned), tone: 'text-ig-fg-strong' },
    { label: 'Realizado', value: formatCurrencyCompact(totalRealized), tone: 'text-ig-success' },
    { label: 'Saldo a faturar', value: formatCurrencyCompact(Math.max(totalPlanned - totalRealized, 0)), tone: 'text-ig-warning' },
    { label: 'Vencidos', value: String(overdue), tone: overdue ? 'text-ig-danger' : 'text-ig-fg-strong' },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="rounded-lg border border-ig-border-subtle bg-ig-panel/45 px-3 py-2.5">
            <p className="text-ig-label font-semibold uppercase tracking-[0.12em] text-ig-fg-subtle">{card.label}</p>
            <p className={`mt-0.5 text-lg font-semibold tabular-nums ${card.tone}`}>{card.value}</p>
          </div>
        ))}
      </div>
      <section>
        <SectionHeader title="Eventos de faturamento" hint="Eventograma consolidado — marque realizado nos eventos ao vivo" />
        <div className="space-y-2">
          {events.length === 0 && <p className="py-6 text-center text-ig-caption text-ig-fg-muted">Nenhum evento de faturamento no recorte.</p>}
          {events.slice(0, 40).map(({ event, record }) => {
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

