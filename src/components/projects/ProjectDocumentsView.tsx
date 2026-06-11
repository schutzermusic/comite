'use client';

/**
 * Documents tab — lists project_files rows (now with document_type /
 * timeline_item_id, migration 032) and uploads via the existing
 * project-files bucket. Imported MS Project PDFs (category 'cronograma')
 * appear here automatically.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, Loader2, UploadCloud } from 'lucide-react';
import { HudBadge, HudButton, HudEmptyState, useHudToast } from '@/components/hud';
import { usePermissions } from '@/hooks/use-permissions';
import { uploadProjectFile } from '@/lib/services/projects';
import { createClient } from '@/utils/supabase/client';

interface ProjectFileRow {
  id: string;
  file_name: string;
  public_url: string | null;
  content_type: string | null;
  file_size: number | null;
  category: string | null;
  document_type: string | null;
  timeline_item_id: string | null;
  created_at: string;
}

function fmtSize(bytes: number | null): string {
  if (!bytes) return '—';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ProjectDocumentsView({ projectId }: { projectId: string }) {
  const { hasPermission } = usePermissions();
  const { notify } = useHudToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<ProjectFileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  const canUpload = hasPermission('projects.documents.upload') || hasPermission('projects.upload');

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('project_files')
        .select('id, file_name, public_url, content_type, file_size, category, document_type, timeline_item_id, created_at')
        .eq('project_id', projectId)
        .neq('category', 'logo')
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      setFiles((data ?? []) as ProjectFileRow[]);
    } catch (e) {
      console.error('[ProjectDocumentsView]', e instanceof Error ? e.message : e);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleUpload = async (file: File | null) => {
    if (!file) return;
    setUploading(true);
    try {
      await uploadProjectFile(projectId, file, 'document');
      notify('Documento enviado', { variant: 'success' });
      await reload();
    } catch (e) {
      notify('Falha no upload', { description: e instanceof Error ? e.message : undefined, variant: 'error' });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-ig-fg-muted">
        <Loader2 className="h-5 w-5 animate-spin" /> Carregando documentos…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {canUpload && (
        <div className="flex justify-end">
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            onChange={(e) => void handleUpload(e.target.files?.[0] ?? null)}
          />
          <HudButton
            variant="primary"
            size="sm"
            isLoading={uploading}
            leftIcon={<UploadCloud className="h-4 w-4" />}
            onClick={() => inputRef.current?.click()}
          >
            Enviar documento
          </HudButton>
        </div>
      )}

      {files.length === 0 ? (
        <HudEmptyState
          icon="file"
          title="Nenhum documento"
          description="Envie evidências, relatórios técnicos, atas ou aprovações do cliente. PDFs de cronograma importados aparecem aqui automaticamente."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-ig-border">
          <table className="w-full text-sm">
            <thead className="bg-ig-bg-elevated text-xs text-ig-fg-muted">
              <tr className="text-left">
                <th className="px-4 py-2 font-medium">Arquivo</th>
                <th className="px-4 py-2 font-medium">Categoria</th>
                <th className="px-4 py-2 font-medium">Tamanho</th>
                <th className="px-4 py-2 font-medium">Enviado em</th>
              </tr>
            </thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.id} className="border-t border-ig-border hover:bg-ig-panel-hover">
                  <td className="px-4 py-2">
                    <span className="flex items-center gap-2">
                      <FileText className="h-4 w-4 shrink-0 text-ig-fg-muted" />
                      {f.public_url ? (
                        <a href={f.public_url} target="_blank" rel="noreferrer" className="text-ig-accent hover:underline">
                          {f.file_name}
                        </a>
                      ) : (
                        <span className="text-ig-fg">{f.file_name}</span>
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <HudBadge variant={f.category === 'cronograma' ? 'primary' : 'neutral'} size="sm">
                      {f.document_type ?? f.category ?? 'documento'}
                    </HudBadge>
                  </td>
                  <td className="px-4 py-2 text-ig-fg-muted">{fmtSize(f.file_size)}</td>
                  <td className="px-4 py-2 text-ig-fg-muted">
                    {new Date(f.created_at).toLocaleDateString('pt-BR')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
