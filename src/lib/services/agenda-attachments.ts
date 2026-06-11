'use client';

/**
 * Agenda attachments — Supabase Storage ('agenda-attachments' bucket) +
 * agenda_attachments table (migration 031). Path convention:
 *   {organization_id}/{entity_type}/{entity_id}/{uuid}-{fileName}
 * Visibility inherits the task/event RLS via the table policies.
 */

import { createClient } from '@/utils/supabase/client';
import type { AgendaAttachment } from '@/lib/types/agenda';

const BUCKET = 'agenda-attachments';
const TABLE = 'agenda_attachments';

type AttachmentRow = {
  id: string;
  organization_id: string;
  entity_type: 'task' | 'event';
  entity_id: string;
  file_name: string;
  file_path: string;
  file_size: number | null;
  content_type: string | null;
  uploaded_by: string | null;
  created_at: string;
};

function mapAttachment(row: AttachmentRow): AgendaAttachment {
  return {
    id: row.id,
    organizationId: row.organization_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    fileName: row.file_name,
    filePath: row.file_path,
    fileSize: row.file_size,
    contentType: row.content_type,
    uploadedBy: row.uploaded_by,
    createdAt: new Date(row.created_at),
  };
}

async function getOrgId(): Promise<string> {
  const supabase = createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) throw new Error('Não autenticado');
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('user_id', user.id)
    .single();
  if (error || !profile?.organization_id) throw new Error('Usuário sem organização ativa');
  return profile.organization_id as string;
}

export async function listAttachments(
  entityType: 'task' | 'event',
  entityId: string,
): Promise<AgendaAttachment[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Falha ao carregar anexos: ${error.message}`);
  return (data as AttachmentRow[]).map(mapAttachment);
}

export async function uploadAttachment(
  entityType: 'task' | 'event',
  entityId: string,
  file: File,
): Promise<AgendaAttachment> {
  const supabase = createClient();
  const orgId = await getOrgId();
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id;
  if (!userId) throw new Error('Não autenticado');

  const safeName = file.name.replace(/[^\w.\-]+/g, '_');
  const filePath = `${orgId}/${entityType}/${entityId}/${crypto.randomUUID()}-${safeName}`;

  const { error: upErr } = await supabase.storage.from(BUCKET).upload(filePath, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  });
  if (upErr) {
    if (/mime|content[- ]type|not allowed/i.test(upErr.message)) {
      throw new Error('Tipo de arquivo não permitido (use PDF, Office, imagem, CSV ou texto).');
    }
    throw new Error(`Falha ao enviar arquivo: ${upErr.message}`);
  }

  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      organization_id: orgId,
      entity_type: entityType,
      entity_id: entityId,
      file_name: file.name,
      file_path: filePath,
      file_size: file.size,
      content_type: file.type || null,
      uploaded_by: userId,
    })
    .select('*')
    .single();

  if (error || !data) {
    // O objeto sem linha correspondente ficaria invisível e órfão.
    await supabase.storage.from(BUCKET).remove([filePath]);
    throw new Error(`Falha ao registrar anexo: ${error?.message ?? 'sem retorno'}`);
  }
  return mapAttachment(data as AttachmentRow);
}

export async function deleteAttachment(attachment: AgendaAttachment): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from(TABLE).delete().eq('id', attachment.id);
  if (error) throw new Error(`Falha ao excluir anexo: ${error.message}`);
  const { error: stErr } = await supabase.storage.from(BUCKET).remove([attachment.filePath]);
  if (stErr) console.error('[agenda] storage remove failed:', stErr.message);
}

export async function getAttachmentUrl(attachment: AgendaAttachment): Promise<string> {
  const supabase = createClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(attachment.filePath, 60);
  if (error || !data?.signedUrl) {
    throw new Error(`Falha ao gerar link do anexo: ${error?.message ?? 'sem retorno'}`);
  }
  return data.signedUrl;
}
