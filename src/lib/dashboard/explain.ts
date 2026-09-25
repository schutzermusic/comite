/**
 * ENTENDER — a cadeia causal de uma exceção do Dashboard V2
 * (`GET /api/dashboard/explain?ref=<kind>:<id>`).
 *
 * Cada elo é um REGISTRO que existe, ou a falta dele dita como falta:
 *  • `found`       — o registro existe e foi lido pelo cliente AUTENTICADO;
 *  • `none`        — a pessoa lê a área e não há registro;
 *  • `restricted`  — a pessoa não lê esta parte (decidido por PERMISSÃO, nunca
 *                    por uma sondagem com service role);
 *  • `unconfirmed` — há vínculo proposto, ambíguo ou com âncora perdida;
 *  • `pending`     — o elo ainda não nasceu por regra (faturamento só nasce do
 *                    aceite do cliente).
 *
 * Três regras que este arquivo não afrouxa:
 *  1. O vínculo atividade → marco contratual é de CONTENÇÃO (a atividade faz
 *     parte da etapa que ancora o marco), lido do mapeamento ACEITO com âncora
 *     viva. Nada aqui propaga datas nem calcula caminho crítico: a palavra
 *     "atrasa" não existe nesta cadeia. Comparação de datas só explícita.
 *  2. Estado e valor de faturamento, NF e recebível são FINANCEIROS (182/183):
 *     só atravessam com `current_user_can_view_project_financials() === true`.
 *  3. Toda leitura confere `.error` — um erro SOBE; nunca vira "sem vínculo".
 */
if (typeof window !== 'undefined') {
  throw new Error('dashboard/explain.ts não pode ser importado no navegador');
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { hasOptionalPermission, type CommercialSession } from '@/lib/commercial/server-session';
import { resolveOwnerNames } from '@/lib/commercial/owner-directory';
import { engagementStatusLabels, serviceOrderStatusLabels } from '@/lib/commercial/labels';
import type { EngagementStatus, ServiceOrderStatus } from '@/lib/commercial/types';
import { href } from '@/components/ax/entity';
import { sourceLink } from '@/lib/decisions/model';
import { selectIn } from '@/lib/supabase/select-in';
import { fromViewRow, type CoverageSummary, type CoverageViewRow } from '@/lib/supply/coverage';
import { SIGNAL_KIND_LABEL, type SignalKind } from '@/lib/supply/intelligence';
import { MEASUREMENT_STATUS_LABEL, type MeasurementStatus } from '@/lib/projects/measurements/types';
import { RECEIVABLE_STATUS_LABEL, RELEASE_LABEL } from '@/lib/contracts/billing/contract-to-cash-display';
import type { BillingReleaseState, ReceivableStatus } from '@/lib/contracts/billing/contract-to-cash-service';
import { isCriticalActivity, isOverdueActivity } from '@/lib/operations/overview-rules';
import { projectIdentity } from '@/lib/operations/project-identity';
import { serviceOrderNextAction } from '@/lib/operations/service-orders/next-action';
import { countsFor } from '@/lib/operations/service-orders/read-model';
import type { ApexNote, ChainLink, Evidence, ExplainKind, ExplainResponse } from './types';
import { APEX_LEAD } from './rules';

/* ── Referência ──────────────────────────────────────────────────────────── */

export const EXPLAIN_KINDS: readonly ExplainKind[] =
  ['mat', 'act', 'proj-act', 'meas', 'os', 'dep', 'risk', 'po', 'bill', 'sig'];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Id de projeto é TEXTO (`qa-scn-tucurui`, `proj-<uuid>`): só um slug seguro, até 120 caracteres. */
const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const TEXT_ID_KINDS: ReadonlySet<ExplainKind> = new Set<ExplainKind>(['proj-act']);

/** `<kind>:<id>` → kind da lista permitida e id validado; `null` para qualquer outra coisa. */
export function parseExplainRef(raw: string | null | undefined): { kind: ExplainKind; id: string } | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 140) return null;
  const at = raw.indexOf(':');
  if (at <= 0) return null;
  const kind = raw.slice(0, at) as ExplainKind;
  const id = raw.slice(at + 1);
  if (!EXPLAIN_KINDS.includes(kind)) return null;
  if (TEXT_ID_KINDS.has(kind)) return SLUG_RE.test(id) ? { kind, id } : null;
  return UUID_RE.test(id) ? { kind, id: id.toLowerCase() } : null;
}

/* ── Leitura conferida ───────────────────────────────────────────────────── */

/** Uma leitura que falhou. A rota a diferencia de "não encontrado" e de "restrito". */
export class ExplainReadError extends Error {
  constructor(what: string, cause?: unknown) {
    super(`Não foi possível ler ${what}.`, cause === undefined ? undefined : { cause });
    this.name = 'ExplainReadError';
  }
}

type ReadResult = { data: unknown; error: { message: string } | null };

function rowsOf<T>(res: ReadResult, what: string): T[] {
  if (res.error) throw new ExplainReadError(what);
  return (Array.isArray(res.data) ? res.data : res.data ? [res.data] : []) as T[];
}

async function inChunks<T>(what: string, ids: readonly (string | null | undefined)[],
  run: (chunk: string[]) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  try {
    return await selectIn<T>(ids, run);
  } catch (cause) {
    throw new ExplainReadError(what, cause);
  }
}

/* ── Formatação ──────────────────────────────────────────────────────────── */

const dayOf = (v: string | null | undefined): string | null => (v ? String(v).slice(0, 10) : null);
/** dd/mm/aaaa */
const br = (iso: string | null | undefined): string | null => {
  const d = dayOf(iso);
  return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : null;
};
/** dd/mm */
const dm = (iso: string | null | undefined): string | null => {
  const d = dayOf(iso);
  return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : null;
};
const qty = (n: number, unit: string | null) =>
  `${n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}${unit ? ` ${unit}` : ''}`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const joinDetail = (...parts: Array<string | null | undefined | false>) => {
  const out = parts.filter((p): p is string => typeof p === 'string' && p.length > 0).join(' · ');
  return out || null;
};

/** Dinheiro — SÓ chamado depois do portão financeiro. */
function money(value: unknown, currency: unknown): string | null {
  const n = Number(value);
  if (value === null || value === undefined || !Number.isFinite(n)) return null;
  const cur = typeof currency === 'string' && /^[A-Z]{3}$/.test(currency) ? currency : 'BRL';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: cur });
}
const moneyCents = (cents: unknown, currency: unknown) =>
  (cents === null || cents === undefined ? null : money(Number(cents) / 100, currency));

/* ── Rótulos locais ──────────────────────────────────────────────────────── */

const PO_STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Rascunho', APPROVAL_REQUIRED: 'Aguardando aprovação', APPROVED: 'Aprovado', ISSUED: 'Emitido',
  PARTIALLY_RECEIVED: 'Recebido em parte', RECEIVED: 'Recebido', CLOSED: 'Encerrado', CANCELLED: 'Cancelado',
};
const FISCAL_STATUS_LABEL: Record<string, string> = {
  draft: 'Rascunho', pending_approval: 'Aguardando aprovação', approved: 'Aprovada', queued: 'Na fila',
  processing: 'Em processamento', authorized: 'Autorizada', rejected: 'Rejeitada', error: 'Com erro',
  cancellation_requested: 'Cancelamento pedido', cancelled: 'Cancelada', replaced: 'Substituída', archived: 'Arquivada',
};
const RISK_SEVERITY_LABEL: Record<string, string> = { low: 'Baixo', medium: 'Médio', high: 'Alto', critical: 'Crítico' };
const RISK_STATUS_LABEL: Record<string, string> = { open: 'Aberto', mitigating: 'Em mitigação', resolved: 'Resolvido' };
const REQUIREMENT_STATUS_LABEL: Record<string, string> = {
  PLANNED: 'Planejado', CONFIRMED: 'Confirmado', CANCELLED: 'Cancelado', SUPERSEDED: 'Substituído',
};

/** Sinais que falam da COBERTURA de um requisito: a leitura ao vivo diz se ainda valem. */
const COVERAGE_SIGNALS: readonly string[] = ['SHORTAGE', 'ALTERNATE_STOCK', 'ETA_RISK'];
/** Medição com o cliente: o faturamento ainda não nasceu — é `pending`, nunca `none`. */
const WITH_CUSTOMER: readonly string[] = ['APPROVED_FOR_CUSTOMER', 'AWAITING_CUSTOMER_ACCEPTANCE'];

/* ── Contexto da leitura ─────────────────────────────────────────────────── */

interface Ctx {
  sb: SupabaseClient;
  org: string;
  today: string;
  can(key: string): Promise<boolean>;
  canAny(keys: readonly string[]): Promise<boolean>;
  /** `current_user_can_view_project_financials() === true` — falha FECHADA. */
  financials(): Promise<boolean>;
  /** O predicado `fr_select`/`fs_select` de Finanças (pago e em aberto só fazem sentido com ele). */
  receivables(): Promise<boolean>;
  projectName(id: string | null): Promise<string | null>;
  timeline(projectId: string): Promise<Map<string, TItem>>;
  owner(userId: string | null): Promise<string | null>;
}

