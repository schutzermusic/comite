'use client';

/**
 * Confirmação e erro do registro (§8 e §18).
 *
 * A confirmação nunca mente sobre o estado: quando a marcação ficou só no
 * aparelho, ela diz exatamente isso, e o selo de "confirmado pelo
 * servidor" só aparece depois da validação. Quando o servidor manda para
 * revisão, o texto explica o motivo e o que acontece a seguir.
 */

import * as React from 'react';
import { motion, useReducedMotion } from 'motion/react';
import {
  Camera,
  Check,
  CircleAlert,
  CloudUpload,
  Copy,
  MapPin,
  MapPinOff,
  Search,
  TriangleAlert,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PunchType } from '@/lib/ponto/attendance-types';
import { PUNCH_SHORT_LABEL, formatFullDate, formatTime } from '@/lib/ponto/attendance-state';
import { formatDistance } from '@/lib/ponto/geolocation';
import { PontoButton, TONE_TEXT, type Tone } from './primitives';
import { PontoSheet } from './PontoSheet';

export interface AttendanceSuccess {
  type: PunchType;
  occurredAt: string;
  /** false = guardado no aparelho, ainda não validado pelo servidor. */
  confirmedByServer: boolean;
  needsReview: boolean;
  /** O servidor devolveu a mesma marcação (idempotência) — nada duplicou. */
  duplicate: boolean;
  worksite: string | null;
  project: string | null;
  distanceMeters: number | null;
  insideGeofence: boolean | null;
  hasSelfie: boolean;
  recordId: string | null;
}

function ResultRow({
  icon: Icon,
  label,
  value,
  tone = 'neutral',
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  tone?: Tone;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-ig-border py-2.5 last:border-b-0">
      <span className="flex items-center gap-2 text-ig-body-sm text-ig-fg-muted">
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {label}
      </span>
      <span className={cn('text-right text-ig-body-sm font-semibold', TONE_TEXT[tone])}>{value}</span>
    </div>
  );
}

