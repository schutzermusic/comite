/**
 * Extração do CNPJ do titular do certificado A1.
 *
 * Regressão: num certificado ICP-Brasil real o CNPJ vem numa `otherName`, cujo
 * `value` é um array de nós ASN.1 — não uma string. Tratá-lo como texto quebrava
 * o upload inteiro com "value.replace is not a function", e o caso só aparece
 * com certificado de verdade (um autoassinado sem SAN nunca chega nesse ramo).
 */
import { describe, expect, it } from 'vitest';
import forge from 'node-forge';
import { holderDocumentFromAltNames, type AltName } from '@/lib/esocial/connector/certificate';

/** Monta uma `otherName` no formato que o node-forge entrega ao parsear o SAN. */
function otherName(oid: string, value: string): AltName {
  return {
    type: 0,
    value: [
      // Nó do OID: o forge entrega os bytes DER crus como string.
      { tagClass: 0, type: 6, constructed: false, composed: false, value: forge.asn1.oidToDer(oid).getBytes() },
      // Nó do conteúdo, embrulhado em [0] EXPLICIT como no ICP-Brasil.
      {
        tagClass: 128,
        type: 0,
        constructed: true,
        composed: true,
        value: [{ tagClass: 0, type: 12, constructed: false, composed: false, value }],
      },
    ],
  };
}

describe('holderDocumentFromAltNames', () => {
  it('lê o CNPJ da otherName ICP-Brasil (OID 2.16.76.1.3.3)', () => {
    const altNames: AltName[] = [
      otherName('2.16.76.1.3.3', '12345678000199'),
      { type: 1, value: 'contato@empresa.com.br' },
    ];
    expect(holderDocumentFromAltNames(altNames)).toBe('12345678000199');
  });

  it('não confunde o CPF do responsável (OID 2.16.76.1.3.1) com o CNPJ', () => {
    // Esse OID concatena data de nascimento + CPF + PIS + RG: 45 dígitos que,
    // lidos sem checar o OID, virariam um "CNPJ" inventado.
    const altNames: AltName[] = [
      otherName('2.16.76.1.3.1', '011019801234567890112345678901234567890123456'),
    ];
    expect(holderDocumentFromAltNames(altNames)).toBeUndefined();
  });

  it('prefere o CNPJ mesmo quando o CPF do responsável vem antes', () => {
    const altNames: AltName[] = [
      otherName('2.16.76.1.3.1', '011019801234567890112345678901234567890123456'),
      otherName('2.16.76.1.3.3', '98765432000188'),
    ];
    expect(holderDocumentFromAltNames(altNames)).toBe('98765432000188');
  });

  it('aceita SAN em texto simples de emissores que não usam otherName', () => {
    expect(holderDocumentFromAltNames([{ type: 2, value: 'CNPJ:12.345.678/0001-99' }])).toBe(
      '12345678000199',
    );
  });

  it('cai no CN quando não há SAN utilizável', () => {
    expect(holderDocumentFromAltNames([], 'EMPRESA TESTE LTDA:12345678000199')).toBe(
      '12345678000199',
    );
  });

  it('devolve undefined — nunca lança — diante de estrutura inesperada', () => {
    const estranhos: AltName[] = [
      { type: 0, value: undefined },
      { type: 0, value: 42 },
      { type: 0, value: [{ type: 6, value: { nao: 'e string' } }] },
      { type: 0, value: [] },
      { value: 'sem type' },
    ];
    for (const alt of estranhos) {
      expect(() => holderDocumentFromAltNames([alt])).not.toThrow();
      expect(holderDocumentFromAltNames([alt])).toBeUndefined();
    }
  });

  it('não devolve documento quando nada bate', () => {
    expect(holderDocumentFromAltNames([{ type: 1, value: 'a@b.com' }], 'EMPRESA SEM CNPJ')).toBeUndefined();
  });
});
