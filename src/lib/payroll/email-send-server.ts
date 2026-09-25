/**
 * Envio do fechamento da folha por e-mail — o servidor decide tudo. Server-only.
 *
 *   destinatários  membro com vínculo ATIVO na organização do ator
 *                  (organization_memberships, 243) ou contato externo
 *                  autorizado por quem administra a folha (243)
 *   remetente      o da plataforma (ambiente) — nunca do pedido
 *   assunto/corpo  modelos do servidor sobre os números GUARDADOS do
 *                  fechamento e a narrativa guardada pelo servidor
 *   anexos         só ids do armazenamento seguro, do MESMO fechamento, em
 *                  linha que aponta para o bucket do seu tipo dentro da pasta
 *                  desta organização/fechamento; com a leitura da folha
 *                  (`people.payroll_close`), as permissões da RLS de holerite e
 *                  banco, e `people.payroll_send_sensitive` + confirmação para
 *                  o que não é agregado; tamanho medido nos bytes baixados
 *   entrega        transporte compartilhado (Resend com chave de idempotência
 *                  por pacote e destinatário); um pacote por intenção
 *                  (`request_id`) — repetir o clique não manda de novo
 */
if (typeof window !== 'undefined') {
  throw new Error('payroll/email-send-server.ts não pode ser importado no navegador');
}

import { createHash } from 'node:crypto';
import { requireApiPermission } from '@/lib/auth/api-guard';
import { buildEmailHtml, buildEmailText } from '@/lib/payroll/html-builder';
import { sendAppEmail, type AppEmailAttachment } from '@/lib/notifications/email';
import type { PayrollAttachment } from '@/lib/types/payroll-closing';
import type { PayrollRepository, RepoActor } from '@/lib/payroll/repository';
import {
  MAX_PAYROLL_ATTACHMENT_BYTES, attachmentSendPermissions, batchSendable, payrollEmailSubject,
  type PayrollEmailIntent, type RecipientRef,
} from './email-intent';

const MAILBOX = /^[^\s@<>"';:,\\]+@[^\s@<>"';:,\\]+\.[^\s@<>"';:,\\]+$/;

export interface ResolvedRecipient { ref: RecipientRef; email: string; name: string }
export interface RecipientDirectory {
  members: Array<{ id: string; name: string; email: string }>;
  contacts: Array<{ id: string; name: string; email: string }>;
}

type Fail = { ok: false; status: 400 | 403 | 404 | 409 | 413 | 422; error: string };

/** Quem pode receber: vínculo ATIVO na organização do ator + contatos autorizados. */
export async function payrollRecipientDirectory(repo: PayrollRepository, actor: RepoActor): Promise<RecipientDirectory> {
  const [active, contacts] = await Promise.all([repo.listActiveMembers(actor), repo.listEmailContacts(actor)]);
  const members = active
    .filter((m) => m.email && MAILBOX.test(m.email))
    .map((m) => ({ id: m.user_id, name: m.full_name || m.email, email: m.email }));
  return {
    members,
    contacts: contacts.filter((c) => MAILBOX.test(c.email)).map((c) => ({ id: c.id, name: c.display_name, email: c.email })),
  };
}

/** Referências → endereços. Referência desconhecida recusa o envio inteiro (não some em silêncio). */
export function resolveRecipientRefs(
  dir: RecipientDirectory, to: RecipientRef[], cc: RecipientRef[],
): { ok: true; to: ResolvedRecipient[]; cc: ResolvedRecipient[] } | Fail {
  const members = new Map(dir.members.map((m) => [m.id.toLowerCase(), m]));
  const contacts = new Map(dir.contacts.map((c) => [c.id.toLowerCase(), c]));
  const seen = new Set<string>();
  const resolve = (refs: RecipientRef[]): ResolvedRecipient[] | string => {
    const out: ResolvedRecipient[] = [];
    for (const ref of refs) {
      const hit = ref.type === 'member' ? members.get(ref.id) : contacts.get(ref.id);
      if (!hit) {
        return ref.type === 'member'
          ? 'Destinatário não é membro ativo desta organização.'
          : 'Contato externo não autorizado (ou revogado) nesta organização.';
      }
      const key = hit.email.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ref, email: hit.email, name: hit.name });
    }
    return out;
  };
  const rTo = resolve(to);
  if (typeof rTo === 'string') return { ok: false, status: 422, error: rTo };
  const rCc = resolve(cc);
  if (typeof rCc === 'string') return { ok: false, status: 422, error: rCc };
  return { ok: true, to: rTo, cc: rCc };
}

