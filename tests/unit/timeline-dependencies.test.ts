/**
 * Geometria e integridade das dependências do Gantt.
 *
 * O tema central é o que acontece quando um extremo da seta NÃO está visível
 * — ramo recolhido, item desativado pelo import, filtro ativo. A regra é:
 * redirecionar honestamente (marcando `routed`) ou descartar. Nunca desenhar
 * uma seta que aponte para o lugar errado.
 */

import { describe, it, expect } from 'vitest';
import {
  buildDependencyEdges,
  edgePath,
  edgesInWindow,
  lagToDays,
  daysToLag,
} from '@/lib/projects/gantt-dependencies';
import { ganttScale, wouldCreateCycle, descendantIdsOf, ancestorIdsOf, filterTree, buildTree, flattenTree } from '@/lib/projects/timeline-analytics';
import type { DependencyType, TimelineDependency } from '@/lib/types/project-timeline';
import { FIXED_NOW, makeItem } from './fixtures/timeline-fixtures';

const ROW_H = 36;

function dep(over: Partial<TimelineDependency> & { id: string; predecessorId: string; successorId: string }): TimelineDependency {
  return {
    organizationId: 'org-1', projectId: 'proj-1', type: 'FS' as DependencyType,
    lagMinutes: 0, createdAt: FIXED_NOW, ...over,
  };
}

/** a: 01–05/08, b: 06–10/08 (sequência sadia FS) */
const ITEMS = () => [
  makeItem({ id: 'a', rowOrder: 1, plannedStart: '2026-08-01', plannedFinish: '2026-08-05' }),
  makeItem({ id: 'b', rowOrder: 2, plannedStart: '2026-08-06', plannedFinish: '2026-08-10' }),
];

const rowIndex = (ids: string[]) => new Map(ids.map((id, i) => [id, i]));

function edges(items = ITEMS(), deps: TimelineDependency[] = [dep({ id: 'd1', predecessorId: 'a', successorId: 'b' })], visible?: string[]) {
  return buildDependencyEdges({
    deps,
    items,
    rowIndexById: rowIndex(visible ?? items.map((i) => i.id)),
    scale: ganttScale(items, 'day', FIXED_NOW),
    rowHeight: ROW_H,
  });
}

describe('âncoras por tipo de dependência', () => {
  const items = ITEMS();
  const scale = ganttScale(items, 'day', FIXED_NOW);
  const xOf = (iso: string) => (new Date(`${iso}T00:00:00`).getTime() - scale.start.getTime()) * scale.pxPerMs;
  const DAY_PX = scale.tickWidth;

  const forType = (type: DependencyType) =>
    edges(items, [dep({ id: 'd', predecessorId: 'a', successorId: 'b', type })])[0];

  it('FS liga término da predecessora ao início da sucessora', () => {
    const e = forType('FS');
    expect(e.fromX).toBeCloseTo(xOf('2026-08-05') + DAY_PX, 4); // término inclusivo
    expect(e.toX).toBeCloseTo(xOf('2026-08-06'), 4);
  });

  it('SS liga os dois inícios', () => {
    const e = forType('SS');
    expect(e.fromX).toBeCloseTo(xOf('2026-08-01'), 4);
    expect(e.toX).toBeCloseTo(xOf('2026-08-06'), 4);
  });

  it('FF liga os dois términos', () => {
    const e = forType('FF');
    expect(e.fromX).toBeCloseTo(xOf('2026-08-05') + DAY_PX, 4);
    expect(e.toX).toBeCloseTo(xOf('2026-08-10') + DAY_PX, 4);
  });

  it('SF liga início da predecessora ao término da sucessora', () => {
    const e = forType('SF');
    expect(e.fromX).toBeCloseTo(xOf('2026-08-01'), 4);
    expect(e.toX).toBeCloseTo(xOf('2026-08-10') + DAY_PX, 4);
  });

  it('y fica no centro vertical da linha', () => {
    const e = forType('FS');
    expect(e.fromY).toBe(ROW_H / 2);
    expect(e.toY).toBe(ROW_H + ROW_H / 2);
  });
});

