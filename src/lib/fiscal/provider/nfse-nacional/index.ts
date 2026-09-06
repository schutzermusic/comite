/**
 * Adaptador REAL — Sistema Nacional da NFS-e (ambiente de dados nacional).
 *
 * ─── Por que este provedor, e não um de um município ───────────────────────
 *
 * O repositório já apontava para cá antes desta implementação, e não por
 * acaso: o XML do sandbox usa o namespace `http://www.sped.fazenda.gov.br/nfse`,
 * o documento tem `dps_number` e `series`, o catálogo carrega `lc116_code` e
 * `nbs_code`, o estabelecimento guarda `municipality_ibge`, e o serviço já
 * prevê IBS e CBS. Isso é o layout do padrão NACIONAL, não o de uma prefeitura.
 * Implementar um adaptador municipal exigiria refazer esses campos e amarrar o
 * produto a um município — o oposto do que a abstração de provedor existe para
 * evitar.
 *
 * ─── O que este adaptador NÃO faz ──────────────────────────────────────────
 *
 * Não simula. Não devolve autorização que não veio do ambiente. Quando falta
 * certificado, senha, inscrição municipal ou endereço do ambiente, ele lança
 * `FiscalCredentialsRequiredError` — que o worker trata como terminal, sem
 * queimar tentativas contra um problema que nenhuma tentativa resolve.
 *
 * ─── Endereço do ambiente vem de configuração ──────────────────────────────
 *
 * `base_url` é lido de `fiscal_provider_configs`. Nenhuma URL de produção fica
 * gravada no código: o ambiente de homologação e o de produção são endereços
 * distintos, publicados pela administração tributária, e chutar um deles no
 * código seria transformar um erro de digitação em transmissão para o lugar
 * errado. Sem `base_url` configurada, o adaptador para no portão de credencial.
 */
import type { FiscalProvider, FiscalProviderContext, FiscalProviderDocument, FiscalProviderResult } from '../types';
import { FiscalCredentialsRequiredError, FiscalProviderProtocolError } from '../errors';
import { buildDpsXml, type DpsIssuer, type DpsRecipient, type DpsService } from './dps';
import { gunzipBase64, gzipBase64, loadA1Certificate, signDps, type A1Certificate } from './signature';
import { findValue, nfseRequest, parseJson, parseNfseXml, type NfseTransport } from './client';
import { createHash, timingSafeEqual } from 'node:crypto';

export const NFSE_NACIONAL_PROVIDER_KEY = 'nfse_nacional';

/** Tudo que o adaptador precisa e não pode adivinhar. */
export interface NfseNacionalCredentials {
  baseUrl?: string | null;
  certificatePfx?: Buffer | null;
  certificatePassword?: string | null;
  webhookSecret?: string | null;
}

export interface NfseNacionalDeps {
  credentials: NfseNacionalCredentials;
  issuer: DpsIssuer;
  recipient: DpsRecipient;
  service: DpsService;
  /** Número da DPS reservado para este documento, já persistido. */
  dpsNumber: number;
}

/** Caminhos do ambiente nacional, relativos à `base_url` configurada. */
const ROUTES = {
  issue: 'nfse',
  consultByDps: (dpsId: string) => `dps/${encodeURIComponent(dpsId)}`,
  consultByKey: (accessKey: string) => `nfse/${encodeURIComponent(accessKey)}`,
  cancel: (accessKey: string) => `nfse/${encodeURIComponent(accessKey)}/eventos`,
  danfse: (accessKey: string) => `danfse/${encodeURIComponent(accessKey)}`,
} as const;

export class NfseNacionalProvider implements FiscalProvider {
  readonly key = NFSE_NACIONAL_PROVIDER_KEY;

  constructor(private readonly deps: NfseNacionalDeps) {}

  /** Reúne o que falta antes de tentar qualquer chamada. */
  private requireTransport(context: FiscalProviderContext): { transport: NfseTransport; certificate: A1Certificate } {
    const { credentials } = this.deps;
    const missing: string[] = [];
    if (!credentials.baseUrl) missing.push('endereço do ambiente nacional (base_url da integração)');
    if (!credentials.certificatePfx?.length) missing.push('certificado digital A1 (arquivo .pfx da organização)');
    if (!credentials.certificatePassword) missing.push('senha do certificado A1');
    if (!this.deps.issuer.municipal_registration) missing.push('inscrição municipal do estabelecimento emitente');
    if (missing.length) throw new FiscalCredentialsRequiredError(this.key, missing);

    const certificate = loadA1Certificate(credentials.certificatePfx!, credentials.certificatePassword!);
    if (certificate.notAfter.getTime() <= Date.now()) {
      throw new FiscalCredentialsRequiredError(this.key, [
        `certificado A1 vencido em ${certificate.notAfter.toISOString().slice(0, 10)} — instale um certificado válido`,
      ]);
    }
    // O ambiente é decidido pelo contexto do documento, nunca por padrão: um
    // adaptador que caísse em produção "por omissão" seria exatamente o erro
    // que o portão de produção existe para impedir.
    void context;
    return {
      transport: {
        baseUrl: credentials.baseUrl!,
        pfx: credentials.certificatePfx!,
        passphrase: credentials.certificatePassword!,
      },
      certificate,
    };
  }

