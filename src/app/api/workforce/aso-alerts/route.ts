import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { resolvePayrollActor } from '@/lib/payroll/repository/actor';
import { readEmployments, readSstEvents } from '@/lib/esocial/connector/store';
import { listAsoDocuments, AsoSchemaMissingError } from '@/lib/workforce/aso-store';
import {
  buildAsoAlerts,
  buildAsoDigest,
  summarizeAsoAlerts,
  workersFromUnmatchedDocuments,
  DEFAULT_ASO_WINDOWS,
  ASO_CONTROL_NOTICE,
  type AsoAlertDocument,
  type AsoAlertEsocialExam,
  type AsoAlertWorker,
} from '@/lib/workforce/aso-alerts';
import { normalizePayrollName } from '@/lib/workforce/salary-history';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET — fila de vencimento de ASO para o RH.
 *
 * A fila é montada sobre os ASOs EM PDF: é o documento aprovado que decide o
 * nível de cada linha. O evento S-2220 entra ao lado, como conferência
 * opcional, e nunca é exigido para nada — uma organização que nunca importou
 * pacote nenhum do eSocial vê a fila inteira funcionando.
 *
 * `people.view` basta para ver a fila; os NOMES só saem para quem tem dado
 * sensível, porque a fila em si — quantos vencidos, em que lotação — é
 * informação de gestão, e a identificação é que é de saúde.
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
    esocialAvailable: payload.esocialAvailable,
    notice: ASO_CONTROL_NOTICE,
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
      message:
        'Nenhum ASO vencido, a vencer na janela crítica, pendente de revisão ou sem documento — nada a comunicar.',
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
 * Carrega as entradas da fila.
 *
 * O QUADRO DE COLABORADORES vem de `people`, que é o cadastro canônico e existe
 * independentemente de qualquer importação. Os vínculos do eSocial COMPLETAM
 * essa lista, e só entram quando não casam com ninguém já cadastrado — antes,
 * o quadro vinha só do eSocial, e por isso a fila inteira ficava vazia em quem
 * ainda não tinha importado pacote nenhum, por mais ASOs que tivesse enviado.
 *
 * Cada fonte falha por conta própria. O que não pode acontecer é a fila sumir
 * porque uma delas não foi provisionada.
 */
async function loadAlertInputs(organizationId: string): Promise<{
  workers: AsoAlertWorker[];
  documents: AsoAlertDocument[];
  esocialExams: AsoAlertEsocialExam[];
  documentsAvailable: boolean;
  esocialAvailable: boolean;
}> {
  const supabase = await createClient();

  const [{ data: peopleRows }, employments] = await Promise.all([
    supabase
      .from('people')
      .select('id, full_name, payroll_name_key, department')
      .eq('organization_id', organizationId)
      .eq('status', 'active'),
    readEmployments(organizationId, { status: 'active' }).catch(() => []),
  ]);

  const people = peopleRows ?? [];

  const workers: AsoAlertWorker[] = people.map((p) => ({
    // Chave estável e independente do eSocial. Os documentos são indexados
    // também por `person:<id>`, então o encontro acontece sem CPF.
    workerKey: `person:${String(p.id)}`,
    personId: String(p.id),
    name: p.full_name ? String(p.full_name) : null,
    areaLabel: p.department ? String(p.department) : null,
  }));

  const knownNameKeys = new Set(
    people
      .map((p) => (p.payroll_name_key ? String(p.payroll_name_key) : normalizePayrollName(String(p.full_name ?? ''))))
      .filter((k): k is string => Boolean(k)),
  );

  for (const e of employments) {
    const nameKey = normalizePayrollName(e.worker_name ?? null);
    // Já coberto por uma pessoa do cadastro: adicionar de novo duplicaria a
    // linha e faria o mesmo colaborador aparecer duas vezes na fila.
    if (nameKey && knownNameKeys.has(nameKey)) continue;
    workers.push({
      workerKey: e.worker_cpf_hash ?? e.matricula,
      personId: null,
      name: e.worker_name ?? null,
      areaLabel: e.area_label ?? null,
    });
  }

  let esocialAvailable = true;
  const esocialExams: AsoAlertEsocialExam[] = await readSstEvents(organizationId, {
    eventType: 'S-2220',
  })
    .then((rows) =>
      rows.map((row) => ({
        workerKey: row.worker_cpf_hash ?? row.matricula,
        examDate: row.event_date,
        examKind: row.exam_kind,
        validityDate: row.aso_valid_until,
        eventId: row.esocial_event_id,
      })),
    )
    .catch(() => {
      esocialAvailable = false;
      return [];
    });

  let documents: AsoAlertDocument[] = [];
  let documentsAvailable = true;
  let documentNames = new Map<string, string | null>();
  try {
    const rows = await listAsoDocuments(organizationId);
    documentNames = new Map(rows.map((d) => [d.id, d.worker_name_raw]));
    documents = rows.map((d) => ({
      id: d.id,
      workerKey: d.worker_cpf_hash,
      personId: d.person_id,
      examDate: d.exam_date,
      examKind: d.exam_kind,
      validityDate: d.validity_date,
      validityBasis: d.validity_basis,
      documentStatus: d.document_status,
      esocialMatchStatus: d.esocial_match_status,
      esocialEventId: d.esocial_event_id,
      divergenceSummary: d.divergence_summary,
    }));
  } catch (err) {
    if (err instanceof AsoSchemaMissingError) documentsAvailable = false;
    else throw err;
  }

  // ASOs de quem ainda não está em lugar nenhum entram por conta própria, para
  // poderem ser revisados e vinculados em vez de desaparecerem.
  workers.push(
    ...workersFromUnmatchedDocuments(documents, workers, (d) => documentNames.get(d.id) ?? null),
  );

  return { workers, documents, esocialExams, documentsAvailable, esocialAvailable };
}
