"use client";

/**
 * A CONTA vem do cadastro único — escolhida, não digitada.
 *
 * A busca é assistência de digitação sobre `parties` (a mesma função que o
 * contrato usa). Criar uma conta nova só aparece depois de uma busca sem
 * resultado exato, e passa pelo `createParty` canônico: com CNPJ, a mesma
 * empresa devolve a MESMA linha — nunca um segundo cadastro.
 */
import { useEffect, useId, useRef, useState } from "react";
import { Building2, Loader2, Plus, Search, UserRound, X } from "lucide-react";
import { HudButton } from "@/components/hud";
import { createParty, searchParties } from "@/lib/parties/party-service";
import type { PartyRow } from "@/lib/parties/types";

export interface PickedAccount {
  id: string;
  name: string;
  document: string | null;
}

export const accountFromParty = (p: PartyRow): PickedAccount => ({
  id: p.id,
  name: p.trade_name || p.legal_name,
  document: p.document_number,
});

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");

export function AccountPicker({
  value,
  onChange,
  allowCreate = true,
  autoFocus = false,
  label = "Conta / cliente",
}: {
  value: PickedAccount | null;
  onChange: (value: PickedAccount | null) => void;
  allowCreate?: boolean;
  autoFocus?: boolean;
  label?: string;
}) {
  const [term, setTerm] = useState("");
  const [rows, setRows] = useState<PartyRow[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listId = useId();
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (value) return;
    let alive = true;
    const timer = setTimeout(() => {
      setLoading(true);
      searchParties(term, 8)
        .then((r) => {
          if (alive) {
            setRows(r);
            setActive(0);
          }
        })
        .catch((e) => alive && setError((e as Error).message))
        .finally(() => alive && setLoading(false));
    }, 220);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [term, value]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  if (value) {
    return (
      <div className="crm-field">
        <span className="crm-flow-label">{label}</span>
        <div className="crm-picked" data-testid="account-picked">
          <span className="crm-picked-avatar" aria-hidden>{initials(value.name)}</span>
          <div>
            <strong>{value.name}</strong>
            <small>{value.document ? `Documento ${value.document}` : "Cadastro único · sem documento"}</small>
          </div>
          <HudButton variant="ghost" size="sm" onClick={() => onChange(null)} aria-label="Trocar conta">
            <X size={13} aria-hidden /> Trocar
          </HudButton>
        </div>
      </div>
    );
  }

  const exact = rows.some(
    (r) => [r.legal_name, r.trade_name].some((n) => n?.toLowerCase() === term.trim().toLowerCase()),
  );

  return (
    <div className="crm-field crm-combobox" ref={wrap}>
      <label className="crm-field-label">
        <span>{label} *</span>
        <span style={{ position: "relative", display: "block" }}>
          <Search size={14} aria-hidden style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", opacity: 0.55 }} />
          <input
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            autoFocus={autoFocus}
            placeholder="Buscar no cadastro único por nome…"
            value={term}
            style={{ paddingLeft: 30 }}
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              setTerm(e.target.value);
              setOpen(true);
              setCreating(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, rows.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter" && open && rows[active]) {
                e.preventDefault();
                onChange(accountFromParty(rows[active]));
              } else if (e.key === "Escape") {
                setOpen(false);
              }
            }}
          />
        </span>
      </label>
      {open && !creating && (
        <div className="crm-combobox-list" id={listId} role="listbox" aria-label="Contas encontradas">
          {loading && (
            <div className="crm-combobox-empty"><Loader2 size={12} className="animate-spin inline" aria-hidden /> Buscando…</div>
          )}
          {!loading && rows.map((row, index) => (
            <button
              key={row.id}
              type="button"
              role="option"
              aria-selected={index === active}
              onMouseEnter={() => setActive(index)}
              onClick={() => onChange(accountFromParty(row))}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                {row.kind === "person" ? <UserRound size={14} aria-hidden /> : <Building2 size={14} aria-hidden />}
                <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{row.trade_name || row.legal_name}</span>
              </span>
              <small>{row.document_number ?? (row.trade_name ? row.legal_name : "")}</small>
            </button>
          ))}
          {!loading && !rows.length && (
            <div className="crm-combobox-empty">
              {term.trim() ? "Nenhuma conta com esse nome no cadastro único." : "Digite para buscar."}
            </div>
          )}
          {allowCreate && !loading && term.trim().length >= 3 && !exact && (
            <button type="button" onClick={() => setCreating(true)}>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Plus size={14} aria-hidden /> Cadastrar “{term.trim()}” como nova conta
              </span>
              <small>cadastro único</small>
            </button>
          )}
        </div>
      )}
      {creating && (
        <NewAccount
          initialName={term.trim()}
          onCancel={() => setCreating(false)}
          onCreated={(party) => {
            setCreating(false);
            onChange(accountFromParty(party));
          }}
        />
      )}
      {error && <p className="crm-field-hint" role="alert">{error}</p>}
    </div>
  );
}

