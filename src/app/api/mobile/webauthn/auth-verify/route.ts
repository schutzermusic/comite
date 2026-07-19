import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import { authenticateMobile, json } from '@/lib/mobile/server';
import { rpFromRequest, b64urlDecode } from '@/lib/mobile/webauthn';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Verifica o gesto biométrico e cria a evidência de autenticação
 * (device_biometric, enhanced) que o /punch consome. Retorna o id da
 * evidência para o portal anexar à marcação.
 */
export async function POST(req: Request) {
  const auth = await authenticateMobile(req);
  if (!auth.ok) return auth.response;
  const { supabase, userId, orgId, personId } = auth.auth;
  const { rpID, origin } = rpFromRequest(req);

  let body: { response?: AuthenticationResponseJSON } = {};
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
    .eq('kind', 'authentication')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!ch) return json({ ok: false, error: 'Desafio expirado. Tente novamente.' }, 400);

  const { data: cred } = await supabase
    .from('webauthn_credentials')
    .select('id, credential_id, public_key, counter, transports')
    .eq('person_id', personId)
    .eq('credential_id', body.response.id)
    .maybeSingle();
  if (!cred) return json({ ok: false, error: 'Credencial não reconhecida' }, 400);

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: body.response,
      expectedChallenge: ch.challenge as string,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
      credential: {
        id: cred.credential_id as string,
        publicKey: b64urlDecode(cred.public_key as string),
        counter: Number(cred.counter),
        transports: (cred.transports as AuthenticatorTransport[]) ?? undefined,
      },
    });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : 'Falha na verificação' }, 400);
  }

  if (!verification.verified) return json({ ok: false, error: 'Biometria não confirmada' }, 400);

  // atualiza contador anti-replay + carimba uso
  await supabase
    .from('webauthn_credentials')
    .update({
      counter: verification.authenticationInfo.newCounter,
      last_used_at: new Date().toISOString(),
    })
    .eq('id', cred.id);
  await supabase.from('webauthn_challenges').delete().eq('id', ch.id);

  // evidência de autenticação que o /punch vai anexar
  const { data: evidence, error: evErr } = await supabase
    .from('authentication_evidence')
    .insert({
      organization_id: orgId,
      person_id: personId,
      method: 'device_biometric',
      result: 'success',
      assurance_level: 'enhanced',
      provider_reference: 'webauthn',
    })
    .select('id')
    .single();
  if (evErr) return json({ ok: false, error: evErr.message }, 500);

  return json({ ok: true, verified: true, authenticationEvidenceId: evidence.id });
}
