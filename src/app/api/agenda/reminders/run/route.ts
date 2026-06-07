import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

export const runtime = 'nodejs';

/**
 * POST /api/agenda/reminders/run
 * Trigger manual dos cron jobs de lembrete (admin only).
 * Em produção este endpoint é chamado pelo pg_cron via pg_net ou por um cron externo.
 * Útil para testes sem esperar o schedule horário.
 */
export async function POST() {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
  }

  const { data: isAdmin } = await supabase.rpc('current_user_is_admin');
  if (!isAdmin) {
    return NextResponse.json({ error: 'Acesso restrito a administradores' }, { status: 403 });
  }

  const [tasks, meetings] = await Promise.all([
    supabase.rpc('process_task_reminders'),
    supabase.rpc('process_meeting_reminders'),
  ]);

  const errors = [tasks.error, meetings.error].filter(Boolean);

  return NextResponse.json(
    {
      task_notifications: tasks.data ?? 0,
      meeting_notifications: meetings.data ?? 0,
      total: (tasks.data ?? 0) + (meetings.data ?? 0),
      ...(errors.length > 0 && { errors: errors.map((e) => e?.message) }),
    },
    { status: errors.length > 0 ? 207 : 200 },
  );
}
