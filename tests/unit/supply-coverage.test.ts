/**
 * Supply (wave F) — a equação de cobertura (00_MASTER §5.6, 02_SUPPLY §4.2):
 *  • coberto = reservado + consumido; entrando = trânsito + pedido; falta nunca negativa;
 *  • um requisito coberto por várias fontes ao mesmo tempo (INV-07);
 *  • risco pela falta perto da necessidade;
 *  • estratégia explicável: estoque local → transferência → compra.
 */
import { describe, expect, it } from 'vitest';
import {
  COVERAGE_246_RETRY_MS, COVERAGE_VIEW_BASE_COLUMNS, COVERAGE_VIEW_COLUMNS, fromViewRow, isMissingCoverage246Column,
  resetCoverage246Fallback, strategyOptions, summarizeCoverage, supplyRisk, withCoverage246Columns,
} from '@/lib/supply/coverage';
import { SUPPLY_NAV, isSupplyRoute } from '@/lib/supply/navigation';
import { itemPayload, itemSchema } from '@/lib/supply/validation';

describe('equação de cobertura', () => {
  it('sem alocação: falta = requerido', () => {
    expect(summarizeCoverage({ required: 1000 })).toMatchObject({ covered: 0, inbound: 0, shortage: 1000, status: 'SHORT' });
  });
  it('40% reserva + 30% transferência + 30% compra cobre sem falta (INV-07)', () => {
    const s = summarizeCoverage({ required: 1000, reserved: 400, inTransit: 300, onOrder: 300 });
    expect(s).toMatchObject({ covered: 400, inbound: 600, shortage: 0, status: 'INBOUND' });
    expect(s.coveredRatio).toBeCloseTo(0.4);
  });
  it('o exemplo do plano: 1.000 m, 250 reservados, 300 entrando → 450 em falta', () => {
    expect(summarizeCoverage({ required: 1000, reserved: 250, onOrder: 300 })).toMatchObject({ shortage: 450, status: 'PARTIAL' });
  });
  it('consumido conta como coberto; excesso não vira falta negativa', () => {
    expect(summarizeCoverage({ required: 100, consumed: 60, reserved: 40 }).status).toBe('COVERED');
    expect(summarizeCoverage({ required: 100, reserved: 150 }).shortage).toBe(0);
  });
  it('pedido em requisição (ainda sem pedido de compra) NÃO cobre', () => {
    expect(summarizeCoverage({ required: 100, requested: 100 }).shortage).toBe(100);
  });
  it('lê a linha da visão com números em texto (numeric do Postgres)', () => {
    expect(fromViewRow({ requirement_id: 'r', project_id: 'p', activity_id: null, item_id: 'i', requirement_type: 'MATERIAL',
      required_by: null, unit: 'm', required_qty: '10.5', reserved_qty: '2', consumed_qty: '0', in_transit_qty: '0',
      on_order_qty: '3', requested_qty: '0' })).toMatchObject({ required: 10.5, covered: 2, inbound: 3, shortage: 5.5 });
  });
});

