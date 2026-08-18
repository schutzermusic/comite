import { NextResponse } from 'next/server';
import { resolvePayrollActor } from '@/lib/payroll/repository/actor';
import { inspectCertificate, extractPemBundle } from '@/lib/esocial/connector/certificate';
import { decryptSecret, hasCertKey } from '@/lib/esocial/connector/secrets';
import { downloadCertificate, getConfig } from '@/lib/esocial/connector/store';
import { esocialErrorResponse } from '@/lib/esocial/connector/api-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Valida o certificado A1 guardado: abre com a senha, confere validade e
 * titular, e verifica que a chave privada está presente e conversível.
 *
 * NÃO testa conexão com o eSocial: no desenho somente-leitura não há chamada a
 * webservice — os dados entram pelo pacote do eSocial Download. O certificado
 * só é relevante se um dia o INSIGHT passar a transmitir.
 */
export async function POST() {
  const r = await resolvePayrollActor('admin.manage_integrations');
  if (!r.ok) return r.response;

  if (!hasCertKey()) {
    return NextResponse.json({ ok: false, error: 'ESOCIAL_CERT_KEY não configurada no servidor.' }, { status: 503 });
  }

  let config;
  try {
    config = await getConfig(r.actor.organizationId);
  } catch (err) {
    return esocialErrorResponse(err, 'Falha ao ler a configuração.');
  }

  if (!config?.cert_storage_path || !config.cert_password_cipher) {
    return NextResponse.json({ ok: false, error: 'Nenhum certificado configurado.' }, { status: 400 });
  }

  try {
    const pfx = await downloadCertificate(config.cert_storage_path);
    const passphrase = decryptSecret(config.cert_password_cipher);
    const info = inspectCertificate(pfx, passphrase);
    // Converter aqui prova que a chave privada existe e é utilizável — é o que
    // diferencia "o arquivo abre" de "o arquivo serve para autenticar".
    extractPemBundle(pfx, passphrase);

    return NextResponse.json({
      ok: !info.expired,
      certificate: {
        subject: info.subject,
        issuer: info.issuer,
        validTo: info.validTo,
        fingerprint: info.fingerprint,
        expired: info.expired,
        expiringSoon: info.expiringSoon,
        holderDocument: info.holderDocument,
      },
      message: info.expired
        ? `Certificado expirado em ${info.validTo.slice(0, 10)}.`
        : info.expiringSoon
          ? `Certificado válido, mas vence em ${info.validTo.slice(0, 10)}.`
          : 'Certificado válido e com chave privada utilizável.',
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Certificado ilegível.' },
      { status: 400 },
    );
  }
}
