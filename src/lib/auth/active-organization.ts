import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Fase 7.5 — a organização ATIVA, resolvida por quem tem autoridade para
 * resolvê-la: o banco.
 *
 * ─── Por que não ler `profiles.organization_id` ───────────────────────────
 *
 * Até a Fase 7 o produto tinha um inquilino por pessoa, e `profiles` era a
 * resposta. `profiles.user_id` é UNIQUE — com essa restrição, "pertencer a
 * duas organizações" é inexprimível. A partir da 145 a resposta é
 * `current_user_organization_id()`, que exige VÍNCULO ATIVO em organização
 * ATIVA e honra a escolha guardada no servidor.
 *
 * A diferença importa mesmo com RLS por trás. Se uma rota continuasse
 * escrevendo com a organização DE ORIGEM enquanto a pessoa opera noutra, o
 * banco recusaria (o `WITH CHECK` não bate) — seguro, porém quebrado. Ler a
 * organização ativa daqui é o que faz a troca funcionar de fato.
 *
 * Isto NÃO é a fronteira de segurança: a fronteira é a RLS. É o alinhamento do
 * servidor com ela.
 */
export type ActiveOrganizationState =
  | { kind: 'ACTIVE'; organizationId: string }
  | { kind: 'NO_ORGANIZATION' };

export async function resolveActiveOrganization(
  supabase: SupabaseClient,
): Promise<ActiveOrganizationState> {
  const { data, error } = await supabase.rpc('current_user_organization_id');
  if (error || !data) return { kind: 'NO_ORGANIZATION' };
  return { kind: 'ACTIVE', organizationId: String(data) };
}

/**
 * Forma compatível com o que as rotas liam de `profiles`, para que a migração
 * dos 19 pontos de leitura fosse uma troca de fonte e não uma reescrita de
 * lógica em cada rota.
 */
export async function getActiveOrganizationRow(
  supabase: SupabaseClient,
): Promise<{ organization_id: string } | null> {
  const state = await resolveActiveOrganization(supabase);
  return state.kind === 'ACTIVE' ? { organization_id: state.organizationId } : null;
}

export type OrganizationOption = {
  organization_id: string;
  name: string;
  slug: string;
  status: string;
  enterprise_account_id: string;
  enterprise_name: string;
  membership_status: 'ACTIVE' | 'SUSPENDED' | 'INVITED';
  is_active_context: boolean;
};

export async function listMyOrganizations(
  supabase: SupabaseClient,
): Promise<OrganizationOption[]> {
  const { data, error } = await supabase.rpc('my_organizations');
  if (error || !data) return [];
  return data as OrganizationOption[];
}

/**
 * Os estados que a interface precisa distinguir (§32). Colapsar qualquer um
 * deles em "algo deu errado" é o que a fase proíbe: uma pessoa sem vínculo,
 * uma com vínculo suspenso e uma cuja organização foi arquivada precisam de
 * três respostas diferentes, e nenhuma delas é um erro genérico.
 */
export type OrganizationAccessState =
  | 'ACTIVE'
  | 'NO_ORGANIZATION'
  | 'NO_MEMBERSHIP'
  | 'MEMBERSHIP_SUSPENDED'
  | 'ORGANIZATION_SUSPENDED'
  | 'ORGANIZATION_ARCHIVED';

export function deriveAccessState(
  activeOrganizationId: string | null,
  options: OrganizationOption[],
): OrganizationAccessState {
  if (activeOrganizationId) return 'ACTIVE';
  if (options.length === 0) return 'NO_ORGANIZATION';
  if (options.some((o) => o.membership_status === 'SUSPENDED')) return 'MEMBERSHIP_SUSPENDED';
  if (options.some((o) => o.status === 'archived')) return 'ORGANIZATION_ARCHIVED';
  if (options.some((o) => o.status === 'suspended')) return 'ORGANIZATION_SUSPENDED';
  return 'NO_MEMBERSHIP';
}
