/**
 * O status de ciclo de vida de um projeto — inclusive quando ele não existe.
 *
 * Um projeto REAL derrubou a carteira inteira: `status === undefined` chegou a
 * `formatStatus`, que chamava `.replace()` sem perguntar, e o TypeError levou
 * junto todos os outros projetos da tela. O defeito não foi o dado — foi a
 * presunção de que todo projeto persistido já teve seu ciclo operacional
 * configurado.
 *
 * Ele pode não ter tido. Um projeto criado a partir do onboarding de contrato
 * existe legitimamente antes de alguém decidir em que fase ele está, e essa
 * decisão é humana. Por isso a regra deste módulo:
 *
 *   **ausência permanece ausência.**
 *
 * Nada aqui escolhe `planejamento` para tapar o buraco. Inventar fase de ciclo
 * de vida é inventar verdade operacional — mais caro que a tela quebrada, e
 * muito mais difícil de descobrir depois, porque parece um dado.
 *
 * Também não normaliza nem grava nada: o valor persistido segue exatamente
 * como está. Este módulo só decide COMO APRESENTAR o que já existe.
 *
 * Puro, sem JSX — o vitest deste repositório roda em `node`.
 */

/** As fases canônicas do ciclo. O que o banco guarda, e só isso. */
export const PROJECT_STATUS_VALUES = [
  'planejamento', 'em_andamento', 'pausado', 'concluido', 'cancelado',
] as const;

export type ProjectStatus = (typeof PROJECT_STATUS_VALUES)[number];

/**
 * O status como o read model REALMENTE pode entregá-lo.
 *
 * `null`/`undefined` não são defeito de tipagem a esconder com `as string`:
 * são o estado de um projeto cujo ciclo ainda não foi configurado.
 */
export type ProjectStatusValue = ProjectStatus | null | undefined;

export const PROJECT_STATUS_LABELS: Readonly<Record<ProjectStatus, string>> = {
  planejamento: 'Planejamento',
  em_andamento: 'Em andamento',
  pausado: 'Pausado',
  concluido: 'Concluído',
  cancelado: 'Cancelado',
};

/** O que a tela diz quando ninguém configurou o ciclo ainda. */
export const PROJECT_STATUS_MISSING_LABEL = 'Status não informado';

export type ProjectStatusVariant = 'active' | 'completed' | 'warning' | 'error' | 'neutral';

const VARIANTS: Readonly<Record<ProjectStatus, ProjectStatusVariant>> = {
  em_andamento: 'active',
  concluido: 'completed',
  pausado: 'warning',
  cancelado: 'error',
  planejamento: 'neutral',
};

/** Cor de destaque do cartão. O cinza é o mesmo neutro que `planejamento` usa. */
const ACCENTS: Readonly<Record<ProjectStatus, string>> = {
  em_andamento: '#10B981',
  concluido: '#22D3EE',
  pausado: '#F59E0B',
  cancelado: '#EF4444',
  planejamento: '#94A3B8',
};

export const PROJECT_STATUS_NEUTRAL_ACCENT = '#94A3B8';

/** O valor é uma das fases canônicas? Estreita o tipo, não o corrige. */
export function isProjectStatus(value: unknown): value is ProjectStatus {
  return typeof value === 'string'
    && (PROJECT_STATUS_VALUES as readonly string[]).includes(value);
}

/**
 * Há status configurado?
 *
 * String vazia conta como ausência: `''` nunca foi uma fase, é o mesmo "não
 * preenchido" que `null` — e tratá-la como valor produziria uma pílula vazia.
 */
export function hasProjectStatus(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Rótulo do status, seguro para QUALQUER entrada.
 *
 * Contrato: nunca lança. Aceita string, `null`, `undefined` e `''`, e um valor
 * futuro que este código ainda não conhece — que é exibido de forma legível em
 * vez de virar "Status não informado", porque ele EXISTE: dizer que não há
 * status sobre um projeto que tem um seria a mesma classe de mentira que
 * inventar a fase.
 */
export function formatProjectStatus(value: unknown): string {
  if (!hasProjectStatus(value)) return PROJECT_STATUS_MISSING_LABEL;
  const text = (value as string).trim();
  if (isProjectStatus(text)) return PROJECT_STATUS_LABELS[text];
  // Desconhecido: apresenta o que está gravado, sem afirmar significado.
  return text.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/** Tom da pílula. Ausente e desconhecido são NEUTROS — nenhum deles é um estado bom ou ruim. */
export function projectStatusVariant(value: unknown): ProjectStatusVariant {
  return isProjectStatus(typeof value === 'string' ? value.trim() : value)
    ? VARIANTS[(value as string).trim() as ProjectStatus]
    : 'neutral';
}

/** Cor de destaque. Ausente e desconhecido caem no neutro já existente. */
export function projectStatusAccent(value: unknown): string {
  return isProjectStatus(typeof value === 'string' ? value.trim() : value)
    ? ACCENTS[(value as string).trim() as ProjectStatus]
    : PROJECT_STATUS_NEUTRAL_ACCENT;
}

/**
 * O projeto está NESTA fase?
 *
 * Existe para que contador e filtro nunca perguntem `p.status === 'concluido'`
 * sobre um status ausente e recebam uma resposta acidental. Ausente não entra
 * em bucket nenhum — fica fora dos contadores por fase, e visível em "todos".
 */
export function isProjectInStatus(value: unknown, status: ProjectStatus): boolean {
  return hasProjectStatus(value) && (value as string).trim() === status;
}
