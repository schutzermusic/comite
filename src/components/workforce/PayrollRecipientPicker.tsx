'use client';

/**
 * Quem recebe o fechamento da folha — escolhido de uma lista que o SERVIDOR dá:
 * membros ativos da organização e contatos externos autorizados. Não há campo
 * de endereço livre: o envio leva referências, e o servidor resolve o e-mail.
 *
 * Quem administra a folha (`people.payroll_admin`) autoriza e revoga contatos
 * externos aqui mesmo; cada ato fica na auditoria.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Search, Trash2, UserRound, Building2 } from 'lucide-react';
import { HudButton } from '@/components/hud';
import {
  authorizePayrollContact, getPayrollRecipients, revokePayrollContact,
  type PayrollRecipientDirectory, type PayrollRecipientRef,
} from '@/lib/payroll/client';

export type RecipientRole = 'to' | 'cc';
export type RecipientSelection = Record<string, RecipientRole>;

/** `member:<id>` / `contact:<id>` → referência tipada. */
export function selectionToRefs(sel: RecipientSelection): { to: PayrollRecipientRef[]; cc: PayrollRecipientRef[] } {
  const to: PayrollRecipientRef[] = []; const cc: PayrollRecipientRef[] = [];
  for (const [key, role] of Object.entries(sel)) {
    const [type, id] = key.split(':') as ['member' | 'contact', string];
    (role === 'to' ? to : cc).push({ type, id });
  }
  return { to, cc };
}

export function PayrollRecipientPicker({ value, onChange, notify }: {
  value: RecipientSelection;
  onChange: (next: RecipientSelection) => void;
  notify: (title: string, opts?: { variant?: 'success' | 'error' | 'warning' | 'info'; description?: string }) => void;
}) {
  const [dir, setDir] = useState<PayrollRecipientDirectory | null>(null);
  const [query, setQuery] = useState('');
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const d = await getPayrollRecipients().catch(() => null);
    if (!d || !d.ok) {
      notify('Falha ao carregar destinatários', { variant: 'error', description: d?.error });
      setDir({ ok: false, members: [], contacts: [], can_manage_contacts: false });
      return;
    }
    setDir(d);
  }, [notify]);
  useEffect(() => { void load(); }, [load]);

  const rows = useMemo(() => {
    if (!dir) return [];
    const q = query.trim().toLowerCase();
    const all = [
      ...dir.members.map((m) => ({ key: `member:${m.id}`, kind: 'member' as const, ...m })),
      ...dir.contacts.map((c) => ({ key: `contact:${c.id}`, kind: 'contact' as const, ...c })),
    ];
    return q ? all.filter((r) => r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q)) : all;
  }, [dir, query]);

  const setRole = (key: string, role: RecipientRole | null) => {
    const next = { ...value };
    if (role) next[key] = role; else delete next[key];
    onChange(next);
  };

  const authorize = async () => {
    setBusy(true);
    try {
      const r = await authorizePayrollContact({ email: newEmail.trim(), display_name: newName.trim() });
      if (!r.ok) { notify('Contato não autorizado', { variant: 'error', description: r.error }); return; }
      setNewName(''); setNewEmail('');
      notify('Contato externo autorizado', { variant: 'success' });
      await load();
    } finally { setBusy(false); }
  };

  const revoke = async (id: string) => {
    setBusy(true);
    try {
      const r = await revokePayrollContact(id);
      if (!r.ok) { notify('Falha ao revogar', { variant: 'error', description: r.error }); return; }
      setRole(`contact:${id}`, null);
      notify('Contato revogado', { variant: 'info' });
      await load();
    } finally { setBusy(false); }
  };

  if (!dir) {
    return <div className="flex items-center gap-2 text-sm text-ig-fg-subtle"><Loader2 className="w-4 h-4 animate-spin" /> Carregando destinatários…</div>;
  }

  return (
    <div className="flex flex-col gap-3" data-testid="payroll-recipient-picker">
      <label className="flex items-center gap-2 rounded-lg border border-ig-border-subtle px-3 py-2 text-sm">
        <Search className="w-4 h-4 text-ig-fg-subtle" aria-hidden />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar membro ou contato autorizado"
          aria-label="Buscar destinatário" className="flex-1 bg-transparent outline-none" />
      </label>

      <div className="max-h-72 overflow-auto rounded-xl border border-ig-border-subtle divide-y divide-ig-border-subtle" role="list">
        {rows.length === 0 && (
          <div className="px-3 py-4 text-sm text-ig-fg-subtle">Nenhum destinatário disponível. Membros ativos e contatos autorizados aparecem aqui.</div>
        )}
        {rows.map((r) => {
          const role = value[r.key] ?? null;
          return (
            <div key={r.key} role="listitem" data-testid="payroll-recipient" data-key={r.key}
              className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
              {r.kind === 'member' ? <UserRound className="w-4 h-4 text-ig-fg-subtle" aria-hidden /> : <Building2 className="w-4 h-4 text-amber-400" aria-hidden />}
              <div className="flex-1 min-w-[12rem]">
                <div className="font-medium text-ig-fg-strong">{r.name}</div>
                <div className="text-xs text-ig-fg-subtle">{r.email}{r.kind === 'contact' ? ' · contato externo autorizado' : ''}</div>
              </div>
              <div className="flex rounded-lg border border-ig-border-subtle overflow-hidden" role="radiogroup" aria-label={`Envio para ${r.name}`}>
                {([['—', null], ['Para', 'to'], ['Cc', 'cc']] as const).map(([label, v]) => (
                  <button key={label} type="button" role="radio" aria-checked={role === v}
                    onClick={() => setRole(r.key, v)}
                    className={`min-h-[36px] px-3 text-xs ${role === v ? 'bg-ig-accent/20 text-ig-fg-strong font-semibold' : 'text-ig-fg-subtle hover:bg-ig-panel-hover'}`}>
                    {label}
                  </button>
                ))}
              </div>
              {r.kind === 'contact' && dir.can_manage_contacts && (
                <button type="button" onClick={() => void revoke(r.key.split(':')[1])} disabled={busy}
                  className="rounded-full p-1.5 text-ig-fg-subtle hover:text-rose-400" aria-label={`Revogar ${r.name}`} title="Revogar autorização">
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {dir.can_manage_contacts && (
        <div className="rounded-xl border border-dashed border-ig-border-subtle p-3" data-testid="payroll-contact-form">
          <div className="text-xs text-ig-fg-subtle mb-2">
            Autorizar contato externo (ex.: contabilidade). Só quem administra a folha autoriza; o envio passa a poder incluí-lo.
          </div>
          <div className="flex flex-wrap gap-2">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nome" aria-label="Nome do contato"
              className="flex-1 min-w-[10rem] rounded-lg border border-ig-border-subtle bg-transparent px-3 py-2 text-sm" />
            <input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="email@empresa.com" aria-label="E-mail do contato"
              type="email" className="flex-1 min-w-[12rem] rounded-lg border border-ig-border-subtle bg-transparent px-3 py-2 text-sm" />
            <HudButton variant="secondary" leftIcon={<Plus className="w-4 h-4" />} disabled={busy || !newName.trim() || !newEmail.trim()}
              onClick={() => void authorize()}>Autorizar</HudButton>
          </div>
        </div>
      )}
    </div>
  );
}
