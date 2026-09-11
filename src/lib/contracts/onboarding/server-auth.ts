import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { requireActiveOrganizationId } from '@/lib/auth/active-organization';

type PermShape = { roles?: { role_permissions?: Array<{ permissions?: { key?: string } }> } };

export async function requireContractOnboardingSession() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ ok: false, error: 'Não autenticado.' }, { status: 401 }) };
  const { data: rows, error } = await supabase.from('user_roles')
    .select('roles!inner(role_permissions!inner(permissions!inner(key)))').eq('user_id', user.id);
  if (error) return { error: NextResponse.json({ ok: false, error: 'Não foi possível verificar a permissão.' }, { status: 500 }) };
  const keys = new Set<string>();
  for (const row of (rows ?? []) as unknown as PermShape[]) {
    for (const item of row.roles?.role_permissions ?? []) if (item.permissions?.key) keys.add(item.permissions.key);
  }
  if (!keys.has('contracts.create') || !keys.has('contracts.upload_file') || !keys.has('contracts.analyze_with_ai')) {
    return { error: NextResponse.json({ ok: false,
      error: 'O envio de contrato exige permissão para criar, anexar e processar documentos.' }, { status: 403 }) };
  }
  try {
    return { supabase, user, organizationId: await requireActiveOrganizationId(supabase) };
  } catch {
    return { error: NextResponse.json({ ok: false, error: 'Nenhuma organização ativa selecionada.' }, { status: 403 }) };
  }
}
