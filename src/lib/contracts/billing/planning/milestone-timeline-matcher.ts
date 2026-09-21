/**
 * CASAMENTO AUTOMÁTICO marco contratual ↔ etapa de cronograma — funções puras.
 *
 * ─── O que este arquivo produz, e o que ele jamais produz ──────────────────
 *
 * Produz PROPOSTAS. Uma proposta é um par (regra contratual, etapa) com um
 * número de confiança e uma explicação do porquê. Nada aqui é verdade, nada
 * aqui mapeia coisa alguma, e a função que persiste
 * (`contract_billing_propose_timeline_mapping`) escreve `system_proposed` /
 * `proposed` como LITERAIS — não há parâmetro capaz de pedir `accepted`.
 *
 * A razão é a §17, e ela é concreta: uma proposta aceita em silêncio vira a
 * data prevista de faturamento de R$ 803.233,98, que vira um alerta por
 * e-mail para o gerente do cliente. O caminho inteiro depende de alguém ter
 * OLHADO o par uma vez.
 *
 * ─── Por que o título sozinho não basta ────────────────────────────────────
 *
 * "Montagem e fechamento do enrolamento estatórico" aparece uma vez no
 * contrato e pode aparecer três vezes num cronograma de obra — como fase, como
 * pacote e como tarefa. Casar por título puro escolheria a primeira e erraria
 * duas em três. Por isso o escore combina quatro sinais independentes, e a
 * AMBIGUIDADE (duas etapas empatadas no topo) derruba a confiança em vez de
 * escolher a primeira.
 *
 * ─── Sobre os limiares ─────────────────────────────────────────────────────
 *
 * Eles moram aqui, declarados, com o motivo ao lado. Não há limiar disperso
 * pelo código, e nenhum deles autoriza aceite automático: o mais alto apenas
 * marca a proposta como "pronta para uma conferência rápida".
 */

import { normalizeTitle } from '@/lib/projects/timeline-import-matcher';

/**
 * PISO DA PROPOSTA. Abaixo disto o par nem é proposto — uma lista de dez
 * palpites ruins custa mais atenção do que lista nenhuma.
 */
export const PROPOSAL_MIN_CONFIDENCE = 0.5;

/**
 * ALTA CONFIANÇA. Acima disto a proposta vai para o topo da fila de revisão,
 * com o rótulo "conferência rápida". Continua sendo proposta: este número
 * decide a ORDEM da fila, nunca o aceite.
 */
export const PROPOSAL_HIGH_CONFIDENCE = 0.8;

/**
 * MARGEM DE DESEMPATE. Quando a segunda melhor etapa está a menos disto da
 * primeira, o par é AMBÍGUO: as duas explicam igualmente bem o marco, e
 * escolher a de cima seria um sorteio com cara de decisão.
 */
export const PROPOSAL_AMBIGUITY_MARGIN = 0.08;

export interface MilestoneCandidate {
  readonly milestoneId: string;
  readonly ruleId: string;
  readonly contractId: string;
  readonly title: string;
  readonly description?: string | null;
  /** Ordem contratual do evento (1..N), quando o marco a carrega no título. */
  readonly sequence?: number | null;
}

export interface TimelineCandidate {
  readonly timelineItemId: string;
  readonly projectId: string;
  readonly title: string;
  readonly wbsCode: string | null;
  readonly outlineLevel: number;
  readonly isMilestone: boolean;
  readonly isSummary: boolean;
  readonly plannedFinish: string | null;
  readonly forecastFinish: string | null;
  /** Título do pai na EDT — o contexto de fase. */
  readonly parentTitle?: string | null;
}

export type ProposalReviewPriority = 'quick_review' | 'requires_attention';

export interface MappingProposal {
  readonly milestoneId: string;
  readonly ruleId: string;
  readonly contractId: string;
  readonly projectId: string;
  readonly timelineItemId: string;
  readonly confidence: number;
  readonly priority: ProposalReviewPriority;
  /** Por que o sistema sugeriu — em português, para a tela de revisão. */
  readonly reasons: readonly string[];
  readonly ambiguousWith: readonly string[];
}