export function AttendanceSuccessSheet({
  result,
  onClose,
}: {
  result: AttendanceSuccess | null;
  onClose: () => void;
}) {
  const reduceMotion = useReducedMotion();
  if (!result) return null;

  const headline = result.confirmedByServer
    ? result.needsReview
      ? `${PUNCH_SHORT_LABEL[result.type]} registrada — em análise`
      : `${PUNCH_SHORT_LABEL[result.type]} registrada com sucesso`
    : `${PUNCH_SHORT_LABEL[result.type]} salva no aparelho`;

  const tone: Tone = result.confirmedByServer ? (result.needsReview ? 'warning' : 'success') : 'info';
  const HeadIcon = result.confirmedByServer ? (result.needsReview ? Search : Check) : CloudUpload;

  return (
    <PontoSheet open onOpenChange={(open) => !open && onClose()} title={headline} hideTitle>
      <div className="pb-2">
        <div className="flex flex-col items-center gap-3 pb-4 text-center">
          <motion.span
            initial={reduceMotion ? false : { scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 460, damping: 26, duration: 0.3 }}
            className={cn(
              'flex h-14 w-14 items-center justify-center rounded-full border',
              tone === 'success'
                ? 'border-[color-mix(in_oklab,var(--ig-success)_45%,transparent)] bg-[color-mix(in_oklab,var(--ig-success)_16%,transparent)]'
                : tone === 'warning'
                  ? 'border-[color-mix(in_oklab,var(--ig-warning)_45%,transparent)] bg-[color-mix(in_oklab,var(--ig-warning)_16%,transparent)]'
                  : 'border-[color-mix(in_oklab,var(--ig-info)_45%,transparent)] bg-[color-mix(in_oklab,var(--ig-info)_16%,transparent)]',
            )}
          >
            <HeadIcon className={cn('h-7 w-7', TONE_TEXT[tone])} aria-hidden="true" />
          </motion.span>
          <div>
            <p className="text-ig-h2 text-ig-fg-strong">{headline}</p>
            <p className="ig-tabular mt-1 text-ig-body-sm text-ig-fg-muted">
              {formatFullDate(result.occurredAt)}, às {formatTime(result.occurredAt)}
            </p>
          </div>
          {result.duplicate ? (
            <p className="rounded-[var(--ig-radius-sm)] bg-ig-panel px-3 py-2 text-ig-caption text-ig-fg-muted">
              Esta marcação já havia sido registrada. Mantivemos apenas um registro — nada foi duplicado.
            </p>
          ) : null}
        </div>

        <div className="rounded-[var(--ig-radius-md)] border border-ig-border bg-ig-panel px-4 py-1">
          <ResultRow
            icon={result.insideGeofence === false ? MapPinOff : MapPin}
            label="Local"
            value={result.worksite ?? 'Não informado'}
          />
          {result.project ? <ResultRow icon={MapPin} label="Projeto" value={result.project} /> : null}
          <ResultRow
            icon={result.insideGeofence === false ? MapPinOff : MapPin}
            label="Área autorizada"
            value={
              result.insideGeofence === true
                ? 'Dentro da área'
                : result.insideGeofence === false
                  ? result.distanceMeters != null
                    ? `Fora — a ${formatDistance(result.distanceMeters)}`
                    : 'Fora da área'
                  : 'Não verificada'
            }
            tone={result.insideGeofence === true ? 'success' : result.insideGeofence === false ? 'warning' : 'neutral'}
          />
          <ResultRow
            icon={Camera}
            label="Foto de presença"
            value={result.hasSelfie ? 'Anexada' : 'Não anexada'}
            tone={result.hasSelfie ? 'success' : 'neutral'}
          />
          <ResultRow
            icon={result.confirmedByServer ? Check : CloudUpload}
            label="Situação"
            value={
              result.confirmedByServer
                ? result.needsReview
                  ? 'Aguardando análise do gestor'
                  : 'Confirmada pelo servidor'
                : 'Salva no aparelho, aguardando envio'
            }
            tone={tone}
          />
        </div>

        {result.needsReview ? (
          <p className="mt-3 flex items-start gap-2 text-ig-caption text-ig-fg-muted">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ig-warning" aria-hidden="true" />
            Sua marcação foi registrada e está valendo. Como algo fugiu do esperado (área ou
            localização), seu gestor vai conferir antes de fechar o período.
          </p>
        ) : null}

        {!result.confirmedByServer ? (
          <p className="mt-3 flex items-start gap-2 text-ig-caption text-ig-fg-muted">
            <CloudUpload className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ig-info" aria-hidden="true" />
            O horário registrado foi o de agora e será preservado. Assim que a internet voltar,
            enviamos automaticamente.
          </p>
        ) : null}

        {result.recordId ? (
          <p className="ig-tabular mt-3 flex items-center justify-center gap-1.5 font-mono text-ig-caption text-ig-fg-subtle">
            <Copy className="h-3 w-3" aria-hidden="true" />
            {result.recordId.slice(0, 8)}
          </p>
        ) : null}

        <PontoButton variant="primary" onClick={onClose} className="mt-5">
          Entendi
        </PontoButton>
      </div>
    </PontoSheet>
  );
}

/* ───────────────────── erro ───────────────────── */

export interface AttendanceError {
  title: string;
  /** O que aconteceu e por que importa. */
  description: string;
  /** O que fazer em seguida. */
  nextStep: string;
  onRetry?: () => void;
  retryLabel?: string;
}

export function AttendanceErrorSheet({
  error,
  onClose,
}: {
  error: AttendanceError | null;
  onClose: () => void;
}) {
  if (!error) return null;
  return (
    <PontoSheet open onOpenChange={(open) => !open && onClose()} title={error.title} hideTitle>
      <div className="pb-2">
        <div className="flex flex-col items-center gap-3 pb-4 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full border border-[color-mix(in_oklab,var(--ig-danger)_45%,transparent)] bg-[color-mix(in_oklab,var(--ig-danger)_14%,transparent)]">
            <CircleAlert className="h-7 w-7 text-ig-danger" aria-hidden="true" />
          </span>
          <p className="text-ig-h2 text-ig-fg-strong">{error.title}</p>
          <p className="max-w-[36ch] text-ig-body-sm text-ig-fg-muted">{error.description}</p>
        </div>

        <div className="rounded-[var(--ig-radius-md)] border border-ig-border bg-ig-panel px-4 py-3">
          <p className="text-ig-label uppercase text-ig-fg-subtle">O que fazer agora</p>
          <p className="mt-1 text-ig-body-sm text-ig-fg">{error.nextStep}</p>
        </div>

        <div className="mt-5 space-y-2">
          {error.onRetry ? (
            <PontoButton variant="primary" onClick={error.onRetry}>
              {error.retryLabel ?? 'Tentar novamente'}
            </PontoButton>
          ) : null}
          <PontoButton variant="ghost" onClick={onClose}>
            Fechar
          </PontoButton>
        </div>
      </div>
    </PontoSheet>
  );
}
