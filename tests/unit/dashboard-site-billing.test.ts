/**
 * Faturamento do local — src/lib/dashboard/site-billing.ts e a rota
 * GET /api/dashboard/site/[projectId]/billing, com o cliente Supabase simulado
 * (hermético):
 *  1. o estado do evento na régua do protótipo, com rótulos em português e sem
 *     inventar título/pagamento sem `receivablesGate`;
 *  2. dinheiro (evento e total) só com o RPC financeiro; total nulo com lista cortada;
 *  3. foco: elegível/em aprovação → próximo a faturar → aguardando;
 *  4. portões: sem `contracts.view` ou sem `billingGate` → Restrito (nunca 0);
 *     sem vínculo → `ok` vazio; leitura que falha → `error`;
 *  5. colunas EXPLÍCITAS (nunca `*`; valor/título só com o portão) e inquilino em toda leitura.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ requireCommercialSession: vi.fn() }));

vi.mock('@/lib/platform/server-client', () => ({
  platformServiceClient: () => { throw new Error('service role não é usado pelo Dashboard'); },
}));
vi.mock('@/lib/commercial/server-session', () => ({
  hasOptionalPermission: async (session: { permissions: Set<string> }, key: string) => session.permissions.has(key),
  requireCommercialSession: mocks.requireCommercialSession,
  isSessionError: (r: object) => 'error' in r,
}));
vi.mock('@/lib/operations/overview', () => ({ operationsOverview: vi.fn() }));
vi.mock('@/lib/supply/read-model', () => ({ supplyFlow: vi.fn() }));
vi.mock('@/lib/supply/intelligence-read', () => ({ listSupplySignals: vi.fn() }));
vi.mock('@/lib/decisions/read', () => ({ viewerInbox: vi.fn(), enrichInbox: vi.fn(), decisionSetup: vi.fn() }));

import {
  buildSiteBilling, contractLabel, eventogramFocus, eventogramRow, eventogramState, eventogramTotal, sortCashRows, type CashRow,
} from '@/lib/dashboard/site-billing';
import type { SiteBillingResponse } from '@/lib/dashboard/types';

const TODAY = '2026-09-25';
const PROJECT = 'qa-dec-bill-muga66o8wne';
const CONTRACT = 'c-1';

/* ── Cliente Supabase simulado ──────────────────────────────────────────── */

type Spec = { rows?: Record<string, unknown>[]; count?: number; error?: string };
type Call = { table: string; ops: Array<[string, unknown[]]> };

function fakeClient(tables: Record<string, Spec>, rpcs: Record<string, unknown>, calls: Call[] = []) {
  return {
    rpc: async (name: string) => ({ data: rpcs[name] ?? null, error: null }),
    from: (table: string) => {
      const call: Call = { table, ops: [] };
      calls.push(call);
      const chain: Record<string, unknown> = {};
      const resolveRows = () => {
        const spec = tables[table] ?? {};
        if (spec.error) return { data: null, error: { message: spec.error }, count: null };
        let rows = spec.rows ?? [];
        const col = (r: Record<string, unknown>, c: unknown) => typeof c === 'string' && c in r;
        for (const [m, a] of call.ops) {
          if (m === 'in') rows = rows.filter((r) => !col(r, a[0]) || (a[1] as unknown[]).includes(r[a[0] as string]));
          if (m === 'eq' || m === 'is') rows = rows.filter((r) => !col(r, a[0]) || r[a[0] as string] === a[1]);
        }
        return { data: rows, error: null, count: null };
      };
      for (const m of ['select', 'eq', 'neq', 'gt', 'gte', 'lte', 'in', 'is', 'not', 'or', 'order', 'limit', 'range']) {
        chain[m] = (...args: unknown[]) => { call.ops.push([m, args]); return chain; };
      }
      chain.maybeSingle = () => {
        const r = resolveRows();
        return Promise.resolve({ ...r, data: r.error ? null : (r.data as unknown[] | null)?.[0] ?? null });
      };
      chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
        try { return resolve(resolveRows()); } catch (e) { return reject(e); }
      };
      return chain;
    },
  };
}