// ───────────────────────────────────────────────────────────────────────────
// SINAIS
// ───────────────────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  'de', 'do', 'da', 'dos', 'das', 'e', 'em', 'no', 'na', 'nos', 'nas',
  'o', 'a', 'os', 'as', 'para', 'por', 'com', 'ao', 'aos', 'um', 'uma',
]);

function tokens(text: string): string[] {
  return normalizeTitle(text)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

/**
 * Similaridade de Jaccard sobre tokens significativos.
 *
 * Escolhida em vez de distância de edição de propósito: "Montagem e fechamento
 * do enrolamento estatórico" e "Enrolamento estatórico — montagem/fechamento"
 * são a MESMA etapa escrita de duas formas, e a distância de edição entre elas
 * é enorme. O que importa é o vocabulário compartilhado, não a ordem.
 */
export function titleSimilarity(a: string, b: string): number {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return shared / (ta.size + tb.size - shared);
}

/**
 * O PREFIXO DE NUMERAÇÃO do marco, removido antes de comparar vocabulário.
 *
 * Os marcos de JA10182283/2025 nascem como "Evento 02 · No transporte do
 * equipamento para nossa fábrica (CIF)". As palavras "evento" e "02" dizem
 * QUAL parcela é, não O QUE ela é — e o cronograma, que numera por EDT, nunca
 * as repete. Deixá-las no conjunto de tokens não é neutro: elas entram no
 * denominador de Jaccard e derrubam a similaridade de TODOS os marcos do
 * contrato pelo mesmo motivo espúrio.
 *
 * A numeração não é perdida: `extractMilestoneSequence` a lê deste mesmo
 * título e ela volta como `sequence`, ponderada como o indício fraco que é.
 */
export function stripEventPrefix(title: string): string {
  return title.replace(
    /^\s*(?:evento|parcela|etapa|marco)\s*n?[.ºo°]?\s*\d{1,2}\s*(?:[-–—·:.)\]]\s*)?/i,
    '',
  );
}

/**
 * "Evento 03 — Sacar bobinas" → 3. Sem número no título, `null`.
 *
 * Mora aqui, e não na rotina de servidor, porque o matcher é quem pondera o
 * sinal e `stripEventPrefix` é quem o remove do texto: as duas leituras do
 * mesmo prefixo precisam concordar, e concordam por serem vizinhas.
 */
export function extractMilestoneSequence(title: string): number | null {
  const match = /\b(?:evento|parcela|etapa|marco)\s*n?[.ºo°]?\s*0?(\d{1,2})\b/i.exec(title);
  return match ? Number(match[1]) : null;
}

/**
 * CONTINÊNCIA: o vocabulário menor cabe inteiro dentro do maior?
 *
 * Jaccard pune o título mais longo, e o cronograma é sistematicamente mais
 * longo que o contrato — ele acrescenta o artefato ("Relatório final
 * (Databook)"), o lote ("1º Lote (50 und.)"), o local. "Relatório final" cabe
 * inteiro em "Relatório final (Databook)" e Jaccard devolve 0,50 para um par
 * que qualquer pessoa lê como o mesmo item.
 *
 * Duas travas, porque continência sozinha casa qualquer coisa:
 *
 *   · pelo menos DOIS tokens significativos dos dois lados. Um título de uma
 *     palavra — "Montagem" — cabe em metade de um cronograma de obra, e
 *     continência 1,0 ali seria um falso positivo com cara de certeza.
 *   · o resultado é AMORTECIDO a 0,85. Caber dentro é indício forte de ser a
 *     mesma coisa; não é a igualdade que Jaccard 1,0 afirma.
 */
const CONTAINMENT_DAMPING = 0.85;

export function titleContainment(a: string, b: string): number {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (ta.size < 2 || tb.size < 2) return 0;
  const [small, large] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  let shared = 0;
  for (const t of small) if (large.has(t)) shared += 1;
  return (shared / small.size) * CONTAINMENT_DAMPING;
}