describe('regra 246: transferência PEDIDA é pendente — não é cobertura, nem é comprada de novo', () => {
  const row = { requirement_id: 'r', project_id: 'p', activity_id: null, item_id: 'i', requirement_type: 'MATERIAL', required_by: null,
    unit: 'm', required_qty: '500', reserved_qty: '100', consumed_qty: '0', in_transit_qty: '0', on_order_qty: '0', requested_qty: '0',
    inspection_qty: '0' };

  it('qa-flx: 500 requeridos, 100 reservados, 150 pedidos (sem despacho) → falta 400 (bruta), comprável 250', () => {
    const s = fromViewRow({ ...row, pending_transfer_qty: '150.0000', purchasable_qty: '250.0000' });
    expect(s).toMatchObject({ shortage: 400, pendingTransfer: 150, purchasable: 250, status: 'PARTIAL' });
    // o risco segue a falta: o pendente não cobre
    expect(supplyRisk(s, 3)).toBe('critical');
  });

  it('o comprável é o da visão; sem as colunas (246 não aplicada), pendente 0 e comprável = falta − requisitado', () => {
    expect(fromViewRow({ ...row, requested_qty: '100' })).toMatchObject({ shortage: 400, pendingTransfer: 0, purchasable: 300 });
    expect(fromViewRow({ ...row, pending_transfer_qty: null, purchasable_qty: null })).toMatchObject({ pendingTransfer: 0, purchasable: 400 });
    // o número do banco vence (mesmo que a conta local desse outro)
    expect(fromViewRow({ ...row, pending_transfer_qty: '0', purchasable_qty: '0' }).purchasable).toBe(0);
  });

  it('a conta: GREATEST(falta − requisitado − pendente, 0) — pedida + requisitado acima da falta não fica negativo', () => {
    expect(summarizeCoverage({ required: 500, reserved: 100, requested: 400, pendingTransfer: 150 }))
      .toMatchObject({ shortage: 400, purchasable: 0 });
    expect(summarizeCoverage({ required: 1000 })).toMatchObject({ pendingTransfer: 0, purchasable: 1000 });
  });

  it('a visão sem as colunas: a leitura repete sem elas (lembrado), qualquer outro erro sobe como veio', async () => {
    resetCoverage246Fallback();
    const missing = { code: '42703', message: 'column supply_requirement_coverage.pending_transfer_qty does not exist' };
    expect(isMissingCoverage246Column(missing)).toBe(true);
    expect(isMissingCoverage246Column({ message: 'column supply_requirement_coverage.purchasable_qty does not exist' })).toBe(true);
    expect(isMissingCoverage246Column({ code: '42501', message: 'permission denied for view supply_requirement_coverage' })).toBe(false);
    expect(isMissingCoverage246Column(null)).toBe(false);

    let now = 1_000;
    const asked: string[] = [];
    const run = async (columns: string) => {
      asked.push(columns);
      return columns.includes('pending_transfer_qty') ? { data: null, error: missing } : { data: [{ requirement_id: 'r' }], error: null };
    };
    expect(await withCoverage246Columns(run, () => now)).toMatchObject({ error: null });
    expect(asked).toEqual([COVERAGE_VIEW_COLUMNS, COVERAGE_VIEW_BASE_COLUMNS]);
    // lembrado: direto às colunas anteriores
    asked.length = 0;
    await withCoverage246Columns(run, () => now);
    expect(asked).toEqual([COVERAGE_VIEW_BASE_COLUMNS]);
    // passado o prazo, tenta de novo (a migração pode ter sido aplicada)
    asked.length = 0; now += COVERAGE_246_RETRY_MS + 1;
    await withCoverage246Columns(async (columns) => { asked.push(columns); return { data: [], error: null }; }, () => now);
    expect(asked).toEqual([COVERAGE_VIEW_COLUMNS]);
    // outro erro: devolvido como veio, sem repetir
    asked.length = 0;
    const denied = { code: '42501', message: 'permission denied' };
    expect(await withCoverage246Columns(async (columns) => { asked.push(columns); return { data: null, error: denied }; }, () => now))
      .toMatchObject({ error: denied });
    expect(asked).toEqual([COVERAGE_VIEW_COLUMNS]);
    resetCoverage246Fallback();
  });
});

describe('risco de supply', () => {
  it('pela falta perto da data de necessidade', () => {
    const short = { shortage: 10, status: 'SHORT' as const };
    expect(supplyRisk(short, -1)).toBe('critical');
    expect(supplyRisk(short, 7)).toBe('critical');
    expect(supplyRisk(short, 12)).toBe('high');
    expect(supplyRisk(short, 40)).toBe('medium');
    expect(supplyRisk(short, null)).toBe('medium');
    expect(supplyRisk({ shortage: 0, status: 'COVERED' }, -5)).toBe('low');
  });
});

