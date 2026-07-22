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

export interface PontoAccessInfo {
  personId: string;
  status: PontoAccessStatus;
  email: string | null;
  invitedAt: string | null;
  inviteCount: number;
  lastSignInAt: string | null;
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
