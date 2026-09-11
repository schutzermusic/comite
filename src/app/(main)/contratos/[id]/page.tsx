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
import { ClauseOpsPanel } from '@/components/contracts/intelligence/ClauseOpsPanel';
import { documentAnalysisStates, contractCoverage } from '@/lib/contracts/trust/clause-operations';
import { MeasurementPanel } from '@/components/contracts/intelligence/MeasurementPanel';
import { ContractMeasurementReadiness } from '@/components/contracts/intelligence/ContractMeasurementReadiness';
import { useContractInstrumentationModals } from '@/components/contracts/useContractInstrumentationModals';
import { buildApprovalIntelligence, type ApprovalIntelligence } from '@/lib/contracts/trust/approval-intelligence';
import { SharedApprovalEnginePanel } from '@/components/contracts/intelligence/SharedApprovalEnginePanel';
import { ContractToCashFlow } from '@/components/contracts/intelligence/ContractToCashFlow';
import { ContractToCashPanel } from '@/components/contracts/billing/ContractToCashPanel';
import { createBillingEventFromMilestone, requestClauseExtraction, type ContractClauseRow, type ContractAmendmentRow, type ContractDocumentRow, listContractAiAnalyses, type ContractAiAnalysisRow, type ContractMilestoneRow, listContractAuditEvents, listContractRelatedTasks, computeApprovalSla, type ContractAuditEventRow, type ContractRelatedTask } from '@/lib/contracts/contract-service';
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
import { ContractInterpretationPanel } from '@/components/contracts/intelligence/ContractInterpretationPanel';
import {
  buildRiskExposure, RISK_ACTION_LABEL, RISK_SEVERITY_LABEL,
  type RiskActionKey, type RiskExposure, type RiskSeverity,
} from '@/lib/contracts/intelligence/risk-exposure';
import { ApexFollowupPanel } from '@/components/contracts/intelligence/ApexFollowupPanel';
import { useApexFollowups } from '@/components/contracts/use-apex-followups';
import { useContractObligations } from '@/components/contracts/use-contract-obligations';
import type {
  ContractObligationsAsOf, ObligationEvidenceRequirement,
} from '@/lib/contracts/obligations/types';
import {
  buildDocumentOperations, DOCUMENT_CATEGORY_LABEL,
  type DocumentLink, type MissingEvidence, type OperationalDocumentInput,
} from '@/lib/contracts/intelligence/document-operations';
import type { ApexFollowupRow } from '@/lib/platform/followups/types';
import type { InterpretationDecision } from '@/lib/contracts/intelligence/session';
import { format } from 'date-fns';
import { ContractStructuredObligations } from '@/components/contracts/ContractStructuredObligations';
import { pt } from 'date-fns/locale';

/*
  ─── A NAVEGAÇÃO DO DOSSIÊ DEIXA DE ECOAR A SIDEBAR ────────────────────────

  As abas se chamavam "Visão geral", "Financeiro", "Obrigações", "Documentos",
  "Riscos & Cláusulas" e "Aprovações" — quase os mesmos nomes das áreas da
  carteira, na sidebar, a poucos centímetros de distância. Duas colunas de
  navegação com o mesmo vocabulário fazem o usuário perguntar, toda vez, qual
  das duas "Obrigações" ele quer; e o produto não tinha resposta, porque a
  pergunta era mal-formada.

  Os dois níveis respondem coisas diferentes, e agora os nomes dizem isso:

      SIDEBAR   → onde há trabalho contratual acontecendo na empresa?
      DOSSIÊ    → o que está acontecendo DENTRO deste contrato?

  Os seis destinos locais são estados de um contrato em operação, não módulos:

  · Resumo                 — o que impede o próximo resultado de negócio?
  · Operação               — o que precisa acontecer, de quem, até quando.
  · Medição & Faturamento  — este evento contratual pode ser faturado?
  · Inteligência Contratual— o que o contrato exige e o que o Apex entendeu.
  · Documentos             — o papel que sustenta tudo acima.
  · Governança             — o que o Apex NÃO tem autoridade para decidir.

  Todo link antigo continua funcionando — ver `RETIRED_TAB_TARGET`.
*/
type DetailTab =
  | 'summary' | 'operation' | 'billing' | 'intelligence' | 'documents' | 'governance';

const DETAIL_TABS: DetailTab[] = [
  'summary', 'operation', 'billing', 'intelligence', 'documents', 'governance',
];

/**
 * Abas aposentadas -> onde o assunto vive agora.
 *
 * A tabela é a promessa de que nenhum link salvo, favorito ou e-mail antigo
 * cai numa tela vazia. Ela cresce quando a navegação muda; ela não encolhe.
 */
