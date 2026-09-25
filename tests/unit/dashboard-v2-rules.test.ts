/**
 * Regras PURAS do Dashboard V2 (src/lib/dashboard/rules.ts):
 *  • gravidade única; texto da falta a partir da cobertura AO VIVO;
 *  • dedup pelo objeto (req:/po:) com a Apex como evidência, `stale`, DECISION_PENDING;
 *  • atividades vencidas agrupadas por projeto; faturamento por contrato × classe;
 *  • ordem gravidade → prazo → domínio, com diversidade no topo; total sem corte;
 *  • etapas do fluxo (restrito nunca é número); dinheiro mascarado; calendário.
 */
import { describe, expect, it } from 'vitest';
import {
  billingRows, buildCalendar, buildFeedModel, buildStages, cappedOpsExtras, compareRows, diversify, isoDay, laneItems,
  materialProblem, materialRow, maskedMoney, mergeFeed, moneyText, opsRow, osNextActionLabel, overdueGroupRow, overdueProblem,
  projectRows, rankFeed, receivableRows, severityFromCommercial, severityFromOpsTone, severityFromReceivable, severityFromSignal,
  signalKey, sumByCurrency, type MaterialNeed, type SignalLike, type StagesInput,
} from '@/lib/dashboard/rules';
import type { FeedRow } from '@/lib/dashboard/types';
import type { AttentionItem } from '@/lib/operations/overview';

const TODAY = '2026-09-25';
const UG05 = 'Enel Cachoeira Dourada UG-05';

const need = (over: Partial<MaterialNeed> = {}, cov: Partial<MaterialNeed['coverage']> = {}): MaterialNeed => ({
  requirementId: 'req-1', projectId: 'p-ug05', project: UG05, title: 'Cabo 35 mm', unit: 'm', requiredBy: '2026-10-01',
  activity: null, coverage: { shortage: 120, status: 'SHORT', requested: 0, inbound: 0, ...cov }, ...over,
});

const row = (over: Partial<FeedRow>): FeedRow => ({
  key: 'x', domain: 'operacao', severity: 'high', kindLabel: 'OS', location: { kind: 'project', id: 'p1', label: 'P1' },
  object: 'o', problem: 'p', consequence: null, due: null, owner: null, ownerApplicable: false, count: 1,
  nextAction: { label: 'Abrir', href: '/x', focused: false }, explainRef: null, apex: null, rule: 'r', ...over,
});

const signal = (over: Partial<SignalLike>): SignalLike => ({
  id: 's1', kind: 'SHORTAGE', severity: 'critical', projectId: 'p-ug05', project: UG05, requirementId: 'req-1',
  purchaseOrderId: null, title: 'Comprar 120 m de CB-35 para UG-05', rationale: 'sem cobertura', evidence: [],
  lastSeenAt: '2026-09-24T10:00:00Z', engineVersion: 'supply-signals.v1', ...over,
});

describe('gravidade única', () => {
  it('mapeia cada escala de origem', () => {
    expect(severityFromOpsTone('danger')).toBe('critical');
    expect(severityFromOpsTone('warning')).toBe('high');
    expect(severityFromOpsTone('accent')).toBe('medium');
    expect(severityFromSignal('critical')).toBe('critical');
    expect(severityFromSignal('high')).toBe('high');
    expect(severityFromSignal('low')).toBe('medium');
    expect(severityFromReceivable(true)).toBe('critical');
    expect(severityFromCommercial('blocking')).toBe('critical');
    expect(severityFromCommercial('attention')).toBe('high');
  });
});

