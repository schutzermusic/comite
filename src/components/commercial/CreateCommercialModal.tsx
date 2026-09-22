"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { HudButton, HudInput, HudModal } from "@/components/hud";
import type { HudSelectProps } from "@/components/hud/HudSelect";
import { usePermissions } from "@/hooks/use-permissions";
import { listParties } from "@/lib/parties/party-service";
import type { PartyRow } from "@/lib/parties/types";
import { GovernanceNote } from "./workspace";

type Kind = "opportunity" | "proposal" | "contact";
const labels: Record<Kind, string> = {
  opportunity: "Nova oportunidade",
  proposal: "Nova proposta",
  contact: "Novo contato",
};
export function CreateCommercialButton({
  kind,
  onCreated,
}: {
  kind: Kind;
  onCreated: () => void;
}) {
  const { hasPermission } = usePermissions();
  const [open, setOpen] = useState(false);
  if (
    !hasPermission(
      kind === "proposal" ? "commercial.proposals.manage" : "commercial.manage",
    )
  )
    return null;
  return (
    <>
      <HudButton variant="primary" size="md" onClick={() => setOpen(true)}>
        <Plus size={15} aria-hidden />
        {labels[kind]}
      </HudButton>
      {open && (
        <CreateCommercialModal
          kind={kind}
          onClose={() => setOpen(false)}
          onCreated={() => {
            setOpen(false);
            onCreated();
          }}
        />
      )}
    </>
  );
}
function CreateCommercialModal({
  kind,
  onClose,
  onCreated,
}: {
  kind: Kind;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({
    currency: "BRL",
    kind: "COMBINED",
  });
  const [parties, setParties] = useState<PartyRow[]>([]);
  const [opportunities, setOpportunities] = useState<
    { id: string; title: string; counterparty_name: string; currency: string }[]
  >([]);
  const [loading, setLoading] = useState(kind !== "opportunity");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const set = (key: string, value: string) =>
    setValues((v) => ({ ...v, [key]: value }));
  useEffect(() => {
    let active = true;
    if (kind === "opportunity") return;
    const load =
      kind === "contact"
        ? listParties().then((rows) => {
            if (active) setParties(rows);
          })
        : fetch("/api/commercial/opportunities").then(async (r) => {
            const p = await r.json();
            if (!r.ok || !p.ok)
              throw new Error(
                p.error || "Não foi possível carregar oportunidades.",
              );
            if (active) setOpportunities(p.opportunities);
          });
    load
      .catch((e) => {
        if (active) setLookupError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [kind]);
  const field = (
    key: string,
    label: string,
    type = "text",
    required = false,
  ) => (
    <HudInput
      key={key}
      label={label}
      aria-label={label}
      type={type}
      required={required}
      value={values[key] ?? ""}
      onChange={(e) => set(key, e.target.value)}
      {...(type === "number" ? { min: 0, step: "0.01" } : {})}
    />
  );
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    const payload: Record<string, unknown> = Object.fromEntries(
      Object.entries(values).map(([k, v]) => [k, v.trim() || null]),
    );
    if (kind === "opportunity" && values.probability)
      payload.probability = Number(values.probability) / 100;
    try {
      const response = await fetch(
        `/api/commercial/${kind === "opportunity" ? "opportunities" : kind === "proposal" ? "proposals" : "contacts"}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const result = await response.json();
      if (!response.ok || !result.ok)
        throw new Error(result.error ?? "Não foi possível salvar.");
      onCreated();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };
  return (
    <HudModal
      isOpen
      onClose={() => {
        if (!saving) onClose();
      }}
      title={labels[kind]}
      subtitle={
        kind === "contact"
          ? "Vincule uma pessoa a uma contraparte do cadastro único."
          : "Registre o próximo passo do relacionamento comercial."
      }
      size="md"
    >
      <form className="crm-form" onSubmit={submit}>
        {kind === "contact" ? (
          <>
            <FormSelect
              label="Conta / contraparte"
              value={values.party_id ?? ""}
              options={[
                {
                  value: "",
                  label: loading
                    ? "Carregando contas…"
                    : "Selecione uma conta existente",
                },
                ...parties.map((p) => ({
                  value: p.id,
                  label: p.trade_name || p.legal_name,
                })),
              ]}
              onChange={(v) => set("party_id", v)}
            />
            {!loading && !parties.length && !lookupError && (
              <p className="crm-muted">
                Cadastre primeiro a contraparte no cadastro canônico da
                plataforma.
              </p>
            )}
            {field("full_name", "Nome completo", "text", true)}
            {field("role_title", "Cargo")}
            <div className="crm-form-grid">
              {field("email", "E-mail", "email")}
              {field("phone", "Telefone", "tel")}
            </div>
          </>
        ) : (
          <>
            {kind === "proposal" && (
              <div className="crm-form-grid">
                {field("proposal_number", "Número da proposta", "text", true)}
                <FormSelect
                  label="Tipo"
                  value={values.kind}
                  options={[
                    { value: "COMBINED", label: "Técnica + Comercial" },
                    { value: "TECHNICAL", label: "Técnica" },
                    { value: "COMMERCIAL", label: "Comercial" },
                  ]}
                  onChange={(v) => set("kind", v)}
                />
              </div>
            )}
            {field("title", "Título", "text", true)}
            {kind === "proposal" && (
              <FormSelect
                label="Oportunidade (opcional)"
                value={values.opportunity_id ?? ""}
                options={[
                  { value: "", label: loading ? "Carregando…" : "Sem vínculo" },
                  ...opportunities.map((o) => ({
                    value: o.id,
                    label: o.title,
                  })),
                ]}
                onChange={(v) => {
                  const o = opportunities.find((o) => o.id === v);
                  setValues((prev) => ({
                    ...prev,
                    opportunity_id: v,
                    ...(o
                      ? {
                          counterparty_name: o.counterparty_name,
                          currency: o.currency,
                        }
                      : {}),
                  }));
                }}
              />
            )}
            {field("counterparty_name", "Cliente / contraparte", "text", true)}
            <div className="crm-form-grid">
              {field(
                kind === "proposal" ? "total_value" : "estimated_value",
                "Valor estimado (opcional)",
                "number",
              )}
              <FormSelect
                label="Moeda"
                value={values.currency}
                options={["BRL", "USD", "EUR"].map((v) => ({
                  value: v,
                  label: v,
                }))}
                onChange={(v) => set("currency", v)}
              />
            </div>
            {field(
              kind === "proposal" ? "validity_until" : "expected_decision_date",
              kind === "proposal"
                ? "Validade (opcional)"
                : "Decisão prevista (opcional)",
              "date",
            )}
            {kind === "opportunity" && (
              <HudInput
                label="Probabilidade informada (%) · opcional"
                aria-label="Probabilidade informada (%) · opcional"
                type="number"
                min={0}
                max={100}
                step="1"
                value={values.probability ?? ""}
                onChange={(e) => set("probability", e.target.value)}
              />
            )}
            <GovernanceNote>
              {kind === "proposal"
                ? "A proposta nasce em rascunho. Revisão interna, envio e registro do aceite continuam sendo etapas separadas."
                : "A oportunidade nasce em qualificação e não cria contrato, projeto ou receita."}
            </GovernanceNote>
          </>
        )}
        {lookupError && (
          <p role="alert" className="text-sm text-red-500">
            {lookupError}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-500">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <HudButton
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={saving}
          >
            Cancelar
          </HudButton>
          <HudButton
            type="submit"
            variant="primary"
            disabled={
              saving ||
              (kind === "contact" &&
                (!values.party_id || loading || !!lookupError))
            }
          >
            {saving ? "Salvando…" : "Salvar registro"}
          </HudButton>
        </div>
      </form>
    </HudModal>
  );
}

/** Accessible native select using the existing HUD form materials. */
function FormSelect({ label, value, options, onChange }: HudSelectProps) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="text-[11px] font-medium hud-label uppercase tracking-wider"
      >
        {label}
      </label>
      <select
        id={id}
        className="hud-input-bg hud-text h-10 rounded-lg border px-3 text-sm w-full"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option
            key={option.value}
            value={option.value}
            disabled={option.disabled}
          >
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
