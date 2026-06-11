'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Download, FileText, Loader2, Paperclip, Trash2, Upload } from 'lucide-react';
import { HudButton, useHudToast } from '@/components/hud';
import type { AgendaAttachment } from '@/lib/types/agenda';
import {
  deleteAttachment,
  getAttachmentUrl,
  listAttachments,
  uploadAttachment,
} from '@/lib/services/agenda-attachments';

function formatSize(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Attachment list + upload for a task or meeting (detail drawers/modals). */
export function AttachmentsSection({
  entityType,
  entityId,
  canUpload = true,
}: {
  entityType: 'task' | 'event';
  entityId: string;
  canUpload?: boolean;
}) {
  const { toast } = useHudToast();
  const [items, setItems] = useState<AgendaAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      setItems(await listAttachments(entityType, entityId));
    } catch {
      // Sem acesso (RLS) ou tabela vazia — seção fica vazia.
    } finally {
      setLoading(false);
    }
  }, [entityType, entityId]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      await uploadAttachment(entityType, entityId, file);
      await refresh();
      toast({ title: 'Anexo enviado.' });
    } catch (e) {
      toast({ title: 'Falha no upload', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const handleDownload = async (att: AgendaAttachment) => {
    try {
      const url = await getAttachmentUrl(att);
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      toast({ title: 'Falha ao abrir anexo', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    }
  };

  const handleDelete = async (att: AgendaAttachment) => {
    try {
      await deleteAttachment(att);
      setItems((prev) => prev.filter((i) => i.id !== att.id));
      toast({ title: 'Anexo excluído.' });
    } catch (e) {
      toast({ title: 'Falha ao excluir anexo', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-ig-fg-muted">
          <Paperclip className="h-3.5 w-3.5" />
          Anexos
        </span>
        {canUpload && (
          <HudButton
            variant="ghost"
            size="sm"
            onClick={() => inputRef.current?.click()}
            isLoading={uploading}
            leftIcon={<Upload className="h-3.5 w-3.5" />}
          >
            Enviar
          </HudButton>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleUpload(file);
        }}
      />

      {loading ? (
        <div className="flex items-center gap-2 py-2 text-xs text-ig-fg-subtle">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Carregando anexos…
        </div>
      ) : items.length === 0 ? (
        <p className="py-1 text-xs text-ig-fg-subtle">Nenhum anexo.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((att) => (
            <li
              key={att.id}
              className="flex items-center gap-2 rounded-md border border-ig-border-subtle bg-ig-panel px-2.5 py-1.5 text-sm"
            >
              <FileText className="h-4 w-4 shrink-0 text-ig-accent" />
              <button
                type="button"
                onClick={() => void handleDownload(att)}
                className="min-w-0 flex-1 truncate text-left text-ig-fg-strong hover:text-ig-accent focus-visible:outline-none"
                title={att.fileName}
              >
                {att.fileName}
              </button>
              <span className="shrink-0 text-xs text-ig-fg-subtle">{formatSize(att.fileSize)}</span>
              <button
                type="button"
                onClick={() => void handleDownload(att)}
                className="shrink-0 text-ig-fg-muted hover:text-ig-fg-strong"
                aria-label="Baixar anexo"
              >
                <Download className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => void handleDelete(att)}
                className="shrink-0 text-ig-fg-muted hover:text-ig-danger"
                aria-label="Excluir anexo"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