describe('roteamento com ramo recolhido', () => {
  /**
   *   f1 (fase, visível)
   *   └── a  (recolhida)
   *   b  (visível)   ← depende de a
   */
  const nested = () => [
    makeItem({ id: 'f1', rowOrder: 1, isSummary: true, plannedStart: '2026-08-01', plannedFinish: '2026-08-05' }),
    makeItem({ id: 'a', rowOrder: 2, parentId: 'f1', plannedStart: '2026-08-01', plannedFinish: '2026-08-05' }),
    makeItem({ id: 'b', rowOrder: 3, plannedStart: '2026-08-06', plannedFinish: '2026-08-10' }),
  ];

  it('redireciona ao ancestral visível mais próximo e marca routed', () => {
    const [edge] = edges(nested(), [dep({ id: 'd', predecessorId: 'a', successorId: 'b' })], ['f1', 'b']);
    expect(edge.routed).toBe(true);
    expect(edge.fromRow).toBe(0); // linha da fase f1
    expect(edge.toRow).toBe(1);
  });

  it('não marca routed quando os dois extremos estão visíveis', () => {
    const [edge] = edges(nested(), [dep({ id: 'd', predecessorId: 'a', successorId: 'b' })], ['f1', 'a', 'b']);
    expect(edge.routed).toBe(false);
  });

  it('descarta quando os dois extremos caem na MESMA linha', () => {
    // a → c, ambos filhos de f1, com f1 recolhida.
    const items = [
      ...nested(),
      makeItem({ id: 'c', rowOrder: 4, parentId: 'f1', plannedStart: '2026-08-03', plannedFinish: '2026-08-05' }),
    ];
    expect(edges(items, [dep({ id: 'd', predecessorId: 'a', successorId: 'c' })], ['f1'])).toHaveLength(0);
  });

  it('descarta quando o extremo não tem NENHUM ancestral visível', () => {
    // Caso real do import: a etapa virou is_active=false e sumiu da lista.
    const items = ITEMS();
    expect(edges(items, [dep({ id: 'd', predecessorId: 'a', successorId: 'b' })], ['b'])).toHaveLength(0);
  });

  it('descarta quando a dependência referencia item inexistente', () => {
    const items = ITEMS();
    expect(edges(items, [dep({ id: 'd', predecessorId: 'sumiu', successorId: 'b' })])).toHaveLength(0);
  });

  it('deduplica arestas que colapsam na mesma rota, contando quantas', () => {
    const items = [
      makeItem({ id: 'f1', rowOrder: 1, isSummary: true, plannedStart: '2026-08-01', plannedFinish: '2026-08-05' }),
      makeItem({ id: 'a1', rowOrder: 2, parentId: 'f1', plannedStart: '2026-08-01', plannedFinish: '2026-08-05' }),
      makeItem({ id: 'a2', rowOrder: 3, parentId: 'f1', plannedStart: '2026-08-02', plannedFinish: '2026-08-05' }),
      makeItem({ id: 'b', rowOrder: 4, plannedStart: '2026-08-06', plannedFinish: '2026-08-10' }),
    ];
    const deps = [
      dep({ id: 'd1', predecessorId: 'a1', successorId: 'b' }),
      dep({ id: 'd2', predecessorId: 'a2', successorId: 'b' }),
    ];
    const result = edges(items, deps, ['f1', 'b']);
    expect(result).toHaveLength(1);
    expect(result[0].mergedCount).toBe(2);
  });
});

