'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Bell,
  Calendar,
  CheckCheck,
  CheckCircle2,
  ClipboardList,
  Loader2,
  RefreshCw,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { HudButton, HudPageLayout, HudHeader, HudPanel } from '@/components/hud';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { AppNotification } from '@/lib/types/agenda';
import { listNotifications, markAllRead, markRead, removeNotification } from '@/lib/services/notifications';

const TYPE_META: Record<string, { icon: LucideIcon; tint: string }> = {
  meeting_invite: { icon: Calendar, tint: '#17C3B2' },
  task_assigned: { icon: ClipboardList, tint: '#FFB04D' },
  task_status: { icon: CheckCircle2, tint: '#00C8FF' },
};

export default function NotificacoesPage() {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'todas' | 'nao_lidas'>('todas');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await listNotifications(100));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onRead = async (id: string) => {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, readAt: new Date() } : n)));
    await markRead(id);
  };
  const onReadAll = async () => {
    setItems((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date() })));
    await markAllRead();
  };
  const onDelete = async (id: string) => {
    setItems((prev) => prev.filter((n) => n.id !== id));
    await removeNotification(id);
  };

  const visible = items.filter((n) => (filter === 'nao_lidas' ? !n.readAt : true));
  const unread = items.filter((n) => !n.readAt).length;

  return (
    <HudPageLayout>
      <HudHeader
        title="Minhas Notificações"
        subtitle="Convites de reunião, atribuições e atualizações de tarefas"
        icon={<Bell className="h-5 w-5" />}
        iconTint="#00C8FF"
        breadcrumbs={[{ label: 'Notificações' }]}
        actions={
          <div className="flex gap-2">
            <HudButton variant="ghost" size="md" onClick={() => void load()} leftIcon={<RefreshCw className="h-4 w-4" />}>
              Atualizar
            </HudButton>
            {unread > 0 && (
              <HudButton variant="secondary" size="md" onClick={onReadAll} leftIcon={<CheckCheck className="h-4 w-4" />}>
                Marcar todas como lidas
              </HudButton>
            )}
          </div>
        }
      />

      <div className="flex items-center gap-1.5">
        {(['todas', 'nao_lidas'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              filter === f
                ? 'border-ig-border-focus bg-ig-accent-weak text-ig-accent'
                : 'border-ig-border bg-ig-panel text-ig-fg-muted hover:text-ig-fg-strong',
            )}
          >
            {f === 'todas' ? `Todas (${items.length})` : `Não lidas (${unread})`}
          </button>
        ))}
      </div>

      {loading ? (
        <HudPanel className="flex items-center justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-ig-fg-muted" />
        </HudPanel>
      ) : visible.length === 0 ? (
        <HudPanel className="flex flex-col items-center gap-2 py-16 text-center">
          <Bell className="h-8 w-8 text-ig-fg-subtle" />
          <p className="text-sm text-ig-fg-muted">{filter === 'nao_lidas' ? 'Você está em dia!' : 'Nenhuma notificação ainda.'}</p>
        </HudPanel>
      ) : (
        <HudPanel noPadding className="p-2">
          <div className="flex flex-col gap-1">
            {visible.map((n) => {
              const meta = TYPE_META[n.type] ?? { icon: Bell, tint: '#00C8FF' };
              const Icon = meta.icon;
              const body = (
                <div
                  className={cn(
                    'flex items-start gap-3 rounded-lg border px-3 py-3 transition-colors',
                    n.readAt
                      ? 'border-ig-border-subtle bg-ig-panel hover:bg-ig-panel-hover'
                      : 'border-ig-border-focus bg-ig-accent-weak',
                  )}
                >
                  <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: `${meta.tint}1a` }}>
                    <Icon className="h-4 w-4" style={{ color: meta.tint }} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={cn('text-sm font-medium', n.readAt ? 'text-ig-fg-strong' : 'text-ig-fg-strong')}>{n.title}</p>
                    {n.body && <p className="mt-0.5 text-xs text-ig-fg-muted">{n.body}</p>}
                    <p className="mt-1 text-[11px] text-ig-fg-subtle">{format(new Date(n.createdAt), "dd 'de' MMM 'às' HH:mm", { locale: ptBR })}</p>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-1">
                    {!n.readAt && (
                      <button type="button" onClick={(e) => { e.preventDefault(); void onRead(n.id); }} title="Marcar como lida" className="rounded-full p-1.5 text-ig-fg-muted hover:bg-ig-panel-hover hover:text-ig-accent">
                        <CheckCircle2 className="h-4 w-4" />
                      </button>
                    )}
                    <button type="button" onClick={(e) => { e.preventDefault(); void onDelete(n.id); }} title="Excluir" className="rounded-full p-1.5 text-ig-fg-muted hover:bg-ig-panel-hover hover:text-ig-danger">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              );
              return n.linkUrl ? (
                <Link key={n.id} href={n.linkUrl} onClick={() => !n.readAt && void onRead(n.id)}>
                  {body}
                </Link>
              ) : (
                <div key={n.id}>{body}</div>
              );
            })}
          </div>
        </HudPanel>
      )}
    </HudPageLayout>
  );
}
