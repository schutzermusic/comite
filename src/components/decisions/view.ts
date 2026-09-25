/**
 * DECISÕES — regras de TELA em código puro (sem React, sem CSS).
 *
 * O que a pessoa pode decidir, em que ordem e com que efeito vem pronto do
 * servidor (240 + `lib/decisions/model`). Aqui só se decide COMO mostrar:
 * filtro, rótulo, texto do selo, o que a confirmação exige antes de liberar
 * o botão e como ler a resposta do ato. Nada daqui grava estado de decisão.
 */
import { TZ, date, dateTime, money, plural, relativeDue, todayIso } from '@/components/ax/format';
import {
  ACTION_LABEL, OUTCOME_STATUS, STATUS_LABEL, categoryLabel, effectiveDeadline, staleMessage,
} from '@/lib/decisions/model';
import type {
  Bottleneck, ChainNode, CompletedItem, ContextLine, DecisionAccess, DecisionAction, DecisionActResponse, DecisionDetail,
  DecisionItem, DecisionStatus, DecisionTone, DecisionsTab, DecisionsWorkspace, Fact, PersonRef, QuoteOption, ResolvedDecision,
  TeamItem, TeamScope,
} from '@/lib/decisions/types';

// ---------------------------------------------------------------------------
// Endereço (abas e filtros na URL)
// ---------------------------------------------------------------------------

export const TABS: readonly DecisionsTab[] = ['minhas', 'equipe', 'concluidas'];

/** Valor de URL desconhecido cai em "Minhas"; "Equipe" sem visão de equipe também. */
export function normalizeTab(raw: string | null | undefined, teamScope?: TeamScope | null): DecisionsTab {
  const tab = (TABS as readonly string[]).includes(raw ?? '') ? (raw as DecisionsTab) : 'minhas';
  return tab === 'equipe' && teamScope === 'NONE' ? 'minhas' : tab;
}

/** Os atalhos da faixa de sinais: cada número é um filtro da fila. */
export type MineFilter = 'todos' | 'vencidas' | 'escaladas' | 'alcada';
const FILTERS: readonly MineFilter[] = ['todos', 'vencidas', 'escaladas', 'alcada'];
export const normalizeFilter = (raw: string | null | undefined): MineFilter =>
  (FILTERS as readonly string[]).includes(raw ?? '') ? (raw as MineFilter) : 'todos';

export const ALL_CATEGORIES = 'todas';

export function tabsFor(ws: Pick<DecisionsWorkspace, 'teamScope' | 'counts'>): Array<{ id: DecisionsTab; label: string; count?: number; tone?: 'danger' | 'warning' }> {
  return [
    { id: 'minhas', label: 'Minhas', count: ws.counts.mine, tone: ws.counts.overdue > 0 ? 'danger' : ws.counts.mine > 0 ? 'warning' : undefined },
    ...(ws.teamScope !== 'NONE' ? [{ id: 'equipe' as const, label: 'Equipe' }] : []),
    { id: 'concluidas', label: 'Concluídas' },
  ];
}

export const SCOPE_LABEL: Record<TeamScope, string> = {
  ORGANIZATION: 'Toda a organização', DIRECT_REPORTS: 'Seus liderados diretos', NONE: 'Sem visão de equipe',
};

// ---------------------------------------------------------------------------
// Números
// ---------------------------------------------------------------------------

/** O valor em jogo: grande, em reais, sem centavos quando é inteiro (R$ 500.000, não R$ 500.000,00). */
export function amountText(amount: number | null | undefined, currency?: string | null): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return '—';
  return money(amount, currency || 'BRL', { cents: !Number.isInteger(amount) });
}

/** Data e hora completas de São Paulo ("12/09/2026, 14:32") — trilha de auditoria pede o ano. */
export function fullDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  if (value.length === 10) return date(value);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);
}

/** Valor da visão de equipe: o que a pessoa não pode ver é "Restrito" — nunca zero. */
export function teamAmountText(item: Pick<TeamItem, 'amount' | 'amountRestricted' | 'currency'>): string {
  if (item.amountRestricted) return 'Restrito';
  return item.amount === null ? 'Sem valor' : amountText(item.amount, item.currency);
}

