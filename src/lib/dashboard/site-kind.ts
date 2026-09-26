/**
 * TIPO DE OBRA DO LOCAL — só dirige a REPRESENTAÇÃO ESQUEMÁTICA 3D do local
 * (subestação, linha de transmissão, usina solar, hidrelétrica, eólica ou um
 * lote genérico). Não é dado de negócio: nenhuma regra, alçada ou número
 * depende disto, e a tela diz "Representação esquemática — não é o projeto
 * executivo".
 *
 * Regra (pura e explicável — `basis` e `matched` dizem de onde veio):
 *  • fontes com peso: nome do projeto 3 · título de cada OS 2 (máx. 4) ·
 *    escopo cadastrado 1 · cada item de material 1 (máx. 2);
 *  • siglas SÓ em maiúsculas e em fronteira de palavra ("SE", "LT", "UHE",
 *    "UFV", "UG-05"…) — "se" minúsculo e a UF não contam: "SE" logo depois
 *    de "/", "," ou colado a um hífen ("Aracaju/SE Fase 2", "Aracaju, SE",
 *    "Aracaju-SE"), ou seguido de "Fase"/"Etapa"/"Lote", é Sergipe, não
 *    subestação; palavras sem acento/caixa ("subestação",
 *    "linha de transmissão", "solar", "hidrelétrica", "eólica"…); códigos de
 *    item por prefixo ("DISJ-", "ISOL-", "INV-"…);
 *  • o tipo de maior pontuação vence se somar ao menos 3 — o nome sozinho
 *    basta; uma OS sozinha (2) ou só itens (máx. 2), não: "Obra X" com uma
 *    OS "SE X — bays" continua genérica; empate no topo → o que tem a fonte
 *    mais forte; persistindo, `generic` (ambíguo não vira desenho);
 *  • o desenho não muda com o perfil de quem olha: as fontes são as que todo
 *    mundo que abre o local lê (projects.view — a RLS de OS também aceita
 *    essa chave; ver `readSiteKindSources` em site.ts).
 *
 * Tensão ("138 kV") entra em `matched` como contexto de subestação/linha,
 * sem pontuar.
 */
import type { SiteKind, SiteKindDetection } from './types';

type DetectedKind = Exclude<SiteKind, 'generic'>;
export type SiteKindSource = 'nome' | 'OS' | 'escopo' | 'itens';

export const SITE_KIND_WEIGHT: Record<SiteKindSource, number> = { nome: 3, OS: 2, escopo: 1, itens: 1 };
/** Teto por fonte que se repete: muitas OS ou muitos itens não afogam o nome. */
const SOURCE_CAP: Record<SiteKindSource, number> = { nome: 3, OS: 4, escopo: 1, itens: 2 };
export const SITE_KIND_THRESHOLD = 3;

export const GENERIC_SITE_KIND: SiteKindDetection = { kind: 'generic', basis: [], matched: [] };

/** Sigla em maiúsculas; `next` exige o que vem depois (evita "Aracaju/SE" e "se" da frase). */
interface Acronym { term: string; next?: 'upperOrDigit' | 'digit' }
interface KindRules { acronyms: Acronym[]; words: string[]; codes: string[] }