describe('material a partir da cobertura AO VIVO', () => {
  it('texto: requisitado > entrada > sem estoque nem pedido', () => {
    expect(materialProblem(need({}, { requested: 50 }))).toBe('Falta 120 m — requisitado, sem pedido emitido');
    expect(materialProblem(need({}, { inbound: 30 }))).toBe('Falta 120 m — a entrada não cobre a necessidade');
    expect(materialProblem(need())).toBe('Falta 120 m — sem estoque nem pedido');
    expect(materialProblem(need({ unit: null }, { shortage: 1.5 }))).toBe('Falta 1,5 — sem estoque nem pedido');
  });

  it('gravidade por supplyRisk sobre a necessidade = min(required_by, início da atividade); consequência pela atividade', () => {
    // required_by em 20 dias, mas a atividade começa em 5 → crítico, prazo = início da atividade.
    const r = materialRow(need({ requiredBy: '2026-10-15', activity: { id: 'a1', title: 'Montagem do estator', plannedStart: '2026-09-30' } }), TODAY);
    expect(r).not.toBeNull();
    expect(r!.severity).toBe('critical');
    expect(r!.due).toBe('2026-09-30');
    expect(r!.consequence).toBe('Atividade Montagem do estator começa em 30/09');
    expect(r!.key).toBe('req:req-1');
    expect(r!.rule).toBe('Requisito confirmado com falta, necessidade em até 14 dias ou já vencida');
    expect(materialRow(need({ requiredBy: '2026-10-05' }), TODAY)!.severity).toBe('high');
    expect(materialRow(need({ requiredBy: '2026-10-05' }), TODAY)!.consequence).toBeNull();
  });

  it('fora da janela de 14 dias, sem data ou sem falta → não é linha', () => {
    expect(materialRow(need({ requiredBy: '2026-10-20' }), TODAY)).toBeNull();
    expect(materialRow(need({ requiredBy: null }), TODAY)).toBeNull();
    expect(materialRow(need({}, { shortage: 0 }), TODAY)).toBeNull();
    // já vencida entra (crítica)
    expect(materialRow(need({ requiredBy: '2026-09-01' }), TODAY)!.severity).toBe('critical');
  });
});

