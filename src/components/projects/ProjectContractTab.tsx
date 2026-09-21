'use client';

/**
 * CONTEXTO CONTRATUAL — o contrato visto de dentro do projeto.
 *
 * ─── A pergunta que esta aba responde ──────────────────────────────────────
 *
 * "O que do contrato afeta ESTE projeto?"
 *
 * Só isso. Ela é uma PROJEÇÃO de leitura: vigência, valor onde autorizado,
 * marcos que a execução precisa cumprir e o estado de cada um ao longo da
 * cadeia. Quem precisa do instrumento — cláusulas, aditivos, garantias,
 * aprovações, histórico, anexos legais, a carteira de faturamento — sai daqui
 * pelo link e vai ao módulo Contratos, que é o dono deles.
 *
 * ─── O que esta aba deliberadamente NÃO tem ────────────────────────────────
 *
 *   · Nenhum editor. Nada aqui escreve no contrato.
 *   · Nenhuma cláusula, aditivo, garantia ou documento contratual.
 *   · Nenhum fluxo de aprovação e nenhuma bancada de faturamento.
 *   · Nenhuma identidade nova de marco: a linha é o MESMO
 *     `contract_milestones.id` que Contratos, o Gantt e a medição usam.
 *
 * ─── De onde vem cada coluna ───────────────────────────────────────────────
 *
 * Cabeçalho: `project_contract_financial_read_model` (175/184).
 * Marcos e facetas: `project_schedule_contract_events` (181/182) — a MESMA
 * linha que o Gantt desenha como sobreposição e que a aba de medições usa como
 * item de trabalho. Uma fonte, três telas.
 */

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, FileSignature, GanttChart, Loader2, Ruler } from 'lucide-react';
import { HudBadge, HudEmptyState, HudPanel } from '@/components/hud';
import {
  getProjectContractProjection,
  type ProjectContractProjection,
} from '@/lib/projects/contract/project-contract-service';
import { listProjectContractEvents } from '@/lib/services/project-contract-events';
import {
  listProjectEvidenceByMilestone, countByMilestone,
} from '@/lib/projects/measurements/evidence-workspace';
import { buildWorklist, type MilestoneWorkItem } from '@/lib/projects/milestone-worklist';
import { MilestoneFacetRow } from '@/components/projects/milestone/MilestoneFacets';
import {
  contractHref, measurementHref, timelineHref,
} from '@/lib/projects/cross-module-links';
import { cn } from '@/lib/utils';

const fmtDate = (iso: string | null) => (iso ? iso.split('-').reverse().join('/') : '—');
const fmtMoney = (v: number | null, currency: string | null = 'BRL') =>
  v == null
    ? '—'
    : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: currency || 'BRL' }).format(v);

/**
 * A quantia, ou a RAZÃO de ela não estar ali.
 *
 * Sem `canViewValues`, um valor mascarado pela 184 cairia no '—' de
 * "não apurado" — e o leitor concluiria que o contrato está sem valor
 * cadastrado, quando o valor existe e ele é que não pode vê-lo.
 */
const fmtGatedMoney = (
  v: number | null,
  currency: string | null,
  canViewValues: boolean,
) => (canViewValues ? fmtMoney(v, currency) : 'Restrito');

/**
 * Uma linha de marco: identidade, dinheiro (onde autorizado), as seis facetas
 * e as três saídas.
 *
 * As saídas existem para que ninguém precise procurar o mesmo marco em outra
 * tela — é a §13 do pedido, e é a diferença entre um sistema integrado e três
 * telas que por acaso falam do mesmo contrato.
 */
