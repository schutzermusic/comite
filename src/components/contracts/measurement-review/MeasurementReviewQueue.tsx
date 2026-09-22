'use client';

/**
 * CONTRATOS → APROVAÇÕES: a fila de medições.
 *
 * ─── O que esta fila é ─────────────────────────────────────────────────────
 *
 * O MESMO item que Projetos enviou. Mesmo id de medição, mesmo estado, mesma
 * história. Não há cópia do marco, não há segundo identificador e não há estado
 * próprio de "aprovação" — a fila é um recorte da medição canônica pelos
 * estados que exigem alguém de Contratos (migration 194).
 *
 * ─── O que ela mostra, e por quê ───────────────────────────────────────────
 *
 * Contrato, projeto, marco, valor (quando autorizado), atividade vinculada,
 * documentos, exigências, o parecer do Apex, as pendências, a data de envio, o
 * SLA e o histórico. É a §5 do plano, item por item — e cada número sai da
 * autoridade dele: prontidão do resolvedor, parecer da pré-análise, prazo da
 * política declarada.
 *
 * ─── As duas ausências ditas com o nome certo ──────────────────────────────
 *
 *   · Quantia RESTRITA sai como "Restrito", nunca R$ 0,00.
 *   · Prazo NÃO DECLARADO sai como "Prazo não declarado", nunca "no prazo".
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle, Clock, ExternalLink, FileText, GanttChart, Loader2, Ruler, ShieldCheck,
} from 'lucide-react';
import { HudBadge, HudButton, HudEmptyState, HudPanel } from '@/components/hud';
import { usePermissions } from '@/hooks/use-permissions';
import { cn } from '@/lib/utils';
import {
  contractHref, documentsHref, measurementHref, timelineHref,
} from '@/lib/projects/cross-module-links';
import {
  REVIEW_ACTION_LABEL, availableActions, groupQueueByBucket, listReviewQueue, summarizeQueue,
  type ReviewAction, type ReviewQueueItem,
} from '@/lib/projects/measurements/review-queue';
import {
  REVIEW_BUCKET_LABEL, SLA_STAGE_LABEL, SLA_STATE_LABEL, readinessReasonLabel,
} from '@/lib/projects/measurements/types';
import { preAnalysisHeadline } from '@/lib/projects/measurements/preanalysis';
import { MeasurementReviewActionModal } from './MeasurementReviewActions';

const fmtDate = (iso: string | null) =>
  (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');

/** A quantia, ou a RAZÃO de ela não estar ali. Nunca R$ 0,00 por falta. */
function amountText(item: ReviewQueueItem): string {
  if (!item.canViewValues) return 'Restrito';
  const v = item.acceptedValue ?? item.measuredValue ?? item.milestoneAmount;
  if (v == null) return 'Não apurado';
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: item.currency || 'BRL',
  }).format(v);
}

function SlaChip({ item }: { readonly item: ReviewQueueItem }) {
  const { sla } = item;
  if (!sla.stage) return null;
  const variant = sla.state === 'OVERDUE' ? 'danger'
    : sla.state === 'WARNING' ? 'warning'
    : sla.state === 'ON_TIME' ? 'info' : 'default';
  return (
    <HudBadge variant={variant} size="sm">
      <Clock className="mr-1 inline h-3 w-3" aria-hidden />
      {SLA_STAGE_LABEL[sla.stage]}: {SLA_STATE_LABEL[sla.state]}
      {sla.dueAt ? ` (${fmtDate(sla.dueAt)})` : ''}
    </HudBadge>
  );
}

function QueueRow({
  item, selected, onSelect,
}: {
  readonly item: ReviewQueueItem;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full flex-col gap-1 border-l-2 px-3 py-2.5 text-left transition-colors',
        selected ? 'border-ig-accent bg-ig-accent/5' : 'border-transparent hover:bg-ig-surface-2/40',
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ig-fg-subtle">
            {item.contractNumber ?? item.projectCode ?? 'Contrato'}
          </span>
          <p className="truncate text-sm text-ig-fg">{item.milestoneTitle ?? 'Evento contratual'}</p>
        </div>
        <span className={cn('shrink-0 text-[11px] tabular-nums',
          item.canViewValues ? 'text-ig-fg-muted' : 'italic text-ig-fg-disabled')}>
          {amountText(item)}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <HudBadge variant="default" size="sm">{item.statusLabel}</HudBadge>
        <SlaChip item={item} />
        {item.openCorrectionCount > 0 && (
          <HudBadge variant="warning" size="sm">{item.openCorrectionCount} correção(ões)</HudBadge>
        )}
        {item.preAnalysis.inconsistent > 0 && (
          <HudBadge variant="danger" size="sm">inconsistência</HudBadge>
        )}
      </div>
    </button>
  );
}