describe('dedup pelo objeto', () => {
  const mat = materialRow(need({ requiredBy: '2026-10-05' }), TODAY)!; // high

  it('sinal do mesmo requisito vira evidência; gravidade = max', () => {
    const out = mergeFeed({ rows: [mat], signals: [signal({})], inboxPurchaseOrderIds: new Set(), liveShortage: () => 120 });
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe('critical');
    expect(out[0].apex?.signalId).toBe('s1');
    expect(out[0].apex?.lead).toBe('Apex identificou uma falta sem cobertura');
    expect(out[0].apex?.stale).toBe(false);
    expect(out[0].problem).toBe(mat.problem); // o texto é o da leitura ao vivo
    expect(mat.severity).toBe('high'); // a entrada não é alterada
  });

  it('SHORTAGE + ALTERNATE_STOCK + ETA_RISK do mesmo requisito → uma linha', () => {
    const out = mergeFeed({ rows: [mat], inboxPurchaseOrderIds: null, liveShortage: () => 120, signals: [
      signal({ id: 's1', kind: 'ALTERNATE_STOCK', severity: 'high' }),
      signal({ id: 's2', kind: 'SHORTAGE', severity: 'critical' }),
      signal({ id: 's3', kind: 'ETA_RISK', severity: 'high', purchaseOrderId: 'po-9' }),
    ] });
    expect(out).toHaveLength(1);
    expect(out[0].apex?.signalId).toBe('s2');
  });

  it('sem falta ao vivo → stale, sem subir a gravidade', () => {
    const lowRow = { ...mat, severity: 'medium' as const };
    const out = mergeFeed({ rows: [lowRow], signals: [signal({})], inboxPurchaseOrderIds: null, liveShortage: () => 0 });
    expect(out[0].severity).toBe('medium');
    expect(out[0].apex?.stale).toBe(true);
    // sinal sozinho e desatualizado: linha própria, no piso
    const alone = mergeFeed({ rows: [], signals: [signal({})], inboxPurchaseOrderIds: null, liveShortage: () => 0 });
    expect(alone[0].severity).toBe('medium');
    expect(alone[0].apex?.stale).toBe(true);
    // falta desconhecida (cobertura não lida) → não é stale
    const unknown = mergeFeed({ rows: [], signals: [signal({})], inboxPurchaseOrderIds: null, liveShortage: () => null });
    expect(unknown[0].apex?.stale).toBe(false);
    expect(unknown[0].severity).toBe('critical');
  });

  it('sinais sem linha viva: po: para os de pedido, req: para os de requisito, sig: para o resto', () => {
    expect(signalKey(signal({ kind: 'LATE_INBOUND', requirementId: null, purchaseOrderId: 'po-1' }))).toBe('po:po-1');
    expect(signalKey(signal({ kind: 'SUPPLIER_RELIABILITY', requirementId: null, purchaseOrderId: 'po-1' }))).toBe('po:po-1');
    expect(signalKey(signal({ kind: 'ETA_RISK', purchaseOrderId: 'po-1' }))).toBe('req:req-1');
    expect(signalKey(signal({ kind: 'DECISION_PENDING', requirementId: null, purchaseOrderId: 'po-1' }))).toBe('po:po-1');
    expect(signalKey(signal({ kind: 'DECISION_PENDING', requirementId: 'req-7', purchaseOrderId: null }))).toBe('req:req-7');
    expect(signalKey(signal({ id: 's9', kind: 'DECISION_PENDING', requirementId: null, purchaseOrderId: null }))).toBe('sig:s9');
    const out = mergeFeed({ rows: [], inboxPurchaseOrderIds: null, liveShortage: () => null, signals: [
      signal({ id: 'a', kind: 'LATE_INBOUND', severity: 'high', requirementId: null, purchaseOrderId: 'po-1' }),
      signal({ id: 'b', kind: 'SUPPLIER_RELIABILITY', severity: 'high', requirementId: null, purchaseOrderId: 'po-1' }),
    ] });
    expect(out).toHaveLength(1);
    expect(out[0].key).toBe('po:po-1');
    expect(out[0].kindLabel).toBe('Compra');
  });

  it('DECISION_PENDING de pedido: sai SÓ se o pedido está na caixa; senão "Aprovação de compra parada"', () => {
    const s = signal({ id: 'd1', kind: 'DECISION_PENDING', severity: 'high', requirementId: null, purchaseOrderId: 'po-7',
      title: 'Pedido OC-0007 aguarda aprovação há 9 dia(s)' });
    expect(mergeFeed({ rows: [], signals: [s], inboxPurchaseOrderIds: new Set(['po-7']), liveShortage: () => null })).toHaveLength(0);
    const kept = mergeFeed({ rows: [], signals: [s], inboxPurchaseOrderIds: new Set(['po-other']), liveShortage: () => null });
    expect(kept).toHaveLength(1);
    expect(kept[0].problem).toBe('Aprovação de compra parada');
    expect(kept[0].kindLabel).toBe('Compra');
    expect(kept[0].domain).toBe('supply');
    expect(kept[0].nextAction.label).not.toMatch(/decidir/i);
    // caixa ilegível → não se esconde nada às cegas
    expect(mergeFeed({ rows: [], signals: [s], inboxPurchaseOrderIds: null, liveShortage: () => null })).toHaveLength(1);
  });

  it('DECISION_PENDING de requisição fica como "Compra parada: requisição sem cotação"', () => {
    const s = signal({ id: 'q1', kind: 'DECISION_PENDING', severity: 'high', requirementId: null, purchaseOrderId: null,
      title: 'Requisição RQ-12 sem cotação há 6 dia(s)' });
    const out = mergeFeed({ rows: [], signals: [s], inboxPurchaseOrderIds: new Set(), liveShortage: () => null });
    expect(out[0].problem).toBe('Compra parada: requisição sem cotação');
    const inRfq = mergeFeed({ rows: [], inboxPurchaseOrderIds: null, liveShortage: () => null,
      signals: [{ ...s, title: 'Requisição RQ-12 em cotação há 6 dia(s)' }] });
    expect(inRfq[0].problem).toBe('Compra parada: requisição em cotação');
  });
});

