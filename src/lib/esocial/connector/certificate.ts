/**
 * Certificado digital A1 (.pfx / .p12) do empregador.
 *
 * O arquivo é lido do bucket privado e mantido apenas em memória, pelo tempo da
 * requisição. Nada de gravar em disco: em runtime serverless o disco é
 * compartilhado e efêmero, e um .pfx em /tmp é um segredo à espera de vazar.
 */
import forge from 'node-forge';

if (typeof window !== 'undefined') {
  throw new Error('src/lib/esocial/connector/certificate.ts não pode ser importado no browser');
}

export interface CertificateInfo {
  subject: string;
  issuer: string;
  validFrom: string;
  validTo: string;
  /** SHA-1 do DER, no formato usual de impressão digital. */
  fingerprint: string;
  /** CNPJ/CPF extraído do subject (OID 2.16.76.1.3.3 do ICP-Brasil), quando presente. */
  holderDocument?: string;
  expired: boolean;
  /** Vence em 30 dias ou menos. */
  expiringSoon: boolean;
}

function openPkcs12(pfx: Buffer, password: string): forge.pkcs12.Pkcs12Pfx {
  try {
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(pfx.toString('binary')));
    return forge.pkcs12.pkcs12FromAsn1(asn1, password);
  } catch {
    throw new Error(
      'Não foi possível abrir o certificado. Verifique se o arquivo é um .pfx/.p12 válido e se a senha está correta.',
    );
  }
}

function certificatesOf(p12: forge.pkcs12.Pkcs12Pfx): forge.pki.Certificate[] {
  const bags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
  return bags.map((b) => b.cert).filter((c): c is forge.pki.Certificate => Boolean(c));
}

/**
 * Credenciais mTLS em PEM.
 *
 * O Node NÃO recebe o .pfx. Muitos A1 brasileiros são gerados com algoritmos
 * que o OpenSSL 3 empurrou para o provider legacy (RC2-40-CBC, 3DES com MAC
 * SHA-1), e aí `tls` recusa com "Unsupported PKCS12 PFX data" — mesmo com o
 * arquivo e a senha corretos. O node-forge decifra em JS puro, sem essa
 * restrição, e entregamos ao Node só PEM padrão.
 */
export interface PemBundle {
  key: string;
  cert: string;
  /** Intermediárias da cadeia, quando o .pfx as traz. */
  ca: string[];
}

export function extractPemBundle(pfx: Buffer, password: string): PemBundle {
  const p12 = openPkcs12(pfx, password);

  const keyBags = {
    ...p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag }),
    ...p12.getBags({ bagType: forge.pki.oids.keyBag }),
  };
  // O tipo de `bag.key` no forge cobre também chaves em formato bruto; aqui só
  // interessa a chave RSA já parseada, que é a que vira PEM.
  const privateKey = Object.values(keyBags)
    .flat()
    .map((b) => b?.key as forge.pki.rsa.PrivateKey | undefined)
    .find((k): k is forge.pki.rsa.PrivateKey => Boolean(k?.n));

  if (!privateKey) {
    throw new Error(
      'O certificado não contém a chave privada. Exporte o A1 incluindo a chave (.pfx/.p12 completo).',
    );
  }

  const certs = certificatesOf(p12);
  if (certs.length === 0) throw new Error('O arquivo não contém um certificado utilizável.');

  // A folha é o certificado cuja chave pública casa com a privada; o resto é
  // cadeia. Sem essa checagem, um .pfx com intermediárias pode entregar a CA
  // como se fosse o certificado do titular.
  const leaf =
    certs.find((c) => {
      const pub = c.publicKey as forge.pki.rsa.PublicKey | undefined;
      return pub?.n !== undefined && pub.n.compareTo(privateKey.n) === 0;
    }) ?? certs[0];

  return {
    key: forge.pki.privateKeyToPem(privateKey),
    cert: forge.pki.certificateToPem(leaf),
    ca: certs.filter((c) => c !== leaf).map((c) => forge.pki.certificateToPem(c)),
  };
}

/**
 * Abre o .pfx e extrai os metadados. Também é a validação de senha: uma senha
 * errada falha aqui, antes de qualquer chamada de rede ao eSocial.
 */
