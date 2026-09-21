'use client';

/**
 * MEDIÇÕES & EVIDÊNCIAS — a bancada operacional do projeto.
 *
 * ─── A pergunta que a tela responde ────────────────────────────────────────
 *
 * "Que trabalho de medição este projeto tem, o que falta em cada um, e de quem
 * é o próximo passo?"
 *
 * ─── O defeito que esta aba foi refeita para corrigir ──────────────────────
 *
 * Ela lia `project_measurements` e, quando a tabela vinha vazia, escrevia
 * "Nenhuma medição registrada". Só que a tabela vazia não é uma afirmação
 * sobre o contrato: a instância canônica nasce da materialização governada
 * (migration 134), que ignora cadência `ON_EVENT`/`UNKNOWN` e roda por fila.
 * Em JA10182283/2025 isso produzia a tela dizendo "nenhuma medição" sobre um
 * projeto com seis marcos contratuais e cinco pontes ACEITAS ao cronograma.
 *
 * Agora a fila nasce da ponte aceita — `project_schedule_contract_events`, a
 * MESMA linha que o Gantt desenha —, e a instância de medição, quando existe,
 * entra como um PAINEL do item, não como a condição de ele aparecer.
 *
 * ─── O que continua proibido ───────────────────────────────────────────────
 *
 *   · Nenhuma medição é criada aqui. Item previsto é trabalho previsto, e a
 *     faceta diz "Aguardando" em vez de fingir uma medição em andamento.
 *   · Nenhuma evidência vira aceite, nenhuma medição vira elegibilidade.
 *   · Nenhum registro de faturamento: isso é de Contratos, e o link leva lá.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, FileText, GanttChart, Landmark, Loader2, Ruler } from 'lucide-react';
import { HudBadge, HudButton, HudEmptyState, HudPanel, useHudToast } from '@/components/hud';
import { usePermissions } from '@/hooks/use-permissions';
import { cn } from '@/lib/utils';
import {
  ensureMeasurementForMilestone, getMeasurementPackage, MeasurementError,
} from '@/lib/projects/measurements/measurement-service';
import type { MeasurementPackage } from '@/lib/projects/measurements/types';
import {
  hasGovernedContractLink, listProjectContractEvents,
} from '@/lib/services/project-contract-events';
import {
  listProjectEvidenceByMilestone, countByMilestone,
  type MilestoneEvidenceDocument,
} from '@/lib/projects/measurements/evidence-workspace';
import {
  BUCKET_LABEL, buildWorklist, describeEmptiness, groupByBucket,
  EMPTINESS_DESCRIPTION, EMPTINESS_TITLE, summarizeWorklist,
  type MilestoneWorkItem,
} from '@/lib/projects/milestone-worklist';
import {
  contractBillingHref, contractContextHref, contractHref, documentsHref, timelineHref,
} from '@/lib/projects/cross-module-links';
import { MilestoneFacetRow } from '@/components/projects/milestone/MilestoneFacets';
import { MeasurementPackageView } from './MeasurementPackageView';
import { EvidenceWorkspace } from './EvidenceWorkspace';

const fmtDate = (iso: string | null) =>
  (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');

const fmtMoney = (v: number | null, currency: string | null) =>
  v == null
    ? '—'
    : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: currency || 'BRL' }).format(v);

/** A quantia do item, ou a razão de ela não estar ali. Nunca R$ 0,00 por falta. */
const amountText = (item: MilestoneWorkItem) =>
  (item.event.canViewValues
    ? fmtMoney(item.event.plan.plannedAmount, item.event.plan.currency)
    : 'Restrito');

function WorkItemRow({
  item, selected, onSelect,
}: {
  readonly item: MilestoneWorkItem;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full flex-col gap-1.5 border-l-2 px-3 py-2.5 text-left transition-colors',
        selected ? 'border-ig-accent bg-ig-accent/5' : 'border-transparent hover:bg-ig-surface-2/40',
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ig-fg-subtle">
            {item.eventLabel}
          </span>
          <p className="truncate text-sm text-ig-fg">{item.title}</p>
        </div>
        <span className="shrink-0 text-[11px] tabular-nums text-ig-fg-muted">
          {amountText(item)}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[11px] text-ig-fg-muted">
        {item.timelineWbsCode && <span className="tabular-nums">{item.timelineWbsCode}</span>}
        <span>previsto {fmtDate(item.plannedDate)}</span>
      </div>

      <MilestoneFacetRow item={item} compact />
    </button>
  );
}

