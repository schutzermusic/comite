/**
 * Escritor de auditoria do lado do NAVEGADOR.
 *
 * Para rota de API, ação de servidor ou qualquer código Node, use
 * `logAuditEventServer` (`./log-audit-event-server`): este cliente não enxerga
 * cookie fora do navegador e retornaria sem gravar nada.
 *
 * Mudança da Fase 0.3: o resultado passou a ser DEVOLVIDO. Antes, o `error` do
 * insert era descartado — falha de RLS, de rede ou de organização produzia
 * exatamente o mesmo silêncio que um sucesso. O evento continua não derrubando
 * a ação do usuário (auditar é consequência do ato, não condição dele), mas a
 * falha agora aparece no console e pode ser inspecionada por quem chama.
 *
 * `ip_address` e `user_agent` seguem nulos por aqui, e isso é uma limitação
 * real e não um esquecimento: o navegador não conhece o próprio IP e o
 * user-agent auto-declarado não vale como registro. Quem precisa dessas
 * colunas preenchidas precisa escrever pelo servidor.
 */

import { createClient } from '@/utils/supabase/client';
import type { AuditEventInput, AuditWriteResult } from './log-audit-event-server';

export type { AuditEventInput, AuditWriteResult };

export async function logAuditEvent({
  organizationId,
  action,
  entityType,
  entityId = null,
  metadata = {},
}: AuditEventInput): Promise<AuditWriteResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const result: AuditWriteResult = {
      ok: false,
      reason: 'unauthenticated',
      error: 'Sessão sem usuário: evento não auditado.',
    };
    console.warn(`[audit] ${action} não registrado — ${result.error}`);
    return result;
  }

  const { error } = await supabase.from('audit_logs').insert({
    organization_id: organizationId,
    actor_user_id: user.id,
    action,
    entity_type: entityType,
    entity_id: entityId,
    metadata,
  });

  if (error) {
    console.error(`[audit] ${action} não registrado — ${error.message}`);
    return { ok: false, reason: 'write-failed', error: error.message };
  }

  return { ok: true };
}
