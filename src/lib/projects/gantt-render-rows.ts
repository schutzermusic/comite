/**
 * AS LINHAS DO GANTT: atividades e as sobreposições contratuais delas.
 *
 * ─── A regra de posição, que é a razão deste arquivo existir ──────────────
 *
 * O EVENTO DE MEDIÇÃO aparece imediatamente abaixo da etapa que o sustenta —
 * a etapa apontada por `timeline_item_id` no mapeamento ACEITO. Em lugar
 * nenhum mais.
 *
 * Isso significa que eventos contratuais aparecem espalhados pela EDT, onde
 * quer que a obra os coloque: um em 1.1.2, outro em 5.4, outro em 8.1. Eles
 * NÃO são agrupados sob "Marcos gerais", nem numa seção de faturamento, nem
 * na ordem das parcelas do contrato. O contrato diz O QUE precisa acontecer;
 * o cronograma diz ONDE e QUANDO — e é o cronograma que manda na posição.
 *
 * Agrupá-los desfaria justamente a informação que a tela existe para dar: que
 * ESTA atividade, no meio da montagem, destrava uma parcela.
 *
 * ─── Por que é uma função pura, fora do componente ────────────────────────
 *
 * Porque posição é comportamento, e comportamento se testa. Dentro do
 * `useMemo` do Gantt, provar "a linha derivada fica sob a etapa certa" exigia
 * montar React, virtualização e scroll. Aqui é uma lista que entra e uma lista
 * que sai.
 *
 * ─── Por que as duas espécies dividem a mesma lista ───────────────────────
 *
 * A camada de setas de dependência posiciona cada seta por ÍNDICE DE LINHA. Se
 * a sobreposição fosse desenhada por dentro da atividade, ocuparia altura sem
 * existir no índice, e toda seta abaixo dela apontaria para o lugar errado.
 */

import type { TimelineNode } from './timeline-analytics';
import type { ProjectContractEvent } from './contract-events';

export type GanttRenderRow =
  | { readonly kind: 'activity'; readonly node: TimelineNode; readonly key: string }
  | {
      readonly kind: 'event';
      readonly event: ProjectContractEvent;
      /** Profundidade da etapa que a sustenta — a linha entra um nível abaixo. */
      readonly depth: number;
      /** A etapa sob a qual esta linha foi colocada. */
      readonly parentItemId: string;
      readonly key: string;
    };

/**
 * Intercala as sobreposições contratuais na árvore visível de atividades.
 *
 * `eventsByItem` é o índice de `governedEventsByTimelineItem`, que só contém
 * vínculo ACEITO — proposta e ambiguidade não entram no corpo do cronograma,
 * porque um palpite desenhado entre as atividades vira fato aos olhos de quem
 * lê.
 *
 * Uma etapa recolhida ou filtrada para fora não aparece em `visible`, e a
 * sobreposição dela some junto: ela pertence à etapa, não à tela.
 */
export function buildGanttRenderRows(
  visible: readonly TimelineNode[],
  eventsByItem: ReadonlyMap<string, readonly ProjectContractEvent[]>,
): readonly GanttRenderRow[] {
  const out: GanttRenderRow[] = [];
  for (const node of visible) {
    out.push({ kind: 'activity', node, key: node.item.id });
    for (const event of eventsByItem.get(node.item.id) ?? []) {
      out.push({
        kind: 'event',
        event,
        depth: node.depth,
        parentItemId: node.item.id,
        key: `${node.item.id}:${event.plan.milestoneId}`,
      });
    }
  }
  return out;
}
