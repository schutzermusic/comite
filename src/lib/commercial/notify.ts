/**
 * Aviso in-app pela porta de servidor da plataforma (`create_notification_for`,
 * migration 195) — a mesma tabela, as mesmas validações de destinatário.
 *
 * Melhor esforço por desenho: o aviso acompanha um ato governado que JÁ
 * aconteceu. Se o aviso falhar, o ato não é desfeito — e o erro não é
 * engolido em silêncio: volta para a rota, que o registra na auditoria.
 */
if (typeof window !== 'undefined') {
  throw new Error('notify.ts não pode ser importado no navegador');
}

import { platformServiceClient } from '@/lib/platform/server-client';

export async function notifyMember(input: {
  organizationId: string; recipientUserId: string | null | undefined;
  type: string; title: string; body?: string | null; link?: string | null;
}): Promise<{ delivered: boolean; error: string | null }> {
  if (!input.recipientUserId) return { delivered: false, error: null };
  const { error } = await platformServiceClient().rpc('create_notification_for', {
    p_organization_id: input.organizationId,
    p_recipient: input.recipientUserId,
    p_type: input.type,
    p_title: input.title,
    p_body: input.body ?? null,
    p_link: input.link ?? null,
  });
  return { delivered: !error, error: error?.message ?? null };
}