describe('agrupamento', () => {
  it('atividades vencidas → uma linha por projeto, singular/plural, dono único', () => {
    const base = { projectId: 'p-ug05', project: UG05, client: 'Enel', critical: 0, oldestDue: '2026-09-10' };
    const one = overdueGroupRow({ ...base, count: 1, blocked: 0, ownerNames: ['Ana'] });
    expect(one.problem).toBe('1 atividade vencida');
    expect(one.owner).toBe('Ana');
    expect(one.severity).toBe('high');
    const many = overdueGroupRow({ ...base, count: 4, blocked: 1, ownerNames: ['Ana', 'Bruno'] });
    expect(many.problem).toBe('4 atividades vencidas (1 bloqueada)');
    expect(many.owner).toBeNull();
    expect(many.ownerApplicable).toBe(true);
    expect(many.severity).toBe('critical');
    expect(many.key).toBe('proj-act:p-ug05');
    expect(many.explainRef).toBe('proj-act:p-ug05');
    expect(many.nextAction).toEqual({ label: 'Abrir cronograma', href: '/projetos/p-ug05?tab=timeline', focused: true });
    expect(many.due).toBe('2026-09-10');
    expect(overdueProblem(3, 2)).toBe('3 atividades vencidas (2 bloqueadas)');
  });

  it('OS: nunca "Decidir" no Dashboard', () => {
    expect(osNextActionLabel('Decidir 2 divergências bloqueantes')).toBe('Resolver bloqueios na OS');
    expect(osNextActionLabel('Emitir OS')).toBe('Emitir OS');
    const item: AttentionItem = { id: 'os:o1', kind: 'service_order', object: 'OS-0042', issue: 'Decidir 1 divergência bloqueante',
      impact: 'Enel · Retrofit UG-05', due: '2026-10-01', owner: 'Carla', tone: 'danger', href: '/operacoes/ordens-servico/o1',
      actionLabel: 'Abrir OS', projectId: null, refId: 'o1' };
    const r = opsRow(item)!;
    expect(r.nextAction.label).toBe('Resolver bloqueios na OS');
    expect(r.problem).toBe('1 divergência bloqueante em aberto');
    expect(r.severity).toBe('critical');
    expect(r.key).toBe('os:o1');
    expect(JSON.stringify(r)).not.toMatch(/Decidir/);
    expect(opsRow({ ...item, kind: 'activity' })).toBeNull();
    expect(opsRow({ ...item, kind: 'material' })).toBeNull();
  });

  it('faturamento por contrato × classe; PENDING_RELEASE sai quando está na caixa; dinheiro só com o RPC', () => {
    const ev = (id: string, over: Record<string, unknown>) => ({ billingEventId: id, contractId: 'c1', title: `Evento ${id}`, eligibleAmount: 1000,
      currency: 'BRL', releaseState: 'ELIGIBLE', eligibilityState: 'ELIGIBLE', fiscalDocumentId: null, supersededById: null, legacyRow: false,
      cancelledAt: null, ...over });
    const events = [ev('e1', {}), ev('e2', {}), ev('e3', { releaseState: 'RELEASED' }), ev('e4', { releaseState: 'PENDING_RELEASE' }),
      ev('e5', { legacyRow: true }), ev('e6', { cancelledAt: '2026-09-01' })];
    const opts = { contractLabel: () => 'CT-0042 · Retrofit UG-05', financial: false, inboxBillingIds: new Set(['e4']) };
    const rows = billingRows(events, opts);
    expect(rows.map((r) => r.key).sort()).toEqual(['bill:c1:invoice', 'bill:c1:release']);
    const release = rows.find((r) => r.key === 'bill:c1:release')!;
    expect(release.problem).toBe('2 eventos elegíveis aguardando liberação');
    expect(release.count).toBe(2);
    expect(release.explainRef).toBe('bill:e1');
    expect(release.location).toEqual({ kind: 'contract', id: 'c1', label: 'CT-0042 · Retrofit UG-05' });
    const withMoney = billingRows(events, { ...opts, financial: true, inboxBillingIds: null });
    expect(withMoney.find((r) => r.key === 'bill:c1:release')!.problem).toMatch(/aguardando liberação · R\$\s2\.000,00$/);
    expect(withMoney.some((r) => r.key === 'bill:c1:approval')).toBe(true);
  });

  it('recebíveis vencidos por contrato; centavos viram unidades; valor mascarado sem o RPC', () => {
    const rc = (id: string, over: Record<string, unknown> = {}) => ({ billingEventId: id, contractId: 'c1', dueDate: '2026-09-01',
      openAmountCents: 150000, currency: 'BRL', status: 'OVERDUE', ...over });
    const list = [rc('e1'), rc('e2', { dueDate: '2026-08-20' }), rc('e3', { status: 'OPEN' })];
    const masked = receivableRows(list, { contractLabel: () => 'CT-0042', financial: false });
    expect(masked).toHaveLength(1);
    expect(masked[0].problem).toBe('2 títulos vencidos');
    expect(masked[0].severity).toBe('critical');
    expect(masked[0].due).toBe('2026-08-20');
    const shown = receivableRows(list, { contractLabel: () => 'CT-0042', financial: true });
    expect(shown[0].problem).toMatch(/2 títulos vencidos · R\$\s3\.000,00$/);
  });
});