function makeCtx(session: CommercialSession, today: string): Ctx {
  const sb = session.supabase;
  const org = session.organizationId;
  const perms = new Map<string, Promise<boolean>>();
  const can = (key: string) => {
    let p = perms.get(key);
    if (!p) {
      p = hasOptionalPermission(session, key).then((v) => v === true, () => false);
      perms.set(key, p);
    }
    return p;
  };
  const canAny = async (keys: readonly string[]) => (await Promise.all(keys.map(can))).some(Boolean);
  const rpcTrue = async (fn: string, args?: Record<string, unknown>) => {
    try {
      const { data, error } = await sb.rpc(fn, args);
      return !error && data === true;
    } catch {
      return false;
    }
  };
  let fin: Promise<boolean> | null = null;
  let recv: Promise<boolean> | null = null;
  const names = new Map<string, Promise<string | null>>();
  const timelines = new Map<string, Promise<Map<string, TItem>>>();
  return {
    sb, org, today, can, canAny,
    financials: () => (fin ??= rpcTrue('current_user_can_view_project_financials')),
    receivables: () => (recv ??= (async () => (await can('finance.view'))
      || (await rpcTrue('has_finance_role_or_perm', { role_key: 'finance_admin', perm_key: 'finance.admin' }))
      || (await rpcTrue('has_finance_role_or_perm', { role_key: 'finance_analyst', perm_key: 'finance.edit' })))()),
    projectName: (id) => {
      if (!id) return Promise.resolve(null);
      let p = names.get(id);
      if (!p) {
        p = (async () => {
          const rows = rowsOf<{ id: string; project: Record<string, unknown> | null; project_v2: Record<string, unknown> | null }>(
            await sb.from('projects').select('id,project,project_v2').eq('organization_id', org).eq('id', id).limit(1),
            'o projeto');
          return rows[0] ? projectIdentity(rows[0].id, rows[0].project, rows[0].project_v2).name : null;
        })();
        names.set(id, p);
      }
      return p;
    },
    timeline: (projectId) => {
      let p = timelines.get(projectId);
      if (!p) {
        p = (async () => {
          const rows = rowsOf<TItem>(await sb.from('project_timeline_items').select(TIMELINE_COLUMNS)
            .eq('organization_id', org).eq('project_id', projectId).limit(TIMELINE_LIMIT), 'o cronograma do projeto');
          return new Map(rows.map((r) => [r.id, r]));
        })();
        timelines.set(projectId, p);
      }
      return p;
    },
    owner: async (userId) => {
      if (!userId) return null;
      const dir = await resolveOwnerNames(org, [userId]);
      return dir[userId] ?? null;
    },
  };
}

/* ── Cronograma ──────────────────────────────────────────────────────────── */

export interface TItem {
  id: string;
  project_id: string;
  parent_id: string | null;
  title: string;
  wbs_code: string | null;
  status: string;
  priority: string;
  delay_status: string;
  is_milestone: boolean;
  is_summary: boolean;
  is_active: boolean | null;
  deleted_at: string | null;
  planned_start: string | null;
  planned_finish: string | null;
  forecast_finish: string | null;
  actual_finish: string | null;
  responsible_user_id: string | null;
}

const TIMELINE_COLUMNS = 'id,project_id,parent_id,title,wbs_code,status,priority,delay_status,is_milestone,is_summary,'
  + 'is_active,deleted_at,planned_start,planned_finish,forecast_finish,actual_finish,responsible_user_id';
const TIMELINE_LIMIT = 5000;
const MAX_DEPTH = 12;

const alive = (t: TItem | undefined): t is TItem => !!t && t.is_active === true && !t.deleted_at;

/**
 * A atividade e os ancestrais dela (pai, avô…), do mais próximo à raiz —
 * profundidade ≤ 12, com guarda de ciclo. O cronograma é lido UMA vez.
 */
export function chainOf(items: ReadonlyMap<string, { parent_id: string | null }>, id: string, maxDepth = MAX_DEPTH): string[] {
  const out = [id];
  const seen = new Set<string>([id]);
  let cur = items.get(id)?.parent_id ?? null;
  while (cur && !seen.has(cur) && out.length <= maxDepth) {
    out.push(cur);
    seen.add(cur);
    cur = items.get(cur)?.parent_id ?? null;
  }
  return out;
}

/** O próximo marco DO CRONOGRAMA depois do início previsto da atividade — proximidade, não dependência. */
function nextScheduleMilestone(timeline: ReadonlyMap<string, TItem>, activity: TItem): TItem | null {
  const from = activity.planned_start ?? activity.planned_finish;
  if (!from) return null;
  const when = (t: TItem) => t.planned_finish ?? t.planned_start;
  return Array.from(timeline.values())
    .filter((t) => t.id !== activity.id && t.is_milestone && alive(t) && t.project_id === activity.project_id)
    .filter((t) => { const d = when(t); return d !== null && d > from; })
    .sort((a, b) => String(when(a)).localeCompare(String(when(b))))[0] ?? null;
}

/* ── Partes da cadeia ────────────────────────────────────────────────────── */

interface Part { links: ChainLink[]; evidence: Evidence[]; relation: string | null }
const emptyPart = (): Part => ({ links: [], evidence: [], relation: null });

function activityLink(act: TItem, today: string): ChainLink {
  const overdue = isOverdueActivity(act, today);
  return {
    stage: 'Atividade',
    label: act.title,
    detail: joinDetail(act.wbs_code ? `WBS ${act.wbs_code}` : null,
      br(act.planned_start) ? `início previsto ${br(act.planned_start)}` : null,
      br(act.planned_finish) ? `término previsto ${br(act.planned_finish)}` : null),
    state: 'found',
    tone: overdue ? 'danger' : act.delay_status === 'blocked' ? 'danger' : act.delay_status === 'delayed' ? 'warning' : 'neutral',
    href: href.projectSchedule(act.project_id),
    note: !alive(act) ? 'fora do cronograma vigente (desativada ou removida)' : overdue ? 'vencida e em aberto' : null,
  };
}

interface MappingRow {
  id: string; contract_id: string; rule_id: string; timeline_item_id: string;
  review_state: 'accepted' | 'proposed' | 'rejected'; ambiguous_with: string[] | null; reviewed_at: string | null;
}
interface MilestoneRow { id: string; title: string | null; due_date: string | null; contract_id: string }

/**
 * ATIVIDADE → MARCO CONTRATUAL, exatamente:
 *  1) sem `contracts.view` → `restricted`;
 *  2) sem linha em `project_contract_link_governed` → `none` "Projeto sem contrato vinculado";
 *  3) a atividade + ancestrais (cronograma lido uma vez);
 *  4) mapeamento `accepted` com âncora VIVA → regra (`effect <> 'removed'`) → marco;
 *     só proposto/ambíguo/âncora perdida → `unconfirmed`; nada → `none`;
 *  5) leitura de CONTENÇÃO; data só em comparação explícita.
 */
