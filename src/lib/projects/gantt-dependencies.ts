/**
 * Geometria das setas de dependência do Gantt (migration 032).
 *
 * Puro: recebe as dependências, o índice de linhas VISÍVEIS e a escala, e
 * devolve arestas prontas para virar `<path d>`. Sem React, sem Supabase.
 *
 * Três regras de honestidade guiam o roteamento:
 *
 *   1. Ramo recolhido — a aresta é redirecionada ao ancestral visível mais
 *      próximo e marcada `routed`, para a UI desenhá-la tracejada. Ela aponta
 *      para "algo lá dentro", e o desenho precisa dizer isso.
 *   2. Extremo inexistente — quando nem o item nem qualquer ancestral está
 *      visível (caso real: o import desativou a etapa), a aresta é DESCARTADA.
 *      Melhor nenhuma seta do que uma seta mentirosa.
 *   3. Violação — em FS, sucessora começando antes do término da predecessora
 *      + lag é sinalizado. É qualidade de cronograma de graça, derivada, e
 *      nunca escrita de volta no banco.
 */

import type { DependencyType, TimelineDependency, TimelineItem } from '@/lib/types/project-timeline';
import { ganttX, visibleAncestorOf, type GanttScale } from '@/lib/projects/timeline-analytics';

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTES_PER_DAY = 1440;

export interface DepEdge {
  id: string;
  predecessorId: string;
  successorId: string;
  type: DependencyType;
  fromRow: number;
  toRow: number;
  fromX: number;
  toX: number;
  fromY: number;
  toY: number;
  /** Algum extremo caiu num ancestral por causa de ramo recolhido. */
  routed: boolean;
  /** FS cuja sucessora começa antes do término da predecessora + lag. */
  violated: boolean;
  /** Quantas dependências colapsaram nesta mesma aresta após o roteamento. */
  mergedCount: number;
  label: string;
}

export interface BuildDependencyEdgesInput {
  deps: TimelineDependency[];
  items: TimelineItem[];
  /** Índice da linha de cada item VISÍVEL (pós-collapse e pós-filtro). */
  rowIndexById: ReadonlyMap<string, number>;
  scale: GanttScale;
  rowHeight: number;
}

