/**
 * PORTÃO DE EMISSÃO FISCAL REAL — fecha por padrão.
 *
 * ─── O que aconteceu, e o que NÃO aconteceu ──────────────────────────────
 *
 * Uma rodada da suíte viva deixou 17 documentos fiscais no banco. O
 * inventário (`scripts/commercial/fiscal-fixture-inventory.mjs`) mostra o que
 * eles são: ambiente `homologation`, provedor `sandbox`, sem
 * `provider_document_id` e sem chave de acesso. Nenhuma NFS-e real foi
 * emitida, e nada saiu desta máquina.
 *
 * O problema não é o que houve — é o que NÃO impediu. A única coisa entre
 * aquela suíte e uma transmissão real era a ausência de credencial no
 * ambiente. Num ambiente de desenvolvimento onde alguém já tenha configurado
 * `FISCAL_CERT_KEY` e uma integração habilitada para experimentar, o MESMO
 * caminho de teste transmitiria de verdade. "Não tínhamos a senha" não é um
 * controle: é sorte.
 *
 * ─── O contrato deste portão ─────────────────────────────────────────────
 *
 *   • O padrão é NÃO EMITIR. Variável ausente, vazia ou com qualquer valor
 *     que não seja um "sim" explícito resolve para bloqueado.
 *   • É de SERVIDOR. A variável não tem prefixo `NEXT_PUBLIC_`, de propósito:
 *     um interruptor de segurança que chega ao navegador é um interruptor que
 *     o navegador pode ler, e um dia mexer.
 *   • Sob TESTE, ele é inalcançável. Nem definindo a variável: quando o
 *     processo é um runner de teste, a função devolve bloqueado antes de
 *     olhar a configuração. Um `.env` esquecido numa máquina não pode virar
 *     nota fiscal.
 *   • Ele NÃO substitui os portões que já existem — produção habilitada no
 *     estabelecimento, certificado, inscrição municipal. Ele vem ANTES de
 *     todos, e por isso não depende de nenhum deles estar correto.
 *
 * ─── O que ele não é ─────────────────────────────────────────────────────
 *
 * Não é o módulo Fiscal, não muda a máquina de estados fiscal e não toca no
 * sandbox. Homologação continua funcionando inteira — é justamente assim que
 * a plataforma prova o caminho fiscal sem emitir nada.
 */
if (typeof window !== 'undefined') {
  throw new Error('issuance-guard.ts não pode ser importado no navegador');
}

/** Só um "sim" explícito libera. Qualquer outra coisa é `false`. */
function envEnabled(raw: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test((raw ?? '').trim());
}

/**
 * Verdadeiro quando o processo é um runner de teste.
 *
 * `VITEST` e `PLAYWRIGHT_TEST_BASE_URL` são postos pelos próprios runners;
 * `NODE_ENV === 'test'` cobre o restante. Nenhum deles é configurável por
 * quem escreve o teste sem ser evidente no diff.
 */
export function isTestRuntime(): boolean {
  return process.env.NODE_ENV === 'test'
    || Boolean(process.env.VITEST)
    || Boolean(process.env.VITEST_WORKER_ID)
    || Boolean(process.env.PLAYWRIGHT_TEST_BASE_URL);
}

export type FiscalIssuanceDecision =
  | { allowed: true }
  | { allowed: false; reason: string };

/**
 * A emissão REAL está liberada neste processo?
 *
 * Responde sobre o PROCESSO, não sobre o documento. A decisão por documento
 * (ambiente, estabelecimento, credencial) continua onde sempre esteve.
 */
export function realFiscalIssuanceDecision(): FiscalIssuanceDecision {
  if (isTestRuntime()) {
    return {
      allowed: false,
      reason: 'o processo é um runner de teste — emissão fiscal real é inalcançável aqui, '
        + 'mesmo com ALLOW_REAL_FISCAL_ISSUANCE definida',
    };
  }
  if (!envEnabled(process.env.ALLOW_REAL_FISCAL_ISSUANCE)) {
    return {
      allowed: false,
      reason: 'ALLOW_REAL_FISCAL_ISSUANCE não está explicitamente ligada no servidor '
        + '(padrão: emissão real bloqueada)',
    };
  }
  return { allowed: true };
}

export function isRealFiscalIssuanceAllowed(): boolean {
  return realFiscalIssuanceDecision().allowed;
}

/**
 * Bloqueio de emissão real.
 *
 * Separado de `FiscalCredentialsRequiredError` porque diz outra coisa: não
 * falta credencial — falta AUTORIZAÇÃO DE AMBIENTE. Tratar os dois como o
 * mesmo erro levaria alguém a "resolver" isto carregando um certificado.
 */
export class RealFiscalIssuanceBlockedError extends Error {
  readonly reason: string;
  readonly providerKey: string;

  constructor(providerKey: string, reason: string) {
    super(
      `Emissão fiscal REAL bloqueada pelo portão de ambiente: ${reason}. `
      + `Provedor "${providerKey}" não será acionado. `
      + 'Homologação e sandbox seguem disponíveis.',
    );
    this.name = 'RealFiscalIssuanceBlockedError';
    this.reason = reason;
    this.providerKey = providerKey;
  }
}

/**
 * Lança quando o provedor resolvido é real e o processo não está autorizado.
 * Chamada ANTES de qualquer leitura de segredo ou construção de adaptador.
 */
export function assertRealFiscalIssuanceAllowed(providerKey: string): void {
  const decision = realFiscalIssuanceDecision();
  if (!decision.allowed) {
    throw new RealFiscalIssuanceBlockedError(providerKey, decision.reason);
  }
}