// ---------------------------------------------------------------------------
// Selo (sidebar e cabeçalho)
// ---------------------------------------------------------------------------

/** Só um inteiro ≥ 0 conta; qualquer outra resposta é "não sei" (o selo mantém o último número). */
export function parseBadgeCount(body: unknown): number | null {
  if (!body || typeof body !== 'object') return null;
  const n = (body as { count?: unknown }).count;
  const v = typeof n === 'string' && n.trim() !== '' ? Number(n) : n;
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null;
}

export const badgeText = (count: number) => (count > 99 ? '99+' : String(count));

export const decisionsBadgeTitle = (count: number) =>
  count === 1 ? '1 decisão aguardando você' : `${count.toLocaleString('pt-BR')} decisões aguardando você`;

/** Nome acessível do atalho do cabeçalho — o número é dito, não só pintado. */
export function headerLinkLabel(count: number): string {
  if (count <= 0) return 'Decisões: nenhuma pendente';
  return `Decisões: ${count.toLocaleString('pt-BR')} ${count === 1 ? 'pendente' : 'pendentes'}`;
}

// ---------------------------------------------------------------------------
// Cabeçalho e faixa de sinais
// ---------------------------------------------------------------------------

export function contextParts(counts: DecisionsWorkspace['counts']): Array<{ text: string; tone?: 'danger' }> {
  if (counts.mine === 0) return [{ text: 'Nada aguardando você' }];
  const out: Array<{ text: string; tone?: 'danger' }> = [{ text: `${counts.mine.toLocaleString('pt-BR')} aguardando você` }];
  if (counts.overdue > 0) out.push({ text: plural(counts.overdue, 'vencida', 'vencidas'), tone: 'danger' });
  return out;
}

export function signalCounts(ws: Pick<DecisionsWorkspace, 'mine' | 'counts'>) {
  return {
    waiting: ws.counts.mine,
    overdue: ws.counts.overdue,
    escalated: ws.mine.filter((i) => i.assignment === 'ESCALATED').length,
    eligible: ws.counts.alsoEligible,
  };
}

// ---------------------------------------------------------------------------
// Filtros
// ---------------------------------------------------------------------------

export function byCategory<T extends { category: string }>(items: T[], cat: string): T[] {
  return cat === ALL_CATEGORIES ? items : items.filter((i) => i.category === cat);
}

/**
 * "Todas" + só as categorias PRESENTES na lista corrente (com a contagem
 * dela). O rótulo vem do servidor; a categoria escolhida continua visível
 * mesmo sem item — senão não haveria como desmarcá-la.
 */
export function categoryOptions(categories: DecisionsWorkspace['categories'], items: Array<{ category: string }>, selected = ALL_CATEGORIES) {
  const counts = new Map<string, number>();
  for (const i of items) counts.set(i.category, (counts.get(i.category) ?? 0) + 1);
  const labels = new Map(categories.map((c) => [c.id, c.label]));
  const ids = Array.from(new Set([...categories.map((c) => c.id), ...counts.keys()]))
    .filter((id) => (counts.get(id) ?? 0) > 0 || id === selected)
    .filter((id) => id !== ALL_CATEGORIES);
  return [
    { id: ALL_CATEGORIES, label: 'Todas', count: items.length },
    ...ids.map((id) => ({ id, label: labels.get(id) ?? categoryLabel(id), count: counts.get(id) ?? 0 })),
  ];
}

export interface MineView { items: DecisionItem[]; eligible: DecisionItem[]; title: string; subtitle: string; emptyTitle: string; emptyText: string }

