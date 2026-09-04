/**
 * Escritor de auditoria do lado do SERVIDOR.
 *
 * Por que este arquivo existe: `log-audit-event.ts` usa o cliente de NAVEGADOR.
 * Chamado de dentro de uma rota Node — como fazia `/api/ai/clause-extraction` —
 * ele não enxerga cookie nenhum, `auth.getUser()` devolve vazio, e a função
 * retorna sem gravar. O evento não falhava: ele simplesmente não acontecia. Uma
 * trilha de auditoria que perde eventos em silêncio é pior que nenhuma, porque
 * a ausência de linha passa a ser lida como ausência de ato.
 *
 * Três diferenças em relação ao escritor de navegador, e todas as três são o
 * motivo de ele existir:
 *
 *   1. Cliente de servidor, com os cookies da requisição — então há ator.
 *   2. `ip_address` e `user_agent` preenchidos a partir dos cabeçalhos. Só o
 *      servidor os conhece; o navegador nunca teve como preenchê-los, e por
 *      isso as 809 linhas de auditoria desta base têm as duas colunas nulas.
 *   3. O erro é DEVOLVIDO. Quem chama decide o que fazer com ele — e pode,
 *      no mínimo, não afirmar que auditou quando não auditou.
 *
 * A política de INSERT de `audit_logs` (005) já exige
 * `actor_user_id = auth.uid()` e a organização da sessão: o ator não é
 * falsificável. O que faltava era o evento chegar.
 */

import { createClient } from '@/utils/supabase/server';

export type AuditEventInput = {
  organizationId: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
};

export type AuditWriteResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'unauthenticated' | 'write-failed'; readonly error: string };

/**
 * Primeiro IP da cadeia `x-forwarded-for`.
 *
 * O cabeçalho é uma lista `cliente, proxy1, proxy2`; o primeiro elemento é o
 * cliente original. É um valor auto-declarado e tratado como indício, não como
 * prova — daí ser registrado, e não usado para autorizar nada.
 */
function clientIp(headers: Headers): string | null {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first.slice(0, 100);
  }
  return headers.get('x-real-ip')?.trim().slice(0, 100) || null;
}

/**
 * Grava um evento de auditoria a partir de uma rota/ação de servidor.
 *
 * `headers` é opcional apenas porque nem todo chamador de servidor tem uma
 * requisição em mãos; quando existe, IP e user-agent entram no registro.
 * O retorno nunca é ignorável em silêncio: não há caminho que engula o erro.
 */
export async function logAuditEventServer(
  { organizationId, action, entityType, entityId = null, metadata = {} }: AuditEventInput,
  headers?: Headers,
): Promise<AuditWriteResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, reason: 'unauthenticated', error: 'Sessão sem usuário: evento não auditado.' };
  }

  const { error } = await supabase.from('audit_logs').insert({
    organization_id: organizationId,
    actor_user_id: user.id,
    action,
    entity_type: entityType,
    entity_id: entityId,
    metadata,
    ip_address: headers ? clientIp(headers) : null,
    user_agent: headers ? (headers.get('user-agent')?.slice(0, 500) ?? null) : null,
  });

  if (error) {
    return { ok: false, reason: 'write-failed', error: error.message };
  }
  return { ok: true };
}