function dateOf(iso: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Extremidades horizontais da barra de um item, em px da escala. */
function anchorsOf(item: TimelineItem, scale: GanttScale): { left: number; right: number } | null {
  const left = ganttX(scale, item.plannedStart ?? item.plannedFinish);
  const finish = ganttX(scale, item.plannedFinish ?? item.plannedStart);
  if (left === null || finish === null) return null;
  // Término é inclusivo (+1 dia), igual a ganttBar.
  return { left, right: finish + DAY_MS * scale.pxPerMs };
}

/** FS: sucessora não pode começar antes do término da predecessora + lag. */
function isViolated(pred: TimelineItem, succ: TimelineItem, type: DependencyType, lagMinutes: number): boolean {
  if (type !== 'FS') return false;
  const predFinish = dateOf(pred.plannedFinish);
  const succStart = dateOf(succ.plannedStart);
  if (!predFinish || !succStart) return false;
  const earliest = predFinish.getTime() + DAY_MS + (lagMinutes / MINUTES_PER_DAY) * DAY_MS;
  return succStart.getTime() < earliest;
}

export function buildDependencyEdges(input: BuildDependencyEdgesInput): DepEdge[] {
  const { deps, items, rowIndexById, scale, rowHeight } = input;
  const itemById = new Map(items.map((i) => [i.id, i]));
  const parentOf = new Map(items.map((i) => [i.id, i.parentId] as const));
  const visibleIds = new Set(rowIndexById.keys());

  const byKey = new Map<string, DepEdge>();

  for (const dep of deps) {
    const pred = itemById.get(dep.predecessorId);
    const succ = itemById.get(dep.successorId);
    if (!pred || !succ) continue;

    const fromId = visibleAncestorOf(dep.predecessorId, parentOf, visibleIds);
    const toId = visibleAncestorOf(dep.successorId, parentOf, visibleIds);
    // Regra 2: extremo sem nenhum ancestral visível.
    if (!fromId || !toId) continue;
    // Ambos caíram na mesma linha: a seta seria um laço sobre si mesma.
    if (fromId === toId) continue;

    const fromRow = rowIndexById.get(fromId)!;
    const toRow = rowIndexById.get(toId)!;
    const fromAnchors = anchorsOf(itemById.get(fromId)!, scale);
    const toAnchors = anchorsOf(itemById.get(toId)!, scale);
    if (!fromAnchors || !toAnchors) continue;

    const routed = fromId !== dep.predecessorId || toId !== dep.successorId;

    // Âncoras por tipo: a primeira letra é o extremo da predecessora,
    // a segunda o da sucessora (Finish/Start).
    const fromX = dep.type === 'FS' || dep.type === 'FF' ? fromAnchors.right : fromAnchors.left;
    const toX = dep.type === 'FS' || dep.type === 'SS' ? toAnchors.left : toAnchors.right;

    const key = `${fromRow}:${toRow}:${dep.type}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.mergedCount += 1;
      existing.violated = existing.violated || isViolated(pred, succ, dep.type, dep.lagMinutes);
      continue;
    }

    byKey.set(key, {
      id: dep.id,
      predecessorId: dep.predecessorId,
      successorId: dep.successorId,
      type: dep.type,
      fromRow,
      toRow,
      fromX,
      toX,
      fromY: fromRow * rowHeight + rowHeight / 2,
      toY: toRow * rowHeight + rowHeight / 2,
      routed,
      violated: isViolated(pred, succ, dep.type, dep.lagMinutes),
      mergedCount: 1,
      label: `${pred.title} → ${succ.title}`,
    });
  }

  return [...byKey.values()];
}

const STUB = 12;
const RADIUS = 4;

/**
 * Cotovelo ortogonal com cantos arredondados. Quando a sucessora está à
 * esquerda (link "para trás"), a rota sai da predecessora, desce até a sarjeta
 * entre as duas linhas, atravessa e entra pela esquerda da sucessora.
 */
export function edgePath(edge: DepEdge, rowHeight: number): string {
  const { fromX, fromY, toX, toY } = edge;
  const down = toY > fromY ? 1 : -1;
  const r = Math.min(RADIUS, Math.abs(toY - fromY) / 2 || RADIUS);

  // Caminho para frente: sai, curva na vertical, curva de novo, entra.
  if (toX >= fromX + STUB) {
    const midX = toX - STUB;
    return [
      `M ${fromX} ${fromY}`,
      `L ${midX - r} ${fromY}`,
      `Q ${midX} ${fromY} ${midX} ${fromY + r * down}`,
      `L ${midX} ${toY - r * down}`,
      `Q ${midX} ${toY} ${midX + r} ${toY}`,
      `L ${toX} ${toY}`,
    ].join(' ');
  }

  // Sequência justa — o caso MAIS COMUM num cronograma real: a sucessora começa
  // exatamente onde a predecessora termina, então toX ≈ fromX. Desce reto (é o
  // que o MS Project desenha); a seta aponta para baixo, que é o sentido certo.
  if (toX >= fromX - 1) {
    if (Math.abs(toX - fromX) < 2) return `M ${fromX} ${fromY} L ${fromX} ${toY}`;
    return [
      `M ${fromX} ${fromY}`,
      `L ${fromX} ${toY - r * down}`,
      `Q ${fromX} ${toY} ${fromX + r} ${toY}`,
      `L ${toX} ${toY}`,
    ].join(' ');
  }

  // Caminho para trás: usa a sarjeta entre as linhas.
  const gutterY = fromY + (down * rowHeight) / 2;
  const outX = fromX + STUB;
  const inX = toX - STUB;
  return [
    `M ${fromX} ${fromY}`,
    `L ${outX - r} ${fromY}`,
    `Q ${outX} ${fromY} ${outX} ${fromY + r * down}`,
    `L ${outX} ${gutterY - r * down}`,
    `Q ${outX} ${gutterY} ${outX - r} ${gutterY}`,
    `L ${inX + r} ${gutterY}`,
    `Q ${inX} ${gutterY} ${inX} ${gutterY + r * down}`,
    `L ${inX} ${toY - r * down}`,
    `Q ${inX} ${toY} ${inX + r} ${toY}`,
    `L ${toX} ${toY}`,
  ].join(' ');
}

/** Arestas que tocam a janela de linhas renderizadas (virtualização). */
export function edgesInWindow(edges: DepEdge[], startIndex: number, endIndex: number): DepEdge[] {
  return edges.filter(
    (e) => Math.max(e.fromRow, e.toRow) >= startIndex && Math.min(e.fromRow, e.toRow) <= endIndex,
  );
}

/** Lag em minutos → dias, para a UI do editor. */
export function lagToDays(lagMinutes: number): number {
  return Math.round((lagMinutes / MINUTES_PER_DAY) * 100) / 100;
}

export function daysToLag(days: number): number {
  return Math.round(days * MINUTES_PER_DAY);
}