/** O que a aba "Minhas" mostra para o atalho escolhido. A ordem é a do servidor — aqui só se filtra. */
export function mineView(ws: Pick<DecisionsWorkspace, 'mine' | 'alsoEligible'>, f: MineFilter, cat: string): MineView {
  const mine = byCategory(ws.mine, cat);
  const empty = { emptyTitle: 'Nenhuma decisão neste filtro.', emptyText: 'Limpe o filtro para ver a fila inteira.' };
  switch (f) {
    case 'vencidas':
      return { items: mine.filter((i) => i.overdue), eligible: [], title: 'Vencidas', ...empty,
        subtitle: 'O prazo de decisão passou. A decisão continua aberta até alguém com alçada decidir.' };
    case 'escaladas':
      return { items: mine.filter((i) => i.assignment === 'ESCALATED'), eligible: [], title: 'Escaladas para você', ...empty,
        subtitle: 'Venceram na faixa de alçada primária e chegaram à sua.' };
    case 'alcada':
      return { items: byCategory(ws.alsoEligible, cat), eligible: [], title: 'Sob sua alçada', ...empty,
        subtitle: 'Você tem alçada para decidir, mas a decisão é de outra faixa.' };
    default:
      return { items: mine, eligible: byCategory(ws.alsoEligible, cat), title: 'Aguardando você',
        subtitle: 'Na ordem da fila: vencidas, impacto crítico, prazo mais próximo, valor e as demais.',
        emptyTitle: 'Nenhuma decisão pendente.', emptyText: 'O Apex mostrará aqui situações que exigem sua autoridade ou julgamento.' };
  }
}

// ---------------------------------------------------------------------------
// Linhas da fila
// ---------------------------------------------------------------------------

/**
 * As linhas de contexto do cartão; o projeto entra se o servidor não o trouxe
 * como linha. "Solicitado por" sai daqui: o rodapé do cartão já diz quem e
 * quando — a mesma informação duas vezes é ruído.
 */
export function rowContext(item: Pick<DecisionItem, 'context' | 'projectName'>): ContextLine[] {
  const lines = item.context.filter((l) => l.label !== 'Solicitado por');
  if (item.projectName && !lines.some((l) => l.label === 'Projeto')) lines.unshift({ label: 'Projeto', value: item.projectName });
  return lines;
}

/**
 * O DIA de São Paulo de um instante. `relativeDue` compara dias de calendário:
 * um instante UTC depois das 21 h de Brasília já é "amanhã" em UTC, e o
 * pedido de hoje apareceria como "amanhã".
 */
export function localDay(value: string): string {
  return value.length <= 10 ? value : todayIso(new Date(value));
}

export function requesterText(by: PersonRef | null, at: string | null, today: string): string | null {
  if (!by?.name && !at) return null;
  const when = at ? relativeDue(localDay(at), today).text : null;
  return [by?.name ? `Solicitado por ${by.name}` : 'Solicitado', when].filter(Boolean).join(' · ');
}

export function waitingText(days: number | null): string | null {
  if (days === null || days < 0) return null;
  return days === 0 ? 'desde hoje' : `há ${plural(days, 'dia', 'dias')}`;
}

/** "Aguardando sua decisão" só para quem decide; para os outros, a mesma situação sem o "sua". */
export function statusLabelFor(status: DecisionStatus, viewerDecides: boolean): string {
  if (status === 'PENDENTE' && !viewerDecides) return 'Aguardando decisão';
  return STATUS_LABEL[status];
}

const OWNER_MARK: Record<string, string> = { PRIMARY: '', ESCALATED: ' (escalada)', ELIGIBLE: ' (alçada)' };
export function ownersText(owners: TeamItem['owners']): { text: string; none: boolean } {
  if (!owners.length) return { text: 'Sem decisor elegível', none: true };
  return { text: owners.map((o) => `${o.name ?? 'Pessoa sem nome'}${OWNER_MARK[o.assignment] ?? ''}`).join(' · '), none: false };
}

/** Quem trava mais primeiro: sem decisor, depois vencidas, espera mais longa, volume. */
export function sortBottlenecks(list: Bottleneck[]): Bottleneck[] {
  return [...list].sort((a, b) => Number(b.owner === null) - Number(a.owner === null)
    || b.overdue - a.overdue
    || (b.oldestWaitingDays ?? -1) - (a.oldestWaitingDays ?? -1)
    || b.open - a.open);
}

