'use client';

/**
 * In-app notifications service (Supabase-backed). Replaces the mock store
 * used by the header bell and the /notificacoes page. RLS restricts every
 * row to recipient_user_id = auth.uid(), so all reads/writes are implicitly
 * the current user's own notifications.
 */

import { createClient } from '@/utils/supabase/client';
import type { AppNotification } from '@/lib/types/agenda';
import { mapNotification } from '@/lib/services/agenda';

const TABLE = 'notifications';

export async function listNotifications(limit = 50): Promise<AppNotification[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.error('[notifications] list failed:', error.message);
    return [];
  }
  return (data ?? []).map(mapNotification);
}

export async function unreadCount(): Promise<number> {
  const supabase = createClient();
  const { count, error } = await supabase
    .from(TABLE)
    .select('id', { count: 'exact', head: true })
    .is('read_at', null);
  if (error) {
    console.error('[notifications] unreadCount failed:', error.message);
    return 0;
  }
  return count ?? 0;
}

export async function markRead(id: string): Promise<void> {
  const supabase = createClient();
  await supabase.from(TABLE).update({ read_at: new Date().toISOString() }).eq('id', id);
}

export async function markAllRead(): Promise<void> {
  const supabase = createClient();
  await supabase.from(TABLE).update({ read_at: new Date().toISOString() }).is('read_at', null);
}

export async function removeNotification(id: string): Promise<void> {
  const supabase = createClient();
  await supabase.from(TABLE).delete().eq('id', id);
}
