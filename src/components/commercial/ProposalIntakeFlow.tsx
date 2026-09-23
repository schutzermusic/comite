"use client";

/**
 * NOVA PROPOSTA — PDF primeiro.
 *
 *   PDF → a Apex entende → a pessoa revisa → a proposta nasce.
 *
 * O PDF espera na área de preparo da pessoa; a leitura é a mesma do registro
 * canônico (mesma tarefa, prompt e normalização) e NÃO grava nada. A revisão
 * mostra cada campo como CONFIRMADO, SUGERIDO, FALTANDO ou EM CONFLITO
 * (`proposal-intake.ts`). Só ao criar: a proposta nasce pela função
 * governada, e o registro do documento ADOTA o PDF preparado e a leitura já
 * feita — os fatos entram com página e trecho, para confirmação no dossiê.
 *
 * "Criar manualmente" continua existindo, como segunda opção.
 */
import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from "react";
import {
  AlertTriangle, ArrowRight, Check, CheckCheck, FileText, FileUp, Loader2, PenLine, ScanText, Sparkles, X,
} from "lucide-react";
import { HudButton, useHudToast } from "@/components/hud";
import { uploadWithSignedToken, sha256Hex } from "@/lib/commercial/upload-client";
import {
  buildIntakeFields, intakePayloads, intakeSummary, slotFromFileName,
  type IntakeDocument, type IntakeField, type IntakeOpportunity, type IntakeSlot, type IntakeState,
} from "@/lib/commercial/proposal-intake";
import type { CreateContext } from "./CreateCommercialModal";
import { GovernanceNote, StatePill } from "./workspace";

type Step = "start" | "files" | "reading" | "review" | "creating" | "manual";
interface Slot { file: File; slot: IntakeSlot }
interface Staged {
  slot: IntakeSlot;
  file: File;
  path: string | null;
  status: "uploading" | "reading" | "done" | "no-permission" | "failed";
  error?: string;
  doc?: IntakeDocument;
}
interface OpportunityOption extends IntakeOpportunity { stage?: string; party_id?: string | null }

const STATE_LABEL: Record<IntakeState, string> = {
  confirmed: "Confirmado", suggested: "Sugerido", missing: "Faltando", conflicting: "Em conflito",
};
const STATE_TONE: Record<IntakeState, "success" | "info" | "neutral" | "danger"> = {
  confirmed: "success", suggested: "info", missing: "neutral", conflicting: "danger",
};

