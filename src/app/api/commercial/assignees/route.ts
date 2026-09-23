import { NextResponse } from 'next/server';
import { requireCommercialSession, isSessionError, hasOptionalPermission } from '@/lib/commercial/server-session';
import { platformServiceClient } from '@/lib/platform/server-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Quem pode receber uma designação: membros ATIVOS da organização ativa.
 *
 * Só nome e id atravessam — nem e-mail, nem cargo, nem telefone — e só para
 * quem tem alçada de DESIGNAR alguma coisa no Comercial (acompanhamento,
 * levantamento, regularização). É a pergunta mínima para trocar o
 * "responsável em texto livre" por uma identidade da plataforma.
 */
export async function GET() {
  const session = await requireCommercialSession([]);
  if (isSessionError(session)) return session.error;
  let allowed = false;
  for (const key of ['commercial.manage', 'commercial.surveys.manage', 'commercial.execution.start']) {
    if (await hasOptionalPermission(session, key)) { allowed = true; break; }
  }
  if (!allowed) {
    return NextResponse.json({ ok: false, error: 'Esta ação exige alçada de designação no Comercial.' }, { status: 403 });
  }
  const { data, error } = await platformServiceClient().from('profiles')
    .select('user_id,full_name').eq('organization_id', session.organizationId).eq('status', 'active')
    .order('full_name').limit(500);
  if (error) return NextResponse.json({ ok: false, error: 'Não foi possível ler a equipe.' }, { status: 500 });
  const people = ((data ?? []) as Array<{ user_id: string; full_name: string | null }>)
    .filter((p) => p.full_name?.trim())
    .map((p) => ({ id: p.user_id, name: p.full_name!.trim(), self: p.user_id === session.user.id }));
  return NextResponse.json({ ok: true, people, me: session.user.id });
}
