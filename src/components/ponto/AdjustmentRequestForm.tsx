'use client';

/**
 * Solicitação de ajuste de ponto (§10).
 *
 * O envio cria uma marcação de correção ligada ao registro original — a
 * mesma cadeia imutável que o sistema já usava (ADR-005) — e ela entra na
 * fila de revisão do gestor. Nenhum termo administrativo interno aparece
 * para o colaborador.
 */

import * as React from 'react';
import { CircleCheck, CircleSlash, Search, Send, TriangleAlert } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  ADJUSTMENT_REASONS,
  ADJUSTMENT_REASON_LABEL,
  ADJUSTMENT_STATUS_LABEL,
  type AdjustmentInput,
  type AdjustmentReason,
  type AdjustmentRequest,
  type AdjustmentStatus,
  type PunchType,
} from '@/lib/ponto/attendance-types';
import { PUNCH_SHORT_LABEL, formatFullDate, formatTime } from '@/lib/ponto/attendance-state';
import { PontoButton, PontoCard, StatusBadge, type Tone } from './primitives';

const PUNCH_OPTIONS: PunchType[] = ['clock_in', 'break_start', 'break_end', 'clock_out'];
const MAX_NOTE = 500;

const FIELD_CLASS = cn(
  'min-h-[48px] w-full rounded-[var(--ig-radius-md)] border border-ig-border-strong bg-ig-base',
  'px-3.5 py-2.5 text-ig-body text-ig-fg-strong',
  'focus-visible:outline-none focus-visible:shadow-[var(--ig-focus-ring-outer)]',
);

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-ig-body-sm font-semibold text-ig-fg-strong">
        {label}
      </label>
      {children}
      {hint ? <p className="text-ig-caption text-ig-fg-subtle">{hint}</p> : null}
    </div>
  );
}

export interface AdjustmentRequestFormProps {
  /** Pré-preenche a data quando vem do histórico. */
  initialDate?: string;
  initialType?: PunchType;
  originalPunchId?: string;
  submitting: boolean;
  error: string | null;
  onSubmit: (input: AdjustmentInput) => void;
  onCancel?: () => void;
}