export function ProposalIntakeFlow({
  context,
  onBusy,
  onCancel,
  onDone,
}: {
  context?: CreateContext;
  onBusy: (busy: boolean) => void;
  onCancel: () => void;
  onDone: (id: string | null) => void;
}) {
  const [step, setStep] = useState<Step>("start");
  const [slots, setSlots] = useState<Partial<Record<IntakeSlot, Slot>>>({});
  const [combined, setCombined] = useState(false);
  const [staged, setStaged] = useState<Staged[]>([]);
  const [opportunities, setOpportunities] = useState<OpportunityOption[] | null>(null);
  const [opportunityId, setOpportunityId] = useState<string>(context?.opportunityId ?? "");
  const stagedPaths = useRef<string[]>([]);
  const committed = useRef(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/commercial/opportunities")
      .then((r) => r.json())
      .then((p) => {
        if (alive) setOpportunities(p?.ok ? (p.opportunities as OpportunityOption[]) : []);
      })
      .catch(() => alive && setOpportunities([]));
    return () => {
      alive = false;
    };
  }, []);

  // Desistiu com PDF preparado: o preparo some (nunca fica lixo na área da pessoa).
  useEffect(() => () => {
    if (!committed.current && stagedPaths.current.length) {
      void fetch("/api/commercial/proposals/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "discard", paths: stagedPaths.current }),
        keepalive: true,
      }).catch(() => undefined);
    }
  }, []);

  const opportunity = opportunities?.find((o) => o.id === opportunityId) ?? null;

  const read = async () => {
    const files = (combined ? [slots.COMBINED] : [slots.PT, slots.PC]).filter((s): s is Slot => Boolean(s));
    if (!files.length) return;
    setStep("reading");
    onBusy(true);
    const initial: Staged[] = files.map((f) => ({ slot: f.slot, file: f.file, path: null, status: "uploading" }));
    setStaged(initial);
    const update = (slot: IntakeSlot, patch: Partial<Staged>) =>
      setStaged((prev) => prev.map((s) => (s.slot === slot ? { ...s, ...patch } : s)));

    await Promise.all(files.map(async ({ file, slot }) => {
      try {
        const { path } = await uploadWithSignedToken("/api/commercial/proposals/analyze", { action: "authorize" }, file);
        stagedPaths.current.push(path);
        update(slot, { path, status: "reading" });
        const response = await fetch("/api/commercial/proposals/analyze", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "analyze", path, fileName: file.name,
            kind: slot === "PT" ? "TECHNICAL" : slot === "PC" ? "COMMERCIAL" : "COMBINED" }),
        });
        const payload = await response.json().catch(() => ({}));
        const emptyDoc: IntakeDocument = { slot, fileName: file.name, classification: null, facts: [] };
        if (response.status === 403 && payload?.code === "INGEST_REQUIRED") {
          update(slot, { status: "no-permission", doc: emptyDoc, error: payload.error });
        } else if (!response.ok || !payload.ok) {
          update(slot, { status: "failed", doc: emptyDoc, error: payload?.error ?? "Leitura não concluída." });
        } else {
          update(slot, { status: "done", doc: { slot, fileName: file.name, classification: payload.classification, facts: payload.facts } });
        }
      } catch (e) {
        update(slot, { status: "failed", error: (e as Error).message,
          doc: { slot, fileName: file.name, classification: null, facts: [] } });
      }
    }));
    onBusy(false);
    setStep("review");
  };

  if (step === "start") {
    return (
      <div className="crm-flow" data-testid="flow-proposal-start">
        <p className="crm-flow-label">Como deseja começar?</p>
        <div className="crm-start">
          <button type="button" className="crm-start-option crm-start-primary" onClick={() => setStep("files")}
            data-testid="proposal-start-import">
            <span className="crm-start-icon"><FileUp size={18} aria-hidden /></span>
            <strong>Importar PT / PC</strong>
            <p>Solte a proposta técnica, a comercial ou as duas. A Apex lê número de revisão, valor, validade, pagamento, escopo e regras de medição — com a página de onde tirou cada coisa.</p>
            <span className="crm-start-flow">
              PDF <ArrowRight size={11} aria-hidden /> Apex entende <ArrowRight size={11} aria-hidden /> você revisa <ArrowRight size={11} aria-hidden /> proposta criada
            </span>
            <StatePill tone="accent">Recomendado</StatePill>
          </button>
          <button type="button" className="crm-start-option" onClick={() => setStep("manual")} data-testid="proposal-start-manual">
            <span className="crm-start-icon"><PenLine size={18} aria-hidden /></span>
            <strong>Criar manualmente</strong>
            <p>Quando ainda não há documento. A proposta nasce em rascunho e o PDF pode ser anexado depois, na revisão.</p>
          </button>
        </div>
        <div className="crm-flow-footer">
          <p />
          <div><HudButton variant="ghost" onClick={onCancel}>Cancelar</HudButton></div>
        </div>
      </div>
    );
  }

  if (step === "manual") {
    return <ManualProposal opportunities={opportunities} initialOpportunity={opportunityId} onBack={() => setStep("start")}
      onCancel={onCancel} onBusy={onBusy} onDone={onDone} />;
  }

  if (step === "files") {
    const ready = combined ? Boolean(slots.COMBINED) : Boolean(slots.PT || slots.PC);
    const put = (file: File, hint: IntakeSlot) => {
      if (!file || file.type !== "application/pdf") return;
      const guess = combined ? "COMBINED" : slotFromFileName(file.name) ?? hint;
      setSlots((prev) => ({ ...prev, [guess]: { file, slot: guess } }));
    };
    return (
      <div className="crm-flow" data-testid="flow-proposal-files">
        <ol className="crm-steps" aria-label="Etapas">
          <li aria-current="step"><b>1</b> PDF</li><li><b>2</b> Leitura</li><li><b>3</b> Revisão</li>
        </ol>
        <OpportunitySelect opportunities={opportunities} value={opportunityId} onChange={setOpportunityId} />
        <div className="crm-drop-grid" style={combined ? { gridTemplateColumns: "1fr" } : undefined}>
          {(combined ? (["COMBINED"] as IntakeSlot[]) : (["PT", "PC"] as IntakeSlot[])).map((slot) => (
            <DropSlot key={slot} slot={slot} value={slots[slot]?.file ?? null} onFile={(f) => put(f, slot)}
              onClear={() => setSlots((prev) => ({ ...prev, [slot]: undefined }))} />
          ))}
        </div>
        <label className="crm-toggle">
          <input type="checkbox" checked={combined} onChange={(e) => { setCombined(e.target.checked); setSlots({}); }} />
          <span>PT e PC no mesmo PDF<small>A proposta nasce como “Técnica + Comercial”.</small></span>
        </label>
        <div className="crm-flow-footer">
          <p>{ready ? "A leitura não grava nada: você revisa antes de a proposta existir." : "Envie ao menos um PDF."}</p>
          <div>
            <HudButton variant="ghost" onClick={() => setStep("start")}>Voltar</HudButton>
            <HudButton variant="primary" disabled={!ready} onClick={read} data-testid="proposal-read">
              <Sparkles size={14} aria-hidden /> Ler com a Apex
            </HudButton>
          </div>
        </div>
      </div>
    );
  }

  if (step === "reading") {
    return (
      <div className="crm-flow" data-testid="flow-proposal-reading">
        <ol className="crm-steps" aria-label="Etapas">
          <li className="done"><b>1</b> PDF</li><li aria-current="step"><b>2</b> Leitura</li><li><b>3</b> Revisão</li>
        </ol>
        <div className="crm-reading" role="status" aria-live="polite">
          <strong style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <ScanText size={16} aria-hidden /> A Apex está lendo {staged.length > 1 ? "os documentos" : "o documento"}…
          </strong>
          <ul style={{ display: "grid", gap: 6 }}>
            {staged.map((s) => (
              <li key={s.slot}>
                {s.status === "uploading" || s.status === "reading" ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Check size={13} aria-hidden />}
                <b>{s.slot}</b> {s.file.name} · {s.status === "uploading" ? "enviando" : s.status === "reading" ? "lendo página a página" : "pronto"}
              </li>
            ))}
          </ul>
          <p className="crm-field-hint">Cada fato volta com página e trecho literal — ou marcado como não encontrado. Pode levar até um minuto.</p>
        </div>
      </div>
    );
  }

  return (
    <IntakeReview
      staged={staged}
      opportunities={opportunities}
      opportunity={opportunity}
      opportunityId={opportunityId}
      setOpportunityId={setOpportunityId}
      onBack={() => setStep("files")}
      onCancel={onCancel}
      onBusy={onBusy}
      onCommitted={() => { committed.current = true; }}
      onDone={onDone}
    />
  );
}

