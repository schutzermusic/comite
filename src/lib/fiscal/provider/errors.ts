/**
 * Falta de credencial não é falha de transmissão.
 *
 * O adaptador real precisa de certificado A1, senha, inscrição municipal ativa
 * e endereço do ambiente. Quando falta qualquer um deles, a resposta certa não
 * é tentar, falhar e reagendar seis vezes com backoff — é parar e dizer o que
 * falta. Por isso este erro é separado: o worker o trata como terminal e não
 * queima tentativas contra um problema que nenhuma tentativa resolve.
 */
export class FiscalCredentialsRequiredError extends Error {
  readonly missing: readonly string[];

  constructor(providerKey: string, missing: readonly string[]) {
    super(
      `O provedor fiscal "${providerKey}" não pode transmitir: faltam pré-requisitos externos — ${missing.join('; ')}.`,
    );
    this.name = 'FiscalCredentialsRequiredError';
    this.missing = missing;
  }
}

/** Resposta recebida do provedor que não pôde ser interpretada com segurança. */
export class FiscalProviderProtocolError extends Error {
  readonly httpStatus?: number;

  constructor(message: string, httpStatus?: number) {
    super(message);
    this.name = 'FiscalProviderProtocolError';
    this.httpStatus = httpStatus;
  }
}
