'use client';

/**
 * In-app notifications service (Supabase-backed). Replaces the mock store
 * used by the header bell and the /notificacoes page.
 *
 * Reads: RLS returns only the caller's rows IN THE ACTIVE ORGANIZATION (242).
 * Writes: the browser has no write privilege on the table. Reading and
 * archiving go through governed RPCs that touch only `read_at` /
 * `dismissed_at` of the caller's own row; archiving keeps the row (it is
 * delivery history other ledgers reference).
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
    .is('dismissed_at', null)
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
    .is('read_at', null)
    .is('dismissed_at', null);
  if (error) {
    console.error('[notifications] unreadCount failed:', error.message);
    return 0;
  }
  return count ?? 0;
}

export async function markRead(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc('notification_mark_read', { p_notification_id: id });
  if (error) console.error('[notifications] markRead failed:', error.message);
}

export async function markAllRead(): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc('notification_mark_all_read');
  if (error) console.error('[notifications] markAllRead failed:', error.message);
}

/** Archives the notification for the recipient (the row stays as history). */
export async function removeNotification(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc('notification_dismiss', { p_notification_id: id });
  if (error) console.error('[notifications] dismiss failed:', error.message);
}