function OpportunitySelect({
  opportunities, value, onChange,
}: { opportunities: OpportunityOption[] | null; value: string; onChange: (v: string) => void }) {
  return (
    <label className="crm-field-label">
      <span>Oportunidade <small style={{ fontWeight: 400 }}>· de onde vêm cliente e moeda</small></span>
      <select value={value} onChange={(e) => onChange(e.target.value)} data-testid="proposal-opportunity">
        <option value="">{opportunities ? "Sem oportunidade (vincular depois)" : "Carregando…"}</option>
        {(opportunities ?? []).map((o) => (
          <option key={o.id} value={o.id}>{o.title} — {o.counterparty_name}</option>
        ))}
      </select>
    </label>
  );
}

function DropSlot({
  slot, value, onFile, onClear,
}: { slot: IntakeSlot; value: File | null; onFile: (f: File) => void; onClear: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const title = slot === "PT" ? "Proposta técnica" : slot === "PC" ? "Proposta comercial" : "Proposta técnica + comercial";
  const hint = slot === "PT" ? "Escopo, entregáveis, exclusões, marcos" : slot === "PC" ? "Valor, pagamento, validade, medição" : "Todos os fatos do documento";
  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onFile(file);
  };
  return (
    <div
      className="crm-drop"
      data-over={over}
      data-filled={Boolean(value)}
      role="button"
      tabIndex={0}
      aria-label={value ? `${title}: ${value.name}` : `Enviar ${title} em PDF`}
      onClick={() => input.current?.click()}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.current?.click(); } }}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
      data-testid={`drop-${slot}`}
    >
      <input ref={input} type="file" accept="application/pdf" hidden aria-label={`PDF da ${title}`}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
      <span className="crm-drop-tag">{slot === "COMBINED" ? "PT + PC" : slot}</span>
      {value ? (
        <>
          <strong><FileText size={13} aria-hidden className="inline" /> {value.name}</strong>
          <small>{(value.size / 1024 / 1024).toFixed(1)} MB · pronto para leitura</small>
          <span className="crm-drop-remove">
            <HudButton variant="ghost" size="sm" aria-label={`Remover ${value.name}`}
              onClick={(e) => { e.stopPropagation(); onClear(); }}><X size={13} aria-hidden /></HudButton>
          </span>
        </>
      ) : (
        <>
          <strong>{title}</strong>
          <small>{hint}</small>
          <small style={{ marginTop: "auto", color: "var(--ig-accent)", fontWeight: 600 }}>
            <FileUp size={12} aria-hidden className="inline" /> Solte o PDF aqui ou toque para escolher
          </small>
        </>
      )}
    </div>
  );
}

