'use client';

import { differenceInDays, addDays, subDays } from 'date-fns';
import type { Contract, Project } from '@/lib/types';

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
  confidenceScore: number;
  aiStatus: 'mock_pending' | 'mock_ready' | 'manual_review';
  legalStatus: 'approved' | 'review' | 'pending';
  financialStatus: 'ok' | 'attention' | 'blocked';
  approvalRoute: string;
  owner: string;
  missingDocuments: string[];
  obligations: ContractObligation[];
  clauses: ContractClause[];
  auditEvents: ContractAuditEvent[];
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
    {
      id: `${contract.id}-audit-ai`,
      title: 'Análise IA mock preparada',
      actor: 'INSIGHT AI',
      at: addDays(new Date(contract.uploadedAt), 1),
      status: 'warning',
    },
    {
      id: `${contract.id}-audit-legal`,
      title: 'Revisão jurídica',
      actor: 'Jurídico Corporativo',
      at: addDays(new Date(contract.uploadedAt), 3 + (seed % 7)),
      status: contract.riskClassification === 'high' ? 'pending' : 'done',
    },
  ];
}

export function enrichContractsForGovernance(contracts: Contract[], projects: Project[], now = new Date()): ContractGovernanceRecord[] {
  return contracts.map((contract) => {
    const seed = hash(contract.id + contract.name);
    const project = resolveProject(contract, projects);
    const daysUntilExpiration = contract.expirationDate ? differenceInDays(new Date(contract.expirationDate), now) : null;
    const billedRatio = Math.min(0.92, 0.18 + (seed % 58) / 100);
    const billedValue = Math.round(contract.value * billedRatio);
    const missingDocuments = buildMissingDocuments(contract, seed);
    const riskBase = contract.riskClassification === 'high' ? 72 : contract.riskClassification === 'medium' ? 48 : 24;
    const expirationWeight = daysUntilExpiration === null ? 12 : daysUntilExpiration < 0 ? 18 : daysUntilExpiration < 45 ? 14 : 0;

    return {
      contract,
      code: getCode(contract),
      companyName: contract.vendorOrParty,
      companyReference: `Empresa vinculada: ${contract.vendorOrParty}`,
      project,
      projectReference: project ? `${project.codigo} · ${project.nome}` : 'Projeto não vinculado',
      contractType: CONTRACT_TYPES[seed % CONTRACT_TYPES.length],
      totalValue: contract.value,
      billedValue,
      remainingValue: Math.max(contract.value - billedValue, 0),
      daysUntilExpiration,
      renewalStatus: getRenewalStatus(daysUntilExpiration),
      riskScore: Math.min(98, riskBase + expirationWeight + missingDocuments.length * 4 + (seed % 8)),
      confidenceScore: 58 + (seed % 27),
      aiStatus: contract.autoExtracted ? 'mock_ready' : contract.riskClassification === 'high' ? 'manual_review' : 'mock_pending',
      legalStatus: contract.riskClassification === 'high' ? 'review' : seed % 5 === 0 ? 'pending' : 'approved',
      financialStatus: contract.value <= 0 ? 'blocked' : seed % 4 === 0 ? 'attention' : 'ok',
      approvalRoute: contract.riskClassification === 'high' ? 'Jurídico + Financeiro + Comitê' : 'Jurídico + Gestor responsável',
      owner: contract.responsibleName || OWNERS[seed % OWNERS.length],
      missingDocuments,
      obligations: buildObligations(contract, contract.responsibleName || OWNERS[seed % OWNERS.length], seed, now),
      clauses: buildClauses(contract, seed),
      auditEvents: buildAuditEvents(contract, seed),
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

export function formatCurrencyFull(value: number, currency = 'BRL') {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value || 0);
}