export function AdjustmentRequestForm({
  initialDate,
  initialType = 'clock_in',
  originalPunchId,
  submitting,
  error,
  onSubmit,
  onCancel,
}: AdjustmentRequestFormProps) {
  const today = React.useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [date, setDate] = React.useState(initialDate ?? today);
  const [type, setType] = React.useState<PunchType>(initialType);
  const [time, setTime] = React.useState('08:00');
  const [reason, setReason] = React.useState<AdjustmentReason>('forgot_punch');
  const [note, setNote] = React.useState('');
  const [localError, setLocalError] = React.useState<string | null>(null);

  const ids = {
    date: React.useId(),
    type: React.useId(),
    time: React.useId(),
    reason: React.useId(),
    note: React.useId(),
  };

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLocalError(null);
    if (!date || !time) {
      setLocalError('Informe a data e o horário corretos.');
      return;
    }
    // Data e hora locais: o colaborador digita no fuso do aparelho.
    const occurredAt = new Date(`${date}T${time}:00`);
    if (Number.isNaN(occurredAt.getTime())) {
      setLocalError('Data ou horário inválidos.');
      return;
    }
    if (occurredAt.getTime() > Date.now() + 5 * 60_000) {
      setLocalError('Não é possível pedir ajuste para um horário que ainda não aconteceu.');
      return;
    }
    if (reason === 'other' && note.trim().length < 5) {
      setLocalError('Explique brevemente o que aconteceu para o gestor entender.');
      return;
    }
    onSubmit({
      type,
      occurredAt: occurredAt.toISOString(),
      reason,
      note: note.trim() || undefined,
      originalPunchId,
    });
  }

  const message = localError ?? error;

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <Field label="Dia do ajuste" htmlFor={ids.date}>
        <input
          id={ids.date}
          type="date"
          required
          max={today}
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className={FIELD_CLASS}
        />
      </Field>

      <Field label="Qual marcação precisa de ajuste?" htmlFor={ids.type}>
        <select
          id={ids.type}
          value={type}
          onChange={(e) => setType(e.target.value as PunchType)}
          className={FIELD_CLASS}
        >
          {PUNCH_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {PUNCH_SHORT_LABEL[option]}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Horário correto" htmlFor={ids.time} hint="Informe o horário real em que aconteceu.">
        <input
          id={ids.time}
          type="time"
          required
          value={time}
          onChange={(e) => setTime(e.target.value)}
          className={cn(FIELD_CLASS, 'ig-tabular')}
        />
      </Field>

      <Field label="Motivo" htmlFor={ids.reason}>
        <select
          id={ids.reason}
          value={reason}
          onChange={(e) => setReason(e.target.value as AdjustmentReason)}
          className={FIELD_CLASS}
        >
          {ADJUSTMENT_REASONS.map((option) => (
            <option key={option} value={option}>
              {ADJUSTMENT_REASON_LABEL[option]}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="Conte o que aconteceu"
        htmlFor={ids.note}
        hint={`Opcional, mas ajuda seu gestor a aprovar mais rápido. ${note.length}/${MAX_NOTE}`}
      >
        <textarea
          id={ids.note}
          rows={3}
          maxLength={MAX_NOTE}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Ex.: cheguei às 7h, mas o celular estava sem bateria."
          className={cn(FIELD_CLASS, 'min-h-[96px] resize-y')}
        />
      </Field>

      {message ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-[var(--ig-radius-sm)] bg-[color-mix(in_oklab,var(--ig-danger)_12%,transparent)] px-3 py-2.5 text-ig-body-sm text-ig-danger"
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {message}
        </p>
      ) : null}

      <div className="space-y-2 pt-1">
        <PontoButton type="submit" variant="primary" icon={Send} loading={submitting}>
          Enviar solicitação
        </PontoButton>
        {onCancel ? (
          <PontoButton variant="ghost" onClick={onCancel} disabled={submitting}>
            Cancelar
          </PontoButton>
        ) : null}
      </div>
      <p className="text-center text-ig-caption text-ig-fg-subtle">
        Seu gestor recebe a solicitação e responde por aqui. Nenhuma marcação anterior é apagada.
      </p>
    </form>
  );
}

/* ───────────────────── acompanhamento ───────────────────── */

const STATUS_TONE: Record<AdjustmentStatus, Tone> = {
  sent: 'neutral',
  under_review: 'info',
  approved: 'success',
  rejected: 'danger',
};

const STATUS_ICON: Record<AdjustmentStatus, LucideIcon> = {
  sent: Send,
  under_review: Search,
  approved: CircleCheck,
  rejected: CircleSlash,
};

export function AdjustmentRequestCard({ request }: { request: AdjustmentRequest }) {
  return (
    <PontoCard as="article" className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <p className="text-ig-h3 text-ig-fg-strong">{PUNCH_SHORT_LABEL[request.type]}</p>
          <p className="ig-tabular mt-0.5 text-ig-body-sm text-ig-fg-muted">
            {formatFullDate(request.occurredAt)} · {formatTime(request.occurredAt)}
          </p>
        </div>
        <StatusBadge
          label={ADJUSTMENT_STATUS_LABEL[request.status]}
          tone={STATUS_TONE[request.status]}
          icon={STATUS_ICON[request.status]}
        />
      </div>

      {request.reason ? (
        <p className="mt-2.5 text-ig-body-sm text-ig-fg">
          <span className="text-ig-fg-muted">Motivo: </span>
          {ADJUSTMENT_REASON_LABEL[request.reason]}
        </p>
      ) : null}
      {request.note ? <p className="mt-1 text-ig-body-sm text-ig-fg-muted">“{request.note}”</p> : null}

      {request.status === 'rejected' ? (
        <div className="mt-3 rounded-[var(--ig-radius-sm)] border border-[color-mix(in_oklab,var(--ig-danger)_28%,transparent)] bg-[color-mix(in_oklab,var(--ig-danger)_10%,transparent)] px-3 py-2.5">
          <p className="text-ig-label uppercase text-ig-danger">Resposta do gestor</p>
          <p className="mt-1 text-ig-body-sm text-ig-fg">
            {request.managerNote ?? 'Sua solicitação não foi aprovada. Procure seu gestor para entender o motivo.'}
          </p>
        </div>
      ) : request.managerNote ? (
        <div className="mt-3 rounded-[var(--ig-radius-sm)] border border-ig-border bg-ig-panel px-3 py-2.5">
          <p className="text-ig-label uppercase text-ig-fg-subtle">Resposta do gestor</p>
          <p className="mt-1 text-ig-body-sm text-ig-fg">{request.managerNote}</p>
        </div>
      ) : null}
    </PontoCard>
  );
}