function session(permissions: string[], tables: Record<string, Spec> = {}, rpcs: Record<string, unknown> = {}, calls: Call[] = []) {
  return {
    supabase: fakeClient(tables, rpcs, calls) as never,
    user: { id: 'u-1' } as never,
    organizationId: 'org-1',
    permissions: new Set(permissions),
  };
}

/* ── Fixtures ───────────────────────────────────────────────────────────── */

const cash = (over: Partial<CashRow> & { billing_event_id: string }): CashRow => ({
  contract_id: CONTRACT, milestone_id: null, title: `Evento ${over.billing_event_id}`, currency: 'BRL', eligibility_state: 'UNKNOWN',
  release_state: 'NOT_ELIGIBLE', legacy_row: false, cancelled_at: null, superseded_by_id: null, source_measurement_id: null,
  fiscal_request_state: null, fiscal_document_id: null, fiscal_document_status: null, fiscal_document_number: null,
  created_at: '2026-09-01T00:00:00Z', ...over,
});

const state = (over: Partial<CashRow>, receivables = true) => eventogramState(cash({ billing_event_id: 'e', ...over }), { receivables });

/* ── 1. Estado do evento ────────────────────────────────────────────────── */

describe('estado do evento (eventograma)', () => {
  it('da etapa mais avançada que a pessoa lê, com rótulo em português', () => {
    expect(state({})).toEqual({ state: 'awaiting', stateLabel: 'Aguardando elegibilidade' });
    expect(state({ eligibility_state: 'ELIGIBLE', release_state: 'ELIGIBLE' })).toEqual({ state: 'eligible', stateLabel: 'Aguardando liberação' });
    expect(state({ release_state: 'PENDING_RELEASE' })).toEqual({ state: 'pending_release', stateLabel: 'Em aprovação' });
    expect(state({ release_state: 'RELEASED' })).toEqual({ state: 'released', stateLabel: 'Liberado · sem NF emitida' });
    expect(state({ release_state: 'RELEASED', fiscal_request_state: 'BLOCKED_BY_CONFIGURATION' }))
      .toEqual({ state: 'blocked', stateLabel: 'Fiscal bloqueado por configuração' });
    expect(state({ release_state: 'RELEASED', fiscal_document_id: 'nf', fiscal_document_status: 'processing' }))
      .toEqual({ state: 'invoiced', stateLabel: 'Nota em preparo' });
    expect(state({ release_state: 'RELEASED', fiscal_document_id: 'nf', fiscal_document_status: 'authorized' }))
      .toEqual({ state: 'invoiced', stateLabel: 'Nota autorizada' });
    expect(state({ release_state: 'RELEASED', fiscal_document_id: 'nf', fiscal_document_status: 'rejected' }))
      .toEqual({ state: 'blocked', stateLabel: 'NF rejeitada' });
    expect(state({ release_state: 'RELEASED', fiscal_document_id: 'nf', receivable_id: 'r', receivable_status: 'OVERDUE' }))
      .toEqual({ state: 'receivable', stateLabel: 'Vencido' });
    expect(state({ release_state: 'RELEASED', fiscal_document_id: 'nf', receivable_id: 'r', receivable_status: 'PAID' }))
      .toEqual({ state: 'paid', stateLabel: 'Recebido' });
    expect(state({ release_state: 'RELEASE_REJECTED' })).toEqual({ state: 'blocked', stateLabel: 'Liberação rejeitada' });
    expect(state({ eligibility_state: 'BLOCKED' })).toEqual({ state: 'blocked', stateLabel: 'Bloqueado' });
    expect(state({ legacy_row: true, eligibility_state: 'ELIGIBLE', release_state: 'ELIGIBLE' }).state).toBe('blocked');
    expect(state({ cancelled_at: '2026-09-02T00:00:00Z', release_state: 'RELEASED' })).toEqual({ state: 'cancelled', stateLabel: 'Cancelado' });
  });

  it('sem receivablesGate a régua para na NF: nunca "Recebido" nem "Vencido" sem ler o saldo', () => {
    const paid = { release_state: 'RELEASED', fiscal_document_id: 'nf', fiscal_document_status: 'authorized', receivable_id: 'r',
      receivable_status: 'PAID' };
    expect(state(paid, false)).toEqual({ state: 'invoiced', stateLabel: 'Nota autorizada' });
  });
});