async function contractSegment(ctx: Ctx, activity: TItem, timeline: ReadonlyMap<string, TItem>, needDate: string | null): Promise<Part> {
  const out = emptyPart();
  const projectId = activity.project_id;
  const adjacency = () => {
    const next = nextScheduleMilestone(timeline, activity);
    if (!next) return;
    out.links.push({
      stage: 'Próximo marco do cronograma',
      label: next.title,
      detail: br(next.planned_finish ?? next.planned_start) ? `previsto para ${br(next.planned_finish ?? next.planned_start)}` : null,
      state: 'found',
      tone: 'neutral',
      href: href.projectSchedule(projectId),
      note: 'proximidade no cronograma, não dependência',
    });
  };

  if (!(await ctx.can('contracts.view'))) {
    out.links.push({ stage: 'Marco contratual', label: 'Vínculo contratual restrito',
      detail: 'Seu perfil não lê Contratos.', state: 'restricted', href: null });
    adjacency();
    return out;
  }

  const linked = rowsOf<{ contract_id: string }>(
    await ctx.sb.from('project_contract_link_governed').select('contract_id')
      .eq('organization_id', ctx.org).eq('project_id', projectId),
    'o vínculo do projeto com contrato');
  if (linked.length === 0) {
    out.links.push({ stage: 'Marco contratual', label: 'Projeto sem contrato vinculado',
      detail: 'Sem vínculo projeto ↔ contrato, a prontidão contratual é desconhecida.', state: 'none', href: null });
    adjacency();
    return out;
  }
  const contracts = new Set(linked.map((l) => l.contract_id));
  const firstContract = linked[0].contract_id;

  const chain = chainOf(timeline, activity.id);
  const depth = (id: string) => { const i = chain.indexOf(id); return i < 0 ? Number.MAX_SAFE_INTEGER : i; };

  const mappings = (await inChunks<MappingRow>('o vínculo da atividade com o contrato', chain,
    (c) => ctx.sb.from('contract_measurement_rule_timeline_mappings')
      .select('id,contract_id,rule_id,timeline_item_id,review_state,ambiguous_with,reviewed_at')
      .eq('organization_id', ctx.org).eq('project_id', projectId)
      .in('review_state', ['accepted', 'proposed']).in('timeline_item_id', c)))
    .filter((m) => contracts.has(m.contract_id));

  const rules = await inChunks<{ id: string; milestone_id: string | null }>('as regras de medição do contrato',
    mappings.map((m) => m.rule_id),
    (c) => ctx.sb.from('contract_measurement_requirements').select('id,milestone_id')
      .eq('organization_id', ctx.org).neq('effect', 'removed').in('id', c));
  const milestoneOfRule = new Map<string, string>();
  for (const r of rules) if (r.milestone_id) milestoneOfRule.set(r.id, r.milestone_id);

  const usable = mappings.filter((m) => milestoneOfRule.has(m.rule_id))
    .sort((a, b) => depth(a.timeline_item_id) - depth(b.timeline_item_id));
  const accepted = usable.filter((m) => m.review_state === 'accepted' && alive(timeline.get(m.timeline_item_id)));
  const unconfirmed = usable.filter((m) => !accepted.includes(m));

  const milestoneRows = await inChunks<MilestoneRow>('os marcos do contrato',
    usable.map((m) => milestoneOfRule.get(m.rule_id)),
    (c) => ctx.sb.from('contract_milestones').select('id,title,due_date,contract_id')
      .eq('organization_id', ctx.org).in('id', c));
  const milestones = new Map(milestoneRows.map((m) => [m.id, m]));
  const titleOf = (milestoneId: string | undefined) =>
    (milestoneId ? milestones.get(milestoneId)?.title : null) ?? 'marco contratual';

  if (accepted.length > 0) {
    const best = accepted[0];
    const milestoneId = milestoneOfRule.get(best.rule_id)!;
    const milestone = milestones.get(milestoneId) ?? null;
    const anchor = timeline.get(best.timeline_item_id)!;
    const others = new Set(accepted.map((m) => milestoneOfRule.get(m.rule_id))).size - 1;
    const self = anchor.id === activity.id;
    out.links.push({
      stage: 'Marco contratual',
      label: titleOf(milestoneId),
      detail: joinDetail(self ? 'âncora: a própria atividade' : `âncora: etapa ${anchor.title}`,
        milestone?.due_date ? `prazo do marco ${br(milestone.due_date)}` : null,
        others > 0 ? `+${plural(others, 'outro marco vinculado', 'outros marcos vinculados')}` : null),
      state: 'found',
      tone: 'neutral',
      href: `/contratos/${encodeURIComponent(best.contract_id)}?tab=billing`,
      note: best.reviewed_at ? `vínculo aceito em ${br(best.reviewed_at)}` : 'vínculo aceito',
    });
    let relation = self
      ? `A atividade é a própria etapa que ancora o marco ${titleOf(milestoneId)}.`
      : `A atividade faz parte da etapa ${anchor.title}, que ancora o marco ${titleOf(milestoneId)}.`;
    const anchorFinish = anchor.forecast_finish ?? anchor.planned_finish;
    if (needDate && anchorFinish && needDate > anchorFinish) {
      relation += ` Comparação de datas: a necessidade (${dm(needDate)}) é depois do término previsto da etapa (${dm(anchorFinish)}).`;
    }
    out.relation = relation;
    out.evidence.push({ label: 'Vínculo aceito', value: `${anchor.title} → ${titleOf(milestoneId)}`,
      source: 'Contratos · mapeamento regra de medição ↔ cronograma' });
    out.links.push(...(await milestoneMeasurementSegment(ctx, projectId, milestoneId)));
    return out;
  }

  if (unconfirmed.length > 0) {
    const u = unconfirmed[0];
    const where = timeline.get(u.timeline_item_id)?.title ?? 'etapa fora do cronograma';
    const why = u.review_state === 'accepted'
      ? 'âncora perdida: a etapa saiu do cronograma'
      : (u.ambiguous_with?.length ?? 0) > 0
        ? `ambíguo entre ${(u.ambiguous_with?.length ?? 0) + 1} etapas`
        : 'proposto, sem revisão';
    out.links.push({
      stage: 'Marco contratual',
      label: 'Vínculo proposto — confirmar em Contratos',
      detail: joinDetail(why, `${where} → ${titleOf(milestoneOfRule.get(u.rule_id))}`),
      state: 'unconfirmed',
      tone: 'warning',
      href: `/contratos/${encodeURIComponent(u.contract_id)}?tab=billing`,
    });
    adjacency();
    return out;
  }

  out.links.push({
    stage: 'Marco contratual',
    label: 'sem vínculo registrado',
    detail: 'Nenhuma etapa desta atividade (nem as que a contêm) está vinculada a um marco do contrato.',
    state: 'none',
    href: `/contratos/${encodeURIComponent(firstContract)}?tab=billing`,
  });
  adjacency();
  return out;
}

/* ── Medição → Faturamento → NF → Recebível ─────────────────────────────── */

interface MeasurementRow {
  id: string; project_id: string; contract_id: string | null; timeline_item_id: string | null; milestone_id: string | null;
  status: MeasurementStatus; occurrence_key: string | null; expected_at: string | null; customer_due_at: string | null;
}
const MEASUREMENT_COLUMNS = 'id,project_id,contract_id,timeline_item_id,milestone_id,status,occurrence_key,expected_at,customer_due_at';

function measurementLink(m: MeasurementRow): ChainLink {
  const label = MEASUREMENT_STATUS_LABEL[m.status] ?? m.status;
  return {
    stage: 'Medição',
    label: m.occurrence_key ? `Medição ${m.occurrence_key}` : 'Medição',
    detail: joinDetail(label, br(m.customer_due_at) ? `prazo do cliente ${br(m.customer_due_at)}`
      : br(m.expected_at) ? `prevista para ${br(m.expected_at)}` : null),
    state: 'found',
    tone: m.status === 'ACCEPTED' ? 'success'
      : m.status === 'RETURNED_FOR_CORRECTION' || m.status === 'CUSTOMER_CORRECTION_REQUESTED' || m.status === 'REJECTED' ? 'danger'
        : WITH_CUSTOMER.includes(m.status) ? 'warning' : 'neutral',
    href: href.project(m.project_id, 'measurements'),
  };
}

async function milestoneMeasurementSegment(ctx: Ctx, projectId: string, milestoneId: string): Promise<ChainLink[]> {
  if (!(await ctx.canAny(['projects.measurements.view', 'projects.view']))) {
    return [{ stage: 'Medição', label: 'Medição restrita', detail: 'Seu perfil não lê medições de projeto.', state: 'restricted', href: null }];
  }
  const m = rowsOf<MeasurementRow>(
    await ctx.sb.from('project_measurements').select(MEASUREMENT_COLUMNS)
      .eq('organization_id', ctx.org).eq('project_id', projectId).eq('milestone_id', milestoneId)
      .is('superseded_by_id', null).not('status', 'in', '(CANCELLED,SUPERSEDED)')
      .order('created_at', { ascending: false }).limit(1),
    'a medição do marco')[0];
  if (!m) {
    return [
      { stage: 'Medição', label: 'sem medição registrada para o marco', detail: null, state: 'none', href: href.project(projectId, 'measurements') },
      { stage: 'Faturamento', label: 'ainda não nasceu', detail: 'O faturamento nasce do aceite do cliente sobre a medição.', state: 'pending', href: null },
    ];
  }
  return [measurementLink(m), ...(await billingSegment(ctx, m))];
}

interface CashRow {
  billing_event_id: string; title: string | null; contract_id: string | null; milestone_id: string | null;
  source_measurement_id: string | null;
  release_state?: BillingReleaseState | null; eligible_amount?: number | string | null; currency?: string | null;
  fiscal_document_id?: string | null; fiscal_document_status?: string | null; fiscal_document_number?: string | null;
  receivable_id?: string | null; receivable_status?: ReceivableStatus | null; open_amount_cents?: number | string | null;
  due_date?: string | null; cancelled_at?: string | null;
}
/** Colunas NÃO financeiras: identificam o evento sem dizer estado nem valor. */
const CASH_IDENTITY_COLUMNS = 'billing_event_id,title,contract_id,milestone_id,source_measurement_id';
/** Estado e valor — só depois do portão financeiro. */
const CASH_FINANCIAL_COLUMNS = `${CASH_IDENTITY_COLUMNS},release_state,eligible_amount,currency,fiscal_document_id,`
  + 'fiscal_document_status,fiscal_document_number,receivable_id,receivable_status,open_amount_cents,due_date,cancelled_at';

const billingRestricted = (): ChainLink => ({
  stage: 'Faturamento', label: 'Faturamento restrito',
  detail: 'Estado e valor de faturamento, NF e recebível exigem visibilidade financeira.', state: 'restricted', href: null,
});

/** Portão de dinheiro: RPC financeira `=== true` E leitura dos eventos (`contracts.view_values` OU `finance.view`, RLS). */
async function financialGate(ctx: Ctx): Promise<boolean> {
  if (!(await ctx.financials())) return false;
  return ctx.canAny(['contracts.view_values', 'finance.view']);
}

