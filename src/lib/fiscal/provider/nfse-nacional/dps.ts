/**
 * DPS — Declaração de Prestação de Serviços do padrão nacional da NFS-e.
 *
 * O emissor não escreve a NFS-e: ele declara a prestação, e o Sistema Nacional
 * devolve a nota. O que este arquivo monta é essa declaração, no layout do
 * namespace `http://www.sped.fazenda.gov.br/nfse`.
 *
 * ─── Canônico por construção ───────────────────────────────────────────────
 *
 * A assinatura XMLDSig exige o documento em Canonical XML 1.0. Em vez de
 * carregar um transformador de C14N, o XML é EMITIDO já canônico — e isso é
 * seguro porque nós o geramos inteiro, do zero:
 *
 *   · um único namespace, declarado como padrão na raiz, sem prefixos;
 *   · nenhum comentário, nenhuma instrução de processamento, nenhum CDATA;
 *   · nenhum atributo além de `Id` e `xmlns`, portanto nada a ordenar;
 *   · nenhum espaço entre elementos;
 *   · escape canônico (`&`, `<`, `>` no texto; `&`, `<`, `"` em atributo);
 *   · UTF-8, sem declaração XML dentro do elemento assinado.
 *
 * `assertCanonical` confere essas premissas antes de assinar. Se um dia alguém
 * acrescentar um prefixo ou um comentário aqui, a asserção falha em vez de
 * produzir uma assinatura que o fisco recusaria sem explicar por quê.
 */
import type { FiscalProviderDocument } from '../types';

export const NFSE_NAMESPACE = 'http://www.sped.fazenda.gov.br/nfse';

/** Escape canônico de conteúdo textual (C14N não escapa `'` nem `"` em texto). */
function text(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r/g, '&#xD;');
}

/** Escape canônico de valor de atributo. */
function attr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;')
    .replace(/\t/g, '&#x9;')
    .replace(/\n/g, '&#xA;')
    .replace(/\r/g, '&#xD;');
}

/** Elemento simples. `undefined`/`null`/`''` some do documento em vez de virar vazio. */
function el(name: string, value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  return `<${name}>${text(value)}</${name}>`;
}

function group(name: string, children: string): string {
  return children ? `<${name}>${children}</${name}>` : '';
}

const digits = (value: unknown) => String(value ?? '').replace(/\D/g, '');
const money = (cents: number) => (cents / 100).toFixed(2);

export interface DpsIssuer {
  cnpj: string;
  municipal_registration: string;
  legal_name: string;
  trade_name?: string | null;
  tax_regime: string;
  special_tax_regime?: string | null;
  municipality_ibge: string;
  postal_code: string;
  street: string;
  street_number: string;
  complement?: string | null;
  district: string;
  uf: string;
}

export interface DpsRecipient {
  document_type: 'cpf' | 'cnpj' | 'foreign';
  document_number: string;
  legal_name: string;
  municipal_registration?: string | null;
  email?: string | null;
  municipality_ibge?: string | null;
  postal_code?: string | null;
  street?: string | null;
  street_number?: string | null;
  complement?: string | null;
  district?: string | null;
  uf?: string | null;
  country_code?: string | null;
}

export interface DpsService {
  lc116_code: string;
  nbs_code?: string | null;
  municipal_service_code: string;
  iss_rate: number;
  iss_withheld: boolean;
}

export interface BuildDpsInput {
  document: FiscalProviderDocument;
  issuer: DpsIssuer;
  recipient: DpsRecipient;
  service: DpsService;
  dpsNumber: number;
  issuedAt: Date;
}

/**
 * Id da DPS, conforme o padrão nacional:
 *   "DPS" + município emissor (7) + tipo de inscrição (1) + inscrição (14) +
 *   série (5) + número da DPS (15)
 * Tipo de inscrição: 1 = CPF, 2 = CNPJ.
 */
export function buildDpsId(input: { municipalityIbge: string; cnpj: string; series: string; dpsNumber: number }): string {
  const municipality = digits(input.municipalityIbge).padStart(7, '0');
  const registration = digits(input.cnpj);
  const kind = registration.length === 11 ? '1' : '2';
  return [
    'DPS',
    municipality,
    kind,
    registration.padStart(14, '0'),
    digits(input.series).padStart(5, '0'),
    String(input.dpsNumber).padStart(15, '0'),
  ].join('');
}

/** Tipo de inscrição do tomador no layout nacional. */
function recipientIdentification(recipient: DpsRecipient): string {
  if (recipient.document_type === 'cnpj') return el('CNPJ', digits(recipient.document_number).padStart(14, '0'));
  if (recipient.document_type === 'cpf') return el('CPF', digits(recipient.document_number).padStart(11, '0'));
  return el('NIF', recipient.document_number);
}

