'use client';

/**
 * A LEITURA do acervo documental do projeto.
 *
 * Uma consulta a `project_document_read_model` (189) — evidência de medição,
 * documento de execução e referência contratual no MESMO instante. A
 * alternativa (uma consulta por procedência, unidas na tela) devolveria três
 * instantes do mesmo acervo, e a evidência enviada entre a primeira e a
 * terceira apareceria num lugar e não no outro.
 *
 * Não escreve nada. O upload é de `evidence-workspace.ts` e de
 * `uploadProjectFile`; aqui só se lê e se assina URL de leitura.
 */

import { createClient } from '@/utils/supabase/client';
import { toProjectDocument, type ProjectDocument } from './project-documents';

export class ProjectDocumentsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectDocumentsError';
  }
}

export async function listProjectDocuments(
  projectId: string,
): Promise<readonly ProjectDocument[]> {
  const { data, error } = await createClient()
    .from('project_document_read_model')
    .select('*')
    .eq('project_id', projectId)
    .order('uploaded_at', { ascending: false });

  /*
    Ambiente sem a 189 cai para `project_files` — o acervo que sempre existiu.

    A degradação é DELIBERADA e silenciosa nesta direção: a aba de Documentos
    é anterior a esta refatoração, e derrubá-la com "migration não aplicada"
    tiraria do ar um recurso que funcionava para entregar um que ainda não
    subiu. O que se perde sem a visão é a referência contratual e a
    classificação de evidência — não o acesso aos documentos.
  */
  if (error) {
    if (error.message.includes('does not exist')) return listFromProjectFiles(projectId);
    throw new ProjectDocumentsError(error.message);
  }
  return (data ?? []).map(toProjectDocument);
}

/** O acervo pré-189: `project_files` puro, sem procedência contratual. */
async function listFromProjectFiles(
  projectId: string,
): Promise<readonly ProjectDocument[]> {
  const { data, error } = await createClient()
    .from('project_files')
    .select('id, organization_id, project_id, file_name, document_type, category, '
      + 'bucket_id, object_path, public_url, content_type, file_size, '
      + 'timeline_item_id, created_by, created_at')
    .eq('project_id', projectId)
    .neq('category', 'logo')
    .order('created_at', { ascending: false });

  if (error) throw new ProjectDocumentsError(error.message);

  /*
    A linha vem sem forma tipada porque a seleção é por lista de colunas — e o
    cliente do Supabase não sabe tipá-la. A normalização em
    `toProjectDocument` é a fronteira, e é ela que dá forma ao resto do módulo.
  */
  return ((data ?? []) as any[]).map((raw) => toProjectDocument({
    document_id: raw.id,
    organization_id: raw.organization_id,
    project_id: raw.project_id,
    origin: 'PROJECT',
    title: raw.file_name,
    document_type: raw.document_type,
    evidence_category: null,
    category: raw.category,
    bucket_id: raw.bucket_id,
    object_path: raw.object_path,
    public_url: raw.public_url,
    content_type: raw.content_type,
    file_size: raw.file_size,
    contract_id: null,
    contract_milestone_id: null,
    measurement_id: null,
    timeline_item_id: raw.timeline_item_id,
    uploaded_by: raw.created_by,
    uploaded_at: raw.created_at,
    contract_document_status: null,
  }));
}

/**
 * URL de leitura de UM documento do projeto.
 *
 * Documento contratual devolve `null` de propósito: ele não tem caminho nesta
 * leitura, e é assim que "referenciar" se distingue de "copiar". A tela leva
 * a pessoa ao módulo Contratos, onde o byte mora.
 */
export async function documentUrl(doc: ProjectDocument): Promise<string | null> {
  if (doc.publicUrl) return doc.publicUrl;
  if (!doc.bucketId || !doc.objectPath) return null;
  const { data } = await createClient().storage
    .from(doc.bucketId)
    .createSignedUrl(doc.objectPath, 300);
  return data?.signedUrl ?? null;
}