async function billingSegment(ctx: Ctx, m: Pick<MeasurementRow, 'id' | 'status'>): Promise<ChainLink[]> {
  if (WITH_CUSTOMER.includes(m.status)) {
    return [{ stage: 'Faturamento', label: 'aguardando aceite do cliente',
      detail: 'O evento de faturamento só nasce quando o cliente aceita a medição.', state: 'pending', tone: 'warning', href: null }];
  }
  if (m.status === 'REJECTED') {
    return [{ stage: 'Faturamento', label: 'medição rejeitada', detail: 'Medição rejeitada não gera faturamento.', state: 'none', href: null }];
  }
  if (m.status !== 'ACCEPTED') {
    return [{ stage: 'Faturamento', label: 'ainda não nasceu',
      detail: `O faturamento nasce do aceite do cliente; a medição está "${MEASUREMENT_STATUS_LABEL[m.status] ?? m.status}".`,
      state: 'pending', href: null }];
  }
  if (!(await financialGate(ctx))) return [billingRestricted()];
  const row = rowsOf<CashRow>(
    await ctx.sb.from('contract_to_cash_read_model').select(CASH_FINANCIAL_COLUMNS)
      .eq('organization_id', ctx.org).eq('source_measurement_id', m.id).is('superseded_by_id', null).limit(1),
    'o faturamento da medição')[0];
  if (!row) {
    return [{ stage: 'Faturamento', label: 'sem evento de faturamento registrado',
      detail: 'A medição foi aceita, mas não há evento de faturamento vigente para ela.', state: 'none', tone: 'warning', href: null }];
  }
  return cashLinks(ctx, row);
}

/** Faturamento → NF → Recebível. Chamado SÓ com o portão financeiro aberto. */
async function cashLinks(ctx: Ctx, row: CashRow): Promise<ChainLink[]> {
  const release = row.release_state ?? null;
  const open = release === 'ELIGIBLE' || release === 'PENDING_RELEASE';
  const links: ChainLink[] = [{
    stage: 'Faturamento',
    label: release ? RELEASE_LABEL[release] ?? release : 'Evento de faturamento',
    detail: joinDetail(row.title, money(row.eligible_amount, row.currency) ? `valor elegível ${money(row.eligible_amount, row.currency)}` : null),
    state: 'found',
    tone: release === 'RELEASED' ? 'success' : release === 'RELEASE_REJECTED' ? 'danger' : open ? 'warning' : 'neutral',
    href: sourceLink('contract_billing_event', row.billing_event_id, open).href,
  }];

  const fiscal = row.fiscal_document_status ?? null;
  if (fiscal) {
    links.push({ stage: 'NF', label: `NF ${row.fiscal_document_number ?? 'sem número'}`,
      detail: FISCAL_STATUS_LABEL[fiscal] ?? fiscal, state: 'found',
      tone: fiscal === 'authorized' ? 'success' : fiscal === 'rejected' || fiscal === 'error' ? 'danger' : 'neutral', href: null });
  } else if (release === 'RELEASED') {
    links.push({ stage: 'NF', label: 'sem NF emitida', detail: 'Faturamento liberado sem nota fiscal registrada.', state: 'none', tone: 'warning', href: null });
  } else {
    links.push({ stage: 'NF', label: 'ainda não nasceu', detail: 'A NF só é pedida depois da liberação do faturamento.', state: 'pending', href: null });
  }

  if (!(await ctx.receivables())) {
    links.push({ stage: 'Recebível', label: 'Recebível restrito', detail: 'Seu perfil não lê títulos de Finanças.', state: 'restricted', href: null });
  } else if (row.receivable_id) {
    const status = row.receivable_status ?? null;
    links.push({
      stage: 'Recebível',
      label: status ? RECEIVABLE_STATUS_LABEL[status] ?? status : 'Título em Finanças',
      detail: joinDetail(br(row.due_date) ? `vence ${br(row.due_date)}` : null,
        moneyCents(row.open_amount_cents, row.currency) ? `em aberto ${moneyCents(row.open_amount_cents, row.currency)}` : null),
      state: 'found',
      tone: status === 'OVERDUE' ? 'danger' : status === 'PAID' ? 'success' : 'neutral',
      href: '/financeiro/contas-pagar-receber',
    });
  } else if (fiscal === 'authorized') {
    links.push({ stage: 'Recebível', label: 'sem título em Finanças', detail: 'NF autorizada sem recebível vinculado.', state: 'none', tone: 'warning', href: null });
  } else {
    links.push({ stage: 'Recebível', label: 'ainda não nasceu', detail: 'O título nasce da NF autorizada.', state: 'pending', href: null });
  }
  return links;
}

/* ── Atividade (e o que vem depois dela) ────────────────────────────────── */

interface ActivityPart extends Part { activity: TItem | null; needDate: string | null }

/** Atividade → marco contratual → medição → faturamento. `requiredBy` entra na data de necessidade (material). */
async function activitySegment(ctx: Ctx, projectId: string, activityId: string | null, requiredBy: string | null): Promise<ActivityPart> {
  const out: ActivityPart = { ...emptyPart(), activity: null, needDate: dayOf(requiredBy) };
  if (!activityId) {
    out.links.push({ stage: 'Atividade', label: 'sem atividade vinculada', detail: null, state: 'none', href: href.projectSchedule(projectId) });
    return out;
  }
  if (!(await ctx.canAny(['projects.view', 'projects.timeline.view']))) {
    out.links.push({ stage: 'Atividade', label: 'Cronograma restrito', detail: 'Seu perfil não lê o cronograma do projeto.', state: 'restricted', href: null });
    return out;
  }
  const timeline = await ctx.timeline(projectId);
  const act = timeline.get(activityId);
  if (!act) {
    out.links.push({ stage: 'Atividade', label: 'atividade não encontrada no cronograma', detail: null, state: 'none', href: href.projectSchedule(projectId) });
    return out;
  }
  out.activity = act;
  const dates = [dayOf(requiredBy), dayOf(act.planned_start)].filter((d): d is string => !!d).sort();
  out.needDate = dates[0] ?? null;
  out.links.push(activityLink(act, ctx.today));
  const contract = await contractSegment(ctx, act, timeline, out.needDate);
  out.links.push(...contract.links);
  out.evidence.push(...contract.evidence);
  out.relation = contract.relation;
  return out;
}

/* ── Apex ────────────────────────────────────────────────────────────────── */

interface SignalRow {
  id: string; kind: SignalKind; severity: ApexNote['severity']; status: string; project_id: string | null;
  requirement_id: string | null; purchase_order_id: string | null; title: string; rationale: string;
  evidence: unknown; engine_version: string | null; last_seen_at: string | null;
}
const SIGNAL_COLUMNS = 'id,kind,severity,status,project_id,requirement_id,purchase_order_id,title,rationale,evidence,engine_version,last_seen_at';
const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

function evidenceOf(raw: unknown): Evidence[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((e) => {
    if (!e || typeof e !== 'object') return [];
    const r = e as Record<string, unknown>;
    if (typeof r.label !== 'string' || (typeof r.value !== 'string' && typeof r.value !== 'number')) return [];
    return [{ label: r.label, value: String(r.value), source: typeof r.source === 'string' ? r.source : null }];
  });
}

function apexNote(s: SignalRow, stale: boolean): ApexNote {
  return {
    signalId: s.id, kind: s.kind, severity: s.severity,
    lead: APEX_LEAD[s.kind] ?? `Apex identificou: ${SIGNAL_KIND_LABEL[s.kind] ?? s.kind}`,
    title: s.title, rationale: s.rationale, evidence: evidenceOf(s.evidence),
    ranAt: s.last_seen_at, engineVersion: s.engine_version, stale,
  };
}

async function openSignal(ctx: Ctx, column: 'requirement_id' | 'purchase_order_id', id: string, kinds: readonly string[]): Promise<SignalRow | null> {
  const rows = rowsOf<SignalRow>(
    await ctx.sb.from('supply_signals').select(SIGNAL_COLUMNS)
      .eq('organization_id', ctx.org).eq(column, id).eq('status', 'OPEN').in('kind', [...kinds]).limit(20),
    'os achados da Apex');
  return rows.sort((a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9))[0] ?? null;
}

/* ── Rascunho da resposta ────────────────────────────────────────────────── */

type Ok = Extract<ExplainResponse, { ok: true }>;
type Fail = Extract<ExplainResponse, { ok: false }>;
type Draft = Omit<Ok, 'ok' | 'ref' | 'asOf'>;

async function missing(ctx: Ctx, readKeys: readonly string[], what: string): Promise<Fail> {
  return (await ctx.canAny(readKeys))
    ? { ok: false, reason: 'not_found', message: `Não encontramos ${what} nesta organização.` }
    : { ok: false, reason: 'restricted', message: `Seu perfil não lê ${what}.` };
}

const isFail = <T extends object>(x: T | Fail): x is Fail => (x as Partial<Fail>).ok === false;

/* ── mat / dep ───────────────────────────────────────────────────────────── */

interface RequirementRow {
  id: string; project_id: string; activity_id: string | null; title: string; requirement_type: string;
  required_by: string | null; status: string; quantity: number | string | null; unit: string | null;
}
const REQUIREMENT_READ = ['projects.view', 'operations.planning.view'];

async function readRequirement(ctx: Ctx, id: string): Promise<RequirementRow | null> {
  return rowsOf<RequirementRow>(
    await ctx.sb.from('project_requirements')
      .select('id,project_id,activity_id,title,requirement_type,required_by,status,quantity,unit')
      .eq('organization_id', ctx.org).eq('id', id).limit(1),
    'o requisito')[0] ?? null;
}

