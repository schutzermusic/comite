import { NextResponse } from 'next/server';
import { requireCommercialSession, isSessionError, safeGovernedError } from '@/lib/commercial/server-session';
import { upsertContact } from '@/lib/commercial/engagement-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await requireCommercialSession(['commercial.view']);
  if (isSessionError(session)) return session.error;

  const { data, error } = await session.supabase.from('commercial_contacts')
    .select('id,party_id,full_name,role_title,email,phone,is_primary,active,'
      + 'party:parties!inner(legal_name,trade_name,document_number)')
    .eq('organization_id', session.organizationId)
    .eq('active', true)
    .order('full_name')
    .limit(500);
  if (error) {
    return NextResponse.json({ ok: false,
      error: 'Não foi possível consultar os contatos.' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, contacts: data ?? [] });
}

export async function POST(request: Request) {
  const session = await requireCommercialSession(['commercial.manage']);
  if (isSessionError(session)) return session.error;

  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok: false, error: 'Corpo inválido.' }, { status: 400 }); }

  if (!String(body.party_id ?? '').trim() || !String(body.full_name ?? '').trim()) {
    return NextResponse.json({ ok: false,
      error: 'Contato exige a contraparte (parties) e o nome.' }, { status: 400 });
  }
  try {
    return NextResponse.json({ ok: true,
      contactId: await upsertContact(session.organizationId, session.user.id, body) });
  } catch (error) {
    return NextResponse.json({ ok: false,
      error: safeGovernedError((error as Error).message) }, { status: 422 });
  }
}
