/**
 * WebAuthn helpers (server) — Face ID/Touch ID no Portal de Ponto Web.
 * Só a chave pública da credencial é persistida; nenhuma biometria
 * trafega ou é armazenada (LGPD/spec §13). rpID/origin derivam do host
 * da requisição (auto-adapta a localhost e ao subdomínio de produção).
 */
if (typeof window !== 'undefined') {
  throw new Error('src/lib/mobile/webauthn.ts must not be imported in the browser');
}

export function rpFromRequest(req: Request): { rpID: string; origin: string } {
  const origin = req.headers.get('origin') || `https://${req.headers.get('host') ?? 'localhost'}`;
  const rpID = process.env.WEBAUTHN_RP_ID || new URL(origin).hostname;
  return { rpID, origin };
}

export const RP_NAME = 'Insight Ponto';

export function b64urlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

export function b64urlDecode(str: string): Uint8Array<ArrayBuffer> {
  const buf = Buffer.from(str, 'base64url');
  const out = new Uint8Array(new ArrayBuffer(buf.byteLength));
  out.set(buf);
  return out;
}