/** O detalhe do item: contexto, evidência, medição canônica e as saídas. */
function WorkItemDetail({
  projectId, item, documents, onEvidenceChanged,
}: {
  readonly projectId: string;
  readonly item: MilestoneWorkItem;
  readonly documents: readonly MilestoneEvidenceDocument[];
  readonly onEvidenceChanged: () => void;
}) {
  const { notify } = useHudToast();
  const { hasPermission } = usePermissions();
  const [pkg, setPkg] = useState<MeasurementPackage | null>(null);
  const [pkgError, setPkgError] = useState<string | null>(null);
  const [loadingPkg, setLoadingPkg] = useState(false);
  const [opening, setOpening] = useState(false);

  const measurementId = item.measurementId;

  useEffect(() => {
    if (!measurementId) { setPkg(null); setPkgError(null); return; }
    let alive = true;
    setLoadingPkg(true);
    void (async () => {
      try {
        const loaded = await getMeasurementPackage(measurementId);
        if (alive) { setPkg(loaded); setPkgError(null); }
      } catch (e) {
        // Pacote indisponível não é pacote vazio. Dizer "sem exigências"
        // quando a consulta falhou afirmaria ausência que ninguém verificou.
        if (alive) setPkgError(e instanceof MeasurementError ? e.message : String(e));
      } finally {
        if (alive) setLoadingPkg(false);
      }
    })();
    return () => { alive = false; };
  }, [measurementId]);

  /*
    ABRIR A MEDIÇÃO — ato humano, nunca efeito de carregamento.

    O caminho normal é o gatilho da 190: concluir a etapa governada
    materializa a medição sozinha. Este botão serve ao descompasso entre o
    mundo e o cronograma, e por isso é explícito, permissionado, e só aparece
    para quem poderia preparar a medição de qualquer forma.
  */
  const canOpen = hasPermission('projects.measurements.edit');
  const openMeasurement = useCallback(async () => {
    setOpening(true);
    try {
      await ensureMeasurementForMilestone(item.milestoneId);
      notify('Medição aberta para este marco', {
        description: 'Criada como PLANEJADA. Medir, submeter e aceitar continuam sendo atos separados.',
        variant: 'success',
      });
      onEvidenceChanged();
    } catch (e) {
      notify('Não foi possível abrir a medição', {
        description: e instanceof MeasurementError ? e.message : String(e),
        variant: 'error',
      });
    } finally {
      setOpening(false);
    }
  }, [item.milestoneId, notify, onEvidenceChanged]);

  const plan = item.event.plan;

  return (
    <div className="space-y-4 p-3 text-[13px]">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ig-fg-subtle">
          {item.eventLabel}
        </p>
        <h2 className="text-base font-semibold text-ig-fg-strong">{item.title}</h2>
        <p className="mt-0.5 text-[11px] text-ig-fg-muted">
          {plan.contractNumber ?? 'Contrato'} · {BUCKET_LABEL[item.bucket]}
        </p>
      </div>

      <MilestoneFacetRow item={item} />

      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.08em] text-ig-fg-subtle">Cronograma</p>
          <p className="text-[13px] text-ig-fg">
            {item.timelineItemId
              ? `${item.timelineWbsCode ?? '—'} · ${item.timelineTitle ?? '—'}`
              : 'Sem etapa vinculada'}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.08em] text-ig-fg-subtle">Previsto</p>
          <p className="text-[13px] tabular-nums text-ig-fg">{fmtDate(item.plannedDate)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.08em] text-ig-fg-subtle">Valor contratual</p>
          <p className={cn('text-[13px] tabular-nums',
            item.event.canViewValues ? 'text-ig-fg' : 'italic text-ig-fg-disabled')}>
            {amountText(item)}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.08em] text-ig-fg-subtle">Faturamento</p>
          <p className="text-[13px] text-ig-fg" title={item.billing.hint}>
            {item.billing.label}
          </p>
        </div>
      </div>

      {/* ── A BANCADA DE EVIDÊNCIA — sempre presente, mesmo sem medição ── */}
      <EvidenceWorkspace
        projectId={projectId}
        item={item}
        documents={documents}
        onUploaded={onEvidenceChanged}
      />

      {/* ── A MEDIÇÃO CANÔNICA, quando ela existe ── */}
      <section className="space-y-2 border-t border-ig-border-subtle pt-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ig-fg-muted">
          Medição
        </h3>
        {!measurementId ? (
          <p className="text-[12px] text-ig-fg-subtle">
            {item.actionable
              ? 'Trabalho previsto pela ponte aceita ao cronograma. A medição canônica nasce '
                + 'sozinha quando a etapa do cronograma é concluída; abra-a manualmente se o '
                + 'gatilho contratual já ocorreu no mundo.'
              : 'Sem ponte aceita ao cronograma, não há medição prevista. Vincule o marco a uma '
                + 'etapa na aba Timeline.'}
          </p>
        ) : null}
        {!measurementId && item.actionable && canOpen ? (
          <HudButton
            variant="secondary"
            size="sm"
            isLoading={opening}
            leftIcon={<Ruler className="h-4 w-4" />}
            onClick={() => void openMeasurement()}
          >
            Abrir medição
          </HudButton>
        ) : loadingPkg ? (
          <p className="flex items-center gap-2 text-[12px] text-ig-fg-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando pacote…
          </p>
        ) : pkgError ? (
          <p className="text-[12px] text-ig-danger">{pkgError}</p>
        ) : pkg ? (
          <MeasurementPackageView pkg={pkg} />
        ) : null}
      </section>

      {/* ── AS SAÍDAS — o mesmo marco, nas outras telas ── */}
      <div className="flex flex-wrap items-center gap-3 border-t border-ig-border-subtle pt-3 text-[11px]">
        <Link href={timelineHref(projectId, item.milestoneId)} className="inline-flex items-center gap-1 text-ig-accent hover:underline">
          <GanttChart className="h-3 w-3" aria-hidden /> Ver no cronograma
        </Link>
        <Link href={contractContextHref(projectId, item.milestoneId)} className="inline-flex items-center gap-1 text-ig-accent hover:underline">
          <Landmark className="h-3 w-3" aria-hidden /> Ver contexto contratual
        </Link>
        <Link href={documentsHref(projectId, item.milestoneId)} className="inline-flex items-center gap-1 text-ig-accent hover:underline">
          <FileText className="h-3 w-3" aria-hidden /> Ver documentos
        </Link>
        <Link href={contractHref(item.contractId)} className="inline-flex items-center gap-1 text-ig-accent hover:underline">
          <ExternalLink className="h-3 w-3" aria-hidden /> Abrir em Contratos
        </Link>
        {/*
          Faturamento só aparece quando há o que ver: um link para a carteira
          sobre um marco que não gera parcela manda a pessoa procurar algo que
          não existe.
        */}
        {item.event.generatesBilling && (
          <Link href={contractBillingHref(item.contractId)} className="inline-flex items-center gap-1 text-ig-accent hover:underline">
            <ExternalLink className="h-3 w-3" aria-hidden /> Ver faturamento
          </Link>
        )}
      </div>
    </div>
  );
}

