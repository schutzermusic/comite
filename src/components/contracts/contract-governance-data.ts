'use client';

import { differenceInDays, addDays, subDays } from 'date-fns';
import type { Contract, Project } from '@/lib/types';
import type { ContractApprovalRow, ContractDocumentRow } from '@/lib/contracts/contract-service';

export type GovernanceSectionQuality = 'live' | 'estimated';

/**
 * Per-section provenance for a governance record. `live` = merged from real
 * Supabase relation rows (migration 034); `estimated` = still using the mock
 * enrichment preview below. Undefined means the record was never run through the
 * live merge (pure mock/dev path) and should be treated as fully estimated.
 */
export type ContractGovernanceDataQuality = {
  obligations: GovernanceSectionQuality;
  billing: GovernanceSectionQuality;
  documents: GovernanceSectionQuality;
  approvals: GovernanceSectionQuality;
  projectLink: GovernanceSectionQuality;
  risks: GovernanceSectionQuality;
  ai: GovernanceSectionQuality;
};

export type ContractGovernanceRecord = {
  contract: Contract;
  code: string;
  companyName: string;
  companyReference: string;
  project: Project | null;
  projectReference: string;
  contractType: string;
  totalValue: number;
  billedValue: number;
  remainingValue: number;
  daysUntilExpiration: number | null;
  renewalStatus: 'expired' | 'critical' | 'attention' | 'planned' | 'stable';
  riskScore: number;
  /**
   * Tem análise registrada em `contract_ai_analyses`.
   *
   * Substitui `aiStatus`/`confidenceScore`, que eram fabricados: o estado vinha
   * de `contract.autoExtracted` e a "confiança" de `58 + (seed % 27)` — um
   * número derivado do hash do id, exibido com aparência de medição. Aqui,
   * `null` significa que a relação não foi lida, e não "nenhuma análise".
   */
  hasAiAnalysis: boolean | null;
  legalStatus: 'approved' | 'review' | 'pending';
  financialStatus: 'ok' | 'attention' | 'blocked';
  approvalRoute: string;
  owner: string;
  missingDocuments: string[];
  obligations: ContractObligation[];
  clauses: ContractClause[];
  auditEvents: ContractAuditEvent[];
  linkedProjects: Project[];
  linkedRisks: LinkedRisk[];
  linkedTasks: LinkedTask[];
  linkedDeliberations: LinkedDeliberation[];
  billingEvents: LinkedBillingEvent[];
  revenueRecognitionStatus: string;
  margin: number;
  paymentStatus: string;
  financialAllocationsPending: boolean;
  /** Set by applyLiveGovernanceData when relations are merged from Supabase. */
  dataQuality?: ContractGovernanceDataQuality;
  /** Raw live rows attached by applyLiveGovernanceData (for step SLA + tab actions). */
  liveApprovals?: ContractApprovalRow[];
  liveDocuments?: ContractDocumentRow[];
};

export type LinkedRisk = {
  id: string;
  title: string;
  category: string;
  riskScore: number;
  status: 'open' | 'mitigating' | 'resolved';
  severity: 'low' | 'medium' | 'high' | 'critical';
  mitigationPlan: string | null;
};

export type LinkedTask = {
  id: string;
  title: string;
  dueAt: Date | null;
  status: string;
  priority: string;
  assigneeName: string | null;
};

export type LinkedDeliberation = {
  id: string;
  title: string;
  status: string;
  date: Date;
  committeeName: string;
};

export type LinkedBillingEvent = {
  id: string;
  title: string;
  amount: number;
  due_date: Date | null;
  status: string;
  paid_at: Date | null;
};

export type ContractObligation = {
  id: string;
  title: string;
  owner: string;
  dueDate: Date;
  status: 'open' | 'due_soon' | 'overdue' | 'done';
  evidence: string;
};

export type ContractClause = {
  id: string;
  title: string;
  category: 'Legal' | 'Financeiro' | 'SLA' | 'Renovação' | 'Compliance';
  risk: 'low' | 'medium' | 'high';
  status: 'mapped' | 'review' | 'missing';
  note: string;
};

export type ContractAuditEvent = {
  id: string;
  title: string;
  actor: string;
  at: Date;
  status: 'done' | 'pending' | 'warning';
};

const CONTRACT_TYPES = [
  'Prestação de serviços',
  'Fornecimento',
  'Ordem de serviço',
  'Manutenção',
  'Aditivo contratual',
];

const OWNERS = [
  'Jurídico Corporativo',
  'Controladoria',
  'PMO',
  'Compras',
  'Gestão de Contratos',
];