function shortageProblem(c: CoverageSummary, unit: string | null): string {
  if (c.shortage <= 0) return c.status === 'COVERED' ? 'Coberto na leitura ao vivo' : 'Coberto com entrada na leitura ao vivo';
  const missingText = `Falta ${qty(c.shortage, unit)}`;
  if (c.requested > 0) return `${missingText} — requisitado, sem pedido emitido`;
  if (c.inbound > 0) return `${missingText} — a entrada não cobre`;
  return `${missingText} — sem estoque nem pedido`;
}

async function explainMaterial(ctx: Ctx, id: string): Promise<{ draft: Draft; coverage: CoverageSummary | null } | Fail> {
  const req = await readRequirement(ctx, id);
  if (!req) return missing(ctx, REQUIREMENT_READ, 'o requisito de material');
  const coverageRow = rowsOf<CoverageViewRow>(
    await ctx.sb.from('supply_requirement_coverage').select('*').eq('organization_id', ctx.org).eq('requirement_id', id).limit(1),
    'a cobertura do requisito')[0];
  const cov = coverageRow ? fromViewRow(coverageRow) : null;
  const unit = coverageRow?.unit ?? req.unit ?? null;
  const [project, act, signal] = await Promise.all([
    ctx.projectName(req.project_id),
    activitySegment(ctx, req.project_id, req.activity_id, req.required_by),
    openSignal(ctx, 'requirement_id', id, COVERAGE_SIGNALS),
  ]);

  const evidence: Evidence[] = [];
  const src = 'Supply · cobertura ao vivo';
  if (cov) {
    evidence.push(
      { label: 'Requerido', value: qty(cov.required, unit), source: src },
      { label: 'Reservado', value: qty(cov.reserved, unit), source: src },
      { label: 'Em trânsito', value: qty(cov.inTransit, unit), source: src },
      { label: 'Em pedido', value: qty(cov.onOrder, unit), source: src },
      { label: 'Em inspeção', value: qty(cov.inspection, unit), source: src },
      { label: 'Requisitado sem pedido', value: qty(cov.requested, unit), source: src },
      { label: 'Falta', value: qty(cov.shortage, unit), source: src },
    );
  }
  if (act.needDate) evidence.push({ label: 'Data de necessidade', value: br(act.needDate) ?? act.needDate,
    source: 'menor entre a data do requisito e o início previsto da atividade' });
  evidence.push(...act.evidence);

  const problem = cov ? shortageProblem(cov, unit) : 'Sem leitura de cobertura para o requisito';
  const materialLink: ChainLink = {
    stage: 'Material',
    label: req.title,
    detail: joinDetail(cov ? problem : null, br(act.needDate) ? `necessidade ${br(act.needDate)}` : null),
    state: cov ? 'found' : 'none',
    tone: cov ? (cov.shortage > 0 ? 'danger' : 'success') : 'neutral',
    href: href.requirement(id),
  };
  const draft: Draft = {
    title: `Falta de material · ${req.title}`,
    detected: { object: req.title, problem, due: act.needDate, owner: null, location: project },
    chain: [materialLink, ...act.links],
    relation: act.relation,
    evidence,
    apex: signal ? apexNote(signal, cov !== null && cov.shortage <= 0) : null,
    nextAction: { label: 'Cobrir falta', href: href.requirement(id), focused: true },
    rule: 'Material: requisito confirmado com falta (requerido − reservado − consumido − em trânsito − em pedido − em inspeção > 0) '
      + 'perto da data de necessidade (até 14 dias) ou já vencido. Necessidade = menor entre a data do requisito e o início da atividade.',
  };
  return { draft, coverage: cov };
}

async function explainDependency(ctx: Ctx, id: string): Promise<Draft | Fail> {
  const req = await readRequirement(ctx, id);
  if (!req || req.requirement_type !== 'CUSTOMER_DEPENDENCY') return missing(ctx, REQUIREMENT_READ, 'a dependência do cliente');
  const [project, act] = await Promise.all([
    ctx.projectName(req.project_id),
    activitySegment(ctx, req.project_id, req.activity_id, req.required_by),
  ]);
  const overdue = !!req.required_by && dayOf(req.required_by)! < ctx.today;
  return {
    title: `Dependência do cliente · ${req.title}`,
    detected: { object: req.title, problem: overdue ? 'Dependência do cliente vencida' : 'Dependência do cliente em aberto',
      due: dayOf(req.required_by), owner: null, location: project },
    chain: [{
      stage: 'Dependência do cliente', label: req.title,
      detail: joinDetail(REQUIREMENT_STATUS_LABEL[req.status] ?? req.status, br(req.required_by) ? `até ${br(req.required_by)}` : null),
      state: 'found', tone: overdue ? 'danger' : 'warning', href: href.projectSchedule(req.project_id),
    }, ...act.links],
    relation: act.relation,
    evidence: [
      ...(req.required_by ? [{ label: 'Prazo do cliente', value: br(req.required_by)!, source: 'Planejamento · requisito do projeto' }] : []),
      ...act.evidence,
    ],
    apex: null,
    nextAction: { label: 'Cobrar cliente', href: href.projectSchedule(req.project_id), focused: false },
    rule: 'Dependência do cliente: requisito do tipo "dependência do cliente" confirmado, ainda não atendido, com o prazo vencido.',
  };
}

/* ── act / proj-act ──────────────────────────────────────────────────────── */

const TIMELINE_READ = ['projects.view', 'projects.timeline.view'];

function activityProblem(a: TItem, today: string): string {
  if (isOverdueActivity(a, today)) return a.delay_status === 'blocked' ? 'Atividade bloqueada e vencida' : 'Atividade vencida em aberto';
  if (isCriticalActivity(a, today)) return 'Atividade crítica';
  return 'Atividade do cronograma';
}

const OVERDUE_RULE = 'Atividade vencida: folha do cronograma (não resumo), ativa, nem concluída nem cancelada, '
  + 'com término previsto antes de hoje.';

async function explainActivityItem(ctx: Ctx, act: TItem, extra?: { count: number; blocked: number }): Promise<Draft> {
  const [project, owner, seg] = await Promise.all([
    ctx.projectName(act.project_id),
    ctx.owner(act.responsible_user_id),
    activitySegment(ctx, act.project_id, act.id, null),
  ]);
  const problem = extra
    ? `${plural(extra.count, 'atividade vencida', 'atividades vencidas')}${extra.blocked ? ` (${extra.blocked} bloqueada${extra.blocked === 1 ? '' : 's'})` : ''}`
    : activityProblem(act, ctx.today);
  const evidence: Evidence[] = [];
  if (act.planned_finish) evidence.push({ label: 'Término previsto', value: br(act.planned_finish)!, source: 'Cronograma do projeto' });
  if (extra) evidence.push({ label: 'Mais antiga vencida', value: act.title, source: 'Cronograma do projeto' });
  evidence.push(...seg.evidence);
  return {
    title: extra ? `Atividades vencidas · ${project ?? act.project_id}` : act.title,
    detected: { object: extra ? (project ?? act.project_id) : act.title, problem, due: dayOf(act.planned_finish), owner, location: project },
    chain: seg.links,
    relation: seg.relation,
    evidence,
    apex: null,
    nextAction: { label: 'Abrir cronograma', href: href.projectSchedule(act.project_id), focused: false },
    rule: OVERDUE_RULE,
  };
}

async function explainActivity(ctx: Ctx, id: string): Promise<Draft | Fail> {
  const head = rowsOf<{ id: string; project_id: string }>(
    await ctx.sb.from('project_timeline_items').select('id,project_id').eq('organization_id', ctx.org).eq('id', id).limit(1),
    'a atividade')[0];
  if (!head) return missing(ctx, TIMELINE_READ, 'a atividade');
  const timeline = await ctx.timeline(head.project_id);
  const act = timeline.get(id);
  if (!act) return missing(ctx, TIMELINE_READ, 'a atividade');
  return explainActivityItem(ctx, act);
}

async function explainProjectActivities(ctx: Ctx, projectId: string): Promise<Draft | Fail> {
  if (!(await ctx.canAny(TIMELINE_READ))) return { ok: false, reason: 'restricted', message: 'Seu perfil não lê o cronograma do projeto.' };
  const timeline = await ctx.timeline(projectId);
  const overdue = Array.from(timeline.values())
    .filter((a) => alive(a) && isOverdueActivity(a, ctx.today))
    .sort((a, b) => String(a.planned_finish).localeCompare(String(b.planned_finish)));
  if (overdue.length === 0) return { ok: false, reason: 'not_found', message: 'Nenhuma atividade vencida neste projeto agora.' };
  return explainActivityItem(ctx, overdue[0], {
    count: overdue.length, blocked: overdue.filter((a) => a.delay_status === 'blocked').length,
  });
}

/* ── meas ────────────────────────────────────────────────────────────────── */