export function inspectCertificate(pfx: Buffer, password: string): CertificateInfo {
  const p12 = openPkcs12(pfx, password);
  const cert = certificatesOf(p12)[0];
  if (!cert) throw new Error('O arquivo não contém um certificado utilizável.');

  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  const fingerprint = forge.md.sha1
    .create()
    .update(der)
    .digest()
    .toHex()
    .toUpperCase()
    .replace(/(.{2})(?=.)/g, '$1:');

  const now = Date.now();
  const validTo = cert.validity.notAfter;
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;

  return {
    subject: cert.subject.attributes.map((a) => `${a.shortName ?? a.name}=${a.value}`).join(', '),
    issuer: cert.issuer.attributes.map((a) => `${a.shortName ?? a.name}=${a.value}`).join(', '),
    validFrom: cert.validity.notBefore.toISOString(),
    validTo: validTo.toISOString(),
    fingerprint,
    holderDocument: extractHolderDocument(cert),
    expired: validTo.getTime() < now,
    expiringSoon: validTo.getTime() - now < thirtyDays,
  };
}

/**
 * OID ICP-Brasil que carrega o CNPJ da pessoa jurídica titular, gravado numa
 * `otherName` da subjectAltName. Serve para conferir se o certificado enviado
 * pertence mesmo ao CNPJ configurado — erro comum e caro de diagnosticar depois,
 * porque o eSocial apenas recusa o handshake sem dizer o motivo.
 */
const OID_CNPJ = '2.16.76.1.3.3';

export interface AltName {
  type?: number;
  value?: unknown;
}

/**
 * Colhe as folhas de texto de uma estrutura ASN.1 já parseada pelo forge.
 *
 * Num `otherName`, `value` não é string: é um array de nós ASN.1 aninhados. Foi
 * o que fazia `value.replace` explodir — e só aparece em certificado ICP-Brasil
 * de verdade, porque um certificado sem SAN nunca chega aqui.
 */
function textLeaves(node: unknown, depth = 0): string[] {
  if (depth > 8) return [];
  if (typeof node === 'string') return [node];
  if (node === null || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap((n) => textLeaves(n, depth + 1));
  return Object.values(node as Record<string, unknown>).flatMap((n) => textLeaves(n, depth + 1));
}

/**
 * CNPJ do titular a partir dos altNames já parseados. Exportado para teste: foi
 * exatamente aqui que `value.replace is not a function` apareceu, porque um
 * `otherName` traz nós ASN.1 no lugar de texto.
 */
export function holderDocumentFromAltNames(
  altNames: AltName[],
  commonName?: string,
): string | undefined {
  try {
    for (const alt of altNames) {
      // type 0 = otherName, onde o ICP-Brasil grava CNPJ e CPF sob OIDs distintos.
      if (alt.type !== 0 || !Array.isArray(alt.value)) continue;

      const [oidNode, ...rest] = alt.value as { type?: number; value?: unknown }[];
      let oid: string | undefined;
      try {
        if (typeof oidNode?.value === 'string') oid = forge.asn1.derToOid(oidNode.value);
      } catch {
        oid = undefined;
      }
      // Sem o OID certo não dá para saber se os dígitos são CNPJ ou CPF —
      // o OID 2.16.76.1.3.1 concatena data de nascimento, CPF, PIS e RG.
      if (oid !== OID_CNPJ) continue;

      const digits = textLeaves(rest).join('').replace(/\D/g, '');
      if (digits.length >= 14) return digits.slice(-14);
    }

    // SAN em texto simples (alguns emissores) — aceita 14 dígitos seguidos.
    for (const alt of altNames) {
      if (typeof alt.value !== 'string') continue;
      const match = alt.value.replace(/\D/g, '').match(/\d{14}$/);
      if (match) return match[0];
    }

    // Sem SAN utilizável, alguns emissores põem o CNPJ no próprio CN.
    return commonName?.match(/(\d{14})/)?.[1];
  } catch {
    return undefined;
  }
}

/**
 * Conferir o titular é cortesia de diagnóstico, não requisito: um certificado
 * com SAN fora do esperado não pode impedir a configuração do conector.
 */
function extractHolderDocument(cert: forge.pki.Certificate): string | undefined {
  const ext = cert.extensions.find((e) => e.name === 'subjectAltName' || e.id === '2.5.29.17');
  const altNames = (ext as { altNames?: AltName[] } | undefined)?.altNames ?? [];
  const cn = cert.subject.getField('CN')?.value as string | undefined;
  return holderDocumentFromAltNames(altNames, cn);
}
