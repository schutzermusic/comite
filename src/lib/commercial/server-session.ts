/**
 * Fronteira de autorização das rotas do Comercial.
 *
 * O padrão é o mesmo de `contracts/onboarding/server-auth.ts`: a rota decide
 * a autorização com o cliente AUTENTICADO, e só depois entrega a escrita à
 * função governada pelo service role. A RLS continua sendo a fronteira; isto
 * é o alinhamento do servidor com ela, e a recusa amigável antes de um erro
 * de banco.
 */
import { NextResponse } from 'next/server';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { createClient } from '@/utils/supabase/server';
import { requireActiveOrganizationId } from '@/lib/auth/active-organization';

type PermissionShape = { roles?: { role_permissions?: Array<{ permissions?: { key?: string } }> } };

export interface CommercialSession {
  supabase: SupabaseClient;
  user: User;
  organizationId: string;
  permissions: Set<string>;
}

export type SessionResult = CommercialSession | { error: NextResponse };

export async function requireCommercialSession(
  required: string[],
): Promise<SessionResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ ok: false, error: 'Não autenticado.' }, { status: 401 }) };
  }

  /*
    A ORGANIZAÇÃO ATIVA é resolvida ANTES da permissão, e não depois.

    A ordem importa e a primeira versão deste arquivo a tinha invertida.
    `current_user_has_permission` — o resolvedor canônico que a RLS usa —
    exige `user_roles.organization_id = current_user_organization_id()`. Ler
    os papéis sem esse filtro responde "esta pessoa tem a permissão em ALGUMA
    organização", que é outra pergunta.

    Numa rota de LEITURA a diferença seria só desagradável: o portão deixaria
    passar e a RLS devolveria vazio. Numa rota de ESCRITA seria um furo real —
    as funções governadas rodam pelo service_role, que não passa por RLS, e
    recebem a organização ATIVA. Alguém com papel de Jurídico/Contratos na
    organização A, operando na B, passaria pelo portão e escreveria na B sem
    ter o papel lá.
  */
  let organizationId: string;
  try {
    organizationId = await requireActiveOrganizationId(supabase);
  } catch {
    return { error: NextResponse.json(
      { ok: false, error: 'Nenhuma organização ativa selecionada.' }, { status: 403 }) };
  }

  const { data: rows, error } = await supabase.from('user_roles')
    .select('roles!inner(role_permissions!inner(permissions!inner(key)))')
    .eq('user_id', user.id)
    .eq('organization_id', organizationId);
  if (error) {
    return { error: NextResponse.json(
      { ok: false, error: 'Não foi possível verificar a permissão.' }, { status: 500 }) };
  }

  const permissions = new Set<string>();
  for (const row of (rows ?? []) as unknown as PermissionShape[]) {
    for (const item of row.roles?.role_permissions ?? []) {
      if (item.permissions?.key) permissions.add(item.permissions.key);
    }
  }

  /*
    Sobreposições por usuário (`user_permission_overrides`, migration 014) são
    consultadas pelo MESMO resolvedor do banco, para que portão e RLS nunca
    discordem. `deny` vence `grant`, e ambos vencem o papel — exatamente como
    em `current_user_has_permission`.
  */
  for (const key of required) {
    const { data: resolved } = await supabase.rpc('current_user_has_permission', {
      permission_key: key,
    });
    if (resolved === true) permissions.add(key);
    else if (resolved === false) permissions.delete(key);
  }

  const missing = required.filter((key) => !permissions.has(key));
  if (missing.length > 0) {
    // A mensagem NOMEIA a permissão faltante: "acesso negado" sem dizer o quê
    // transforma um problema de alçada em um chamado de suporte.
    return { error: NextResponse.json({ ok: false,
      error: `Esta ação exige: ${missing.join(', ')}.` }, { status: 403 }) };
  }

  // A organização já foi resolvida no topo; não resta nada que possa lançar.
  return { supabase, user, organizationId, permissions };
}

export function isSessionError(result: SessionResult): result is { error: NextResponse } {
  return 'error' in result;
}

/**
 * Uma permissão OPCIONAL — a que decide se uma SEÇÃO aparece, não se a rota
 * responde.
 *
 * O caso concreto é o dossiê da proposta: divergências, ordens de serviço e
 * trabalho autorizado vivem sob `contracts.view` (migrations 197 e 200), e
 * quem tem só alçada comercial não os enxerga. Exigir `contracts.view` na rota
 * inteira tiraria a proposta de quem tem direito a ela; ignorar a permissão e
 * consultar mesmo assim devolveria vazio, e a tela diria "nenhuma divergência"
 * quando a verdade é "você não pode ver as divergências".
 *
 * Por isso a pergunta é feita ao MESMO resolvedor que a RLS usa — sobreposições
 * por usuário incluídas — e a resposta vira uma seção presente, ausente ou
 * explicitamente reservada.
 */
export async function hasOptionalPermission(
  session: CommercialSession, key: string,
): Promise<boolean> {
  if (session.permissions.has(key)) return true;
  const { data } = await session.supabase.rpc('current_user_has_permission', {
    permission_key: key,
  });
  if (data === true) session.permissions.add(key);
  return data === true;
}

/**
 * Traduz o erro do banco para uma resposta segura.
 *
 * Os portões governados falham com mensagens que a pessoa PRECISA ler — "a OS
 * não pode ser emitida: 1 divergência bloqueante em aberto" é a resposta
 * certa, e escondê-la atrás de "erro interno" tornaria o portão invisível.
 * O que não passa é detalhe de esquema: nome de constraint, SQLSTATE e stack.
 */
const SAFE_PREFIXES = [
  'Service order cannot be issued',
  'Blueprint cannot be consumed',
  'Proposal revision',
  'Only an ACCEPTED',
  'Engagement has no governing authorization',
  'Engagement is',
  'Changing the governing source requires',
  'Resolving a divergence requires',
  'Customer outcome must be recorded',
  'Acceptance must state',
  'Project ',
  'Only an ISSUED',
  // Etapa governada e acompanhamento (212). Mesma razão das de cima: a recusa
  // diz o que fazer — "encerrar exige motivo" é a resposta certa, e escondê-la
  // atrás de "erro interno" transformaria a regra em um mistério.
  'Opportunity is already',
  'Opportunity stage',
  'Opportunity closure',
  'Opportunity not found',
  'Permission required',
  'Completion requires',
  'Waiting for an external party',
  'A governed follow-up requires',
  'Idempotency key',
];

export function safeGovernedError(message: string | undefined): string {
  const text = (message ?? '').trim();
  if (SAFE_PREFIXES.some((prefix) => text.startsWith(prefix))) return text;
  return 'A operação foi recusada pelas regras de governança do trabalho autorizado.';
}