function IntakeReview({
  staged, opportunities, opportunity, opportunityId, setOpportunityId, onBack, onCancel, onBusy, onCommitted, onDone,
}: {
  staged: Staged[];
  opportunities: OpportunityOption[] | null;
  opportunity: OpportunityOption | null;
  opportunityId: string;
  setOpportunityId: (v: string) => void;
  onBack: () => void;
  onCancel: () => void;
  onBusy: (b: boolean) => void;
  onCommitted: () => void;
  onDone: (id: string | null) => void;
}) {
  const { success, error: notifyError } = useHudToast();
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<IntakeState | "all">("all");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const docs = staged.map((s) => s.doc).filter((d): d is IntakeDocument => Boolean(d));

  const fields: IntakeField[] = useMemo(() => {
    const base = buildIntakeFields(docs, opportunity);
    return base.map((f) => (f.key in overrides && f.key !== "opportunity_id"
      ? { ...f, value: overrides[f.key], state: overrides[f.key].trim() ? "confirmed" : "missing",
          source: overrides[f.key].trim() ? "Você" : f.source }
      : f));
  }, [docs, opportunity, overrides]);
  const summary = intakeSummary(fields);
  const set = (key: string, value: string) => setOverrides((o) => ({ ...o, [key]: value }));
  const acceptAll = () =>
    setOverrides((o) => ({ ...o, ...Object.fromEntries(fields.filter((f) => f.state === "suggested").map((f) => [f.key, f.value])) }));

  const readIssues = staged.filter((s) => s.status !== "done");
  const visible = fields.filter((f) => f.key !== "opportunity_id" && (filter === "all" || f.state === filter));

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (creating || summary.blocking.length) return;
    setCreating(true);
    onBusy(true);
    setError(null);
    const created: { slot: IntakeSlot; id: string; facts?: number; warnings?: string[]; extraction?: string }[] = [];
    try {
      const payloads = intakePayloads(fields, docs, { party_id: opportunity?.party_id ?? null });
      for (const { slot, payload } of payloads) {
        const response = await fetch("/api/commercial/proposals", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(`${slot}: ${result.error ?? "proposta recusada."}`);
        onCommitted();
        const item = staged.find((s) => s.slot === slot)!;
        const register = await fetch(`/api/commercial/proposals/${result.proposal_id}/documents`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "register", revisionId: result.revision_id, stagedPath: item.path,
            title: item.file.name, contentSha256: await sha256Hex(item.file) }),
        }).then((r) => r.json()).catch(() => null);
        created.push({ slot, id: result.proposal_id, facts: register?.facts, warnings: register?.warnings, extraction: register?.extraction });
        if (!register?.ok) notifyError(`Proposta ${slot} criada, PDF não anexado`, register?.error ?? "Anexe o PDF no dossiê.");
      }
      const facts = created.reduce((n, c) => n + (c.facts ?? 0), 0);
      success(created.length > 1 ? "Propostas PT e PC criadas" : "Proposta criada",
        facts ? `${facts} fato(s) com página registrados para confirmação.` : "Em rascunho, com o PDF anexado.");
      const governing = created.find((c) => c.slot !== "PT") ?? created[0];
      onDone(governing?.id ?? null);
    } catch (e) {
      setCreating(false);
      onBusy(false);
      if (created.length) {
        notifyError("Criação parcial", `${(e as Error).message} A proposta já criada foi aberta.`);
        onDone(created[0].id);
      } else {
        setError((e as Error).message);
      }
    }
  };

  return (
    <form className="crm-flow" onSubmit={create} data-testid="flow-proposal-review">
      <ol className="crm-steps" aria-label="Etapas">
        <li className="done"><b>1</b> PDF</li><li className="done"><b>2</b> Leitura</li><li aria-current="step"><b>3</b> Revisão</li>
      </ol>

      {readIssues.map((s) => (
        <p key={s.slot} className="crm-flow-error" role="status"
          style={s.status === "no-permission" ? { color: "var(--ig-fg-muted)", borderColor: "var(--ig-border-default)", background: "transparent" } : undefined}>
          <AlertTriangle size={14} aria-hidden />
          {s.status === "no-permission"
            ? `${s.slot}: a leitura da Apex exige a permissão commercial.documents.ingest. O PDF será anexado sem leitura; complete os campos abaixo.`
            : `${s.slot}: ${s.error ?? "a leitura não foi concluída."} Você pode completar os campos e criar mesmo assim.`}
        </p>
      ))}

      <div className="crm-intake-summary" role="group" aria-label="Filtrar por estado">
        {(["confirmed", "suggested", "missing", "conflicting"] as IntakeState[]).map((state) => (
          <button key={state} type="button" className={`crm-intake-count crm-intake-${state}`}
            aria-pressed={filter === state} onClick={() => setFilter(filter === state ? "all" : state)}>
            <strong>{summary[state]}</strong>
            <span>{STATE_LABEL[state]}</span>
          </button>
        ))}
      </div>

      <OpportunitySelect opportunities={opportunities} value={opportunityId}
        onChange={(v) => { setOpportunityId(v); setOverrides((o) => { const n = { ...o }; delete n.counterparty_name; delete n.currency; return n; }); }} />
      {!opportunityId && (
        <p className="crm-field-hint">Sem oportunidade a proposta não inicia execução nem entra na comparação PT × PC — dá para vincular depois.</p>
      )}

      <div className="crm-intake-list" data-testid="intake-fields">
        {visible.map((f) => (
          <div key={f.key} className="crm-intake-row" data-state={f.state} data-required={f.required}>
            <div className="crm-intake-key">
              {f.label}{f.required ? " *" : ""}
              <small>{f.source ?? "—"}</small>
            </div>
            <div className="crm-intake-value">
              <FieldEditor field={f} onChange={(v) => set(f.key, v)} />
              {f.note && <span className="crm-intake-note">{f.note}</span>}
            </div>
            <StatePill tone={STATE_TONE[f.state]}>{STATE_LABEL[f.state]}</StatePill>
          </div>
        ))}
        {!visible.length && <p className="crm-section-empty">Nenhum campo neste estado.</p>}
      </div>

      {error && <p className="crm-flow-error" role="alert"><AlertTriangle size={14} aria-hidden /> {error}</p>}
      <GovernanceNote>
        A proposta nasce em rascunho, R01. Fatos da leitura entram como SUGERIDOS, com página: viram regra só depois da confirmação humana no dossiê.
      </GovernanceNote>
      <div className="crm-flow-footer">
        <p>
          {summary.blocking.length
            ? `Resolva antes de criar: ${summary.blocking.map((f) => f.label.toLowerCase()).join(", ")}.`
            : summary.suggested ? `${summary.suggested} sugestão(ões) serão usadas como estão.` : "Tudo revisado."}
        </p>
        <div>
          <HudButton type="button" variant="ghost" onClick={onBack} disabled={creating}>Trocar PDF</HudButton>
          {summary.suggested > 0 && (
            <HudButton type="button" variant="secondary" onClick={acceptAll} disabled={creating}>
              <CheckCheck size={14} aria-hidden /> Aceitar sugestões
            </HudButton>
          )}
          <HudButton type="submit" variant="primary" disabled={creating || summary.blocking.length > 0} data-testid="proposal-create">
            {creating ? "Criando…" : docs.length > 1 ? "Criar PT e PC" : "Criar proposta"}
          </HudButton>
          <HudButton type="button" variant="ghost" onClick={onCancel} disabled={creating} aria-label="Cancelar"><X size={14} aria-hidden /></HudButton>
        </div>
      </div>
    </form>
  );
}