const RULES: Record<DetectedKind, KindRules> = {
  substation: {
    acronyms: [{ term: 'SE', next: 'upperOrDigit' }, { term: 'SED', next: 'upperOrDigit' }],
    words: ['subestação', 'subestações', 'bay', 'bays', 'disjuntor', 'disjuntores', 'seccionadora', 'seccionadoras', 'seccionador',
      'seccionadores', 'autotransformador', 'transformador de potência', 'barramento', 'barramentos', 'casa de comando',
      'casa de controle', 'pátio de manobra'],
    codes: ['DISJ', 'SECC', 'TRAFO', 'TC', 'TP'],
  },
  transmission: {
    acronyms: [{ term: 'LT', next: 'upperOrDigit' }, { term: 'LTs' }],
    words: ['linha de transmissão', 'linhas de transmissão', 'torre', 'torres', 'isolador', 'isoladores', 'cabo para-raios', 'opgw',
      'travessia', 'catenária', 'faixa de servidão'],
    codes: ['ISOL', 'OPGW', 'CAA', 'TORRE', 'AMORT'],
  },
  solar: {
    acronyms: [{ term: 'UFV' }, { term: 'FV', next: 'upperOrDigit' }],
    words: ['solar', 'solares', 'fotovoltaica', 'fotovoltaicas', 'fotovoltaico', 'fotovoltaicos', 'mwp', 'kwp', 'inversor',
      'inversores', 'string', 'strings', 'rastreador', 'rastreadores', 'tracker', 'trackers'],
    codes: ['SOLAR', 'INV', 'MODFV', 'FV', 'PV', 'STRING'],
  },
  hydro: {
    acronyms: [{ term: 'UHE' }, { term: 'PCH' }, { term: 'CGH' }, { term: 'UG', next: 'digit' }],
    words: ['hidrelétrica', 'hidrelétricas', 'hidroelétrica', 'hidrelétrico', 'turbina', 'turbinas', 'casa de força',
      'unidade geradora', 'unidades geradoras', 'barragem', 'vertedouro', 'comporta', 'comportas', 'conduto forçado'],
    codes: ['TURB', 'UG'],
  },
  wind: {
    acronyms: [{ term: 'EOL' }, { term: 'UEE' }],
    words: ['eólica', 'eólicas', 'eólico', 'eólicos', 'aerogerador', 'aerogeradores', 'nacele', 'nacelle'],
    codes: ['AERO', 'WTG', 'NACELE'],
  },
};

/** Ordem estável para empate e para a leitura dos termos. */
const KINDS: readonly DetectedKind[] = ['substation', 'transmission', 'solar', 'hydro', 'wind'];
const SOURCE_ORDER: readonly SiteKindSource[] = ['nome', 'OS', 'escopo', 'itens'];

/** Sem acento, minúsculo, só letras/dígitos separados por um espaço, com espaço nas pontas. */
function fold(text: string): string {
  const plain = text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return ` ${plain.replace(/[^a-z0-9]+/g, ' ').trim()} `;
}

const FOLDED_WORDS: Record<DetectedKind, Array<{ display: string; folded: string }>> = Object.fromEntries(
  KINDS.map((k) => [k, RULES[k].words.map((w) => ({ display: w, folded: fold(w) }))]),
) as Record<DetectedKind, Array<{ display: string; folded: string }>>;

