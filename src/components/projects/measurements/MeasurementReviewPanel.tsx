'use client';

/**
 * O LADO DO PROJETO da análise contratual.
 *
 * ─── As três perguntas que este painel responde ────────────────────────────
 *
 *   1. "Já posso mandar para Contratos?"      → o botão, e o que falta
 *   2. "Em que pé está?"                      → o estado, com prazo
 *   3. "O que exatamente me pediram?"         → a lista de correções
 *
 * ─── O que ele recusa fazer ────────────────────────────────────────────────
 *
 *   · Não aceita nada. Aceite é da Contratante, registrado em Contratos.
 *   · Não aprova para envio. Isso é ato da Gestão de Contratos.
 *   · Não cria medição nova no reenvio: reenviar é transição do MESMO item.
 *   · Não esconde o prazo não declarado atrás de "no prazo".
 */

import React, { useCallback, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle, CheckCircle2, Clock, ExternalLink, ListChecks, Send, Undo2,
} from 'lucide-react';
import { HudBadge, HudButton, useHudToast } from '@/components/hud';
import { usePermissions } from '@/hooks/use-permissions';
import { cn } from '@/lib/utils';
import { contractReviewHref } from '@/lib/projects/cross-module-links';
import {
  MeasurementError, resubmitMeasurement, submitMeasurement,
} from '@/lib/projects/measurements/measurement-service';
import {
  CORRECTION_CATEGORY_LABEL, CORRECTION_SIDE_LABEL, DISPATCH_CHANNEL_LABEL,
  MEASUREMENT_STATUS_LABEL, REQUIREMENT_KIND_LABEL, SLA_STAGE_LABEL, SLA_STATE_LABEL,
  readinessReasonLabel,
  type MeasurementPackage, type MeasurementSla,
} from '@/lib/projects/measurements/types';

