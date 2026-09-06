/**
 * Cofre dos segredos fiscais.
 *
 * Credencial de provedor, certificado A1 e segredo de webhook nunca entram no
 * banco em claro: são cifrados com AES-256-GCM sob `FISCAL_CERT_KEY`, que vive
 * fora do banco. Um dump do Postgres não entrega segredo nenhum; a chave
 * sozinha também não, porque sem a linha cifrada não há o que abrir.
 *
 * O formato é o mesmo já usado pelo conector do eSocial (`iv:tag:ciphertext`,
 * tudo em base64) de propósito — dois formatos para o mesmo problema seriam
 * dois lugares para errar.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

if (typeof window !== 'undefined') {
  throw new Error('src/lib/fiscal/server/secrets.ts não pode ser importado no browser');
}

const ALGO = 'aes-256-gcm';

export class FiscalSecretKeyMissingError extends Error {
  constructor() {
    super(
      'FISCAL_CERT_KEY ausente ou curta demais (mínimo 32 caracteres). ' +
        'Sem ela nenhum segredo fiscal pode ser cifrado nem lido.',
    );
    this.name = 'FiscalSecretKeyMissingError';
  }
}

export function hasFiscalSecretKey(): boolean {
  const raw = process.env.FISCAL_CERT_KEY;
  return Boolean(raw && raw.trim().length >= 32);
}

function key(): Buffer {
  if (!hasFiscalSecretKey()) throw new FiscalSecretKeyMissingError();
  return createHash('sha256').update(String(process.env.FISCAL_CERT_KEY)).digest();
}

/** Retorna `iv:tag:ciphertext`, todos em base64. */
export function encryptFiscalSecret(plain: string | Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key(), iv);
  const enc = Buffer.concat([cipher.update(Buffer.isBuffer(plain) ? plain : Buffer.from(plain, 'utf8')), cipher.final()]);
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join(':');
}

export function decryptFiscalSecretBytes(payload: string): Buffer {
  const [ivB64, tagB64, dataB64] = payload.split(':');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Segredo fiscal com formato inválido — reconfigure a integração.');
  }
  const decipher = createDecipheriv(ALGO, key(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]);
}

export function decryptFiscalSecret(payload: string): string {
  return decryptFiscalSecretBytes(payload).toString('utf8');
}
