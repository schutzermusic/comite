'use client';

/**
 * O DETALHE do evento de medição — o contrato, visto de dentro de Projetos.
 *
 * ─── A regra que este painel obedece linha a linha ────────────────────────
 *
 * Cada campo mostra o que a fonte AUTORITATIVA afirma, ou "Não apurado". Não
 * há um único valor derivado aqui:
 *
 *   · estágio         → `milestone-stage.ts`, pela ponte de `monthly-planning`
 *   · data vigente    → coluna da visão 179 (a MESMA que Contratos lê)
 *   · data anterior   → diário de reprogramação da 179
 *   · medição/aceite  → Projetos (medições), via a bancada da 171
 *   · faturamento     → Contratos, a jusante
 *   · recebimento     → Finanças, e só Finanças
 *
 * Nenhum deles é calculado nesta tela, e é por isso que ela não pode divergir
 * da carteira de Contratos: as duas leem a mesma coluna.
 *
 * ─── O aceite do mapeamento mora aqui, e continua governado ───────────────
 *
 * Quando o vínculo é PROPOSTO ou AMBÍGUO, o painel oferece a decisão — pela
 * RPC `contract_measurement_rule_timeline_review`, a mesma da carteira, que
 * exige `auth.uid()` e `contracts.edit`. Estar em Projetos não afrouxa nada;
 * apenas coloca o botão onde a pessoa que acabou de importar o cronograma
 * está. No ambíguo o botão principal é ESCOLHER entre as alternativas — não
 * "aceitar", porque não há o que aceitar quando duas etapas explicam o mesmo
 * marco igualmente bem.
 */

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle, ArrowRight, Check, ExternalLink, History, Landmark, Link2, Loader2,
  Ruler, X,
} from 'lucide-react';
import { HudDrawer, HudButton, useHudToast } from '@/components/hud';
import { PlanChip } from '@/components/contracts/billing/month/PlanChip';
import {
  listReprogrammings, type ScheduleReprogramming,
} from '@/lib/contracts/billing/planning/month-plan-service';
import { PLANNED_DATE_BASIS_LABEL } from '@/lib/contracts/billing/planning/monthly-planning';
import {
  LINK_STATE_LABEL, currentDate, eventNumberLabel, previousDate, wasReprogrammed,
  type ProjectContractEvent,
} from '@/lib/projects/contract-events';
import { linkScheduleActivity, reviewScheduleMapping } from '@/lib/services/project-contract-events';
import type { TimelineItem } from '@/lib/types/project-timeline';
import {
  contractBillingHref, contractHref, measurementHref,
} from '@/lib/projects/cross-module-links';
import { ActivityLinkPicker } from './ActivityLinkPicker';
import {
  ABSENT, PROVENANCE, RESTRICTED, amountText, billingConsequence, date, stageChip,
} from './contract-event-view';

interface Props {
  readonly event: ProjectContractEvent | null;
  readonly canReviewMapping: boolean;
  /** O cronograma vivo do projeto — o universo de escolha do vínculo manual. */
  readonly timelineItems: readonly TimelineItem[];
  readonly onClose: () => void;
  readonly onMappingReviewed: () => void;
}