export function ProjectMeasurementsTab({
  projectId, focusMilestoneId = null,
}: {
  readonly projectId: string;
  readonly focusMilestoneId?: string | null;
}) {
  const [items, setItems] = useState<readonly MilestoneWorkItem[]>([]);
  const [evidence, setEvidence] = useState<ReadonlyMap<string, readonly MilestoneEvidenceDocument[]>>(new Map());
  const [contractLinked, setContractLinked] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(focusMilestoneId);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [events, docs, linked] = await Promise.all([
      listProjectContractEvents(projectId),
      listProjectEvidenceByMilestone(projectId).catch(
        () => new Map<string, readonly MilestoneEvidenceDocument[]>(),
      ),
      hasGovernedContractLink(projectId),
    ]);
    setEvidence(docs);
    setContractLinked(linked);
    setItems(buildWorklist(events, countByMilestone(docs)));
  }, [projectId]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        await reload();
        if (active) setError(null);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [reload]);

  /* A seleção segue o link de outra aba; sem link, cai no primeiro acionável. */
  useEffect(() => {
    if (focusMilestoneId) setSelectedId(focusMilestoneId);
  }, [focusMilestoneId]);

  useEffect(() => {
    setSelectedId((prev) => {
      if (prev && items.some((i) => i.milestoneId === prev)) return prev;
      return items.find((i) => i.actionable)?.milestoneId ?? items[0]?.milestoneId ?? null;
    });
  }, [items]);

  const groups = useMemo(() => groupByBucket(items), [items]);
  const summary = useMemo(() => summarizeWorklist(items), [items]);
  const selected = items.find((i) => i.milestoneId === selectedId) ?? null;

  const onEvidenceChanged = useCallback(() => {
    void reload().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [reload]);

  if (loading) {
    return (
      <HudPanel>
        <div className="flex items-center gap-2 p-6 text-sm text-ig-fg-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando medições e evidências…
        </div>
      </HudPanel>
    );
  }

  if (error) {
    return (
      <HudPanel>
        <div className="p-6 text-sm text-ig-danger">{error}</div>
      </HudPanel>
    );
  }

  /*
    A AUSÊNCIA, DITA PELO NOME CERTO.

    Três causas diferentes pedem três trabalhos diferentes: vincular contrato,
    cadastrar marco, aceitar o mapeamento. Um texto único mandava dois terços
    das pessoas para o lugar errado — e era assim que "Nenhuma medição
    registrada" aparecia sobre cinco pontes aceitas.
  */
  const emptiness = describeEmptiness(contractLinked, items);
  if (emptiness !== 'HAS_WORK') {
    return (
      <HudPanel>
        <HudEmptyState
          icon="custom"
          customIcon={<Ruler className="h-12 w-12" />}
          title={EMPTINESS_TITLE[emptiness]}
          description={EMPTINESS_DESCRIPTION[emptiness]}
        />
        {/* Marcos sem ponte continuam VISÍVEIS: eles são o trabalho de setup. */}
        {items.length > 0 && (
          <div className="border-t border-ig-border-subtle/60">
            {items.map((item) => (
              <WorkItemRow
                key={item.milestoneId}
                item={item}
                selected={item.milestoneId === selectedId}
                onSelect={() => setSelectedId(item.milestoneId)}
              />
            ))}
          </div>
        )}
      </HudPanel>
    );
  }

  return (
    <div className="space-y-3">
      <HudPanel>
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-[11px]">
          <HudBadge variant="primary" size="sm">
            {summary.actionable} de {summary.total} sincronizados com o cronograma
          </HudBadge>
          {summary.pendingMapping > 0 && (
            <HudBadge variant="warning" size="sm">
              {summary.pendingMapping} aguardando mapeamento
            </HudBadge>
          )}
          {summary.awaitingEvidence > 0 && (
            <HudBadge variant="warning" size="sm">{summary.awaitingEvidence} sem evidência</HudBadge>
          )}
          {summary.awaitingAcceptance > 0 && (
            <HudBadge variant="info" size="sm">{summary.awaitingAcceptance} em aceite</HudBadge>
          )}
          {summary.eligible > 0 && (
            <HudBadge variant="success" size="sm">{summary.eligible} elegíveis</HudBadge>
          )}
        </div>
      </HudPanel>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <HudPanel>
          {groups.map((group) => (
            <div key={group.bucket}>
              <div className="border-b border-ig-border-subtle/60 px-3 py-2">
                <h3 className="text-xs font-medium uppercase tracking-wide text-ig-fg-muted">
                  {BUCKET_LABEL[group.bucket]} ({group.items.length})
                </h3>
              </div>
              <div className="divide-y divide-ig-border-subtle/30">
                {group.items.map((item) => (
                  <WorkItemRow
                    key={item.milestoneId}
                    item={item}
                    selected={item.milestoneId === selectedId}
                    onSelect={() => setSelectedId(item.milestoneId)}
                  />
                ))}
              </div>
            </div>
          ))}
        </HudPanel>

        <HudPanel>
          {selected ? (
            <WorkItemDetail
              projectId={projectId}
              item={selected}
              documents={evidence.get(selected.milestoneId) ?? []}
              onEvidenceChanged={onEvidenceChanged}
            />
          ) : (
            <p className="p-6 text-sm text-ig-fg-muted">Selecione um marco para ver o detalhe.</p>
          )}
        </HudPanel>
      </div>
    </div>
  );
}