function FieldEditor({ field, onChange }: { field: IntakeField; onChange: (v: string) => void }) {
  if (field.state === "conflicting" && field.options?.length) {
    return (
      <div className="crm-intake-options" role="radiogroup" aria-label={field.label}>
        {field.options.map((o) => (
          <label key={o.value + o.label}>
            <input type="radio" name={field.key} value={o.value} onChange={() => onChange(o.value)} />
            {o.label}
            <small>{o.source}</small>
          </label>
        ))}
      </div>
    );
  }
  if (field.key === "counterparty_name" && field.source === "Oportunidade") {
    return <strong style={{ fontSize: 13 }}>{field.value}</strong>;
  }
  if (field.key === "kind" || field.key === "revision") {
    const shown = field.value === "declared" ? "Como enviado"
      : field.value.endsWith("_PROPOSAL") ? `Como o documento diz (${field.value.replace("_PROPOSAL", "").toLowerCase()})` : field.value;
    return <strong style={{ fontSize: 13 }}>{shown || "—"}</strong>;
  }
  if (field.key === "scope_summary" || field.key === "payment_terms" || field.key === "measurement_rules") {
    return (
      <textarea aria-label={field.label} value={field.value} readOnly={field.key === "measurement_rules"}
        placeholder={field.key === "measurement_rules" ? "Nenhuma regra lida." : "Não informado"}
        onChange={(e) => onChange(e.target.value)} />
    );
  }
  if (field.key === "currency") {
    return (
      <select aria-label="Moeda" value={field.value} onChange={(e) => onChange(e.target.value)}>
        {["BRL", "USD", "EUR"].map((c) => <option key={c}>{c}</option>)}
      </select>
    );
  }
  return (
    <input aria-label={field.label} value={field.value}
      type={field.key === "validity_until" ? "date" : field.key === "total_value" ? "number" : "text"}
      step={field.key === "total_value" ? "0.01" : undefined}
      placeholder={field.required ? "Obrigatório" : "Não informado"}
      onChange={(e) => onChange(e.target.value)} />
  );
}

