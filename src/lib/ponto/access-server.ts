/**
 * Ponto employee-access lifecycle (server-only). Builds on the EXISTING
 * Supabase Auth invitation/recovery flow (admin.generateLink) — never a
 * custom token system. Links the invited auth user to the canonical
 * `people` row (people.profile_id -> profiles.id -> auth.users), grants
 * ONLY the `ponto_field_worker` role, and e-mails a single-use activation
 * link. Passwords/tokens are never stored or logged.
 */
if (typeof window !== 'undefined') {
  throw new Error('src/lib/ponto/access-server.ts must not be imported in the browser');
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { getServiceClient } from '@/lib/ai/server-clients';
import { getWorkspaceName } from '@/lib/branding';
import {
  allowedActions,
  type PontoAccessAction,
  type PontoAccessInfo,
  type PontoAccessStatus,
} from '@/lib/ponto/access-types';

export const PONTO_ROLE_KEY = 'ponto_field_worker';
export const RESEND_COOLDOWN_MS = 60_000; // 60s entre convites (anti-spam)
export const INVITE_EXPIRY_HOURS = 24; // janela de exibição de "expirado"

type AuthState = {
  user_id: string;
  email: string | null;
  email_confirmed_at: string | null;
  banned_until: string | null;
  last_sign_in_at: string | null;
};

export interface PersonAccessRow {
  id: string;
  organization_id: string;
  full_name: string;
  email: string | null;
  profile_id: string | null;
  access_invited_at: string | null;
  access_invite_count: number;
  access_blocked: boolean;
}

const PERSON_ACCESS_COLS =
  'id, organization_id, full_name, email, profile_id, access_invited_at, access_invite_count, access_blocked';

export class AccessError extends Error {
  constructor(message: string, readonly status = 400, readonly code = 'access_error') {
    super(message);
  }
}

/* ─────────────────────────── status ─────────────────────────── */

function statusFor(person: PersonAccessRow, auth: AuthState | undefined): PontoAccessStatus {
  const bannedActive = !!auth?.banned_until && new Date(auth.banned_until) > new Date();
  if (person.access_blocked || bannedActive) return 'blocked';
  if (!person.profile_id || !auth) return 'no_access';
  if (auth.email_confirmed_at) return 'active';
  if (person.access_invited_at) {
    const ageMs = Date.now() - new Date(person.access_invited_at).getTime();
    if (ageMs > INVITE_EXPIRY_HOURS * 3_600_000) return 'expired';
  }
  return 'pending';
}

/** profile_id[] -> { profileId -> userId } via profiles (service role). */
async function profilesToUsers(
  service: SupabaseClient,
  profileIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (profileIds.length === 0) return map;
  const { data } = await service.from('profiles').select('id, user_id').in('id', profileIds);
  for (const row of data ?? []) map.set(row.id as string, row.user_id as string);
  return map;
}

async function authStates(service: SupabaseClient, userIds: string[]): Promise<Map<string, AuthState>> {
  const map = new Map<string, AuthState>();
  if (userIds.length === 0) return map;
  const { data, error } = await service.rpc('ponto_auth_user_states', { p_user_ids: userIds });
  if (error) throw new AccessError(`Falha ao ler estado de acesso: ${error.message}`, 500, 'auth_state_failed');
  for (const row of (data ?? []) as AuthState[]) map.set(row.user_id, row);
  return map;
}

/** Lista o status de acesso de todas as pessoas da organização. */
export async function listAccess(orgId: string): Promise<PontoAccessInfo[]> {
  const service = getServiceClient();
  const { data: peopleRows, error } = await service
    .from('people')
    .select(PERSON_ACCESS_COLS)
    .eq('organization_id', orgId);
  if (error) throw new AccessError(`Falha ao carregar pessoas: ${error.message}`, 500, 'people_failed');
  const people = (peopleRows ?? []) as PersonAccessRow[];

  const profileIds = people.map((p) => p.profile_id).filter((v): v is string => !!v);
  const profUserMap = await profilesToUsers(service, profileIds);
  const userIds = Array.from(new Set(Array.from(profUserMap.values())));
  const states = await authStates(service, userIds);

  return people.map((p) => {
    const userId = p.profile_id ? profUserMap.get(p.profile_id) : undefined;
    const auth = userId ? states.get(userId) : undefined;
    return {
      personId: p.id,
      status: statusFor(p, auth),
      email: p.email,
      invitedAt: p.access_invited_at,
      inviteCount: p.access_invite_count,
      lastSignInAt: auth?.last_sign_in_at ?? null,
    };
  });
}

/* ─────────────────────────── helpers ─────────────────────────── */

async function loadPerson(service: SupabaseClient, personId: string, orgId: string): Promise<PersonAccessRow> {
  const { data, error } = await service
    .from('people')
    .select(PERSON_ACCESS_COLS)
    .eq('id', personId)
    .maybeSingle();
  if (error) throw new AccessError(`Falha ao carregar pessoa: ${error.message}`, 500);
  if (!data) throw new AccessError('Pessoa não encontrada.', 404, 'not_found');
  const person = data as PersonAccessRow;
  // Tenant isolation: a pessoa DEVE pertencer à org do admin.
  if (person.organization_id !== orgId) throw new AccessError('Pessoa de outra organização.', 403, 'cross_tenant');
  return person;
}

async function currentStatus(service: SupabaseClient, person: PersonAccessRow): Promise<PontoAccessStatus> {
  if (!person.profile_id) return statusFor(person, undefined);
  const profUserMap = await profilesToUsers(service, [person.profile_id]);
  const userId = profUserMap.get(person.profile_id);
  const states = userId ? await authStates(service, [userId]) : new Map();
  return statusFor(person, userId ? states.get(userId) : undefined);
}

async function audit(
  service: SupabaseClient,
  orgId: string,
  actorUserId: string,
  action: string,
  person: PersonAccessRow,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await service.from('audit_logs').insert({
    organization_id: orgId,
    actor_user_id: actorUserId,
    action,
    entity_type: 'person_ponto_access',
    entity_id: person.id,
    metadata: { person_name: person.full_name, ...metadata },
  });
}

function siteBase(origin: string): string {
  // Preferimos a base dedicada do portal de Ponto, para o link de ativação
  // no e-mail do colaborador sempre apontar ao portal (independente do
  // domínio do app admin que disparou o convite).
  const raw =
    process.env.NEXT_PUBLIC_PONTO_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    origin;
  return raw.replace(/\/$/, '');
}

function activationEmailHtml(params: { name: string; workspace: string; link: string }): string {
  const { name, workspace, link } = params;
  const first = name.split(' ')[0] || name;
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#0C1116;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0C1116;padding:32px 0;">
    <tr><td align="center">
      <table role="presentation" width="440" cellpadding="0" cellspacing="0" style="background:#121A22;border:1px solid rgba(141,162,181,0.16);border-radius:16px;padding:32px;">
        <tr><td style="color:#22C08D;font-size:12px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;">Insight Ponto</td></tr>
        <tr><td style="color:#E8EEF2;font-size:22px;font-weight:800;padding-top:8px;">Ative seu acesso ao ponto</td></tr>
        <tr><td style="color:#8DA2B5;font-size:14px;line-height:22px;padding-top:12px;">
          Olá, ${first}. Você recebeu acesso ao app de Ponto de <strong style="color:#E8EEF2;">${workspace}</strong>.
          Clique no botão abaixo para criar sua senha e ativar a conta. O link é de uso único e expira em ${INVITE_EXPIRY_HOURS} horas.
        </td></tr>
        <tr><td style="padding-top:24px;">
          <a href="${link}" style="display:inline-block;background:#22C08D;color:#07120E;font-size:15px;font-weight:bold;text-decoration:none;padding:14px 28px;border-radius:12px;">Ativar minha conta</a>
        </td></tr>
        <tr><td style="color:#5C7186;font-size:12px;line-height:18px;padding-top:24px;">
          Se você não esperava este e-mail, ignore-o — nenhuma conta é criada sem esta ativação.
          Nunca compartilhe este link.
        </td></tr>
      </table>
    </td></tr>
  </table></body></html>`;
}

async function sendActivationEmail(to: string, subject: string, html: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.APP_EMAIL_FROM;
  if (!apiKey || !from) {
    throw new AccessError(
      'Envio de e-mail não configurado (RESEND_API_KEY / APP_EMAIL_FROM). O convite não foi enviado.',
      502,
      'email_not_configured',
    );
  }
  const { Resend } = await import('resend');
  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({ from, to, subject, html });
  if (error) throw new AccessError(`Falha ao enviar o e-mail: ${error.message}`, 502, 'email_send_failed');
}

/* ─────────────────────── invite / resend / copy ─────────────────────── */

interface InviteResult {
  status: PontoAccessStatus;
  activationLink?: string; // devolvido apenas no modo copy_link
}

/**
 * Gera o link de ativação (Supabase generateLink) e o envia por e-mail
 * (mode='email') ou o devolve para o admin copiar (mode='copy'). Faz o
 * link auth-user <-> person, atribui a role de ponto e escreve auditoria.
 * NUNCA persiste nem loga o token do link.
 */
async function sendActivation(
  service: SupabaseClient,
  actorUserId: string,
  orgId: string,
  person: PersonAccessRow,
  origin: string,
  opts: { mode: 'email' | 'copy'; isResend: boolean },
): Promise<InviteResult> {
  const email = (person.email ?? '').trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AccessError('A pessoa precisa de um e-mail válido para receber o convite.', 400, 'no_email');
  }

  // Rate-limit: qualquer reenvio dentro da janela de cooldown é barrado.
  if (person.access_invited_at) {
    const sinceMs = Date.now() - new Date(person.access_invited_at).getTime();
    if (sinceMs < RESEND_COOLDOWN_MS) {
      const wait = Math.ceil((RESEND_COOLDOWN_MS - sinceMs) / 1000);
      throw new AccessError(`Aguarde ${wait}s antes de reenviar o convite.`, 429, 'rate_limited');
    }
  }

  // Prevenção de duplicidade / e-mail em outra organização.
  const { data: byEmail } = await service.rpc('ponto_auth_user_by_email', { p_email: email });
  const existing = (byEmail?.[0] ?? null) as { user_id: string; email_confirmed_at: string | null } | null;
  if (existing) {
    const { data: prof } = await service
      .from('profiles')
      .select('id, organization_id')
      .eq('user_id', existing.user_id)
      .maybeSingle();
    if (prof && prof.organization_id && prof.organization_id !== orgId) {
      throw new AccessError(
        'Este e-mail já pertence a um usuário de outra organização. Use um e-mail exclusivo desta organização.',
        409,
        'email_other_org',
      );
    }
    // e-mail já vinculado a OUTRA pessoa desta org?
    if (prof?.id) {
      const { data: otherPerson } = await service
        .from('people')
        .select('id')
        .eq('profile_id', prof.id)
        .neq('id', person.id)
        .maybeSingle();
      if (otherPerson) {
        throw new AccessError('Este e-mail já está vinculado a outro colaborador.', 409, 'email_other_person');
      }
    }
  }

  // Escolhe o tipo de link do fluxo NATIVO do Supabase.
  const linkType: 'invite' | 'magiclink' | 'recovery' = !existing
    ? 'invite'
    : existing.email_confirmed_at
      ? 'recovery'
      : 'magiclink';

  const redirectTo = `${siteBase(origin)}/ponto/ativar`;
  const { data: orgRow } = await service
    .from('organizations')
    .select('name, workspace_name, branding_enabled')
    .eq('id', orgId)
    .maybeSingle();
  const workspace = getWorkspaceName(orgRow ?? null);

  const metaData = {
    full_name: person.full_name,
    organization_id: orgId,
    organization_name: orgRow?.name ?? null,
    workspace_name: workspace,
    ponto_person_id: person.id,
  };
  // generateLink é uma união discriminada: 'recovery' não aceita `data`.
  const { data: linkData, error: linkErr } =
    linkType === 'recovery'
      ? await service.auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo } })
      : await service.auth.admin.generateLink({ type: linkType, email, options: { redirectTo, data: metaData } });
  if (linkErr || !linkData?.user || !linkData.properties?.action_link) {
    const msg = linkErr?.message ?? 'erro desconhecido';
    const isRate = /rate.*limit|429|too.many/i.test(msg);
    throw new AccessError(
      isRate ? 'Limite de e-mails do provedor atingido. Tente novamente em alguns minutos.' : `Falha ao gerar o link de ativação: ${msg}`,
      isRate ? 429 : 502,
      isRate ? 'rate_limited' : 'link_failed',
    );
  }

  const userId = linkData.user.id;
  const activationLink = linkData.properties.action_link;

  // 1) profile vinculado à org (idempotente).
  const { data: profileRow, error: profileErr } = await service
    .from('profiles')
    .upsert(
      { user_id: userId, organization_id: orgId, full_name: person.full_name, status: 'active' },
      { onConflict: 'user_id' },
    )
    .select('id')
    .single();
  if (profileErr || !profileRow) {
    throw new AccessError(`Link gerado, mas falha ao preparar o perfil: ${profileErr?.message}`, 500, 'profile_failed');
  }

  // 2) vincula a pessoa ao profile + marca o convite.
  const { error: linkPersonErr } = await service
    .from('people')
    .update({
      profile_id: profileRow.id,
      access_invited_at: new Date().toISOString(),
      access_invite_count: (person.access_invite_count ?? 0) + 1,
      access_blocked: false,
      access_blocked_at: null,
      access_blocked_by: null,
    })
    .eq('id', person.id);
  if (linkPersonErr) {
    throw new AccessError(`Falha ao vincular a pessoa ao login: ${linkPersonErr.message}`, 500, 'link_person_failed');
  }

  // 3) role de ponto (menor privilégio), idempotente.
  const { data: role } = await service
    .from('roles')
    .select('id')
    .eq('key', PONTO_ROLE_KEY)
    .is('organization_id', null)
    .maybeSingle();
  if (role?.id) {
    await service
      .from('user_roles')
      .upsert(
        { user_id: userId, role_id: role.id, organization_id: orgId },
        { onConflict: 'user_id,role_id,organization_id', ignoreDuplicates: true },
      );
  }

  // 4) envio do e-mail (ou não, no modo copy). Falha de e-mail NÃO deixa
  //    conta inconsistente: profile/role/link já estão gravados e o admin
  //    pode reenviar; devolvemos erro claro.
  if (opts.mode === 'email') {
    await sendActivationEmail(email, `Ative seu acesso ao Ponto — ${workspace}`, activationEmailHtml({ name: person.full_name, workspace, link: activationLink }));
  }

  // 5) auditoria (sem token, sem link).
  await audit(service, orgId, actorUserId, opts.mode === 'copy' ? 'access.ponto.link_copied' : opts.isResend ? 'access.ponto.reinvited' : 'access.ponto.invited', person, {
    email,
    link_type: linkType,
    delivery: opts.mode,
  });

  const reloaded = await loadPerson(service, person.id, orgId);
  const status = await currentStatus(service, reloaded);
  return { status, activationLink: opts.mode === 'copy' ? activationLink : undefined };
}

/* ─────────────────────── block / reactivate / revoke ─────────────────────── */

async function userIdOf(service: SupabaseClient, person: PersonAccessRow): Promise<string | null> {
  if (!person.profile_id) return null;
  const map = await profilesToUsers(service, [person.profile_id]);
  return map.get(person.profile_id) ?? null;
}

async function blockAccess(service: SupabaseClient, actorUserId: string, orgId: string, person: PersonAccessRow): Promise<PontoAccessStatus> {
  const userId = await userIdOf(service, person);
  if (!userId) throw new AccessError('Esta pessoa não possui acesso para bloquear.', 400, 'no_access');
  // ban efetivo no Auth (impede novo login) + flag administrativa.
  const { error } = await service.auth.admin.updateUserById(userId, { ban_duration: '876000h' });
  if (error) throw new AccessError(`Falha ao bloquear no Auth: ${error.message}`, 502, 'ban_failed');
  await service
    .from('people')
    .update({ access_blocked: true, access_blocked_at: new Date().toISOString(), access_blocked_by: actorUserId })
    .eq('id', person.id);
  await audit(service, orgId, actorUserId, 'access.ponto.blocked', person);
  return 'blocked';
}

async function reactivateAccess(service: SupabaseClient, actorUserId: string, orgId: string, person: PersonAccessRow): Promise<PontoAccessStatus> {
  const userId = await userIdOf(service, person);
  if (!userId) throw new AccessError('Esta pessoa não possui acesso para reativar.', 400, 'no_access');
  const { error } = await service.auth.admin.updateUserById(userId, { ban_duration: 'none' });
  if (error) throw new AccessError(`Falha ao reativar no Auth: ${error.message}`, 502, 'unban_failed');
  await service
    .from('people')
    .update({ access_blocked: false, access_blocked_at: null, access_blocked_by: null })
    .eq('id', person.id);
  await audit(service, orgId, actorUserId, 'access.ponto.reactivated', person);
  const reloaded = await loadPerson(service, person.id, orgId);
  return currentStatus(service, reloaded);
}

async function revokeAccess(service: SupabaseClient, actorUserId: string, orgId: string, person: PersonAccessRow): Promise<PontoAccessStatus> {
  const status = await currentStatus(service, person);
  if (status !== 'pending' && status !== 'expired') {
    throw new AccessError('Só é possível revogar convites pendentes ou expirados. Bloqueie contas já ativas.', 409, 'not_revocable');
  }
  const userId = await userIdOf(service, person);
  if (userId) {
    // apaga o auth user (cascade remove o profile; people.profile_id -> SET NULL)
    const { error } = await service.auth.admin.deleteUser(userId);
    if (error) throw new AccessError(`Falha ao revogar o convite: ${error.message}`, 502, 'delete_failed');
  }
  await service
    .from('people')
    .update({ profile_id: null, access_invited_at: null, access_blocked: false, access_blocked_at: null, access_blocked_by: null })
    .eq('id', person.id);
  await audit(service, orgId, actorUserId, 'access.ponto.revoked', person, { previous_status: status });
  return 'no_access';
}

/* ─────────────────────────── entrypoint ─────────────────────────── */

export interface RunActionResult {
  status: PontoAccessStatus;
  activationLink?: string;
  message: string;
}

/** Executa uma ação de acesso, validando a transição contra o status atual. */
export async function runAccessAction(
  actorUserId: string,
  orgId: string,
  personId: string,
  action: PontoAccessAction,
  origin: string,
): Promise<RunActionResult> {
  const service = getServiceClient();
  const person = await loadPerson(service, personId, orgId);
  const status = await currentStatus(service, person);

  // A ação precisa ser válida para o status atual (defesa server-side).
  if (!allowedActions(status).includes(action)) {
    throw new AccessError(`Ação "${action}" não é permitida para o status atual.`, 409, 'invalid_transition');
  }

  switch (action) {
    case 'invite':
    case 'resend': {
      const r = await sendActivation(service, actorUserId, orgId, person, origin, { mode: 'email', isResend: action === 'resend' });
      return { status: r.status, message: action === 'resend' ? 'Convite reenviado.' : 'Convite enviado.' };
    }
    case 'copy_link': {
      const r = await sendActivation(service, actorUserId, orgId, person, origin, { mode: 'copy', isResend: true });
      return { status: r.status, activationLink: r.activationLink, message: 'Link de ativação gerado.' };
    }
    case 'block':
      return { status: await blockAccess(service, actorUserId, orgId, person), message: 'Acesso bloqueado.' };
    case 'reactivate':
      return { status: await reactivateAccess(service, actorUserId, orgId, person), message: 'Acesso reativado.' };
    case 'revoke':
      return { status: await revokeAccess(service, actorUserId, orgId, person), message: 'Convite revogado.' };
    default:
      throw new AccessError('Ação desconhecida.', 400, 'unknown_action');
  }
}

export interface BatchItemResult {
  personId: string;
  ok: boolean;
  status?: PontoAccessStatus;
  error?: string;
}

/**
 * Convite em lote (rollout). Só aceita ações de convite (invite/resend);
 * cada pessoa é processada isoladamente — uma falha (sem e-mail, rate-limit,
 * transição inválida) não interrompe as demais. A ação real por pessoa é
 * resolvida pelo status atual (no_access -> invite; pending/expired ->
 * resend), então o chamador pode mandar 'invite' para todas.
 */
export async function runAccessBatch(
  actorUserId: string,
  orgId: string,
  personIds: string[],
  origin: string,
): Promise<BatchItemResult[]> {
  const service = getServiceClient();
  const results: BatchItemResult[] = [];
  for (const personId of Array.from(new Set(personIds)).slice(0, 200)) {
    try {
      const person = await loadPerson(service, personId, orgId);
      const status = await currentStatus(service, person);
      const action: PontoAccessAction | null =
        status === 'no_access' ? 'invite' : status === 'pending' || status === 'expired' ? 'resend' : null;
      if (!action) {
        results.push({ personId, ok: false, status, error: 'Sem ação de convite aplicável a este status.' });
        continue;
      }
      const r = await sendActivation(service, actorUserId, orgId, person, origin, {
        mode: 'email',
        isResend: action === 'resend',
      });
      results.push({ personId, ok: true, status: r.status });
    } catch (e) {
      const msg = e instanceof AccessError ? e.message : e instanceof Error ? e.message : 'Falha';
      results.push({ personId, ok: false, error: msg });
    }
  }
  return results;
}
