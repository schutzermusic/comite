/**
 * A NAVEGAÇÃO ENTRE OS MÓDULOS, num lugar só.
 *
 * ─── Por que isto não é um punhado de template strings espalhadas ──────────
 *
 * Porque o mesmo marco é olhado de quatro telas — contexto contratual,
 * cronograma, medição e documentos — e cada uma precisa levar às outras três.
 * Doze links escritos à mão divergem na primeira vez que um parâmetro muda de
 * nome, e o sintoma é sempre o mesmo: a pessoa chega na aba certa com o marco
 * errado selecionado, ou sem seleção nenhuma.
 *
 * O parâmetro `milestone` carrega a IDENTIDADE CANÔNICA — `contract_milestones.id`
 * — e não um índice de lista, um número de evento nem uma chave derivada do
 * título. É o mesmo id em Contratos, no Gantt, na medição e no documento.
 */

/** O parâmetro de seleção compartilhado por todas as abas de Projetos. */
export const MILESTONE_PARAM = 'milestone';

export type ProjectTab =
  | 'timeline' | 'contract' | 'measurements' | 'finance'
  | 'risks' | 'documents' | 'team' | 'timesheet';

function projectHref(projectId: string, tab: ProjectTab, milestoneId?: string | null): string {
  const base = `/projetos/${projectId}?tab=${tab}`;
  return milestoneId ? `${base}&${MILESTONE_PARAM}=${encodeURIComponent(milestoneId)}` : base;
}

/** "Ver no cronograma" — o Gantt, com o evento de medição em foco. */
export const timelineHref = (projectId: string, milestoneId?: string | null) =>
  projectHref(projectId, 'timeline', milestoneId);

/** "Ver medição" — a bancada operacional do marco. */
export const measurementHref = (projectId: string, milestoneId?: string | null) =>
  projectHref(projectId, 'measurements', milestoneId);

/** "Ver contexto contratual" — o que do contrato afeta este projeto. */
export const contractContextHref = (projectId: string, milestoneId?: string | null) =>
  projectHref(projectId, 'contract', milestoneId);

/** "Ver documentos" — o acervo, filtrado pelo marco. */
export const documentsHref = (projectId: string, milestoneId?: string | null) =>
  projectHref(projectId, 'documents', milestoneId);

/** "Abrir em Contratos" — o instrumento, onde ele é dono da verdade. */
export const contractHref = (contractId: string) => `/contratos/${contractId}`;

/** "Ver faturamento" — a carteira de Contratos, nunca um faturamento local. */
export const contractBillingHref = (contractId: string) => `/contratos/${contractId}?tab=finance`;