async function explainMeasurement(ctx: Ctx, id: string): Promise<Draft | Fail> {
  const m = rowsOf<MeasurementRow>(
    await ctx.sb.from('project_measurements').select(MEASUREMENT_COLUMNS).eq('organization_id', ctx.org).eq('id', id).limit(1),
    'a medição')[0];
  if (!m) return missing(ctx, ['projects.measurements.view', 'projects.view'], 'a medição');

  const links: ChainLink[] = [measurementLink(m)];
  const evidence: Evidence[] = [{ label: 'Estado', value: MEASUREMENT_STATUS_LABEL[m.status] ?? m.status, source: 'Medição do projeto' }];
  let activityTitle: string | null = null;

  if (m.timeline_item_id) {
    if (await ctx.canAny(TIMELINE_READ)) {
      const act = (await ctx.timeline(m.project_id)).get(m.timeline_item_id);
      if (act) { links.push(activityLink(act, ctx.today)); activityTitle = act.title; }
      else links.push({ stage: 'Atividade', label: 'atividade não encontrada no cronograma', detail: null, state: 'none', href: href.projectSchedule(m.project_id) });
    } else {
      links.push({ stage: 'Atividade', label: 'Cronograma restrito', detail: null, state: 'restricted', href: null });
    }
  } else {
    links.push({ stage: 'Atividade', label: 'sem atividade vinculada', detail: null, state: 'none', href: null });
  }

  let milestoneTitle: string | null = null;
  if (!m.milestone_id) {
    links.push({ stage: 'Marco contratual', label: 'sem marco contratual na medição', detail: null, state: 'none', href: null });
  } else if (!(await ctx.can('contracts.view'))) {
    links.push({ stage: 'Marco contratual', label: 'Vínculo contratual restrito', detail: 'Seu perfil não lê Contratos.', state: 'restricted', href: null });
  } else {
    const ms = rowsOf<MilestoneRow>(
      await ctx.sb.from('contract_milestones').select('id,title,due_date,contract_id')
        .eq('organization_id', ctx.org).eq('id', m.milestone_id).limit(1),
      'o marco da medição')[0];
    if (ms) {
      milestoneTitle = ms.title ?? 'marco contratual';
      links.push({ stage: 'Marco contratual', label: milestoneTitle,
        detail: ms.due_date ? `prazo do marco ${br(ms.due_date)}` : null, state: 'found', tone: 'neutral',
        href: `/contratos/${encodeURIComponent(ms.contract_id)}?tab=billing` });
    } else {
      links.push({ stage: 'Marco contratual', label: 'marco não encontrado', detail: null, state: 'none', href: null });
    }
  }

  links.push(...(await billingSegment(ctx, m)));
  const project = await ctx.projectName(m.project_id);
  const needsFix = m.status === 'RETURNED_FOR_CORRECTION' || m.status === 'CUSTOMER_CORRECTION_REQUESTED';
  return {
    title: m.occurrence_key ? `Medição ${m.occurrence_key}` : 'Medição',
    detected: { object: m.occurrence_key ? `Medição ${m.occurrence_key}` : 'Medição',
      problem: MEASUREMENT_STATUS_LABEL[m.status] ?? m.status, due: dayOf(m.customer_due_at ?? m.expected_at), owner: null, location: project },
    chain: links,
    relation: milestoneTitle
      ? `A medição foi registrada para o marco ${milestoneTitle}${activityTitle ? ` e para a atividade ${activityTitle}` : ''}.`
      : null,
    evidence,
    apex: null,
    nextAction: {
      label: needsFix ? 'Corrigir medição' : WITH_CUSTOMER.includes(m.status) ? 'Acompanhar aceite' : 'Abrir medição',
      href: href.project(m.project_id, 'measurements'), focused: false,
    },
    rule: 'Medição: devolvida ou com correção pedida pelo cliente entra na fila. O faturamento só nasce do aceite do cliente.',
  };
}

/* ── os ──────────────────────────────────────────────────────────────────── */

interface OsRow {
  id: string; engagement_id: string; os_number: string; title: string; status: ServiceOrderStatus; project_id: string | null;
  planned_start: string | null; responsible_user_id: string | null; source_context_acceptance_id: string | null;
}

async function explainServiceOrder(ctx: Ctx, id: string): Promise<Draft | Fail> {
  // O mesmo portão da linha na fila: sem `operations.view`, a OS não aparece no Dashboard.
  if (!(await ctx.can('operations.view'))) return { ok: false, reason: 'restricted', message: 'Seu perfil não lê ordens de serviço.' };
  const os = rowsOf<OsRow>(
    await ctx.sb.from('internal_service_orders')
      .select('id,engagement_id,os_number,title,status,project_id,planned_start,responsible_user_id,source_context_acceptance_id')
      .eq('organization_id', ctx.org).eq('id', id).limit(1),
    'a ordem de serviço')[0];
  if (!os) return { ok: false, reason: 'not_found', message: 'Não encontramos a ordem de serviço nesta organização.' };

  const [countsMap, blocking, owner] = await Promise.all([
    countsFor(ctx.org, [{ id: os.id, engagement_id: os.engagement_id }]),
    ctx.sb.from('commercial_divergences').select('id,summary,field_path')
      .eq('organization_id', ctx.org).eq('service_order_id', os.id).eq('severity', 'BLOCKING').eq('state', 'OPEN').limit(50)
      .then((r) => rowsOf<{ id: string; summary: string | null; field_path: string | null }>(r, 'as divergências da OS')),
    ctx.owner(os.responsible_user_id),
  ]);
  const counts = countsMap.get(os.id) ?? { items: 0, unreviewedItems: 0, openDivergences: 0, blockingOpen: 0 };
  const next = serviceOrderNextAction(os.status, os.project_id, counts);
  const statusLabel = serviceOrderStatusLabels[os.status] ?? os.status;

  const links: ChainLink[] = [{
    stage: 'OS', label: `OS ${os.os_number}`, detail: joinDetail(statusLabel, next.label), state: 'found',
    tone: next.tone === 'danger' ? 'danger' : next.tone === 'warning' ? 'warning' : next.tone === 'success' ? 'success' : 'neutral',
    href: href.serviceOrder(os.id),
  }];
  links.push(blocking.length > 0
    ? { stage: 'Divergências bloqueantes', label: plural(blocking.length, 'divergência bloqueante aberta', 'divergências bloqueantes abertas'),
        detail: joinDetail(...blocking.slice(0, 3).map((d) => d.summary ?? d.field_path)), state: 'found', tone: 'danger', href: href.serviceOrder(os.id) }
    : { stage: 'Divergências bloqueantes', label: 'nenhuma divergência bloqueante aberta na OS', detail: null, state: 'none', href: null });

  // Autorização — só se legível (`contracts.view`, RLS de `commercial_engagements`).
  if (await ctx.can('contracts.view')) {
    const eng = rowsOf<{ id: string; engagement_number: string | null; title: string | null; status: EngagementStatus; authorized_at: string | null }>(
      await ctx.sb.from('commercial_engagements').select('id,engagement_number,title,status,authorized_at')
        .eq('organization_id', ctx.org).eq('id', os.engagement_id).limit(1),
      'o trabalho autorizado da OS')[0];
    links.push(eng
      ? { stage: 'Autorização', label: eng.engagement_number ? `Trabalho autorizado ${eng.engagement_number}` : (eng.title ?? 'Trabalho autorizado'),
          detail: joinDetail(engagementStatusLabels[eng.status] ?? eng.status, br(eng.authorized_at) ? `autorizado em ${br(eng.authorized_at)}` : null),
          state: 'found', tone: eng.status === 'AUTHORIZED' ? 'success' : 'warning', href: null }
      : { stage: 'Autorização', label: 'sem trabalho autorizado registrado', detail: null, state: 'none', href: null });
  } else {
    links.push({ stage: 'Autorização', label: 'Autorização restrita', detail: 'Seu perfil não lê trabalhos autorizados.', state: 'restricted', href: null });
  }
  if (os.source_context_acceptance_id) {
    if (await ctx.can('commercial.view')) {
      const acc = rowsOf<{ id: string; accepted_at: string | null; complete: boolean | null }>(
        await ctx.sb.from('commercial_proposal_context_acceptances').select('id,accepted_at,complete')
          .eq('organization_id', ctx.org).eq('id', os.source_context_acceptance_id).limit(1),
        'o aceite da proposta')[0];
      links.push(acc
        ? { stage: 'Proposta aceita', label: 'Aceite do cliente registrado',
            detail: joinDetail(br(acc.accepted_at) ? `em ${br(acc.accepted_at)}` : null, acc.complete === false ? 'aceite parcial' : null),
            state: 'found', tone: 'success', href: null }
        : { stage: 'Proposta aceita', label: 'aceite não encontrado', detail: null, state: 'none', href: null });
    } else {
      links.push({ stage: 'Proposta aceita', label: 'Aceite restrito', detail: 'Seu perfil não lê o Comercial.', state: 'restricted', href: null });
    }
  }

  // Projeto vinculado.
  if (!os.project_id) {
    links.push({ stage: 'Projeto', label: 'sem projeto vinculado', detail: null, state: 'none',
      tone: os.status === 'ISSUED' ? 'warning' : undefined, href: null });
  } else if (!(await ctx.canAny(['projects.view', 'projects.view_all', 'projects.view_assigned']))) {
    links.push({ stage: 'Projeto', label: 'Projeto restrito', detail: null, state: 'restricted', href: null });
  } else {
    const name = await ctx.projectName(os.project_id);
    links.push(name
      ? { stage: 'Projeto', label: name, detail: null, state: 'found', tone: 'neutral', href: href.project(os.project_id) }
      : { stage: 'Projeto', label: 'projeto não encontrado', detail: null, state: 'none', href: null });
  }

  const project = await ctx.projectName(os.project_id);
  return {
    title: `OS ${os.os_number} · ${os.title}`,
    detected: { object: `OS ${os.os_number}`, problem: next.label, due: dayOf(os.planned_start), owner, location: project },
    chain: links,
    relation: null,
    evidence: [
      { label: 'Linhas a revisar', value: String(counts.unreviewedItems), source: 'Portão de emissão da OS' },
      { label: 'Divergências bloqueantes', value: String(counts.blockingOpen), source: 'Portão de emissão da OS (OS + trabalho autorizado)' },
      { label: 'Divergências abertas', value: String(counts.openDivergences), source: 'Portão de emissão da OS' },
    ],
    apex: null,
    nextAction: { label: next.code === 'NONE' ? 'Abrir OS' : next.label, href: href.serviceOrder(os.id), focused: true },
    rule: 'OS: a próxima ação segue a ordem dos portões do banco — revisão do conteúdo, divergência bloqueante, emissão, projeto.',
  };
}