function QueueDetail({
  item, onAct,
}: {
  readonly item: ReviewQueueItem;
  readonly onAct: (a: ReviewAction) => void;
}) {
  const { hasPermission } = usePermissions();
  const canReview = hasPermission('contracts.measurements.review');
  const canAccept = hasPermission('projects.measurements.accept');
  const actions = availableActions(item);
  const headline = preAnalysisHeadline(item.preAnalysis);

  /** Registrar aceite tem chave PRÓPRIA: analisar e aceitar são dois poderes. */
  const allowed = (a: ReviewAction) =>
    (a === 'record_acceptance' || a === 'reject' ? canAccept : canReview);

  return (
    <div className="space-y-4 p-3 text-[13px]">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ig-fg-subtle">
          {item.contractNumber ?? 'Contrato'} · {item.projectCode ?? 'Projeto'}
        </p>
        <h2 className="text-base font-semibold text-ig-fg-strong">
          {item.milestoneTitle ?? 'Evento contratual'}
        </h2>
        <p className="mt-0.5 text-[11px] text-ig-fg-muted">
          {item.projectClient ?? item.counterpartyName ?? '—'} · {item.statusLabel}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <HudBadge variant="default" size="sm">{item.statusLabel}</HudBadge>
        <SlaChip item={item} />
        {item.sla.escalated && (
          <HudBadge variant="danger" size="sm">escalonado</HudBadge>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.08em] text-ig-fg-subtle">Atividade / EDT</p>
          <p className="text-[13px] text-ig-fg">
            {item.timelineTitle
              ? `${item.timelineWbsCode ?? '—'} · ${item.timelineTitle}`
              /* Ausência dita: sem ponte aceita não há etapa, e isso é setup. */
              : 'Sem etapa de cronograma vinculada'}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.08em] text-ig-fg-subtle">Enviada para análise</p>
          <p className="text-[13px] tabular-nums text-ig-fg">{fmtDate(item.submittedAt)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.08em] text-ig-fg-subtle">Valor</p>
          <p className={cn('text-[13px] tabular-nums',
            item.canViewValues ? 'text-ig-fg' : 'italic text-ig-fg-disabled')}>
            {amountText(item)}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.08em] text-ig-fg-subtle">Documentos</p>
          <p className="text-[13px] text-ig-fg">
            {item.evidenceCount === 0 ? 'Nenhuma evidência vinculada'
              : `${item.evidenceCount} evidência(s) vinculada(s)`}
          </p>
        </div>
      </div>

      {/* ── PENDÊNCIAS, da autoridade da prontidão ── */}
      {item.readinessReasons.length > 0 && (
        <section>
          <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-ig-fg-muted">
            Pendências e inconsistências
          </h3>
          <ul className="space-y-0.5">
            {item.readinessReasons.map((r) => (
              <li key={r} className="flex items-start gap-1.5 text-[12px] text-ig-fg">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-ig-warning" aria-hidden />
                {readinessReasonLabel(r)}
              </li>
            ))}
          </ul>
          {item.unknownRequirementCount > 0 && (
            <p className="mt-1 text-[11px] text-ig-warning">
              {item.unknownRequirementCount} exigência(s) que o contrato não declara se se aplicam —
              decidir isso é ato humano.
            </p>
          )}
        </section>
      )}

      {/* ── O PARECER DO APEX ── */}
      <section>
        <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-ig-fg-muted">
          Pré-análise do Apex
        </h3>
        {!item.preAnalysis.analyzed ? (
          <p className="text-[12px] text-ig-fg-subtle">
            Nenhum documento desta medição foi pré-analisado. A pré-análise é feita em
            Projetos → Medições &amp; Evidências, e não constitui aceite contratual.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {headline && <HudBadge variant="info" size="sm">{headline}</HudBadge>}
              {item.preAnalysis.notMet > 0 && (
                <HudBadge variant="warning" size="sm">{item.preAnalysis.notMet} não atendido(s)</HudBadge>
              )}
              {item.preAnalysis.notFound > 0 && (
                <HudBadge variant="default" size="sm">
                  {item.preAnalysis.notFound} não localizado(s)
                </HudBadge>
              )}
              {item.preAnalysis.inconsistent > 0 && (
                <HudBadge variant="danger" size="sm">
                  {item.preAnalysis.inconsistent} inconsistência(s)
                </HudBadge>
              )}
              {item.preAnalysis.needsHumanReview > 0 && (
                <HudBadge variant="warning" size="sm">
                  {item.preAnalysis.needsHumanReview} exige revisão humana
                </HudBadge>
              )}
            </div>
            <p className="mt-1 text-[10px] text-ig-fg-subtle">
              Parecer de {item.preAnalysis.analyses} documento(s), em{' '}
              {fmtDate(item.preAnalysis.lastAnalyzedAt)}. Insumo para decisão — não é aceite.
            </p>
          </>
        )}
      </section>

      {/* ── O que a Contratante já recebeu ── */}
      {item.dispatchCount > 0 && (
        <section>
          <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-ig-fg-muted">
            Envio à contratante
          </h3>
          <p className="text-[12px] text-ig-fg">
            {item.dispatchCount} remessa(s) · última em {fmtDate(item.sentToCustomerAt)}
            {item.customerDueAt ? ` · prazo acordado ${fmtDate(item.customerDueAt)}` : ''}
          </p>
          {item.customerCorrectionReason && (
            <p className="mt-0.5 text-[12px] text-ig-warning">
              Pedido da contratante: {item.customerCorrectionReason}
            </p>
          )}
        </section>
      )}

      {item.returnReason && (
        <section>
          <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-ig-fg-muted">
            Correção solicitada
          </h3>
          <p className="text-[12px] text-ig-fg">{item.returnReason}</p>
        </section>
      )}

      {/* ── AS DECISÕES ── */}
      {actions.length > 0 && (
        <section className="border-t border-ig-border-subtle pt-3">
          <div className="flex flex-wrap gap-2">
            {actions.filter(allowed).map((a) => (
              <HudButton
                key={a}
                variant={a === 'reject' ? 'danger'
                  : a === 'approve_for_customer' || a === 'record_acceptance' ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => onAct(a)}
              >
                {REVIEW_ACTION_LABEL[a]}
              </HudButton>
            ))}
          </div>
          {actions.filter(allowed).length === 0 && (
            <p className="text-[11px] text-ig-fg-subtle">
              Você pode acompanhar este item, mas não tem permissão para decidir sobre ele.
            </p>
          )}
        </section>
      )}
      {actions.length === 0 && (
        <p className="border-t border-ig-border-subtle pt-3 text-[11px] text-ig-fg-subtle">
          O próximo passo é do Projeto: corrigir os documentos e reenviar o mesmo item.
        </p>
      )}

      {/* ── AS SAÍDAS — o mesmo item, nas outras telas ── */}
      <div className="flex flex-wrap items-center gap-3 border-t border-ig-border-subtle pt-3 text-[11px]">
        <Link href={measurementHref(item.projectId, item.milestoneId)}
          className="inline-flex items-center gap-1 text-ig-accent hover:underline">
          <Ruler className="h-3 w-3" aria-hidden /> Ver medição
        </Link>
        <Link href={documentsHref(item.projectId, item.milestoneId)}
          className="inline-flex items-center gap-1 text-ig-accent hover:underline">
          <FileText className="h-3 w-3" aria-hidden /> Ver evidências
        </Link>
        <Link href={timelineHref(item.projectId, item.milestoneId)}
          className="inline-flex items-center gap-1 text-ig-accent hover:underline">
          <GanttChart className="h-3 w-3" aria-hidden /> Ver cronograma
        </Link>
        <Link href={contractHref(item.contractId)}
          className="inline-flex items-center gap-1 text-ig-accent hover:underline">
          <ExternalLink className="h-3 w-3" aria-hidden /> Ver contrato
        </Link>
      </div>
    </div>
  );
}

