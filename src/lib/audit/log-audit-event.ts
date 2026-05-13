import { createClient } from '@/utils/supabase/client';

type AuditEventInput = {
  organizationId: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
};

export async function logAuditEvent({
  organizationId,
  action,
  entityType,
  entityId = null,
  metadata = {},
}: AuditEventInput) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return;

  await supabase.from('audit_logs').insert({
    organization_id: organizationId,
    actor_user_id: user.id,
    action,
    entity_type: entityType,
    entity_id: entityId,
    metadata,
  });
}