/* ── risk ────────────────────────────────────────────────────────────────── */

async function explainRisk(ctx: Ctx, id: string): Promise<Draft | Fail> {
  // Nunca `financial_exposure`.
  const r = rowsOf<{ id: string; title: string; severity: string; status: string; responsible_id: string | null;
    responsible_name: string | null; reference_id: string | null; origin: string; due_date: string | null; category: string | null }>(
    await ctx.sb.from('risks').select('id,title,severity,status,responsible_id,responsible_name,reference_id,origin,due_date,category')
      .eq('organization_id', ctx.org).eq('id', id).limit(1),
    'o risco')[0];
  if (!r) return missing(ctx, ['risks.view', 'risks.view_all', 'risks.view_assigned'], 'o risco');

  const links: ChainLink[] = [{
    stage: 'Risco', label: r.title,
    detail: joinDetail(`gravidade ${RISK_SEVERITY_LABEL[r.severity] ?? r.severity}`, RISK_STATUS_LABEL[r.status] ?? r.status,
      r.responsible_id || r.responsible_name ? null : 'sem responsável'),
    state: 'found', tone: r.severity === 'critical' ? 'danger' : r.severity === 'high' ? 'warning' : 'neutral', href: null,
  }];
  const canProjects = await ctx.canAny(['projects.view', 'projects.view_all', 'projects.view_assigned']);
  const projectName = canProjects && r.reference_id ? await ctx.projectName(r.reference_id) : null;
  let relation: string | null = null;
  if (!r.reference_id) {
    links.push({ stage: 'Projeto', label: 'risco sem projeto', detail: null, state: 'none', href: null });
  } else if (!canProjects) {
    links.push({ stage: 'Projeto', label: 'Projeto restrito', detail: null, state: 'restricted', href: null });
  } else if (!projectName) {
    links.push({ stage: 'Projeto', label: 'risco não ligado a um projeto', detail: null, state: 'none', href: null });
  } else {
    links.push({ stage: 'Projeto', label: projectName, detail: null, state: 'found', tone: 'neutral', href: href.project(r.reference_id, 'risks') });
    if (await ctx.canAny(TIMELINE_READ)) {
      const critical = Array.from((await ctx.timeline(r.reference_id)).values())
        .filter((a) => alive(a) && isCriticalActivity(a, ctx.today))
        .sort((a, b) => String(a.planned_finish).localeCompare(String(b.planned_finish)));
      links.push(critical.length > 0
        ? { stage: 'Atividades críticas do projeto', label: plural(critical.length, 'atividade crítica', 'atividades críticas'),
            detail: joinDetail(...critical.slice(0, 3).map((a) => a.title)), state: 'found', tone: 'danger',
            href: href.projectSchedule(r.reference_id) }
        : { stage: 'Atividades críticas do projeto', label: 'nenhuma atividade crítica agora', detail: null, state: 'none', href: href.projectSchedule(r.reference_id) });
      relation = 'O risco está registrado no projeto; as atividades críticas são do mesmo projeto — não há vínculo registrado entre o risco e uma atividade específica.';
    } else {
      links.push({ stage: 'Atividades críticas do projeto', label: 'Cronograma restrito', detail: null, state: 'restricted', href: null });
    }
  }
  const owner = r.responsible_name ?? (await ctx.owner(r.responsible_id));
  return {
    title: r.title,
    detected: { object: r.title, problem: r.responsible_id || r.responsible_name ? `Risco ${RISK_SEVERITY_LABEL[r.severity] ?? r.severity} em aberto` : 'Risco material sem responsável',
      due: dayOf(r.due_date), owner, location: projectName },
    chain: links,
    relation,
    evidence: [
      { label: 'Gravidade', value: RISK_SEVERITY_LABEL[r.severity] ?? r.severity, source: 'Riscos' },
      { label: 'Situação', value: RISK_STATUS_LABEL[r.status] ?? r.status, source: 'Riscos' },
      ...(r.category ? [{ label: 'Categoria', value: r.category, source: 'Riscos' }] : []),
    ],
    apex: null,
    nextAction: { label: r.responsible_id || r.responsible_name ? 'Abrir risco' : 'Atribuir dono',
      href: projectName && r.reference_id ? href.project(r.reference_id, 'risks') : '/riscos', focused: false },
    rule: 'Risco material (alto ou crítico) em aberto sem responsável entra na fila.',
  };
}

/* ── po ──────────────────────────────────────────────────────────────────── */

interface PoRow { id: string; order_number: string | null; supplier_id: string | null; project_id: string | null; status: string; expected_delivery: string | null }
const PO_READ = ['procurement.view', 'supply.view', 'receiving.view', 'operations.planning.view', 'projects.view'];

async function explainPurchaseOrder(ctx: Ctx, id: string): Promise<Draft | Fail> {
  const po = rowsOf<PoRow>(
    await ctx.sb.from('purchase_orders').select('id,order_number,supplier_id,project_id,status,expected_delivery')
      .eq('organization_id', ctx.org).eq('id', id).limit(1),
    'o pedido de compra')[0];
  if (!po) return missing(ctx, PO_READ, 'o pedido de compra');
  const label = po.order_number ? `Pedido ${po.order_number}` : 'Pedido de compra';
  const statusLabel = PO_STATUS_LABEL[po.status] ?? po.status;
  const late = !!po.expected_delivery && dayOf(po.expected_delivery)! < ctx.today
    && ['APPROVED', 'ISSUED', 'PARTIALLY_RECEIVED'].includes(po.status);
  const links: ChainLink[] = [{
    stage: 'Pedido', label,
    detail: joinDetail(statusLabel, br(po.expected_delivery) ? `entrega prevista ${br(po.expected_delivery)}` : null),
    state: 'found', tone: late ? 'danger' : po.status === 'APPROVAL_REQUIRED' ? 'warning' : 'neutral',
    href: href.purchaseOrder(po.id),
  }];

  // Fornecedor.
  let supplierName: string | null = null;
  if (!po.supplier_id) {
    links.push({ stage: 'Fornecedor', label: 'sem fornecedor', detail: null, state: 'none', href: null });
  } else if (!(await ctx.canAny(['procurement.view', 'supply.view', 'suppliers.view']))) {
    links.push({ stage: 'Fornecedor', label: 'Fornecedor restrito', detail: null, state: 'restricted', href: null });
  } else {
    const profile = rowsOf<{ id: string; party_id: string; status: string | null }>(
      await ctx.sb.from('supplier_profiles').select('id,party_id,status').eq('organization_id', ctx.org).eq('id', po.supplier_id).limit(1),
      'o fornecedor')[0];
    const party = profile ? rowsOf<{ id: string; legal_name: string | null; trade_name: string | null }>(
      await ctx.sb.from('parties').select('id,legal_name,trade_name').eq('organization_id', ctx.org).eq('id', profile.party_id).limit(1),
      'o cadastro do fornecedor')[0] : undefined;
    supplierName = party?.trade_name ?? party?.legal_name ?? null;
    links.push(profile
      ? { stage: 'Fornecedor', label: supplierName ?? 'Fornecedor', detail: null, state: 'found', tone: 'neutral', href: href.supplier(profile.id) }
      : { stage: 'Fornecedor', label: 'fornecedor não encontrado', detail: null, state: 'none', href: null });
  }

  // Requisitos atendidos pelo pedido.
  const lines = rowsOf<{ id: string }>(
    await ctx.sb.from('purchase_order_lines').select('id').eq('organization_id', ctx.org).eq('purchase_order_id', po.id).limit(500),
    'as linhas do pedido');
  const allocations = await inChunks<{ requirement_id: string; quantity: number | string | null }>('os requisitos do pedido',
    lines.map((l) => l.id),
    (c) => ctx.sb.from('purchase_order_line_requirements').select('requirement_id,quantity').eq('organization_id', ctx.org).in('line_id', c));
  const requirements = await inChunks<RequirementRow>('os requisitos do pedido',
    allocations.map((a) => a.requirement_id),
    (c) => ctx.sb.from('project_requirements').select('id,project_id,activity_id,title,requirement_type,required_by,status,quantity,unit')
      .eq('organization_id', ctx.org).in('id', c));
  requirements.sort((a, b) => String(a.required_by ?? '9999').localeCompare(String(b.required_by ?? '9999')));
  const first = requirements[0] ?? null;
  links.push(requirements.length > 0
    ? { stage: 'Requisitos atendidos', label: plural(requirements.length, 'requisito atendido', 'requisitos atendidos'),
        detail: joinDetail(...requirements.slice(0, 3).map((r) => r.title)), state: 'found', tone: 'neutral', href: href.requirement(first!.id) }
    : { stage: 'Requisitos atendidos', label: allocations.length > 0 ? 'requisitos não legíveis' : 'pedido sem requisito vinculado',
        detail: null, state: allocations.length > 0 ? 'restricted' : 'none', href: null });

  let relation: string | null = null;
  const evidence: Evidence[] = [];
  if (first) {
    const seg = await activitySegment(ctx, first.project_id, first.activity_id, first.required_by);
    links.push(...seg.links);
    evidence.push(...seg.evidence);
    relation = seg.relation;
    if (seg.needDate) evidence.push({ label: 'Necessidade do primeiro requisito', value: br(seg.needDate)!, source: first.title });
  }
  if (po.expected_delivery) evidence.unshift({ label: 'Entrega prevista', value: br(po.expected_delivery)!, source: 'Compras · pedido' });
  const signal = await openSignal(ctx, 'purchase_order_id', po.id, ['LATE_INBOUND', 'ETA_RISK', 'DECISION_PENDING', 'SUPPLIER_RELIABILITY']);
  const project = await ctx.projectName(po.project_id ?? first?.project_id ?? null);
  const approval = po.status === 'APPROVAL_REQUIRED';
  const link = sourceLink('purchase_order', po.id, approval);
  return {
    title: label,
    detected: { object: label, problem: approval ? 'Aprovação de compra parada' : late ? 'Entrega atrasada' : statusLabel,
      due: dayOf(po.expected_delivery), owner: null, location: supplierName ?? project },
    chain: links,
    relation,
    evidence,
    apex: signal ? apexNote(signal, false) : null,
    nextAction: { label: link.label, href: link.href, focused: true },
    rule: approval
      ? 'Compra: pedido aguardando aprovação — a decisão vive em Decisões/Compras, nunca no Dashboard.'
      : 'Compra: pedido com entrega prevista vencida e ainda não recebido.',
  };
}

