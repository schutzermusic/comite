/**
 * Rotas de OS em Operações — a fronteira do servidor:
 *  • emissão sob exceção exige a alçada de OS E `operations.service_orders.override`;
 *  • motivo curto nem chega ao banco;
 *  • gerar do pacote é idempotente: reuso não reconfronta;
 *  • importar: caminho fora da área de OS do inquilino é recusado antes do banco;
 *    sem `commercial.documents.ingest` o PDF é registrado SEM leitura; leitura
 *    que falha não perde o documento;
 *  • revisão em lote chega ao banco no formato da função governada.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const { svc, extraction, audit, perms, storage } = vi.hoisted(() => ({
  svc: {
    generateFromPackage: vi.fn(), compareWithGoverning: vi.fn(), registerUpload: vi.fn(),
    issue: vi.fn(), issueWithException: vi.fn(), decideItems: vi.fn(), upsertItem: vi.fn(),
    updateDraft: vi.fn(), amend: vi.fn(), seedFromPackage: vi.fn(), applyExtraction: vi.fn(),
    recordDivergence: vi.fn(),
  },
  extraction: { extractUploadedServiceOrder: vi.fn(), reviewDivergencesWithAI: vi.fn() },
  audit: vi.fn().mockResolvedValue(undefined),
  perms: new Set<string>(),
  storage: { createSignedUploadUrl: vi.fn(), download: vi.fn(), remove: vi.fn().mockResolvedValue({ data: [], error: null }) },
}));

vi.mock('@/lib/commercial/server-session', () => ({
  requireCommercialSession: async (required: string[]) => {
    const missing = required.filter((k) => !perms.has(k));
    if (missing.length) return { error: NextResponse.json({ ok: false, error: `Esta ação exige: ${missing.join(', ')}.` }, { status: 403 }) };
    return { organizationId: 'org-1', user: { id: 'user-1' }, permissions: perms, supabase: {} };
  },
  isSessionError: (r: object) => 'error' in r,
  hasOptionalPermission: async (_s: unknown, key: string) => perms.has(key),
  safeGovernedError: () => 'A operação foi recusada pelas regras de governança do trabalho autorizado.',
}));
vi.mock('@/lib/operations/service-orders/service', () => svc);
vi.mock('@/lib/operations/service-orders/extraction', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/lib/operations/service-orders/extraction');
  return { ...actual, ...extraction };
});
vi.mock('@/lib/audit/log-audit-event-server', () => ({ logAuditEventServer: audit }));
vi.mock('@/lib/platform/server-client', () => ({
  platformServiceClient: () => ({ storage: { from: () => storage } }),
}));
vi.mock('@/lib/ai/gateway', () => ({ getApexAIGateway: () => ({ generate: vi.fn() }) }));

import { POST as issuePOST } from '@/app/api/operations/service-orders/[id]/issue/route';
import { POST as generatePOST } from '@/app/api/operations/service-orders/generate/route';
import { POST as uploadPOST } from '@/app/api/operations/service-orders/upload/route';
import { PUT as itemsPUT } from '@/app/api/operations/service-orders/[id]/items/route';

const OS = '44444444-4444-4444-8444-444444444444';
const ENG = '55555555-5555-4555-8555-555555555555';
const ACC = '66666666-6666-4666-8666-666666666666';
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (body: unknown, method = 'POST') => new Request('http://x', {
  method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});
const SHA = 'b'.repeat(64);

beforeEach(() => {
  Object.values(svc).forEach((f) => f.mockReset());
  Object.values(extraction).forEach((f) => f.mockReset());
  storage.createSignedUploadUrl.mockReset();
  audit.mockClear();
  perms.clear();
  perms.add('commercial.service_orders.manage');
  svc.compareWithGoverning.mockResolvedValue({ compared: true, divergences_opened: 0 });
});

describe('emissão', () => {
  it('exceção sem operations.service_orders.override é 403 e não chega ao banco', async () => {
    const res = await issuePOST(req({ mode: 'exception', reason: 'Motivo longo o bastante para a exceção' }), params(OS));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain('operations.service_orders.override');
    expect(svc.issueWithException).not.toHaveBeenCalled();
  });
  it('motivo curto é 400 antes de qualquer permissão', async () => {
    perms.add('operations.service_orders.override');
    const res = await issuePOST(req({ mode: 'exception', reason: 'curto' }), params(OS));
    expect(res.status).toBe(400);
    expect(svc.issueWithException).not.toHaveBeenCalled();
  });
  it('exceção autorizada passa ator, motivo e evidência à função governada e audita', async () => {
    perms.add('operations.service_orders.override');
    svc.issueWithException.mockResolvedValue({ service_order_id: OS, status: 'ISSUED', exception_id: 'e1', divergences_waived: 2 });
    const res = await issuePOST(req({ mode: 'exception', reason: 'Cliente confirmou por ata o valor da OS' }), params(OS));
    expect(res.status).toBe(200);
    expect(svc.issueWithException).toHaveBeenCalledWith('org-1', 'user-1', OS, 'Cliente confirmou por ata o valor da OS', null);
    expect(audit.mock.calls[0][0]).toMatchObject({ action: 'operations.service_order.issued_with_exception',
      metadata: { exceptionId: 'e1', waived: 2 } });
  });
  it('recusa do portão chega legível (a pessoa precisa saber o que falta)', async () => {
    svc.issue.mockRejectedValue(new Error('Service order cannot be issued: 2 content line(s) still awaiting human review.'));
    const res = await issuePOST(req({ mode: 'normal' }), params(OS));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain('awaiting human review');
  });
  it('sem a alçada de OS nem a emissão normal passa', async () => {
    perms.clear();
    expect((await issuePOST(req({ mode: 'normal' }), params(OS))).status).toBe(403);
  });
});

describe('gerar a partir do pacote', () => {
  it('corpo sem aceite é 400', async () => {
    expect((await generatePOST(req({}))).status).toBe(400);
  });
  it('gera, confronta e audita; reuso não reconfronta', async () => {
    svc.generateFromPackage.mockResolvedValueOnce({ service_order_id: OS, status: 'DRAFT', reused: false, items_added: 6 });
    const first = await (await generatePOST(req({ acceptanceId: ACC, siteLabel: 'Subestação' }))).json();
    expect(first).toMatchObject({ ok: true, serviceOrderId: OS, reused: false, itemsAdded: 6 });
    expect(svc.generateFromPackage.mock.calls[0][3]).toMatchObject({ site_label: 'Subestação' });
    expect(svc.compareWithGoverning).toHaveBeenCalledTimes(1);

    svc.generateFromPackage.mockResolvedValueOnce({ service_order_id: OS, status: 'DRAFT', reused: true, items_added: 0 });
    const again = await (await generatePOST(req({ acceptanceId: ACC }))).json();
    expect(again.reused).toBe(true);
    expect(svc.compareWithGoverning).toHaveBeenCalledTimes(1);
    expect(audit.mock.calls[1][0].action).toBe('operations.service_order.generate_reused');
  });
});

describe('importar OS', () => {
  const register = (over: Record<string, unknown> = {}) => req({ action: 'register', engagementId: ENG,
    path: `org-1/service-orders/abc-os.pdf`, fileName: 'os.pdf', contentSha256: SHA, ...over });
  const pdf = new Blob([new TextEncoder().encode('%PDF-1.7\n% OS de teste\n')], { type: 'application/pdf' });
  beforeEach(() => { storage.download.mockResolvedValue({ data: pdf, error: null }); });

  it('só PDF recebe envio assinado, em caminho gerado pelo servidor dentro do inquilino', async () => {
    expect((await uploadPOST(req({ action: 'authorize', fileName: 'os.docx', mimeType: 'application/msword', fileSize: 10 }))).status).toBe(400);
    storage.createSignedUploadUrl.mockResolvedValue({ data: { token: 't' }, error: null });
    const ok = await (await uploadPOST(req({ action: 'authorize', fileName: 'OS 01.pdf', mimeType: 'application/pdf', fileSize: 10 }))).json();
    expect(ok.path).toMatch(/^org-1\/service-orders\/[0-9a-f-]{36}-OS_01\.pdf$/);
  });
  it('caminho fora da área de OS do inquilino é 403 e não registra nada', async () => {
    for (const path of ['org-2/service-orders/x.pdf', 'org-1/proposals/x.pdf', 'org-1/service-orders/../x.pdf']) {
      const res = await uploadPOST(register({ path }));
      expect(res.status).toBe(403);
    }
    expect(svc.registerUpload).not.toHaveBeenCalled();
  });
  it('o hash registrado é o do CONTEÚDO baixado pelo servidor, não o que o cliente afirmou', async () => {
    svc.registerUpload.mockResolvedValue({ service_order_id: OS, document_id: 'd1', reused: false });
    await uploadPOST(register({ contentSha256: 'c'.repeat(64) }));
    const payload = svc.registerUpload.mock.calls[0][3] as { content_sha256: string };
    expect(payload.content_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(payload.content_sha256).not.toBe('c'.repeat(64));
  });
  it('arquivo que não é PDF de verdade é 415 e é removido do armazenamento', async () => {
    storage.download.mockResolvedValue({ data: new Blob([new TextEncoder().encode('<html>não é pdf</html>')]), error: null });
    const res = await uploadPOST(register());
    expect(res.status).toBe(415);
    expect(storage.remove).toHaveBeenCalledWith(['org-1/service-orders/abc-os.pdf']);
    expect(svc.registerUpload).not.toHaveBeenCalled();
  });
  it('sem permissão de leitura: registra, confronta, e diz que não leu', async () => {
    svc.registerUpload.mockResolvedValue({ service_order_id: OS, document_id: 'd1', reused: false });
    const out = await (await uploadPOST(register())).json();
    expect(out).toMatchObject({ ok: true, serviceOrderId: OS, reading: { state: 'skipped' } });
    expect(extraction.extractUploadedServiceOrder).not.toHaveBeenCalled();
    expect(svc.compareWithGoverning).toHaveBeenCalledWith('org-1', OS);
  });
  it('leitura que falha não perde o documento', async () => {
    perms.add('commercial.documents.ingest');
    svc.registerUpload.mockResolvedValue({ service_order_id: OS, document_id: 'd1', reused: false });
    extraction.extractUploadedServiceOrder.mockRejectedValue(new Error('provider down'));
    const res = await uploadPOST(register());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ serviceOrderId: OS, documentId: 'd1', reading: { state: 'failed' } });
  });
  it('leitura bem-sucedida devolve fatos e linhas pendentes', async () => {
    perms.add('commercial.documents.ingest');
    svc.registerUpload.mockResolvedValue({ service_order_id: OS, document_id: 'd1', reused: false });
    extraction.extractUploadedServiceOrder.mockResolvedValue({ facts: 7, discarded: 1, itemsAdded: 6, provider: 'openai', model: 'm' });
    const out = await (await uploadPOST(register())).json();
    expect(out.reading).toEqual({ state: 'read', facts: 7, itemsAdded: 6, model: 'm' });
    expect(extraction.extractUploadedServiceOrder.mock.calls[0][0]).toMatchObject({
      organizationId: 'org-1', actorId: 'user-1', serviceOrderId: OS, engagementId: ENG, documentId: 'd1' });
  });
});

describe('revisão de linhas', () => {
  it('decisões chegam no formato da função governada e o confronto roda de novo', async () => {
    svc.decideItems.mockResolvedValue({ decided: 2 });
    const res = await itemsPUT(req({ decisions: [
      { itemId: OS, decision: 'CONFIRMED' }, { itemId: ENG, decision: 'REJECTED' }] }, 'PUT'), params(OS));
    expect(res.status).toBe(200);
    expect(svc.decideItems).toHaveBeenCalledWith('org-1', 'user-1', OS,
      [{ item_id: OS, decision: 'CONFIRMED' }, { item_id: ENG, decision: 'REJECTED' }]);
    expect(svc.compareWithGoverning).toHaveBeenCalled();
  });
  it('decisão fora do vocabulário é 400', async () => {
    const res = await itemsPUT(req({ decisions: [{ itemId: OS, decision: 'APPROVED' }] }, 'PUT'), params(OS));
    expect(res.status).toBe(400);
  });
});
