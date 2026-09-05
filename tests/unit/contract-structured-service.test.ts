import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadContractAsOf } from '@/lib/contracts/structured-contract-service';

const mock = vi.hoisted(() => ({ tables: {} as Record<string, Record<string, unknown>[]>, fail: '', filters: [] as string[] }));
vi.mock('@/utils/supabase/client', () => ({ createClient: () => ({
  auth: { getUser: async () => ({ data: { user: { id: 'user-a' } }, error: null }) },
  from: (table: string) => {
    let column = ''; let ids: string[] = [];
    const q = {
      select: () => q,
      eq: (key: string, value: string) => { mock.filters.push(`${table}:${key}:${value}`); return q; },
      in: (key: string, values: string[]) => { column = key; ids = values; return q; },
      order: () => q,
      single: async () => ({ data: { organization_id: 'org-a' }, error: null }),
      range: async (from: number, to: number) => ({
        data: table === mock.fail ? null : (mock.tables[table] ?? []).filter(row => ids.includes(String(row[column]))).slice(from, to + 1),
        error: table === mock.fail ? { message: 'source unavailable' } : null,
      }),
    }; return q;
  },
}) }));

beforeEach(() => {
  mock.fail = ''; mock.filters = [];
  mock.tables = { contracts: [{ id: 'child', organization_id: 'org-a', start_date: '2020-01-01', end_date: null, total_value: null }] };
});
describe('structured Contracts reads', () => {
  it('keeps absence missing and filters each source by authenticated organization', async () => {
    const state = await loadContractAsOf('child', '2026-01-01');
    expect(state.guarantees.effective.trust).toBe('missing');
    for (const table of ['contracts','contract_instrument_lineage','contract_guarantees','contract_insurance_requirements','contract_indexation_rules','contract_billing_conditions','contract_measurement_requirements']) {
      expect(mock.filters).toContain(`${table}:organization_id:org-a`);
    }
  });
  it('does not turn a failed source into an empty requirement list', async () => {
    mock.fail = 'contract_guarantees';
    await expect(loadContractAsOf('child','2026-01-01')).rejects.toThrow('source unavailable');
  });
  it('rejects an inaccessible ancestor instead of projecting the child alone', async () => {
    mock.tables.contract_instrument_lineage = [{ id: 'edge',organization_id: 'org-a',contract_id: 'child',amendment_id: null,parent_contract_id: 'hidden',root_contract_id: 'hidden' }];
    await expect(loadContractAsOf('child','2026-01-01')).rejects.toThrow('sem permissão');
  });
  it('paginates rather than silently truncating fact history', async () => {
    mock.tables.contract_guarantees = Array.from({ length: 501 }, (_, i) => ({
      id: String(i), organization_id: 'org-a', contract_id: 'child', source_amendment_id: null,
      predecessor_id: null, effective_from: '2020-01-01',effective_until: null,effect: 'added',created_at: '2020-01-01',
    }));
    const state = await loadContractAsOf('child','2026-01-01');
    expect(state.guarantees.history).toHaveLength(501);
  });
  it('validates the query date before accessing the database', async () => {
    await expect(loadContractAsOf('child','2026-02-31')).rejects.toThrow('Invalid');
    expect(mock.filters).toHaveLength(0);
  });
});
