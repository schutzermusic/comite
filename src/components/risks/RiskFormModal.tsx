"use client";

import React, { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { HudModal, HudButton, HudInput, HudSelect } from "@/components/hud";
import { SEVERITY_LABELS, RISK_DOMAINS } from "./risk-types";
import { severityColor } from "./risk-utils";
import type { ExtendedRisk, RiskAction, RiskEvidence } from "./risk-types";

function genId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const ACTION_STATUS_OPTIONS = [
  { value: "pending", label: "Pendente" },
  { value: "in_progress", label: "Em andamento" },
  { value: "done", label: "Concluída" },
];

const EVIDENCE_TYPE_OPTIONS = [
  { value: "link", label: "Link" },
  { value: "document", label: "Documento" },
  { value: "image", label: "Imagem" },
];

/* Severity from level — aligned with services/risks.computeSeverity. */
function sevFromLevel(level: number): ExtendedRisk["severity"] {
  if (level >= 16) return "critical";
  if (level >= 12) return "high";
  if (level >= 7) return "medium";
  return "low";
}

export interface RiskFormValues {
  title: string;
  description: string;
  category: string;
  area: string;
  probability: number;
  impact: number;
  responsibleName: string;
  status: ExtendedRisk["status"];
  financialExposure?: number;
  mitigationPlan: string;
  nextAction: string;
  dueDate?: string; // yyyy-mm-dd
  origin: ExtendedRisk["origin"];
  referenceId?: string;
  referenceName?: string;
  actions: RiskAction[];
  evidences: RiskEvidence[];
}

export interface RiskLink {
  origin: ExtendedRisk["origin"];
  referenceId?: string;
  referenceName?: string;
}

interface RefOption { value: string; label: string }

interface Props {
  open: boolean;
  mode: "create" | "edit";
  risk?: ExtendedRisk | null;
  focusPlan?: boolean;
  saving?: boolean;
  /** Pre-fill the link when creating a risk from a project/contract context. */
  initialLink?: RiskLink;
  projectOptions?: RefOption[];
  contractOptions?: RefOption[];
  onClose: () => void;
  onSubmit: (values: RiskFormValues) => void | Promise<void>;
}

const VINCULO_OPTIONS = [
  { value: "manual", label: "Sem vínculo" },
  { value: "project", label: "Projeto" },
  { value: "contract", label: "Contrato" },
];

const CATEGORY_OPTIONS = [...RISK_DOMAINS, "Suprimentos", "Jurídico"].map((d) => ({ value: d, label: d }));
const SCALE = [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }));
const STATUS_OPTIONS = [
  { value: "open", label: "Aberto" },
  { value: "mitigating", label: "Mitigando" },
  { value: "resolved", label: "Resolvido" },
];

function toDateInput(d: Date | undefined): string {
  if (!d) return "";
  const tz = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return tz.toISOString().slice(0, 10);
}

const EMPTY: RiskFormValues = {
  title: "", description: "", category: "Operacional", area: "",
  probability: 3, impact: 3, responsibleName: "", status: "open",
  financialExposure: undefined, mitigationPlan: "", nextAction: "", dueDate: "",
  origin: "manual", referenceId: undefined, referenceName: undefined,
  actions: [], evidences: [],
};

function initialValues(mode: "create" | "edit", risk?: ExtendedRisk | null, link?: RiskLink): RiskFormValues {
  if (mode === "edit" && risk) {
    return {
      title: risk.title,
      description: risk.description ?? "",
      category: risk.category ?? "Operacional",
      area: risk.area ?? "",
      probability: risk.probability,
      impact: risk.impact,
      responsibleName: risk.responsibleName ?? "",
      status: risk.status,
      financialExposure: risk.financialExposure,
      mitigationPlan: risk.mitigationPlan ?? "",
      nextAction: risk.nextAction ?? "",
      dueDate: toDateInput(risk.dueDate),
      origin: risk.origin,
      referenceId: risk.referenceId,
      referenceName: risk.referenceName,
      actions: risk.actions.map((a) => ({ ...a })),
      evidences: risk.evidences.map((e) => ({ ...e })),
    };
  }
  if (link) {
    return { ...EMPTY, origin: link.origin, referenceId: link.referenceId, referenceName: link.referenceName };
  }
  return EMPTY;
}

/**
 * Stateless-on-reopen: the parent mounts this component only while open and
 * keys it per session, so initial values are derived once from props — no
 * prop-sync effect (avoids react-hooks/set-state-in-effect cascading renders).
 */