/* ------------------------------------------------------------------------ */
/* Criação manual — a segunda opção                                          */
/* ------------------------------------------------------------------------ */

function ManualProposal({
  opportunities, initialOpportunity, onBack, onCancel, onBusy, onDone,
}: {
  opportunities: OpportunityOption[] | null;
  initialOpportunity: string;
  onBack: () => void;
  onCancel: () => void;
  onBusy: (b: boolean) => void;
  onDone: (id: string | null) => void;
}) {
  const { success } = useHudToast();
  const [v, setV] = useState<Record<string, string>>({ kind: "COMBINED", currency: "BRL", opportunity_id: initialOpportunity });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const opp = opportunities?.find((o) => o.id === v.opportunity_id) ?? null;
  const counterparty = opp?.counterparty_name ?? v.counterparty_name ?? "";
  const set = (k: string) => (e: { target: { value: string } }) => setV((p) => ({ ...p, [k]: e.target.value }));
  const missing = [!v.proposal_number?.trim() && "número", !v.title?.trim() && "título", !counterparty.trim() && "cliente"]
    .filter(Boolean) as string[];

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || missing.length) return;
    setSaving(true);
    onBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/commercial/proposals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          proposal_number: v.proposal_number.trim(), kind: v.kind, title: v.title.trim(),
          opportunity_id: v.opportunity_id || null, party_id: opp?.party_id ?? null,
          counterparty_name: counterparty.trim(), currency: opp?.currency ?? v.currency,
          total_value: v.kind === "TECHNICAL" ? null : v.total_value || null,
          validity_until: v.validity_until || null,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error ?? "Não foi possível criar a proposta.");
      success("Proposta criada em rascunho", "Anexe o PDF na revisão R01 quando tiver o documento.");
      onDone(result.proposal_id);
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
      onBusy(false);
    }
  };

  return (
    <form className="crm-flow" onSubmit={submit} data-testid="flow-proposal-manual">
      <OpportunitySelect opportunities={opportunities} value={v.opportunity_id ?? ""}
        onChange={(id) => setV((p) => ({ ...p, opportunity_id: id }))} />
      <div className="crm-flow-grid">
        <label className="crm-field-label"><span>Número *</span>
          <input value={v.proposal_number ?? ""} onChange={set("proposal_number")} maxLength={80} placeholder="Ex.: PC-2026-118" /></label>
        <div className="crm-field">
          <span className="crm-field-label"><span>Tipo</span></span>
          <div className="crm-chips" role="group" aria-label="Tipo">
            {([["COMBINED", "Técnica + Comercial"], ["TECHNICAL", "Técnica"], ["COMMERCIAL", "Comercial"]] as const).map(([k, l]) => (
              <button key={k} type="button" className="crm-chip" aria-pressed={v.kind === k}
                onClick={() => setV((p) => ({ ...p, kind: k }))}>{l}</button>
            ))}
          </div>
        </div>
        <label className="crm-field-label crm-span-2 crm-field-big"><span>Título *</span>
          <input value={v.title ?? ""} onChange={set("title")} maxLength={300} /></label>
        {opp ? (
          <div className="crm-field crm-span-2"><span className="crm-flow-label">Cliente</span>
            <strong style={{ fontSize: 13 }}>{opp.counterparty_name} <small className="crm-muted">· da oportunidade</small></strong></div>
        ) : (
          <label className="crm-field-label crm-span-2"><span>Cliente *</span>
            <input value={v.counterparty_name ?? ""} onChange={set("counterparty_name")} maxLength={300} /></label>
        )}
        {v.kind !== "TECHNICAL" && (
          <label className="crm-field-label"><span>Valor</span>
            <span className="crm-money">
              <input type="number" min={0} step="0.01" value={v.total_value ?? ""} onChange={set("total_value")} />
              <select aria-label="Moeda" value={opp?.currency ?? v.currency} disabled={Boolean(opp)} onChange={set("currency")}>
                {["BRL", "USD", "EUR"].map((c) => <option key={c}>{c}</option>)}
              </select>
            </span></label>
        )}
        <label className="crm-field-label"><span>Validade</span>
          <input type="date" value={v.validity_until ?? ""} onChange={set("validity_until")} /></label>
      </div>
      {error && <p className="crm-flow-error" role="alert"><AlertTriangle size={14} aria-hidden /> {error}</p>}
      <GovernanceNote>A proposta nasce em rascunho. Revisão interna, envio e aceite continuam sendo etapas separadas.</GovernanceNote>
      <div className="crm-flow-footer">
        <p>{missing.length ? `Falta: ${missing.join(", ")}.` : "Ao criar, o dossiê abre direto."}</p>
        <div>
          <HudButton type="button" variant="ghost" onClick={onBack} disabled={saving}>Voltar</HudButton>
          <HudButton type="button" variant="ghost" onClick={onCancel} disabled={saving}>Cancelar</HudButton>
          <HudButton type="submit" variant="primary" disabled={saving || missing.length > 0}>{saving ? "Criando…" : "Criar e abrir"}</HudButton>
        </div>
      </div>
    </form>
  );
}