export const COMPLETED_ROLE_LABEL: Record<CompletedItem['viewerRole'], string> = { DECIDER: 'Você decidiu', REQUESTER: 'Você solicitou' };

/** "Aprovada por Ana Souza em 12/09/2026" — quem, o quê, quando. */
export function outcomeLine(status: DecisionStatus, by: PersonRef | null, at: string | null): string {
  return `${STATUS_LABEL[status]}${by?.name ? ` por ${by.name}` : ''}${at ? ` em ${date(at)}` : ''}`;
}
export const completedStatus = (c: Pick<CompletedItem, 'status' | 'outcome'>): DecisionStatus => c.status ?? OUTCOME_STATUS[c.outcome];

export function sourceLabelFor(href: string): string {
  if (href.startsWith('/supply')) return 'Ver em Compras';
  if (href.startsWith('/contratos')) return 'Ver em Contratos';
  return 'Ver no contexto original';
}

/** O que está em jogo na fila — só soma do que está na tela, por moeda; nada estimado. */
export function mineSummary(items: DecisionItem[]) {
  const totals = new Map<string, number>();
  for (const i of items) if (i.amount !== null) totals.set(i.currency || 'BRL', (totals.get(i.currency || 'BRL') ?? 0) + i.amount);
  const deadlines = items.map((i) => effectiveDeadline(i)).filter((d): d is string => Boolean(d)).sort();
  const requested = items.map((i) => i.requestedAt).filter((d): d is string => Boolean(d)).map(localDay).sort();
  return {
    totals: Array.from(totals, ([currency, amount]) => ({ currency, amount })),
    nextDeadline: deadlines[0] ?? null,
    oldestRequest: requested[0] ?? null,
    projects: new Set(items.map((i) => i.projectId).filter(Boolean)).size,
  };
}

// ---------------------------------------------------------------------------
// Detalhe
// ---------------------------------------------------------------------------

export const ACCESS_LABEL: Record<DecisionAccess, string> = {
  DECIDER: 'Você decide', ELIGIBLE: 'Sob sua alçada', PARTICIPANT: 'Você participou', SOURCE_READER: 'Leitura da origem', TEAM: 'Visão de equipe',
};

/** Por que não há botão — dito, para ninguém procurar o ato que não existe. */
export function accessNote(detail: Pick<DecisionDetail, 'access' | 'canAct'> & { resolved: Pick<ResolvedDecision, 'open'> }): string | null {
  if (!detail.resolved.open || detail.canAct) return null;
  switch (detail.access) {
    case 'TEAM': return 'Você acompanha esta decisão pela visão de equipe. Decidir cabe a quem tem a alçada.';
    case 'SOURCE_READER': return 'Você vê esta decisão porque lê o registro de origem. Decidir cabe a quem tem a alçada.';
    case 'PARTICIPANT': return 'Você participa desta decisão, mas o próximo ato não é seu.';
    default: return 'Nenhum ato está disponível para você nesta decisão agora.';
  }
}

/**
 * RESUMO: fatos do objeto de origem (com proveniência) + o que a caixa já
 * sabe. Um rótulo aparece uma vez só — o fato do servidor não é repetido.
 */
/**
 * O RESUMO do detalhe: só o que se decide — projeto, necessidade, fornecedor,
 * data da necessidade. Prazo de decisão e solicitante já estão no topo, e a
 * nota da submissão tem bloco próprio; nada aparece duas vezes.
 */
const HEADLINE_LABELS = new Set(['Decidir até', 'Solicitado por', 'Submetido por', 'Nota da submissão']);
export function summaryFacts(detail: Pick<DecisionDetail, 'facts' | 'item' | 'resolved'>): Fact[] {
  const out = new Map<string, Fact>();
  const put = (f: Fact | null) => { if (f && f.value && !out.has(f.label) && !HEADLINE_LABELS.has(f.label)) out.set(f.label, f); };
  const item = detail.item;
  put(item?.projectName ? { label: 'Projeto', value: item.projectName } : null);
  for (const c of item?.context ?? []) put({ label: c.label, value: c.value });
  put(item?.needBy ? { label: 'Necessário até', value: date(item.needBy) } : null);
  if (!item) {
    // Decisão encerrada ou aberta por outra qualidade: o resumo vem dos fatos da origem.
    for (const f of detail.facts.slice(0, 5)) put(f);
  }
  return Array.from(out.values());
}

