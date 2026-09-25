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
import { platformServiceClient } from '@/lib/platform/server-client';
import { sendAppEmail } from '@/lib/notifications/email';
import { asoDigestKey, asoDigestSubject, parseAsoDigestIntent } from '@/lib/workforce/aso-alert-intent';
import type { RepoActor } from '@/lib/payroll/repository';

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
  const { searchParams } = new URL(req.url);

  // Quem PODE receber o resumo (e só isso): a tela escolhe desta lista.
  if (searchParams.get('view') === 'recipients') {
    const s = await resolvePayrollActor('people.view_sensitive_data');
    if (!s.ok) return s.response;
    try {
      return NextResponse.json({ ok: true, members: await digestDirectory(s.actor) });
    } catch {
      return NextResponse.json({ ok: false, error: 'Falha ao carregar destinatários.' }, { status: 500 });
    }
  }

  const r = await resolvePayrollActor('people.view');
  if (!r.ok) return r.response;

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
 *
 * O resumo é dado de SAÚDE (nome + situação de exame). Por isso:
 *   • o corpo é uma intenção — `{ to: [{ type: 'member', id }], request_id, test }`;
 *     endereço cru, `recipients` ou campo estranho → 400;
 *   • destinatário só membro com vínculo ATIVO, e-mail confirmado e
 *     `people.view_sensitive_data` NA organização do ator (245) — sem
 *     inquilino cruzado, sem endereço externo; no máximo 20;
 *   • assunto neutro (sem contagem, nome ou lotação) e resposta sem o HTML;
 *   • entrega pelo transporte compartilhado, uma mensagem por pessoa, chave de
 *     idempotência por pedido e destinatário e registro em `email_dispatches`;
 *     repetir o mesmo pedido não manda de novo a quem já recebeu.
 */
export async function POST(req: Request) {
  const r = await resolvePayrollActor('people.view_sensitive_data');
  if (!r.ok) return r.response;

  if (!(req.headers.get('content-type') ?? '').includes('application/json')) {
    return NextResponse.json({ ok: false, error: 'Envio aceita só JSON com a intenção tipada.' }, { status: 415 });
  }
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON inválido.' }, { status: 400 });
  }
  const parsed = parseAsoDigestIntent(raw);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  const { intent } = parsed;

  // Endereços do DIRETÓRIO do servidor, na organização do ator.
  const directory = new Map((await digestDirectory(r.actor)).map((m) => [m.id.toLowerCase(), m]));
  const recipients: Array<{ id: string; email: string }> = [];
  const seen = new Set<string>();
  for (const ref of intent.to) {
    const m = directory.get(ref.id);
    if (!m) {
      return NextResponse.json(
        { ok: false, error: 'Destinatário fora da lista autorizada (membro ativo com acesso a dado sensível desta organização).' },
        { status: 422 },
      );
    }
    if (seen.has(m.email.toLowerCase())) continue;
    seen.add(m.email.toLowerCase());
    recipients.push({ id: m.id, email: m.email });
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

  if (intent.test) {
    return NextResponse.json({
      ok: true, sent: false, simulated: true, test: true, summary, recipients: recipients.length,
      message: 'Ensaio: destinatários conferidos, nada foi enviado.',
    });
  }

  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const digest = buildAsoDigest(alerts);
  const subject = asoDigestSubject(today);
  const delivered = await deliveredTo(r.actor, intent.request_id);

  let sent = 0; let simulated = 0; let failed = 0; let skipped = 0;
  for (const rcpt of recipients) {
    if (delivered.has(rcpt.email.toLowerCase())) { skipped += 1; continue; }
    try {
      const out = await sendAppEmail(
        { to: rcpt.email, subject, html: digest.html, text: digest.text },
        { idempotencyKey: asoDigestKey(intent.request_id, rcpt.email), organizationId: r.actor.organizationId,
          related: { type: 'aso_alert_digest', id: intent.request_id } },
      );
      if (out.outcome === 'SENT') sent += 1; else simulated += 1;
    } catch {
      failed += 1; // o motivo fica em email_dispatches; endereço e conteúdo não vão para log
    }
  }

  const delivered_ok = sent + simulated + skipped;
  return NextResponse.json(
    {
      ok: failed === 0,
      sent: sent + skipped > 0 && failed === 0,
      simulated: sent === 0 && simulated > 0,
      summary,
      recipients: recipients.length,
      delivered: { sent, simulated, skipped, failed },
      message: failed > 0
        ? `Entregue a ${delivered_ok} de ${recipients.length}; ${failed} falharam — repita (quem já recebeu não recebe de novo).`
        : sent === 0 && simulated > 0 ? 'Transporte de e-mail não configurado — envio simulado.' : undefined,
      error: failed > 0 && delivered_ok === 0 ? 'Falha ao enviar o alerta.' : undefined,
    },
    { status: failed > 0 && delivered_ok === 0 ? 502 : 200 },
  );
}

/** Membros que podem receber o resumo de ASO nesta organização (245). */
async function digestDirectory(actor: RepoActor): Promise<Array<{ id: string; name: string; email: string }>> {
  const { data, error } = await platformServiceClient().rpc('aso_alert_member_directory', { p_organization_id: actor.organizationId });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{ user_id: string; full_name: string; email: string }>)
    .map((m) => ({ id: m.user_id, name: m.full_name, email: m.email }));
}

/** Quem já recebeu este pedido (livro do transporte, escrito só pelo servidor). */
async function deliveredTo(actor: RepoActor, requestId: string): Promise<Set<string>> {
  const { data, error } = await platformServiceClient().from('email_dispatches').select('target_email')
    .eq('organization_id', actor.organizationId).eq('related_entity_type', 'aso_alert_digest')
    .eq('related_entity_id', requestId).in('status', ['sent', 'simulated']);
  if (error) throw new Error(error.message);
  return new Set(((data ?? []) as Array<{ target_email: string }>).map((d) => d.target_email.trim().toLowerCase()));
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