describe('estratégias de suprimento', () => {
  it('estoque no local de entrega primeiro, depois transferência, depois compra — com quantidades', () => {
    const opts = strategyOptions('MATERIAL', 450, [
      { locationId: 'wb', locationName: 'Almoxarifado B', available: 200, isDestination: false },
      { locationId: 'site', locationName: 'Canteiro', available: 100, isDestination: true },
    ]);
    expect(opts.map((o) => [o.strategy, o.quantity])).toEqual([['RESERVE_FROM_STOCK', 100], ['TRANSFER', 200], ['BUY', 150]]);
    expect(opts[1].rationale).toContain('Almoxarifado B');
  });
  it('serviço externo é contratado; sem falta, nenhuma ação', () => {
    expect(strategyOptions('EXTERNAL_SERVICE', 1, [])[0].strategy).toBe('EXTERNAL_SERVICE');
    expect(strategyOptions('MATERIAL', 0, [])).toEqual([]);
  });
  it('246, pela cobertura: a divisão é sobre falta − pendente; COMPRAR = o resto (a semântica do comprável)', () => {
    const cov = summarizeCoverage({ required: 500, reserved: 100, pendingTransfer: 150 });
    const opts = strategyOptions('MATERIAL', cov, [{ locationId: 'site', locationName: 'Canteiro', available: 100, isDestination: true }]);
    expect(opts.map((o) => [o.strategy, o.quantity])).toEqual([['RESERVE_FROM_STOCK', 100], ['BUY', 150]]);
    // o pendente cobre toda a falta: nada a sugerir nem a comprar
    expect(strategyOptions('MATERIAL', summarizeCoverage({ required: 150, pendingTransfer: 150 }), [])).toEqual([]);
  });
  it('246, pela cobertura: o estoque não cobre por cima de solicitação aberta (o banco recusaria) — dito, com o caminho', () => {
    const stock = [{ locationId: 'wb', locationName: 'Almoxarifado B', available: 300, isDestination: false }];
    // requisitado 500 de 500: nenhum estoque sugerido; comprar 500 (já requisitado)
    const full = strategyOptions('MATERIAL', summarizeCoverage({ required: 500, requested: 500 }), stock);
    expect(full.map((o) => [o.strategy, o.quantity])).toEqual([['BUY', 500]]);
    expect(full[0].rationale).toMatch(/o banco não reserva nem transfere por cima de solicitação aberta — para usar o estoque, cancele antes a solicitação/);
    // requisitado 200 de 500: o estoque cobre só 300
    const half = strategyOptions('MATERIAL', summarizeCoverage({ required: 500, requested: 200 }), stock);
    expect(half.map((o) => [o.strategy, o.quantity])).toEqual([['TRANSFER', 300], ['BUY', 200]]);
    expect(half[1].rationale).toBe('Estoque disponível não cobre 200: comprar o restante.');
    // o número (legado) segue sem descontos
    expect(strategyOptions('MATERIAL', 500, stock).map((o) => [o.strategy, o.quantity])).toEqual([['TRANSFER', 300], ['BUY', 200]]);
  });
});

describe('navegação e cadastro', () => {
  it('Supply acende em /supply e só nela; destinos com alçada', () => {
    expect(isSupplyRoute('/supply/planejamento-materiais')).toBe(true);
    expect(isSupplyRoute('/supplyx')).toBe(false);
    expect(SUPPLY_NAV.every((i) => i.anyPermission.length > 0)).toBe(true);
  });
  it('entrada do item: só o que veio; rastreio fora do vocabulário é recusado', () => {
    expect(itemPayload(itemSchema.parse({ code: 'CAB-35', technicalAttributes: { secao: '35mm2' } })))
      .toEqual({ code: 'CAB-35', technical_attributes: { secao: '35mm2' } });
    expect(itemSchema.safeParse({ tracking: 'BATCH' }).success).toBe(false);
  });
});