export function buildDpsXml(input: BuildDpsInput): { id: string; xml: string } {
  const { document, issuer, recipient, service, dpsNumber, issuedAt } = input;
  const id = buildDpsId({
    municipalityIbge: issuer.municipality_ibge,
    cnpj: issuer.cnpj,
    series: document.series,
    dpsNumber,
  });

  const taxBase =
    document.service_amount_cents - document.deductions_cents - document.unconditional_discount_cents;

  const issuerBlock = group(
    'prest',
    el('CNPJ', digits(issuer.cnpj).padStart(14, '0')) +
      el('IM', issuer.municipal_registration) +
      el('xNome', issuer.legal_name) +
      group(
        'end',
        el('xLgr', issuer.street) +
          el('nro', issuer.street_number) +
          el('xCpl', issuer.complement) +
          el('xBairro', issuer.district) +
          el('cMun', digits(issuer.municipality_ibge)) +
          el('UF', issuer.uf) +
          el('CEP', digits(issuer.postal_code)),
      ) +
      group('regTrib', el('opSimpNac', issuer.tax_regime === 'simples_nacional' ? '2' : '1') +
        el('regEspTrib', issuer.special_tax_regime)),
  );

  const recipientAddress =
    recipient.municipality_ibge || recipient.street
      ? group(
          'end',
          el('xLgr', recipient.street) +
            el('nro', recipient.street_number) +
            el('xCpl', recipient.complement) +
            el('xBairro', recipient.district) +
            el('cMun', digits(recipient.municipality_ibge)) +
            el('UF', recipient.uf) +
            el('CEP', digits(recipient.postal_code)),
        )
      : '';

  const recipientBlock = group(
    'toma',
    recipientIdentification(recipient) +
      el('IM', recipient.municipal_registration) +
      el('xNome', recipient.legal_name) +
      recipientAddress +
      el('email', recipient.email),
  );

  const serviceBlock = group(
    'serv',
    group(
      'locPrest',
      el('cLocPrestacao', digits(document.service_location_ibge)),
    ) +
      group(
        'cServ',
        el('cTribNac', digits(service.lc116_code)) +
          el('cTribMun', service.municipal_service_code) +
          el('xDescServ', document.description) +
          el('cNBS', service.nbs_code),
      ),
  );

  const valuesBlock = group(
    'valores',
    group(
      'vServPrest',
      el('vServ', money(document.service_amount_cents)),
    ) +
      group(
        'vDescCondIncond',
        el('vDescIncond', money(document.unconditional_discount_cents)) +
          el('vDescCond', money(document.conditional_discount_cents)),
      ) +
      group(
        'trib',
        group(
          'tribMun',
          el('tribISSQN', '1') +
            el('vBC', money(Math.max(0, taxBase))) +
            el('pAliq', service.iss_rate.toFixed(4)) +
            el('tpRetISSQN', service.iss_withheld ? '2' : '1'),
        ) +
          group('totTrib', el('indTotTrib', '0')),
      ),
  );

  const infDps =
    el('tpAmb', document.environment === 'production' ? '1' : '2') +
    el('dhEmi', issuedAt.toISOString().replace(/\.\d{3}Z$/, 'Z')) +
    el('verAplic', 'apex-fiscal-1.0') +
    el('serie', document.series) +
    el('nDPS', String(dpsNumber)) +
    el('dCompet', document.competence_date) +
    el('tpEmit', '1') +
    el('cLocEmi', digits(issuer.municipality_ibge)) +
    issuerBlock +
    recipientBlock +
    serviceBlock +
    valuesBlock;

  const xml = `<DPS xmlns="${attr(NFSE_NAMESPACE)}" versao="1.00"><infDPS Id="${attr(id)}">${infDps}</infDPS></DPS>`;
  assertCanonical(xml);
  return { id, xml };
}

/**
 * Confere as premissas que tornam a serialização acima equivalente à sua forma
 * canônica. Falhar aqui é muito melhor que assinar um documento cujo digest o
 * validador do fisco calcularia diferente.
 */
export function assertCanonical(xml: string): void {
  const problems: string[] = [];
  if (xml.includes('<?')) problems.push('instrução de processamento ou declaração XML');
  if (xml.includes('<!--')) problems.push('comentário');
  if (xml.includes('<![CDATA[')) problems.push('seção CDATA');
  if (/<\/?[A-Za-z_][\w.-]*:/.test(xml)) problems.push('prefixo de namespace');
  if (/>\s+</.test(xml)) problems.push('espaço em branco entre elementos');
  if (/<[A-Za-z][^>]*\/>/.test(xml)) problems.push('elemento vazio abreviado (`<x/>`)');
  if (problems.length) {
    throw new Error(`DPS não está em forma canônica — ${problems.join(', ')}. A assinatura seria inválida.`);
  }
}
