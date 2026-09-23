"use client";

/**
 * QUEM responde — uma identidade da plataforma, não um nome digitado.
 *
 * O texto livre continua possível para quem NÃO está na plataforma (o
 * gerente do cliente, um parceiro), e só para isso: a opção aparece com esse
 * rótulo, e a tela nunca oferece o texto quando a pessoa existe como usuário.
 * Uma fila "minha" só funciona se o dono for uma identidade.
 */
import { useEffect, useState } from "react";

export interface Person { id: string; name: string; self: boolean }

let cache: Promise<{ people: Person[]; me: string | null }> | null = null;

function loadPeople() {
  if (!cache) {
    cache = fetch("/api/commercial/assignees")
      .then((response) => response.json())
      .then((payload) => (payload?.ok ? { people: payload.people as Person[], me: payload.me as string } : { people: [], me: null }))
      .catch(() => ({ people: [], me: null }));
    // Um erro não pode ficar em cache para a sessão inteira.
    cache.then((value) => { if (!value.people.length) cache = null; });
  }
  return cache;
}

export function usePeople() {
  const [state, setState] = useState<{ people: Person[]; me: string | null; ready: boolean }>(
    { people: [], me: null, ready: false });
  useEffect(() => {
    let alive = true;
    loadPeople().then((value) => { if (alive) setState({ ...value, ready: true }); });
    return () => { alive = false; };
  }, []);
  return state;
}

export const EXTERNAL = "__external__";

export function PersonSelect({
  label,
  value,
  onChange,
  allowExternal = false,
  externalText,
  onExternalText,
  required,
  placeholder = "Escolha uma pessoa",
  name,
}: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  allowExternal?: boolean;
  externalText?: string;
  onExternalText?: (text: string) => void;
  required?: boolean;
  placeholder?: string;
  name?: string;
}) {
  const { people, ready } = usePeople();
  const isExternal = value === EXTERNAL;
  return (
    <div className="crm-field">
      <label className="crm-field-label">
        <span>{label}{required ? " *" : ""}</span>
        <select
          name={name}
          aria-label={label}
          value={value ?? ""}
          required={required}
          onChange={(event) => onChange(event.target.value || null)}
        >
          <option value="">{ready ? placeholder : "Carregando equipe…"}</option>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}{person.self ? " (você)" : ""}
            </option>
          ))}
          {allowExternal && <option value={EXTERNAL}>Pessoa fora da plataforma…</option>}
        </select>
      </label>
      {allowExternal && isExternal && (
        <input
          className="crm-field-input"
          aria-label={`${label} — nome de quem não usa a plataforma`}
          placeholder="Nome e empresa"
          maxLength={200}
          value={externalText ?? ""}
          onChange={(event) => onExternalText?.(event.target.value)}
        />
      )}
    </div>
  );
}