describe('dinheiro', () => {
  it('soma por moeda; BRL formatado; outras moedas ditas, nunca somadas', () => {
    const sums = sumByCurrency([{ amount: 10, currency: 'BRL' }, { amount: '5.5', currency: 'brl' }, { amount: 7, currency: 'USD' },
      { amount: null, currency: 'BRL' }, { amount: 'abc', currency: 'BRL' }]);
    expect(sums).toEqual({ BRL: 15.5, USD: 7 });
    expect(moneyText(sums)).toMatch(/^R\$\s15,50 \+ outras moedas$/);
    expect(moneyText({ USD: 1 })).toBe('em outras moedas');
    expect(moneyText({})).toBeNull();
    expect(maskedMoney(sums, false)).toBeNull();
  });
});

describe('ordem, diversidade e total', () => {
  it('gravidade → prazo (sem prazo por último) → domínio', () => {
    const a = row({ key: 'a', severity: 'high', due: '2026-09-30' });
    const b = row({ key: 'b', severity: 'critical', due: null });
    const c = row({ key: 'c', severity: 'high', due: null });
    const d = row({ key: 'd', severity: 'high', due: '2026-09-30', domain: 'comercial' });
    expect([a, b, c, d].sort(compareRows).map((r) => r.key)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('as 8 primeiras contêm a primeira crítica de cada domínio, preservando a ordem relativa', () => {
    const ops = Array.from({ length: 10 }, (_, i) => row({ key: `op${i}`, severity: 'critical', due: `2026-09-${String(10 + i)}` }));
    const rcv = row({ key: 'rcv', domain: 'recebivel', severity: 'critical', due: '2026-09-29' });
    const sup = row({ key: 'sup', domain: 'supply', severity: 'critical', due: '2026-09-28' });
    const ranked = rankFeed([...ops, rcv, sup]);
    const top8 = ranked.slice(0, 8).map((r) => r.key);
    expect(top8).toContain('rcv');
    expect(top8).toContain('sup');
    expect(ranked.slice(0, 5).map((r) => r.key)).toEqual(expect.arrayContaining(['sup', 'rcv']));
    // ordem relativa preservada entre as operacionais
    const opOrder = ranked.filter((r) => r.key.startsWith('op')).map((r) => r.key);
    expect(opOrder).toEqual(ops.map((r) => r.key));
    expect(ranked).toHaveLength(12);
    // sem crítica em outro domínio, a ordem não muda
    const plain = [row({ key: 'x1', severity: 'critical' }), row({ key: 'x2', severity: 'high', domain: 'supply' })];
    expect(diversify(plain, 8).map((r) => r.key)).toEqual(['x1', 'x2']);
  });

  it('total = deduplicado SEM corte (inclui o que Operações cortou); linhas em 40', () => {
    const rows = Array.from({ length: 45 }, (_, i) => row({ key: `os:${i}`, severity: i < 3 ? 'critical' : 'high' }));
    const counts = {
      service_order: { total: 50, danger: 5, warning: 45 }, activity: { total: 0, danger: 0, warning: 0 },
      measurement: { total: 0, danger: 0, warning: 0 }, risk: { total: 0, danger: 0, warning: 0 },
      material: { total: 0, danger: 0, warning: 0 }, dependency: { total: 2, danger: 2, warning: 0 },
    };
    const extras = cappedOpsExtras(counts, rows);
    const model = buildFeedModel(rankFeed(rows), extras);
    expect(model.rows).toHaveLength(40);
    expect(model.total).toBe(52);
    expect(model.critical).toBe(3 + 2 + 2);
    expect(model.byDomain.operacao).toEqual({ total: 52, critical: 7 });
  });
});

describe('etapas do fluxo', () => {
  const restricted = { state: 'restricted' } as const;
  const allRestricted: StagesInput = {
    authorizedWithoutOs: restricted, openOpportunities: restricted, os: restricted, projects: restricted, needs: restricted,
    supply: restricted, execution: restricted, measurement: restricted, billing: restricted, receivables: restricted,
  };

  it('11 etapas; restrito e erro nunca têm número; Caixa é indisponível', () => {
    const stages = buildStages({ ...allRestricted, supply: { state: 'error', message: 'x' } });
    expect(stages.map((s) => s.id)).toEqual(['comercial', 'os', 'projeto', 'planejamento', 'necessidades', 'supply', 'execucao',
      'medicao', 'faturamento', 'recebivel', 'caixa']);
    for (const s of stages) expect(s.stuck).toBeNull();
    expect(stages.find((s) => s.id === 'supply')!.state).toBe('error');
    expect(stages.find((s) => s.id === 'os')!.state).toBe('restricted');
    const caixa = stages.find((s) => s.id === 'caixa')!;
    expect(caixa.state).toBe('unavailable');
    expect(caixa.reason).toBe('Nenhuma conta de caixa conectada');
    expect(caixa.href).toBeNull();
    expect(stages.find((s) => s.id === 'recebivel')!.href).toBe('/contratos?view=faturamento');
  });

  it('o substantivo concorda com o número (1 entrega atrasada, 2 entregas atrasadas)', () => {
    const one = buildStages({
      ...allRestricted,
      supply: { state: 'ok', data: { lateInbound: 1, requisitionsAwaitingSourcing: 0, receivingIssues: 0 } },
      execution: { state: 'ok', data: { overdue: 1, inProgress: 0 } },
      receivables: { state: 'ok', data: { overdue: 1, open: 1, linked: 1 } },
    });
    expect(one.find((s) => s.id === 'supply')!.stuck).toEqual({ value: 1, noun: 'entrega atrasada' });
    expect(one.find((s) => s.id === 'execucao')!.stuck).toEqual({ value: 1, noun: 'atividade vencida' });
    expect(one.find((s) => s.id === 'recebivel')!.stuck).toEqual({ value: 1, noun: 'vencido' });
    const two = buildStages({ ...allRestricted, execution: { state: 'ok', data: { overdue: 2, inProgress: 0 } } });
    expect(two.find((s) => s.id === 'execucao')!.stuck).toEqual({ value: 2, noun: 'atividades vencidas' });
  });

  it('números com substantivo e contexto', () => {
    const stages = buildStages({
      authorizedWithoutOs: { state: 'ok', data: 3 }, openOpportunities: { state: 'ok', data: 20 },
      os: { state: 'ok', data: { awaitingIssue: 4, blocked: 1, inExecution: 12 } },
      projects: { state: 'ok', data: { active: 345, health: { critical: 5, attention: 9, healthy: 300, unknown: 31 }, criticalActivities: 17 } },
      needs: { state: 'ok', data: { short: 242, critical: 8 } },
      supply: { state: 'ok', data: { lateInbound: 2, requisitionsAwaitingSourcing: 1, receivingIssues: 3 } },
      execution: { state: 'ok', data: { overdue: 40, inProgress: 88 } },
      measurement: { state: 'ok', data: { pending: 6, awaitingCustomer: 2, inReview: 1 } },
      billing: { state: 'ok', data: { awaitingRelease: 7, invoicesToIssue: 12, invoicesAmount: null } },
      receivables: { state: 'ok', data: { overdue: 0, open: 0, linked: 0 } },
    });
    const by = Object.fromEntries(stages.map((s) => [s.id, s]));
    expect(by.comercial.stuck).toEqual({ value: 3, noun: 'autorizadas sem OS' });
    expect(by.comercial.context).toBe('20 oportunidades abertas');
    expect(by.os.context).toBe('1 bloqueada · 12 em obra');
    expect(by.os.tone).toBe('danger');
    expect(by.projeto.stuck).toEqual({ value: 5, noun: 'críticos' });
    expect(by.projeto.context).toBe('345 ativos · 9 em atenção');
    expect(by.planejamento.stuck).toEqual({ value: 31, noun: 'sem cronograma' });
    expect(by.planejamento.context).toBe('17 atividades críticas');
    expect(by.necessidades.context).toBe('8 críticas (≤ 7 dias)');
    expect(by.supply.context).toBe('1 requisição aguardando cotação · 3 recebimentos com pendência');
    expect(by.execucao.stuck).toEqual({ value: 40, noun: 'atividades vencidas' });
    expect(by.execucao.definition).toMatch(/nunca é inferido/);
    expect(by.medicao.context).toBe('2 aguardando cliente · 1 em análise');
    expect(by.faturamento.context).toBe('12 NF a emitir');
    expect(by.recebivel.context).toBe('nenhum título vinculado');
    expect(by.comercial.href).toBe('/comercial?view=visao-geral');
  });

  it('comercial com só uma das leituras: número restrito, contexto presente', () => {
    const s = buildStages({ ...allRestricted, openOpportunities: { state: 'ok', data: 1 } })[0];
    expect(s.state).toBe('ok');
    expect(s.stuck).toBeNull();
    expect(s.context).toBe('1 oportunidade aberta');
  });
});

describe('projetos e calendário', () => {
  it('topIssue = a linha mais grave da fila para o projeto; links do projeto e do mapa', () => {
    const feed = rankFeed([row({ key: 'a', severity: 'high', location: { kind: 'project', id: 'p-ug05', label: UG05 } }),
      row({ key: 'b', severity: 'critical', problem: '2 atividades vencidas', kindLabel: 'Cronograma',
        location: { kind: 'project', id: 'p-ug05', label: UG05 }, nextAction: { label: 'Abrir cronograma', href: '/projetos/p-ug05?tab=timeline', focused: true } })]);
    const [p] = projectRows([{ projectId: 'p-ug05', project: UG05, client: 'Enel', level: 'critical', reasons: ['Atividade bloqueada'],
      nextMilestone: '2026-10-10', nextMilestoneTitle: 'Comissionamento' }], feed);
    expect(p.topIssue).toEqual({ label: 'Cronograma: 2 atividades vencidas', href: '/projetos/p-ug05?tab=timeline', severity: 'critical' });
    expect(p.nextMilestone).toEqual({ date: '2026-10-10', title: 'Comissionamento' });
    expect(p.href).toBe('/projetos/p-ug05?tab=overview');
    expect(p.mapHref).toBe('/projetos/operations-3d?project=p-ug05');
  });

  it('calendário: datas inválidas fora, só [hoje, hoje+30], no máximo 40 por raia', () => {
    expect(isoDay('2026-02-30')).toBeNull();
    expect(isoDay('')).toBeNull();
    expect(isoDay('2026-10-01T10:00:00Z')).toBe('2026-10-01');
    const it = (id: string, date: string) => ({ id, date, title: id, lane: 'operacao' as const, kind: 'activity' as const,
      tone: 'neutral' as const, href: null, project: null });
    const items = laneItems([it('bad', 'x'), it('past', '2026-09-24'), it('today', TODAY), it('end', '2026-10-25'),
      it('after', '2026-10-26'), it('nan', '2026-13-01')], TODAY);
    expect(items.map((i) => i.id)).toEqual(['today', 'end']);
    const many = laneItems(Array.from({ length: 60 }, (_, i) => it(`i${i}`, '2026-10-01')), TODAY);
    expect(many).toHaveLength(40);
    const cal = buildCalendar(TODAY, { operacao: { state: 'ok', data: [it('a', '2026-10-01')] }, recebivel: { state: 'error', message: 'x' } });
    expect(cal.state).toBe('ok');
    if (cal.state === 'ok') {
      expect(cal.data.lanes).toEqual([
        { id: 'operacao', label: 'Operação', state: 'ok' }, { id: 'supply', label: 'Supply', state: 'restricted' },
        { id: 'medicao', label: 'Medição', state: 'restricted' }, { id: 'recebivel', label: 'Recebíveis', state: 'unavailable' },
      ]);
      expect(cal.data.items).toHaveLength(1);
    }
    expect(buildCalendar(TODAY, {}).state).toBe('restricted');
  });
});
