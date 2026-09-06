import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import forge from 'node-forge';
import { assertCanonical, buildDpsId, buildDpsXml } from '@/lib/fiscal/provider/nfse-nacional/dps';
import { loadA1Certificate, signDps } from '@/lib/fiscal/provider/nfse-nacional/signature';
import { NfseNacionalProvider } from '@/lib/fiscal/provider/nfse-nacional';
import { FiscalCredentialsRequiredError } from '@/lib/fiscal/provider/errors';
import { FISCAL_PROVIDERS, getFiscalProvider, isRealProvider } from '@/lib/fiscal/provider';
import type { FiscalProviderDocument } from '@/lib/fiscal/provider';

const issuer = {
  cnpj: '11222333000181',
  municipal_registration: 'IM-123',
  legal_name: 'Insight Energia & Serviços S.A.',
  trade_name: 'Insight',
  tax_regime: 'lucro_presumido',
  special_tax_regime: null,
  municipality_ibge: '3550308',
  postal_code: '01001000',
  street: 'Praça da Sé',
  street_number: '100',
  complement: null,
  district: 'Sé',
  uf: 'SP',
};

const recipient = {
  document_type: 'cnpj' as const,
  document_number: '44555666000177',
  legal_name: 'Cliente <Teste> & Cia',
  municipal_registration: null,
  email: 'fiscal@cliente.example',
  municipality_ibge: '3304557',
  postal_code: '20010000',
  street: 'Av. Rio Branco',
  street_number: '1',
  complement: null,
  district: 'Centro',
  uf: 'RJ',
  country_code: 'BR',
};

const service = { lc116_code: '7.02', nbs_code: null, municipal_service_code: '070200', iss_rate: 2, iss_withheld: false };

const document = {
  id: '11111111-1111-4111-8111-111111111111',
  organization_id: '22222222-2222-4222-8222-222222222222',
  establishment_id: '33333333-3333-4333-8333-333333333333',
  environment: 'homologation',
  series: '1',
  competence_date: '2026-08-01',
  service_amount_cents: 1_000_000,
  deductions_cents: 0,
  unconditional_discount_cents: 0,
  conditional_discount_cents: 0,
  service_location_ibge: '3550308',
  description: 'Serviço de engenharia & manutenção <mensal>',
  access_key: null,
} as unknown as FiscalProviderDocument;

/** Certificado autoassinado gerado no teste: nunca há segredo real no repositório. */
function throwawayPfx(password: string, notAfterOffsetDays = 365) {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 86_400_000);
  cert.validity.notAfter = new Date(Date.now() + notAfterOffsetDays * 86_400_000);
  const attrs = [{ name: 'commonName', value: 'INSIGHT TESTE:11222333000181' }, { name: 'countryName', value: 'BR' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, { algorithm: '3des' });
  return Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary');
}

describe('DPS do padrão nacional', () => {
  it('monta o Id no formato exigido', () => {
    const id = buildDpsId({ municipalityIbge: '3550308', cnpj: '11222333000181', series: '1', dpsNumber: 42 });
    expect(id).toBe('DPS35503082'.concat('11222333000181', '00001', '000000000000042'));
    expect(id).toHaveLength(45);
  });

  it('produz XML canônico mesmo com caracteres que exigem escape', () => {
    const { xml } = buildDpsXml({ document, issuer, recipient, service, dpsNumber: 42, issuedAt: new Date('2026-08-14T12:00:00.000Z') });
    expect(() => assertCanonical(xml)).not.toThrow();
    expect(xml).toContain('&amp;');
    expect(xml).toContain('&lt;mensal&gt;');
    expect(xml).not.toContain('<?xml');
    expect(xml).not.toMatch(/>\s+</);
  });

  it('omite o que não foi informado em vez de emitir elemento vazio', () => {
    const { xml } = buildDpsXml({
      document, issuer, dpsNumber: 1, issuedAt: new Date(),
      recipient: { ...recipient, email: null, complement: null },
      service: { ...service, nbs_code: null },
    });
    expect(xml).not.toContain('<email>');
    expect(xml).not.toContain('<cNBS>');
    expect(xml).not.toContain('<xCpl>');
  });

  it('declara homologação quando o documento é de homologação', () => {
    const { xml } = buildDpsXml({ document, issuer, recipient, service, dpsNumber: 1, issuedAt: new Date() });
    expect(xml).toContain('<tpAmb>2</tpAmb>');
    const production = buildDpsXml({
      document: { ...document, environment: 'production' } as FiscalProviderDocument,
      issuer, recipient, service, dpsNumber: 1, issuedAt: new Date(),
    });
    expect(production.xml).toContain('<tpAmb>1</tpAmb>');
  });

  it('recusa XML não canônico em vez de assinar algo que o fisco rejeitaria', () => {
    expect(() => assertCanonical('<DPS xmlns="x"><!-- nota --><infDPS Id="a"></infDPS></DPS>')).toThrow(/comentário/);
    expect(() => assertCanonical('<ns:DPS xmlns:ns="x"></ns:DPS>')).toThrow(/prefixo/);
    expect(() => assertCanonical('<DPS xmlns="x"> <infDPS Id="a"></infDPS> </DPS>')).toThrow(/espaço/);
  });
});