const keyFor = (packageId: string, email: string) =>
  `payroll:${packageId}:${createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 24)}`;

export interface PayrollSendResult {
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

/**
 * Executa uma intenção já validada. As permissões são checadas na SESSÃO de
 * quem envia; `repo` é o repositório do servidor, sempre recortado por
 * `actor.organizationId`.
 */
export async function executePayrollSend(
  repo: PayrollRepository, actor: RepoActor, intent: PayrollEmailIntent,
): Promise<PayrollSendResult> {
  const fail = (f: Fail): PayrollSendResult => ({ ok: false, status: f.status, body: { ok: false, error: f.error } });

  const facts = await repo.getEmailFacts(actor, intent.batch_id);
  if (!facts) return fail({ ok: false, status: 404, error: 'Fechamento não encontrado nesta organização.' });
  const blocked = batchSendable(facts.batch.status, facts.parse);
  if (blocked) return fail({ ok: false, status: 409, error: blocked });

  const resolved = resolveRecipientRefs(await payrollRecipientDirectory(repo, actor), intent.to, intent.cc);
  if (!resolved.ok) return fail(resolved);

  // Anexos: do armazenamento seguro, deste fechamento, com a permissão de quem envia.
  const batchAttachments = await repo.getAttachments(actor, intent.batch_id);
  const byId = new Map(batchAttachments.map((a) => [a.id.toLowerCase(), a]));
  const selected: PayrollAttachment[] = [];
  for (const id of intent.attachment_ids) {
    const a = byId.get(id);
    if (!a) return fail({ ok: false, status: 422, error: 'Anexo não pertence a este fechamento.' });
    selected.push(a);
  }
  const needed = new Set(selected.flatMap((a) => attachmentSendPermissions(a.file_type, a.security_level)));
  for (const key of needed) {
    const guard = await requireApiPermission(key, { allowAdmin: true });
    if (!guard.ok) return fail({ ok: false, status: 403, error: `Sem permissão para enviar este anexo (${key}).` });
  }
  if (selected.some((a) => a.security_level !== 'aggregate') && !intent.confirm_sensitive) {
    return fail({ ok: false, status: 400, error: 'Confirmação de anexos sensíveis necessária.' });
  }
  const declaredBytes = selected.reduce((s, a) => s + Math.max(Number(a.file_size) || 0, 0), 0);
  if (declaredBytes > MAX_PAYROLL_ATTACHMENT_BYTES) {
    return fail({ ok: false, status: 413, error: `Anexos somam ${(declaredBytes / 1024 / 1024).toFixed(1)} MB, acima de 40 MB.` });
  }

  const subject = payrollEmailSubject(facts.parse.competence_month);
  const html = buildEmailHtml({ parse: facts.parse, narrative: facts.narrative, audience: intent.audience });
  const text = buildEmailText({ parse: facts.parse, narrative: facts.narrative, audience: intent.audience });
  const everyone = [...resolved.to, ...resolved.cc];

  if (intent.test) {
    return { ok: true, status: 200, body: {
      ok: true, test: true, delivery_status: 'simulated', reason: 'Ensaio: nada foi enviado nem registrado.',
      recipients: everyone.length, attachments_sent: selected.map((a) => ({ file_name: a.file_name, file_size: Number(a.file_size) || 0 })),
      total_bytes: declaredBytes,
    } };
  }

  // Um pacote por intenção. Repetir a MESMA intenção é o mesmo pacote; outra
  // intenção com a mesma chave é recusada (o pacote não pode mudar de conteúdo).
  const prior = await repo.findEmailPackageByRequest(actor, intent.request_id);
  if (prior && (prior.batch_id !== intent.batch_id || prior.audience !== intent.audience
      || !sameSet(prior.attachment_ids.map((x) => x.toLowerCase()), selected.map((a) => a.id.toLowerCase())))) {
    return fail({ ok: false, status: 409, error: 'request_id já usado para outra intenção de envio.' });
  }
  if (prior && prior.status === 'sent') {
    const last = (await repo.getDispatches(actor, intent.batch_id)).find((d) => d.package_id === prior.id);
    return { ok: true, status: 200, body: { ok: true, replay: true, delivery_status: last?.delivery_status ?? 'sent', package_id: prior.id,
      recipients: everyone.length } };
  }

  // Bytes: a linha precisa apontar para o bucket do seu tipo, dentro da pasta
  // desta organização e fechamento (o repositório recusa o resto); o tamanho
  // que vale é o dos bytes baixados.
  const files: AppEmailAttachment[] = [];
  const attachmentsSent: Array<{ file_name: string; file_size: number }> = [];
  for (const a of selected) {
    let loaded;
    try { loaded = await repo.getAttachmentBytes(actor, a.id); } catch (err) {
      if (err instanceof Error && err.message.startsWith('ATTACHMENT_LOCATION_INVALID')) {
        return fail({ ok: false, status: 422, error: 'Anexo com localização inválida no armazenamento.' });
      }
      throw err;
    }
    if (!loaded) return fail({ ok: false, status: 422, error: 'Anexo indisponível no armazenamento.' });
    files.push({ filename: loaded.file_name, contentType: loaded.mime_type, bytes: loaded.bytes });
    attachmentsSent.push({ file_name: loaded.file_name, file_size: loaded.bytes.length });
  }
  const totalBytes = attachmentsSent.reduce((s, a) => s + a.file_size, 0);
  if (totalBytes > MAX_PAYROLL_ATTACHMENT_BYTES) {
    return fail({ ok: false, status: 413, error: `Anexos somam ${(totalBytes / 1024 / 1024).toFixed(1)} MB, acima de 40 MB.` });
  }

  const pkg = prior ?? await repo.createEmailPackage(actor, intent.batch_id, {
    audience: intent.audience, subject, html_body: html, attachment_ids: selected.map((a) => a.id), request_id: intent.request_id,
  });
  // Nova tentativa do mesmo pacote: quem já recebeu não recebe de novo — seja
  // qual for o transporte (o Resend também deduplica pela chave).
  const delivered = prior ? await repo.deliveredRecipients(actor, pkg.id) : new Set<string>();

  let sent = 0; let simulated = 0; let failed = 0; let skipped = 0; let providerId: string | undefined;
  for (const r of everyone) {
    if (delivered.has(r.email.trim().toLowerCase())) { skipped += 1; continue; }
    try {
      const out = await sendAppEmail(
        { to: r.email, subject, html, text, attachments: files },
        { idempotencyKey: keyFor(pkg.id, r.email), organizationId: actor.organizationId, related: { type: 'payroll_email_package', id: pkg.id } },
      );
      if (out.outcome === 'SENT') { sent += 1; providerId ??= out.messageId ?? undefined; } else simulated += 1;
    } catch {
      failed += 1; // o motivo fica em email_dispatches; endereço e conteúdo não vão para log
    }
  }

  const delivered_ok = sent + simulated + skipped;
  const delivery_status = failed > 0 ? 'failed' : sent > 0 || skipped > 0 ? 'sent' : 'simulated';
  const error = failed > 0
    ? `Entregue a ${delivered_ok} de ${everyone.length}; ${failed} falharam — repita o envio (quem já recebeu não recebe de novo).`
    : undefined;
  // A auditoria que falha não desfaz o envio que aconteceu — nem é motivo de reenviar.
  let ledger: 'recorded' | 'pending' = 'recorded';
  try {
    await repo.recordDispatch(actor, {
      package_id: pkg.id, recipients: resolved.to.map((r) => r.email), cc: resolved.cc.map((r) => r.email),
      delivery_status, provider_message_id: providerId, error_message: error, attachments_sent: attachmentsSent,
    });
  } catch {
    ledger = 'pending';
    console.error('[payroll/email] registro do envio falhou', { organizationId: actor.organizationId, packageId: pkg.id });
  }

  return {
    ok: failed === 0, status: failed > 0 && delivered_ok === 0 ? 502 : 200,
    body: { ok: failed === 0, delivery_status: failed > 0 && delivered_ok > 0 ? 'partial' : delivery_status, error,
      package_id: pkg.id, recipients: everyone.length, sent, simulated, failed, skipped, ledger,
      provider_message_id: providerId, attachments_sent: attachmentsSent, total_bytes: totalBytes,
      reason: sent === 0 && simulated > 0 ? 'Transporte de e-mail não configurado — envio simulado.' : undefined },
  };
}