export function MeasurementReviewQueue({
  contractIds, focusMeasurementId = null, refreshKey = 0,
}: {
  /** Recorte pela carteira já filtrada da aba. Vazio = tudo que a RLS permite. */
  readonly contractIds?: readonly string[];
  readonly focusMeasurementId?: string | null;
  /**
   * Chave de sincronia da carteira. Aceita string porque é isso que a aba de
   * Contratos usa: a chave dela é a lista de ids somada ao estado das relações,
   * e não um contador.
   */
  readonly refreshKey?: string | number;
}) {
  const [items, setItems] = useState<readonly ReviewQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(focusMeasurementId);
  const [action, setAction] = useState<ReviewAction | null>(null);
  const [localKey, setLocalKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void (async () => {
      try {
        const rows = await listReviewQueue(contractIds);
        if (alive) { setItems(rows); setError(null); }
      } catch (e) {
        // Fila indisponível não é fila vazia. Dizer "nenhuma medição em análise"
        // quando a consulta falhou afirmaria ausência que ninguém verificou.
        if (alive) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(contractIds ?? []), refreshKey, localKey]);

  useEffect(() => {
    if (focusMeasurementId) setSelectedId(focusMeasurementId);
  }, [focusMeasurementId]);

  useEffect(() => {
    setSelectedId((prev) => {
      if (prev && items.some((i) => i.measurementId === prev)) return prev;
      return items[0]?.measurementId ?? null;
    });
  }, [items]);

  const groups = useMemo(() => groupQueueByBucket(items), [items]);
  const summary = useMemo(() => summarizeQueue(items), [items]);
  const selected = items.find((i) => i.measurementId === selectedId) ?? null;

  const reload = useCallback(() => setLocalKey((k) => k + 1), []);

  if (loading) {
    return (
      <HudPanel>
        <div className="flex items-center gap-2 p-6 text-sm text-ig-fg-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando a fila de análise…
        </div>
      </HudPanel>
    );
  }

  if (error) {
    return <HudPanel><div className="p-6 text-sm text-ig-danger">{error}</div></HudPanel>;
  }

  if (items.length === 0) {
    return (
      <HudPanel>
        <HudEmptyState
          icon="custom"
          customIcon={<ShieldCheck className="h-12 w-12" />}
          title="Nenhuma medição aguardando análise contratual"
          description={
            'A fila nasce quando o Projeto envia uma medição para análise. '
            + 'Enquanto ninguém envia, esta tela vazia é a verdade — e não a ausência de marcos: '
            + 'os marcos previstos continuam em Faturamentos.'
          }
        />
      </HudPanel>
    );
  }

  return (
    <div className="space-y-3">
      <HudPanel>
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-[11px]">
          <HudBadge variant="primary" size="sm">{summary.total} na fila</HudBadge>
          {summary.awaitingReview > 0 && (
            <HudBadge variant="warning" size="sm">{summary.awaitingReview} aguardando análise</HudBadge>
          )}
          {summary.inReview > 0 && (
            <HudBadge variant="info" size="sm">{summary.inReview} em análise</HudBadge>
          )}
          {summary.awaitingCorrection > 0 && (
            <HudBadge variant="warning" size="sm">
              {summary.awaitingCorrection} em correção no projeto
            </HudBadge>
          )}
          {summary.awaitingDispatch > 0 && (
            <HudBadge variant="info" size="sm">{summary.awaitingDispatch} a enviar ao cliente</HudBadge>
          )}
          {summary.awaitingCustomer > 0 && (
            <HudBadge variant="info" size="sm">{summary.awaitingCustomer} com a contratante</HudBadge>
          )}
          {summary.overdue > 0 && (
            <HudBadge variant="danger" size="sm">{summary.overdue} fora do prazo</HudBadge>
          )}
          {/* Prazo não declarado é DITO, e não somado ao "no prazo". */}
          {summary.termNotDeclared > 0 && (
            <HudBadge variant="default" size="sm">
              {summary.termNotDeclared} sem prazo declarado
            </HudBadge>
          )}
        </div>
      </HudPanel>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <HudPanel>
          {groups.map((group) => (
            <div key={group.bucket}>
              <div className="border-b border-ig-border-subtle/60 px-3 py-2">
                <h3 className="text-xs font-medium uppercase tracking-wide text-ig-fg-muted">
                  {REVIEW_BUCKET_LABEL[group.bucket]} ({group.items.length})
                </h3>
              </div>
              <div className="divide-y divide-ig-border-subtle/30">
                {group.items.map((i) => (
                  <QueueRow
                    key={i.measurementId}
                    item={i}
                    selected={i.measurementId === selectedId}
                    onSelect={() => setSelectedId(i.measurementId)}
                  />
                ))}
              </div>
            </div>
          ))}
        </HudPanel>

        <HudPanel>
          {selected
            ? <QueueDetail item={selected} onAct={setAction} />
            : <p className="p-6 text-sm text-ig-fg-muted">Selecione uma medição para ver o detalhe.</p>}
        </HudPanel>
      </div>

      {selected && (
        <MeasurementReviewActionModal
          item={selected}
          action={action}
          onClose={() => setAction(null)}
          onDone={reload}
        />
      )}
    </div>
  );
}
