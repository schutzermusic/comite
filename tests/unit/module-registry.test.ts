/**
 * Registry de módulos — o padrão é DESLIGADO.
 *
 * O módulo Fiscal está no código inteiro (páginas, rotas, cinco itens de menu)
 * mas a migration `090_fiscal_nfse.sql` não está aplicada em produção. Se a
 * flag ligasse por acidente, o administrador veria links para telas que
 * consultam tabelas inexistentes.
 */

import { describe, expect, it, vi } from 'vitest';

describe('registry de módulos', () => {
  it('fiscal vem desligado sem configuração', async () => {
    const { isModuleEnabled, MODULE_ENABLED } = await import('@/lib/modules/registry');
    expect(isModuleEnabled('fiscal')).toBe(false);
    expect(MODULE_ENABLED.fiscal).toBe(false);
  });

  it('só um "sim" explícito liga um módulo', async () => {
    // Reimporta com cada valor: o registry lê `process.env` na avaliação.
    const casos: [string | undefined, boolean][] = [
      [undefined, false],
      ['', false],
      ['false', false],
      ['0', false],
      ['no', false],
      ['off', false],
      ['talvez', false],
      ['FALSE', false],
      ['true', true],
      ['TRUE', true],
      ['1', true],
      ['yes', true],
      ['on', true],
      ['  true  ', true],
    ];

    for (const [valor, esperado] of casos) {
      vi.resetModules();
      if (valor === undefined) delete process.env.NEXT_PUBLIC_FISCAL_MODULE_ENABLED;
      else process.env.NEXT_PUBLIC_FISCAL_MODULE_ENABLED = valor;

      const { isModuleEnabled } = await import('@/lib/modules/registry');
      expect(isModuleEnabled('fiscal'), `valor ${JSON.stringify(valor)}`).toBe(esperado);
    }

    delete process.env.NEXT_PUBLIC_FISCAL_MODULE_ENABLED;
    vi.resetModules();
  });
});