/**
 * O sinal de TÍTULO: o melhor entre vocabulário compartilhado e continência.
 *
 * Uma função só, para que a descrição do marco e o título do marco passem
 * exatamente pelo mesmo tratamento — inclusive a remoção do prefixo.
 */
function textSignal(milestoneText: string, itemTitle: string): number {
  const clean = stripEventPrefix(milestoneText);
  return Math.max(titleSimilarity(clean, itemTitle), titleContainment(clean, itemTitle));
}

/**
 * O PERFIL DO CRONOGRAMA — a forma que ESTE arquivo tem.
 *
 * ─── Por que o casamento precisa conhecer a forma do cronograma ───────────
 *
 * Alguns planejadores criam um ramo de marcos ("Marcos", "Marcos gerais") com
 * uma linha por evento contratual. Outros não criam nada disso: o evento
 * acontece numa tarefa operacional comum, no meio da obra, no quarto nível da
 * EDT.
 *
 * Um matcher que premia "ser marco formal" e penaliza "ser tarefa profunda"
 * funciona no primeiro caso e falha no segundo — e falha em silêncio, dando
 * escore alto para uma fase genérica de nível 2 em vez da tarefa que
 * realmente representa o gatilho.
 *
 * O perfil torna o sinal de estrutura RELATIVO: num cronograma sem marco
 * nenhum, a tarefa-folha é a única linha que carrega um resultado verificável,
 * e passa a valer o que o marco valeria.
 */
export interface ScheduleProfile {
  /** O cronograma marca marcos? Se não, "ser marco" não é sinal de nada. */
  readonly hasMilestones: boolean;
}

export function profileSchedule(items: readonly TimelineCandidate[]): ScheduleProfile {
  return { hasMilestones: items.some((i) => i.isMilestone) };
}

/** Âncora JÁ ACEITA: um evento do contrato preso a uma data do cronograma. */
export interface AcceptedAnchor {
  readonly sequence: number;
  /** Data da etapa aceita (`YYYY-MM-DD`). */
  readonly date: string;
}

export interface MatchContext {
  readonly profile: ScheduleProfile;
  /**
   * As âncoras que um humano já aceitou, deste mesmo contrato.
   *
   * São elas que deixam o sistema mais autônomo com o tempo: cada aceite
   * estreita a janela em que os eventos vizinhos podem cair.
   */
  readonly anchors: readonly AcceptedAnchor[];
  /** Pares `ruleId::timelineItemId` que um humano recusou. Nunca repropostos. */
  readonly rejected: ReadonlySet<string>;
}

/** Contexto NEUTRO: nenhuma âncora, nenhuma recusa, forma desconhecida. */
export const NEUTRAL_CONTEXT: MatchContext = {
  profile: { hasMilestones: false },
  anchors: [],
  rejected: new Set(),
};

export function buildMatchContext(
  items: readonly TimelineCandidate[],
  anchors: readonly AcceptedAnchor[] = [],
  rejected: ReadonlySet<string> = new Set(),
): MatchContext {
  return { profile: profileSchedule(items), anchors, rejected };
}

/**
 * Sinal de CONTEXTO: esta linha carrega um RESULTADO verificável?
 *
 * ─── O que mudou, e por quê ───────────────────────────────────────────────
 *
 * A versão anterior perguntava pela PROFUNDIDADE na EDT: nível 2 valia 0,7 e
 * nível 4 valia 0,3. Isso embutia uma suposição sobre como o cronograma foi
 * montado — a de que evento contratual mora perto da raiz.
 *
 * Medido no cronograma de referência, "5.3 Ensaios elétricos" (nível 2)
 * ganhava de "5.2.3 Fechamento do enrolamento" (nível 3) só por ser mais
 * raso, embora o fechamento seja exatamente o gatilho do evento. A
 * profundidade não diz nada sobre significado contratual; ela diz como o
 * planejador gosta de organizar pastas.
 *
 * A pergunta certa é outra: esta linha representa um RESULTADO que se pode
 * dar por ocorrido?
 *
 *   marco        — sim, por definição (quando o cronograma usa marcos)
 *   tarefa-folha — sim: tem início, fim e conclusão própria
 *   fase/resumo  — mais fraco: abrange muitos resultados, e "a fase terminou"
 *                  raramente é o gatilho que o contrato descreve
 */
