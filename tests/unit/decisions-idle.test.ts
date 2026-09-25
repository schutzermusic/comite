/**
 * Caixa de Decisões VAZIA = sucesso com zero decisões. Nunca a tela de erro,
 * nunca exemplo inventado; o contexto de configuração só quando é o caso.
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/ax', () => ({
  Plane: ({ title, children }: { title?: string; children?: React.ReactNode }) => React.createElement('section', { 'data-plane': title }, children),
}));
vi.mock('../../src/components/decisions/DecisionRows', () => ({
  CompletedRow: ({ item }: { item: { title: string } }) => React.createElement('li', null, item.title),
}));

import { DecisionsIdle } from '@/components/decisions/DecisionsIdle';
import type { CompletedItem, DecisionsWorkspace } from '@/lib/decisions/types';

const ws = (over: Partial<DecisionsWorkspace> = {}): DecisionsWorkspace => ({
  generatedAt: '2026-09-25T12:00:00Z', today: '2026-09-25', viewerId: 'me', tab: 'minhas', mine: [], alsoEligible: [],
  team: null, completed: null, counts: { mine: 0, overdue: 0, alsoEligible: 0 }, categories: [], teamScope: 'NONE',
  setup: { policies: 1, authorities: 2 }, recent: [], ...over,
});
const render = (w: DecisionsWorkspace) => renderToStaticMarkup(React.createElement(DecisionsIdle, { ws: w, openKey: '', onOpen: () => undefined }));

describe('DecisionsIdle', () => {
  it('diz o que é: carregou, zero pendentes, o Apex segue acompanhando — sem tratamento de erro', () => {
    const html = render(ws());
    expect(html).toContain('Nenhuma decisão pendente');
    expect(html).toContain('Tudo que depende da sua autoridade está resolvido.');
    expect(html).toContain('O Apex continuará acompanhando aprovações, exceções e decisões dos seus fluxos operacionais.');
    expect(html).not.toMatch(/Não foi possível|erro|role="alert"/i);
    for (const label of ['pendentes', 'críticas', 'vencidas']) expect(html).toContain(`<dt>${label}</dt><dd>0</dd>`);
  });

  it('o mapa dos domínios converge para Decisões com geometria finita', () => {
    const html = render(ws());
    for (const d of ['Compras', 'Financeiro', 'Comercial', 'Contratos', 'Operações', 'Pessoas']) expect(html).toContain(`>${d}</text>`);
    expect(html).toContain('DECISÕES');
    expect(html).not.toMatch(/NaN|Infinity/);
  });

  it('contexto de configuração só quando não há política nem alçada — e dito como configuração, não falha', () => {
    expect(render(ws())).not.toContain('decisions-zero-setup');
    expect(render(ws({ setup: { policies: 0, authorities: 1 } }))).not.toContain('decisions-zero-setup');
    const html = render(ws({ setup: { policies: 0, authorities: 0 } }));
    expect(html).toContain('decisions-zero-setup');
    expect(html).toContain('É configuração, não falha');
  });

  it('"Últimas decisões" só quando há histórico', () => {
    expect(render(ws())).not.toContain('Últimas decisões');
    const recent = [{ key: 'k1', title: 'Pedido PO-0001' } as unknown as CompletedItem];
    const html = render(ws({ recent }));
    expect(html).toContain('Últimas decisões');
    expect(html).toContain('Pedido PO-0001');
  });
});