/**
 * DADOS DA ORIGEM (recolhidos): o registro completo como a fonte o guarda —
 * pedido, governança, valores, entrega, quem submeteu. Sem repetir o resumo.
 */
export function sourceFacts(detail: Pick<DecisionDetail, 'facts' | 'item' | 'resolved'>): Fact[] {
  const shown = new Set(summaryFacts(detail).map((f) => f.label));
  const r = detail.resolved;
  const facts = detail.facts.filter((f) => f.value && !shown.has(f.label) && f.label !== 'Nota da submissão');
  if (r.requestedAt && !facts.some((f) => f.label === 'Submetido por' || f.label === 'Solicitado por')) {
    facts.push({ label: 'Solicitado por', value: [r.requestedBy?.name, dateTime(r.requestedAt)].filter(Boolean).join(' · ') });
  }
  return facts;
}

export function chainView(nodes: ChainNode[]): Array<{ label: string; detail: string | null; href: string | null; missing: boolean }> {
  return nodes.map((n) => ({ label: n.label, detail: n.missing ? 'sem vínculo registrado' : n.detail ?? null, href: n.missing ? null : n.href ?? null, missing: Boolean(n.missing) }));
}

/** Escolhido primeiro, depois o recomendado, depois o menor custo. */
export function sortOptions(options: QuoteOption[]): QuoteOption[] {
  return [...options].sort((a, b) => Number(b.chosen) - Number(a.chosen) || Number(b.recommended) - Number(a.recommended) || a.landed - b.landed);
}

export function verdictTone(o: Pick<QuoteOption, 'lateDays'>): DecisionTone {
  if (o.lateDays === null) return 'neutral';
  return o.lateDays > 0 ? 'danger' : 'success';
}

export const CHANNEL_LABEL: Record<string, string> = { in_app: 'No Apex', email: 'E-mail', whatsapp: 'WhatsApp' };
export const NOTICE_KIND_LABEL: Record<string, string> = {
  NEW: 'Nova decisão', DUE_SOON: 'Prazo próximo', OVERDUE: 'Vencida', ESCALATED: 'Escalada', RESOLVED: 'Encerrada', ADJUSTMENT_REQUESTED: 'Ajuste solicitado',
};
export function deliveryTone(state: string): DecisionTone {
  switch (state) {
    case 'DELIVERED': return 'success';
    case 'FAILED': return 'danger';
    case 'PENDING': return 'warning';
    case 'SIMULATED': return 'info';
    default: return 'neutral';
  }
}

// ---------------------------------------------------------------------------
// Atos governados
// ---------------------------------------------------------------------------

/** Aprovar (principal), Solicitar ajuste (secundário), Rejeitar (perigo) — só os que a fonte oferece. */
const ACTION_ORDER: DecisionAction[] = ['APPROVE', 'REQUEST_ADJUSTMENT', 'REJECT'];
export function orderedActions(actions: DecisionAction[]): DecisionAction[] {
  return ACTION_ORDER.filter((a) => actions.includes(a));
}
export const ACTION_BUTTON_CLASS: Record<DecisionAction, string> = {
  APPROVE: 'ax-btn primary', REQUEST_ADJUSTMENT: 'ax-btn', REJECT: 'ax-btn danger-soft',
};
export const CONFIRM_TITLE: Record<DecisionAction, string> = {
  APPROVE: 'Confirmar aprovação', REQUEST_ADJUSTMENT: 'Confirmar pedido de ajuste', REJECT: 'Confirmar rejeição',
};
export const ACTION_DONE: Record<DecisionAction, string> = {
  APPROVE: 'Aprovação registrada', REQUEST_ADJUSTMENT: 'Ajuste solicitado', REJECT: 'Rejeição registrada',
};
const ACTION_VERB: Record<DecisionAction, string> = { APPROVE: 'aprovar', REQUEST_ADJUSTMENT: 'solicitar ajuste', REJECT: 'rejeitar' };