describe('detecção de violação (FS)', () => {
  it('sucessora começando ANTES do término da predecessora ⇒ violada', () => {
    const items = [
      makeItem({ id: 'a', rowOrder: 1, plannedStart: '2026-08-01', plannedFinish: '2026-08-10' }),
      makeItem({ id: 'b', rowOrder: 2, plannedStart: '2026-08-05', plannedFinish: '2026-08-15' }),
    ];
    expect(edges(items)[0].violated).toBe(true);
  });

  it('sequência sadia não é violada', () => {
    expect(edges()[0].violated).toBe(false);
  });

  it('o lag empurra a data mais cedo permitida', () => {
    // a termina 05/08 ⇒ sem lag, b poderia começar 06/08. Com 3 dias de lag, não.
    const deps = [dep({ id: 'd', predecessorId: 'a', successorId: 'b', lagMinutes: daysToLag(3) })];
    expect(edges(ITEMS(), deps)[0].violated).toBe(true);
  });

  it('só FS é avaliada — SS/FF/SF nunca marcam violação', () => {
    const items = [
      makeItem({ id: 'a', rowOrder: 1, plannedStart: '2026-08-01', plannedFinish: '2026-08-10' }),
      makeItem({ id: 'b', rowOrder: 2, plannedStart: '2026-08-05', plannedFinish: '2026-08-15' }),
    ];
    for (const type of ['SS', 'FF', 'SF'] as DependencyType[]) {
      expect(edges(items, [dep({ id: 'd', predecessorId: 'a', successorId: 'b', type })])[0].violated).toBe(false);
    }
  });

  it('datas ausentes não geram violação (não inventa problema)', () => {
    const items = [
      makeItem({ id: 'a', rowOrder: 1, plannedStart: '2026-08-01', plannedFinish: null }),
      makeItem({ id: 'b', rowOrder: 2, plannedStart: '2026-08-05', plannedFinish: '2026-08-15' }),
    ];
    expect(edges(items)[0].violated).toBe(false);
  });
});

describe('edgePath', () => {
  it('gera um path que começa na origem e termina no destino', () => {
    const [edge] = edges();
    const d = edgePath(edge, ROW_H);
    expect(d.startsWith(`M ${edge.fromX} ${edge.fromY}`)).toBe(true);
    expect(d.endsWith(`L ${edge.toX} ${edge.toY}`)).toBe(true);
  });

  it('sequência justa (b começa onde a termina) desce reto, sem sarjeta', () => {
    // O caso mais comum de um cronograma real: toX === fromX.
    const d = edgePath(edges()[0], ROW_H);
    expect(d).not.toContain('Q');
    expect(d.split('L')).toHaveLength(2);
  });

  it('folga à frente usa o cotovelo curto', () => {
    const items = [
      makeItem({ id: 'a', rowOrder: 1, plannedStart: '2026-08-01', plannedFinish: '2026-08-05' }),
      makeItem({ id: 'b', rowOrder: 2, plannedStart: '2026-08-20', plannedFinish: '2026-08-25' }),
    ];
    expect(edgePath(edges(items)[0], ROW_H).split('Q')).toHaveLength(3); // 2 curvas
  });

  it('link para trás usa a rota longa pela sarjeta', () => {
    const items = [
      makeItem({ id: 'a', rowOrder: 1, plannedStart: '2026-08-20', plannedFinish: '2026-08-25' }),
      makeItem({ id: 'b', rowOrder: 2, plannedStart: '2026-08-01', plannedFinish: '2026-08-05' }),
    ];
    expect(edgePath(edges(items)[0], ROW_H).split('Q')).toHaveLength(5); // 4 curvas
  });
});

describe('edgesInWindow (virtualização)', () => {
  const build = (fromRow: number, toRow: number) =>
    ({ fromRow, toRow } as Parameters<typeof edgesInWindow>[0][number]);

  it('mantém arestas que cruzam a janela mesmo com os dois extremos fora', () => {
    expect(edgesInWindow([build(0, 100)], 40, 60)).toHaveLength(1);
  });

  it('descarta arestas inteiramente acima ou abaixo da janela', () => {
    expect(edgesInWindow([build(0, 5)], 40, 60)).toHaveLength(0);
    expect(edgesInWindow([build(80, 90)], 40, 60)).toHaveLength(0);
  });

  it('mantém aresta com um extremo dentro', () => {
    expect(edgesInWindow([build(30, 45)], 40, 60)).toHaveLength(1);
  });
});

