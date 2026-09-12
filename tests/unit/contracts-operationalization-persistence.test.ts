import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('operationalization persistence failures', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('cannot report success when obligation materialization fails after a fact insert', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://synthetic.test');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'synthetic-service-key');
    const analysisUpdates: Array<Record<string, unknown>> = [];
    const document = {
      id: '20000000-0000-0000-0000-000000000001',
      contract_id: '20000000-0000-0000-0000-000000000002',
      organization_id: '20000000-0000-0000-0000-000000000003',
      title: 'Synthetic test document',
      file_path: 'tests/synthetic.pdf',
    };

    const client = {
      storage: {
        from: () => ({
          download: async () => ({ data: new Blob([new Uint8Array([1, 2, 3])]), error: null }),
        }),
      },
      rpc: async (name: string) => name === 'contract_obligations_materialize'
        ? { data: null, error: { message: 'injected materialization failure' } }
        : { data: null, error: null },
      from: (table: string) => {
        let operation: 'read' | 'insert' | 'update' = 'read';
        let payload: Record<string, unknown> | Array<Record<string, unknown>> | null = null;
        const result = () => ({ data: [], error: null, count: 0 });
        const builder = {
          select: (_columns?: string, options?: { count?: string; head?: boolean }) => {
            if (table === 'contract_ai_analyses' && operation === 'insert') return builder;
            if (table === 'contract_obligation_definitions' && operation === 'insert') {
              return Promise.resolve({ data: [{ id: '20000000-0000-0000-0000-000000000005' }], error: null });
            }
            if (options?.head) return builder;
            return builder;
          },
          insert: (value: typeof payload) => {
            operation = 'insert';
            payload = value;
            return builder;
          },
          update: (value: Record<string, unknown>) => {
            operation = 'update';
            payload = value;
            if (table === 'contract_ai_analyses') analysisUpdates.push(value);
            return builder;
          },
          eq: () => builder,
          maybeSingle: async () => table === 'contract_documents'
            ? { data: document, error: null }
            : { data: null, error: null },
          single: async () => table === 'contract_ai_analyses' && operation === 'insert'
            ? { data: { id: '20000000-0000-0000-0000-000000000004' }, error: null }
            : { data: null, error: null },
          then: (resolve: (value: ReturnType<typeof result>) => unknown) => resolve(result()),
        };
        return builder;
      },
    };

    vi.doMock('@supabase/supabase-js', () => ({ createClient: () => client }));
    vi.doMock('@/lib/ai/contract-clause-extractor', () => ({ countPdfPages: () => 1 }));
    vi.doMock('@/lib/ai/gateway', () => ({
      getApexAITaskPolicy: () => ({ provider: 'test-provider', model: 'test-model' }),
      getApexAIGateway: () => ({
        generate: async () => ({
          // Compact provider transport: one generic item list with flat
          // name/value string attributes, reconstructed deterministically by
          // normalizeCompactContractOperationalization() before persistence.
          output: {
            items: [{
              kind: 'obligation',
              title: 'Synthetic obligation',
              attributes: [
                { name: 'requirement_text', value: 'Deliver the synthetic report.' },
                { name: 'responsible_side', value: 'contracting_organization' },
                { name: 'activation_kind', value: 'manual' },
                { name: 'due_kind', value: 'unspecified' },
                { name: 'calendar_basis', value: 'unspecified' },
                { name: 'recurrence_kind', value: 'one_time' },
              ],
              page: 1,
              excerpt: 'Deliver the synthetic report.',
              confidence: 0.91,
              ambiguous: false,
              conflicting: false,
            }],
          },
          provenance: {
            provider: 'test-provider', model: 'test-model',
            usage: { inputTokens: 10, outputTokens: 20 },
          },
        }),
      }),
    }));

    const { operationalizeContractDocument } = await import('@/lib/ai/contract-operationalization');
    await expect(operationalizeContractDocument(
      document.contract_id,
      document.id,
      '20000000-0000-0000-0000-000000000006',
    )).rejects.toThrow('injected materialization failure');

    expect(analysisUpdates).toContainEqual(expect.objectContaining({
      status: 'failed',
      extracted_data: expect.objectContaining({
        partial_failure: expect.objectContaining({
          retryable: true,
          persisted: expect.objectContaining({ obligations: 1 }),
        }),
      }),
    }));
    expect(analysisUpdates.some((update) => update.status === 'completed')).toBe(false);
  });
});
