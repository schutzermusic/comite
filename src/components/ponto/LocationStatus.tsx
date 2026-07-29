'use client';

/**
 * Comunicação de localização e cerca (§6).
 *
 * Nunca mostramos erro técnico: cada estado vira uma frase com o que
 * aconteceu, por que importa e o que fazer em seguida. O painel
 * expansível guarda os detalhes (obra, distância, raio, precisão) para
 * quem quiser conferir, sem obrigar ninguém a abrir um mapa para bater
 * o ponto.
 */

import * as React from 'react';
import {
  ChevronDown,
  Crosshair,
  LocateFixed,
  LocateOff,
  MapPin,
  MapPinOff,
  Radar,
  ShieldQuestion,
  TriangleAlert,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  describeGeofence,
  describeLocation,
  formatAccuracy,
  formatDistance,
  type GeofenceState,
  type LocationState,
  type StatusCopy,
} from '@/lib/ponto/geolocation';
import { PontoButton, PontoCard, TONE_TEXT, type Tone } from './primitives';
import { PontoSheet } from './PontoSheet';

const COPY_TONE_TO_TONE: Record<StatusCopy['tone'], Tone> = {
  neutral: 'neutral',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
};

const LOCATION_ICON: Record<LocationState['kind'], LucideIcon> = {
  idle: Crosshair,
  requesting: Crosshair,
  loading: Radar,
  granted: LocateFixed,
  denied: LocateOff,
  blocked: LocateOff,
  unavailable: LocateOff,
  timeout: TriangleAlert,
  unsupported: ShieldQuestion,
};

const GEOFENCE_ICON: Record<GeofenceState['kind'], LucideIcon> = {
  unknown: MapPin,
  no_worksite: MapPinOff,
  no_location: MapPin,
  inside: MapPin,
  outside: MapPinOff,
};

function StatusLine({
  icon: Icon,
  copy,
  onAction,
  busy,
}: {
  icon: LucideIcon;
  copy: StatusCopy;
  onAction?: () => void;
  busy?: boolean;
}) {
  const tone = COPY_TONE_TO_TONE[copy.tone];
  return (
    <div className="flex items-start gap-3 px-5 py-3.5">
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', TONE_TEXT[tone])} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className={cn('text-ig-body-sm font-semibold', TONE_TEXT[tone])}>{copy.title}</p>
        <p className="mt-0.5 text-ig-caption text-ig-fg-muted">{copy.description}</p>
        {copy.action && onAction ? (
          <PontoButton
            variant="secondary"
            block={false}
            loading={busy}
            onClick={onAction}
            className="mt-2.5 min-h-[44px] text-ig-body-sm"
          >
            {copy.action}
          </PontoButton>
        ) : null}
      </div>
    </div>
  );
}

export function LocationStatus({
  state,
  onRequest,
  busy,
}: {
  state: LocationState;
  onRequest?: () => void;
  busy?: boolean;
}) {
  return <StatusLine icon={LOCATION_ICON[state.kind]} copy={describeLocation(state)} onAction={onRequest} busy={busy} />;
}

export function GeofenceStatus({ state }: { state: GeofenceState }) {
  return <StatusLine icon={GEOFENCE_ICON[state.kind]} copy={describeGeofence(state)} />;
}

/* ───────────────────── painel de detalhes ───────────────────── */

export interface WorksiteDetails {
  worksiteName: string | null;
  projectLabel: string | null;
  distanceMeters: number | null;
  radiusMeters: number | null;
  accuracyMeters: number | null;
  updatedAt: number | null;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-ig-border py-2.5 last:border-b-0">
      <dt className="text-ig-body-sm text-ig-fg-muted">{label}</dt>
      <dd className="ig-tabular text-right text-ig-body-sm font-semibold text-ig-fg-strong">{value}</dd>
    </div>
  );
}

function DetailsList({ details }: { details: WorksiteDetails }) {
  return (
    <dl>
      <DetailRow label="Local de trabalho" value={details.worksiteName ?? 'Não cadastrado'} />
      <DetailRow label="Projeto" value={details.projectLabel ?? '—'} />
      <DetailRow
        label="Distância até o local"
        value={details.distanceMeters != null ? formatDistance(details.distanceMeters) : '—'}
      />
      <DetailRow
        label="Raio permitido"
        value={details.radiusMeters != null ? formatDistance(details.radiusMeters) : '—'}
      />
      <DetailRow label="Precisão do GPS" value={formatAccuracy(details.accuracyMeters)} />
      <DetailRow
        label="Atualizado às"
        value={
          details.updatedAt
            ? new Date(details.updatedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
            : '—'
        }
      />
    </dl>
  );
}

/** Painel compacto e expansível dentro do cartão principal. */
export function WorksiteInfoPanel({ details }: { details: WorksiteDetails }) {
  const [open, setOpen] = React.useState(false);
  const contentId = React.useId();

  return (
    <div className="border-t border-ig-border">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={contentId}
        className={cn(
          'flex min-h-[44px] w-full items-center justify-between gap-2 px-5 py-3',
          'text-ig-caption text-ig-fg-subtle transition-colors hover:text-ig-fg-strong',
          'focus-visible:outline-none focus-visible:shadow-[var(--ig-focus-ring-outer)]',
        )}
      >
        <span>Detalhes da localização</span>
        <ChevronDown
          className={cn('h-4 w-4 transition-transform motion-reduce:transition-none', open && 'rotate-180')}
          aria-hidden="true"
        />
      </button>
      {open ? (
        <div id={contentId} className="px-5 pb-4">
          <DetailsList details={details} />
        </div>
      ) : null}
    </div>
  );
}

/** Mesma informação em folha, para abrir a partir do histórico. */
export function WorksiteInfoSheet({
  open,
  onOpenChange,
  details,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  details: WorksiteDetails;
}) {
  return (
    <PontoSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Local de trabalho"
      description="Dados usados para validar se você estava na área autorizada."
    >
      <div className="pb-2">
        <DetailsList details={details} />
      </div>
    </PontoSheet>
  );
}

/* ───────────────────── permissões (§13) ───────────────────── */

export interface PermissionRequestCardProps {
  icon: LucideIcon;
  title: string;
  /** Por que pedimos — vem ANTES do diálogo nativo. */
  reason: string;
  actionLabel: string;
  onRequest: () => void;
  busy?: boolean;
  /** Instruções de recuperação quando a permissão já foi bloqueada. */
  recovery?: string;
  secondary?: React.ReactNode;
}

export function PermissionRequestCard({
  icon: Icon,
  title,
  reason,
  actionLabel,
  onRequest,
  busy,
  recovery,
  secondary,
}: PermissionRequestCardProps) {
  return (
    <PontoCard className="p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ig-accent-weak">
          <Icon className="h-5 w-5 text-ig-accent" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-ig-h3 text-ig-fg-strong">{title}</h3>
          <p className="mt-1 text-ig-body-sm text-ig-fg-muted">{reason}</p>
          {recovery ? (
            <p className="mt-2 rounded-[var(--ig-radius-sm)] bg-ig-panel px-3 py-2 text-ig-caption text-ig-fg-muted">
              {recovery}
            </p>
          ) : null}
        </div>
      </div>
      <PontoButton variant="primary" loading={busy} onClick={onRequest} className="mt-4">
        {actionLabel}
      </PontoButton>
      {secondary ? <div className="mt-2">{secondary}</div> : null}
      <p className="mt-3 text-center text-ig-caption text-ig-fg-subtle">
        Usamos sua localização somente no momento do registro, para confirmar se você está na área
        de trabalho autorizada.
      </p>
    </PontoCard>
  );
}