function structureSignal(item: TimelineCandidate, profile: ScheduleProfile): number {
  if (item.isMilestone && profile.hasMilestones) return 1;
  // Resumo continua abaixo da folha: uma fase inteira é um alvo grande demais
  // para um gatilho contratual específico.
  if (item.isSummary) return 0.5;
  // Num cronograma SEM marcos, a tarefa-folha é a única linha que carrega
  // resultado — e vale o que o marco valeria.
  return profile.hasMilestones ? 0.72 : 0.85;
}

/** A etapa tem data? Sem data ela não sustenta previsão de mês nenhuma. */
function dateSignal(item: TimelineCandidate): number {
  return (item.forecastFinish ?? item.plannedFinish) !== null ? 1 : 0;
}

/** Contexto de fase: o vocabulário do marco aparece no pai da EDT? */
function phaseSignal(milestone: MilestoneCandidate, item: TimelineCandidate): number {
  if (!item.parentTitle) return 0;
  return titleSimilarity(stripEventPrefix(milestone.title), item.parentTitle);
}

/**
 * Semântica contratual: a ETAPA se identifica pelo número do evento?
 *
 * ─── Por que a EDT saiu deste sinal ───────────────────────────────────────
 *
 * A versão anterior aceitava qualquer segmento da EDT igual ao número do
 * evento. Num cronograma cujo ramo 5 é "Serviços em campo", TODAS as linhas
 * 5.x casavam com o "Evento 05" — a fase, as vinte tarefas, os ensaios. O
 * sinal ficava uniforme dentro do ramo e enviesado contra todos os outros
 * ramos, sem que ninguém tivesse afirmado relação nenhuma.
 *
 * Cronograma numera por EDT; contrato numera por parcela. As duas numerações
 * coincidirem é coincidência, e coincidência não é indício.
 *
 * O que sobrou é o caso em que o próprio planejador escreveu o vínculo no
 * título — "Evento 03 — Sacar bobinas", "Marco 2: entrega". Aí não há
 * inferência: está escrito.
 */
function sequenceSignal(milestone: MilestoneCandidate, item: TimelineCandidate): number {
  if (!milestone.sequence) return 0;
  return extractMilestoneSequence(item.title) === milestone.sequence ? 1 : 0;
}

/**
 * Sinal de ORDEM: o candidato cai onde este evento caberia na linha do tempo?
 *
 * ─── A ideia, em uma frase ────────────────────────────────────────────────
 *
 * Eventos contratuais acontecem NA ORDEM em que o contrato os lista, e o
 * cronograma é uma linha do tempo. Se o evento 04 já está ancorado em
 * 15/12/2025 e o 06 em 14/08/2026, então o 05 acontece entre os dois — e um
 * candidato fora dessa janela está propondo que a obra aconteça fora de ordem.
 *
 * ─── Por que ele usa SÓ âncoras aceitas ───────────────────────────────────
 *
 * Usar palpites do próprio lote faria o primeiro erro contaminar os vizinhos,
 * e o segundo erro se apoiar no primeiro. As âncoras vêm de mapeamentos que um
 * humano ACEITOU — são fatos, não hipóteses. É também o que torna o sistema
 * mais autônomo com o uso: cada aceite estreita a janela dos eventos ao redor.
 *
 * ─── Ausência de informação devolve NEUTRO ────────────────────────────────
 *
 * Sem âncoras, sem sequência ou sem data, o sinal é 0,5 — nem a favor nem
 * contra. Devolver 0 puniria o candidato por uma informação que não existe, e
 * o primeiro evento de um contrato novo nunca teria vizinho para se apoiar.
 */
const ORDER_NEUTRAL = 0.5;

