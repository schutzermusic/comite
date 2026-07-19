import { generateRegistrationOptions } from '@simplewebauthn/server';
import { authenticateMobile, json } from '@/lib/mobile/server';
import { rpFromRequest, RP_NAME } from '@/lib/mobile/webauthn';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Opções para cadastrar Face ID/Touch ID (autenticador de plataforma). */
export async function POST(req: Request) {
  const auth = await authenticateMobile(req);
  if (!auth.ok) return auth.response;
  const { supabase, userId, personId } = auth.auth;
  const { rpID } = rpFromRequest(req);

  const { data: person } = await supabase
    .from('people')
    .select('full_name')
    .eq('id', personId)
    .maybeSingle();
  const { data: existing } = await supabase
    .from('webauthn_credentials')
    .select('credential_id, transports')
    .eq('person_id', personId);

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userID: new TextEncoder().encode(personId),
    userName: (person?.full_name as string) || 'colaborador',
    attestationType: 'none',
    excludeCredentials: (existing ?? []).map((c) => ({
      id: c.credential_id as string,
      transports: (c.transports as AuthenticatorTransport[]) ?? undefined,
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'required',
      authenticatorAttachment: 'platform',
    },
  });

  await supabase
    .from('webauthn_challenges')
    .insert({ user_id: userId, challenge: options.challenge, kind: 'registration' });

  return json({ ok: true, options });
}
