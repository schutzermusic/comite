'use client';

/**
 * Cartão principal da jornada: relógio, estado do dia, ação dominante e
 * o contexto que o colaborador precisa ver ANTES de confirmar (GPS,
 * cerca, conexão, selfie).
 *
 * A ação grande é redonda — herança da referência mobile — mas com a
 * paleta e o raio do Insight Apex, ancorada dentro do cartão em vez de
 * flutuar solta na tela.
 */

import * as React from 'react';
import { motion, useReducedMotion } from 'motion/react';
import {
  Camera,
  CircleAlert,
  Coffee,
  LogIn,
  LogOut,
  Play,
  RefreshCw,
  ShieldCheck,
  WifiOff,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PunchType } from '@/lib/ponto/attendance-types';
import {
  PUNCH_LABEL,
  WORKDAY_PHASE_META,
  type WorkdayPhase,
} from '@/lib/ponto/attendance-state';
import { useLiveClock } from '@/hooks/use-ponto-device';
import { PontoButton, PontoCard, Spinner, StatusBadge, type Tone } from './primitives';

/* ───────────────────── relógio ───────────────────── */

export function LiveClock({ className }: { className?: string }) {
  const now = useLiveClock();
  const time = now
    ? `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    : '--:--';
  const seconds = now ? String(now.getSeconds()).padStart(2, '0') : '--';

  return (
    <p className={cn('ig-tabular flex items-baseline justify-center gap-1', className)}>
      {/* Atualiza a cada segundo; anunciar isso inundaria o leitor de tela. */}
      <span aria-hidden="true" className="text-ig-kpi-xl text-ig-fg-strong lg:text-[56px] lg:leading-none">
        {time}
      </span>
      <span aria-hidden="true" className="text-ig-h3 text-ig-fg-subtle lg:text-ig-h2">
        {seconds}
      </span>
      <span className="sr-only">{now ? `Agora são ${time}` : 'Carregando o horário'}</span>
    </p>
  );
}

/* ───────────────────── estado da jornada ───────────────────── */

const PHASE_TONE: Record<WorkdayPhase, Tone> = {
  not_started: 'neutral',
  working: 'accent',
  on_break: 'warning',
  finished: 'success',
};

const PHASE_ICON: Record<WorkdayPhase, LucideIcon> = {
  not_started: Play,
  working: ShieldCheck,
  on_break: Coffee,
  finished: LogOut,
};

export function WorkdayStatus({ phase, className }: { phase: WorkdayPhase; className?: string }) {
  const meta = WORKDAY_PHASE_META[phase];
  return (
    <div className={cn('flex flex-col items-center gap-1.5 text-center', className)}>
      <StatusBadge label={meta.label} tone={PHASE_TONE[phase]} icon={PHASE_ICON[phase]} />
      <p className="max-w-[32ch] text-ig-body-sm text-ig-fg-muted">{meta.hint}</p>
    </div>
  );
}

/* ───────────────────── ação principal ───────────────────── */

export const PUNCH_ICON: Record<PunchType, LucideIcon> = {
  clock_in: LogIn,
  break_start: Coffee,
  break_end: Play,
  clock_out: LogOut,
};

export interface AttendanceActionCardProps {
  phase: WorkdayPhase;
  primary: PunchType;
  secondary: readonly PunchType[];
  busy: boolean;
  online: boolean;
  /** Quando presente, a ação fica desabilitada e o motivo é exibido. */
  blockedReason?: string | null;
  /** Avisa que a selfie será pedida — nunca surpreender com a câmera. */
  requiresSelfie?: boolean;
  onAction: (type: PunchType) => void;
  /** Linhas de localização/cerca/sincronização renderizadas abaixo. */
  children?: React.ReactNode;
}

export function AttendanceActionCard({
  phase,
  primary,
  secondary,
  busy,
  online,
  blockedReason,
  requiresSelfie = true,
  onAction,
  children,
}: AttendanceActionCardProps) {
  const reduceMotion = useReducedMotion();
  const PrimaryIcon = PUNCH_ICON[primary];
  const disabled = busy || Boolean(blockedReason);

  return (
    <PontoCard as="section" className="overflow-hidden">
      <div className="flex flex-col items-center gap-4 px-5 pb-5 pt-6">
        <LiveClock />
        <WorkdayStatus phase={phase} />

        <motion.button
          type="button"
          onClick={() => onAction(primary)}
          disabled={disabled}
          aria-busy={busy || undefined}
          aria-describedby={blockedReason ? 'ponto-acao-bloqueada' : undefined}
          whileTap={reduceMotion || disabled ? undefined : { scale: 0.96 }}
          transition={{ type: 'spring', stiffness: 420, damping: 30 }}
          className={cn(
            'relative mt-1 flex h-[176px] w-[176px] flex-col items-center justify-center gap-2 rounded-full',
            'border text-center transition-colors',
            'focus-visible:outline-none focus-visible:shadow-[var(--ig-focus-ring-outer)]',
            disabled
              ? 'cursor-not-allowed border-ig-border bg-ig-panel text-ig-fg-disabled'
              : 'border-[color-mix(in_oklab,var(--ig-accent)_55%,transparent)] bg-ig-accent text-[var(--ig-accent-fg,#fff)] shadow-[0_10px_40px_color-mix(in_oklab,var(--ig-accent)_28%,transparent)] hover:bg-ig-accent-strong',
          )}
        >
          {busy ? (
            <>
              <Spinner className="h-7 w-7" />
              <span className="px-6 text-ig-h3">Registrando…</span>
            </>
          ) : (
            <>
              <PrimaryIcon className="h-8 w-8" aria-hidden="true" />
              <span className="px-6 text-ig-h3 leading-tight">{PUNCH_LABEL[primary]}</span>
              {!online ? (
                <span className="flex items-center gap-1 text-ig-caption opacity-90">
                  <WifiOff className="h-3 w-3" aria-hidden="true" />
                  salva no aparelho
                </span>
              ) : requiresSelfie ? (
                <span className="flex items-center gap-1 text-ig-caption opacity-90">
                  <Camera className="h-3 w-3" aria-hidden="true" />
                  com selfie
                </span>
              ) : null}
            </>
          )}
        </motion.button>

        {blockedReason ? (
          <p
            id="ponto-acao-bloqueada"
            className="flex items-start gap-1.5 text-center text-ig-body-sm text-ig-danger"
          >
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {blockedReason}
          </p>
        ) : null}

        {secondary.length > 0 && !busy ? (
          <div className="flex w-full flex-col gap-2 pt-1">
            {secondary.map((type) => {
              const Icon = PUNCH_ICON[type];
              return (
                <PontoButton
                  key={type}
                  variant="secondary"
                  icon={Icon}
                  disabled={disabled}
                  onClick={() => onAction(type)}
                >
                  {PUNCH_LABEL[type]}
                </PontoButton>
              );
            })}
          </div>
        ) : null}
      </div>

      {children ? <div className="border-t border-ig-border">{children}</div> : null}
    </PontoCard>
  );
}

/* ───────────────────── ação de recuperação ───────────────────── */

/** Botão "Tentar novamente" usado quando a última tentativa falhou. */
export function RetryAction({ onRetry, label = 'Tentar novamente' }: { onRetry: () => void; label?: string }) {
  return (
    <PontoButton variant="secondary" icon={RefreshCw} onClick={onRetry}>
      {label}
    </PontoButton>
  );
}