/** Tokens na caixa original (letras e dígitos de qualquer alfabeto). */
function tokens(text: string): string[] {
  return text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** Um token e o que vem antes dele: o último caractere não-espaço e se está colado (sem espaço). */
interface Tok { t: string; before: string; glued: boolean }
function tokensWithContext(text: string): Tok[] {
  return Array.from(text.matchAll(/[\p{L}\p{N}]+/gu), (m) => {
    const at = m.index ?? 0;
    const prefix = text.slice(0, at);
    return { t: m[0], before: prefix.trimEnd().slice(-1), glued: at > 0 && !/\s/u.test(prefix.slice(-1)) };
  });
}

const LINK = new Set(['de', 'da', 'do', 'das', 'dos']);
/** Depois da UF, o que vem é a parte da obra, não o nome de uma subestação/linha ("Aracaju/SE Fase 2"). */
const GENERIC_NEXT = new Set(['fase', 'etapa', 'lote']);
const upperOrDigit = (t: string | undefined) => !!t && /^[\p{Lu}\p{N}]/u.test(t);
/** "Aracaju/SE", "Aracaju, SE", "Aracaju-SE": a sigla é a UF que fecha o nome da cidade. */
const afterCity = (x: Tok) => x.before === '/' || x.before === ',' || (x.glued && x.before === '-');

function acronymHits(text: string, rules: readonly Acronym[]): string[] {
  const toks = tokensWithContext(text);
  const out: string[] = [];
  for (const rule of rules) {
    const hit = toks.some((x, i) => {
      if (x.t !== rule.term) return false;
      if (!rule.next) return true;
      const n = toks[i + 1]?.t;
      if (rule.next === 'digit') return !!n && /^\p{N}/u.test(n);
      // "SE Tucuruí", "SE 138 kV", "SE de Tucuruí" — nunca "Aracaju/SE Fase 2", "SE Etapa 2" nem "se" no meio da frase.
      if (afterCity(x) || (!!n && GENERIC_NEXT.has(n.toLowerCase()))) return false;
      return upperOrDigit(n) || (!!n && LINK.has(n) && upperOrDigit(toks[i + 2]?.t));
    });
    if (hit) out.push(rule.term);
  }
  return out;
}

function wordHits(folded: string, kind: DetectedKind): string[] {
  return FOLDED_WORDS[kind].filter((w) => folded.includes(w.folded)).map((w) => w.display);
}

/** Código de item: o prefixo como token inteiro, ou seguido só de dígitos/unidade ("INV250KW"). */
function codeHits(code: string, rules: readonly string[]): string[] {
  const toks = tokens(code.toUpperCase());
  return rules.filter((c) => toks.some((t) => t === c || new RegExp(`^${c}\\d[\\dA-Z]*$`).test(t))).map((c) => `${c}-`);
}

const VOLTAGE = /(\d{2,3}(?:[.,]\d+)?)\s?kV\b/g;
function voltages(text: string): string[] {
  return Array.from(text.matchAll(VOLTAGE), (m) => `${m[1]} kV`);
}

export interface SiteKindInput {
  name: string | null;
  /** Títulos das OS do projeto (não canceladas), lidos sob projects.view — os mesmos para todo perfil que abre o local. */
  serviceOrderTitles: readonly string[];
  scope: string | null;
  items: ReadonlyArray<{ code: string | null; description: string | null }>;
}

interface Entry { source: SiteKindSource; text: string; code: string | null }

/** Os termos de UMA entrada que apontam para o tipo (vazio = não aponta). */
function entryHits(e: Entry, kind: DetectedKind): string[] {
  const rules = RULES[kind];
  const hits = [...acronymHits(e.text, rules.acronyms), ...wordHits(fold(e.text), kind)];
  if (e.code) hits.push(...acronymHits(e.code, rules.acronyms), ...codeHits(e.code, rules.codes));
  return hits;
}

/** O tipo de obra do local, com a base e os termos que casaram. Pura. */
export function detectSiteKind(input: SiteKindInput): SiteKindDetection {
  const entries: Entry[] = [];
  if (input.name?.trim()) entries.push({ source: 'nome', text: input.name, code: null });
  for (const t of input.serviceOrderTitles) if (t?.trim()) entries.push({ source: 'OS', text: t, code: null });
  if (input.scope?.trim()) entries.push({ source: 'escopo', text: input.scope, code: null });
  for (const i of input.items) {
    if (i.code?.trim() || i.description?.trim()) entries.push({ source: 'itens', text: i.description ?? '', code: i.code ?? null });
  }

  const scored = KINDS.map((kind) => {
    const bySource = new Map<SiteKindSource, number>();
    const matched: string[] = [];
    for (const e of entries) {
      const hits = entryHits(e, kind);
      if (!hits.length) continue;
      bySource.set(e.source, Math.min(SOURCE_CAP[e.source], (bySource.get(e.source) ?? 0) + SITE_KIND_WEIGHT[e.source]));
      for (const h of hits) if (!matched.includes(h)) matched.push(h);
    }
    const score = Array.from(bySource.values()).reduce((a, b) => a + b, 0);
    const strongest = Math.max(0, ...Array.from(bySource.keys()).map((s) => SITE_KIND_WEIGHT[s]));
    return { kind, score, strongest, basis: SOURCE_ORDER.filter((s) => bySource.has(s)), matched };
  }).sort((a, b) => b.score - a.score || b.strongest - a.strongest);

  const [best, second] = scored;
  if (!best || best.score < SITE_KIND_THRESHOLD) return GENERIC_SITE_KIND;
  if (second && second.score === best.score && second.strongest === best.strongest) return GENERIC_SITE_KIND;

  const matched = [...best.matched];
  if (best.kind === 'substation' || best.kind === 'transmission') {
    for (const e of entries) {
      if (e.source === 'itens') continue;
      for (const v of voltages(e.text)) if (!matched.includes(v)) matched.push(v);
    }
  }
  return { kind: best.kind, basis: best.basis, matched };
}
