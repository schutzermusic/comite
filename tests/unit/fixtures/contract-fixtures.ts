/**
 * Fixtures determinísticas do módulo Contratos.
 *
 * Servem à caracterização de P0.3: o enricher atual é semeado por
 * `hash(contract.id + contract.name)`, então contratos fixos + `now` fixo
 * produzem sempre os mesmos números. É isso que permite travar o comportamento
 * de hoje e detectar qualquer mudança numérica introduzida pelo Trust Layer.
 *
 * Sem JSX e sem I/O: roda no vitest `environment: 'node'`.
 */

import type { Contract, Project, User } from '@/lib/types';

/**
 * Ambas as páginas de Contratos passam `disableProjectAutoMatch: true` ao
 * enricher (`page.tsx:150`, `[id]/page.tsx:111`) para desligar o fallback
 * `projects[seed % projects.length]` de `resolveProject`, que atribuiria um
 * projeto ARBITRÁRIO a qualquer contrato sem vínculo. As fixtures reproduzem o
 * uso real do app; o fallback dormente é caracterizado à parte.
 */
type ContractFixture = Contract & { disableProjectAutoMatch?: boolean };

/** Instante congelado de referência para toda a suíte de contratos. */
export const FIXED_NOW = new Date('2026-08-18T12:00:00.000Z');

const user = (id: string, name: string): User =>
  ({ id, nome: name, email: `${id}@insight.test`, cargo: 'Gestor' } as unknown as User);

export const PROJECT_CEMIG: Project = {
  id: 'proj-cemig-01',
  nome: 'Modernização UHE Salto Grande',
  codigo: 'CEMIG - 2450.07/2024',
  cliente: 'CEMIG',
  status: 'em_andamento',
  responsavel: user('u-1', 'João Silva'),
  impacto_financeiro: 'alto',
  valor_total: 1_200_000,
  valor_executado: 300_000,
  progresso_percentual: 25,
  codigoInterno: 'CEMIG - 2450.07/2024',
  comiteResponsavel: 'Comitê de Governança',
};

export const PROJECTS: Project[] = [PROJECT_CEMIG];

/**
 * Três contratos cobrindo os eixos que mudam o cálculo:
 * risco alto/médio/baixo, com e sem arquivo, com e sem data de expiração,
 * e um com valor zero (para provar que 0 é um valor medido válido).
 */
export const CONTRACT_HIGH_RISK: ContractFixture = {
  id: 'ctr-0000000042ace9',
  name: 'Contrato de Serviços — Fornecedor QA Ltda.',
  vendorOrParty: 'QA Contract Services',
  value: 1_200_000,
  currency: 'BRL',
  signingDate: new Date('2026-05-13T00:00:00.000Z'),
  expirationDate: new Date('2027-05-13T00:00:00.000Z'),
  fileUrl: 'https://example.test/ctr-42ace9.pdf',
  fileName: 'ctr-42ace9.pdf',
  riskClassification: 'high',
  status: 'active',
  uploadedAt: new Date('2026-05-14T09:00:00.000Z'),
  responsibleName: 'João Silva',
  autoExtracted: false,
  disableProjectAutoMatch: true,
};

export const CONTRACT_MEDIUM_RISK: ContractFixture = {
  id: 'ctr-0000000058021b',
  name: 'Fornecimento de Equipamentos ENEL',
  vendorOrParty: 'ENEL Distribuição',
  value: 480_000,
  currency: 'BRL',
  signingDate: new Date('2026-02-01T00:00:00.000Z'),
  expirationDate: new Date('2026-09-30T00:00:00.000Z'),
  fileUrl: '',
  riskClassification: 'medium',
  status: 'active',
  uploadedAt: new Date('2026-02-02T09:00:00.000Z'),
  responsibleName: 'Maria Santos',
  autoExtracted: true,
  disableProjectAutoMatch: true,
};

/** Valor zero: existe para provar que `0` apurado ≠ ausência de dado. */
export const CONTRACT_ZERO_VALUE: ContractFixture = {
  id: 'ctr-0000000069b85f',
  name: 'Ordem de Serviço OS 1042 — sem valor',
  vendorOrParty: 'ELETRONORTE',
  value: 0,
  currency: 'BRL',
  fileUrl: '',
  riskClassification: 'low',
  status: 'negotiation',
  uploadedAt: new Date('2026-07-01T09:00:00.000Z'),
  autoExtracted: false,
  disableProjectAutoMatch: true,
};

export const CONTRACTS: ContractFixture[] = [
  CONTRACT_HIGH_RISK,
  CONTRACT_MEDIUM_RISK,
  CONTRACT_ZERO_VALUE,
];
