/**
 * Cifra da senha do certificado A1.
 *
 * A senha nunca entra no banco em claro: é cifrada com AES-256-GCM usando a
 * chave de `ESOCIAL_CERT_KEY`, que vive fora do banco. Quem obtém um dump do
 * Postgres não obtém a senha; quem obtém a chave não obtém o .pfx (que está no
 * bucket privado). São dois cofres distintos, e é preciso os dois.
 */
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

if (typeof window !== 'undefined') {
  throw new Error('src/lib/esocial/connector/secrets.ts não pode ser importado no browser');
}

const ALGO = 'aes-256-gcm';

function key(): Buffer {
  const raw = process.env.ESOCIAL_CERT_KEY;
  if (!raw || raw.length < 32) {
    throw new Error(
      'ESOCIAL_CERT_KEY ausente ou curta demais (mínimo 32 caracteres). ' +
        'Sem ela a senha do certificado não pode ser cifrada nem lida.',
    );
  }
  // Normaliza qualquer comprimento para os 32 bytes exigidos pelo AES-256.
  return createHash('sha256').update(raw).digest();
}

/** Retorna `iv:tag:ciphertext`, todos em base64. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join(':');
}

export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(':');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Senha do certificado com formato inválido — reconfigure o certificado.');
  }
  const decipher = createDecipheriv(ALGO, key(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}

/** True quando a chave está configurada — usado para degradar com mensagem clara. */
export function hasCertKey(): boolean {
  const raw = process.env.ESOCIAL_CERT_KEY;
  return Boolean(raw && raw.length >= 32);
}

/**
 * Hash estável do CPF, para correlacionar eventos do mesmo trabalhador sem
 * jamais gravar o número. Salgado com a mesma chave: dois ambientes distintos
 * produzem hashes distintos, o que impede cruzamento entre bases.
 */
export function hashCpf(cpf: string): string {
  const digits = cpf.replace(/\D/g, '');
  return createHash('sha256').update(`${process.env.ESOCIAL_CERT_KEY ?? ''}:${digits}`).digest('hex');
}

/** `***.456.789-**` — o suficiente para conferência humana, inútil para reidentificação. */
export function maskCpf(cpf: string): string {
  const d = cpf.replace(/\D/g, '');
  if (d.length !== 11) return '***.***.***-**';
  return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
}
