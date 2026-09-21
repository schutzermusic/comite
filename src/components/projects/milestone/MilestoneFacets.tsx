'use client';

/**
 * AS FACETAS DO MARCO, na tela.
 *
 * Um componente só, usado por Contexto Contratual, por Medições & Evidências e
 * pelo acervo. Se cada aba desenhasse a própria fileira de chips, o mesmo marco
 * apareceria com "Aguardando" numa tela e "Pendente" na outra — que é como o
 * usuário conclui que os dois módulos discordam.
 *
 * O chip é o `PlanChip` do dossiê de Contratos, sem variante nova: o tracejado
 * continua significando NÃO APURADO nas três telas porque é literalmente o
 * mesmo elemento.
 */

import React from 'react';
import { PlanChip } from '@/components/contracts/billing/month/PlanChip';
import type { Facet, MilestoneWorkItem } from '@/lib/projects/milestone-worklist';

export function FacetChip({ label, facet }: { readonly label: string; readonly facet: Facet }) {
  return (
    <span className="inline-flex min-w-0 items-baseline gap-1.5">
      <span className="text-[10px] uppercase tracking-[0.08em] text-ig-fg-subtle">{label}</span>
      <PlanChip tone={facet.tone} dashed={facet.dashed} title={facet.hint}>
        {facet.label}
      </PlanChip>
    </span>
  );
}

/**
 * A fileira canônica das seis facetas, na ordem da cadeia.
 *
 * Cronograma → Execução → Evidências → Medição → Aceite → Faturamento. A ordem
 * é a da cadeia de direito contratual, e não a da importância visual: lida da
 * esquerda para a direita ela conta a história que a §11 descreve, e um chip
 * fora de ordem faria a tela sugerir que faturamento antecede aceite.
 */
export function MilestoneFacetRow({
  item, compact = false,
}: { readonly item: MilestoneWorkItem; readonly compact?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      <FacetChip label="Cronograma" facet={item.schedule} />
      {!compact && <FacetChip label="Execução" facet={item.execution} />}
      <FacetChip label="Evidências" facet={item.evidence} />
      <FacetChip label="Medição" facet={item.measurement} />
      <FacetChip label="Aceite" facet={item.acceptance} />
      <FacetChip label="Faturamento" facet={item.billing} />
    </div>
  );
}
