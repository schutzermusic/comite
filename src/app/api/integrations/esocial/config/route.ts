import { NextResponse } from 'next/server';
import { resolvePayrollActor } from '@/lib/payroll/repository/actor';
import { inspectCertificate } from '@/lib/esocial/connector/certificate';
import { encryptSecret, hasCertKey } from '@/lib/esocial/connector/secrets';
import {
  getConfig,
  listRecentRuns,
  removeCertificate,
  uploadCertificate,
  upsertConfig,
} from '@/lib/esocial/connector/store';
import { DEFAULT_ENDPOINTS, INGESTED_EVENT_TYPES } from '@/lib/esocial/connector/endpoints';
import { esocialErrorResponse } from '@/lib/esocial/connector/api-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_CERT_BYTES = 1_048_576; // 1 MB — um A1 tem alguns KB.

/**
 * Configuração do conector eSocial.
 *
 * GET  — estado atual (nunca devolve senha nem o certificado, só metadados).
 * POST — grava inscrição, ambiente, agendamento e, opcionalmente, o novo A1.
 *
 * O certificado sobe como multipart; a senha é cifrada antes de tocar o banco.
 */
export async function GET() {
  const r = await resolvePayrollActor('admin.manage_integrations');
  if (!r.ok) return r.response;

  let config: Awaited<ReturnType<typeof getConfig>> = null;
  let runs: Awaited<ReturnType<typeof listRecentRuns>> = [];
  try {
    config = await getConfig(r.actor.organizationId);
    runs = config ? await listRecentRuns(r.actor.organizationId, 5) : [];
  } catch (err) {
    // A tela continua útil mesmo em erro: devolvemos a tabela de eventos junto.
    const res = esocialErrorResponse(err, 'Falha ao ler a configuração.');
    const body = await res.json();
    return NextResponse.json(
      { ...body, defaults: DEFAULT_ENDPOINTS, ingestedEvents: INGESTED_EVENT_TYPES },
      { status: res.status },
    );
  }

  return NextResponse.json({
    ok: true,
    configured: Boolean(config?.cert_storage_path),
    automationEnabled: false,
    certKeyConfigured: hasCertKey(),
    config: config
      ? {
          tpInsc: config.tp_insc,
          nrInsc: config.nr_insc,
          environment: config.environment,
          autoSyncEnabled: config.auto_sync_enabled,
          syncFrequency: config.sync_frequency,
          lookbackMonths: config.lookback_months,
          lastSyncAt: config.last_sync_at,
          lastSyncStatus: config.last_sync_status,
          nextSyncAt: config.next_sync_at,
          certificate: config.cert_storage_path
            ? {
                subject: config.cert_subject,
                expiresAt: config.cert_expires_at,
                fingerprint: config.cert_fingerprint,
              }
            : null,
        }
      : null,
    defaults: DEFAULT_ENDPOINTS,
    ingestedEvents: INGESTED_EVENT_TYPES,
    recentRuns: runs,
  });
}