const fmtDate = (iso: string | null) =>
  (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');

/** O aviso ao handoff. Falha aqui NÃO desfaz a transição que já aconteceu. */
async function announce(
  measurementId: string,
  event: string,
  reason?: string | null,
): Promise<void> {
  try {
    await fetch(`/api/projects/measurements/${measurementId}/handoff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, reason: reason ?? null }),
    });
  } catch {
    /*
      Silencioso de propósito. O fato é durável e o aviso é reentregável — o
      registro de entrega (194) sabe quem já recebeu, e o cron de SLA volta a
      cobrar. Levantar erro aqui faria a pessoa achar que a submissão falhou.
    */
  }
}

function SlaLine({ sla }: { readonly sla: MeasurementSla }) {
  if (!sla.stage) return null;
  const tone = sla.state === 'OVERDUE' ? 'text-ig-danger'
    : sla.state === 'WARNING' ? 'text-ig-warning'
    : sla.state === 'ON_TIME' ? 'text-ig-fg-muted'
    : 'text-ig-fg-subtle';
  return (
    <p className={cn('inline-flex items-center gap-1 text-[11px]', tone)}>
      <Clock className="h-3 w-3" aria-hidden />
      {SLA_STAGE_LABEL[sla.stage]} · {SLA_STATE_LABEL[sla.state]}
      {/*
        Prazo só aparece quando FOI DECLARADO. "Prazo: —" ensina a ignorar a
        linha, e "no prazo" sobre prazo inexistente é pior: é uma afirmação.
      */}
      {sla.dueAt ? ` · até ${fmtDate(sla.dueAt)}` : ''}
      {sla.state === 'NOT_ASSESSED' && sla.reason === 'NO_POLICY'
        ? ' · nenhuma política de prazo declarada nesta organização' : ''}
    </p>
  );
}

export function MeasurementReviewPanel({
  pkg, sla, onChanged,
}: {
  readonly pkg: MeasurementPackage;
  readonly sla: MeasurementSla | null;
  readonly onChanged: () => void;
}) {
  const { notify } = useHudToast();
  const { hasPermission } = usePermissions();
  const [busy, setBusy] = useState(false);

  const m = pkg.measurement;
  const status = m.status;
  const canSubmit = hasPermission('projects.measurements.submit');

  const openCorrections = pkg.corrections.filter((c) => c.resolved_at === null);
  const lastRound = openCorrections.length > 0 ? openCorrections[0].round : null;

  const submittable = status === 'IN_PREPARATION' || status === 'READY_FOR_SUBMISSION';
  const resubmittable = status === 'RETURNED_FOR_CORRECTION'
    || status === 'CUSTOMER_CORRECTION_REQUESTED';

  const send = useCallback(async () => {
    setBusy(true);
    try {
      if (resubmittable) {
        await resubmitMeasurement(m.id);
        await announce(m.id, 'measurement.resubmitted');
        notify('Medição reenviada para análise contratual', {
          description: 'O mesmo item voltou à fila de Contratos. Nenhuma medição nova foi criada.',
          variant: 'success',
        });
      } else {
        await submitMeasurement(m.id);
        await announce(m.id, 'measurement.submitted_for_review');
        notify('Enviada para análise contratual', {
          description: 'A Gestão de Contratos foi avisada. Aprovar para envio e aceite são atos seguintes.',
          variant: 'success',
        });
      }
      onChanged();
    } catch (e) {
      notify('Não foi possível enviar', {
        description: e instanceof MeasurementError ? e.message : String(e),
        variant: 'error',
      });
    } finally {
      setBusy(false);
    }
  }, [m.id, notify, onChanged, resubmittable]);

  return (
    <section className="space-y-3 border-t border-ig-border-subtle pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ig-fg-muted">
          Análise contratual
        </h3>
        <HudBadge
          variant={status === 'ACCEPTED' ? 'success'
            : status === 'REJECTED' ? 'danger'
            : status === 'RETURNED_FOR_CORRECTION' || status === 'CUSTOMER_CORRECTION_REQUESTED'
              ? 'warning' : 'info'}
          size="sm"
        >
          {MEASUREMENT_STATUS_LABEL[status]}
        </HudBadge>
      </div>

      {sla && <SlaLine sla={sla} />}

      {/* ── O QUE FALTA, antes de mandar para Contratos ── */}
      {submittable && pkg.readiness.reasons.length > 0 && (
        <div className="rounded border border-ig-warning/30 bg-ig-warning/5 px-2 py-1.5">
          <p className="inline-flex items-center gap-1 text-[11px] font-medium text-ig-warning">
            <AlertTriangle className="h-3 w-3" aria-hidden />
            Pendências antes do envio
          </p>
          <ul className="mt-1 space-y-0.5">
            {pkg.readiness.reasons.map((r) => (
              <li key={r} className="text-[12px] text-ig-fg">· {readinessReasonLabel(r)}</li>
            ))}
          </ul>
        </div>
      )}

      {/* ── A LISTA EXATA de correções ── */}
      {openCorrections.length > 0 && (
        <div className="rounded border border-ig-warning/40 bg-ig-warning/5 px-2 py-2">
          <p className="inline-flex items-center gap-1 text-[11px] font-medium text-ig-warning">
            <ListChecks className="h-3 w-3" aria-hidden />
            Correções solicitadas (rodada {lastRound})
          </p>
          {(m.return_reason || m.customer_correction_reason) && (
            <p className="mt-0.5 text-[11px] text-ig-fg-muted">
              Motivo: {m.customer_correction_reason ?? m.return_reason}
            </p>
          )}
          <ul className="mt-1 space-y-1">
            {openCorrections.map((c) => (
              <li key={c.id} className="text-[12px] text-ig-fg">
                · {c.item}
                <span className="text-[10px] text-ig-fg-subtle">
                  {' '}— {CORRECTION_SIDE_LABEL[c.requested_by_side]}
                  {' · '}{CORRECTION_CATEGORY_LABEL[c.category]}
                  {c.requirement_kind ? ` · ${REQUIREMENT_KIND_LABEL[c.requirement_kind]}` : ''}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[10px] text-ig-fg-subtle">
            Corrija os documentos e use <strong>Reenviar para análise</strong>. Os itens fecham no
            reenvio, e o item da fila é o mesmo — nenhuma medição nova é criada.
          </p>
        </div>
      )}

      {/* ── As remessas à Contratante ── */}
      {pkg.dispatches.length > 0 && (
        <div>
          <p className="text-[11px] font-medium text-ig-fg-muted">Remessas à contratante</p>
          <ul className="mt-0.5 space-y-0.5">
            {pkg.dispatches.map((d) => (
              <li key={d.id} className="text-[11px] text-ig-fg-muted">
                {d.attempt}ª · {fmtDate(d.sent_at)} · {DISPATCH_CHANNEL_LABEL[d.channel]}
                {d.external_reference ? ` · ref. ${d.external_reference}` : ''}
                {d.due_at ? ` · prazo ${fmtDate(d.due_at)}` : ''}
                {d.document_ids.length > 0 ? ` · ${d.document_ids.length} documento(s)` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── A AÇÃO do projeto — uma só ── */}
      <div className="flex flex-wrap items-center gap-3">
        {(submittable || resubmittable) && canSubmit && (
          <HudButton
            variant="primary"
            size="sm"
            isLoading={busy}
            leftIcon={resubmittable ? <Undo2 className="h-4 w-4" /> : <Send className="h-4 w-4" />}
            onClick={() => void send()}
          >
            {resubmittable ? 'Reenviar para análise' : 'Enviar para análise contratual'}
          </HudButton>
        )}
        {(submittable || resubmittable) && !canSubmit && (
          <p className="text-[11px] text-ig-fg-subtle">
            Enviar medição para análise exige a permissão de submissão.
          </p>
        )}
        {status === 'ACCEPTED' && (
          <p className="inline-flex items-center gap-1 text-[11px] text-ig-success">
            <CheckCircle2 className="h-3 w-3" aria-hidden />
            Aceite da contratante registrado em {fmtDate(m.accepted_at)}.
          </p>
        )}
        {/*
          O acompanhamento sai daqui para a fila de Contratos — o MESMO item, com
          o mesmo id. É o link que prova que não há cópia.
        */}
        <Link
          href={contractReviewHref(m.id)}
          className="inline-flex items-center gap-1 text-[11px] text-ig-accent hover:underline"
        >
          <ExternalLink className="h-3 w-3" aria-hidden /> Ver aprovação em Contratos
        </Link>
      </div>
    </section>
  );
}
