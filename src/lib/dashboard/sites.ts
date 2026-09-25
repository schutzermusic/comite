/**
 * Regras PURAS das operações no globo — a seção `sites` do overview do Dashboard.
 *
 * Onde cada projeto aparece no mapa, com que saúde e quantas exceções, testado
 * sem banco (tests/unit/dashboard-sites.test.ts):
 *  • POSIÇÃO: a localização OFICIAL (`project_globe_marker`, com proveniência
 *    documental) vence sempre. Sem ela, e só para projeto ATIVO, a coordenada
 *    do CANTEIRO cadastrada no Supply (`inventory_locations` PROJECT_SITE, ativo,
 *    com lat/lng) — e só quando há UM canteiro com coordenada válida; dois ou
 *    mais = ambíguo = sem ponto. Nunca centróide de UF, nunca estimativa.
 *  • Coordenada fora do mundo (não finita, lat ∉ [−90, 90], lng ∉ [−180, 180])
 *    não vira ponto.
 *  • SAÚDE: a mesma derivação de Operações para TODO projeto ativo (sem o corte
 *    de 30); projeto não ativo tem `level: null`.
 *  • EXCEÇÕES: contadas na fila ORDENADA inteira, antes do corte de 40.
 *  • SEM LOCALIZAÇÃO: projetos ativos sem nenhuma posição — contagem exata
 *    quando todas as leituras de posição vieram inteiras; senão a seção sai
 *    `truncated` (o número é teto, nunca "0").
 *
 * Nada aqui consulta, grava ou lê relógio.
 */
import type {
  FeedRow, HealthLevel, SectionState, SiteMarker, SitePosition, SitesModel,
} from './types';

/* ── Linhas lidas ───────────────────────────────────────────────────────── */

/** Uma linha de `project_globe_marker` (colunas explícitas; ver `readSitePositions`). */
export interface CanonicalMarkerRow {
  project_id: string;
  project_name?: string | null;
  project_code?: string | null;
  latitude: unknown;
  longitude: unknown;
  precision: string | null;
  site_label: string | null;
  municipality: string | null;
  state_code: string | null;
  evidence_kind: string | null;
  source_contract_id: string | null;
  source_document_id: string | null;
  source_page: number | string | null;
  geocoded_at: string | null;
}

/** Um canteiro do Supply (`inventory_locations` kind PROJECT_SITE, ativo, com coordenada). */
export interface ProjectSiteRow {
  id: string;
  project_id: string | null;
  code: string | null;
  name: string | null;
  latitude: unknown;
  longitude: unknown;
  updated_at: string | null;
}

/** Identidade do projeto (só exibição) + o local DECLARADO no cadastro (cidade/UF). */
export interface SiteProject {
  id: string;
  name: string;
  code: string | null;
  client: string | null;
  municipality: string | null;
  uf: string | null;
}

/**
 * O que a leitura de posições trouxe. `sitesState`: `ok` leu os canteiros;
 * `restricted` a pessoa não lê `inventory_locations`; `error` a leitura falhou.
 * Fora de `ok` o mapa fica só com as posições oficiais e a seção sai `truncated`.
 */
export interface SitePositionsRead {
  canonical: CanonicalMarkerRow[];
  canonicalTruncated: boolean;
  sites: ProjectSiteRow[];
  sitesState: 'ok' | 'restricted' | 'error';
  sitesTruncated: boolean;
  projects: SiteProject[];
}

/** Saúde de um projeto ATIVO (a lista SEM corte de Operações: `projectHealthAll`). */
export interface SiteHealthInput {
  projectId: string;
  level: HealthLevel;
  reasons: string[];
  nextMilestone: string | null;
  nextMilestoneTitle: string | null;
}

/** O que a seção usa de Operações. */
export interface SitesOpsInput {
  /** TODOS os projetos ativos com a saúde; `null` = não lida. */
  health: readonly SiteHealthInput[] | null;
  /**
   * Por projeto: OS, medição, risco e dependência — TODOS os candidatos da fila
   * de Operações (que corta em 40/15). `null` = não disponível: as linhas
   * dessas classes contam só as que chegaram à fila, e a contagem é piso.
   */
  attentionByProject: Readonly<Record<string, { total: number; danger: number }>> | null;
  /** A leitura de projetos de Operações chegou no teto: a lista de ativos pode estar incompleta. */
  projectsTruncated: boolean;
  /**
   * A saúde saiu de leitura cortada (cronograma, riscos, medições, cobertura ou OS) —
   * a mesma condição do "≥" da etapa Projeto: um "em dia" pode não ser.
   */
  healthPartial?: boolean;
}