describe('linha do eventograma', () => {
  const row = cash({ billing_event_id: 'e1', eligible_amount: '86500.00', release_state: 'RELEASED', fiscal_document_id: 'nf-1',
    fiscal_document_status: 'authorized', fiscal_document_number: '2026/1187', source_measurement_id: 'm1', receivable_id: 'r1',
    receivable_status: 'OPEN', due_date: '2026-10-30' });

  it('com finanças: valor, NF, título, medição com rótulo; link para Contratos', () => {
    const r = eventogramRow(row, { financial: true, receivables: true, measurement: { id: 'm1', status: 'ACCEPTED' } });
    expect(r).toMatchObject({
      billingEventId: 'e1', contractId: CONTRACT, state: 'receivable', stateLabel: 'Em aberto',
      measurement: { id: 'm1', status: 'ACCEPTED', statusLabel: 'Aceita' },
      fiscal: { number: '2026/1187', status: 'authorized', statusLabel: 'Autorizada' },
      receivable: { due: '2026-10-30', state: 'OPEN', stateLabel: 'Em aberto' }, href: '/contratos?view=faturamento',
    });
    expect(r.amount).toMatch(/^R\$\s86\.500,00$/);
  });

  it('sem finanças: valor null; sem receivablesGate: o título da NF autorizada é "Restrito", nunca "sem título"', () => {
    const r = eventogramRow(row, { financial: false, receivables: false, measurement: null });
    expect(r.amount).toBeNull();
    expect(r.receivable).toEqual({ due: null, state: null, stateLabel: 'Restrito' });
    expect(r.measurement).toBeNull();
    // liberado sem NF: o título ainda não pode existir → nada a restringir
    expect(eventogramRow(cash({ billing_event_id: 'e2', release_state: 'RELEASED' }), { financial: false, receivables: false,
      measurement: null }).receivable).toBeNull();
  });

  it('sem título → "Evento de faturamento"; fiscal bloqueado por configuração aparece no passo da NF', () => {
    const r = eventogramRow(cash({ billing_event_id: 'e3', title: null, release_state: 'RELEASED', fiscal_request_state: 'BLOCKED_BY_CONFIGURATION' }),
      { financial: true, receivables: true, measurement: null });
    expect(r.title).toBe('Evento de faturamento');
    expect(r.fiscal).toEqual({ number: null, status: null, statusLabel: 'Fiscal bloqueado por configuração' });
  });
});

describe('ordem, foco e total', () => {
  const rows = [
    cash({ billing_event_id: 'e-cancel', cancelled_at: '2026-09-02T00:00:00Z', milestone_id: 'm-1', eligible_amount: 999 }),
    cash({ billing_event_id: 'e-future', milestone_id: 'm-3', eligible_amount: 300 }),
    cash({ billing_event_id: 'e-released', milestone_id: 'm-1', release_state: 'RELEASED', eligibility_state: 'ELIGIBLE', eligible_amount: 100 }),
    cash({ billing_event_id: 'e-eligible', milestone_id: 'm-2', release_state: 'ELIGIBLE', eligibility_state: 'ELIGIBLE', eligible_amount: 200.5 }),
    cash({ billing_event_id: 'e-nodate', eligible_amount: 50, currency: 'USD' }),
  ];
  const due = new Map([['m-1', '2026-08-01'], ['m-2', '2026-09-15'], ['m-3', '2026-12-01']]);

  it('pela data do marco (sem data por último); cancelados no fim', () => {
    expect(sortCashRows(rows, due).map((r) => r.billing_event_id)).toEqual(['e-released', 'e-eligible', 'e-future', 'e-nodate', 'e-cancel']);
  });

  it('foco: elegível/em aprovação → próximo a faturar → aguardando', () => {
    const sorted = sortCashRows(rows, due);
    expect(eventogramFocus(sorted)).toBe('e-eligible');
    expect(eventogramFocus(sorted.filter((r) => r.billing_event_id !== 'e-eligible'))).toBe('e-released');
    expect(eventogramFocus(sorted.filter((r) => !['e-eligible', 'e-released'].includes(r.billing_event_id)))).toBe('e-future');
    expect(eventogramFocus([])).toBeNull();
  });

  it('total: só com finanças e lista inteira; cancelado fora; moedas nunca somadas', () => {
    expect(eventogramTotal(rows, false, false)).toBeNull();
    expect(eventogramTotal(rows, true, true)).toBeNull();
    expect(eventogramTotal(rows, true, false)).toMatch(/^R\$\s600,50 \+ outras moedas$/);
  });

  it('rótulo do contrato', () => {
    expect(contractLabel({ contract_number: 'CT-0042', title: 'Retrofit UG-05' })).toBe('CT-0042 · Retrofit UG-05');
    expect(contractLabel({ contract_number: null, title: null })).toBe('Contrato');
  });
});