function MilestoneRow({
  item, projectId, highlighted,
}: {
  readonly item: MilestoneWorkItem;
  readonly projectId: string;
  readonly highlighted: boolean;
}) {
  const plan = item.event.plan;
  const canViewValues = item.event.canViewValues;

  return (
    <div
      id={`milestone-${item.milestoneId}`}
      className={cn(
        'border-t border-ig-border-subtle py-3 transition-colors',
        highlighted && 'bg-ig-accent/5',
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ig-fg-subtle">
            {item.eventLabel}
          </p>
          <p className="text-sm font-medium text-ig-fg-strong">{item.title}</p>
        </div>
        <p className="text-sm tabular-nums text-ig-fg-strong">
          {fmtGatedMoney(plan.plannedAmount, plan.currency, canViewValues)}
          {canViewValues && item.event.contractPercent != null && (
            <span className="ml-2 text-[11px] text-ig-fg-muted">
              {item.event.contractPercent.toFixed(1)}%
            </span>
          )}
        </p>
      </div>

      <div className="mt-2">
        <MilestoneFacetRow item={item} />
      </div>

      {/*
        A OBRIGAÇÃO que este marco impõe à execução, quando o contrato a
        declara. Não é a lista de obrigações do contrato — essa é de Contratos.
        É só o que a operação precisa entregar para que o marco ocorra.
      */}
      {(plan.evidenceRequired === true || plan.customerAcceptanceRequired === true) && (
        <p className="mt-1.5 text-[11px] text-ig-fg-muted">
          Exige{plan.evidenceRequired === true ? ' evidência documental' : ''}
          {plan.evidenceRequired === true && plan.customerAcceptanceRequired === true ? ' e' : ''}
          {plan.customerAcceptanceRequired === true ? ' aceite da Contratante' : ''}.
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px]">
        <Link href={timelineHref(projectId, item.milestoneId)} className="inline-flex items-center gap-1 text-ig-accent hover:underline">
          <GanttChart className="h-3 w-3" aria-hidden /> Ver no cronograma
        </Link>
        <Link href={measurementHref(projectId, item.milestoneId)} className="inline-flex items-center gap-1 text-ig-accent hover:underline">
          <Ruler className="h-3 w-3" aria-hidden /> Ver medição
        </Link>
        <Link href={contractHref(item.contractId)} className="inline-flex items-center gap-1 text-ig-accent hover:underline">
          <ArrowUpRight className="h-3 w-3" aria-hidden /> Abrir em Contratos
        </Link>
      </div>
    </div>
  );
}

export function ProjectContractTab({
  projectId, focusMilestoneId = null,
}: {
  readonly projectId: string;
  readonly focusMilestoneId?: string | null;
}) {
  const [projection, setProjection] = useState<ProjectContractProjection | null>(null);
  const [items, setItems] = useState<readonly MilestoneWorkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        /*
          As três leituras saem juntas para que a tela mostre UM instante do
          contrato. Em série, a evidência enviada entre a primeira e a terceira
          apareceria no acervo e não na faceta do marco.

          A evidência é tolerante a falha porque ela ENRIQUECE a contagem; o
          contrato e os marcos, não: sem eles não há tela.
        */
        const [proj, events, evidence] = await Promise.all([
          getProjectContractProjection(projectId),
          listProjectContractEvents(projectId),
          listProjectEvidenceByMilestone(projectId).catch(() => new Map()),
        ]);
        if (!active) return;
        setProjection(proj);
        setItems(buildWorklist(events, countByMilestone(evidence)));
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Falha ao carregar projeção');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [projectId]);

  /* A âncora só rola quando o marco existe na lista — nunca "para o topo". */
  useEffect(() => {
    if (!focusMilestoneId || items.length === 0) return;
    document.getElementById(`milestone-${focusMilestoneId}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [focusMilestoneId, items]);

  const mappedCount = useMemo(() => items.filter((i) => i.actionable).length, [items]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-ig-fg-muted">
        <Loader2 className="h-5 w-5 animate-spin" /> Carregando contexto contratual…
      </div>
    );
  }

  if (error) {
    return (
      <HudEmptyState
        icon="file"
        title="Não foi possível carregar o contexto contratual"
        description={error}
      />
    );
  }

  const fin = projection?.financial ?? null;
  if (!fin) {
    return (
      <HudEmptyState
        icon="file"
        title="Nenhum contrato vinculado"
        description="Vincule um contrato a este projeto no módulo Contratos para acompanhar vigência, marcos e obrigações aqui."
      />
    );
  }

  return (
    <div className="space-y-4">
      <HudPanel>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <FileSignature className="mt-0.5 h-5 w-5 text-ig-accent" />
            <div>
              <p className="text-sm font-semibold text-ig-fg-strong">{fin.contractTitle ?? 'Contrato'}</p>
              <p className="text-xs text-ig-fg-muted">
                Nº {fin.contractNumber}
                {fin.counterpartyName ? ` · ${fin.counterpartyName}` : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {fin.contractStatus && <HudBadge variant="info" size="sm">{fin.contractStatus}</HudBadge>}
          </div>
        </div>

        {/* ── VIGÊNCIA — o recorte de tempo que o contrato impõe ao projeto ── */}
        <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
          <div>
            <p className="text-ig-caption text-ig-fg-muted">Início da vigência</p>
            <p className="text-sm font-medium text-ig-fg-strong">{fmtDate(fin.startDate)}</p>
          </div>
          <div>
            <p className="text-ig-caption text-ig-fg-muted">Término da vigência</p>
            <p className="text-sm font-medium text-ig-fg-strong">{fmtDate(fin.endDate)}</p>
          </div>
          <div>
            <p className="text-ig-caption text-ig-fg-muted">Assinatura</p>
            <p className="text-sm font-medium text-ig-fg-strong">{fmtDate(fin.signedDate)}</p>
          </div>
          <div>
            <p className="text-ig-caption text-ig-fg-muted">Valor do contrato</p>
            <p className="text-sm font-medium tabular-nums text-ig-fg-strong">
              {fmtGatedMoney(fin.contractValue, fin.currency, fin.canViewValues)}
            </p>
          </div>
        </div>

        {/* ── O ESTADO DA PONTE, que é o que a execução controla ── */}
        <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
          <div>
            <p className="text-ig-caption text-ig-fg-muted">Marcos contratuais</p>
            <p className="text-sm font-medium text-ig-fg-strong">{items.length}</p>
          </div>
          <div>
            <p className="text-ig-caption text-ig-fg-muted">Vinculados ao cronograma</p>
            <p className="text-sm font-medium text-ig-fg-strong">
              {mappedCount} de {items.length}
            </p>
          </div>
          <div>
            <p className="text-ig-caption text-ig-fg-muted">Eventos faturados</p>
            <p className="text-sm font-medium text-ig-fg-strong">{fin.billedEventCount}</p>
          </div>
          <div>
            {/*
              Divergência entre o cabeçalho assinado e a soma dos direitos.
              Continua aqui porque é fato CONTRATUAL que afeta o projeto — e
              continua sendo apresentada, nunca coalescida.
            */}
            <p className="text-ig-caption text-ig-fg-muted">Divergência de direitos</p>
            <p className="text-sm font-medium tabular-nums text-ig-fg-strong">
              {fmtGatedMoney(fin.reconciliationDelta, fin.currency, fin.canViewValues)}
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-4">
          <Link
            href={contractHref(fin.contractId)}
            className="inline-flex items-center gap-1 text-xs text-ig-accent hover:underline"
          >
            Abrir em Contratos <ArrowUpRight className="h-3 w-3" />
          </Link>
          <p className="text-[11px] text-ig-fg-subtle">
            Cláusulas, aditivos, garantias, aprovações e documentos contratuais são do
            módulo Contratos — esta aba não os duplica.
          </p>
        </div>
      </HudPanel>

      <HudPanel>
        <p className="mb-1 text-sm font-semibold text-ig-fg-strong">
          Marcos contratuais que afetam este projeto
        </p>
        <p className="mb-2 text-[11px] text-ig-fg-muted">
          Cada linha é o mesmo marco que aparece no cronograma, em Medições &amp; Evidências
          e em Contratos. Os estados vêm de suas autoridades — nada aqui é fabricado.
        </p>
        {items.length === 0 ? (
          <p className="py-4 text-sm text-ig-fg-muted">
            Nenhum marco de medição cadastrado neste contrato. O cadastro é do módulo Contratos.
          </p>
        ) : (
          items.map((item) => (
            <MilestoneRow
              key={item.milestoneId}
              item={item}
              projectId={projectId}
              highlighted={item.milestoneId === focusMilestoneId}
            />
          ))
        )}
      </HudPanel>
    </div>
  );
}