  async issue(document: FiscalProviderDocument, context: FiscalProviderContext): Promise<FiscalProviderResult> {
    const { transport, certificate } = this.requireTransport(context);
    const { id, xml } = buildDpsXml({
      document,
      issuer: this.deps.issuer,
      recipient: this.deps.recipient,
      service: this.deps.service,
      dpsNumber: this.deps.dpsNumber,
      issuedAt: new Date(),
    });
    const signed = signDps(xml, id, certificate);
    const response = await nfseRequest(transport, 'POST', ROUTES.issue, {
      dpsXmlGZipB64: await gzipBase64(signed),
    });
    return this.interpret(response.status, response.body, { dpsId: id, requestId: context.requestId });
  }

  async consult(document: FiscalProviderDocument, context: FiscalProviderContext): Promise<FiscalProviderResult> {
    const { transport } = this.requireTransport(context);
    const path = document.access_key
      ? ROUTES.consultByKey(document.access_key)
      : ROUTES.consultByDps(
          buildDpsXml({
            document,
            issuer: this.deps.issuer,
            recipient: this.deps.recipient,
            service: this.deps.service,
            dpsNumber: this.deps.dpsNumber,
            issuedAt: new Date(),
          }).id,
        );
    const response = await nfseRequest(transport, 'GET', path);
    if (response.status === 404) {
      // Não encontrada ainda não é rejeição: é processamento em curso.
      return { status: 'processing', safePayload: { httpStatus: 404, requestId: context.requestId } };
    }
    return this.interpret(response.status, response.body, { requestId: context.requestId });
  }

  async cancel(document: FiscalProviderDocument, reason: string, context: FiscalProviderContext): Promise<FiscalProviderResult> {
    const { transport, certificate } = this.requireTransport(context);
    if (!document.access_key) {
      throw new FiscalProviderProtocolError('NFS-e sem chave de acesso não pode ser cancelada no ambiente nacional.');
    }
    // O evento de cancelamento é assinado como a DPS: é ato do emitente.
    const eventXml =
      `<pedRegEvento xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.00">` +
      `<infPedReg Id="PRE${document.access_key}">` +
      `<tpAmb>${document.environment === 'production' ? '1' : '2'}</tpAmb>` +
      `<verAplic>apex-fiscal-1.0</verAplic>` +
      `<dhEvento>${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}</dhEvento>` +
      `<chNFSe>${document.access_key}</chNFSe>` +
      `<e101101><xDesc>${reason.replace(/[<>&]/g, ' ')}</xDesc><cMotivo>1</cMotivo></e101101>` +
      `</infPedReg>` +
      `</pedRegEvento>`;
    const signed = signDps(eventXml.replace('<pedRegEvento', '<DPS').replace('</pedRegEvento>', '</DPS>'), `PRE${document.access_key}`, certificate)
      .replace('<DPS', '<pedRegEvento')
      .replace('</DPS>', '</pedRegEvento>');
    const response = await nfseRequest(transport, 'POST', ROUTES.cancel(document.access_key), {
      pedidoRegistroEventoXmlGZipB64: await gzipBase64(signed),
    });
    const result = await this.interpret(response.status, response.body, { requestId: context.requestId });
    if (result.status === 'authorized') {
      return { ...result, status: 'cancelled', cancelledAt: result.authorizedAt ?? new Date().toISOString() };
    }
    return result;
  }

  async replace(
    _document: FiscalProviderDocument,
    replacement: FiscalProviderDocument,
    context: FiscalProviderContext,
  ): Promise<FiscalProviderResult> {
    // No padrão nacional a substituição é a emissão de uma nova NFS-e que
    // referencia a anterior. Não existe verbo "substituir" separado; o vínculo
    // é do documento, e quem o registra é o Apex.
    return this.issue(replacement, context);
  }

