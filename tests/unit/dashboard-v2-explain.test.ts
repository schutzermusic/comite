/**
 * Entender (Dashboard V2) — a cadeia causal e as regras que ela não afrouxa:
 *  • ref fora da lista permitida, ou id malformado → `invalid` (sem tocar no banco);
 *  • sem `contracts.view` o elo contratual é `restricted`, nunca `none`;
 *  • mapeamento ACEITO num ancestral → `found`, leitura de CONTENÇÃO (nunca "atrasa");
 *  • só mapeamento proposto → `unconfirmed` ("confirmar em Contratos");
 *  • medição APPROVED_FOR_CUSTOMER → faturamento `pending` "aguardando aceite do cliente";
 *  • RPC financeira falsa → nenhum valor em lugar nenhum da resposta;
 *  • toda leitura filtra `organization_id`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;
type Call = { table: string; ops: Array<[string, unknown[]]> };

function fakeClient(tables: Record<string, Row[]>, rpc: Record<string, (args?: Row) => unknown>, calls: Call[]) {
  return {
    rpc: async (fn: string, args?: Row) => ({ data: rpc[fn] ? rpc[fn](args) : null, error: null }),
    from: (table: string) => {
      const call: Call = { table, ops: [] };
      calls.push(call);
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'neq', 'in', 'is', 'not', 'order', 'limit']) {
        chain[m] = (...args: unknown[]) => { call.ops.push([m, args]); return chain; };
      }
      chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
        try {
          let rows = [...(tables[table] ?? [])];
          for (const [m, a] of call.ops) {
            const [col, val] = a as [string, unknown];
            if (m === 'eq') rows = rows.filter((r) => r[col] === val);
            if (m === 'neq') rows = rows.filter((r) => r[col] !== val);
            if (m === 'in') rows = rows.filter((r) => (val as unknown[]).includes(r[col]));
            if (m === 'is') rows = rows.filter((r) => (r[col] ?? null) === val);
            if (m === 'limit') rows = rows.slice(0, Number(col));
          }
          return Promise.resolve(resolve({ data: rows, error: null }));
        } catch (e) {
          return reject ? reject(e) : Promise.reject(e);
        }
      };
      return chain;
    },
  };
}

const ORG = 'org-1';
const TODAY = '2026-09-25';
const PROJECT = 'proj-ug05';
const REQ = '11111111-1111-4111-8111-111111111111';
const ACT = '22222222-2222-4222-8222-222222222222';
const STAGE = '33333333-3333-4333-8333-333333333333';
const CONTRACT = '44444444-4444-4444-8444-444444444444';
const RULE = '55555555-5555-4555-8555-555555555555';
const MILESTONE = '66666666-6666-4666-8666-666666666666';
const MEAS = '77777777-7777-4777-8777-777777777777';
const BILL = '88888888-8888-4888-8888-888888888888';

const item = (over: Row): Row => ({
  project_id: PROJECT, organization_id: ORG, parent_id: null, wbs_code: null, status: 'in_progress', priority: 'medium',
  delay_status: 'none', is_milestone: false, is_summary: false, is_active: true, deleted_at: null,
  planned_start: '2026-10-01', planned_finish: '2026-10-20', forecast_finish: null, actual_finish: null,
  responsible_user_id: null, ...over,
});

/** Mundo base: UG-05, requisito de material na atividade "Montagem do mancal", filha da etapa "Montagem do rotor". */
function world(over: Record<string, Row[]> = {}): Record<string, Row[]> {
  return {
    projects: [{ id: PROJECT, organization_id: ORG, project: { nome: 'Enel Cachoeira Dourada UG-05' }, project_v2: null }],
    project_requirements: [{ id: REQ, organization_id: ORG, project_id: PROJECT, activity_id: ACT, title: 'Bucha de bronze do mancal',
      requirement_type: 'MATERIAL', required_by: '2026-10-05', status: 'CONFIRMED', quantity: 4, unit: 'un' }],
    supply_requirement_coverage: [{ organization_id: ORG, requirement_id: REQ, project_id: PROJECT, activity_id: ACT, item_id: null,
      requirement_type: 'MATERIAL', required_by: '2026-10-05', unit: 'un', required_qty: 4, reserved_qty: 1, consumed_qty: 0,
      in_transit_qty: 0, on_order_qty: 0, requested_qty: 3, inspection_qty: 0 }],
    project_timeline_items: [
      item({ id: STAGE, title: 'Montagem do rotor', is_summary: true, planned_start: '2026-09-20', planned_finish: '2026-10-03' }),
      item({ id: ACT, parent_id: STAGE, title: 'Montagem do mancal', planned_start: '2026-10-01' }),
    ],
    project_contract_link_governed: [{ organization_id: ORG, project_id: PROJECT, contract_id: CONTRACT }],
    contract_measurement_rule_timeline_mappings: [],
    contract_measurement_requirements: [{ id: RULE, organization_id: ORG, milestone_id: MILESTONE, effect: 'added' }],
    contract_milestones: [{ id: MILESTONE, organization_id: ORG, contract_id: CONTRACT, title: 'Marco 3 — Rotor montado', due_date: '2026-10-10' }],
    project_measurements: [],
    contract_to_cash_read_model: [],
    supply_signals: [],
    ...over,
  };
}

