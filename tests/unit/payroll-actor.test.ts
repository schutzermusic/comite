/**
 * A permissão da folha é checada NA organização que o pedido vai usar — lida
 * uma vez. Antes: `current_user_has_permission` (organização ativa AGORA) numa
 * chamada e a organização lida em outra; trocar de organização entre as duas
 * fazia agir numa organização com a permissão da outra.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { orgReads, rpc } = vi.hoisted(() => ({ orgReads: vi.fn(), rpc: vi.fn() }));
vi.mock('@/utils/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) } }),
}));
vi.mock('@/lib/auth/active-organization', () => ({ getActiveOrganizationRow: orgReads }));
vi.mock('@/lib/platform/server-client', () => ({ platformServiceClient: () => ({ rpc }) }));

import { actorCan, resolvePayrollActor } from '@/lib/payroll/repository/actor';

beforeEach(() => { orgReads.mockReset(); rpc.mockReset(); });

describe('resolvePayrollActor', () => {
  it('lê a organização UMA vez e checa a permissão nela, mesmo se a ativa mudar depois', async () => {
    orgReads.mockResolvedValueOnce({ organization_id: 'org-A' }).mockResolvedValue({ organization_id: 'org-B' });
    rpc.mockResolvedValue({ data: true, error: null });
    const r = await resolvePayrollActor('people.payroll_send');
    expect(r).toEqual({ ok: true, actor: { userId: 'user-1', organizationId: 'org-A' } });
    expect(orgReads).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('payroll_actor_can', { p_organization_id: 'org-A', p_actor: 'user-1', p_key: 'people.payroll_send' });
  });

  it('sem permissão na organização do pedido: 403; sem organização: 403; erro na checagem: 500', async () => {
    orgReads.mockResolvedValue({ organization_id: 'org-A' });
    rpc.mockResolvedValue({ data: false, error: null });
    expect(((await resolvePayrollActor('people.payroll_send')) as { response: Response }).response.status).toBe(403);
    orgReads.mockResolvedValue(null);
    expect(((await resolvePayrollActor('people.payroll_send')) as { response: Response }).response.status).toBe(403);
    orgReads.mockResolvedValue({ organization_id: 'org-A' });
    rpc.mockResolvedValue({ data: null, error: { message: 'down' } });
    expect(((await resolvePayrollActor('people.payroll_send')) as { response: Response }).response.status).toBe(500);
  });

  it('actorCan pergunta pela organização do ator, não pela sessão', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    await actorCan({ userId: 'u', organizationId: 'org-X' }, 'people.payroll_close');
    expect(rpc).toHaveBeenCalledWith('payroll_actor_can', { p_organization_id: 'org-X', p_actor: 'u', p_key: 'people.payroll_close' });
  });
});
