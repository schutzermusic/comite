/**
 * Transporte para o ambiente nacional da NFS-e.
 *
 * O ambiente exige TLS mútuo: o mesmo certificado A1 que assina a DPS
 * autentica a conexão. Por isso a chamada não usa `fetch` — precisa de um
 * `https.Agent` com o PKCS#12 carregado, e o `fetch` do Node não expõe agente.
 *
 * Nada aqui inventa resposta. Se o ambiente não responder, a falha sobe como
 * falha; se responder com corpo que não sabemos ler, sobe como erro de
 * protocolo. Um provedor de verdade que finge sucesso é pior que nenhum.
 */
import { request as httpsRequest, type RequestOptions } from 'node:https';
import { XMLParser } from 'fast-xml-parser';

export interface NfseHttpResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  durationMs: number;
}

export interface NfseTransport {
  baseUrl: string;
  pfx: Buffer;
  passphrase: string;
  timeoutMs?: number;
}

export async function nfseRequest(
  transport: NfseTransport,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<NfseHttpResponse> {
  const url = new URL(path.replace(/^\//, ''), transport.baseUrl.endsWith('/') ? transport.baseUrl : `${transport.baseUrl}/`);
  const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body), 'utf8');
  const started = Date.now();

  const options: RequestOptions = {
    method,
    hostname: url.hostname,
    port: url.port || 443,
    path: `${url.pathname}${url.search}`,
    pfx: transport.pfx,
    passphrase: transport.passphrase,
    // O ambiente nacional usa cadeia ICP-Brasil. Manter a verificação ligada é
    // o ponto: desligá-la transformaria TLS mútuo em teatro.
    rejectUnauthorized: true,
    timeout: transport.timeoutMs ?? 30_000,
    headers: {
      accept: 'application/json',
      'user-agent': 'Apex-Fiscal/1.0',
      ...(payload ? { 'content-type': 'application/json', 'content-length': String(payload.byteLength) } : {}),
    },
  };

  return new Promise<NfseHttpResponse>((resolve, reject) => {
    const req = httpsRequest(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () =>
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
          durationMs: Date.now() - started,
        }),
      );
    });
    req.on('timeout', () => req.destroy(new Error('Tempo esgotado ao falar com o ambiente nacional da NFS-e.')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** Interpreta o corpo como JSON quando possível; devolve `null` quando não é. */
export function parseJson(body: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(body);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: false });

/** Lê o XML da NFS-e devolvido pelo ambiente para extrair identificadores. */
export function parseNfseXml(xml: string): Record<string, unknown> {
  return xmlParser.parse(xml) as Record<string, unknown>;
}

/** Busca em profundidade a primeira chave com um dos nomes dados. */
export function findValue(source: unknown, names: readonly string[]): string | undefined {
  const wanted = names.map((name) => name.toLowerCase());
  const stack: unknown[] = [source];
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== 'object') continue;
    for (const [key, value] of Object.entries(current)) {
      if (wanted.includes(key.toLowerCase().replace(/^@_/, '')) && (typeof value === 'string' || typeof value === 'number')) {
        return String(value);
      }
      if (value && typeof value === 'object') stack.push(value);
    }
  }
  return undefined;
}