function NewAccount({
  initialName,
  onCancel,
  onCreated,
}: {
  initialName: string;
  onCancel: () => void;
  onCreated: (party: PartyRow) => void;
}) {
  const [name, setName] = useState(initialName);
  const [cnpj, setCnpj] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const digits = cnpj.replace(/\D/g, "");
      const party = await createParty({
        legalName: name.trim(),
        kind: "organization",
        documentType: digits ? "cnpj" : null,
        documentNumber: digits || null,
        roles: ["customer"],
      });
      onCreated(party);
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };
  return (
    <div className="crm-unlock" style={{ alignItems: "flex-start" }} data-testid="account-new">
      <div className="crm-flow-grid" style={{ flex: "1 1 100%" }}>
        <label className="crm-field-label">
          <span>Razão social *</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={300} />
        </label>
        <label className="crm-field-label">
          <span>CNPJ</span>
          <input value={cnpj} inputMode="numeric" placeholder="Evita duplicidade" onChange={(e) => setCnpj(e.target.value)} />
        </label>
        <p className="crm-field-hint crm-span-2">
          Com CNPJ, uma empresa já cadastrada é reaproveitada — nunca duplicada. Sem CNPJ, confira a busca acima antes.
        </p>
      </div>
      {error && <p className="crm-field-hint" role="alert" style={{ color: "var(--ig-danger)" }}>{error}</p>}
      <div className="crm-unlock-action" style={{ marginLeft: "auto" }}>
        <HudButton variant="ghost" size="sm" onClick={onCancel} disabled={saving}>Voltar à busca</HudButton>
        <HudButton variant="primary" size="sm" onClick={save} disabled={saving || name.trim().length < 2}>
          {saving ? "Cadastrando…" : "Cadastrar conta"}
        </HudButton>
      </div>
    </div>
  );
}

/** Contatos da conta, carregados uma vez — o principal primeiro. */
export interface AccountContact {
  id: string;
  party_id: string;
  full_name: string;
  role_title: string | null;
  email: string | null;
  phone: string | null;
  is_primary: boolean;
}
let contactsCache: Promise<AccountContact[]> | null = null;
export function loadContacts(force = false) {
  if (!contactsCache || force) {
    contactsCache = fetch("/api/commercial/contacts")
      .then((r) => r.json())
      .then((p) => (p?.ok ? (p.contacts as AccountContact[]) : []))
      .catch(() => []);
  }
  return contactsCache;
}
export function useAccountContacts(partyId: string | null) {
  const [loaded, setLoaded] = useState<{ partyId: string; contacts: AccountContact[] } | null>(null);
  useEffect(() => {
    if (!partyId) return;
    let alive = true;
    loadContacts().then((all) => {
      if (alive)
        setLoaded({
          partyId,
          contacts: all.filter((c) => c.party_id === partyId).sort((a, b) => Number(b.is_primary) - Number(a.is_primary)),
        });
    });
    return () => {
      alive = false;
    };
  }, [partyId]);
  return partyId && loaded?.partyId === partyId ? loaded.contacts : null;
}
