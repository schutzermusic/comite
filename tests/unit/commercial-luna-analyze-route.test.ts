import { beforeEach, describe, expect, it, vi } from 'vitest';

const { generate, upload, audit } = vi.hoisted(() => ({
  generate: vi.fn(), upload: vi.fn().mockResolvedValue({ error: null }),
  audit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/ai/gateway', () => ({ getApexAIGateway: () => ({ generate }),
  ApexAIError: class ApexAIError extends Error {} }));
vi.mock('@/lib/commercial/server-session', () => ({
  requireCommercialSession: async () => ({ organizationId: 'org-1', user: { id: 'user-1' } }),
  isSessionError: () => false, hasOptionalPermission: async () => true,
}));
vi.mock('@/lib/platform/server-client', () => ({ platformServiceClient: () => ({ storage: { from: () => ({
  download: async () => ({ data: new Blob(['%PDF-1.4']), error: null }), upload,
}) } }) }));
vi.mock('@/lib/audit/log-audit-event-server', () => ({ logAuditEventServer: audit }));

import { POST } from '@/app/api/commercial/proposals/analyze/route';

const payload = {
  document: { role: 'COMBINED_PROPOSAL', revision_label: 'R02', title: 'Proposal',
    page: 1, excerpt: 'Proposal R02' },
  facts: [
    { domain: 'SCOPE', label: 'Scope', value_text: 'x', value_numeric: '', value_date: '',
      currency: '', page: 1, excerpt: 'literal scope', section: '', confidence: 0.8 },
    { domain: 'VALUE', label: 'Value', value_text: 'x', value_numeric: '100', value_date: '',
      currency: 'BRL', page: 2, excerpt: 'literal value', section: '', confidence: 0.8 },
  ],
};

const request = () => new Request('http://localhost/api/commercial/proposals/analyze', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ action: 'analyze', path: 'org-1/proposals/_staging/user-1/safe.pdf',
    fileName: 'safe.pdf', kind: 'COMBINED' }),
});

beforeEach(() => {
  generate.mockReset(); upload.mockClear(); audit.mockClear();
});

describe('commercial analyze route', () => {
  it('returns a Review payload with both PT and PC facts after validation', async () => {
    generate.mockResolvedValue({ output: payload, stopReason: 'completed', provenance: {
      provider: 'openai', model: 'gpt-6-luna', task: 'COMMERCIAL_DOCUMENT_EXTRACTION',
      durationMs: 100, usage: { inputTokens: 10, outputTokens: 20 }, attempts: 1,
    } });
    const response = await POST(request());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.facts).toHaveLength(2);
    expect(body.facts.map((fact: { documentContext: string }) => fact.documentContext))
      .toEqual(['TECHNICAL_PROPOSAL', 'COMMERCIAL_PROPOSAL']);
    expect(upload).toHaveBeenCalledOnce();
    expect(upload.mock.calls[0][2]).toMatchObject({ contentType: 'text/plain' });
    expect(upload.mock.calls[0][1]).toBeInstanceOf(Blob);
    expect(audit).toHaveBeenCalledOnce();
  });

  it('fails closed before staging when required fields are missing', async () => {
    generate.mockResolvedValue({ output: { facts: payload.facts }, stopReason: 'completed', provenance: {
      provider: 'openai', model: 'gpt-6-luna', task: 'COMMERCIAL_DOCUMENT_EXTRACTION',
      durationMs: 100, usage: { inputTokens: 10, outputTokens: 20 }, attempts: 1,
    } });
    const response = await POST(request());
    expect(response.status).toBe(502);
    expect((await response.json()).detail).toBe('Falha na etapa validation.');
    expect(upload).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });
});