/* ── 4–5. Composição ────────────────────────────────────────────────────── */

const FIN = ['projects.view', 'contracts.view', 'contracts.view_values', 'finance.view'];

function tables(over: Record<string, Spec> = {}): Record<string, Spec> {
  return {
    projects: { rows: [{ id: PROJECT, organization_id: 'org-1', project: { nome: 'Contrato QA MUGA66O8WNE' }, project_v2: null }] },
    project_contract_link_governed: { rows: [{ organization_id: 'org-1', project_id: PROJECT, contract_id: CONTRACT },
      { organization_id: 'org-1', project_id: PROJECT, contract_id: CONTRACT }] },
    contracts: { rows: [{ organization_id: 'org-1', id: CONTRACT, contract_number: null, title: '[QA] Contrato MUGA66O8WNE' }] },
    contract_to_cash_read_model: { rows: [{ organization_id: 'org-1', ...cash({ billing_event_id: 'ev-1', release_state: 'RELEASED',
      eligibility_state: 'ELIGIBLE', eligible_amount: '86500.00', source_measurement_id: 'meas-1', milestone_id: 'ms-1',
      fiscal_request_state: 'BLOCKED_BY_CONFIGURATION' }) }] },
    contract_milestones: { rows: [{ organization_id: 'org-1', id: 'ms-1', due_date: '2026-09-20' }] },
    project_measurements: { rows: [{ organization_id: 'org-1', id: 'meas-1', status: 'ACCEPTED' }] },
    ...over,
  };
}

const finRpcs = { current_user_can_view_project_financials: true, has_finance_role_or_perm: false };