const mapping = (over: Row): Row => ({
  id: 'map-1', organization_id: ORG, contract_id: CONTRACT, rule_id: RULE, project_id: PROJECT, timeline_item_id: STAGE,
  review_state: 'accepted', ambiguous_with: null, reviewed_at: '2026-09-01T12:00:00Z', ...over,
});

function session(tables: Record<string, Row[]>, perms: string[], opts: { financials?: boolean } = {}, calls: Call[] = []) {
  const set = new Set(perms);
  const sb = fakeClient(tables, {
    current_user_has_permission: (a) => set.has(String(a?.permission_key)),
    current_user_can_view_project_financials: () => opts.financials === true,
    has_finance_role_or_perm: () => false,
  }, calls);
  return { supabase: sb as never, organizationId: ORG, permissions: new Set<string>(), user: { id: 'u-1' } as never };
}

async function load() {
  vi.doMock('@/lib/platform/server-client', () => ({ platformServiceClient: () => { throw new Error('service role não é usado aqui'); } }));
  vi.doMock('@/lib/commercial/owner-directory', () => ({ resolveOwnerNames: async () => ({}) }));
  vi.doMock('@/utils/supabase/server', () => ({ createClient: async () => { throw new Error('sem cliente de rota no teste'); } }));
  vi.doMock('@/lib/operations/service-orders/read-model', () => ({
    countsFor: async () => new Map(),
  }));
  vi.resetModules();
  return import('@/lib/dashboard/explain');
}

type Ok = Extract<Awaited<ReturnType<Awaited<ReturnType<typeof load>>['explainRef']>>, { ok: true }>;
const linkOf = (res: Ok, stage: string) => res.chain.find((l) => l.stage === stage);

