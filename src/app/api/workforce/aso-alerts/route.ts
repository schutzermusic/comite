import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { resolvePayrollActor } from '@/lib/payroll/repository/actor';
import { readEmployments, readSstEvents } from '@/lib/esocial/connector/store';
import { listAsoDocuments, AsoSchemaMissingError } from '@/lib/workforce/aso-store';
import {
  buildAsoAlerts,
  buildAsoDigest,
  summarizeAsoAlerts,
  DEFAULT_ASO_WINDOWS,
  type AsoAlertDocument,
  type AsoAlertEsocialExam,
  type AsoAlertWorker,
} from '@/lib/workforce/aso-alerts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET — fila de vencimento de ASO para o RH.
 *
 * Junta as duas fontes (documento enviado e evento S-2220) e devolve uma linha
 * por trabalhador ativo. `people.view` basta para ver a fila; os NOMES só saem
 * para quem tem dado sensível, porque a fila em si — quantos vencidos, em que
 * lotação — é informação de gestão, e a identificação é que é de saúde.
 */
export async function GET(req: Request) {
  const r = await resolvePayrollActor('people.view');
  if (!r.ok) return r.response;

  const { searchParams } = new URL(req.url);
  const critical = Number(searchParams.get('critical') ?? DEFAULT_ASO_WINDOWS.critical);
  const warning = Number(searchParams.get('warning') ?? DEFAULT_ASO_WINDOWS.warning);
  const windows = {
    critical: Number.isFinite(critical) && critical > 0 ? critical : DEFAULT_ASO_WINDOWS.critical,
    warning: Number.isFinite(warning) && warning > 0 ? warning : DEFAULT_ASO_WINDOWS.warning,
  };

  const supabase = await createClient();
  const { data: canSeeNames } = await supabase.rpc('current_user_has_permission', {
    permission_key: 'people.view_sensitive_data',
  });
  const identified = canSeeNames === true;

  const payload = await loadAlertInputs(r.actor.organizationId);
  const alerts = buildAsoAlerts({ ...payload, windows }).map((a) => ({
    ...a,
    name: identified ? a.name : null,
  }));

  return NextResponse.json({
    ok: true,
    identified,
    windows,
    alerts,
    summary: summarizeAsoAlerts(alerts),
    documentsAvailable: payload.documentsAvailable,
  });
}

/**
 * POST — dispara o digest de vencimento por e-mail ao RH.
 *
 * Ação explícita, e não cron. O plano Hobby da Vercel já usa suas duas vagas
 * de cron (`vercel.json`), e o disparo automático real do produto vive no
 * workflow horário do GitHub Actions. Enquanto uma agenda própria não for
 * criada, quem decide quando o RH recebe o aviso é o RH — o que também evita
 * o pior resultado possível aqui, que é um alerta diário repetido virar ruído
 * e parar de ser lido.
 */
export async function POST(req: Request) {
  const r = await resolvePayrollActor('people.view_sensitive_data');
  if (!r.ok) return r.response;

  let body: { recipients?: string[]; test?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON inválido.' }, { status: 400 });
  }

  const recipients = (body.recipients ?? []).map((e) => e.trim()).filter(Boolean);
  if (recipients.length === 0) {
    return NextResponse.json({ ok: false, error: 'Informe ao menos um destinatário.' }, { status: 400 });
  }

  const payload = await loadAlertInputs(r.actor.organizationId);
  const alerts = buildAsoAlerts(payload);
  const summary = summarizeAsoAlerts(alerts);

  if (summary.actionable === 0) {
    return NextResponse.json({
      ok: true,
      sent: false,
      summary,
      message: 'Nenhum ASO vencido, crítico ou ausente — nada a comunicar.',
    });
  }

  const digest = buildAsoDigest(alerts);
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.PAYROLL_EMAIL_FROM;

  // Sem chave (ou em teste explícito) o envio é SIMULADO e dito como tal —
  // mesmo contrato do envio da folha, para que ninguém acredite ter avisado
  // o RH quando não avisou.
  if (!apiKey || !from || body.test) {
    return NextResponse.json({
      ok: true,
      sent: false,
      simulated: true,
      summary,
      subject: digest.subject,
      preview: digest.html,
      message: !apiKey || !from
        ? 'RESEND_API_KEY / PAYROLL_EMAIL_FROM ausentes — envio simulado.'
        : 'Envio simulado a pedido.',
    });
  }

  try {
    const { Resend } = await import('resend');
    const resend = new Resend(apiKey);
    const result = await resend.emails.send({
      from,
      to: recipients,
      subject: digest.subject,
      html: digest.html,
      text: digest.text,
    });
    if (result.error) throw new Error(result.error.message);

    return NextResponse.json({
      ok: true,
      sent: true,
      summary,
      messageId: result.data?.id,
      recipients: recipients.length,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Falha ao enviar o alerta.' },
      { status: 500 },
    );
  }
}

/**
 * Carrega as três entradas da fila.
 *
 * Cada fonte falha por conta própria: sem a migration 084 ainda há documentos,
 * e sem a 085 ainda há eventos. O que não pode acontecer é a fila inteira
 * sumir porque uma das duas não foi provisionada.
 */
async function loadAlertInputs(organizationId: string): Promise<{
  workers: AsoAlertWorker[];
  documents: AsoAlertDocument[];
  esocialExams: AsoAlertEsocialExam[];
  documentsAvailable: boolean;
}> {
  const employments = await readEmployments(organizationId, { status: 'active' }).catch(() => []);

  const esocialExams: AsoAlertEsocialExam[] = await readSstEvents(organizationId, {
    eventType: 'S-2220',
  })
    .then((rows) =>
      rows.map((row) => ({
        workerKey: row.worker_cpf_hash ?? row.matricula,
        examDate: row.event_date,
        examKind: row.exam_kind,
        validUntil: row.aso_valid_until,
      })),
    )
    .catch(() => []);

  let documents: AsoAlertDocument[] = [];
  let documentsAvailable = true;
  try {
    documents = (await listAsoDocuments(organizationId)).map((d) => ({
      id: d.id,
      workerKey: d.worker_cpf_hash,
      personId: d.person_id,
      examDate: d.exam_date,
      examKind: d.exam_kind,
      validUntil: d.valid_until,
      validityBasis: d.validity_basis,
      status: d.status,
    }));
  } catch (err) {
    if (err instanceof AsoSchemaMissingError) documentsAvailable = false;
    else throw err;
  }

  const workers: AsoAlertWorker[] = employments.map((e) => ({
    workerKey: e.worker_cpf_hash ?? e.matricula,
    name: e.worker_name ?? null,
    areaLabel: e.area_label ?? null,
  }));

  return { workers, documents, esocialExams, documentsAvailable };
}
