/**
 * Estados de acesso do colaborador ao app de Ponto — compartilhados entre
 * o servidor (cálculo) e o cliente (UI). Sem dependências de React/Node.
 */
export type PontoAccessStatus =
  | 'no_access' // Sem acesso — pessoa sem login vinculado
  | 'pending' // Convite pendente — convidado, ainda não ativou
  | 'active' // Ativo — conta ativada (e-mail confirmado)
  | 'expired' // Convite expirado — link de ativação venceu
  | 'blocked'; // Acesso bloqueado — bloqueio administrativo/ban

export const PONTO_ACCESS_LABELS: Record<PontoAccessStatus, string> = {
  no_access: 'Sem acesso',
  pending: 'Convite pendente',
  active: 'Ativo',
  expired: 'Convite expirado',
  blocked: 'Acesso bloqueado',
};

export type PontoAccessAction =
  | 'invite'
  | 'resend'
  | 'copy_link'
  | 'block'
  | 'reactivate'
  | 'revoke';

export type PontoProvisionSource = 'manual' | 'allocation' | 'batch';

export interface PontoAccessInfo {
  personId: string;
  status: PontoAccessStatus;
  email: string | null;
  invitedAt: string | null;
  inviteCount: number;
  lastSignInAt: string | null;
  /* visibilidade estendida (070) */
  lastReminderAt: string | null;
  reminderCount: number;
  activatedAt: string | null;
  provisionSource: PontoProvisionSource | null;
  lastError: string | null;
  lastErrorAt: string | null;
  expiresAt: string | null;
  expiringSoon: boolean;
}

/**
 * "Balde" para filtros/indicadores na tela de Pessoas — combina o status
 * efetivo com sinais auxiliares (expirando, falha de provisionamento).
 */
export type PontoAccessBucket =
  | 'no_access'
  | 'pending'
  | 'expiring'
  | 'expired'
  | 'active'
  | 'blocked'
  | 'provision_failed';

export const PONTO_BUCKET_LABELS: Record<PontoAccessBucket, string> = {
  no_access: 'Sem acesso',
  pending: 'Convite pendente',
  expiring: 'Convite expirando',
  expired: 'Convite expirado',
  active: 'Ativo',
  blocked: 'Bloqueado',
  provision_failed: 'Falha no provisionamento',
};

export function bucketOf(info: PontoAccessInfo | undefined | null): PontoAccessBucket {
  if (!info) return 'no_access';
  if (info.lastError) return 'provision_failed';
  if (info.status === 'blocked') return 'blocked';
  if (info.status === 'active') return 'active';
  if (info.status === 'no_access') return 'no_access';
  if (info.status === 'expired') return 'expired';
  return info.expiringSoon ? 'expiring' : 'pending'; // pending
}

/** Ações permitidas conforme o status atual (usado para renderizar a UI). */
export function allowedActions(status: PontoAccessStatus): PontoAccessAction[] {
  switch (status) {
    case 'no_access':
      return ['invite'];
    case 'pending':
      return ['resend', 'copy_link', 'revoke', 'block'];
    case 'expired':
      return ['resend', 'copy_link', 'revoke', 'block'];
    case 'active':
      return ['block'];
    case 'blocked':
      return ['reactivate'];
    default:
      return [];
  }
}
