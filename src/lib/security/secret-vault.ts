import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

if (typeof window !== 'undefined') {
  throw new Error('secret-vault.ts não pode ser importado no navegador.');
}

const ALGORITHM = 'aes-256-gcm';

function deriveKey(scope: string): Buffer {
  const raw = process.env.FISCAL_SECRET_KEY;
  if (!raw || raw.length < 32) {
    throw new Error('FISCAL_SECRET_KEY ausente ou menor que 32 caracteres.');
  }
  return createHash('sha256').update(`${scope}:${raw}`).digest();
}

export function encryptScopedSecret(scope: string, plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, deriveKey(scope), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64')).join(':');
}

export function decryptScopedSecret(scope: string, payload: string): string {
  const [iv, tag, encrypted] = payload.split(':').map((part) => Buffer.from(part, 'base64'));
  if (!iv?.length || !tag?.length || !encrypted?.length) throw new Error('Segredo fiscal inválido.');
  const decipher = createDecipheriv(ALGORITHM, deriveKey(scope), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

export function fiscalSecretKeyConfigured(): boolean {
  return Boolean(process.env.FISCAL_SECRET_KEY && process.env.FISCAL_SECRET_KEY.length >= 32);
}