export async function POST(req: Request) {
  const r = await resolvePayrollActor('admin.manage_integrations');
  if (!r.ok) return r.response;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: 'Envie os dados como multipart/form-data.' }, { status: 400 });
  }

  const nrInsc = String(form.get('nrInsc') ?? '').replace(/\D/g, '');
  const tpInsc = Number(form.get('tpInsc') ?? 1);
  const environment = String(form.get('environment') ?? 'production');
  const autoSyncEnabled = form.get('autoSyncEnabled') === 'true';
  const syncFrequency = String(form.get('syncFrequency') ?? 'daily');
  const lookbackMonths = Number(form.get('lookbackMonths') ?? 3);

  if (tpInsc === 1 && nrInsc.length !== 14) {
    return NextResponse.json({ ok: false, error: 'CNPJ deve ter 14 dígitos.' }, { status: 400 });
  }
  if (!['production', 'restricted'].includes(environment)) {
    return NextResponse.json({ ok: false, error: 'Ambiente inválido.' }, { status: 400 });
  }
  if (!['manual', 'daily', 'weekly'].includes(syncFrequency)) {
    return NextResponse.json({ ok: false, error: 'Frequência inválida.' }, { status: 400 });
  }
  if (!Number.isInteger(lookbackMonths) || lookbackMonths < 1 || lookbackMonths > 24) {
    return NextResponse.json({ ok: false, error: 'Janela retroativa deve ficar entre 1 e 24 meses.' }, { status: 400 });
  }

  let existing: Awaited<ReturnType<typeof getConfig>>;
  try {
    existing = await getConfig(r.actor.organizationId);
  } catch (err) {
    return esocialErrorResponse(err, 'Falha ao ler a configuração atual.');
  }

  const patch: Record<string, unknown> = {
    organization_id: r.actor.organizationId,
    tp_insc: tpInsc,
    nr_insc: nrInsc,
    environment,
    auto_sync_enabled: autoSyncEnabled,
    sync_frequency: syncFrequency,
    lookback_months: lookbackMonths,
    updated_by: r.actor.userId,
  };

  // ── Certificado (opcional numa edição que só muda agendamento) ──
  const file = form.get('certificate');
  const password = form.get('certificatePassword');

  if (file instanceof File && file.size > 0) {
    if (!hasCertKey()) {
      return NextResponse.json(
        { ok: false, error: 'ESOCIAL_CERT_KEY não configurada no servidor — não é possível guardar a senha com segurança.' },
        { status: 503 },
      );
    }
    if (file.size > MAX_CERT_BYTES) {
      return NextResponse.json({ ok: false, error: 'Certificado maior que 1 MB — verifique o arquivo.' }, { status: 400 });
    }
    if (typeof password !== 'string' || password.length === 0) {
      return NextResponse.json({ ok: false, error: 'Informe a senha do certificado.' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    let info;
    try {
      info = inspectCertificate(buffer, password);
    } catch (err) {
      return NextResponse.json(
        { ok: false, error: err instanceof Error ? err.message : 'Certificado inválido.' },
        { status: 400 },
      );
    }
    if (info.expired) {
      return NextResponse.json(
        { ok: false, error: `Certificado expirado em ${info.validTo.slice(0, 10)}. Envie um A1 válido.` },
        { status: 400 },
      );
    }
    // Titular divergente é o erro mais caro de diagnosticar depois — o eSocial
    // simplesmente recusa o handshake sem dizer o porquê.
    if (info.holderDocument && tpInsc === 1 && info.holderDocument !== nrInsc) {
      return NextResponse.json(
        {
          ok: false,
          error: `O certificado pertence ao CNPJ ${info.holderDocument}, diferente do informado (${nrInsc}).`,
        },
        { status: 400 },
      );
    }

    try {
      const path = await uploadCertificate(r.actor.organizationId, buffer, file.name);
      patch.cert_storage_path = path;
      patch.cert_password_cipher = encryptSecret(password);
      patch.cert_subject = info.subject;
      patch.cert_expires_at = info.validTo;
      patch.cert_fingerprint = info.fingerprint;

      // Só depois de gravar o novo é que o antigo sai — nunca ficamos sem certificado.
      if (existing?.cert_storage_path) await removeCertificate(existing.cert_storage_path);
    } catch (err) {
      return esocialErrorResponse(err, 'Falha ao gravar o certificado.');
    }
  } else if (!existing?.cert_storage_path && autoSyncEnabled) {
    return NextResponse.json(
      { ok: false, error: 'Envie o certificado A1 antes de ligar a sincronização automática.' },
      { status: 400 },
    );
  }

  try {
    await upsertConfig(patch as Parameters<typeof upsertConfig>[0]);
  } catch (err) {
    return esocialErrorResponse(err, 'Falha ao salvar a configuração.');
  }

  return NextResponse.json({
    ok: true,
    certificateUpdated: file instanceof File && file.size > 0,
    automationEnabled: false,
  });
}
