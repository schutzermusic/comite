'use client';

import React, { useMemo, useState } from 'react';
import { User, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { OrgMember } from '@/lib/types/agenda';
import { isValidEmail } from './EmailChipsInput';

export const ASSIGN_EXTERNAL_MSG = 'Tarefas só podem ser atribuídas a usuários internos do grupo.';

/** Internal-only assignee picker. Typing an external e-mail is rejected. */
export function AssigneePicker({
  members,
  value,
  onChange,
  placeholder = 'Buscar usuário interno…',
}: {
  members: OrgMember[];
  value: string | null;
  onChange: (userId: string | null) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const selected = members.find((m) => m.userId === value);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return members.slice(0, 8);
    return members
      .filter((m) => (m.fullName ?? '').toLowerCase().includes(q) || (m.email ?? '').toLowerCase().includes(q))
      .slice(0, 8);
  }, [query, members]);

  // External email typed with no internal match → blocked.
  const externalAttempt = query.trim().length > 0 && isValidEmail(query) && filtered.length === 0;

  if (selected) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-ig-border-focus bg-ig-accent-weak px-3 py-2">
        <span className="flex items-center gap-2 text-sm text-ig-accent">
          <User className="h-4 w-4" />
          {selected.fullName || selected.email}
        </span>
        <button type="button" onClick={() => onChange(null)} className="text-ig-fg-muted hover:text-ig-fg-strong" aria-label="Remover responsável">
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        className={cn(
          'w-full rounded-lg border bg-ig-panel px-3 py-2 text-sm text-ig-fg-strong placeholder:text-ig-fg-subtle focus:outline-none',
          externalAttempt ? 'border-ig-danger focus:border-ig-danger' : 'border-ig-border-strong focus:border-ig-border-focus',
        )}
      />
      {externalAttempt && <p className="mt-1 text-xs text-ig-danger">{ASSIGN_EXTERNAL_MSG}</p>}
      {open && !externalAttempt && filtered.length > 0 && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-ig-border bg-ig-overlay shadow-lg">
          {filtered.map((m) => (
            <button
              key={m.userId}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(m.userId);
                setQuery('');
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ig-fg-strong transition-colors hover:bg-ig-panel-hover"
            >
              <User className="h-3.5 w-3.5 text-ig-accent" />
              <span className="flex-1 truncate">{m.fullName || m.email}</span>
              <span className="truncate text-xs text-ig-fg-subtle">{m.jobTitle || m.email}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