function hash(input: string) {
  return Array.from(input).reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function resolveProject(contract: Contract, projects: Project[]) {
  const contractWithProjectMetadata = contract as Contract & {
    projectId?: string;
    disableProjectAutoMatch?: boolean;
  };
  const linkedProjectId = contractWithProjectMetadata.projectId;
  if (linkedProjectId) {
    const linked = projects.find((project) => project.id === linkedProjectId);
    if (linked) return linked;
    return null;
  }

  if (contractWithProjectMetadata.disableProjectAutoMatch) {
    return null;
  }

  const company = normalize(contract.vendorOrParty);
  const direct = projects.find((project) => normalize(project.cliente || '').includes(company) || company.includes(normalize(project.cliente || '')));
  if (direct) return direct;

  const seed = hash(contract.id);
  return projects.length > 0 ? projects[seed % projects.length] : null;
}

function getCode(contract: Contract) {
  const match = contract.name.match(/\b(?:OS|OP|CT|CTR)\s*[0-9.-]+/i);
  if (match) return match[0].replace(/\s+/g, ' ');
  return `CTR-${contract.id.slice(-6).toUpperCase()}`;
}

function getRenewalStatus(days: number | null): ContractGovernanceRecord['renewalStatus'] {
  if (days === null) return 'attention';
  if (days < 0) return 'expired';
  if (days <= 30) return 'critical';
  if (days <= 90) return 'attention';
  if (days <= 180) return 'planned';
  return 'stable';
}

function buildMissingDocuments(contract: Contract, seed: number) {
  const missing = new Set<string>();
  if (!contract.fileUrl) missing.add('Documento assinado');
  if (contract.riskClassification === 'high') missing.add('Parecer jurídico');
  if (seed % 3 === 0) missing.add('Comprovante fiscal');
  if (seed % 5 === 0) missing.add('Matriz de obrigações');
  return Array.from(missing);
}

function buildObligations(contract: Contract, owner: string, seed: number, now: Date): ContractObligation[] {
  const base = contract.expirationDate ? new Date(contract.expirationDate) : addDays(now, 120 + (seed % 90));
  const items = [
    {
      title: 'Validar evidências de entrega',
      owner,
      dueDate: addDays(now, (seed % 42) - 12),
      evidence: 'Aceite técnico ou medição',
    },
    {
      title: 'Revisar gatilho de renovação',
      owner: 'Jurídico Corporativo',
      dueDate: subDays(base, 45),
      evidence: 'Despacho de renovação ou não renovação',
    },
    {
      title: 'Atualizar exposição financeira',
      owner: 'Controladoria',
      dueDate: addDays(now, (seed % 60) + 8),
      evidence: 'Reconciliação com financeiro',
    },
  ];

  return items.map((item, index) => {
    const days = differenceInDays(item.dueDate, now);
    return {
      id: `${contract.id}-obl-${index}`,
      ...item,
      status: days < 0 ? 'overdue' : days <= 15 ? 'due_soon' : index === 2 && seed % 4 === 0 ? 'done' : 'open',
    };
  });
}

function buildClauses(contract: Contract, seed: number): ContractClause[] {
  const risk = contract.riskClassification;
  return [
    {
      id: `${contract.id}-clause-renewal`,
      title: 'Renovação e denúncia',
      category: 'Renovação',
      risk: risk === 'high' ? 'high' : seed % 2 === 0 ? 'medium' : 'low',
      status: contract.expirationDate ? 'mapped' : 'review',
      note: contract.expirationDate ? 'Prazo de expiração mapeado no cadastro.' : 'Data de expiração ausente no cadastro.',
    },
    {
      id: `${contract.id}-clause-payment`,
      title: 'Condições de pagamento',
      category: 'Financeiro',
      risk: seed % 3 === 0 ? 'medium' : 'low',
      status: 'review',
      note: 'Prévia mock: requer leitura documental conectada para confirmar condições.',
    },
    {
      id: `${contract.id}-clause-sla`,
      title: 'SLA e penalidades',
      category: 'SLA',
      risk: risk === 'low' ? 'medium' : 'high',
      status: 'review',
      note: 'Interface preparada para extração de SLA por IA, sem API ativa.',
    },
  ];
}

function buildAuditEvents(contract: Contract, seed: number): ContractAuditEvent[] {
  return [
    {
      id: `${contract.id}-audit-upload`,
      title: 'Contrato registrado no repositório',
      actor: contract.responsibleName || 'Gestão de Contratos',
      at: new Date(contract.uploadedAt),
      status: 'done',
    },
    /*
      Havia aqui um evento de auditoria fabricado — "Análise IA mock preparada",
      atribuído a um ator chamado "INSIGHT AI" que nunca existiu — misturado a
      eventos reais numa lista chamada trilha de auditoria. Um registro inventado
      dentro da trilha é pior que um painel vazio: ele é indistinguível do
      registro verdadeiro exatamente onde a distinção é o produto.
    */
    {
      id: `${contract.id}-audit-legal`,
      title: 'Revisão jurídica',
      actor: 'Jurídico Corporativo',
      at: addDays(new Date(contract.uploadedAt), 3 + (seed % 7)),
      status: contract.riskClassification === 'high' ? 'pending' : 'done',
    },
  ];
}

/**
 * Selo de intenção exigido por `enrichContractsForGovernance`.
 *
 * Não protege contra um desenvolvedor determinado — protege contra o acidente,
 * que é o risco real. Nenhuma chamada a este enricher pode mais acontecer sem
 * que o autor escreva `DEMO_PREVIEW_INTENT` na linha, e sem que todo revisor
 * do diff veja que ali entra dado SINTÉTICO.
 *
 * Foi assim que o vazamento aconteceu da primeira vez: a função tinha nome
 * neutro ("enrich"), assinatura inocente, e o resultado subia para a Executive
 * Band e para o PDF oficial sem que nada no call site denunciasse a natureza
 * do dado.
 */
export const DEMO_PREVIEW_INTENT = Symbol('contract-governance-demo-preview');
export type DemoPreviewIntent = typeof DEMO_PREVIEW_INTENT;

/**
 * Preview SINTÉTICO de governança — dado de DEMONSTRAÇÃO, não medição.
 *
 * Fabrica obrigações, cláusulas, auditoria, faturamento (escada fixa
 * 10/40/50%), riscos, tarefas, deliberações e margem a partir de
 * `hash(contract.id + contract.name)`.
 *
 * ⚠️ NADA que sai daqui pode alimentar:
 *      · a Executive Band
 *      · Contract Health
 *      · Revenue at Risk
 *      · recomendações operacionais
 *      · o PDF oficial
 *
 * Para qualquer uma dessas, use `src/lib/contracts/trust/read-model.ts`, que
 * lê exclusivamente linhas reais e devolve `Official<T>`.
 *
 * O uso legítimo que resta é listagem de abas ainda não migradas, o drawer
 * (com selo "Demonstração" por seção) e o harness de preview de relatórios.
 */
export function enrichContractsForGovernance(
  contracts: Contract[],
  projects: Project[],
  options: { intent: DemoPreviewIntent; now?: Date },
): ContractGovernanceRecord[] {
  const now = options.now ?? new Date();
  return contracts.map((contract) => {
    const seed = hash(contract.id + contract.name);
    const project = resolveProject(contract, projects);
    const daysUntilExpiration = contract.expirationDate ? differenceInDays(new Date(contract.expirationDate), now) : null;
    const billedRatio = Math.min(0.92, 0.18 + (seed % 58) / 100);
    const billedValue = Math.round(contract.value * billedRatio);
    const missingDocuments = buildMissingDocuments(contract, seed);
    const riskBase = contract.riskClassification === 'high' ? 72 : contract.riskClassification === 'medium' ? 48 : 24;
    const expirationWeight = daysUntilExpiration === null ? 12 : daysUntilExpiration < 0 ? 18 : daysUntilExpiration < 45 ? 14 : 0;

    const linkedProjects = project ? [project] : [];
    const linkedRisks: LinkedRisk[] = [
      {
        id: `${contract.id}-risk-1`,
        title: `Risco de Atraso Financeiro — ${contract.vendorOrParty}`,
        category: 'Financeiro',
        riskScore: riskBase + (seed % 10),
        status: seed % 2 === 0 ? 'open' : 'mitigating',
        severity: contract.riskClassification === 'high' ? 'high' : 'medium',
        mitigationPlan: 'Acompanhamento semanal de medições físicas e liberação de notas.'
      },
      ...(contract.riskClassification === 'high' ? [{
        id: `${contract.id}-risk-2`,
        title: `Disputa sobre Cláusula Penal de SLA`,
        category: 'Legal',
        riskScore: 85,
        status: 'open' as const,
        severity: 'critical' as const,
        mitigationPlan: 'Revisão jurídica prévia e renegociação do anexo de níveis de serviço.'
      }] : [])
    ];

    const linkedTasks: LinkedTask[] = [
      {
        id: `${contract.id}-task-1`,
        title: `Revisar vigência e apólice do contrato ${getCode(contract)}`,
        dueAt: contract.expirationDate ? subDays(new Date(contract.expirationDate), 30) : addDays(now, 15),
        status: seed % 3 === 0 ? 'todo' : 'in_progress',
        priority: contract.riskClassification === 'high' ? 'high' : 'medium',
        assigneeName: contract.responsibleName || OWNERS[seed % OWNERS.length]
      },
      {
        id: `${contract.id}-task-2`,
        title: `Validar medição física de faturamento`,
        dueAt: addDays(now, 5),
        status: seed % 2 === 0 ? 'done' : 'todo',
        priority: 'medium',
        assigneeName: OWNERS[(seed + 1) % OWNERS.length]
      }
    ];

    const linkedDeliberations: LinkedDeliberation[] = [
      {
        id: `${contract.id}-delib-1`,
        title: `Homologação do Contrato ${getCode(contract)} — Comitê Executivo`,
        status: contract.riskClassification === 'high' ? 'em_pauta' : 'aprovado',
        date: contract.signingDate ? new Date(contract.signingDate) : subDays(now, 10),
        committeeName: 'Comitê de Governança e Finanças'
      }
    ];

    const billingEvents: LinkedBillingEvent[] = [
      {
        id: `${contract.id}-be-1`,
        title: 'Assinatura & Mobilização (10%)',
        amount: Math.round(contract.value * 0.1),
        due_date: contract.signingDate ? new Date(contract.signingDate) : subDays(now, 20),
        status: 'pago',
        paid_at: contract.signingDate ? new Date(contract.signingDate) : subDays(now, 19)
      },
      {
        id: `${contract.id}-be-2`,
        title: 'Medição Física Fase 1 (40%)',
        amount: Math.round(contract.value * 0.4),
        due_date: addDays(now, 10),
        status: seed % 2 === 0 ? 'pago' : 'pendente',
        paid_at: seed % 2 === 0 ? addDays(now, 11) : null
      },
      {
        id: `${contract.id}-be-3`,
        title: 'Medição Final & Encerramento (50%)',
        amount: Math.round(contract.value * 0.5),
        due_date: contract.expirationDate ? new Date(contract.expirationDate) : addDays(now, 90),
        status: 'pendente',
        paid_at: null
      }
    ];

    const revenueRecognitionStatus = seed % 3 === 0 ? 'Linear mensal' : seed % 3 === 1 ? 'Medição física' : 'Reconhecimento integral na entrega';
    const margin = 20 + (seed % 25);
    const paymentStatus = contract.value <= 0 ? 'Suspenso' : seed % 4 === 0 ? 'Atrasado' : 'Adimplente';
    const financialAllocationsPending = seed % 6 === 0 && !project;

    return {
      contract,
      code: getCode(contract),
      companyName: contract.vendorOrParty,
      companyReference: `Empresa vinculada: ${contract.vendorOrParty}`,
      project,
      projectReference: project ? `${project.codigo} · ${project.nome}` : 'Projeto não vinculado',
      contractType: (contract as Contract & { contractType?: string }).contractType || CONTRACT_TYPES[seed % CONTRACT_TYPES.length],
      totalValue: contract.value,
      billedValue,
      remainingValue: Math.max(contract.value - billedValue, 0),
      daysUntilExpiration,
      renewalStatus: getRenewalStatus(daysUntilExpiration),
      riskScore: Math.min(98, riskBase + expirationWeight + missingDocuments.length * 4 + (seed % 8)),
      // O enricher não lê `contract_ai_analyses`: ele não sabe, e dizer `false`
      // seria afirmar ausência sem ter olhado. Quem sabe é a fusão com o vivo.
      hasAiAnalysis: null,
      legalStatus: contract.riskClassification === 'high' ? 'review' : seed % 5 === 0 ? 'pending' : 'approved',
      financialStatus: contract.value <= 0 ? 'blocked' : seed % 4 === 0 ? 'attention' : 'ok',
      approvalRoute: contract.riskClassification === 'high' ? 'Jurídico + Financeiro + Comitê' : 'Jurídico + Gestor responsável',
      owner: contract.responsibleName || OWNERS[seed % OWNERS.length],
      missingDocuments,
      obligations: buildObligations(contract, contract.responsibleName || OWNERS[seed % OWNERS.length], seed, now),
      clauses: buildClauses(contract, seed),
      auditEvents: buildAuditEvents(contract, seed),
      linkedProjects,
      linkedRisks,
      linkedTasks,
      linkedDeliberations,
      billingEvents,
      revenueRecognitionStatus,
      margin,
      paymentStatus,
      financialAllocationsPending,
    };
  });
}

export function formatCurrencyCompact(value: number, currency = 'BRL') {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency,
    notation: 'compact',
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(value || 0);
}

const BILLED_STATUS_TOKENS = ['pago', 'paid', 'billed', 'realizado', 'realized', 'faturado'];

export function isBillingEventRealized(event: LinkedBillingEvent): boolean {
  return Boolean(event.paid_at) || BILLED_STATUS_TOKENS.includes((event.status ?? '').toLowerCase());
}

/** Overdue = not realized and past due. `now` defaults here (outside React render) to stay lint-pure in components. */
export function countOverdueBillingEvents(events: LinkedBillingEvent[], now: Date = new Date()): number {
  return events.filter((event) => !isBillingEventRealized(event) && event.due_date != null && event.due_date.getTime() < now.getTime()).length;
}

export function formatCurrencyFull(value: number, currency = 'BRL') {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value || 0);
}
