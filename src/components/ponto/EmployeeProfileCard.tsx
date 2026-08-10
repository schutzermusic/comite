'use client';

/**
 * Perfil do colaborador: identificação, permissões do aparelho,
 * privacidade e saída. É onde a explicação de permissões (§13) vive de
 * forma permanente, para quem precisar reativar algo depois.
 */

import * as React from 'react';
import { Camera, LocateFixed, ShieldCheck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PontoCard, StatusBadge, type Tone } from './primitives';

export type PermissionLabel = 'granted' | 'denied' | 'prompt' | 'unknown';

const PERMISSION_META: Record<PermissionLabel, { label: string; tone: Tone }> = {
  granted: { label: 'Autorizado', tone: 'success' },
  denied: { label: 'Bloqueado', tone: 'danger' },
  prompt: { label: 'Vai perguntar', tone: 'neutral' },
  unknown: { label: 'Não informado', tone: 'neutral' },
};

function PermissionRow({
  icon: Icon,
  title,
  purpose,
  state,
}: {
  icon: LucideIcon;
  title: string;
  purpose: string;
  state: PermissionLabel;
}) {
  const meta = PERMISSION_META[state];
  return (
    <div className="flex items-start gap-3 border-b border-ig-border py-3.5 last:border-b-0">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-ig-fg-subtle" aria-hidden="true" />
      {/* `items-start` impede que o selo estique na vertical do flex-col e
          `self-start` na horizontal — sem isso ele vira uma barra larga. */}
      <div className="flex min-w-0 flex-1 flex-col items-start gap-1.5 sm:flex-row sm:gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-ig-body-sm font-semibold text-ig-fg-strong">{title}</p>
          <p className="mt-0.5 text-ig-caption text-ig-fg-muted">{purpose}</p>
        </div>
        <StatusBadge label={meta.label} tone={meta.tone} className="self-start" />
      </div>
    </div>
  );
}

export interface EmployeeProfileCardProps {
  fullName: string | null;
  jobTitle: string | null;
  email: string | null;
  locationPermission: PermissionLabel;
  cameraPermission: PermissionLabel;
  footer?: React.ReactNode;
}

export function EmployeeProfileCard({
  fullName,
  jobTitle,
  email,
  locationPermission,
  cameraPermission,
  footer,
}: EmployeeProfileCardProps) {
  return (
    <PontoCard className="overflow-hidden">
      <div className="flex items-center gap-3 border-b border-ig-border px-5 py-4">
        <span
          aria-hidden="true"
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-ig-accent-weak text-ig-h2 text-ig-accent"
        >
          {(fullName ?? '?').trim().charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0">
          <p className="truncate text-ig-h2 text-ig-fg-strong">{fullName ?? 'Colaborador'}</p>
          {jobTitle ? <p className="truncate text-ig-body-sm text-ig-fg-muted">{jobTitle}</p> : null}
          {email ? <p className="truncate text-ig-caption text-ig-fg-subtle">{email}</p> : null}
        </div>
      </div>

      <div className={cn('px-5 py-1')}>
        <PermissionRow
          icon={LocateFixed}
          title="Localização"
          purpose="Usada só no momento do registro, para confirmar se você está na área autorizada."
          state={locationPermission}
        />
        <PermissionRow
          icon={Camera}
          title="Câmera"
          purpose="Usada só para a foto de presença anexada à marcação. Nenhuma imagem é analisada por reconhecimento facial."
          state={cameraPermission}
        />
      </div>

      <div className="border-t border-ig-border px-5 py-3.5">
        <p className="flex items-start gap-2 text-ig-caption text-ig-fg-muted">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ig-accent" aria-hidden="true" />
          Suas fotos e localizações ficam em armazenamento privado, acessíveis apenas ao time
          responsável pela conferência da jornada e pelo prazo definido pela sua empresa.
        </p>
      </div>

      {footer ? <div className="border-t border-ig-border px-5 py-4">{footer}</div> : null}
    </PontoCard>
  );
}
