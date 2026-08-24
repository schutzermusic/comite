/**
 * Vocabulário de categorias de cláusula — isomórfico.
 *
 * Vive fora de `src/lib/ai/contract-clause-extractor.ts` de propósito: aquele
 * módulo é server-only e LANÇA se for importado no browser (guarda de runtime,
 * como o risk-scanner). Um componente de cliente que precisasse só do rótulo
 * derrubaria a página inteira no import.
 *
 * Sem JSX e sem I/O: serve ao extrator, aos componentes e aos testes.
 */

export const CLAUSE_CATEGORIES = [
  'pagamento',
  'reajuste',
  'sla',
  'penalidade',
  'rescisao',
  'renovacao',
  'garantia',
  'responsabilidade',
  'seguro',
  'compliance',
] as const;

export type ClauseCategory = (typeof CLAUSE_CATEGORIES)[number];

export const CLAUSE_CATEGORY_LABEL: Record<ClauseCategory, string> = {
  pagamento: 'Condições de pagamento',
  reajuste: 'Reajuste e indexação',
  sla: 'SLA e nível de serviço',
  penalidade: 'Penalidades e multas',
  rescisao: 'Rescisão',
  renovacao: 'Renovação e denúncia',
  garantia: 'Garantias',
  responsabilidade: 'Responsabilidade e limitação',
  seguro: 'Seguros',
  compliance: 'Compliance e anticorrupção',
};

export const isClauseCategory = (value: unknown): value is ClauseCategory =>
  typeof value === 'string' && (CLAUSE_CATEGORIES as readonly string[]).includes(value);
