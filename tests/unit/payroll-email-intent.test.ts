/**
 * E-mail do fechamento da folha: o navegador nomeia a intenção; o servidor
 * resolve endereços, monta conteúdo e anexos. Regressão do relay (o corpo
 * antigo {from, subject, html, recipients, cc, bcc, attachments} ia ao provedor).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { send, permitted } = vi.hoisted(() => ({ send: vi.fn(), permitted: new Set<string>() }));
vi.mock('@/lib/notifications/email', () => ({ sendAppEmail: send }));
vi.mock('@/lib/auth/api-guard', () => ({
  requireApiPermission: async (key: string) => (permitted.has(key) ? { ok: true, userId: 'u' } : { ok: false, response: null }),
}));

import {
  attachmentLocationProblem, attachmentSendPermissions, coerceNarrative, factsToParse, numbersSignature,
  parsePayrollEmailIntent, payrollEmailSubject, sanitizeParseForSave, type PayrollEmailIntent,
} from '@/lib/payroll/email-intent';
import type { PayrollParseResult } from '@/lib/types/payroll-closing';
import { executePayrollSend, resolveRecipientRefs } from '@/lib/payroll/email-send-server';
import type { PayrollRepository } from '@/lib/payroll/repository';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const BATCH = U(1); const REQ = U(2); const MEMBER = U(3); const CONTACT = U(4); const ATT = U(5); const HOL = U(6); const PKG = U(7);

describe('parsePayrollEmailIntent — o relay antigo é recusado', () => {
  it('recusa o corpo livre com remetente, destinatários, HTML e anexos', () => {
    const r = parsePayrollEmailIntent({
      from: 'CEO <ceo@banco.example>', subject: 'x', html: '<a href="https://evil">x</a>',
      recipients: ['vitima@example.com'], cc: ['a@b.c'], bcc: ['b@c.d'], attachments: [{ content_base64: 'eA==' }],
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/servidor/);
  });

  it('recusa campo extra mesmo numa intenção tipada', () => {
    for (const extra of [{ from: 'x@y.z' }, { subject: 's' }, { html: '<b>' }, { recipients: ['x@y.z'] }, { bcc: [] }, { attachments: [] }, { text: 't' }]) {
      const r = parsePayrollEmailIntent({ kind: 'payroll_closing_package', batch_id: BATCH, request_id: REQ, to: [{ type: 'member', id: MEMBER }], ...extra });
      expect(r.ok, JSON.stringify(extra)).toBe(false);
    }
  });

  it('referência leva só type e id — endereço embutido é recusado', () => {
    const r = parsePayrollEmailIntent({ kind: 'payroll_closing_package', batch_id: BATCH, request_id: REQ,
      to: [{ type: 'member', id: MEMBER, email: 'vitima@example.com' }] });
    expect(r.ok).toBe(false);
    expect(parsePayrollEmailIntent({ kind: 'payroll_closing_package', batch_id: BATCH, request_id: REQ, to: ['vitima@example.com'] }).ok).toBe(false);
    expect(parsePayrollEmailIntent({ kind: 'payroll_closing_package', batch_id: BATCH, request_id: REQ, to: [{ type: 'email', id: MEMBER }] }).ok).toBe(false);
  });

  it('exige kind, fechamento, request_id, ao menos um "Para" e respeita os tetos', () => {
    const base = { kind: 'payroll_closing_package', batch_id: BATCH, request_id: REQ, to: [{ type: 'member', id: MEMBER }] };
    expect(parsePayrollEmailIntent({ ...base, kind: 'x' }).ok).toBe(false);
    expect(parsePayrollEmailIntent({ ...base, batch_id: '1' }).ok).toBe(false);
    expect(parsePayrollEmailIntent({ ...base, request_id: undefined }).ok).toBe(false);
    expect(parsePayrollEmailIntent({ ...base, to: [] }).ok).toBe(false);
    expect(parsePayrollEmailIntent({ ...base, to: Array.from({ length: 31 }, (_, i) => ({ type: 'member', id: U(100 + i) })) }).ok).toBe(false);
    expect(parsePayrollEmailIntent({ ...base, attachment_ids: ['../../etc/passwd'] }).ok).toBe(false);
    expect(parsePayrollEmailIntent({ ...base, audience: 'everyone' }).ok).toBe(false);
  });

  it('aceita a intenção tipada', () => {
    const r = parsePayrollEmailIntent({ kind: 'payroll_closing_package', batch_id: BATCH, request_id: REQ, audience: 'finance',
      to: [{ type: 'member', id: MEMBER }], cc: [{ type: 'contact', id: CONTACT }], attachment_ids: [ATT, ATT], confirm_sensitive: true });
    expect(r).toEqual({ ok: true, intent: expect.objectContaining({ audience: 'finance', attachment_ids: [ATT], test: false, confirm_sensitive: true }) });
  });
});

describe('regras puras', () => {
  it('anexo: a base é ler a folha; holerite e banco pedem a permissão da RLS; o que não é agregado pede envio sensível', () => {
    const sorted = (x: string[]) => [...x].sort();
    expect(attachmentSendPermissions('executive_pdf', 'aggregate')).toEqual(['people.payroll_close']);
    expect(sorted(attachmentSendPermissions('holerite', 'confidential'))).toEqual(
      ['people.payroll_close', 'people.payroll_holerite_access', 'people.payroll_send_sensitive']);
    expect(sorted(attachmentSendPermissions('bank_payment_spreadsheet', 'finance_restricted'))).toEqual(
      ['people.payroll_bank_file_access', 'people.payroll_close', 'people.payroll_send_sensitive']);
    expect(sorted(attachmentSendPermissions('payroll_spreadsheet', 'hr_restricted'))).toEqual(['people.payroll_close', 'people.payroll_send_sensitive']);
    // Rótulo "agregado" apontando para o bucket de holerites: vale o bucket.
    expect(attachmentSendPermissions('supporting_document', 'aggregate', 'payroll-holerites')).toContain('people.payroll_holerite_access');
  });

  it('linha de anexo só é baixada se aponta para o bucket do seu tipo, dentro da pasta da organização e do fechamento', () => {
    const org = U(50);
    const ok = { file_type: 'holerite', storage_bucket: 'payroll-holerites', object_path: `${org}/${BATCH}/holerite/1-x.pdf`, batch_id: BATCH };
    expect(attachmentLocationProblem(ok, org)).toBeNull();
    expect(attachmentLocationProblem({ ...ok, file_type: 'supporting_document' }, org)).toMatch(/bucket/);
    expect(attachmentLocationProblem({ ...ok, object_path: `/${org}/${BATCH}/x.pdf` }, org)).toMatch(/caminho/);
    expect(attachmentLocationProblem({ ...ok, object_path: `${org}/${BATCH}/../../${U(9)}/x.pdf` }, org)).toMatch(/caminho/);
    expect(attachmentLocationProblem({ ...ok, object_path: `${U(9)}/${BATCH}/x.pdf` }, org)).toMatch(/fora/);
    expect(attachmentLocationProblem({ ...ok, file_type: 'remittance_file', storage_bucket: 'payroll-bank-files' }, org)).toMatch(/tipo/);
  });

  it('leitura da planilha: competência, números finitos, rótulos curtos e sem controle', () => {
    const base = { competence_month: '2026-08', total_amount_cents: 1, previous_month_amount_cents: 1, variation_amount_cents: 0,
      variation_percentage: 0, cost_centers: [{ cost_center_label: 'Obra\r\nBcc: x', amount_cents: 1 }], employees: [], bank_lines: [],
      flags: [], detected_sheets: [], reconciled: true, comparison: {} } as unknown as PayrollParseResult;
    const ok = sanitizeParseForSave(base);
    expect(ok.ok && ok.parse.cost_centers[0].cost_center_label).toBe('Obra Bcc: x');
    expect(sanitizeParseForSave({ ...base, competence_month: '2026-08<script>' }).ok).toBe(false);
    expect(sanitizeParseForSave({ ...base, total_amount_cents: NaN }).ok).toBe(false);
    expect(sanitizeParseForSave({ ...base, cost_centers: [{ cost_center_label: 'x'.repeat(999), amount_cents: 1 }] } as never).ok
      && true).toBe(true);
  });

  it('assinatura dos números: ordem não importa; valor muda, assinatura muda', () => {
    const a = numbersSignature({ total_amount_cents: 10, previous_month_amount_cents: 8 },
      [{ cost_center_label: 'A', amount_cents: 6, previous_amount_cents: 5 }, { cost_center_label: 'B', amount_cents: 4, previous_amount_cents: 3 }]);
    const b = numbersSignature({ total_amount_cents: '10', previous_month_amount_cents: 8 },
      [{ cost_center_label: 'B', amount_cents: 4, previous_amount_cents: 3 }, { cost_center_label: 'A', amount_cents: 6, previous_amount_cents: 5 }]);
    expect(a).toBe(b);
    expect(numbersSignature({ total_amount_cents: 11, previous_month_amount_cents: 8 }, [])).not.toBe(numbersSignature({ total_amount_cents: 10, previous_month_amount_cents: 8 }, []));
  });

  it('narrativa guardada: só texto, com teto; formato estranho vira ausência', () => {
    expect(coerceNarrative(null)).toBeNull();
    expect(coerceNarrative('texto')).toBeNull();
    const n = coerceNarrative({ conclusion: 'x'.repeat(10_000), attention_points: ['ok', 42, { html: '<b>' }], board_summary: { evil: 1 } })!;
    expect(n.conclusion).toHaveLength(4000);
    expect(n.attention_points).toEqual(['ok']);
    expect(n.board_summary).toBe('');
  });

  it('números remontados do banco: comparação, contagem de contrato e valores não finitos', () => {
    const p = factsToParse(
      { competence_month: '2026-08', total_amount_cents: '1000', previous_month_amount_cents: 800, variation_amount_cents: 200, variation_percentage: 'x' },
      [{ cost_center_label: 'Obra', amount_cents: 700, previous_amount_cents: 500 }, { cost_center_label: 'Adm', amount_cents: 300, previous_amount_cents: 300 }],
      ['CLT', 'CLT', 'PJ', null],
    );
    expect(p.total_amount_cents).toBe(1000);
    expect(p.variation_percentage).toBe(0);
    expect(p.clt_count).toBe(2);
    expect(p.pj_count).toBe(1);
    expect(p.comparison.top_increases.map((r) => r.label)).toEqual(['Obra']);
    expect(p.employees).toEqual([]);
    expect(p.bank_lines).toEqual([]);
  });

  it('assunto do servidor é uma linha', () => {
    expect(payrollEmailSubject('2026-08\r\nBcc: x')).toBe('Fechamento da Folha — 2026-08 Bcc: x');
  });

  it('referência resolvida só contra o diretório; desconhecida recusa tudo; endereço repetido sai uma vez', () => {
    const dir = { members: [{ id: MEMBER, name: 'Fin', email: 'fin@org.example' }], contacts: [{ id: CONTACT, name: 'Cont', email: 'FIN@org.example' }] };
    const ok = resolveRecipientRefs(dir, [{ type: 'member', id: MEMBER }], [{ type: 'contact', id: CONTACT }]);
    expect(ok.ok && ok.to.map((r) => r.email)).toEqual(['fin@org.example']);
    expect(ok.ok && ok.cc).toEqual([]);
    const bad = resolveRecipientRefs(dir, [{ type: 'member', id: U(99) }], []);
    expect(bad).toMatchObject({ ok: false, status: 422 });
    const wrongKind = resolveRecipientRefs(dir, [{ type: 'contact', id: MEMBER }], []);
    expect(wrongKind).toMatchObject({ ok: false, status: 422 });
  });
});

describe('executePayrollSend — o servidor monta e entrega', () => {
  const batch = { id: BATCH, status: 'validated', competence_month: '2026-08' };
  const parse = factsToParse({ competence_month: '2026-08', total_amount_cents: 5000, previous_month_amount_cents: 4000 },
    [{ cost_center_label: 'Obra <script>', amount_cents: 5000, previous_amount_cents: 4000 }], []);
  let repo: PayrollRepository;
  let recorded: unknown[];
  const intent = (over: Partial<PayrollEmailIntent> = {}): PayrollEmailIntent => ({
    kind: 'payroll_closing_package', batch_id: BATCH, audience: 'finance', to: [{ type: 'member', id: MEMBER }],
    cc: [{ type: 'contact', id: CONTACT }], attachment_ids: [ATT], confirm_sensitive: false, request_id: REQ, test: false, ...over,
  });

  beforeEach(() => {
    send.mockReset().mockResolvedValue({ outcome: 'SENT', provider: 'resend', messageId: 'm1' });
    permitted.clear();
    permitted.add('people.payroll_close');
    recorded = [];
    repo = {
      getEmailFacts: async () => ({ batch, parse, narrative: null }),
      listEmailContacts: async () => [{ id: CONTACT, email: 'contab@fora.example', display_name: 'Contab', created_by: null, created_at: '' }],
      listActiveMembers: async () => [{ user_id: MEMBER, full_name: 'Fin', email: 'fin@org.example' }],
      deliveredRecipients: async () => new Set<string>(),
      getDispatches: async () => [{ package_id: PKG, delivery_status: 'sent' }],
      getAttachments: async () => [
        { id: ATT, batch_id: BATCH, file_name: 'exec.html', file_type: 'executive_pdf', security_level: 'aggregate', file_size: 10 },
        { id: HOL, batch_id: BATCH, file_name: 'h.pdf', file_type: 'holerite', security_level: 'confidential', file_size: 10 },
      ],
      getAttachmentBytes: async (_a: unknown, id: string) => ({ bytes: Buffer.from(id), file_name: `${id}.bin`, mime_type: 'application/pdf', file_size: 10 }),
      findEmailPackageByRequest: async () => null,
      createEmailPackage: async (_a: unknown, _b: string, input: { subject: string; html_body: string }) => ({ id: PKG, batch_id: BATCH, status: 'draft', ...input }),
      recordDispatch: async (_a: unknown, input: unknown) => { recorded.push(input); return {}; },
    } as unknown as PayrollRepository;
  });
  const actor = { userId: 'u', organizationId: U(50) };

  it('entrega um e-mail por destinatário, com conteúdo e assunto do servidor, sem remetente do pedido', async () => {
    const r = await executePayrollSend(repo, actor, intent());
    expect(r.status).toBe(200);
    expect(send).toHaveBeenCalledTimes(2);
    const [msg, opts] = send.mock.calls[0];
    expect(Object.keys(msg).sort()).toEqual(['attachments', 'html', 'subject', 'text', 'to']);
    expect(msg.subject).toBe('Fechamento da Folha — 2026-08');
    expect(msg.html).toContain('Obra &lt;script&gt;');
    expect(msg.html).not.toContain('<script>');
    expect(msg.attachments[0]).toMatchObject({ filename: `${ATT}.bin`, bytes: expect.any(Buffer) });
    expect(opts.idempotencyKey).toMatch(new RegExp(`^payroll:${PKG}:[0-9a-f]{24}$`));
    expect(send.mock.calls.map((c) => c[0].to)).toEqual(['fin@org.example', 'contab@fora.example']);
    expect(recorded[0]).toMatchObject({ package_id: PKG, recipients: ['fin@org.example'], cc: ['contab@fora.example'], delivery_status: 'sent' });
  });

  it('ensaio não envia nem registra', async () => {
    const r = await executePayrollSend(repo, actor, intent({ test: true }));
    expect(r.body).toMatchObject({ test: true, delivery_status: 'simulated', recipients: 2 });
    expect(send).not.toHaveBeenCalled();
    expect(recorded).toEqual([]);
  });

  it('mesma intenção já enviada: devolve, não reenvia', async () => {
    repo.findEmailPackageByRequest = async () => ({ id: PKG, batch_id: BATCH, status: 'sent', audience: 'finance', attachment_ids: [ATT] }) as never;
    const r = await executePayrollSend(repo, actor, intent());
    expect(r.body).toMatchObject({ replay: true });
    expect(send).not.toHaveBeenCalled();
  });

  it('recusas: anexo alheio, sensível sem permissão, sensível sem confirmação, destinatário fora do diretório', async () => {
    expect((await executePayrollSend(repo, actor, intent({ attachment_ids: [U(77)] }))).status).toBe(422);
    expect((await executePayrollSend(repo, actor, intent({ attachment_ids: [HOL], confirm_sensitive: true }))).status).toBe(403);
    permitted.add('people.payroll_holerite_access'); permitted.add('people.payroll_send_sensitive');
    expect((await executePayrollSend(repo, actor, intent({ attachment_ids: [HOL] }))).status).toBe(400);
    expect((await executePayrollSend(repo, actor, intent({ attachment_ids: [HOL], confirm_sensitive: true }))).status).toBe(200);
    send.mockClear();
    expect((await executePayrollSend(repo, actor, intent({ to: [{ type: 'member', id: U(88) }] }))).status).toBe(422);
    expect(send).not.toHaveBeenCalled();
  });

  it('sem ler a folha (payroll_close), nenhum anexo sai', async () => {
    permitted.clear();
    expect((await executePayrollSend(repo, actor, intent())).status).toBe(403);
    expect(send).not.toHaveBeenCalled();
  });

  it('linha de anexo que aponta para fora é recusada (422), nada sai', async () => {
    repo.getAttachmentBytes = async () => { throw new Error('ATTACHMENT_LOCATION_INVALID: caminho fora'); };
    expect((await executePayrollSend(repo, actor, intent())).status).toBe(422);
    expect(send).not.toHaveBeenCalled();
  });

  it('nova tentativa do mesmo pacote: só quem ainda não recebeu; outra intenção com a mesma chave: 409', async () => {
    repo.findEmailPackageByRequest = async () => ({ id: PKG, batch_id: BATCH, status: 'failed', audience: 'finance', attachment_ids: [ATT] }) as never;
    repo.deliveredRecipients = async () => new Set(['fin@org.example']);
    const r = await executePayrollSend(repo, actor, intent());
    expect(r.status).toBe(200);
    expect(send.mock.calls.map((c) => c[0].to)).toEqual(['contab@fora.example']);
    expect(r.body).toMatchObject({ skipped: 1, sent: 1 });
    send.mockClear();
    expect((await executePayrollSend(repo, actor, intent({ audience: 'board' }))).status).toBe(409);
    expect((await executePayrollSend(repo, actor, intent({ attachment_ids: [] }))).status).toBe(409);
    expect(send).not.toHaveBeenCalled();
  });

  it('entregue e auditoria falhou: responde a entrega real (não 500, não convida a reenviar)', async () => {
    repo.recordDispatch = async () => { throw new Error('db down'); };
    const r = await executePayrollSend(repo, actor, intent());
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ delivery_status: 'sent', ledger: 'pending', sent: 2 });
  });

  it('falha parcial explica o que aconteceu', async () => {
    send.mockReset().mockResolvedValueOnce({ outcome: 'SENT', provider: 'resend', messageId: 'm1' }).mockRejectedValueOnce(new Error('429'));
    const r = await executePayrollSend(repo, actor, intent());
    expect(r.body).toMatchObject({ ok: false, delivery_status: 'partial', sent: 1, failed: 1 });
    expect(String(r.body.error)).toMatch(/Entregue a 1 de 2/);
  });

  it('fechamento de outro inquilino não existe; cancelado não envia', async () => {
    repo.getEmailFacts = async () => null;
    expect((await executePayrollSend(repo, actor, intent())).status).toBe(404);
    repo.getEmailFacts = async () => ({ batch: { ...batch, status: 'cancelled' }, parse, narrative: null }) as never;
    expect((await executePayrollSend(repo, actor, intent())).status).toBe(409);
  });
});
