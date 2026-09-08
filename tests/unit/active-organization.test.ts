import { describe, expect, it, vi } from 'vitest';
import {
  deriveAccessState,
  requireActiveOrganizationId,
  type OrganizationOption,
} from '@/lib/auth/active-organization';

const option = (overrides: Partial<OrganizationOption> = {}): OrganizationOption => ({
  organization_id: 'org-a',
  name: 'Org A',
  slug: 'org-a',
  status: 'active',
  enterprise_account_id: 'ea-a',
  enterprise_name: 'EA A',
  membership_status: 'ACTIVE',
  is_active_context: false,
  ...overrides,
});

describe('active organization fail-closed state', () => {
  it('exposes selection required when eligible memberships exist but none is active', () => {
    expect(deriveAccessState(null, [option(), option({ organization_id: 'org-b' })]))
      .toBe('SELECTION_REQUIRED');
  });

  it('does not fall back to profile state when the resolver returns null', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    await expect(requireActiveOrganizationId({ rpc } as never))
      .rejects.toThrow('Usuário sem organização ativa');
    expect(rpc).toHaveBeenCalledWith('current_user_organization_id');
  });
});