describe('Entender — cadeia causal', () => {
  afterEach(() => {
    for (const m of ['@/lib/platform/server-client', '@/lib/commercial/owner-directory', '@/utils/supabase/server',
      '@/lib/operations/service-orders/read-model']) vi.doUnmock(m);
    vi.resetModules();
  });

  it('ref inválida → invalid, sem nenhuma leitura', async () => {
    const { explainRef, parseExplainRef } = await load();
    const calls: Call[] = [];
    const s = session(world(), ['projects.view'], {}, calls);
    for (const ref of ['', 'xyz:' + REQ, 'mat:not-a-uuid', 'mat', `mat:${REQ}' or 1=1`, 'proj-act:../etc', 'proj-act:' + 'a'.repeat(121), 'act:proj-ug05']) {
      const res = await explainRef(s as never, ref, TODAY);
      expect(res).toMatchObject({ ok: false, reason: 'invalid' });
    }
    expect(calls).toHaveLength(0);
    expect(parseExplainRef('proj-act:qa-scn-tucurui')).toEqual({ kind: 'proj-act', id: 'qa-scn-tucurui' });
    expect(parseExplainRef(`MAT:${REQ}`)).toBeNull();
  });

  it('sem contracts.view → elo contratual `restricted` (não `none`), e o próximo marco do cronograma é só proximidade', async () => {
    const { explainRef } = await load();
    const tables = world({
      project_timeline_items: [...world().project_timeline_items,
        item({ id: 'ms-1', title: 'Giro mecânico', is_milestone: true, planned_start: '2026-10-15', planned_finish: '2026-10-15' })],
    });
    const res = await explainRef(session(tables, ['projects.view']) as never, `mat:${REQ}`, TODAY);
    expect(res.ok).toBe(true);
    const ok = res as Ok;
    const contract = linkOf(ok, 'Marco contratual')!;
    expect(contract.state).toBe('restricted');
    expect(contract.label).toBe('Vínculo contratual restrito');
    expect(ok.chain.some((l) => l.stage === 'Marco contratual' && l.state === 'none')).toBe(false);
    const adj = linkOf(ok, 'Próximo marco do cronograma')!;
    expect(adj).toMatchObject({ state: 'found', label: 'Giro mecânico', note: 'proximidade no cronograma, não dependência' });
    // Sem vínculo aceito, nada de leitura de contenção.
    expect(ok.relation).toBeNull();
    // Material: números da cobertura como evidência; "requisitado, sem pedido emitido".
    expect(ok.detected.problem).toBe('Falta 3 un — requisitado, sem pedido emitido');
    expect(ok.evidence.map((e) => e.label)).toEqual(expect.arrayContaining(['Requerido', 'Reservado', 'Em trânsito', 'Em pedido', 'Em inspeção', 'Requisitado sem pedido', 'Falta']));
    expect(ok.detected.due).toBe('2026-10-01'); // menor entre required_by (05/10) e início da atividade (01/10)
    expect(ok.nextAction).toEqual({ label: 'Cobrir falta', href: `/supply/planejamento-materiais?req=${REQ}`, focused: true });
  });

  it('projeto sem contrato vinculado → `none` "Projeto sem contrato vinculado"', async () => {
    const { explainRef } = await load();
    const res = await explainRef(session(world({ project_contract_link_governed: [] }), ['projects.view', 'contracts.view']) as never,
      `act:${ACT}`, TODAY) as Ok;
    expect(linkOf(res, 'Marco contratual')).toMatchObject({ state: 'none', label: 'Projeto sem contrato vinculado' });
  });

  it('mapeamento ACEITO num ancestral → `found`, leitura de contenção, nunca "atrasa"', async () => {
    const { explainRef } = await load();
    const calls: Call[] = [];
    const tables = world({ contract_measurement_rule_timeline_mappings: [mapping({})] });
    const res = await explainRef(session(tables, ['projects.view', 'contracts.view'], {}, calls) as never, `mat:${REQ}`, TODAY) as Ok;
    const contract = linkOf(res, 'Marco contratual')!;
    expect(contract).toMatchObject({ state: 'found', label: 'Marco 3 — Rotor montado', href: `/contratos/${CONTRACT}?tab=billing` });
    expect(res.relation).toContain('A atividade faz parte da etapa Montagem do rotor, que ancora o marco Marco 3 — Rotor montado');
    // Necessidade 01/10 não é depois do término da etapa (03/10): sem comparação de datas.
    expect(res.relation).not.toContain('Comparação de datas');
    const json = JSON.stringify(res);
    expect(json).not.toMatch(/atras|impact/i);
    // Marco sem medição: medição `none`, faturamento `pending` (nasce do aceite).
    expect(linkOf(res, 'Medição')).toMatchObject({ state: 'none' });
    expect(linkOf(res, 'Faturamento')).toMatchObject({ state: 'pending' });
    // Sem vínculo aceito não haveria, mas com ele o "próximo marco do cronograma" não aparece.
    expect(linkOf(res, 'Próximo marco do cronograma')).toBeUndefined();
    // O mapeamento foi lido para a atividade E a etapa, só aceitos/propostos, só do projeto.
    const m = calls.find((c) => c.table === 'contract_measurement_rule_timeline_mappings')!;
    expect(m.ops).toContainEqual(['in', ['timeline_item_id', [ACT, STAGE]]]);
    expect(m.ops).toContainEqual(['in', ['review_state', ['accepted', 'proposed']]]);
    expect(m.ops).toContainEqual(['eq', ['project_id', PROJECT]]);
    const rules = calls.find((c) => c.table === 'contract_measurement_requirements')!;
    expect(rules.ops).toContainEqual(['neq', ['effect', 'removed']]);
    // Toda leitura filtra a organização.
    for (const c of calls) expect(c.ops).toContainEqual(['eq', ['organization_id', ORG]]);
  });

  it('comparação de datas só explícita: necessidade depois do término previsto da etapa', async () => {
    const { explainRef } = await load();
    const tables = world({
      contract_measurement_rule_timeline_mappings: [mapping({})],
      project_timeline_items: [
        item({ id: STAGE, title: 'Montagem do rotor', is_summary: true, planned_finish: '2026-09-28' }),
        item({ id: ACT, parent_id: STAGE, title: 'Montagem do mancal', planned_start: '2026-10-01' }),
      ],
    });
    const res = await explainRef(session(tables, ['projects.view', 'contracts.view']) as never, `mat:${REQ}`, TODAY) as Ok;
    expect(res.relation).toContain('Comparação de datas: a necessidade (01/10) é depois do término previsto da etapa (28/09).');
    expect(JSON.stringify(res)).not.toMatch(/atras/i);
  });

  it('aceite cuja etapa saiu do cronograma → `unconfirmed` (âncora perdida), não `found`', async () => {
    const { explainRef } = await load();
    const tables = world({
      contract_measurement_rule_timeline_mappings: [mapping({})],
      project_timeline_items: [
        item({ id: STAGE, title: 'Montagem do rotor', is_summary: true, is_active: false }),
        item({ id: ACT, parent_id: STAGE, title: 'Montagem do mancal' }),
      ],
    });
    const res = await explainRef(session(tables, ['projects.view', 'contracts.view']) as never, `act:${ACT}`, TODAY) as Ok;
    expect(linkOf(res, 'Marco contratual')).toMatchObject({ state: 'unconfirmed' });
    expect(linkOf(res, 'Marco contratual')!.detail).toContain('âncora perdida');
  });

  it('só mapeamento proposto → `unconfirmed` "Vínculo proposto — confirmar em Contratos"', async () => {
    const { explainRef } = await load();
    const tables = world({ contract_measurement_rule_timeline_mappings: [mapping({ review_state: 'proposed', reviewed_at: null })] });
    const res = await explainRef(session(tables, ['projects.view', 'contracts.view']) as never, `act:${ACT}`, TODAY) as Ok;
    expect(linkOf(res, 'Marco contratual')).toMatchObject({
      state: 'unconfirmed', label: 'Vínculo proposto — confirmar em Contratos', href: `/contratos/${CONTRACT}?tab=billing`,
    });
    expect(res.relation).toBeNull();
  });

  it('nada mapeado → `none` "sem vínculo registrado"', async () => {
    const { explainRef } = await load();
    const res = await explainRef(session(world(), ['projects.view', 'contracts.view']) as never, `act:${ACT}`, TODAY) as Ok;
    expect(linkOf(res, 'Marco contratual')).toMatchObject({ state: 'none', label: 'sem vínculo registrado' });
  });

  it('medição APPROVED_FOR_CUSTOMER → faturamento `pending` "aguardando aceite do cliente" (nunca `none`)', async () => {
    const { explainRef } = await load();
    const tables = world({
      project_measurements: [{ id: MEAS, organization_id: ORG, project_id: PROJECT, contract_id: CONTRACT, timeline_item_id: ACT,
        milestone_id: MILESTONE, status: 'APPROVED_FOR_CUSTOMER', occurrence_key: 'M-03', expected_at: '2026-10-10', customer_due_at: null }],
    });
    for (const status of ['APPROVED_FOR_CUSTOMER', 'AWAITING_CUSTOMER_ACCEPTANCE']) {
      tables.project_measurements[0].status = status;
      const res = await explainRef(session(tables, ['projects.view', 'contracts.view', 'contracts.view_values'], { financials: true }) as never,
        `meas:${MEAS}`, TODAY) as Ok;
      expect(linkOf(res, 'Medição')).toMatchObject({ state: 'found', label: 'Medição M-03' });
      expect(linkOf(res, 'Atividade')).toMatchObject({ state: 'found', label: 'Montagem do mancal' });
      expect(linkOf(res, 'Marco contratual')).toMatchObject({ state: 'found', label: 'Marco 3 — Rotor montado' });
      expect(linkOf(res, 'Faturamento')).toMatchObject({ state: 'pending', label: 'aguardando aceite do cliente' });
    }
  });

  it('RPC financeira falsa → nenhum valor em lugar nenhum da resposta (medição aceita e evento de faturamento)', async () => {
    const { explainRef } = await load();
    const cash = { billing_event_id: BILL, organization_id: ORG, title: 'Parcela 3', contract_id: CONTRACT, milestone_id: MILESTONE,
      source_measurement_id: MEAS, superseded_by_id: null, release_state: 'ELIGIBLE', eligible_amount: 1606467.95, currency: 'BRL',
      fiscal_document_id: 'fd-1', fiscal_document_status: 'authorized', fiscal_document_number: '1234',
      receivable_id: 'rc-1', receivable_status: 'OPEN', open_amount_cents: 160646795, due_date: '2026-11-10', cancelled_at: null };
    const tables = world({
      project_measurements: [{ id: MEAS, organization_id: ORG, project_id: PROJECT, contract_id: CONTRACT, timeline_item_id: ACT,
        milestone_id: MILESTONE, status: 'ACCEPTED', occurrence_key: 'M-03', expected_at: '2026-10-10', customer_due_at: null }],
      contract_to_cash_read_model: [cash],
    });
    const perms = ['projects.view', 'contracts.view', 'contracts.view_values', 'finance.view'];
    const money = /R\$|1\.?606\.?467|160646795|1606467/;

    const meas = await explainRef(session(tables, perms, { financials: false }) as never, `meas:${MEAS}`, TODAY) as Ok;
    expect(linkOf(meas, 'Faturamento')).toMatchObject({ state: 'restricted' });
    expect(JSON.stringify(meas)).not.toMatch(money);
    expect(JSON.stringify(meas)).not.toMatch(/Aguardando liberação|Autorizada|Em aberto/);

    const calls: Call[] = [];
    const bill = await explainRef(session(tables, perms, { financials: false }, calls) as never, `bill:${BILL}`, TODAY) as Ok;
    expect(bill.ok).toBe(true);
    expect(linkOf(bill, 'Faturamento')).toMatchObject({ state: 'restricted' });
    expect(JSON.stringify(bill)).not.toMatch(money);
    // Sem o portão, nem se PEDEM as colunas financeiras.
    const read = calls.find((c) => c.table === 'contract_to_cash_read_model')!;
    expect(String(read.ops.find(([m]) => m === 'select')![1][0])).not.toMatch(/amount|release_state|receivable|fiscal/);

    // Controle positivo: com a RPC verdadeira os valores e estados aparecem (o teste acima pegaria vazamento).
    const open = await explainRef(session(tables, perms, { financials: true }) as never, `meas:${MEAS}`, TODAY) as Ok;
    expect(JSON.stringify(open)).toMatch(/R\$/);
    expect(linkOf(open, 'Faturamento')).toMatchObject({ state: 'found', label: 'Aguardando liberação' });
    expect(linkOf(open, 'NF')).toMatchObject({ state: 'found', label: 'NF 1234' });
    expect(linkOf(open, 'Recebível')).toMatchObject({ state: 'found', label: 'Em aberto' });
  });

  it('RPC financeira verdadeira sem leitura de Finanças → recebível `restricted`', async () => {
    const { explainRef } = await load();
    const tables = world({
      project_measurements: [{ id: MEAS, organization_id: ORG, project_id: PROJECT, contract_id: CONTRACT, timeline_item_id: null,
        milestone_id: null, status: 'ACCEPTED', occurrence_key: 'M-03', expected_at: null, customer_due_at: null }],
      contract_to_cash_read_model: [{ billing_event_id: BILL, organization_id: ORG, source_measurement_id: MEAS, superseded_by_id: null,
        release_state: 'RELEASED', eligible_amount: 10, currency: 'BRL', fiscal_document_status: null, receivable_id: null }],
    });
    const res = await explainRef(session(tables, ['projects.view', 'contracts.view', 'contracts.view_values'], { financials: true }) as never,
      `meas:${MEAS}`, TODAY) as Ok;
    expect(linkOf(res, 'NF')).toMatchObject({ state: 'none', label: 'sem NF emitida' });
    expect(linkOf(res, 'Recebível')).toMatchObject({ state: 'restricted' });
  });

  it('objeto não encontrado vs. restrito vem da PERMISSÃO', async () => {
    const { explainRef } = await load();
    const other = '99999999-9999-4999-8999-999999999999';
    expect(await explainRef(session(world(), ['projects.view']) as never, `mat:${other}`, TODAY)).toMatchObject({ ok: false, reason: 'not_found' });
    expect(await explainRef(session(world(), []) as never, `mat:${other}`, TODAY)).toMatchObject({ ok: false, reason: 'restricted' });
    expect(await explainRef(session(world(), ['projects.view']) as never, `os:${other}`, TODAY)).toMatchObject({ ok: false, reason: 'restricted' });
  });

  it('proj-act: âncora = a atividade vencida mais antiga; detectado conta o grupo', async () => {
    const { explainRef } = await load();
    const tables = world({
      project_timeline_items: [
        item({ id: STAGE, title: 'Montagem do rotor', is_summary: true }),
        item({ id: ACT, parent_id: STAGE, title: 'Montagem do mancal', planned_finish: '2026-09-10', delay_status: 'blocked' }),
        item({ id: 'a-2', parent_id: STAGE, title: 'Alinhamento do eixo', planned_finish: '2026-09-20' }),
      ],
    });
    const res = await explainRef(session(tables, ['projects.view']) as never, `proj-act:${PROJECT}`, TODAY) as Ok;
    expect(res.detected.problem).toBe('2 atividades vencidas (1 bloqueada)');
    expect(linkOf(res, 'Atividade')).toMatchObject({ label: 'Montagem do mancal', state: 'found' });
    expect(res.nextAction).toMatchObject({ href: `/projetos/${PROJECT}?tab=timeline` });
  });

  it('chainOf: ancestrais do mais próximo à raiz, com guarda de ciclo e profundidade ≤ 12', async () => {
    const { chainOf } = await load();
    const cyc = new Map([['a', { parent_id: 'b' }], ['b', { parent_id: 'c' }], ['c', { parent_id: 'a' }]]);
    expect(chainOf(cyc, 'a')).toEqual(['a', 'b', 'c']);
    const deep = new Map(Array.from({ length: 30 }, (_, i) => [`n${i}`, { parent_id: `n${i + 1}` }] as [string, { parent_id: string }]));
    expect(chainOf(deep, 'n0')).toHaveLength(13);
  });
});