describe('assinatura XMLDSig', () => {
  const password = 'senha-de-teste-123';

  it('abre o PKCS#12 e exige senha', () => {
    const pfx = throwawayPfx(password);
    const certificate = loadA1Certificate(pfx, password);
    expect(certificate.privateKeyPem).toContain('BEGIN RSA PRIVATE KEY');
    expect(certificate.subject).toContain('11222333000181');
    expect(certificate.fingerprint).toMatch(/^[0-9A-F]{40}$/);
    expect(() => loadA1Certificate(pfx, '')).toThrow(/exige senha/);
    expect(() => loadA1Certificate(pfx, 'senha-errada')).toThrow();
  });

  it('envelopa a assinatura referenciando o Id do infDPS, com digest verificável', () => {
    const certificate = loadA1Certificate(throwawayPfx(password), password);
    const { id, xml } = buildDpsXml({ document, issuer, recipient, service, dpsNumber: 7, issuedAt: new Date() });
    const signed = signDps(xml, id, certificate);

    expect(signed).toContain(`<Reference URI="#${id}">`);
    expect(signed).toContain('rsa-sha1');
    expect(signed).toContain('REC-xml-c14n-20010315');
    expect(signed).toContain('enveloped-signature');
    expect(signed).toContain(certificate.certificateDerBase64);
    // A assinatura fica DENTRO do DPS, depois do infDPS: é envelopada.
    expect(signed.indexOf('</infDPS>')).toBeLessThan(signed.indexOf('<Signature'));
    expect(signed.endsWith('</DPS>')).toBe(true);

    // O digest publicado tem que ser o do nó realmente referenciado.
    const referenced = signed.slice(signed.indexOf('<infDPS'), signed.indexOf('</infDPS>') + '</infDPS>'.length)
      .replace('<infDPS Id=', `<infDPS xmlns="http://www.sped.fazenda.gov.br/nfse" Id=`);
    const expected = createHash('sha1').update(Buffer.from(referenced, 'utf8')).digest('base64');
    expect(signed).toContain(`<DigestValue>${expected}</DigestValue>`);
  });
});

describe('portão de credencial do provedor real', () => {
  const context = { organizationId: 'o', establishmentId: 'e', environment: 'homologation' as const, requestId: 'r' };
  const deps = (credentials: Record<string, unknown>) => ({
    credentials, issuer, recipient, service, dpsNumber: 1,
  } as never);

  it('nomeia exatamente o que falta, em vez de tentar e falhar', async () => {
    const provider = new NfseNacionalProvider(deps({ baseUrl: null, certificatePfx: null, certificatePassword: null }));
    await expect(provider.issue(document, context)).rejects.toBeInstanceOf(FiscalCredentialsRequiredError);
    await provider.issue(document, context).catch((error: FiscalCredentialsRequiredError) => {
      expect(error.missing).toContain('endereço do ambiente nacional (base_url da integração)');
      expect(error.missing).toContain('certificado digital A1 (arquivo .pfx da organização)');
      expect(error.missing).toContain('senha do certificado A1');
    });
  });

  it('recusa certificado vencido', async () => {
    const password = 'senha-de-teste-123';
    const provider = new NfseNacionalProvider(deps({
      baseUrl: 'https://exemplo.invalid',
      certificatePfx: throwawayPfx(password, -1),
      certificatePassword: password,
    }));
    await expect(provider.issue(document, context)).rejects.toThrow(/vencido/);
  });

  it('relata a falta pela verificação de saúde, sem inventar disponibilidade', async () => {
    const provider = new NfseNacionalProvider(deps({ baseUrl: null, certificatePfx: null, certificatePassword: null }));
    const health = await provider.health({ organizationId: 'o', establishmentId: 'e', environment: 'homologation' });
    expect(health.ok).toBe(false);
    expect(health.safeMessage).toMatch(/faltam pré-requisitos externos/);
  });

  it('não devolve autorização nenhuma sem falar com o ambiente', async () => {
    const provider = new NfseNacionalProvider(deps({ baseUrl: null, certificatePfx: null, certificatePassword: null }));
    const results = await Promise.allSettled([
      provider.issue(document, context),
      provider.consult(document, context),
      provider.cancel(document, 'motivo suficiente', context),
    ]);
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
  });
});

describe('registro de provedores', () => {
  it('mantém a abstração: sandbox e um adaptador real, nenhum município embutido', () => {
    expect(Object.keys(FISCAL_PROVIDERS).sort()).toEqual(['nfse_nacional', 'sandbox']);
    expect(isRealProvider('sandbox')).toBe(false);
    expect(isRealProvider('nfse_nacional')).toBe(true);
    expect(FISCAL_PROVIDERS.sandbox.environments).not.toContain('production');
  });

  it('recusa construir o provedor real sem dependências resolvidas', () => {
    expect(() => getFiscalProvider({ providerKey: 'nfse_nacional' })).toThrow(/exige credenciais/);
    expect(() => getFiscalProvider({ providerKey: 'prefeitura_x' })).toThrow(/não possui adaptador/);
    expect(getFiscalProvider({ providerKey: 'sandbox' }).key).toBe('sandbox');
  });

  it('publica os pré-requisitos externos do provedor real', () => {
    expect(FISCAL_PROVIDERS.nfse_nacional.requirements.join(' ')).toMatch(/certificado digital ICP-Brasil A1/);
  });
});