describe('buildSiteBilling', () => {
  afterEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); });
  const ok = (r: SiteBillingResponse) => {
    if (!r.ok || r.billing.state !== 'ok') throw new Error(`esperava billing ok: ${JSON.stringify(r)}`);
    return r.billing.data;
  };

  it('invalid / restricted / not_found, sem inventar', async () => {
    const calls: Call[] = [];
    expect(await buildSiteBilling(session(FIN, tables(), finRpcs, calls), 'a b', TODAY)).toMatchObject({ ok: false, reason: 'invalid' });
    expect(calls).toHaveLength(0);
    expect(await buildSiteBilling(session(['contracts.view'], tables(), finRpcs), PROJECT, TODAY)).toMatchObject({ ok: false, reason: 'restricted' });
    expect(await buildSiteBilling(session(FIN, tables({ projects: { rows: [] } }), finRpcs), PROJECT, TODAY))
      .toMatchObject({ ok: false, reason: 'not_found' });
  });

  it('com finanças: contrato, eventograma, total, foco e a referência do Entender; colunas explícitas e inquilino', async () => {
    const calls: Call[] = [];
    const d = ok(await buildSiteBilling(session(FIN, tables(), finRpcs, calls), PROJECT, TODAY));
    expect(d.contracts).toEqual([{ id: CONTRACT, label: '[QA] Contrato MUGA66O8WNE' }]);
    expect(d.rows).toEqual([expect.objectContaining({ billingEventId: 'ev-1', state: 'blocked', stateLabel: 'Fiscal bloqueado por configuração',
      measurement: { id: 'meas-1', status: 'ACCEPTED', statusLabel: 'Aceita' } })]);
    expect(d.total).toMatch(/^R\$\s86\.500,00$/);
    expect(d.focus).toBe('ev-1');
    expect(d.focusExplainRef).toBe('bill:ev-1');
    const view = calls.find((c) => c.table === 'contract_to_cash_read_model')!;
    const cols = String(view.ops.find(([m]) => m === 'select')?.[1][0]);
    expect(cols).toContain('eligible_amount');
    expect(cols).toContain('receivable_status');
    expect(view.ops).toContainEqual(['is', ['superseded_by_id', null]]);
    for (const c of calls) {
      expect(c.ops.some(([m, a]) => m === 'eq' && a[0] === 'organization_id' && a[1] === 'org-1'), `${c.table} sem inquilino`).toBe(true);
      expect(String(c.ops.find(([m]) => m === 'select')?.[1][0]), `${c.table} com *`).not.toContain('*');
    }
  });

  it('sem finanças (contracts.edit, como o Jurídico): lê o eventograma, sem valor e sem colunas de dinheiro/título', async () => {
    const calls: Call[] = [];
    const d = ok(await buildSiteBilling(session(['projects.view', 'contracts.view', 'contracts.edit'], tables(),
      { current_user_can_view_project_financials: false, has_finance_role_or_perm: false }, calls), PROJECT, TODAY));
    expect(d.rows[0].amount).toBeNull();
    expect(d.total).toBeNull();
    const cols = String(calls.find((c) => c.table === 'contract_to_cash_read_model')!.ops.find(([m]) => m === 'select')?.[1][0]);
    expect(cols).not.toContain('eligible_amount');
    expect(cols).not.toContain('receivable');
    expect(cols).not.toContain('due_date');
  });

  it('contracts.view sem valores/finanças (gestor) ou sem contracts.view (RH) → Restrito, nunca eventograma vazio', async () => {
    const calls: Call[] = [];
    const gestor = await buildSiteBilling(session(['projects.view', 'contracts.view'], tables(), {}, calls), PROJECT, TODAY);
    expect(gestor).toMatchObject({ ok: true, billing: { state: 'restricted' } });
    expect(calls.some((c) => c.table === 'contract_to_cash_read_model')).toBe(false);
    expect(await buildSiteBilling(session(['projects.view'], tables(), finRpcs), PROJECT, TODAY))
      .toMatchObject({ ok: true, billing: { state: 'restricted' } });
  });

  it('sem vínculo de contrato → ok vazio (a tela diz "sem contrato vinculado")', async () => {
    const d = ok(await buildSiteBilling(session(FIN, tables({ project_contract_link_governed: { rows: [] } }), finRpcs), PROJECT, TODAY));
    expect(d).toEqual({ contracts: [], total: null, rows: [], focus: null, focusExplainRef: null });
  });

  it('leitura que falha → `error`, nunca vazio calmo', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const table of ['project_contract_link_governed', 'contract_to_cash_read_model', 'project_measurements']) {
      const r = await buildSiteBilling(session(FIN, tables({ [table]: { error: 'boom' } }), finRpcs), PROJECT, TODAY);
      expect(r, table).toMatchObject({ ok: true, billing: { state: 'error', message: 'Não foi possível ler o faturamento do contrato.' } });
    }
  });
});

describe('GET /api/dashboard/site/[projectId]/billing', () => {
  afterEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); });
  const ctx = (projectId: string) => ({ params: Promise.resolve({ projectId }) });

  it('200 com o corpo e no-store; motivo no corpo para inválido', async () => {
    mocks.requireCommercialSession.mockResolvedValue(session(FIN, tables(), finRpcs));
    const { GET } = await import('@/app/api/dashboard/site/[projectId]/billing/route');
    const res = await GET(new Request(`http://x/api/dashboard/site/${PROJECT}/billing`), ctx(PROJECT));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toMatchObject({ ok: true, project: { id: PROJECT }, billing: { state: 'ok' } });
    const bad = await GET(new Request('http://x/api/dashboard/site/x/billing'), ctx('x;y'));
    expect(bad.status).toBe(200);
    expect(await bad.json()).toMatchObject({ ok: false, reason: 'invalid', error: 'Identificador de projeto inválido.' });
  });

  it('500 só quando a montagem inteira falha', async () => {
    const broken = session(FIN, tables(), finRpcs);
    (broken.supabase as unknown as { rpc: () => never }).rpc = () => { throw new Error('rede'); };
    mocks.requireCommercialSession.mockResolvedValue(broken);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { GET } = await import('@/app/api/dashboard/site/[projectId]/billing/route');
    const res = await GET(new Request(`http://x/api/dashboard/site/${PROJECT}/billing`), ctx(PROJECT));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ ok: false, reason: 'error' });
  });
});