describe('wouldCreateCycle', () => {
  const chain = [
    { predecessorId: 'a', successorId: 'b' },
    { predecessorId: 'b', successorId: 'c' },
  ];

  it('fecha o ciclo A→B→C→A', () => {
    expect(wouldCreateCycle(chain, 'c', 'a')).toBe(true);
  });

  it('permite ligação que não fecha ciclo', () => {
    expect(wouldCreateCycle(chain, 'a', 'c')).toBe(false);
  });

  it('barra auto-referência', () => {
    expect(wouldCreateCycle([], 'a', 'a')).toBe(true);
  });

  it('não entra em loop infinito com ciclo já existente no banco', () => {
    const cyclic = [...chain, { predecessorId: 'c', successorId: 'a' }];
    expect(wouldCreateCycle(cyclic, 'b', 'a')).toBe(true);
  });
});

describe('helpers de árvore usados pelo editor', () => {
  const items = () => [
    makeItem({ id: 'f1', rowOrder: 1, isSummary: true }),
    makeItem({ id: 'a', rowOrder: 2, parentId: 'f1' }),
    makeItem({ id: 'a1', rowOrder: 3, parentId: 'a' }),
    makeItem({ id: 'b', rowOrder: 4 }),
  ];

  it('descendantIdsOf exclui o próprio e pega netos', () => {
    expect([...descendantIdsOf(items(), 'f1')].sort()).toEqual(['a', 'a1']);
  });

  it('ancestorIdsOf sobe até a raiz', () => {
    expect(ancestorIdsOf(items(), 'a1')).toEqual(['a', 'f1']);
  });

  it('ancestorIdsOf não trava com parentId cíclico', () => {
    const cyclic = [
      makeItem({ id: 'x', rowOrder: 1, parentId: 'y' }),
      makeItem({ id: 'y', rowOrder: 2, parentId: 'x' }),
    ];
    expect(ancestorIdsOf(cyclic, 'x')).toEqual(['y']);
  });
});

describe('filterTree', () => {
  const items = () => [
    makeItem({ id: 'f1', rowOrder: 1, isSummary: true, title: 'Fase Um' }),
    makeItem({ id: 'a', rowOrder: 2, parentId: 'f1', title: 'Montagem' }),
    makeItem({ id: 'b', rowOrder: 3, parentId: 'f1', title: 'Comissionamento' }),
    makeItem({ id: 'c', rowOrder: 4, title: 'Solta' }),
  ];

  it('mantém o ancestral de um match e o marca como ancestral, não como match', () => {
    const result = filterTree(buildTree(items()), (i) => i.title === 'Montagem');
    expect(flattenTree(result.roots, new Set()).map((n) => n.item.id)).toEqual(['f1', 'a']);
    expect([...result.matchedIds]).toEqual(['a']);
    expect([...result.ancestorIds]).toEqual(['f1']);
  });

  it('a fase que casa por mérito próprio traz os filhos junto', () => {
    const result = filterTree(buildTree(items()), (i) => i.id === 'f1');
    expect(flattenTree(result.roots, new Set()).map((n) => n.item.id)).toEqual(['f1', 'a', 'b']);
    expect(result.ancestorIds.size).toBe(0);
  });

  it('sem nenhum match, devolve árvore vazia', () => {
    expect(filterTree(buildTree(items()), () => false).roots).toHaveLength(0);
  });

  it('não muta a árvore original', () => {
    const roots = buildTree(items());
    filterTree(roots, (i) => i.id === 'a');
    expect(roots[0].children).toHaveLength(2);
  });
});

describe('conversão de lag', () => {
  it('vai e volta entre dias e minutos', () => {
    expect(daysToLag(3)).toBe(4320);
    expect(lagToDays(4320)).toBe(3);
    expect(lagToDays(0)).toBe(0);
  });

  it('aceita meio dia', () => {
    expect(daysToLag(0.5)).toBe(720);
    expect(lagToDays(720)).toBe(0.5);
  });
});
