'use client';

/**
 * Estado de sincronização (§12).
 *
 * A distinção que não pode se perder: "salvo no aparelho" ≠ "confirmado
 * pelo servidor". Enquanto houver pendência, o indicador fica visível e
 * oferece o envio manual.
 */

import * as React from 'react';
import { CheckCheck, CloudUpload, RefreshCw, TriangleAlert, WifiOff } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { QueuedPunch } from '@/lib/ponto/offline-queue';
import { PUNCH_SHORT_LABEL, formatTime } from '@/lib/ponto/attendance-state';
import { PontoButton, TONE_TEXT, type Tone } from './primitives';

export interface SyncStatusProps {
  online: boolean;
  syncing: boolean;
  pending: readonly QueuedPunch[];
  lastSyncMessage?: string | null;
  onSyncNow: () => void;
}

interface SyncCopy {
  icon: LucideIcon;
  tone: Tone;
  title: string;
  description: string;
}

function describeSync({ online, syncing, pending }: Pick<SyncStatusProps, 'online' | 'syncing' | 'pending'>): SyncCopy {
  if (syncing) {
    return {
      icon: CloudUpload,
      tone: 'info',
      title: 'Enviando ao servidor…',
      description: 'Não feche o aplicativo até terminar.',
    };
  }
  if (pending.length > 0) {
    const failed = pending.filter((item) => item.attempts > 0);
    if (!online) {
      return {
        icon: WifiOff,
        tone: 'warning',
        title: `${pending.length} ${pending.length === 1 ? 'ponto salvo' : 'pontos salvos'} no aparelho`,
        description: 'Assim que a internet voltar, enviamos automaticamente.',
      };
    }
    if (failed.length > 0) {
      return {
        icon: TriangleAlert,
        tone: 'danger',
        title: 'Não conseguimos enviar tudo',
        description: failed[0]?.lastError ?? 'Tente enviar novamente em instantes.',
      };
    }
    return {
      icon: CloudUpload,
      tone: 'warning',
      title: `${pending.length} ${pending.length === 1 ? 'ponto aguardando' : 'pontos aguardando'} envio`,
      description: 'Ainda não confirmados pelo servidor.',
    };
  }
  if (!online) {
    return {
      icon: WifiOff,
      tone: 'warning',
      title: 'Sem internet',
      description: 'Você pode registrar mesmo assim: guardamos no aparelho e enviamos depois.',
    };
  }
  return {
    icon: CheckCheck,
    tone: 'success',
    title: 'Tudo sincronizado',
    description: 'Suas marcações estão confirmadas no servidor.',
  };
}

export function SyncStatus({ online, syncing, pending, lastSyncMessage, onSyncNow }: SyncStatusProps) {
  const copy = describeSync({ online, syncing, pending });
  const Icon = copy.icon;

  return (
    <div className="px-5 py-3.5">
      <div className="flex items-start gap-3">
        <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', TONE_TEXT[copy.tone])} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className={cn('text-ig-body-sm font-semibold', TONE_TEXT[copy.tone])}>{copy.title}</p>
          <p className="mt-0.5 text-ig-caption text-ig-fg-muted">{lastSyncMessage ?? copy.description}</p>

          {pending.length > 0 ? (
            <ul className="mt-2.5 space-y-1">
              {pending.map((item) => (
                <li
                  key={item.clientEventId}
                  className={cn(
                    'flex flex-wrap items-baseline gap-x-2 gap-y-0.5',
                    'rounded-[var(--ig-radius-sm)] bg-ig-panel px-3 py-2',
                  )}
                >
                  <span className="min-w-0 text-ig-caption text-ig-fg">
                    {PUNCH_SHORT_LABEL[item.type]} · {formatTime(item.occurredAt)}
                  </span>
                  <span className="ml-auto shrink-0 text-ig-caption text-ig-fg-subtle">
                    salvo no aparelho
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          {pending.length > 0 && online ? (
            <PontoButton
              variant="secondary"
              icon={RefreshCw}
              loading={syncing}
              onClick={onSyncNow}
              className="mt-2.5 min-h-[44px] text-ig-body-sm"
            >
              Sincronizar agora
            </PontoButton>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Selo compacto para o topo das telas secundárias. */
export function SyncBadge({ online, pendingCount }: { online: boolean; pendingCount: number }) {
  if (online && pendingCount === 0) return null;
  return (
    <span className="inline-flex items-center gap-1 text-ig-caption text-ig-warning">
      {online ? <CloudUpload className="h-3 w-3" aria-hidden="true" /> : <WifiOff className="h-3 w-3" aria-hidden="true" />}
      {pendingCount > 0 ? `${pendingCount} pendente${pendingCount === 1 ? '' : 's'}` : 'sem internet'}
    </span>
  );
}