const RETIRED_TAB_TARGET: Record<string, DetailTab> = {
  clauses: 'intelligence',
  audit: 'summary',
  risks: 'intelligence',
  finance: 'billing',
  obligations: 'operation',
  approvals: 'governance',
};

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
      /*
        A resposta confirma o PEDIDO, não o resultado. Anunciar "N cláusulas
        propostas" agora seria inventar um número que o modelo ainda não
        produziu — e o usuário o leria como leitura concluída.
      */
      notify(
        result.reused
          ? 'A análise deste documento já está em andamento'
          : 'Análise enfileirada',
        {
          description: result.reused
            ? 'O pedido anterior ainda está na fila; nenhum trabalho foi duplicado.'
            : 'As propostas aparecem na fila de revisão quando a leitura terminar.',
          variant: 'info',
        },
      );
    } catch (err) {
      notify('A análise não pôde ser enfileirada', {
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

  /*
    ─── ACOMPANHAMENTO DO APEX ──────────────────────────────────────────────

    O que o Apex está seguindo neste contrato. Não é lista de tarefas do
    usuário: cada linha tem objetivo, responsável, evidência esperada e o
    próximo evento que o Apex aguarda.
  */
  const {
    followups, loading: followupsLoading, error: followupsError, refresh: refreshFollowups,
  } = useApexFollowups(contractId || null);

  /** Data de referência explícita: decisão que depende de "hoje" implícito não é testável. */
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  /*
    As obrigações estruturadas sobem para o nível da página porque DUAS abas
    precisam delas: Operação as lista, e Documentos as usa para saber qual
    exigência cada papel satisfaz. Buscá-las duas vezes faria as duas telas
    discordarem sobre a mesma data de referência.
  */
  const { obligations: obligationsAsOf, error: obligationsError } = useContractObligations(
    contractId || null,
  );

  /**
   * Quantos itens EXIGEM uma pessoa.
   *
   * Este é o único contador que o menu do dossiê mostra. Ele vem do estado
   * persistido pela política de exceção (migration 154) — não de "quantas
   * cláusulas a IA leu", que num contrato de 195 páginas seria um número
   * grande, constante e inútil.
   */
  const attentionCount = useMemo(
    () => (detail?.clauses ?? []).filter((c) => c.interpretation_state === 'requires_attention').length,
    [detail],
  );

  /**
   * A decisão humana sobre uma interpretação.
   *
   * Três verbos, e a diferença entre eles é deliberada: `acknowledge` baixa a
   * atenção sem transformar a leitura da máquina em afirmação de uma pessoa;
   * `confirm` é a pessoa respondendo por aquela leitura; `dismiss` descarta e
   * exige justificativa. Nenhum dos três altera o texto do contrato.
   */
  const handleInterpretationDecision = useCallback(async (
    clause: { id: string; title: string }, decision: InterpretationDecision,
  ) => {
    let note: string | null = null;
    if (decision === 'dismiss') {
      note = window.prompt(`Por que descartar a interpretação "${clause.title}"?`);
      if (!note?.trim()) return;
    }
    try {
      const response = await fetch(
        `/api/contracts/${contractId}/interpretations/${clause.id}/attention`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision, note }),
        },
      );
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error ?? 'Falha ao registrar a decisão.');
      await refresh();
      notify(
        decision === 'confirm' ? 'Interpretação confirmada'
          : decision === 'dismiss' ? 'Interpretação descartada'
            : 'Registrado — o Apex segue operando por esta regra',
        { variant: 'success' },
      );
    } catch (err) {
      notify('A decisão não pôde ser registrada', {
        description: err instanceof Error ? err.message : 'Erro inesperado.',
        variant: 'error',
      });
    }
  }, [contractId, refresh, notify]);

  const followupAction = useCallback(async (
    path: string, payload: Record<string, unknown>, success: string,
  ) => {
    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error ?? 'Falha na operação.');
      await refreshFollowups();
      notify(success, { variant: 'success' });
    } catch (err) {
      notify('A operação não pôde ser concluída', {
        description: err instanceof Error ? err.message : 'Erro inesperado.',
        variant: 'error',
      });
    }
  }, [refreshFollowups, notify]);

  /*
    Designar é ato humano — e por isso vai pela rota que grava com o carimbo de
    `auth.uid()`. O nome digitado aqui é a parte responsável quando ela é
    externa; pessoa da organização passa a ser escolhida pelo mesmo caminho
    quando o seletor de membros chegar a esta superfície.
  */
  const handleAssignFollowup = useCallback((followup: ApexFollowupRow) => {
    const responsible = window.prompt('Quem responde por este acompanhamento?', followup.responsible_text ?? '');
    if (!responsible?.trim()) return;
    void followupAction(
      `/api/platform/followups/${followup.id}/assign`,
      { responsibleText: responsible.trim() },
      'Responsável designado — o Apex assume o acompanhamento.',
    );
  }, [followupAction]);

  /*
    "O cliente está analisando. Resposta esperada em 15/09." Isso é ESTADO, e
    é ele que cala a cobrança até a data informada.
  */
  const handleWaitFollowup = useCallback((followup: ApexFollowupRow) => {
    const event = window.prompt('O que se está aguardando da contraparte?', followup.next_expected_event ?? '');
    if (!event?.trim()) return;
    const date = window.prompt('Quando a resposta é esperada? (AAAA-MM-DD)', followup.next_expected_event_at ?? '');
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
      notify('Aguardar a contraparte exige a data esperada', {
        description: 'Sem data, o Apex não saberia quando voltar — e ficaria calado para sempre.',
        variant: 'error',
      });
      return;
    }
    void followupAction(
      `/api/platform/followups/${followup.id}/transition`,
      {
        next: 'WAITING_EXTERNAL_PARTY',
        nextExpectedEvent: event.trim(),
        nextExpectedEventAt: date.trim(),
      },
      `O Apex aguarda até ${date.trim()} sem cobrar.`,
    );
  }, [followupAction, notify]);

  const handleEscalateFollowup = useCallback((followup: ApexFollowupRow) => {
    const note = window.prompt('Por que escalar este acompanhamento?');
    if (!note?.trim()) return;
    void followupAction(
      `/api/platform/followups/${followup.id}/transition`,
      { next: 'ESCALATED', note: note.trim() },
      'Acompanhamento escalado.',
    );
  }, [followupAction]);

  /*
    Concluir NUNCA é um clique de "feito". Quando existe regra determinística,
    a conclusão é do Apex, contra a evidência. Quando não existe, é uma pessoa
    confirmando — e assumindo a afirmação.
  */
  const handleCompleteFollowup = useCallback((followup: ApexFollowupRow) => {
    if (followup.verification_mode === 'deterministic_evidence') {
      notify('A verificação é automática', {
        description: 'Este acompanhamento fecha quando o Apex conferir a evidência exigida.',
        variant: 'info',
      });
      return;
    }
    const note = window.prompt('Confirmar a conclusão deste acompanhamento. O que foi verificado?');
    if (!note?.trim()) return;
    void followupAction(
      `/api/platform/followups/${followup.id}/complete`,
      { basis: 'human_confirmation', note: note.trim() },
      'Conclusão confirmada.',
    );
  }, [followupAction, notify]);

  const { actions: contractActions, modals: contractActionModals } = useContractActionModals({
    projects,
    onRefresh: refreshDetailAndProjects,
  });

  /**
   * As ações governadas sobre uma exposição de risco.
   *
   * Nenhuma delas altera o contrato. `recommendAmendment` registra a
   * RECOMENDAÇÃO de aditivo como acompanhamento para uma pessoa decidir — o
   * Apex pode sugerir uma mudança contratual, e nunca fazê-la.
   *
   * `acceptRisk` é ato de autoridade e vai para o motor de aprovação
   * canônico, que é onde alçada mora; ele não é um botão que muda um status.
   */
  const handleRiskAction = useCallback((exposure: RiskExposure, action: RiskActionKey) => {
    if (action === 'viewSourceClause') {
      setActiveTab('intelligence');
      return;
    }
    if (action === 'requestLegalReview') {
      contractActions.sendToLegal(record);
      return;
    }
    if (action === 'createCommercialAction') {
      contractActions.createTask(record);
      return;
    }
    if (action === 'acceptRisk') {
      notify('Aceitar risco é decisão de alçada', {
        description: 'A aceitação passa pelo motor de aprovação, em Governança — não por uma mudança de status aqui.',
        variant: 'info',
      });
      setActiveTab('governance');
      return;
    }

    // `assignResponsible`, `createFollowup` e `recommendAmendment` abrem um
    // acompanhamento: é o Apex assumindo o seguimento do que foi decidido.
    const goal = action === 'recommendAmendment'
      ? `Avaliar aditivo para: ${exposure.title}`
      : `Tratar exposição: ${exposure.title}`;
    const responsible = window.prompt(
      action === 'assignResponsible'
        ? `Quem responde por "${exposure.title}"?`
        : `Quem conduz "${goal}"?`,
    );
    if (!responsible?.trim()) return;

    void (async () => {
      try {
        const response = await fetch('/api/platform/followups', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': crypto.randomUUID(),
          },
          body: JSON.stringify({
            sourceKind: 'contract_risk',
            sourceId: exposure.id,
            contractId,
            goal,
            responsibleText: responsible.trim(),
            expectedEvidence: action === 'recommendAmendment'
              ? 'Decisão registrada sobre a necessidade de aditivo'
              : 'Evidência de tratamento da exposição',
            cadenceDays: 7,
          }),
        });
        const body = await response.json();
        if (!response.ok || !body.ok) throw new Error(body.error ?? 'Falha ao abrir acompanhamento.');
        await refreshFollowups();
        notify('O Apex assumiu o acompanhamento', {
          description: 'Ele passa a cobrar, esperar e verificar conforme a política.',
          variant: 'success',
        });
        setActiveTab('operation');
      } catch (err) {
        notify('O acompanhamento não pôde ser aberto', {
          description: err instanceof Error ? err.message : 'Erro inesperado.',
          variant: 'error',
        });
      }
    })();
  }, [contractId, contractActions, record, refreshFollowups, notify]);

  const canEditContract = hasPermission('contracts.edit') || hasPermission('admin.manage_organization');
  const canOnboardAmendment = canEditContract && hasPermission('contracts.analyze_with_ai');
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
    { id: 'total', label: 'Valor total', value: officialCurrencyCompact(trusted.totalValue), variant: 'info', icon: <FileSignature className="h-4 w-4" />, onClick: () => setActiveTab('billing'), active: activeTab === 'billing' },
    { id: 'billed', label: 'Faturado', value: officialCurrencyCompact(trusted.billedValue), variant: hasOfficialValue(trusted.billedValue) ? 'success' : 'default', icon: <Receipt className="h-4 w-4" />, onClick: () => setActiveTab('billing'), active: activeTab === 'billing' },
    { id: 'remaining', label: 'Saldo', value: officialCurrencyCompact(trusted.remainingValue), variant: hasOfficialValue(trusted.remainingValue) ? 'warning' : 'default', icon: <GanttChartSquare className="h-4 w-4" />, onClick: () => setActiveTab('billing'), active: activeTab === 'billing' },
    { id: 'renewal', label: 'Vencimento', value: renderOfficial(trusted.daysUntilExpiration, { onValue: (d) => (d < 0 ? 'vencido' : `${d}d`), onMissing: () => 'sem data', onError: () => 'indisponível' }), variant: hasOfficialValue(trusted.daysUntilExpiration) && trusted.daysUntilExpiration.value <= 90 ? 'warning' : 'default', icon: <CalendarClock className="h-4 w-4" />, onClick: () => setActiveTab('operation'), active: activeTab === 'operation' },
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
    { id: 'health', label: 'Cobertura apurada', value: `${health.coverage.assessed}/${health.coverage.total}`, variant: health.drivers.some((d) => d.adverse) ? 'warning' : 'default', icon: <ShieldAlert className="h-4 w-4" />, onClick: () => setActiveTab('intelligence'), active: activeTab === 'intelligence' },
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
   * Os seis destinos do dossiê, na ordem em que um contrato é vivido:
   *
   *   Resumo → Operação → Medição & Faturamento → Inteligência → Documentos →
   *   Governança.
   *
   * O crachá de cada aba conta o que EXIGE alguém, não o que existe. "43
   * cláusulas" não é trabalho; "2 requerem atenção" é. Contadores de acervo no
   * menu treinam o usuário a ignorar todos os contadores do menu.
   */
  const tabs: HudTab[] = [
    {
      id: 'summary', label: 'Resumo', icon: <FileText className="h-4 w-4" />,
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
                  else if (key === 'clauses') setActiveTab('intelligence');
                  else if (key === 'obligations') setActiveTab('operation');
                  else if (key === 'milestones') setActiveTab('billing');
                  else if (key === 'approvals') setActiveTab('governance');
                  else if (key === 'risks') setActiveTab('intelligence');
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
                    else if (key === 'billing') setActiveTab('billing');
                    else if (key === 'documents') setActiveTab('documents');
                    else if (key === 'obligations') setActiveTab('operation');
                    else if (key === 'risks') setActiveTab('intelligence');
                    else if (key === 'approvals') setActiveTab('governance');
                    // Auditoria deixou de ser aba: mesmo destino, agora gaveta.
                    else if (key === 'audit') setHistoryOpen(true);
                    // P2B: medição vive no Financeiro (lastro do faturamento);
                    // cláusulas, junto de riscos.
                    else if (key === 'measurement') setActiveTab('billing');
                    else if (key === 'clauses') setActiveTab('intelligence');
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
                ingestionRequests={detail.amendmentIngestionRequests}
                onAddAmendment={canOnboardAmendment ? openAmendment : undefined}
              />
            </div>
          </div>
        </div>
      ),
    },
    /*
      "Financeiro" saiu do dossiê. O nome prometia a cadeia inteira — AR,
      pagamento, conciliação — e Contratos não é dono de nada disso: ele é dono
      de saber se um evento contratual PODE ser faturado. O novo nome é a
      pergunta que a aba responde.
    */
    {
      id: 'billing', label: 'Medição & Faturamento', icon: <Receipt className="h-4 w-4" />,
      badge: undefined,
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
    {
      id: 'operation', label: 'Operação', icon: <ClipboardCheck className="h-4 w-4" />,
      // Só o que está em atraso conta como trabalho. Uma exigência aguardando
      // a agenda de Projetos NÃO é pendência de quem lê esta tela.
      badge: undefined,
      content: (
        <OperationTab
          trusted={trusted}
          detail={detail}
          followups={followups}
          followupsError={followupsError}
          followupsLoading={followupsLoading}
          asOf={today}
          canAct={canEditContract}
          onAssignFollowup={handleAssignFollowup}
          onWaitFollowup={handleWaitFollowup}
          onEscalateFollowup={handleEscalateFollowup}
          onCompleteFollowup={handleCompleteFollowup}
          onNewObligation={canEditContract ? openObligation : undefined}
        />
      ),
    },
    {
      id: 'documents', label: 'Documentos', icon: <Archive className="h-4 w-4" />,
      badge: undefined,
      content: (
        <DocumentsTab
          detail={detail}
          obligations={obligationsAsOf}
          obligationsError={obligationsError}
          onReplace={canEditContract ? openReplaceDocument : undefined}
        />
      ),
    },
    {
      id: 'intelligence', label: 'Inteligência Contratual', icon: <ShieldAlert className="h-4 w-4" />,
      /*
        O crachá conta o que EXIGE uma pessoa, e nada mais. Antes ele somava
        riscos e cláusulas — um acervo — e dizia "43" num contrato saudável.
        Um número que nunca baixa deixa de ser sinal.
      */
      badge: attentionCount || undefined,
      content: (
        <div className="space-y-5">
          {/*
            Ordem deliberada, de cima para baixo:

            1. O que o Apex entendeu, com o que exige atenção primeiro.
            2. O que ele ainda NÃO leu — porque confiar na ausência de uma
               regra exige saber que o papel foi lido.
            3. A exposição operacional que essas regras criam.
            4. O acervo de cláusulas, que é registro e não trabalho.
          */}
          <ContractInterpretationPanel
            interpretations={detail.clauses}
            documents={detail.documents}
            canDecide={canEditContract}
            canAnalyze={hasPermission('contracts.analyze_with_ai')}
            analyzing={extracting}
            onAnalyze={(documentId) => { void runExtraction(documentId); }}
            onDecide={(clause, decision) => { void handleInterpretationDecision(clause, decision); }}
          />
          <ClauseOpsPanel
            documents={documentAnalysisStates(detail.documents, analyses, detail.clauses)}
            coverage={contractCoverage(trusted, detail.documents, analyses)}
            canAnalyze={hasPermission('contracts.analyze_with_ai')}
            analyzingId={analyzingDocId}
            onAnalyze={(documentId) => { void runExtraction(documentId); }}
          />
          <RisksTab
            trusted={trusted}
            detail={detail}
            canAct={canEditContract}
            onRiskAction={handleRiskAction}
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
          <ClausesTab detail={detail} />
        </div>
      ),
    },
    {
      id: 'governance', label: 'Governança', icon: <ShieldCheck className="h-4 w-4" />,
      /*
        Governança conta apenas o que o Apex NÃO tem autoridade para decidir.
        Aprovação já concedida é história e não pede nada de ninguém.
      */
      badge: detail.approvals.filter((a) => a.status !== 'approved').length || undefined,
      content: (
        <GovernanceTab
          trusted={trusted}
          detail={detail}
          record={record}
          attentionCount={attentionCount}
          onReview={hasPermission('contracts.approve') ? () => contractActions.reviewApproval(record) : undefined}
          onClassifyProvenance={canClassifyProvenance ? openProvenance : undefined}
          onOpenHistory={() => setHistoryOpen(true)}
        />
      ),
    },
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
            else if (key === 'reviewClauseProposals') setActiveTab('intelligence');
            else if (key === 'openDocuments') setActiveTab('documents');
            else if (key === 'openBilling') setActiveTab('billing');
            else setActiveTab('operation');
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
        {/*
          A ordem do menu vem de `DETAIL_TABS`, não da ordem em que os objetos
          foram escritos no array: a ordem de leitura de um contrato é uma
          decisão de produto, e ela não pode depender de onde alguém colou o
          próximo destino.
        */}
        <DossierNav
          items={DETAIL_TABS.flatMap((tabId) => {
            const tab = tabs.find((candidate) => candidate.id === tabId);
            return tab ? [{ id: tab.id, label: tab.label, icon: tab.icon, badge: tab.badge }] : [];
          })}
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
/**
 * OPERAÇÃO — o que o contrato faz a organização ter de fazer.
 *
 * ─── A pergunta que a aba responde ─────────────────────────────────────────
 *
 * Não "quais são as obrigações cadastradas", e sim "o que precisa acontecer,
 * de quem, até quando, e o que o Apex já está seguindo".
 *
 * A ordem é a da urgência operacional:
 *
 *   1. O que o Apex está ACOMPANHANHO — porque isso já tem dono e prazo.
 *   2. O que o contrato EXIGE, agrupado por quem responde.
 *   3. A lista de tarefas anterior à Fase 3, rotulada como legado.
 *
 * O agrupamento por responsável não é cosmético: "o que NÓS temos que fazer" e
 * "o que o CLIENTE tem que fazer" pedem ações opostas — a primeira é execução,
 * a segunda é cobrança — e uma lista única obrigava a ler linha a linha para
 * descobrir de quem era a bola.
 */
function OperationTab({
  trusted, detail, followups, followupsError, followupsLoading, asOf, canAct,
  onAssignFollowup, onWaitFollowup, onEscalateFollowup, onCompleteFollowup, onNewObligation,
}: {
  trusted: TrustedContract;
  detail: ContractDetail;
  followups: readonly ApexFollowupRow[];
  followupsError: string | null;
  followupsLoading: boolean;
  asOf: string;
  canAct: boolean;
  onAssignFollowup: (followup: ApexFollowupRow) => void;
  onWaitFollowup: (followup: ApexFollowupRow) => void;
  onEscalateFollowup: (followup: ApexFollowupRow) => void;
  onCompleteFollowup: (followup: ApexFollowupRow) => void;
  onNewObligation?: () => void;
}) {
  return (
    <section className="space-y-6" data-testid="contract-operation-tab">
      <ApexFollowupPanel
        followups={followups}
        asOf={asOf}
        error={followupsError}
        loading={followupsLoading}
        canAct={canAct}
        onAssign={onAssignFollowup}
        onWait={onWaitFollowup}
        onEscalate={onEscalateFollowup}
        onComplete={onCompleteFollowup}
      />

      <div>
        <SectionHeader
          title="O que este contrato exige"
          hint="Estruturado a partir do documento original, com a cláusula de origem"
        />
        <ContractStructuredObligations contractId={detail.contract.id} />
      </div>

      <ObligationsTab trusted={trusted} detail={detail} onNewObligation={onNewObligation} legacyOnly />
    </section>
  );
}

/**
 * GOVERNANÇA — o que o Apex NÃO tem autoridade para decidir.
 *
 * Ela consolida num lugar só o que estava espalhado: a rota de alçada (que era
 * a aba "Aprovações"), a classificação de origem do contrato (que só existia
 * enterrada em "Mais ações") e o contexto de auditoria.
 *
 * A gaveta "Histórico" do header NÃO é duplicada aqui: ela continua sendo a
 * superfície de leitura da trilha completa, e esta aba só dá o caminho até
 * ela. Dois lugares mostrando a mesma timeline foi exatamente o defeito que
 * fez a auditoria deixar de ser aba.
 */
function GovernanceTab({
  trusted, detail, record, attentionCount, onReview, onClassifyProvenance, onOpenHistory,
}: {
  trusted: TrustedContract;
  detail: ContractDetail;
  record: ContractGovernanceRecord;
  attentionCount: number;
  onReview?: () => void;
  onClassifyProvenance?: () => void;
  onOpenHistory: () => void;
}) {
  const dataClass = (detail.contract.data_class ?? 'unclassified') as ContractDataClass;
  const DATA_CLASS_LABEL: Record<ContractDataClass, string> = {
    live: 'Produção',
    demo: 'Demonstração',
    unclassified: 'Não classificado',
  };

  return (
    <div className="space-y-6" data-testid="contract-governance-tab">
      <section>
        <SectionHeader
          title="Decisões que exigem autoridade humana"
          hint="O Apex monitora e executa o que a política permite; o que está aqui é o que ele não pode decidir"
        />
        {attentionCount > 0 ? (
          <p className="rounded-lg border border-ig-warning/35 bg-ig-warning/5 p-3 text-ig-body-sm text-ig-warning">
            {attentionCount === 1
              ? '1 interpretação contratual requer análise humana.'
              : `${attentionCount} interpretações contratuais requerem análise humana.`}
            {' '}Elas estão em Inteligência Contratual.
          </p>
        ) : (
          <p className="rounded-lg border border-ig-border-subtle p-3 text-ig-caption text-ig-fg-muted">
            Nenhuma interpretação contratual pendente de decisão humana.
          </p>
        )}
      </section>

      <ApprovalsTab trusted={trusted} detail={detail} onReview={onReview} />

      <section>
        <SectionHeader
          title="Classificação e procedência"
          hint="Só contrato de produção entra em métrica de carteira — e classificar não é a autoridade de quem cadastra"
        />
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-ig-border-subtle p-3">
          <Metric label="Classe do dado" value={DATA_CLASS_LABEL[dataClass]} />
          <Metric label="Contrato" value={record.code} />
          {onClassifyProvenance && (
            <HudButton
              variant="secondary" size="sm" leftIcon={<BadgeCheck className="h-4 w-4" />}
              onClick={onClassifyProvenance}
            >
              Classificar origem
            </HudButton>
          )}
        </div>
      </section>

      <section>
        <SectionHeader title="Trilha auditável" hint="Todo ato governado deste contrato, na ordem em que ocorreu" />
        <div className="rounded-lg border border-ig-border-subtle p-3">
          <HudButton
            variant="secondary" size="sm" leftIcon={<FileClock className="h-4 w-4" />}
            onClick={onOpenHistory}
          >
            Abrir histórico
          </HudButton>
        </div>
      </section>
    </div>
  );
}

function ObligationsTab({ trusted, detail, onNewObligation, legacyOnly = false }: {
  trusted: TrustedContract;
  detail: ContractDetail;
  onNewObligation?: () => void;
  /**
   * Dentro de `Operação`, o modelo estruturado já foi mostrado acima. Repetir
   * a mesma lista duas vezes na mesma aba faria o usuário procurar a diferença
   * entre elas — e não há diferença nenhuma.
   */
  legacyOnly?: boolean;
}) {
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

  // Sem linha nenhuma na lista antiga, a seção de legado não tem por que
  // ocupar espaço anunciando que está vazia.
  if (legacyOnly && detail.obligations.length === 0) return null;

  return (
    <section className="space-y-6">
      {!legacyOnly && (
        <div>
          <SectionHeader title="Obrigações contratuais" hint="O que o contrato exige, com origem e prazo" />
          <ContractStructuredObligations contractId={detail.contract.id} />
        </div>
      )}

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
/**
 * EXPOSIÇÃO CONTRATUAL — o que este contrato pode custar, e o que fazer.
 *
 * ─── O que saiu ────────────────────────────────────────────────────────────
 *
 * Quatro contadores ("riscos persistidos", "riscos abertos", "cláusulas de
 * alto risco", "mitigações cadastradas") e uma lista de títulos com um número
 * de 1 a 25 num selo. Isso descreve o CADASTRO de riscos, não a exposição do
 * contrato — e a pergunta que alguém abre esta tela para fazer nunca é "quantos
 * riscos foram cadastrados".
 *
 * ─── O que entrou ──────────────────────────────────────────────────────────
 *
 * Cada risco vira uma exposição operacional com base contratual, o que se
 * observa, impacto, exposição apurada (só quando canônica) e o que o Apex
 * recomenda — mais as ações governadas que cabem NAQUELE estado.
 *
 * O que o Apex nunca faz, e a tela não oferece: alterar a cláusula. Ele pode
 * RECOMENDAR um aditivo; a verdade assinada não se reescreve.
 */
function RisksTab({
  trusted, detail, canAct, onRiskAction,
}: {
  trusted: TrustedContract;
  detail: ContractDetail;
  canAct?: boolean;
  onRiskAction?: (exposure: RiskExposure, action: RiskActionKey) => void;
}) {
  const health = contractHealth(trusted);
  const adverse = health.drivers.filter((d) => d.adverse);

  /*
    O vínculo risco→cláusula vive em `contract_risks_links`. Quando ele não
    existe, a base contratual fica AUSENTE e o cartão diz isso — em vez de
    escolher uma cláusula plausível, que seria atribuir a um texto assinado uma
    responsabilidade que ninguém registrou.
  */
  const clauseById = new Map(detail.clauses.map((c) => [c.id, c]));
  const clauseByRisk = new Map<string, ContractClauseRow>();
  for (const link of detail.riskLinks) {
    const clauseId = (link as { clause_id?: string | null }).clause_id ?? null;
    const riskId = (link as { risk_id?: string | null }).risk_id ?? null;
    if (!clauseId || !riskId) continue;
    const clause = clauseById.get(clauseId);
    if (clause) clauseByRisk.set(riskId, clause);
  }

  const exposures = detail.risks.map((risk) => {
    const clause = clauseByRisk.get(risk.id) ?? null;
    return buildRiskExposure({
      id: risk.id,
      title: risk.title,
      description: risk.description ?? null,
      category: risk.category ?? null,
      riskScore: risk.risk_score ?? null,
      status: risk.status ?? null,
      mitigationPlan: risk.mitigation_plan ?? null,
      ownerUserId: risk.owner_user_id ?? null,
      sourceClauseId: clause?.id ?? null,
      sourceClauseTitle: clause?.title ?? null,
      sourceClausePage: clause?.source_page ?? null,
      /*
        Exposição só existe quando há quantia CANÔNICA. A cláusula de origem é
        a única fonte dela hoje; estimar a partir do score e do valor do
        contrato produziria um número com cara de apuração.
      */
      canonicalExposure: clause?.amount === null || clause?.amount === undefined
        ? null : Number(clause.amount),
      hasOpenFollowup: false,
    });
  });

  return (
    <div className="space-y-5" data-testid="contract-risk-exposure">
      <section>
        <SectionHeader
          title="Exposição contratual"
          hint="O que este contrato pode custar, e o que já está sendo feito a respeito"
        />
        {exposures.length === 0 ? (
          <InlineEmpty message="Nenhum risco registrado para este contrato. Ausência de risco registrado não é ausência de risco — é ausência de apuração." />
        ) : (
          <div className="space-y-3">
            {exposures.map((exposure) => (
              <RiskExposureCard
                key={exposure.id}
                exposure={exposure}
                canAct={Boolean(canAct)}
                onAction={onRiskAction}
              />
            ))}
          </div>
        )}
      </section>

      {adverse.length > 0 && (
        <section>
          <SectionHeader
            title="Dimensões do contrato em atenção"
            count={adverse.length}
            hint="Lacunas de apuração — não são riscos registrados"
          />
          <ul className="space-y-2">
            {adverse.map((d) => (
              <li key={d.dimension} className="border-l-2 border-ig-warning pl-2.5">
                <p className="text-ig-body-sm font-medium text-ig-fg-strong">{d.label}</p>
                <p className="mt-0.5 text-ig-caption text-ig-fg-muted">{d.detail}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

const RISK_SEVERITY_TONE: Record<RiskSeverity, string> = {
  critical: 'border-ig-danger/45 text-ig-danger',
  high: 'border-ig-danger/35 text-ig-danger',
  medium: 'border-ig-warning/45 text-ig-warning',
  low: 'border-ig-success/45 text-ig-success',
  unknown: 'border-ig-border-strong text-ig-fg-muted',
};

function RiskExposureCard({
  exposure, canAct, onAction,
}: {
  exposure: RiskExposure;
  canAct: boolean;
  onAction?: (exposure: RiskExposure, action: RiskActionKey) => void;
}) {
  return (
    <article
      className={cn(
        'rounded-xl border bg-ig-panel/45 p-3',
        exposure.severity === 'critical' || exposure.severity === 'high'
          ? 'border-ig-danger/30' : 'border-ig-border-subtle',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-ig-body-sm font-semibold text-ig-fg-strong">
          {exposure.title}
        </p>
        <span className={cn(
          'shrink-0 rounded-full border px-2 py-0.5 text-[10px]',
          RISK_SEVERITY_TONE[exposure.severity],
        )}>
          {RISK_SEVERITY_LABEL[exposure.severity]}
        </span>
      </div>

      <dl className="mt-2 space-y-1.5 text-ig-caption">
        <div>
          <dt className="text-ig-label uppercase tracking-wide text-ig-fg-subtle">Base contratual</dt>
          <dd className={exposure.hasSourceClause ? 'text-ig-fg-default' : 'text-ig-fg-muted'}>
            {exposure.contractualBasis}
          </dd>
        </div>
        <div>
          <dt className="text-ig-label uppercase tracking-wide text-ig-fg-subtle">O que se observa</dt>
          <dd className="text-ig-fg-default">{exposure.observedIssue}</dd>
        </div>
        <div>
          <dt className="text-ig-label uppercase tracking-wide text-ig-fg-subtle">Impacto potencial</dt>
          <dd className="text-ig-fg-default">{exposure.potentialImpact}</dd>
        </div>
        <div>
          <dt className="text-ig-label uppercase tracking-wide text-ig-fg-subtle">Exposição</dt>
          {/* UNKNOWN continua UNKNOWN: nenhum número é estimado aqui. */}
          <dd className={exposure.exposure === null ? 'text-ig-fg-muted' : 'text-ig-fg-strong ig-tabular'}>
            {exposure.exposure === null
              ? exposure.exposureNote
              : formatCurrencyFull(exposure.exposure)}
          </dd>
        </div>
      </dl>

      <p className="mt-2 rounded-lg border border-ig-border-subtle bg-ig-bg-base/40 p-2 text-ig-caption text-ig-fg-default">
        <span className="font-semibold text-ig-fg-strong">O Apex recomenda: </span>
        {exposure.recommendation}
      </p>

      {canAct && onAction && exposure.actions.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {exposure.actions.map((action) => (
            <HudButton
              key={action}
              variant={action === 'acceptRisk' ? 'ghost' : 'secondary'}
              size="sm"
              onClick={() => onAction(exposure, action)}
            >
              {RISK_ACTION_LABEL[action]}
            </HudButton>
          ))}
        </div>
      )}
    </article>
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

      {/*
        A MEDIÇÃO OPERACIONAL, em contexto — Fase 6.

        O painel acima mostra os MARCOS do contrato: o que foi previsto medir.
        Este mostra as MEDIÇÕES de projeto: o que a operação apurou, o que
        falta para submeter e o que já foi aceito. São camadas diferentes, e
        ficam separadas de propósito — misturá-las faria "marco previsto" e
        "medição aceita" caberem na mesma linha.

        Contratos não edita medição aqui. Cada linha leva ao projeto, que é
        onde a instância mora e onde o trabalho acontece.
      */}
      <section>
        <SectionHeader
          title="Medição operacional"
          hint="Instâncias em Projetos, com prontidão e aceite. Editar é lá."
        />
        <ContractMeasurementReadiness contractId={trusted.id} />
      </section>

      {/*
        A CADEIA CONTRATO-A-CAIXA deste contrato — Fase 7.

        Mesmo componente e mesmo serviço que a seção `Faturamentos` da carteira
        usa (§87). O dossiê não recalcula nada: se o número diferir entre as
        duas telas, a divergência é impossível por construção, e não por
        disciplina de quem escreve a próxima.
      */}
      <section>
        <SectionHeader
          title="Cadeia até o caixa"
          hint="Origem do valor, elegibilidade, liberação, nota, recebido e conciliação"
        />
        <ContractToCashPanel contractId={trusted.id} />
      </section>

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

/**
 * DOCUMENTOS — o papel que sustenta a operação, não uma pasta de arquivos.
 *
 * ─── O que saiu ────────────────────────────────────────────────────────────
 *
 * Uma lista plana de nomes com um selo de status. Ela respondia "o que foi
 * anexado" e nenhuma das perguntas que trazem alguém a esta aba: este papel
 * serve para quê? que exigência ele satisfaz? ainda vale? o que falta chegar?
 *
 * ─── O que entrou ──────────────────────────────────────────────────────────
 *
 * Categorias operacionais e, dentro delas, o VÍNCULO — qual obrigação aquele
 * documento satisfaz e se o aceite foi registrado. O vínculo existe em
 * `contract_obligation_evidence` desde a Fase 3 e nunca tinha sido lido aqui.
 *
 * E o que FALTA aparece junto com o que existe: um repositório que só mostra
 * os papéis que chegaram esconde exatamente a informação que importa.
 */
function DocumentsTab({ detail, obligations, obligationsError, onReplace }: {
  detail: ContractDetail;
  obligations: ContractObligationsAsOf | null;
  obligationsError: string | null;
  /** Substituir por nova versão. Ausente quando o usuário não pode editar. */
  onReplace?: (doc: ContractDocumentRow) => void;
}) {
  const docById = new Map(detail.documents.map((d) => [d.id, d]));

  /*
    O grafo de evidência, percorrido uma vez: para cada documento, o que ele
    satisfaz; e para cada exigência sem documento, o que falta.
  */
  const linksByDocument = new Map<string, DocumentLink[]>();
  const missing: MissingEvidence[] = [];

  for (const obligation of obligations?.obligations ?? []) {
    const requirementById = new Map<string, ObligationEvidenceRequirement>(
      obligation.evidenceRequirements.map((r) => [r.id, r] as const),
    );
    for (const instance of obligation.instances) {
      const satisfiedRequirements = new Set<string>();
      for (const evidence of instance.evidence) {
        if (evidence.requirementId) satisfiedRequirements.add(evidence.requirementId);
        if (!evidence.documentId) continue;
        const requirement = evidence.requirementId
          ? requirementById.get(evidence.requirementId) ?? null : null;
        const links = linksByDocument.get(evidence.documentId) ?? [];
        links.push({
          obligationTitle: obligation.definition.title,
          requirementLabel: requirement?.requirementText ?? null,
          occurrenceKey: instance.occurrenceKey,
          acceptanceState:
            evidence.acceptanceState === 'accepted' ? 'accepted'
              : evidence.acceptanceState === 'rejected' ? 'rejected'
                : evidence.acceptanceState === 'pending' ? 'pending' : 'unknown',
        });
        linksByDocument.set(evidence.documentId, links);
      }

      // Exigência obrigatória sem evidência: é o que falta chegar.
      for (const requirement of obligation.evidenceRequirements) {
        if (satisfiedRequirements.has(requirement.id)) continue;
        if (requirement.mandatory === false) continue;
        if (instance.state === 'SATISFIED' || instance.state === 'WAIVED'
            || instance.state === 'CANCELLED') continue;
        missing.push({
          obligationTitle: obligation.definition.title,
          requirementLabel: requirement.requirementText,
          occurrenceKey: instance.occurrenceKey,
          dueDate: instance.dueDate,
          awaitingSchedule: instance.dateState === 'AWAITING_SCHEDULE_ANCHOR',
        });
      }
    }
  }

  const inputs: OperationalDocumentInput[] = [
    ...detail.documents.map((doc) => ({
      id: doc.id,
      title: doc.title,
      documentType: doc.document_type,
      status: doc.status,
      version: doc.version,
      supersededBy: doc.superseded_by_document_id,
      links: linksByDocument.get(doc.id) ?? [],
    })),
    // Arquivos legados do contrato: são papéis reais e continuam visíveis, na
    // categoria genérica, sem fingir vínculo que não existe.
    ...detail.files.map((file) => ({
      id: file.id,
      title: file.file_name,
      documentType: 'annex',
      status: 'uploaded',
      version: 1,
      supersededBy: null,
      links: [] as DocumentLink[],
    })),
  ];

  const operations = buildDocumentOperations(inputs, missing);

  return (
    <div className="space-y-6" data-testid="contract-documents-tab">
      {obligationsError && (
        <p className="rounded-lg border border-ig-warning/35 p-3 text-ig-caption text-ig-warning">
          {obligationsError} Os documentos aparecem abaixo, mas sem o vínculo com as exigências.
        </p>
      )}

      {operations.total === 0 ? (
        <InlineEmpty message="Nenhum documento no repositório deste contrato." />
      ) : (
        <>
          <SectionHeader
            title="Repositório documental"
            hint={
              operations.unlinkedCount === 0
                ? `${operations.total} documento(s), todos vinculados a uma exigência`
                : `${operations.total} documento(s) · ${operations.unlinkedCount} sem finalidade operacional registrada`
            }
          />
          {operations.groups.map((group) => (
            <section key={group.category}>
              <h3 className="mb-2 text-ig-body-sm font-semibold text-ig-fg-strong">
                {DOCUMENT_CATEGORY_LABEL[group.category]}
                <span className="ml-2 font-normal text-ig-caption text-ig-fg-muted">
                  {group.documents.length}
                </span>
              </h3>
              <div className="space-y-2">
                {group.documents.map((doc) => {
                  const row = docById.get(doc.id) ?? null;
                  const badge = DOC_STATUS[doc.status] ?? { label: doc.status, variant: 'neutral' as const };
                  return (
                    <div
                      key={doc.id}
                      className="rounded-lg border border-ig-border-subtle bg-ig-panel/45 p-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-ig-body-sm font-medium text-ig-fg-strong">
                            {doc.title}
                            {doc.version > 1 && (
                              <span className="ml-1.5 text-ig-caption text-ig-fg-muted">v{doc.version}</span>
                            )}
                          </p>
                          <p className="mt-0.5 text-ig-caption text-ig-fg-muted">{doc.purpose}</p>
                        </div>
                        <HudBadge variant={badge.variant} size="sm">{badge.label}</HudBadge>
                      </div>

                      {doc.links.length > 0 && (
                        <ul className="mt-2 space-y-1">
                          {doc.links.map((link, index) => (
                            <li
                              key={`${doc.id}-${index}`}
                              className="flex flex-wrap items-center gap-1.5 text-[11px] text-ig-fg-muted"
                            >
                              <span className="text-ig-fg-default">{link.obligationTitle}</span>
                              {link.occurrenceKey && <span>· {link.occurrenceKey}</span>}
                              <span className={cn(
                                'rounded-full border px-1.5 py-0.5',
                                link.acceptanceState === 'accepted'
                                  ? 'border-ig-success/45 text-ig-success'
                                  : link.acceptanceState === 'rejected'
                                    ? 'border-ig-danger/45 text-ig-danger'
                                    : 'border-ig-border-strong text-ig-fg-muted',
                              )}>
                                {link.acceptanceState === 'accepted' ? 'aceite registrado'
                                  : link.acceptanceState === 'rejected' ? 'recusada'
                                    : 'sem aceite'}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}

                      {doc.superseded && (
                        <p className="mt-1.5 text-[11px] text-ig-fg-subtle">
                          Substituído por versão mais recente — mantido como histórico.
                        </p>
                      )}

                      {/*
                        Só o documento VIGENTE é substituível. Substituir um já
                        substituído criaria duas versões apontando para o mesmo
                        antecessor, e a linhagem deixaria de ser uma linha.
                      */}
                      {onReplace && row && !row.superseded_by_document_id && (
                        <button
                          type="button"
                          onClick={() => onReplace(row)}
                          className="mt-2 text-ig-caption font-medium text-ig-accent transition-colors hover:text-ig-accent-strong"
                        >
                          Substituir por nova versão
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </>
      )}

      {operations.missing.length > 0 && (
        <section>
          <SectionHeader
            title="Evidência que o contrato exige e ainda não chegou"
            count={operations.missing.length}
            hint="O que falta é parte do repositório — esconder isso seria esconder o trabalho"
          />
          <div className="space-y-2">
            {operations.missing.map((item, index) => (
              <div
                key={`${item.obligationTitle}-${index}`}
                className="rounded-lg border border-ig-border-subtle p-3"
              >
                <p className="text-ig-body-sm font-medium text-ig-fg-strong">{item.requirementLabel}</p>
                <p className="mt-0.5 text-ig-caption text-ig-fg-muted">
                  {item.obligationTitle}
                  {item.occurrenceKey && ` · ${item.occurrenceKey}`}
                </p>
                {/*
                  Aguardando a agenda de Projetos NÃO é atraso de ninguém, e a
                  cor tem de dizer isso: azul de informação, não alerta.
                */}
                <p className={cn(
                  'mt-1 text-[11px]',
                  item.awaitingSchedule ? 'text-ig-accent'
                    : item.dueDate ? 'text-ig-fg-muted' : 'text-ig-fg-subtle',
                )}>
                  {item.awaitingSchedule
                    ? 'Prazo será calculado quando Projetos agendar o evento.'
                    : item.dueDate
                      ? `Prazo: ${item.dueDate}`
                      : 'Prazo não apurado.'}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
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
        {/*
          Mesmo sem etapa legada, o estado do MOTOR precisa aparecer: "nenhuma
          etapa registrada" e "esta organização ainda não migrou" são coisas
          diferentes, e quem lê a aba tem de conseguir distinguir as duas.
        */}
        <SharedApprovalEnginePanel contractId={detail.contract.id} className="mt-4" />
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

      {/*
        A governança do motor COMPARTILHADO fica no topo da aba, acima da
        jornada legada. Enquanto a organização não foi cortada, é este bloco
        que diz — com todas as letras — que a aprovação de contrato ainda é
        governada pelo fluxo anterior. Sem ele, a jornada abaixo pareceria a
        única governança que existe, e a distinção entre "migrado" e "não
        migrado" desapareceria da tela.
      */}
      <SharedApprovalEnginePanel contractId={detail.contract.id} />

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
