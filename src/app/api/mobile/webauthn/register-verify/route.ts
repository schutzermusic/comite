import { verifyRegistrationResponse } from '@simplewebauthn/server';
import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import { authenticateMobile, json } from '@/lib/mobile/server';
import { rpFromRequest, b64urlEncode } from '@/lib/mobile/webauthn';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Verifica o cadastro da credencial e persiste a chave pública. */
export async function POST(req: Request) {
  const auth = await authenticateMobile(req);
  if (!auth.ok) return auth.response;
  const { supabase, userId, orgId, personId } = auth.auth;
  const { rpID, origin } = rpFromRequest(req);

  let body: { response?: RegistrationResponseJSON; deviceLabel?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ ok: false, error: 'Corpo inválido' }, 400);
  }
  if (!body.response) return json({ ok: false, error: 'response ausente' }, 400);

  const { data: ch } = await supabase
    .from('webauthn_challenges')
    .select('id, challenge')
    .eq('user_id', userId)
    .eq('kind', 'registration')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!ch) return json({ ok: false, error: 'Desafio expirado. Tente novamente.' }, 400);

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: body.response,
      expectedChallenge: ch.challenge as string,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : 'Falha na verificação' }, 400);
  }

  if (!verification.verified || !verification.registrationInfo) {
    return json({ ok: false, error: 'Não verificado' }, 400);
  }

  const cred = verification.registrationInfo.credential;
  const { error } = await supabase.from('webauthn_credentials').insert({
    organization_id: orgId,
    person_id: personId,
    user_id: userId,
    credential_id: cred.id,
    public_key: b64urlEncode(cred.publicKey),
    counter: cred.counter,
    transports: cred.transports ?? null,
    device_label: body.deviceLabel ?? null,
  });
  if (error) return json({ ok: false, error: error.message }, 500);

  await supabase.from('webauthn_challenges').delete().eq('id', ch.id);
  return json({ ok: true, registered: true });
}
