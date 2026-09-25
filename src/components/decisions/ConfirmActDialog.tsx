'use client';

import { useId, useRef } from 'react';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { Busy } from '@/components/ax';
import { ACTION_LABEL, actionConsequence } from '@/lib/decisions/model';
import type { DecisionAction } from '@/lib/decisions/types';
import { ACTION_BUTTON_CLASS, CONFIRM_TITLE, REASON_MAX, confirmState } from './view';

/**
 * A confirmação de um ato governado. Antes de gravar, a tela DIZ o que o ato
 * faz na origem (consequência), repete o valor e o objeto, e pede a
 * justificativa — obrigatória quando a fonte exige: o botão fica travado,
 * com o motivo escrito embaixo do campo, até ela existir.
 *
 * Radix AlertDialog: papel de alertdialog, foco preso, Esc/Voltar cancelam
 * (não enquanto grava). O foco abre no campo de justificativa — nunca no
 * botão que aprova R$ 500.000 com um Enter distraído.
 *
 * `locked`: a tentativa anterior ficou sem resposta (rede/5xx). A repetição
 * é a MESMA intenção (mesmo intentId), então a justificativa também não muda.
 */
export function ConfirmActDialog({ action, subjectType, kind, amount, title, reasonRequired, reason, onReason, busy, error, locked,
  onConfirm, onCancel, onClosedFocus }: {
  action: DecisionAction; subjectType: string; kind: string; amount: string; title: string; reasonRequired: DecisionAction[];
  reason: string; onReason: (v: string) => void; busy: boolean; error: string | null; locked: boolean;
  onConfirm: () => void; onCancel: () => void;
  /** Ao fechar: devolve true se já pôs o foco em outro lugar (ex.: no aviso do resultado). */
  onClosedFocus?: () => boolean;
}) {
  const id = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  const st = confirmState(action, reasonRequired, reason);
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const blocked = !st.canConfirm || busy;
  return (
    <AlertDialog.Root open onOpenChange={(o) => { if (!o && !busy) onCancel(); }}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="ax-overlay dec-confirm-overlay" />
        <AlertDialog.Content className="ax dec-confirm" data-testid="decision-confirm" data-action={action} aria-busy={busy || undefined}
          onOpenAutoFocus={(e) => { e.preventDefault(); field.current?.focus(); }}
          onEscapeKeyDown={(e) => { if (busy) e.preventDefault(); }}
          onCloseAutoFocus={(e) => { if (onClosedFocus?.()) e.preventDefault(); }}>
          <AlertDialog.Title className="dec-confirm-title">{CONFIRM_TITLE[action]}</AlertDialog.Title>
          <div className="dec-confirm-subject">
            <span className="dec-kind">{kind}</span>
            <strong className="dec-confirm-amount">{amount}</strong>
            <span className="dec-confirm-what">{title}</span>
          </div>
          <AlertDialog.Description className="dec-confirm-consequence">{actionConsequence(action, subjectType)}</AlertDialog.Description>

          <label className="ax-field dec-confirm-field">
            <span>{st.required ? 'Justificativa (obrigatória)' : 'Justificativa (opcional)'}</span>
            <textarea ref={field} value={reason} rows={4} maxLength={REASON_MAX} data-testid="decision-reason"
              readOnly={busy || locked} aria-required={st.required || undefined}
              aria-invalid={error && !locked ? true : undefined}
              aria-describedby={error ? `${hintId} ${errorId}` : hintId}
              onChange={(e) => onReason(e.target.value)} />
            <small id={hintId} data-required={st.required && !st.canConfirm ? 'true' : undefined}>
              {locked
                ? 'A justificativa fica fixa enquanto a tentativa anterior não for confirmada: a repetição é a mesma intenção e não duplica a decisão.'
                : st.hint}
            </small>
          </label>

          {error && <p id={errorId} className="dec-confirm-error" role="alert">{error}</p>}

          <div className="dec-confirm-actions">
            {/* aria-disabled (e não disabled): o foco não se perde e o leitor de tela diz por que está travado. */}
            <AlertDialog.Cancel className="ax-btn ghost" aria-disabled={busy || undefined}
              onClick={(e) => { if (busy) e.preventDefault(); }}>Voltar</AlertDialog.Cancel>
            <button type="button" className={ACTION_BUTTON_CLASS[action]} data-testid="decision-confirm-submit"
              aria-disabled={blocked || undefined} aria-describedby={!st.canConfirm ? hintId : undefined}
              onClick={() => { if (!blocked) onConfirm(); }}>
              <Busy on={busy}>{busy ? 'Registrando…' : error ? `Tentar de novo: ${ACTION_LABEL[action]}` : ACTION_LABEL[action]}</Busy>
            </button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