/** Mínimo de uma justificativa obrigatória (o mesmo piso da nota de compra). */
export const REASON_MIN = 3;
export const REASON_MAX = 1000; // o mesmo teto do servidor (decisionActSchema)

/**
 * O que a confirmação exige. Obrigatória → o botão fica travado, com o
 * motivo dito, até haver justificativa; opcional → nunca trava.
 */
export function confirmState(action: DecisionAction, reasonRequired: DecisionAction[], reason: string) {
  const required = reasonRequired.includes(action);
  const len = reason.trim().length;
  const canConfirm = !required || len >= REASON_MIN;
  let hint: string;
  if (!required) hint = 'Opcional. Se preenchida, fica registrada na decisão.';
  else if (len === 0) hint = `A justificativa é obrigatória para ${ACTION_VERB[action]}. Ela fica registrada na decisão e volta para quem solicitou.`;
  else if (len < REASON_MIN) hint = `Escreva pelo menos ${REASON_MIN} caracteres.`;
  else hint = 'A justificativa fica registrada na decisão e volta para quem solicitou.';
  return { required, canConfirm, hint, label: `${ACTION_LABEL[action]}` };
}

export type ActVerdict =
  | { kind: 'done'; replay: boolean; message: string; downstreamPending: boolean }
  | { kind: 'stale'; message: string }
  | { kind: 'forbidden'; message: string }
  | { kind: 'invalid'; message: string }
  | { kind: 'error'; message: string };

export const NETWORK_MESSAGE = 'Sem conexão: o servidor não confirmou o ato. Tente de novo — a repetição é a mesma intenção e não duplica a decisão.';

/**
 * A resposta do ato, lida do jeito que a tela precisa agir:
 *   done       registrado (ou já estava — mesma intenção);
 *   stale      a decisão mudou/fechou: mostrar, recarregar, sem erro;
 *   forbidden  sem alçada/sessão: mostrar, nada foi gravado;
 *   invalid    recusado na validação: fica no diálogo para corrigir;
 *   error      incerto (5xx/rede): repetir com a MESMA intenção.
 */
export function interpretActResponse(status: number, raw: unknown): ActVerdict {
  const body = (raw && typeof raw === 'object' ? raw : {}) as Partial<DecisionActResponse> & { code?: string; error?: string };
  const said = [body.message, body.error].find((s): s is string => typeof s === 'string' && s.trim().length > 0)?.trim() ?? null;
  if (status === 409 || status === 404 || body.code === 'STALE' || body.outcome === 'STALE') {
    return { kind: 'stale', message: said ?? staleMessage(body.resolved ?? null) };
  }
  if (status >= 200 && status < 300) {
    const replay = body.outcome === 'IDEMPOTENT_REPLAY';
    return { kind: 'done', replay, downstreamPending: Boolean(body.downstream && !body.downstream.applied),
      message: said ?? (replay ? 'Já estava registrado — nada foi duplicado.' : 'Decisão registrada.') };
  }
  if (status === 401) return { kind: 'forbidden', message: 'Sua sessão expirou. Entre de novo para decidir — nada foi alterado.' };
  if (status === 403) return { kind: 'forbidden', message: said ?? 'Você não tem alçada para este ato. Nada foi alterado.' };
  if (status === 400 || status === 422) return { kind: 'invalid', message: said ?? 'O ato foi recusado. Revise a justificativa e tente de novo.' };
  return { kind: 'error', message: said ?? 'O servidor não confirmou o ato. Tente de novo — a repetição é a mesma intenção e não duplica a decisão.' };
}

/** Uma intenção por abertura da confirmação (UUID v4). */
export function newIntentId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b); else for (let i = 0; i < 16; i += 1) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
