/**
 * Supply (wave F) — a equação de cobertura (00_MASTER §5.6, 02_SUPPLY §4.2):
 *  • coberto = reservado + consumido; entrando = trânsito + pedido; falta nunca negativa;
 *  • um requisito coberto por várias fontes ao mesmo tempo (INV-07);
 *  • risco pela falta perto da necessidade;
 *  • estratégia explicável: estoque local → transferência → compra.
 */
import { describe, expect, it } from 'vitest';
import {
  fromViewRow, strategyOptions, summarizeCoverage, supplyRisk,
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