function orderSignal(
  milestone: MilestoneCandidate,
  item: TimelineCandidate,
  anchors: readonly AcceptedAnchor[],
): number {
  const seq = milestone.sequence;
  const date = item.forecastFinish ?? item.plannedFinish;
  if (!seq || !date || anchors.length === 0) return ORDER_NEUTRAL;

  let lower: string | null = null;
  let upper: string | null = null;
  for (const a of anchors) {
    if (a.sequence === seq) continue;
    if (a.sequence < seq && (lower === null || a.date > lower)) lower = a.date;
    if (a.sequence > seq && (upper === null || a.date < upper)) upper = a.date;
  }
  if (lower === null && upper === null) return ORDER_NEUTRAL;

  const afterLower = lower === null || date >= lower;
  const beforeUpper = upper === null || date <= upper;

  if (afterLower && beforeUpper) return 1;
  // Uma das bordas respeitada ainda é meio sinal: cronogramas se sobrepõem, e
  // um evento pode legitimamente empatar em data com o vizinho.
  if (afterLower || beforeUpper) return 0.35;
  return 0;
}

/**
 * PESOS.
 *
 * O título domina porque é o único sinal que fala do QUE a etapa é. Os outros
 * desempatam, e nenhum deles sozinho chega ao piso de proposta: uma etapa com
 * data, estrutura boa e ordem perfeita, mas título sem relação, soma 0,33 e
 * não é proposta — que é o comportamento correto.
 *
 * `order` nasce com peso alto para um sinal de contexto (0,12) porque é o
 * único que traz informação de FORA do par: ele sabe onde os vizinhos já
 * ancorados caíram. É também o sinal que cresce com o uso — quanto mais
 * eventos aceitos, mais estreita a janela.
 *
 * `sequence` caiu para 0,02 porque deixou de ser um palpite sobre a EDT e
 * passou a ser um fato raro e explícito no título da etapa. Quando ocorre,
 * o título já pontuou alto sozinho.
 */
const WEIGHTS = {
  title: 0.6, structure: 0.13, order: 0.12, date: 0.08, phase: 0.05, sequence: 0.02,
} as const;

export interface ScoredCandidate {
  readonly item: TimelineCandidate;
  readonly score: number;
  readonly reasons: readonly string[];
}

export function scoreCandidate(
  milestone: MilestoneCandidate,
  item: TimelineCandidate,
  context: MatchContext = NEUTRAL_CONTEXT,
): ScoredCandidate {
  const title = Math.max(
    textSignal(milestone.title, item.title),
    milestone.description ? textSignal(milestone.description, item.title) * 0.9 : 0,
  );
  const structure = structureSignal(item, context.profile);
  const order = orderSignal(milestone, item, context.anchors);
  const date = dateSignal(item);
  const phase = phaseSignal(milestone, item);
  const sequence = sequenceSignal(milestone, item);

  const score = title * WEIGHTS.title
    + structure * WEIGHTS.structure
    + order * WEIGHTS.order
    + date * WEIGHTS.date
    + phase * WEIGHTS.phase
    + sequence * WEIGHTS.sequence;

  const reasons: string[] = [];
  if (title >= 0.6) reasons.push(`Descrição muito próxima (${Math.round(title * 100)}%)`);
  else if (title > 0) reasons.push(`Descrição parcialmente próxima (${Math.round(title * 100)}%)`);
  if (item.isMilestone && context.profile.hasMilestones) {
    reasons.push('Etapa marcada como marco no cronograma');
  } else if (item.isSummary) reasons.push('Etapa de resumo/fase');
  else reasons.push('Atividade operacional do cronograma');
  if (date === 0) reasons.push('Etapa SEM data — não sustenta mês previsto');
  if (order === 1 && context.anchors.length > 0) {
    reasons.push('Posição na linha do tempo compatível com os eventos já vinculados');
  } else if (order < ORDER_NEUTRAL) {
    // Qualquer coisa abaixo do neutro é evidência CONTRA: a data do candidato
    // conflita com onde os vizinhos já ancorados caíram.
    reasons.push('FORA da ordem dos eventos já vinculados');
  }
  if (phase >= 0.3) reasons.push(`Fase da EDT compatível (${item.parentTitle})`);
  if (sequence === 1) reasons.push(`A etapa cita o evento ${milestone.sequence} no título`);
  if (item.wbsCode) reasons.push(`EDT ${item.wbsCode}`);

  return { item, score: Math.min(1, Math.max(0, score)), reasons };
}

