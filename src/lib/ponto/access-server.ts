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
  type PontoProvisionSource,
} from '@/lib/ponto/access-types';

export const PONTO_ROLE_KEY = 'ponto_field_worker';
export const RESEND_COOLDOWN_MS = 60_000; // 60s entre envios (anti-spam duro)
export const INVITE_EXPIRY_HOURS = 168; // validade do convite (7 dias)
export const EXPIRING_WINDOW_MS = 24 * 3_600_000; // "expirando" = < 24h p/ vencer
/**
 * Cadência de lembretes (por reminder_count), medida desde o último envio
 * (access_invited_at). Cada lembrete reenvia um link fresco. Máx = 3.
 *   #0 -> 24h, #1 -> 72h (3d), #2 -> 72h (final, antes do vencimento).
 */
export const REMINDER_INTERVALS_MS = [24 * 3_600_000, 72 * 3_600_000, 72 * 3_600_000];
export const MAX_REMINDERS = REMINDER_INTERVALS_MS.length;
/** Erro de e-mail: retenta no cron após esta janela (estado retryable). */
export const ERROR_RETRY_MS = 60 * 60_000; // 1h

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
  access_last_reminder_at: string | null;
  access_reminder_count: number;
  access_activated_at: string | null;
  access_provision_source: 'manual' | 'allocation' | 'batch' | null;
  access_last_error: string | null;
  access_last_error_at: string | null;
}

const PERSON_ACCESS_COLS =
  'id, organization_id, full_name, email, profile_id, access_invited_at, access_invite_count, access_blocked, ' +
  'access_last_reminder_at, access_reminder_count, access_activated_at, access_provision_source, access_last_error, access_last_error_at';

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

