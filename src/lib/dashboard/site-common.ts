/**
 * O QUE AS ROTAS DO LOCAL EM FOCO COMPARTILHAM (server-only).
 *
 *   GET /api/dashboard/site/[projectId]           → Visão geral (`./site`)
 *   GET /api/dashboard/site/[projectId]/plan      → Planejar (`./site-plan`)
 *   …/supply, …/billing                           → as outras abas do local
 *
 * A mesma porta para todas: o id é validado ANTES de qualquer leitura; a
 * sessão é a do Dashboard (`requireCommercialSession([])` — toda pessoa
 * autenticada com organização ativa); os portões são os MESMOS do Dashboard
 * (`resolveGates`, espelho da RLS); o projeto é lido pelo cliente AUTENTICADO
 * com `.eq('organization_id')` — outro inquilino recebe "não encontrado",
 * nunca dado. Toda resposta que não é de sucesso é 200 com `ok: false` e o
 * motivo (`invalid` · `not_found` · `restricted` · `error`), e `error` repete a
 * mensagem para o leitor genérico da tela; 500 só quando a montagem inteira
 * cai. `Cache-Control: no-store` e `Server-Timing` sempre.
 *
 * Cada seção roda isolada (`runSiteSection`: portão → prazo de 6 s → estado):
 * restrita volta `restricted` (nunca 0), falha volta `error` (nunca calma).
 * Nenhuma leitura pelo service role mora aqui.
 */
if (typeof window !== 'undefined') {
  throw new Error('dashboard/site-common.ts não pode ser importado no navegador');
}

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isSessionError, requireCommercialSession, type CommercialSession } from '@/lib/commercial/server-session';
import { projectIdentity, type ProjectIdentity } from '@/lib/operations/project-identity';
import { todayInSaoPaulo } from '@/lib/operations/projects/access';
import { resolveGates, type DashboardGates } from './overview';
import type { SectionState } from './types';

type Session = CommercialSession;
type Json = Record<string, unknown>;

/* ── Identificador ──────────────────────────────────────────────────────── */

/** Ids de projeto são texto (`qa-scn-tucurui`, `proj-<uuid>`): só isto passa — nada de sintaxe de filtro. */
export const SITE_PROJECT_ID = /^[A-Za-z0-9._-]{1,128}$/;

export function isValidProjectId(id: unknown): id is string {
  return typeof id === 'string' && SITE_PROJECT_ID.test(id);
}

/* ── Respostas que não são de sucesso ───────────────────────────────────── */

export type SiteFailureReason = 'invalid' | 'not_found' | 'restricted' | 'error';

export interface SiteFailure { ok: false; reason: SiteFailureReason; message: string; error: string }

export const SITE_MESSAGE: Record<SiteFailureReason, string> = {
  invalid: 'Identificador de projeto inválido.',
  not_found: 'Projeto não encontrado nesta organização.',
  restricted: 'Seu perfil não lê projetos.',
  error: 'Não foi possível ler este projeto agora. Tente de novo em instantes.',
};

/** `error` repete `message` — a tela lê `payload.error` sem distinguir a rota. */
export function siteFailure(reason: SiteFailureReason, message = SITE_MESSAGE[reason]): SiteFailure {
  return { ok: false, reason, message, error: message };
}

/* ── Execução isolada por seção ─────────────────────────────────────────── */

/** Prazo de cada seção: passou disso, ela volta `error` e as outras seguem (o mesmo do Dashboard). */
export const SITE_SECTION_TIMEOUT_MS = 6_000;

