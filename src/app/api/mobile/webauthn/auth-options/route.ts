import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { authenticateMobile, json } from '@/lib/mobile/server';
import { rpFromRequest } from '@/lib/mobile/webauthn';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Opções para o gesto biométrico (Face ID/Touch ID) antes de bater ponto. */
export async function POST(req: Request) {
  const auth = await authenticateMobile(req);
  if (!auth.ok) return auth.response;
  const { supabase, userId, personId } = auth.auth;
  const { rpID } = rpFromRequest(req);

  const { data: creds } = await supabase
    .from('webauthn_credentials')
    .select('credential_id, transports')
    .eq('person_id', personId);

  if (!creds || creds.length === 0) {
    return json({ ok: false, error: 'Nenhuma credencial biométrica cadastrada', needsEnroll: true }, 409);
  }

  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: 'required',
    allowCredentials: creds.map((c) => ({
      id: c.credential_id as string,
      transports: (c.transports as AuthenticatorTransport[]) ?? undefined,
    })),
  });

  await supabase
    .from('webauthn_challenges')
    .insert({ user_id: userId, challenge: options.challenge, kind: 'authentication' });

  return json({ ok: true, options });
}
