'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, MessageSquare, Send } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { HudButton, useHudToast } from '@/components/hud';
import type { OrgMember, TaskComment } from '@/lib/types/agenda';
import { addTaskComment, listTaskComments } from '@/lib/services/agenda';

/** Comment thread for a task (detail drawer). */
export function TaskCommentsThread({ taskId, members }: { taskId: string; members: OrgMember[] }) {
  const { toast } = useHudToast();
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setComments(await listTaskComments(taskId));
    } catch {
      // Sem acesso — thread fica vazia.
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  const authorName = (userId: string) =>
    members.find((m) => m.userId === userId)?.fullName ?? 'Usuário';

  const handleSend = async () => {
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    try {
      const comment = await addTaskComment(taskId, body);
      setComments((prev) => [...prev, comment]);
      setDraft('');
    } catch (e) {
      toast({ title: 'Falha ao comentar', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-ig-fg-muted">
        <MessageSquare className="h-3.5 w-3.5" />
        Comentários
      </span>

      {loading ? (
        <div className="flex items-center gap-2 py-2 text-xs text-ig-fg-subtle">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Carregando…
        </div>
      ) : comments.length === 0 ? (
        <p className="py-1 text-xs text-ig-fg-subtle">Nenhum comentário ainda.</p>
      ) : (
        <ul className="flex max-h-56 flex-col gap-1.5 overflow-y-auto pr-1">
          {comments.map((c) => (
            <li key={c.id} className="rounded-md border border-ig-border-subtle bg-ig-panel px-2.5 py-2">
              <div className="mb-0.5 flex items-baseline justify-between gap-2">
                <span className="truncate text-xs font-medium text-ig-fg-strong">{authorName(c.authorUserId)}</span>
                <span className="shrink-0 text-[10px] text-ig-fg-subtle">
                  {format(c.createdAt, "dd MMM HH:mm", { locale: ptBR })}
                </span>
              </div>
              <p className="whitespace-pre-wrap break-words text-sm text-ig-fg-muted">{c.body}</p>
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void handleSend();
            }
          }}
          rows={2}
          placeholder="Escrever comentário… (⌘+Enter envia)"
          className="flex-1 resize-none rounded-lg border border-ig-border-strong bg-ig-panel px-3 py-2 text-sm text-ig-fg-strong placeholder:text-ig-fg-subtle focus:border-ig-border-focus focus:outline-none"
        />
        <HudButton
          variant="secondary"
          size="sm"
          onClick={() => void handleSend()}
          isLoading={sending}
          leftIcon={<Send className="h-3.5 w-3.5" />}
          className="self-end"
        >
          Enviar
        </HudButton>
      </div>
    </div>
  );
}