export function RiskFormModal({ open, mode, risk, focusPlan, saving, initialLink, projectOptions = [], contractOptions = [], onClose, onSubmit }: Props) {
  const [values, setValues] = useState<RiskFormValues>(() => initialValues(mode, risk, initialLink));
  const [error, setError] = useState<string | null>(null);
  const isAiRisk = mode === "edit" && risk?.origin === "ai";

  const handleVinculoChange = (v: string) => {
    if (v === "manual") {
      setValues((cur) => ({ ...cur, origin: "manual", referenceId: undefined, referenceName: undefined }));
    } else {
      setValues((cur) => ({ ...cur, origin: v as ExtendedRisk["origin"], referenceId: undefined, referenceName: undefined }));
    }
  };

  const pickRef = (opts: RefOption[]) => (value: string) => {
    const opt = opts.find((o) => o.value === value);
    setValues((cur) => ({ ...cur, referenceId: value, referenceName: opt?.label }));
  };

  const level = values.probability * values.impact;
  const severity = sevFromLevel(level);

  const set = <K extends keyof RiskFormValues>(key: K, v: RiskFormValues[K]) =>
    setValues((cur) => ({ ...cur, [key]: v }));

  const addAction = () =>
    setValues((cur) => ({
      ...cur,
      actions: [
        ...cur.actions,
        { id: genId(), riskId: risk?.id ?? "new", title: "", assignee: cur.responsibleName, dueDate: new Date(), status: "pending", createdAt: new Date() },
      ],
    }));

  const updateAction = (id: string, patch: Partial<RiskAction>) =>
    setValues((cur) => ({ ...cur, actions: cur.actions.map((a) => (a.id === id ? { ...a, ...patch } : a)) }));

  const removeAction = (id: string) =>
    setValues((cur) => ({ ...cur, actions: cur.actions.filter((a) => a.id !== id) }));

  const addEvidence = () =>
    setValues((cur) => ({
      ...cur,
      evidences: [
        ...cur.evidences,
        { id: genId(), riskId: risk?.id ?? "new", name: "", type: "link", url: "", uploadedAt: new Date(), uploadedBy: cur.responsibleName || "—" },
      ],
    }));

  const updateEvidence = (id: string, patch: Partial<RiskEvidence>) =>
    setValues((cur) => ({ ...cur, evidences: cur.evidences.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));

  const removeEvidence = (id: string) =>
    setValues((cur) => ({ ...cur, evidences: cur.evidences.filter((e) => e.id !== id) }));

  const handleSubmit = async () => {
    if (!values.title.trim()) {
      setError("Informe um título para o risco.");
      return;
    }
    setError(null);
    await onSubmit({ ...values, title: values.title.trim() });
  };

  const title = mode === "create" ? "Novo risco" : "Editar risco";
  const subtitle = useMemo(
    () => (mode === "edit" && risk ? risk.id : "Cadastrar risco no mapa corporativo"),
    [mode, risk],
  );

  return (
    <HudModal
      isOpen={open}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      size="lg"
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-[11px] text-ig-fg-muted">
            Score
            <span className="rounded-md border px-1.5 py-0.5 font-mono text-[12px] font-bold ig-tabular"
              style={{ color: severityColor(severity), borderColor: `color-mix(in oklab, ${severityColor(severity)} 30%, transparent)` }}>
              {values.probability}×{values.impact}={level}
            </span>
            <span style={{ color: severityColor(severity) }}>{SEVERITY_LABELS[severity]}</span>
          </span>
          <div className="flex items-center gap-2">
            <HudButton variant="ghost" size="sm" onClick={onClose} disabled={saving}>Cancelar</HudButton>
            <HudButton variant="primary" size="sm" onClick={handleSubmit} isLoading={saving}>
              {mode === "create" ? "Criar risco" : "Salvar alterações"}
            </HudButton>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <HudInput
          label="Título"
          value={values.title}
          onChange={(e) => set("title", e.target.value)}
          placeholder="Ex.: Exposição cambial em contrato internacional"
          error={error ?? undefined}
        />

        <div className="space-y-1.5">
          <label className="text-[11px] font-medium uppercase tracking-wider hud-label">Descrição</label>
          <textarea
            value={values.description}
            onChange={(e) => set("description", e.target.value)}
            rows={3}
            placeholder="Contexto, causa e potencial impacto do risco…"
            className="w-full rounded-lg border border-ig-border-subtle bg-ig-raised px-3 py-2 text-[12px] text-ig-fg-strong outline-none transition-colors placeholder:text-ig-fg-subtle focus:border-ig-accent"
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <HudSelect label="Domínio" value={values.category} options={CATEGORY_OPTIONS} onChange={(v) => set("category", v)} />
          <HudInput label="Área" value={values.area} onChange={(e) => set("area", e.target.value)} placeholder="Ex.: Tesouraria" />
        </div>

        {/* ── Vínculo (projeto / contrato) ── */}
        {isAiRisk ? (
          <div className="rounded-lg border border-ig-border-subtle bg-ig-raised px-3 py-2 text-[11px] text-ig-fg-muted">
            Vínculo gerado por IA{values.referenceName ? ` · ${values.referenceName}` : ""} — não editável.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <HudSelect label="Vínculo" value={values.origin === "ai" ? "manual" : values.origin} options={VINCULO_OPTIONS} onChange={handleVinculoChange} />
            {values.origin === "project" && (
              <HudSelect
                label="Projeto"
                value={values.referenceId ?? ""}
                options={projectOptions}
                onChange={pickRef(projectOptions)}
                placeholder={projectOptions.length ? "Selecione um projeto" : "Carregando…"}
              />
            )}
            {values.origin === "contract" && (
              <HudSelect
                label="Contrato"
                value={values.referenceId ?? ""}
                options={contractOptions}
                onChange={pickRef(contractOptions)}
                placeholder={contractOptions.length ? "Selecione um contrato" : "Carregando…"}
              />
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <HudSelect label="Probabilidade" value={String(values.probability)} options={SCALE} onChange={(v) => set("probability", Number(v))} />
          <HudSelect label="Impacto" value={String(values.impact)} options={SCALE} onChange={(v) => set("impact", Number(v))} />
          <HudSelect label="Status" value={values.status} options={STATUS_OPTIONS} onChange={(v) => set("status", v as ExtendedRisk["status"])} />
          <HudInput
            label="Exposição (R$)"
            type="number"
            min={0}
            value={values.financialExposure ?? ""}
            onChange={(e) => set("financialExposure", e.target.value === "" ? undefined : Number(e.target.value))}
            placeholder="0"
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <HudInput label="Responsável" value={values.responsibleName} onChange={(e) => set("responsibleName", e.target.value)} placeholder="Ex.: Tesouraria" />
          <HudInput label="Prazo" type="date" value={values.dueDate ?? ""} onChange={(e) => set("dueDate", e.target.value)} />
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] font-medium uppercase tracking-wider hud-label">Plano de mitigação</label>
          <textarea
            value={values.mitigationPlan}
            onChange={(e) => set("mitigationPlan", e.target.value)}
            rows={2}
            autoFocus={focusPlan}
            placeholder="Como o risco será tratado…"
            className="w-full rounded-lg border border-ig-border-subtle bg-ig-raised px-3 py-2 text-[12px] text-ig-fg-strong outline-none transition-colors placeholder:text-ig-fg-subtle focus:border-ig-accent"
          />
        </div>

        <HudInput label="Próxima ação" value={values.nextAction} onChange={(e) => set("nextAction", e.target.value)} placeholder="Ação imediata e prazo" />

        {/* ── Itens do plano de ação ── */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-medium uppercase tracking-wider hud-label">
              Itens do plano de ação{values.actions.length > 0 ? ` (${values.actions.filter((a) => a.status === "done").length}/${values.actions.length})` : ""}
            </label>
            <button
              type="button"
              onClick={addAction}
              className="flex items-center gap-1 rounded-md border border-ig-border-subtle bg-ig-raised px-2 py-1 text-[10px] font-semibold text-ig-fg-muted transition-colors hover:border-ig-accent hover:text-ig-accent"
            >
              <Plus className="h-3 w-3" /> Adicionar ação
            </button>
          </div>

          {values.actions.length === 0 ? (
            <p className="rounded-lg border border-dashed border-ig-border-subtle px-3 py-3 text-center text-[11px] text-ig-fg-subtle">
              Nenhuma ação cadastrada. Conclua todas as ações para mover o risco a “Em Validação”.
            </p>
          ) : (
            <div className="space-y-2">
              {values.actions.map((a) => (
                <div key={a.id} className="grid grid-cols-1 gap-2 rounded-lg border border-ig-border-subtle bg-ig-raised p-2 sm:grid-cols-[1fr_auto]">
                  <input
                    value={a.title}
                    onChange={(e) => updateAction(a.id, { title: e.target.value })}
                    placeholder="Descrição da ação"
                    className="w-full rounded-md border border-ig-border-subtle bg-ig-bg-canvas px-2 py-1.5 text-[12px] text-ig-fg-strong outline-none placeholder:text-ig-fg-subtle focus:border-ig-accent"
                  />
                  <div className="flex items-center gap-2">
                    <input
                      value={a.assignee}
                      onChange={(e) => updateAction(a.id, { assignee: e.target.value })}
                      placeholder="Responsável"
                      className="w-28 rounded-md border border-ig-border-subtle bg-ig-bg-canvas px-2 py-1.5 text-[11px] text-ig-fg-muted outline-none placeholder:text-ig-fg-subtle focus:border-ig-accent"
                    />
                    <input
                      type="date"
                      value={toDateInput(a.dueDate)}
                      onChange={(e) => updateAction(a.id, { dueDate: e.target.value ? new Date(`${e.target.value}T00:00:00`) : new Date() })}
                      className="rounded-md border border-ig-border-subtle bg-ig-bg-canvas px-2 py-1.5 text-[11px] text-ig-fg-muted outline-none focus:border-ig-accent"
                    />
                    <select
                      value={a.status}
                      onChange={(e) => updateAction(a.id, { status: e.target.value as RiskAction["status"] })}
                      className="rounded-md border border-ig-border-subtle bg-ig-bg-canvas px-2 py-1.5 text-[11px] text-ig-fg-muted outline-none focus:border-ig-accent"
                    >
                      {ACTION_STATUS_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => removeAction(a.id)}
                      aria-label="Remover ação"
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-ig-border-subtle text-ig-fg-subtle transition-colors hover:border-ig-danger hover:text-ig-danger"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Evidências ── */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-medium uppercase tracking-wider hud-label">
              Evidências{values.evidences.length > 0 ? ` (${values.evidences.length})` : ""}
            </label>
            <button
              type="button"
              onClick={addEvidence}
              className="flex items-center gap-1 rounded-md border border-ig-border-subtle bg-ig-raised px-2 py-1 text-[10px] font-semibold text-ig-fg-muted transition-colors hover:border-ig-accent hover:text-ig-accent"
            >
              <Plus className="h-3 w-3" /> Adicionar evidência
            </button>
          </div>

          {values.evidences.length === 0 ? (
            <p className="rounded-lg border border-dashed border-ig-border-subtle px-3 py-3 text-center text-[11px] text-ig-fg-subtle">
              Nenhuma evidência. Adicione links ou referências de documentos que comprovam o risco.
            </p>
          ) : (
            <div className="space-y-2">
              {values.evidences.map((ev) => (
                <div key={ev.id} className="grid grid-cols-1 gap-2 rounded-lg border border-ig-border-subtle bg-ig-raised p-2 sm:grid-cols-[1fr_auto]">
                  <input
                    value={ev.name}
                    onChange={(e) => updateEvidence(ev.id, { name: e.target.value })}
                    placeholder="Nome / descrição da evidência"
                    className="w-full rounded-md border border-ig-border-subtle bg-ig-bg-canvas px-2 py-1.5 text-[12px] text-ig-fg-strong outline-none placeholder:text-ig-fg-subtle focus:border-ig-accent"
                  />
                  <div className="flex items-center gap-2">
                    <input
                      value={ev.url ?? ""}
                      onChange={(e) => updateEvidence(ev.id, { url: e.target.value })}
                      placeholder="URL (opcional)"
                      className="w-40 rounded-md border border-ig-border-subtle bg-ig-bg-canvas px-2 py-1.5 text-[11px] text-ig-fg-muted outline-none placeholder:text-ig-fg-subtle focus:border-ig-accent"
                    />
                    <select
                      value={ev.type}
                      onChange={(e) => updateEvidence(ev.id, { type: e.target.value as RiskEvidence["type"] })}
                      className="rounded-md border border-ig-border-subtle bg-ig-bg-canvas px-2 py-1.5 text-[11px] text-ig-fg-muted outline-none focus:border-ig-accent"
                    >
                      {EVIDENCE_TYPE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => removeEvidence(ev.id)}
                      aria-label="Remover evidência"
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-ig-border-subtle text-ig-fg-subtle transition-colors hover:border-ig-danger hover:text-ig-danger"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </HudModal>
  );
}
