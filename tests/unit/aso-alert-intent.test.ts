/**
 * Alerta de ASO por e-mail: o navegador escolhe MEMBROS da lista do servidor,
 * nunca endereços. Regressão: o corpo antigo `{ recipients: [...] }` mandava o
 * resumo de saúde ocupacional a qualquer e-mail digitado.
 */
import { describe, expect, it } from 'vitest';
import { MAX_ASO_DIGEST_RECIPIENTS, asoDigestKey, asoDigestSubject, parseAsoDigestIntent } from '@/lib/workforce/aso-alert-intent';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('parseAsoDigestIntent', () => {
  it('recusa o corpo antigo com endereços livres', () => {
    const r = parseAsoDigestIntent({ recipients: ['externo@evil.example'] });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/servidor/);
  });

  it('recusa endereço dentro da referência, tipo diferente de membro e campo extra', () => {
    const base = { request_id: U(1), to: [{ type: 'member', id: U(2) }] };
    expect(parseAsoDigestIntent({ ...base, to: ['externo@evil.example'] }).ok).toBe(false);
    expect(parseAsoDigestIntent({ ...base, to: [{ type: 'member', id: U(2), email: 'externo@evil.example' }] }).ok).toBe(false);
    expect(parseAsoDigestIntent({ ...base, to: [{ type: 'contact', id: U(2) }] }).ok).toBe(false);
    expect(parseAsoDigestIntent({ ...base, subject: 'x' }).ok).toBe(false);
    expect(parseAsoDigestIntent({ ...base, cc: [] }).ok).toBe(false);
  });

  it('teto explícito de destinatários; exige ao menos um e request_id', () => {
    const many = Array.from({ length: MAX_ASO_DIGEST_RECIPIENTS + 1 }, (_, i) => ({ type: 'member', id: U(10 + i) }));
    expect(parseAsoDigestIntent({ request_id: U(1), to: many }).ok).toBe(false);
    expect(parseAsoDigestIntent({ request_id: U(1), to: [] }).ok).toBe(false);
    expect(parseAsoDigestIntent({ to: [{ type: 'member', id: U(2) }] }).ok).toBe(false);
  });

  it('aceita a intenção tipada', () => {
    expect(parseAsoDigestIntent({ request_id: U(1), to: [{ type: 'member', id: U(2) }], test: true }))
      .toEqual({ ok: true, intent: { request_id: U(1), to: [{ type: 'member', id: U(2) }], test: true } });
  });
});

describe('assunto e chave', () => {
  it('assunto neutro: sem contagem, nome ou lotação', () => {
    const s = asoDigestSubject('2026-09-25');
    expect(s).toBe('[SST] Resumo de vencimentos de ASO — 25/09/2026');
    expect(s).not.toMatch(/vencido|venc(e|er) em|\d+ ASO/i);
  });

  it('chave estável por pedido e destinatário, sem o endereço em claro', () => {
    const k = asoDigestKey(U(1), 'RH@Org.example');
    expect(k).toBe(asoDigestKey(U(1), 'rh@org.example '));
    expect(k).not.toContain('org.example');
    expect(k).not.toBe(asoDigestKey(U(9), 'rh@org.example'));
  });
});