/** Vencimento do convite (base = último envio) + flag "expirando". */
function expiryOf(person: PersonAccessRow, status: PontoAccessStatus): { expiresAt: string | null; expiringSoon: boolean } {
  if (!person.access_invited_at) return { expiresAt: null, expiringSoon: false };
  const expMs = new Date(person.access_invited_at).getTime() + INVITE_EXPIRY_HOURS * 3_600_000;
  const remaining = expMs - Date.now();
  return { expiresAt: new Date(expMs).toISOString(), expiringSoon: status === 'pending' && remaining <= EXPIRING_WINDOW_MS };
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
  const people = (peopleRows ?? []) as unknown as PersonAccessRow[];

  const profileIds = people.map((p) => p.profile_id).filter((v): v is string => !!v);
  const profUserMap = await profilesToUsers(service, profileIds);
  const userIds = Array.from(new Set(Array.from(profUserMap.values())));
  const states = await authStates(service, userIds);

  return people.map((p) => {
    const userId = p.profile_id ? profUserMap.get(p.profile_id) : undefined;
    const auth = userId ? states.get(userId) : undefined;
    const status = statusFor(p, auth);
    const { expiresAt, expiringSoon } = expiryOf(p, status);
    return {
      personId: p.id,
      status,
      email: p.email,
      invitedAt: p.access_invited_at,
      inviteCount: p.access_invite_count,
      lastSignInAt: auth?.last_sign_in_at ?? null,
      lastReminderAt: p.access_last_reminder_at,
      reminderCount: p.access_reminder_count ?? 0,
      activatedAt: p.access_activated_at,
      provisionSource: p.access_provision_source,
      lastError: p.access_last_error,
      lastErrorAt: p.access_last_error_at,
      expiresAt,
      expiringSoon,
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
  const person = data as unknown as PersonAccessRow;
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
  actorUserId: string | null,
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
  actorUserId: string | null,
  orgId: string,
  person: PersonAccessRow,
  origin: string,
  opts: { mode: 'email' | 'copy'; isResend: boolean; isReminder?: boolean; source?: PontoProvisionSource },
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
  const now = new Date().toISOString();

  // 1) LINKAGEM ESTRUTURAL primeiro — persiste mesmo se o e-mail falhar,
  //    para NUNCA deixar um auth user desconectado do cadastro de pessoa.
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
  const { error: linkPersonErr } = await service
    .from('people')
    .update({ profile_id: profileRow.id })
    .eq('id', person.id);
  if (linkPersonErr) {
    throw new AccessError(`Falha ao vincular a pessoa ao login: ${linkPersonErr.message}`, 500, 'link_person_failed');
  }
  // role de ponto (menor privilégio), idempotente.
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

  // 2) ENVIO do e-mail (exceto modo copy). Falha => estado RETRYABLE:
  //    grava access_last_error e NÃO avança o relógio do convite; a linhagem
  //    já está persistida, então o cron/admin reenvia sem inconsistência.
  if (opts.mode === 'email') {
    try {
      await sendActivationEmail(
        email,
        opts.isReminder ? `Lembrete: ative seu acesso ao Ponto — ${workspace}` : `Ative seu acesso ao Ponto — ${workspace}`,
        activationEmailHtml({ name: person.full_name, workspace, link: activationLink }),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Falha no envio';
      await service.from('people').update({ access_last_error: msg, access_last_error_at: now }).eq('id', person.id);
      await audit(service, orgId, actorUserId, opts.isReminder ? 'access.ponto.reminder_failed' : 'access.ponto.invite_failed', person, { email, error: msg });
      throw e instanceof AccessError ? e : new AccessError(msg, 502, 'email_send_failed');
    }
  }

  // 3) SUCESSO — grava os timestamps de convite/lembrete e limpa erro.
  const patch: Record<string, unknown> = opts.isReminder
    ? {
        access_invited_at: now,
        access_last_reminder_at: now,
        access_reminder_count: (person.access_reminder_count ?? 0) + 1,
        access_last_error: null,
        access_last_error_at: null,
      }
    : {
        access_invited_at: now,
        access_invite_count: (person.access_invite_count ?? 0) + 1,
        access_reminder_count: 0,
        access_last_reminder_at: null,
        access_last_error: null,
        access_last_error_at: null,
        access_blocked: false,
        access_blocked_at: null,
        access_blocked_by: null,
        ...(opts.source ? { access_provision_source: opts.source } : {}),
      };
  await service.from('people').update(patch).eq('id', person.id);

  // 4) auditoria (sem token, sem link).
  const action = opts.mode === 'copy'
    ? 'access.ponto.link_copied'
    : opts.isReminder
      ? 'access.ponto.reminder_sent'
      : opts.isResend
        ? 'access.ponto.reinvited'
        : 'access.ponto.invited';
  await audit(service, orgId, actorUserId, action, person, {
    email,
    link_type: linkType,
    delivery: opts.mode,
    reminder_number: opts.isReminder ? (person.access_reminder_count ?? 0) + 1 : undefined,
    source: opts.source,
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
    .update({
      profile_id: null,
      access_invited_at: null,
      access_blocked: false,
      access_blocked_at: null,
      access_blocked_by: null,
      access_reminder_count: 0,
      access_last_reminder_at: null,
      access_activated_at: null,
      access_last_error: null,
      access_last_error_at: null,
      access_provision_source: null,
    })
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
      const r = await sendActivation(service, actorUserId, orgId, person, origin, { mode: 'email', isResend: action === 'resend', source: 'manual' });
      return { status: r.status, message: action === 'resend' ? 'Convite reenviado.' : 'Convite enviado.' };
    }
    case 'copy_link': {
      const r = await sendActivation(service, actorUserId, orgId, person, origin, { mode: 'copy', isResend: true, source: 'manual' });
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
        source: 'batch',
      });
      results.push({ personId, ok: true, status: r.status });
    } catch (e) {
      const msg = e instanceof AccessError ? e.message : e instanceof Error ? e.message : 'Falha';
      results.push({ personId, ok: false, error: msg });
    }
  }
  return results;
}

/* ═══════════════════ AUTO-PROVISIONING + LEMBRETES (cron) ═══════════════════ */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Núcleo do provisionamento para uma pessoa em 'no_access' (ou marca erro). */
async function doProvision(
  service: SupabaseClient,
  actorUserId: string | null,
  orgId: string,
  person: PersonAccessRow,
  origin: string,
  source: PontoProvisionSource,
): Promise<{ action: 'provisioned' | 'skipped_no_email'; status: PontoAccessStatus }> {
  const email = (person.email ?? '').trim();
  if (!email || !EMAIL_RE.test(email)) {
    // Sem e-mail válido → aviso acionável de RH (surge em access_last_error).
    if (person.access_last_error !== 'missing_email') {
      await service
        .from('people')
        .update({ access_last_error: 'missing_email', access_last_error_at: new Date().toISOString() })
        .eq('id', person.id);
      await audit(service, orgId, actorUserId, 'access.ponto.provisioning_skipped_no_email', person, { source });
    }
    return { action: 'skipped_no_email', status: 'no_access' };
  }
  await audit(service, orgId, actorUserId, 'access.ponto.provisioning_triggered', person, { source });
  const r = await sendActivation(service, actorUserId, orgId, person, origin, { mode: 'email', isResend: false, source });
  return { action: 'provisioned', status: r.status };
}

export interface ProvisionResult {
  action: 'provisioned' | 'skipped_no_email' | 'skipped_active' | 'skipped_pending' | 'skipped_blocked';
  status: PontoAccessStatus;
}

/**
 * Provisiona (ou não) o acesso de UMA pessoa, idempotente e seguro para
 * repetir. Regras: no_access -> convida; pending -> não duplica; active ->
 * nada; blocked -> NÃO reativa; sem e-mail -> aviso de RH. Audita o desfecho.
 */
export async function provisionPerson(
  actorUserId: string | null,
  orgId: string,
  personId: string,
  origin: string,
  source: PontoProvisionSource = 'manual',
): Promise<ProvisionResult> {
  const service = getServiceClient();
  const person = await loadPerson(service, personId, orgId);
  const status = await currentStatus(service, person);
  switch (status) {
    case 'no_access':
      return doProvision(service, actorUserId, orgId, person, origin, source);
    case 'blocked':
      await audit(service, orgId, actorUserId, 'access.ponto.provisioning_skipped_blocked', person, {});
      return { action: 'skipped_blocked', status };
    case 'active':
      await audit(service, orgId, actorUserId, 'access.ponto.provisioning_skipped_exists', person, { reason: 'active' });
      return { action: 'skipped_active', status };
    default: // pending | expired
      await audit(service, orgId, actorUserId, 'access.ponto.provisioning_skipped_exists', person, { reason: status });
      return { action: 'skipped_pending', status };
  }
}

/** person_ids de colaboradores ATIVOS com alocação viva (requer Ponto). */
async function activeAllocatedPersonIds(service: SupabaseClient, orgId: string): Promise<string[]> {
  const { data } = await service
    .from('project_allocations')
    .select('person_id, people:person_id ( status )')
    .eq('organization_id', orgId)
    .in('status', ['active', 'pending_approval']);
  const ids = new Set<string>();
  for (const row of (data ?? []) as unknown as Array<{ person_id: string; people: { status: string } | null }>) {
    if (row.people?.status === 'active') ids.add(row.person_id);
  }
  return Array.from(ids);
}

export interface ReconcileResult { candidates: number; provisioned: number; noEmail: number; failed: number }

/**
 * Reconciliação de provisionamento por alocação (idempotente). Age APENAS
 * em quem está 'no_access' (não audita "steady state"); falha isolada por
 * pessoa não interrompe as demais.
 */
export async function reconcileProvisioning(orgId: string, origin: string): Promise<ReconcileResult> {
  const service = getServiceClient();
  const ids = await activeAllocatedPersonIds(service, orgId);
  const res: ReconcileResult = { candidates: ids.length, provisioned: 0, noEmail: 0, failed: 0 };
  if (ids.length === 0) return res;
  const infos = new Map((await listAccess(orgId)).map((i) => [i.personId, i]));
  for (const pid of ids) {
    const info = infos.get(pid);
    if (!info || info.status !== 'no_access') continue;
    try {
      const person = await loadPerson(service, pid, orgId);
      const r = await doProvision(service, null, orgId, person, origin, 'allocation');
      if (r.action === 'provisioned') res.provisioned += 1;
      else res.noEmail += 1;
    } catch {
      res.failed += 1;
    }
  }
  return res;
}

export interface ReminderResult { sent: number; failed: number; skipped: number }

/**
 * Lembretes de convites pendentes. Cadência escalonada por reminder_count
 * (REMINDER_INTERVALS_MS), máx MAX_REMINDERS, com backoff em erro. Para
 * automaticamente após ativação/bloqueio/revogação (só atua em 'pending').
 */
export async function runReminders(orgId: string, origin: string): Promise<ReminderResult> {
  const service = getServiceClient();
  const res: ReminderResult = { sent: 0, failed: 0, skipped: 0 };
  const infos = await listAccess(orgId);
  for (const info of infos) {
    if (info.status !== 'pending') continue;
    const person = await loadPerson(service, info.personId, orgId).catch(() => null);
    if (!person) { res.skipped += 1; continue; }

    const count = person.access_reminder_count ?? 0;
    if (count >= MAX_REMINDERS) { res.skipped += 1; continue; }
    // backoff após falha de e-mail (estado retryable, sem hammering)
    if (person.access_last_error && person.access_last_error_at) {
      if (Date.now() - new Date(person.access_last_error_at).getTime() < ERROR_RETRY_MS) { res.skipped += 1; continue; }
    }
    const anchor = person.access_invited_at ? new Date(person.access_invited_at).getTime() : 0;
    if (Date.now() < anchor + REMINDER_INTERVALS_MS[count]) { res.skipped += 1; continue; }

    try {
      await sendActivation(service, null, orgId, person, origin, {
        mode: 'email',
        isResend: true,
        isReminder: true,
        source: person.access_provision_source ?? undefined,
      });
      res.sent += 1;
    } catch {
      res.failed += 1;
    }
  }
  return res;
}

export interface ActivationResult { activated: number }

/** Detecta ativações (e-mail confirmado) e carimba access_activated_at. */
export async function detectActivations(orgId: string): Promise<ActivationResult> {
  const service = getServiceClient();
  const res: ActivationResult = { activated: 0 };
  const infos = await listAccess(orgId);
  for (const info of infos) {
    if (info.status !== 'active' || info.activatedAt) continue;
    const person = await loadPerson(service, info.personId, orgId).catch(() => null);
    if (!person) continue;
    await service
      .from('people')
      .update({ access_activated_at: new Date().toISOString(), access_last_error: null, access_last_error_at: null })
      .eq('id', person.id);
    await audit(service, orgId, null, 'access.ponto.activation_completed', person, {});
    res.activated += 1;
  }
  return res;
}

export interface CronSummary {
  orgs: number;
  activated: number;
  provisioned: number;
  noEmail: number;
  remindersSent: number;
  remindersFailed: number;
  provisionFailed: number;
  errors: Array<{ orgId: string; error: string }>;
}

/**
 * Job agendado: para cada organização detecta ativações, reconcilia o
 * provisionamento por alocação e dispara lembretes. Falha por org é isolada.
 */
export async function runPontoCron(origin: string): Promise<CronSummary> {
  const service = getServiceClient();
  const { data: orgRows } = await service.from('people').select('organization_id').not('organization_id', 'is', null);
  const orgIds = Array.from(new Set((orgRows ?? []).map((o) => o.organization_id as string)));
  const summary: CronSummary = {
    orgs: orgIds.length, activated: 0, provisioned: 0, noEmail: 0,
    remindersSent: 0, remindersFailed: 0, provisionFailed: 0, errors: [],
  };
  for (const orgId of orgIds) {
    try {
      summary.activated += (await detectActivations(orgId)).activated;
      const p = await reconcileProvisioning(orgId, origin);
      summary.provisioned += p.provisioned;
      summary.noEmail += p.noEmail;
      summary.provisionFailed += p.failed;
      const r = await runReminders(orgId, origin);
      summary.remindersSent += r.sent;
      summary.remindersFailed += r.failed;
    } catch (e) {
      summary.errors.push({ orgId, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return summary;
}
