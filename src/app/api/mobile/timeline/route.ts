import { authenticateMobile, json } from '@/lib/mobile/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Etapas do cronograma (WBS) de um projeto onde o colaborador está
 * alocado — para apontar em qual etapa está trabalhando. A leitura é
 * autorizada pela política project_timeline_items_worker_select (055).
 */
export async function GET(req: Request) {
  const auth = await authenticateMobile(req);
  if (!auth.ok) return auth.response;
  const { supabase } = auth.auth;

  const projectId = new URL(req.url).searchParams.get('projectId');
  if (!projectId) return json({ ok: false, error: 'projectId é obrigatório' }, 400);

  const { data, error } = await supabase
    .from('project_timeline_items')
    .select('id, wbs_code, title, type, status, percent_complete, outline_level, row_order')
    .eq('project_id', projectId)
    .in('type', ['phase', 'deliverable', 'task', 'milestone'])
    .neq('status', 'cancelled')
    .order('row_order', { ascending: true })
    .limit(300);
  if (error) return json({ ok: false, error: error.message }, 500);

  return json({ ok: true, items: data ?? [] });
}
