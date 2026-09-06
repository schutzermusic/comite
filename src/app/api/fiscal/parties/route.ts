import { NextResponse } from 'next/server';
import { fiscalPartyProfileSchema } from '@/lib/fiscal/schemas';
import { resolveFiscalActor } from '@/lib/fiscal/server/actor';
import { fiscalApiError } from '@/lib/fiscal/server/http';
import { upsertFiscalPartyProfile } from '@/lib/fiscal/server/store';

export const runtime = 'nodejs';

/**
 * Grava o PERFIL FISCAL de uma contraparte já cadastrada.
 *
 * Criar a contraparte em si é do cadastro canônico (`parties`): identidade
 * jurídica tem um dono só. O que entra aqui é o que a NFS-e exige e a Party não
 * guarda — inscrição municipal, endereço fiscal, município IBGE.
 */
export async function POST(req: Request) {
  const auth = await resolveFiscalActor('fiscal.create');
  if (!auth.ok) return auth.response;
  try {
    const input = fiscalPartyProfileSchema.parse(await req.json());
    return NextResponse.json({ ok: true, profile: await upsertFiscalPartyProfile(auth.actor, input) }, { status: 201 });
  } catch (error) {
    return fiscalApiError(error, 'Falha ao gravar perfil fiscal da contraparte.');
  }
}
