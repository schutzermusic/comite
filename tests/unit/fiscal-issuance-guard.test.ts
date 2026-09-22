/**
 * O portão de emissão fiscal real fecha por padrão — e não abre em teste.
 *
 * Estas provas existem por causa de um incidente concreto: uma rodada da
 * suíte viva deixou 17 documentos fiscais no banco. Eram sandbox/homologação
 * e nada saiu da máquina — mas o único motivo foi a ausência de credencial no
 * ambiente, e ausência de credencial não é controle.
 */
import { describe, expect, it, afterEach } from 'vitest';
import {
  RealFiscalIssuanceBlockedError,
  assertRealFiscalIssuanceAllowed,
  isRealFiscalIssuanceAllowed,
  isTestRuntime,
  realFiscalIssuanceDecision,
} from '@/lib/fiscal/server/issuance-guard';

const ORIGINAL = { ...process.env };
afterEach(() => { process.env = { ...ORIGINAL }; });

describe('portão de emissão fiscal real', () => {
  it('reconhece que está rodando sob um runner de teste', () => {
    expect(isTestRuntime()).toBe(true);
  });

  it('bloqueia por padrão, sem nenhuma configuração', () => {
    delete process.env.ALLOW_REAL_FISCAL_ISSUANCE;
    expect(isRealFiscalIssuanceAllowed()).toBe(false);
  });

  /*
    A prova que importa. Alguém pode, por engano ou por curiosidade, deixar
    `ALLOW_REAL_FISCAL_ISSUANCE=true` num `.env` da máquina. Se o portão
    olhasse só a variável, a suíte passaria a emitir de verdade sem que uma
    única linha de teste mudasse.
  */
  it('permanece bloqueado sob teste MESMO com a variável explicitamente ligada', () => {
    for (const value of ['true', '1', 'yes', 'on', 'TRUE']) {
      process.env.ALLOW_REAL_FISCAL_ISSUANCE = value;
      const decision = realFiscalIssuanceDecision();
      expect(decision.allowed).toBe(false);
      expect(decision.allowed === false && decision.reason).toContain('runner de teste');
    }
  });

  it('lança um erro DISTINTO de falta de credencial', () => {
    delete process.env.ALLOW_REAL_FISCAL_ISSUANCE;
    let caught: unknown;
    try { assertRealFiscalIssuanceAllowed('nfse_nacional'); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(RealFiscalIssuanceBlockedError);
    // A mensagem precisa dizer que é ambiente, não credencial: confundir os
    // dois leva alguém a "resolver" carregando um certificado.
    expect((caught as Error).message).toMatch(/portão de ambiente/i);
    expect((caught as Error).message).not.toMatch(/certificado/i);
  });

  it('não interrompe homologação: o portão só fala do provedor REAL', () => {
    // `assertRealFiscalIssuanceAllowed` só é chamada quando o provedor
    // resolvido é real; o sandbox nunca chega aqui. Esta prova fixa o
    // contrato do nome para que uma refatoração não o generalize por engano.
    expect(assertRealFiscalIssuanceAllowed.length).toBe(1);
  });

  it('o interruptor é de servidor: não existe variável NEXT_PUBLIC equivalente', () => {
    const exposed = Object.keys(process.env)
      .filter((key) => key.startsWith('NEXT_PUBLIC_') && /FISCAL_ISSUANCE/i.test(key));
    expect(exposed).toEqual([]);
  });
});
