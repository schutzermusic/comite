/**
 * Assinatura XMLDSig da DPS com certificado ICP-Brasil A1.
 *
 * Perfil exigido pelo padrão nacional da NFS-e (o mesmo da NF-e):
 *   · assinatura ENVELOPADA, referenciando o `Id` do `infDPS`;
 *   · transformações: enveloped-signature seguida de Canonical XML 1.0;
 *   · digest SHA-1, assinatura RSA-SHA1;
 *   · `KeyInfo` com o certificado do assinante em X509Certificate.
 *
 * SHA-1 aqui não é escolha: é o perfil que o validador do fisco aceita. Trocar
 * por SHA-256 produz documento recusado, então a decisão é dele, não nossa.
 *
 * A C14N das transformações é atendida por construção — ver `dps.ts`. Os dois
 * nós que esta função serializa (`SignedInfo` e o próprio `Signature`) seguem a
 * mesma disciplina: namespace padrão único, sem prefixo, sem espaço.
 */
import { createSign, createHash } from 'node:crypto';
import forge from 'node-forge';

const DSIG_NS = 'http://www.w3.org/2000/09/xmldsig#';

export interface A1Certificate {
  /** PEM da chave privada, para `createSign`. */
  privateKeyPem: string;
  /** DER do certificado em base64, para `X509Certificate`. */
  certificateDerBase64: string;
  subject: string;
  notAfter: Date;
  /** SHA-1 do DER, em maiúsculas — o mesmo formato mostrado pelos leitores. */
  fingerprint: string;
}

/**
 * Abre o `.pfx`/`.p12` do certificado A1. A senha é obrigatória: PKCS#12 sem
 * senha é arquivo aberto, e aceitar isso seria convidar a guardá-lo assim.
 */
export function loadA1Certificate(pfx: Buffer, password: string): A1Certificate {
  if (!password) throw new Error('Certificado A1 exige senha.');
  const asn1 = forge.asn1.fromDer(forge.util.createBuffer(pfx.toString('binary')));
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, password);

  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag]
    ?? p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag];
  const privateKey = keyBags?.[0]?.key;
  if (!privateKey) throw new Error('Certificado A1 não contém chave privada legível.');

  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
  // O certificado do titular é o que casa com a chave privada; o resto do saco é
  // cadeia (AC intermediária, raiz). Assinar com a chave do titular e anunciar o
  // certificado da AC produz documento recusado, então a escolha é pelo módulo
  // RSA, não pela posição no arquivo.
  const rsaKey = privateKey as forge.pki.rsa.PrivateKey;
  const cert = certBags
    .map((bag) => bag.cert)
    .find((candidate): candidate is forge.pki.Certificate => {
      const publicKey = candidate?.publicKey as forge.pki.rsa.PublicKey | undefined;
      return Boolean(publicKey?.n && publicKey.n.compareTo(rsaKey.n) === 0);
    });
  if (!cert) throw new Error('Certificado A1 não contém o certificado correspondente à chave privada.');

  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  const derBuffer = Buffer.from(der, 'binary');

  return {
    privateKeyPem: forge.pki.privateKeyToPem(privateKey as forge.pki.rsa.PrivateKey),
    certificateDerBase64: derBuffer.toString('base64'),
    subject: cert.subject.attributes.map((a) => `${a.shortName ?? a.name}=${a.value}`).join(', '),
    notAfter: cert.validity.notAfter,
    fingerprint: createHash('sha1').update(derBuffer).digest('hex').toUpperCase(),
  };
}

/**
 * Assina a DPS. `xml` deve ser exatamente o produzido por `buildDpsXml`, e
 * `referenceId` o `Id` do `infDPS`.
 */
export function signDps(xml: string, referenceId: string, certificate: A1Certificate): string {
  const open = `<infDPS Id="${referenceId}">`;
  const start = xml.indexOf(open);
  const end = xml.lastIndexOf('</infDPS>');
  if (start < 0 || end < 0) throw new Error('DPS sem elemento infDPS assinável.');

  // O nó referenciado, já canônico, herdando o namespace padrão da raiz — que é
  // como o validador o verá após aplicar enveloped-signature + C14N.
  const referenced = `${xml.slice(start, end + '</infDPS>'.length)}`
    .replace(open, `<infDPS xmlns="${extractDefaultNamespace(xml)}" Id="${referenceId}">`);
  const digest = createHash('sha1').update(Buffer.from(referenced, 'utf8')).digest('base64');

  const signedInfo =
    `<SignedInfo xmlns="${DSIG_NS}">` +
    '<CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"></CanonicalizationMethod>' +
    '<SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"></SignatureMethod>' +
    `<Reference URI="#${referenceId}">` +
    '<Transforms>' +
    '<Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"></Transform>' +
    '<Transform Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"></Transform>' +
    '</Transforms>' +
    '<DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"></DigestMethod>' +
    `<DigestValue>${digest}</DigestValue>` +
    '</Reference>' +
    '</SignedInfo>';

  const signer = createSign('RSA-SHA1');
  signer.update(Buffer.from(signedInfo, 'utf8'));
  const signatureValue = signer.sign(certificate.privateKeyPem, 'base64');

  const signature =
    `<Signature xmlns="${DSIG_NS}">` +
    signedInfo.replace(` xmlns="${DSIG_NS}"`, '') +
    `<SignatureValue>${signatureValue}</SignatureValue>` +
    `<KeyInfo><X509Data><X509Certificate>${certificate.certificateDerBase64}</X509Certificate></X509Data></KeyInfo>` +
    '</Signature>';

  return `${xml.slice(0, end + '</infDPS>'.length)}${signature}${xml.slice(end + '</infDPS>'.length)}`;
}

function extractDefaultNamespace(xml: string): string {
  const match = /<DPS[^>]*\sxmlns="([^"]+)"/.exec(xml);
  if (!match) throw new Error('DPS sem namespace padrão declarado.');
  return match[1];
}

/** Compactação exigida pelo envio ao ambiente nacional: gzip + base64. */
export function gzipBase64(value: string): Promise<string> {
  return new Promise((resolve, reject) => {
    import('node:zlib').then(({ gzip }) => {
      gzip(Buffer.from(value, 'utf8'), (error, result) => {
        if (error) reject(error);
        else resolve(result.toString('base64'));
      });
    }, reject);
  });
}

export function gunzipBase64(value: string): Promise<string> {
  return new Promise((resolve, reject) => {
    import('node:zlib').then(({ gunzip }) => {
      gunzip(Buffer.from(value, 'base64'), (error, result) => {
        if (error) reject(error);
        else resolve(result.toString('utf8'));
      });
    }, reject);
  });
}
