'use client';

import React, { useMemo, useRef, useState } from 'react';
import { Check, User, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MeetingGuestInput, OrgMember } from '@/lib/types/agenda';

interface Props {
  members: OrgMember[];
  value: MeetingGuestInput[];
  onChange: (chips: MeetingGuestInput[]) => void;
  placeholder?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}

/**
 * Free-input email field with chips/tags. Accepts ANY valid email
 * (internal or external). Emails matching an org member link to a user_id
 * and are flagged "interno"; everything else is "externo". Internal members
 * are also offered as type-ahead suggestions.
 */
export function EmailChipsInput({ members, value, onChange, placeholder }: Props) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const resolveGuest = (email: string): MeetingGuestInput => {
    const lower = email.toLowerCase().trim();
    const member = members.find((m) => (m.email ?? '').toLowerCase() === lower);
    if (member) {
      return { email: member.email ?? email.trim(), userId: member.userId, name: member.fullName, isExternal: false };
    }
    return { email: email.trim(), isExternal: true };
  };

  const addEmail = (raw: string) => {
    const email = raw.trim().replace(/[,;]+$/, '');
    if (!email) return;
    if (!isValidEmail(email)) {
      setError(`E-mail inválido: ${email}`);
      return;
    }
    if (value.some((g) => g.email.toLowerCase() === email.toLowerCase())) {
      setDraft('');
      return;
    }
    onChange([...value, resolveGuest(email)]);
    setDraft('');
    setError(null);
  };

  const addMember = (member: OrgMember) => {
    if (!member.email) return;
    if (value.some((g) => g.email.toLowerCase() === (member.email ?? '').toLowerCase())) return;
    onChange([...value, { email: member.email, userId: member.userId, name: member.fullName, isExternal: false }]);
    setDraft('');
    setError(null);
    inputRef.current?.focus();
  };

  const removeAt = (idx: number) => onChange(value.filter((_, i) => i !== idx));

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ';') {
      e.preventDefault();
      addEmail(draft);
    } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
      removeAt(value.length - 1);
    }
  };

  const suggestions = useMemo(() => {
    const q = draft.toLowerCase().trim();
    if (q.length < 1) return [];
    const chosen = new Set(value.map((g) => g.email.toLowerCase()));
    return members
      .filter(
        (m) =>
          m.email &&
          !chosen.has(m.email.toLowerCase()) &&
          ((m.fullName ?? '').toLowerCase().includes(q) || m.email.toLowerCase().includes(q)),
      )
      .slice(0, 5);
  }, [draft, members, value]);

  return (
    <div className="space-y-1.5">
      <div
        className="flex min-h-[42px] flex-wrap items-center gap-1.5 rounded-lg border border-ig-border-strong bg-ig-panel px-2 py-1.5 focus-within:border-ig-border-focus"
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((guest, idx) => (
          <span
            key={`${guest.email}-${idx}`}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs',
              guest.isExternal
                ? 'border-ig-border bg-ig-panel-hover text-ig-fg-strong'
                : 'border-ig-border-focus bg-ig-accent-weak text-ig-accent',
            )}
          >
            {!guest.isExternal && <Check className="h-3 w-3" />}
            <span className="max-w-[180px] truncate">{guest.name || guest.email}</span>
            <span className="text-[9px] uppercase opacity-70">{guest.isExternal ? 'externo' : 'interno'}</span>
            <button type="button" onClick={() => removeAt(idx)} className="ml-0.5 hover:opacity-70" aria-label="Remover">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onKeyDown={handleKeyDown}
          onBlur={() => draft && addEmail(draft)}
          placeholder={value.length === 0 ? (placeholder ?? 'Digite um e-mail e tecle Enter') : ''}
          className="min-w-[140px] flex-1 bg-transparent text-sm text-ig-fg-strong placeholder:text-ig-fg-subtle focus:outline-none"
        />
      </div>

      {suggestions.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-ig-border bg-ig-overlay">
          {suggestions.map((m) => (
            <button
              key={m.userId}
              type="button"
              onClick={() => addMember(m)}
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm text-ig-fg-strong transition-colors hover:bg-ig-panel-hover"
            >
              <User className="h-3.5 w-3.5 text-ig-accent" />
              <span className="flex-1 truncate">{m.fullName || m.email}</span>
              <span className="truncate text-xs text-ig-fg-subtle">{m.email}</span>
            </button>
          ))}
        </div>
      )}

      {error && <p className="text-xs text-ig-danger">{error}</p>}
    </div>
  );
}