  /** Baixa a DANFSe. Ausência é ausência: devolve `null`, não um PDF em branco. */
  async fetchDanfse(accessKey: string, context: FiscalProviderContext): Promise<Buffer | null> {
    const { transport } = this.requireTransport(context);
    const response = await nfseRequest(transport, 'GET', ROUTES.danfse(accessKey));
    if (response.status === 404) return null;
    if (response.status >= 400) {
      throw new FiscalProviderProtocolError(`DANFSe indisponível (HTTP ${response.status}).`, response.status);
    }
    const json = parseJson(response.body);
    const base64 = json ? findValue(json, ['danfseBase64', 'pdfBase64', 'arquivo', 'conteudo']) : null;
    const buffer = base64 ? Buffer.from(base64, 'base64') : Buffer.from(response.body, 'binary');
    return buffer.subarray(0, 5).toString('utf8').startsWith('%PDF') ? buffer : null;
  }

  verifyWebhook(rawBody: string, signature: string | null, secret?: string): boolean {
    const key = secret ?? this.deps.credentials.webhookSecret ?? undefined;
    if (!key || !signature) return false;
    const actual = Buffer.from(createHash('sha256').update(`${key}:${rawBody}`).digest('hex'));
    const expected = Buffer.from(signature);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  async health(context: Omit<FiscalProviderContext, 'requestId'>): Promise<{ ok: boolean; safeMessage: string }> {
    try {
      const { certificate } = this.requireTransport({ ...context, requestId: 'health' });
      const days = Math.floor((certificate.notAfter.getTime() - Date.now()) / 86_400_000);
      return {
        ok: true,
        safeMessage: `Certificado ${certificate.subject.slice(0, 80)} válido por mais ${days} dia(s).`,
      };
    } catch (error) {
      if (error instanceof FiscalCredentialsRequiredError) {
        return { ok: false, safeMessage: error.message };
      }
      return { ok: false, safeMessage: 'Não foi possível validar a configuração do provedor nacional.' };
    }
  }

  /**
   * Traduz a resposta REAL do ambiente. Cada ramo aqui existe porque o ambiente
   * o produz; nenhum sintetiza um resultado que não veio dele.
   */
  private async interpret(
    httpStatus: number,
    body: string,
    meta: { dpsId?: string; requestId: string },
  ): Promise<FiscalProviderResult> {
    const json = parseJson(body);
    const safePayload: Record<string, unknown> = {
      httpStatus,
      requestId: meta.requestId,
      ...(meta.dpsId ? { dpsId: meta.dpsId } : {}),
    };

    if (httpStatus >= 500 || httpStatus === 429) {
      // Indisponibilidade do ambiente é retentável — e o worker precisa saber
      // disso, senão trata instabilidade como rejeição definitiva.
      throw new FiscalProviderProtocolError(
        `Ambiente nacional indisponível (HTTP ${httpStatus}).`,
        httpStatus,
      );
    }

    if (httpStatus >= 400) {
      const code = json ? findValue(json, ['codigo', 'code', 'codigoErro']) : undefined;
      const message = json ? findValue(json, ['mensagem', 'message', 'descricao', 'detail']) : undefined;
      return {
        status: 'rejected',
        rejectionCode: code ?? `HTTP_${httpStatus}`,
        rejectionMessage: (message ?? body).slice(0, 500),
        safePayload,
      };
    }

    const gzipped = json ? findValue(json, ['nfseXmlGZipB64', 'nfseXmlGzipB64']) : undefined;
    const nfseXml = gzipped ? await gunzipBase64(gzipped) : undefined;
    const parsed = nfseXml ? parseNfseXml(nfseXml) : json;
    if (!parsed) {
      throw new FiscalProviderProtocolError('Resposta do ambiente nacional não pôde ser interpretada.', httpStatus);
    }

    const accessKey = findValue(parsed, ['chaveAcesso', 'chNFSe', 'chave']);
    if (!accessKey) {
      // Sem chave de acesso não há NFS-e. Chamar isso de "autorizado" seria
      // inventar o único dado que prova que a nota existe.
      return { status: 'processing', safePayload };
    }

    return {
      status: 'authorized',
      providerDocumentId: findValue(parsed, ['idNfse', 'idDps', 'id']) ?? accessKey,
      accessKey,
      documentNumber: findValue(parsed, ['nNFSe', 'numero', 'numeroNfse']),
      verificationCode: findValue(parsed, ['codigoVerificacao', 'cVerif']),
      authorizedAt: findValue(parsed, ['dhProc', 'dataEmissao', 'dhEmi']) ?? new Date().toISOString(),
      safePayload,
      artifacts: nfseXml ? { xml: nfseXml } : undefined,
    };
  }
}