/**
 * A proposta para UM marco, ou `null` quando nada alcança o piso.
 *
 * Devolver `null` é uma resposta. A alternativa — propor o menos ruim — enche
 * a fila de revisão de pares que o revisor vai rejeitar um a um, e ensina a
 * rejeitar sem ler.
 */
export function proposeForMilestone(
  milestone: MilestoneCandidate,
  items: readonly TimelineCandidate[],
  context: MatchContext = NEUTRAL_CONTEXT,
): MappingProposal | null {
  const scored = items
    // Par que um humano recusou não volta. Repropor é discutir com o revisor,
    // e é assim que uma fila de revisão ensina a rejeitar sem ler.
    .filter((item) => !context.rejected.has(`${milestone.ruleId}::${item.timelineItemId}`))
    .map((item) => scoreCandidate(milestone, item, context))
    .filter((s) => s.score >= PROPOSAL_MIN_CONFIDENCE)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return null;

  const best = scored[0];
  const contenders = scored.filter(
    (s) => s !== best && best.score - s.score < PROPOSAL_AMBIGUITY_MARGIN,
  );
  const ambiguous = contenders.length > 0;

  /*
    A ambiguidade REBAIXA a confiança em vez de ser só um rótulo.

    Se duas etapas explicam o marco igualmente bem, o sistema não sabe qual é —
    e a confiança precisa dizer isso, porque é ela que ordena a fila de revisão
    e que vai parar na coluna "confiança" da tela. Um 0,91 ambíguo no topo da
    fila é exatamente o par que alguém aceitaria no piloto automático.
  */
  const confidence = ambiguous ? Math.min(best.score, PROPOSAL_HIGH_CONFIDENCE - 0.01) : best.score;

  return {
    milestoneId: milestone.milestoneId,
    ruleId: milestone.ruleId,
    contractId: milestone.contractId,
    projectId: best.item.projectId,
    timelineItemId: best.item.timelineItemId,
    confidence: Number(confidence.toFixed(3)),
    priority: ambiguous || confidence < PROPOSAL_HIGH_CONFIDENCE
      ? 'requires_attention'
      : 'quick_review',
    reasons: ambiguous
      ? [...best.reasons, `Ambíguo: ${contenders.length} outra(s) etapa(s) com escore equivalente`]
      : best.reasons,
    ambiguousWith: contenders.map((c) => c.item.timelineItemId),
  };
}

/**
 * As propostas do lote, com a garantia de que UMA etapa não é proposta para
 * dois marcos diferentes.
 *
 * Sem essa garantia, um cronograma com uma única etapa "Fabricação" viraria a
 * data prevista dos seis eventos do contrato — e a carteira mostraria
 * R$ 8 milhões concentrados num mês só, com aparência de precisão.
 */
export function proposeMappings(
  milestones: readonly MilestoneCandidate[],
  items: readonly TimelineCandidate[],
  context: MatchContext = NEUTRAL_CONTEXT,
): readonly MappingProposal[] {
  const taken = new Set<string>();
  const out: MappingProposal[] = [];

  // Os marcos de casamento mais forte escolhem primeiro; os fracos ficam com o
  // que sobrou (ou com nada, que é um resultado honesto).
  const ranked = milestones
    .map((m) => ({ m, best: proposeForMilestone(m, items, context) }))
    .sort((a, b) => (b.best?.confidence ?? 0) - (a.best?.confidence ?? 0));

  for (const { m } of ranked) {
    const available = items.filter((i) => !taken.has(i.timelineItemId));
    const proposal = proposeForMilestone(m, available, context);
    if (!proposal) continue;
    taken.add(proposal.timelineItemId);
    out.push(proposal);
  }

  return out;
}
