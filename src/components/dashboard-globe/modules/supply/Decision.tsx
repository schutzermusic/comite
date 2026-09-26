'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, ChevronRight, ShieldCheck } from 'lucide-react';
import { useResource } from '@/components/ax';
import { ConfirmActDialog } from '@/components/decisions/ConfirmActDialog';
import { useDecisionAct } from '@/components/decisions/useDecisionAct';
import { accessNote, amountText, orderedActions, outcomeLine } from '@/components/decisions/view';
import { ACTION_LABEL, kindLabel, parseDecisionKey } from '@/lib/decisions/model';
import type { DecisionAction, DecisionDetail } from '@/lib/decisions/types';
import type { SupplyDecision } from '@/lib/dashboard/types';
import { dayMonth } from '../model';
import { SkeletonLines, StateNote } from '../shared';

type DetailOk = DecisionDetail & { ok: true };

/**
 * Uma decisão da caixa desta pessoa, aprovada AQUI pelo MESMO ato de
 * Decisões: o detalhe vem de GET /api/decisions/[chave]; os atos que ele
 * devolve (Aprovar compra, Solicitar ajuste, Rejeitar) abrem o
 * `ConfirmActDialog` → POST /api/decisions/[chave]/act. Alçada, política,
 * segregação de funções e auditoria são do servidor — a recusa aparece como
 * ele a disse.
 */
export function DecisionCard({ decision, today, onChanged }: { decision: SupplyDecision; today: string; onChanged: () => void }) {
  if (!parseDecisionKey(decision.key)) {
    return (
      <div className="dgm-gov" data-testid="dg-supply-decision">
        <StateNote kind="error" title="Endereço da decisão inválido">Abra a decisão pela caixa de Decisões.</StateNote>
        <Link className="dgm-textbtn" href={decision.href}>Abrir em Decisões<ArrowUpRight size={13} aria-hidden /></Link>
      </div>
    );
  }
  return <LoadedDecision decision={decision} today={today} onChanged={onChanged} />;
}

function LoadedDecision({ decision, today, onChanged }: { decision: SupplyDecision; today: string; onChanged: () => void }) {
  const res = useResource<DetailOk>(`/api/decisions/${encodeURIComponent(decision.key)}`);
  const d = res.data;
  // Depois de um desfecho, os atos somem até o detalhe voltar do servidor — sem segundo clique no dado velho.
  const [settledOn, setSettledOn] = useState<DetailOk | null>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const act = useDecisionAct({ noticeRef, onSettled: () => { setSettledOn(d); onChanged(); } });

  const due = decision.due ? (
    <span className={decision.overdue ? 'dgm-late' : undefined}>Decidir até {dayMonth(decision.due)}{decision.overdue ? ' · vencida' : decision.due === today ? ' · hoje' : ''}</span>
  ) : null;
  const amount = decision.amountRestricted ? 'Restrito' : decision.amountText;

  const head = (
    <div className="dgm-gov-head">
      <small>{decision.kindLabel}</small>
      <b>{decision.title}</b>
      {amount && <strong className="num" data-muted={decision.amountRestricted ? 'true' : undefined}>{amount}</strong>}
      {due && <p className="dgm-gov-due">{due}</p>}
    </div>
  );

  if (!d) {
    return (
      <div className="dgm-gov" data-testid="dg-supply-decision">
        {head}
        {res.state === 'loading'
          ? <SkeletonLines lines={2} label="Carregando a decisão…" />
          : <StateNote kind="error" title="A decisão não carregou" onRetry={res.refresh}>{res.message ?? 'Abra a decisão pela caixa de Decisões.'}</StateNote>}
        <Link className="dgm-textbtn" href={decision.href}>Abrir em Decisões<ArrowUpRight size={13} aria-hidden /></Link>
      </div>
    );
  }

  const r = d.resolved;
  const kind = d.item?.kindLabel ?? kindLabel(r.subjectType);
  const actions: DecisionAction[] = d.canAct && r.open && settledOn !== d ? orderedActions(d.actions) : [];
  const note = accessNote(d);
  const policy = d.why.slice(0, 2);

  return (
    <div className="dgm-gov" data-testid="dg-supply-decision">
      {head}
      {policy.map((f) => (
        <p key={f.label} className="dgm-policy"><ShieldCheck size={15} aria-hidden /><span>{f.label} · <b>{f.value}</b></span></p>
      ))}

      <div className="dgm-live" role="status" aria-live="polite">
        {act.notice && (
          <div ref={noticeRef} tabIndex={-1} className="dgm-notice" data-tone={act.notice.tone} data-testid="dg-supply-decision-notice">
            <strong>{act.notice.title}</strong>
            <p>{act.notice.text}</p>
          </div>
        )}
      </div>

      {!r.open && <p className="dgm-policy"><ShieldCheck size={15} aria-hidden /><span>{outcomeLine(r.status, r.closedBy, r.closedAt)}</span></p>}
      {note && <p className="dgm-foot">{note}</p>}

      {actions.length > 0 && (
        <div className="dgm-gov-actions" role="group" aria-label="Atos desta decisão">
          {actions.map((a) => (
            <button key={a} type="button" data-testid={`dg-decision-act-${a.toLowerCase()}`} data-action={a}
              className={a === 'APPROVE' ? 'dgm-btn dgm-btn-wide' : 'dgm-btn-quiet'}
              onClick={() => act.open(a)}>
              {a === 'APPROVE' ? <><ShieldCheck size={17} strokeWidth={2.2} aria-hidden />{approveLabel(r.subjectType)}</> : ACTION_LABEL[a]}
            </button>
          ))}
        </div>
      )}
      <Link className="dgm-textbtn" href={decision.href}>Ver a decisão completa<ChevronRight size={13} aria-hidden /></Link>

      {act.confirm && (
        <ConfirmActDialog action={act.confirm.action} subjectType={r.subjectType} kind={kind}
          amount={r.amount === null ? 'Sem valor declarado' : amountText(r.amount, r.currency)} title={r.title}
          reasonRequired={d.reasonRequired} reason={act.reason} onReason={act.setReason} busy={act.busy} error={act.error} locked={act.uncertain}
          onConfirm={() => void act.submit(d)} onCancel={act.cancel} onClosedFocus={act.closedFocus} />
      )}
    </div>
  );
}

function approveLabel(subjectType: string): string {
  return subjectType === 'purchase_order' ? 'Aprovar compra' : ACTION_LABEL.APPROVE;
}