/* ── Validação ──────────────────────────────────────────────────────────── */

const toNumber = (v: unknown): number => {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') return Number(v);
  return Number.NaN;
};

/** Coordenada VÁLIDA (finita, dentro do mundo) ou `null` — nunca um ponto no meio do oceano. */
export function validCoordinate(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  const a = toNumber(lat);
  const b = toNumber(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (a < -90 || a > 90 || b < -180 || b > 180) return null;
  return { lat: a, lng: b };
}

const UFS: ReadonlySet<string> = new Set([
  'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO',
  'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
]);

/** "pa " → "PA"; qualquer coisa que não seja uma das 27 UFs → `null`. */
export function normalizeUf(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim().toUpperCase();
  return UFS.has(t) ? t : null;
}

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

type Json = Record<string, unknown> | null | undefined;

/** O local DECLARADO no cadastro do projeto (`project.cidade/uf`; `project_v2.location`/`uf` quando existir). */
export function projectPlace(project: Json, projectV2?: Json): { municipality: string | null; uf: string | null } {
  const p = project ?? {};
  const v2 = projectV2 ?? {};
  const loc = (v2.location && typeof v2.location === 'object' ? v2.location : {}) as Record<string, unknown>;
  return {
    municipality: text(p.cidade) ?? text(p.city) ?? text(loc.city),
    uf: normalizeUf(p.uf) ?? normalizeUf(v2.uf) ?? normalizeUf(loc.uf),
  };
}

const EVIDENCE_KINDS = new Set(['contract_scope', 'contract_clause', 'manual']);

/**
 * A posição OFICIAL. Sem coordenada válida ou sem proveniência reconhecida →
 * `null` (a visão garante as duas; aqui é a guarda contra transporte).
 */
export function canonicalPosition(r: CanonicalMarkerRow): SitePosition | null {
  const c = validCoordinate(r.latitude, r.longitude);
  if (!c || !r.evidence_kind || !EVIDENCE_KINDS.has(r.evidence_kind)) return null;
  const page = r.source_page === null || r.source_page === undefined ? null : toNumber(r.source_page);
  return {
    lat: c.lat,
    lng: c.lng,
    // Precisão desconhecida → a mais conservadora (câmera mais alta).
    precision: r.precision === 'site' ? 'site' : 'municipality',
    label: text(r.site_label),
    municipality: text(r.municipality),
    uf: normalizeUf(r.state_code),
    source: 'canonical',
    evidence: {
      kind: r.evidence_kind as 'contract_scope' | 'contract_clause' | 'manual',
      contractId: text(r.source_contract_id),
      documentId: text(r.source_document_id),
      page: page !== null && Number.isFinite(page) ? page : null,
      at: text(r.geocoded_at),
    },
  };
}

/** "Canteiro CANT-TUCURUI" — o código do local; sem código, o nome (sem repetir "Canteiro"). */
export function siteLabel(site: Pick<ProjectSiteRow, 'code' | 'name'>): string {
  const code = text(site.code);
  if (code) return `Canteiro ${code}`;
  const name = text(site.name);
  if (!name) return 'Canteiro';
  return /^canteiro\b/i.test(name) ? name : `Canteiro ${name}`;
}

/** A posição do CANTEIRO (Supply). Cidade/UF vêm do cadastro do projeto — o local não as tem. */
export function projectSitePosition(site: ProjectSiteRow, place: { municipality: string | null; uf: string | null } | null): SitePosition | null {
  const c = validCoordinate(site.latitude, site.longitude);
  if (!c) return null;
  return {
    lat: c.lat,
    lng: c.lng,
    precision: 'site',
    label: siteLabel(site),
    municipality: place?.municipality ?? null,
    uf: place?.uf ?? null,
    source: 'project_site',
    evidence: { kind: 'supply_site', contractId: null, documentId: null, page: null, at: text(site.updated_at) },
  };
}

/* ── Posições ───────────────────────────────────────────────────────────── */

export interface ResolvedPositions {
  positions: Map<string, SitePosition>;
  /** Projetos ativos sem oficial com MAIS DE UM canteiro com coordenada válida: sem ponto. */
  ambiguous: Set<string>;
}

/**
 * Precedência: oficial → canteiro único (só projeto ativo sem linha oficial).
 * Um projeto COM linha oficial nunca cai para o canteiro, nem quando a linha
 * oficial não passa na validação (o ponto oficial existe e não foi lido
 * direito — trocar pelo canteiro seria mudar a fonte calado).
 */
export function resolvePositions(
  read: Pick<SitePositionsRead, 'canonical' | 'sites' | 'sitesState' | 'projects'>,
  activeIds: ReadonlySet<string>,
): ResolvedPositions {
  const positions = new Map<string, SitePosition>();
  const ambiguous = new Set<string>();
  const withCanonical = new Set<string>();
  for (const r of read.canonical) {
    if (!r.project_id) continue;
    withCanonical.add(r.project_id);
    if (positions.has(r.project_id)) continue;
    const pos = canonicalPosition(r);
    if (pos) positions.set(r.project_id, pos);
  }
  if (read.sitesState !== 'ok') return { positions, ambiguous };

  const places = new Map(read.projects.map((p) => [p.id, { municipality: p.municipality, uf: p.uf }]));
  const byProject = new Map<string, ProjectSiteRow[]>();
  for (const s of read.sites) {
    if (!s.project_id || withCanonical.has(s.project_id) || !activeIds.has(s.project_id)) continue;
    if (!validCoordinate(s.latitude, s.longitude)) continue;
    byProject.set(s.project_id, [...(byProject.get(s.project_id) ?? []), s]);
  }
  for (const [projectId, list] of byProject) {
    if (list.length > 1) { ambiguous.add(projectId); continue; }
    const pos = projectSitePosition(list[0], places.get(projectId) ?? null);
    if (pos) positions.set(projectId, pos);
  }
  return { positions, ambiguous };
}

/* ── Exceções por local ─────────────────────────────────────────────────── */

/** As linhas da fila que vêm da fila de Operações (cortada lá) — contadas por `attentionByProject` quando há. */
export const OPS_ROW_PREFIXES: readonly string[] = ['os:', 'meas:', 'risk:', 'dep:'];

const isOpsRow = (key: string) => OPS_ROW_PREFIXES.some((p) => key.startsWith(p));

export interface SiteExceptions { total: number; critical: number; top: FeedRow | null }

/**
 * Exceções por projeto sobre a fila ORDENADA inteira (antes do corte de 40).
 * Com `attentionByProject`, as classes que Operações corta (OS, medição, risco,
 * dependência) vêm da contagem SEM corte de lá, e as linhas delas na fila não
 * são contadas de novo. `top` = a primeira linha do projeto na ordem da fila
 * (a mais grave — a ordem é gravidade → prazo → domínio).
 */
export function siteExceptions(
  ranked: readonly FeedRow[],
  attentionByProject: SitesOpsInput['attentionByProject'],
): Map<string, SiteExceptions> {
  const out = new Map<string, SiteExceptions>();
  const get = (id: string) => {
    let cur = out.get(id);
    if (!cur) { cur = { total: 0, critical: 0, top: null }; out.set(id, cur); }
    return cur;
  };
  for (const r of ranked) {
    if (r.location.kind !== 'project' || !r.location.id) continue;
    const cur = get(r.location.id);
    if (!cur.top) cur.top = r;
    if (attentionByProject && isOpsRow(r.key)) continue;
    cur.total += 1;
    if (r.severity === 'critical') cur.critical += 1;
  }
  if (attentionByProject) {
    for (const [id, c] of Object.entries(attentionByProject)) {
      const cur = get(id);
      cur.total += Math.max(0, c.total);
      cur.critical += Math.max(0, Math.min(c.danger, c.total));
    }
  }
  return out;
}

/* ── Modelo ─────────────────────────────────────────────────────────────── */

const LEVEL_RANK: Record<HealthLevel, number> = { critical: 0, attention: 1, healthy: 2, unknown: 3 };
const levelRank = (l: HealthLevel | null) => (l === null ? 4 : LEVEL_RANK[l]);

/** Crítico → atenção → em dia → sem cronograma → não ativo; depois pelo nome. */
export function compareMarkers(a: SiteMarker, b: SiteMarker): number {
  return levelRank(a.level) - levelRank(b.level)
    || a.name.localeCompare(b.name, 'pt-BR')
    || (a.projectId < b.projectId ? -1 : a.projectId > b.projectId ? 1 : 0);
}

/** UFs com projeto localizado, com as contagens por nível: mais críticos primeiro. */
export function siteStates(markers: readonly SiteMarker[]): SitesModel['states'] {
  const by = new Map<string, { uf: string; projects: number; critical: number; attention: number }>();
  for (const m of markers) {
    const uf = m.position.uf;
    if (!uf) continue;
    const cur = by.get(uf) ?? { uf, projects: 0, critical: 0, attention: 0 };
    cur.projects += 1;
    if (m.level === 'critical') cur.critical += 1;
    if (m.level === 'attention') cur.attention += 1;
    by.set(uf, cur);
  }
  return Array.from(by.values()).sort((a, b) => b.critical - a.critical || b.attention - a.attention
    || b.projects - a.projects || a.uf.localeCompare(b.uf));
}

const isoDay = (v: string | null): string | null => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

export interface SitesModelInput {
  read: SitePositionsRead;
  ops: SitesOpsInput & { health: readonly SiteHealthInput[] };
  /** A fila ORDENADA inteira (antes do corte). */
  ranked: readonly FeedRow[];
  /** Alguma fonte que dá linha a PROJETO falhou ou veio cortada: as contagens por local são piso. */
  exceptionsPartial: boolean;
  unlocatedHref: string;
}

/**
 * O modelo + `truncated`: posições ou lista de ativos incompletas (`unlocated`
 * é teto, pode faltar ponto) ou saúde lida com corte (o nível pode estar abaixo).
 */
export function buildSitesModel(input: SitesModelInput): { model: SitesModel; truncated: boolean } {
  const { read, ops, ranked } = input;
  const health = new Map(ops.health.map((h) => [h.projectId, h]));
  const activeIds = new Set(health.keys());
  const { positions } = resolvePositions(read, activeIds);
  const projects = new Map(read.projects.map((p) => [p.id, p]));
  const exceptions = siteExceptions(ranked, ops.attentionByProject);
  // Quem chama marca `exceptionsPartial` também quando falta `attentionByProject` e Operações cortou a fila.
  const partial = input.exceptionsPartial;

  const markers: SiteMarker[] = [];
  for (const [projectId, position] of positions) {
    const p = projects.get(projectId);
    // Sem a identidade lida sob a RLS de projetos, não há o que mostrar (nunca um id cru).
    if (!p) continue;
    const h = health.get(projectId) ?? null;
    const ex = exceptions.get(projectId) ?? { total: 0, critical: 0, top: null };
    const milestone = h ? isoDay(h.nextMilestone) : null;
    markers.push({
      projectId,
      name: p.name,
      client: p.client,
      code: p.code,
      position,
      level: h ? h.level : null,
      reasons: h ? [...h.reasons] : [],
      nextMilestone: milestone ? { date: milestone, title: h?.nextMilestoneTitle ?? null } : null,
      exceptions: { total: ex.total, critical: ex.critical, partial },
      topIssue: ex.top ? { label: `${ex.top.kindLabel}: ${ex.top.problem}`, href: ex.top.nextAction.href, severity: ex.top.severity } : null,
      href: `/projetos/${encodeURIComponent(projectId)}?tab=overview`,
    });
  }
  markers.sort(compareMarkers);

  const located = new Set(markers.map((m) => m.projectId));
  const unlocated = Array.from(activeIds).filter((id) => !located.has(id)).length;
  const truncated = read.canonicalTruncated || read.sitesState !== 'ok' || read.sitesTruncated || ops.projectsTruncated
    || ops.healthPartial === true;
  return {
    model: { markers, unlocated, unlocatedHref: input.unlocatedHref, states: siteStates(markers) },
    truncated,
  };
}

export const SITES_POSITIONS_ERROR = 'Não foi possível ler as posições das operações.';
export const SITES_HEALTH_ERROR = 'Não foi possível ler a saúde dos projetos para o mapa.';

/**
 * A seção inteira. Portão = leitura de projetos (a RLS de `project_globe_marker`
 * e `project_canonical_location`). Posições oficiais que falham → `error` (sem
 * elas a precedência não se sabe); saúde que falha → `error` (nunca um ponto
 * "sem cronograma" no lugar de "não carregou").
 */
export function buildSitesSection(input: {
  gate: boolean;
  positions: SectionState<SitePositionsRead>;
  ops: SectionState<SitesOpsInput>;
  ranked: readonly FeedRow[];
  exceptionsPartial: boolean;
  unlocatedHref: string;
}): SectionState<SitesModel> {
  if (!input.gate) return { state: 'restricted' };
  if (input.positions.state === 'restricted') return { state: 'restricted' };
  if (input.positions.state === 'error') return { state: 'error', message: SITES_POSITIONS_ERROR };
  if (input.ops.state !== 'ok' || !input.ops.data.health) return { state: 'error', message: SITES_HEALTH_ERROR };
  const { model, truncated } = buildSitesModel({
    read: input.positions.data,
    ops: { ...input.ops.data, health: input.ops.data.health },
    ranked: input.ranked,
    exceptionsPartial: input.exceptionsPartial,
    unlocatedHref: input.unlocatedHref,
  });
  return { state: 'ok', data: model, ...(truncated ? { truncated: true } : {}) };
}