function Field({ label, value, hint }: {
  label: string; value: React.ReactNode; hint?: string;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ig-fg-subtle">
        {label}
      </p>
      <p className="break-words text-[13px] text-ig-fg" title={hint}>{value}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 border-t border-ig-border-subtle pt-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ig-fg-muted">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function MeasurementEventDrawer({
  event, canReviewMapping, timelineItems, onClose, onMappingReviewed,
}: Props) {
  const { notify } = useHudToast();
  const [history, setHistory] = useState<ScheduleReprogramming[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [linkingItemId, setLinkingItemId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const milestoneId = event?.plan.milestoneId ?? null;

  // O seletor não sobrevive à troca de evento: deixar aberto faria a próxima
  // abertura do drawer parecer que aquele marco também pede vínculo.
  useEffect(() => { setPickerOpen(false); }, [milestoneId]);

  useEffect(() => {
    if (!milestoneId) {
      setHistory([]);
      setHistoryError(null);
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const rows = await listReprogrammings(milestoneId);
        if (alive) { setHistory(rows); setHistoryError(null); }
      } catch (e) {
        // Histórico indisponível não é histórico vazio. Dizer "nenhuma
        // reprogramação" quando a consulta falhou seria afirmar estabilidade
        // que ninguém verificou.
        if (alive) setHistoryError(e instanceof Error ? e.message : 'Falha ao ler o histórico.');
      }
    })();
    return () => { alive = false; };
  }, [milestoneId]);

  const decide = useCallback(async (
    mappingId: string, decision: 'accepted' | 'rejected',
  ) => {
    setBusy(true);
    try {
      await reviewScheduleMapping(mappingId, decision);
      notify(
        decision === 'accepted'
          ? 'Mapeamento aceito — a data do cronograma passa a alimentar a previsão de faturamento.'
          : 'Proposta rejeitada. O marco volta a aparecer sem vínculo no cronograma.',
        { variant: 'success' },
      );
      onMappingReviewed();
      onClose();
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Falha ao revisar o mapeamento.', { variant: 'error' });
    } finally {
      setBusy(false);
    }
  }, [notify, onMappingReviewed, onClose]);

  const link = useCallback(async (ruleId: string, timelineItemId: string) => {
    setLinkingItemId(timelineItemId);
    try {
      await linkScheduleActivity(ruleId, timelineItemId);
      notify(
        'Atividade vinculada. O evento de medição passa a acompanhar a data desta etapa '
        + '— e as próximas importações reconectam sozinhas.',
        { variant: 'success' },
      );
      onMappingReviewed();
      onClose();
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Falha ao vincular a atividade.', { variant: 'error' });
    } finally {
      setLinkingItemId(null);
    }
  }, [notify, onMappingReviewed, onClose]);

  /*
    AS CANDIDATAS que o matcher enxergou, numa lista só.

    A primeira é a que ele colocou à frente; as outras são o empate que a
    migration 181 preservou em `ambiguous_with`. Elas aparecem juntas de
    propósito: apresentar a favorita como resposta e as demais como "ver
    alternativas" é o desenho que faz gente aceitar o topo da lista sem ler.
  */
  const candidates = event === null ? [] : [
    ...(event.proposedTimelineItemId
      ? [{
          id: event.proposedTimelineItemId,
          title: event.proposedTimelineTitle ?? '(sem nome)',
          wbsCode: event.proposedTimelineWbsCode,
          plannedFinish: event.proposedTimelineFinish,
        }]
      : []),
    ...event.ambiguousAlternatives,
  ];

  if (!event) return null;

  const plan = event.plan;
  const chip = stageChip(event);
  const governed = event.linkState === 'ACCEPTED';

  return (
    <HudDrawer
      isOpen
      onClose={onClose}
      width="520px"
      density="compact"
      headerLeading={
        <Landmark className="h-5 w-5" style={{ color: 'var(--ig-contract)' }} aria-hidden />
      }
      title={`${eventNumberLabel(event)} — evento de medição`}
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-ig-fg-muted">{plan.contractNumber ?? 'Contrato'}</span>
          <PlanChip tone={chip.tone.tone} dashed={chip.tone.dashed}>{chip.label}</PlanChip>
          <span className="text-[11px] text-ig-fg-subtle">
            {LINK_STATE_LABEL[event.linkState]}
          </span>
        </span>
      }
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {/*
            A saída para a MEDIÇÃO deste marco.

            O cronograma responde onde e quando; evidência, medição e aceite
            são de Medições & Evidências, e o link leva ao MESMO marco lá —
            pela identidade canônica, não por busca manual.
          */}
          {plan.projectId && (
            <Link
              href={measurementHref(plan.projectId, plan.milestoneId)}
              className="portfolio-action"
            >
              <Ruler className="h-3.5 w-3.5" aria-hidden />
              Ver medição
            </Link>
          )}
          <Link href={contractHref(plan.contractId)} className="portfolio-action">
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            Ver no contrato
          </Link>
          <Link href={contractBillingHref(plan.contractId)} className="portfolio-action">
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            Ver faturamento
          </Link>
        </div>
      }
    >
      <div className="space-y-4 text-[13px]">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Contrato" value={plan.contractNumber ?? ABSENT} />
          <Field label="Contraparte" value={plan.counterpartyName ?? ABSENT} />
          <Field label="Marco" value={plan.title} />
          <Field
            label="Valor contratual"
            value={
              <span
                className={event.canViewValues
                  ? 'font-semibold tabular-nums'
                  : 'italic text-ig-fg-disabled'}
                style={event.canViewValues ? { color: 'var(--ig-contract-strong)' } : undefined}
              >
                {amountText(event)}
              </span>
            }
            hint={!event.canViewValues
              ? 'Valor contratual restrito: exige permissão de valores de contrato ou de finanças.'
              : plan.plannedAmountBasis === 'contract_entitlement'
                ? 'Direito contratual registrado.'
                : 'Previsto do marco — não há direito contratual registrado.'}
          />
          <Field
            label="% do contrato"
            value={!event.canViewValues
              ? RESTRICTED
              : event.contractPercent === null
                ? ABSENT
                : `${event.contractPercent.toFixed(2).replace('.', ',')}%`}
            hint={!event.canViewValues
              ? 'Participação no valor do contrato é informação financeira.'
              : event.contractTotalValue === null
                ? 'Valor total do contrato não registrado.'
                : `Sobre ${amountText(event, event.contractTotalValue)}`}
          />
          <Field label="Origem" value={PROVENANCE} />
        </div>

        {/* ─── Cronograma ─── */}
        <Section title="Atividade do cronograma">
          {governed ? (
            <div className="grid grid-cols-2 gap-3">
              <Field
                label="Atividade vinculada"
                value={plan.timelineWbsCode
                  ? `${plan.timelineWbsCode} — ${plan.timelineTitle ?? ABSENT}`
                  : plan.timelineTitle ?? ABSENT}
              />
              <Field
                label="Data vigente"
                value={date(currentDate(event))}
                hint={PLANNED_DATE_BASIS_LABEL[plan.plannedBillingDateBasis]}
              />
              <Field
                label="Data anterior"
                value={wasReprogrammed(event)
                  ? (
                    <span className="flex items-center gap-1 text-ig-warning">
                      {date(previousDate(event))}
                      <ArrowRight className="h-3 w-3" aria-hidden />
                      {date(currentDate(event))}
                    </span>
                  )
                  : 'Sem reprogramação registrada'}
              />
              <Field
                label="Base da data"
                value={PLANNED_DATE_BASIS_LABEL[plan.plannedBillingDateBasis]}
              />
            </div>
          ) : event.proposedTimelineItemId ? (
            <div className="space-y-2">
              <p className="text-ig-fg-muted">
                Etapa <strong>sugerida</strong> pelo sistema. Ela não alimenta previsão
                nenhuma antes de ser aceita.
              </p>
              <div className="rounded-lg border border-dashed border-ig-border p-2">
                <p className="text-ig-fg-strong">
                  {event.proposedTimelineWbsCode
                    ? `${event.proposedTimelineWbsCode} — ${event.proposedTimelineTitle}`
                    : event.proposedTimelineTitle}
                </p>
                <p className="text-[11px] text-ig-fg-muted">
                  Término previsto {date(event.proposedTimelineFinish)}
                  {event.confidence !== null && ` · confiança ${Math.round(event.confidence * 100)}%`}
                </p>
                {event.note && (
                  <p className="mt-1 text-[11px] text-ig-fg-subtle">{event.note}</p>
                )}
              </div>
            </div>
          ) : event.linkState === 'ANCHOR_LOST' ? (
            <div className="space-y-1">
              <p className="text-ig-warning">
                <strong>A atividade vinculada saiu do cronograma.</strong> Ela foi
                desativada por uma importação posterior, e por isso a data prevista de
                faturamento deixou de vir do cronograma.
              </p>
              <p className="text-[12px] text-ig-fg-muted">
                Vínculo registrado:{' '}
                {event.mappedTimelineWbsCode ? `${event.mappedTimelineWbsCode} — ` : ''}
                {event.mappedTimelineTitle ?? '(atividade removida)'}
              </p>
              <p className="text-[11px] text-ig-fg-subtle">
                O sistema não escolhe uma substituta por semelhança: a decisão anterior foi
                humana, e a nova também precisa ser.
              </p>
            </div>
          ) : (
            <p className="text-ig-fg-muted">
              <strong>Sem vínculo no cronograma.</strong> Nenhuma atividade correspondente
              foi identificada neste projeto, e nenhuma data prevista de faturamento é
              derivada deste marco.
            </p>
          )}
        </Section>

        {/*
          ─── A ESCOLHA ───

          Ambíguo, sugerido e sem vínculo terminam todos no mesmo lugar: uma
          pessoa aponta a atividade. O que muda entre eles é quanta ajuda o
          sistema consegue dar — candidatas ordenadas no ambíguo, uma
          confirmação no sugerido, uma busca no sem vínculo.
        */}
        {event.linkState !== 'ACCEPTED' && (
          <Section
            title={
              event.linkState === 'AMBIGUOUS'
                ? 'Ambíguo — qual atividade representa este evento?'
                : event.linkState === 'PROPOSED'
                  ? 'Confirmar ou escolher outra atividade'
                  : event.linkState === 'ANCHOR_LOST'
                    ? 'Remapear para uma atividade do cronograma atual'
                    : 'Vincular ao cronograma'
            }
          >
            {!canReviewMapping ? (
              <p className="flex items-center gap-1.5 text-ig-fg-muted">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                Sem permissão para decidir o vínculo. Nada aqui alimenta previsão de
                faturamento enquanto isso.
              </p>
            ) : (
              <div className="space-y-2">
                {event.linkState === 'AMBIGUOUS' && (
                  <p className="flex items-start gap-1.5 text-ig-warning">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                    Mais de uma etapa explica este marco igualmente bem. O sistema não
                    escolhe: a decisão é de quem conhece a obra.
                  </p>
                )}

                {/*
                  As CANDIDATAS do matcher, em primeiro lugar — incluindo a que
                  ele colocou à frente. Um clique aqui vincula àquela etapa e
                  descarta as outras no mesmo ato.
                */}
                {candidates.length > 0 && (
                  <ul className="space-y-1">
                    {candidates.map((alt) => (
                      <li key={alt.id}>
                        <button
                          type="button"
                          disabled={busy || linkingItemId !== null}
                          onClick={() => link(event.ruleId, alt.id)}
                          className="flex w-full items-center gap-2 rounded border border-dashed border-ig-border px-2 py-1.5 text-left transition-colors hover:bg-ig-panel-hover disabled:opacity-50"
                        >
                          {linkingItemId === alt.id
                            ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
                            : <Check className="h-3.5 w-3.5 shrink-0 text-ig-fg-subtle" aria-hidden />}
                          <span className="w-14 shrink-0 font-mono text-[11px] text-ig-fg-subtle">
                            {alt.wbsCode ?? '—'}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[12px] text-ig-fg-strong">
                            {alt.title}
                          </span>
                          <span className="shrink-0 tabular-nums text-[11px] text-ig-fg-muted">
                            {date(alt.plannedFinish)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {pickerOpen ? (
                  <ActivityLinkPicker
                    items={timelineItems}
                    busyItemId={linkingItemId}
                    disabled={busy}
                    onPick={(item) => link(event.ruleId, item.id)}
                  />
                ) : (
                  <button
                    type="button"
                    className="portfolio-action"
                    disabled={busy || linkingItemId !== null}
                    onClick={() => setPickerOpen(true)}
                  >
                    <Link2 className="h-3.5 w-3.5" aria-hidden />
                    {candidates.length > 0 ? 'Escolher outra atividade' : 'Vincular atividade'}
                  </button>
                )}

                {event.reviewState === 'proposed' && event.mappingId && (
                  <button
                    type="button"
                    className="portfolio-action"
                    disabled={busy || linkingItemId !== null}
                    onClick={() => decide(event.mappingId!, 'rejected')}
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                    Rejeitar sugestão
                  </button>
                )}

                <p className="text-[11px] text-ig-fg-subtle">
                  Vincular define a âncora de cronograma deste marco: a data prevista de
                  faturamento passa a ser a da etapa escolhida, e as próximas importações
                  reconectam sozinhas.
                </p>
              </div>
            )}
          </Section>
        )}

        {/* ─── Medição, evidência e aceite ─── */}
        <Section title="Medição, evidência e aceite">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Medição" value={plan.measurementStatus ?? ABSENT} />
            <Field
              label="Evidência"
              value={plan.evidenceRequired === true
                ? `${plan.measurementEvidenceCount ?? 0} registro(s)${plan.evidenceDocumentId ? ' · documento anexado' : ''}`
                : plan.evidenceRequired === false
                  ? 'Não exigida pelo contrato'
                  : ABSENT}
            />
            <Field
              label="Aceite da contratante"
              value={plan.measurementAcceptedAt
                ? `Aceito em ${date(plan.measurementAcceptedAt.slice(0, 10))}`
                : plan.customerAcceptanceRequired === true
                  ? 'Exigido — ainda não registrado'
                  : plan.customerAcceptanceRequired === false
                    ? 'Não exigido'
                    : ABSENT}
            />
            <Field label="Valor aceito" value={amountText(event, plan.acceptedValue)} />
          </div>
        </Section>

        {/* ─── Faturamento e caixa ─── */}
        <Section title="Faturamento e caixa">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Consequência" value={billingConsequence(event)} />
            {/*
              A EXISTÊNCIA do evento atravessa o portão de valor; o estado de
              elegibilidade, não. Saber que a parcela já virou faturamento é
              informação de execução do projeto.
            */}
            <Field
              label="Evento de faturamento"
              value={plan.billingEventId
                ? (event.canViewValues ? plan.billingEligibilityState ?? 'Gerado' : 'Gerado')
                : 'Nenhum evento gerado'}
              hint="Eventos de faturamento nascem apenas pelo fluxo governado de Contratos."
            />
            <Field label="Valor elegível apurado" value={amountText(event, plan.billingEligibleAmount)} />
            <Field
              label="Recebimento"
              value={!event.canViewValues ? RESTRICTED : plan.billingReceivableStatus ?? ABSENT}
              hint="Estado de recebimento vem de Finanças, e só de Finanças."
            />
            <Field
              label="Nota fiscal"
              value={!event.canViewValues ? RESTRICTED : plan.fiscalDocumentNumber ?? ABSENT}
            />
            <Field
              label="Condição de pagamento"
              value={!event.canViewValues ? RESTRICTED : plan.paymentTermText ?? ABSENT}
            />
          </div>
        </Section>

        {/* ─── Histórico ─── */}
        <Section title="Histórico de reprogramação">
          {historyError ? (
            <p className="text-ig-warning">{historyError}</p>
          ) : history.length === 0 ? (
            <p className="text-ig-fg-muted">Nenhuma reprogramação registrada.</p>
          ) : (
            <ul className="space-y-1">
              {history.map((h) => (
                <li key={h.id} className="flex items-center gap-2 text-[12px]">
                  <History className="h-3 w-3 shrink-0 text-ig-fg-subtle" aria-hidden />
                  <span className="tabular-nums text-ig-fg-muted">
                    {date(h.previousPlannedFinish)}
                  </span>
                  <ArrowRight className="h-3 w-3 text-ig-fg-subtle" aria-hidden />
                  <span className="tabular-nums text-ig-fg-strong">
                    {date(h.newPlannedFinish)}
                  </span>
                  <span className="text-ig-fg-subtle">
                    {h.scheduleVersion !== null && `cronograma v${h.scheduleVersion} · `}
                    {date(h.observedAt.slice(0, 10))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

      </div>
    </HudDrawer>
  );
}