/* ── bill ────────────────────────────────────────────────────────────────── */

async function explainBilling(ctx: Ctx, id: string): Promise<Draft | Fail> {
  // Linha do Dashboard só aparece com a leitura dos eventos (RLS 007): sem ela, restrito.
  if (!(await ctx.canAny(['contracts.view_values', 'finance.view']))) {
    return { ok: false, reason: 'restricted', message: 'Seu perfil não lê faturamento.' };
  }
  const fin = await ctx.financials();
  const row = rowsOf<CashRow>(
    await ctx.sb.from('contract_to_cash_read_model').select(fin ? CASH_FINANCIAL_COLUMNS : CASH_IDENTITY_COLUMNS)
      .eq('organization_id', ctx.org).eq('billing_event_id', id).limit(1),
    'o evento de faturamento')[0];
  if (!row) return { ok: false, reason: 'not_found', message: 'Não encontramos o evento de faturamento nesta organização.' };

  const links: ChainLink[] = [];
  if (row.source_measurement_id && (await ctx.canAny(['projects.measurements.view', 'projects.view']))) {
    const m = rowsOf<MeasurementRow>(
      await ctx.sb.from('project_measurements').select(MEASUREMENT_COLUMNS).eq('organization_id', ctx.org).eq('id', row.source_measurement_id).limit(1),
      'a medição de origem')[0];
    if (m) links.push(measurementLink(m));
  }
  links.push(...(fin ? await cashLinks(ctx, row) : [billingRestricted()]));
  const title = row.title ?? 'Evento de faturamento';
  const open = row.release_state === 'ELIGIBLE' || row.release_state === 'PENDING_RELEASE';
  const link = sourceLink('contract_billing_event', row.billing_event_id, open);
  return {
    title,
    detected: {
      object: title,
      problem: fin && row.release_state ? RELEASE_LABEL[row.release_state] ?? row.release_state : 'Estado do faturamento restrito ao seu perfil',
      due: fin ? dayOf(row.due_date) : null, owner: null, location: null,
    },
    chain: links,
    relation: null,
    evidence: fin && money(row.eligible_amount, row.currency)
      ? [{ label: 'Valor elegível', value: money(row.eligible_amount, row.currency)!, source: 'Contratos · cadeia contrato → caixa' }]
      : [],
    apex: null,
    nextAction: { label: link.label, href: link.href, focused: true },
    rule: 'Faturamento: evento elegível aguardando liberação, ou liberado sem NF. Estados e valores só com visibilidade financeira.',
  };
}

/* ── sig ─────────────────────────────────────────────────────────────────── */

async function explainSignal(ctx: Ctx, id: string): Promise<Draft | Fail> {
  const s = rowsOf<SignalRow>(
    await ctx.sb.from('supply_signals').select(SIGNAL_COLUMNS).eq('organization_id', ctx.org).eq('id', id).limit(1),
    'o achado da Apex')[0];
  if (!s) return missing(ctx, ['supply.view', 'procurement.view', 'inventory.view', 'receiving.view', 'operations.planning.view', 'projects.view'], 'o achado da Apex');

  const signalLink: ChainLink = {
    stage: 'Achado da Apex', label: s.title, detail: joinDetail(SIGNAL_KIND_LABEL[s.kind] ?? s.kind, s.status === 'OPEN' ? null : 'já encerrado'),
    state: 'found', tone: s.severity === 'critical' ? 'danger' : s.severity === 'high' ? 'warning' : 'neutral', href: '/supply?focus=apex',
  };
  let base: Draft | Fail | null = null;
  let stale = false;
  if (s.requirement_id) {
    const mat = await explainMaterial(ctx, s.requirement_id);
    if (isFail(mat)) base = mat;
    else {
      stale = s.status === 'OPEN' && COVERAGE_SIGNALS.includes(s.kind) && mat.coverage !== null && mat.coverage.shortage <= 0;
      base = mat.draft;
    }
  } else if (s.purchase_order_id) {
    base = await explainPurchaseOrder(ctx, s.purchase_order_id);
  }
  const note = apexNote(s, stale);
  const project = await ctx.projectName(s.project_id);
  if (!base || isFail(base)) {
    return {
      title: s.title,
      detected: { object: s.title, problem: SIGNAL_KIND_LABEL[s.kind] ?? s.kind, due: null, owner: null, location: project },
      chain: [signalLink],
      relation: null,
      evidence: [],
      apex: note,
      nextAction: { label: 'Ver achados da Apex', href: '/supply?focus=apex', focused: false },
      rule: 'Achado persistido da Apex (motor de sinais do Supply).',
    };
  }
  return {
    ...base,
    title: s.title,
    detected: { ...base.detected, problem: base.detected.problem || (SIGNAL_KIND_LABEL[s.kind] ?? s.kind) },
    chain: [signalLink, ...base.chain],
    apex: note,
    rule: `Achado persistido da Apex (${SIGNAL_KIND_LABEL[s.kind] ?? s.kind}). ${base.rule ?? ''}`.trim(),
  };
}

/* ── Entrada ─────────────────────────────────────────────────────────────── */

/**
 * A cadeia causal de `ref`. Sempre devolve um valor para ref inválida, objeto
 * não encontrado ou restrito; uma LEITURA que falha lança `ExplainReadError`
 * (a rota a responde sem transformar erro em "sem vínculo").
 */
export async function explainRef(session: CommercialSession, ref: string, today: string): Promise<ExplainResponse> {
  const parsed = parseExplainRef(ref);
  if (!parsed) return { ok: false, reason: 'invalid', message: 'Referência inválida.' };
  const ctx = makeCtx(session, today);
  let draft: Draft | Fail;
  switch (parsed.kind) {
    case 'mat': {
      const mat = await explainMaterial(ctx, parsed.id);
      draft = isFail(mat) ? mat : mat.draft;
      break;
    }
    case 'dep': draft = await explainDependency(ctx, parsed.id); break;
    case 'act': draft = await explainActivity(ctx, parsed.id); break;
    case 'proj-act': draft = await explainProjectActivities(ctx, parsed.id); break;
    case 'meas': draft = await explainMeasurement(ctx, parsed.id); break;
    case 'os': draft = await explainServiceOrder(ctx, parsed.id); break;
    case 'risk': draft = await explainRisk(ctx, parsed.id); break;
    case 'po': draft = await explainPurchaseOrder(ctx, parsed.id); break;
    case 'bill': draft = await explainBilling(ctx, parsed.id); break;
    case 'sig': draft = await explainSignal(ctx, parsed.id); break;
    default: return { ok: false, reason: 'invalid', message: 'Referência inválida.' };
  }
  if (isFail(draft)) return draft;
  return { ok: true, ref: `${parsed.kind}:${parsed.id}`, ...draft, asOf: new Date().toISOString() };
}