export type Timings = Record<string, number>;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Tempo esgotado ao ler ${label}.`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => { if (timer) clearTimeout(timer); });
}

/**
 * Uma seção: sem portão → `restricted` (sem ler nada); com portão → a leitura
 * com prazo; erro ou prazo → `error` com a frase do que não carregou. Nunca
 * lança — quem compõe pode usar `Promise.all` sem derrubar a resposta.
 */
export async function runSiteSection<T>(
  gate: boolean, label: string, run: () => Promise<T>, timings: Timings | undefined, key: string,
  timeoutMs = SITE_SECTION_TIMEOUT_MS,
): Promise<SectionState<T>> {
  if (!gate) return { state: 'restricted' };
  const started = Date.now();
  try {
    const data = await withTimeout(Promise.resolve().then(run), timeoutMs, label);
    return { state: 'ok', data };
  } catch (error) {
    console.error(`[dashboard/site] seção ${key} falhou`, error);
    return { state: 'error', message: `Não foi possível ler ${label}.` };
  } finally {
    if (timings) timings[key] = Date.now() - started;
  }
}

/** `Promise.allSettled` para seções que já não lançam — defesa extra: um `rejected` vira `error`. */
export async function settleSections<T extends readonly unknown[]>(
  sections: { [K in keyof T]: Promise<SectionState<T[K]>> }, labels: { [K in keyof T]: string },
): Promise<{ [K in keyof T]: SectionState<T[K]> }> {
  const settled = await Promise.allSettled(sections as unknown as Array<Promise<SectionState<unknown>>>);
  return settled.map((r, i) => (r.status === 'fulfilled' ? r.value
    : { state: 'error', message: `Não foi possível ler ${(labels as unknown as string[])[i]}.` })) as unknown as { [K in keyof T]: SectionState<T[K]> };
}

export const dataOf = <T>(s: SectionState<T>): T | null => (s.state === 'ok' ? s.data : null);

export function mapSection<T, U>(s: SectionState<T>, f: (t: T) => U): SectionState<U> {
  return s.state === 'ok' ? { state: 'ok', data: f(s.data) } : s;
}

/* ── Leituras paginadas (teto do PostgREST = 1000 por resposta) ─────────── */

export const PAGE_SIZE = 1000;

type PageResult = { data: unknown[] | null; error: { message: string } | null };

/**
 * Lê por páginas (`range`) até `cap` linhas. A consulta TEM de vir ordenada
 * por uma chave estável. `truncated` = havia mais do que `cap`. Um erro SOBE
 * (nunca vira lista vazia).
 */
export async function readPaged<T>(
  label: string, page: (from: number, to: number) => PromiseLike<PageResult>, cap: number,
): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = [];
  for (let from = 0; from < cap; from += PAGE_SIZE) {
    const to = Math.min(from + PAGE_SIZE, cap) - 1;
    const res = await page(from, to);
    if (res.error) throw new Error(`Não foi possível ler ${label}.`);
    const got = (res.data ?? []) as T[];
    rows.push(...got);
    if (got.length < to - from + 1) return { rows, truncated: false };
  }
  // Chegou no teto com a última página cheia: pode haver mais.
  return { rows, truncated: true };
}

/* ── Cobertura de material de UM projeto ────────────────────────────────── */

/** As colunas da visão `supply_requirement_coverage` que a regra (`fromViewRow`) usa. */
export const COVERAGE_COLUMNS = 'requirement_id,project_id,activity_id,item_id,requirement_type,required_by,unit,required_qty,'
  + 'reserved_qty,consumed_qty,in_transit_qty,on_order_qty,requested_qty,inspection_qty';

/** Tipos cuja cobertura é do Supply (a visão só tem estes). */
export const SUPPLY_COVERED_REQUIREMENT_TYPES = ['MATERIAL', 'EXTERNAL_SERVICE'] as const;

/** Acima disto, a leitura por requisito vira a leitura pelo projeto (uma consulta, mais lenta, sem N idas). */
export const COVERAGE_PER_REQUIREMENT_MAX = 120;
const COVERAGE_CONCURRENCY = 8;

async function inPool<T, R>(items: readonly T[], size: number, run: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next; next += 1;
      out[i] = await run(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return out;
}

/**
 * A cobertura VIVA dos requisitos de UM projeto — a mesma visão, as mesmas
 * colunas, sob a RLS da pessoa. A visão agrega reservas, transferências,
 * pedidos, requisições e recebimentos da organização inteira ANTES do filtro:
 * pelo `project_id` (ou por uma lista de ids) o Postgres agrega tudo (segundos,
 * e sob RLS mais ainda); por `requirement_id = <um id>` o filtro desce para as
 * agregações (dezenas de ms). Por isso: até `COVERAGE_PER_REQUIREMENT_MAX`
 * requisitos, uma consulta por requisito (em paralelo, com teto); acima, a
 * consulta pelo projeto, paginada. `requirementIds` = os requisitos de
 * material/serviço confirmados do projeto (quem chama já os leu).
 */
export async function readProjectCoverage<T = Record<string, unknown>>(
  sb: SupabaseClient, org: string, projectId: string, requirementIds: readonly string[], idsTruncated = false,
): Promise<{ rows: T[]; truncated: boolean }> {
  if (idsTruncated || requirementIds.length > COVERAGE_PER_REQUIREMENT_MAX) {
    return readPaged<T>('a cobertura de material do projeto', (from, to) => sb.from('supply_requirement_coverage')
      .select(COVERAGE_COLUMNS).eq('organization_id', org).eq('project_id', projectId).order('requirement_id').range(from, to), 5_000);
  }
  const unique = Array.from(new Set(requirementIds));
  const pages = await inPool(unique, COVERAGE_CONCURRENCY, async (id) => {
    const res = await sb.from('supply_requirement_coverage').select(COVERAGE_COLUMNS)
      .eq('organization_id', org).eq('requirement_id', id).limit(1);
    if (res.error) throw new Error('Não foi possível ler a cobertura de material do projeto.');
    return (res.data ?? []) as unknown as Array<T & { project_id?: unknown }>;
  });
  return { rows: pages.flat().filter((r) => r.project_id === projectId), truncated: false };
}

/* ── O projeto em foco ──────────────────────────────────────────────────── */

export interface SiteProject {
  id: string;
  identity: ProjectIdentity;
  /** `projects.project` (JSONB canônico) e `projects.project_v2` — só leitura. */
  json: Json;
  v2: Json | null;
}

export interface SiteContext {
  session: Session;
  gates: DashboardGates;
  /** Hoje em São Paulo (YYYY-MM-DD) — o mesmo `today` para todas as leituras. */
  today: string;
  project: SiteProject;
}

export type SiteOpen = { ok: true; site: SiteContext } | SiteFailure;

/**
 * Portões → projeto. Sem `projects.view` o local inteiro é Restrito (o globo
 * só mostra locais a quem lê projetos). O projeto é lido pela RLS e pela
 * organização ativa: erro → `error`; nada → `not_found` (outro inquilino cai
 * aqui, sem nenhum dado).
 */
export async function openSite(session: Session, projectId: string, today = todayInSaoPaulo()): Promise<SiteOpen> {
  const gates = await resolveGates(session);
  if (!gates.projects) return siteFailure('restricted');
  const res = await session.supabase.from('projects').select('id,project,project_v2')
    .eq('organization_id', session.organizationId).eq('id', projectId).maybeSingle();
  if (res.error) {
    console.error('[dashboard/site] leitura do projeto falhou', res.error);
    return siteFailure('error');
  }
  const row = res.data as { id: string; project: Json | null; project_v2: Json | null } | null;
  if (!row) return siteFailure('not_found');
  return {
    ok: true,
    site: {
      session, gates, today,
      project: { id: row.id, identity: projectIdentity(row.id, row.project, row.project_v2), json: row.project ?? {}, v2: row.project_v2 ?? null },
    },
  };
}

/* ── A rota ─────────────────────────────────────────────────────────────── */

const NO_STORE = 'no-store';

function serverTiming(timings: Timings, started: number): string {
  return [...Object.entries(timings).map(([k, ms]) => `${k};dur=${ms}`), `total;dur=${Date.now() - started}`].join(', ');
}

/**
 * O esqueleto das rotas do local: valida o id (sem ler NADA), abre a sessão,
 * abre o local e entrega ao `build`. 200 sempre que houver corpo; 500 só
 * quando `build` lança (a montagem inteira caiu).
 */
export async function handleSiteRequest(
  rawProjectId: string, what: string, build: (site: SiteContext, timings: Timings) => Promise<object>,
): Promise<Response> {
  const started = Date.now();
  if (!isValidProjectId(rawProjectId)) {
    return NextResponse.json(siteFailure('invalid'), { status: 200, headers: { 'Cache-Control': NO_STORE } });
  }
  const session = await requireCommercialSession([]);
  if (isSessionError(session)) return session.error;
  const timings: Timings = {};
  try {
    const opened = await openSite(session, rawProjectId);
    if (!opened.ok) {
      return NextResponse.json(opened, { status: 200, headers: { 'Cache-Control': NO_STORE, 'Server-Timing': serverTiming(timings, started) } });
    }
    const body = await build(opened.site, timings);
    return NextResponse.json(body, { status: 200, headers: { 'Cache-Control': NO_STORE, 'Server-Timing': serverTiming(timings, started) } });
  } catch (error) {
    console.error(`[dashboard/site] montagem de ${what} falhou`, error);
    const message = `Não foi possível montar ${what}.`;
    return NextResponse.json({ ok: false, reason: 'error', message, error: message },
      { status: 500, headers: { 'Cache-Control': NO_STORE } });
  }
}

/* ── Pequenos utilitários de leitura ────────────────────────────────────── */

export const str = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));
export const num = (v: unknown): number | null =>
  (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
export const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
