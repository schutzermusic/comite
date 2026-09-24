import { NextResponse } from 'next/server';
import { requireOperationsSession, isSessionError } from '@/lib/operations/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Papéis que podem receber alçada de compra (sistema + do inquilino). */
export async function GET() {
  const session = await requireOperationsSession(['procurement.authorities.manage']);
  if (isSessionError(session)) return session.error;
  const { data, error } = await session.supabase.from('roles').select('id,key,name,organization_id')
    .or(`organization_id.is.null,organization_id.eq.${session.organizationId}`).order('name');
  if (error) return NextResponse.json({ ok: false, error: 'Não foi possível ler os papéis.' }, { status: 500 });
  return NextResponse.json({ ok: true, roles: (data ?? []).filter((r) => !['ponto_field_worker'].includes(String(r.key))) });
}
