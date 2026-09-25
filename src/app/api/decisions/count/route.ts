import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { decisionsCount, decisionsReadFailure, NO_STORE } from '@/lib/decisions/read';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * O número do badge — consultado em intervalo e a cada ato. De propósito
 * mais leve que as outras rotas: não lê o conjunto de permissões (nada aqui
 * depende dele). `decision_inbox_count_for_viewer` tira a pessoa de
 * auth.uid() e a organização de current_user_organization_id(); sem
 * organização ativa a resposta é zero, que é a verdade para um badge.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Não autenticado.' }, { status: 401, headers: NO_STORE });
  try {
    return NextResponse.json({ ok: true, count: await decisionsCount(supabase) }, { headers: NO_STORE });
  } catch (error) {
    return decisionsReadFailure(error);
  }
}
