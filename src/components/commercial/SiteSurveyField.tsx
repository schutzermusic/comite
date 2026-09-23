"use client";

/**
 * O LEVANTAMENTO EM CAMPO — feito para o celular na mão, luva e sol na tela.
 *
 * ─── O que torna isto rápido no campo ────────────────────────────────────
 *
 * • Uma coluna, alvos grandes, a próxima ação fixa embaixo (zona do polegar).
 * • Salva sozinho: cada seção alterada vai ao servidor depois de uma pausa,
 *   só com o que mudou. Sem botão "salvar", sem formulário gigante.
 * • Foto pela câmera traseira, vídeo e áudio pelo mesmo botão; o arquivo sobe
 *   direto ao Storage e entra no acervo canônico.
 * • Ditado por voz onde o navegador oferece — some onde não oferece.
 *
 * ─── O que não acontece aqui ─────────────────────────────────────────────
 *
 * A leitura da Apex aparece SEPARADA do registro de campo, com fonte e
 * confiança por item, e nada dela é copiado para o registro. Concluir fecha o
 * registro: o que a proposta leu é o que fica.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, ArrowLeft, Camera, Check, CheckCircle2, ChevronDown, CircleHelp, Cloud,
  CloudOff, FileText, ImageIcon, Loader2, Mic, MicOff, Plus, Sparkles, Trash2, Wrench,
} from "lucide-react";
import { HudBadge, HudButton, useHudToast } from "@/components/hud";
import {
  CANDIDATE_GROUPS, CANDIDATE_GROUP_LABEL, FINDING_SECTIONS, SURVEY_STATUS_LABEL, SURVEY_TRANSITIONS,
  SURVEY_TRANSITION_LABEL, digestSurvey, isSurveyRecordable, localId,
  type SiteSurveyStatus, type SurveyChecklistItem, type SurveyEquipment, type SurveyFindings,
  type SurveyListItem, type SurveyMeasurement, type SurveyQuestion, type SurveyRisk,
} from "@/lib/commercial/site-survey";
import { uploadWithSignedToken } from "@/lib/commercial/upload-client";
import { ResourceState, day, useCommercialResource } from "./shared";
import { formatMoment } from "./detail";
import { SurveyProgress } from "./DiscoveryPanel";
import "./commercial.css";
import "./commercial-flow.css";
import "./site-survey-field.css";

type Survey = {
  id: string; code: string; title: string; status: SiteSurveyStatus; purpose: string;
  counterparty_name: string; site_name: string | null; site_address: string | null;
  technical_responsible_user_id: string | null; planned_visit_date: string | null;
  started_at: string | null; completed_at: string | null; cancel_reason: string | null;
  findings: SurveyFindings; checklist: SurveyChecklistItem[]; open_questions: SurveyQuestion[];
  apex_candidate: Record<string, Array<{ text: string; confidence: number | null; source: string; supported: boolean }>> | null;
  apex_generated_at: string | null; apex_model: string | null;
};
type Payload = {
  survey: Survey;
  opportunity: { id: string; title: string; counterparty_name: string; stage: string } | null;
  attachments: Array<{ id: string; title: string; document_type: string; created_at: string; url: string | null }>;
  events: Array<{ id: string; event_type: string; from_status: string | null; to_status: string | null;
    actor_user_id: string | null; actor_source: string; note: string | null; occurred_at: string }>;
  owners: Record<string, string>;
  canManage: boolean;
};

type Patch = {
  findings?: Partial<SurveyFindings>;
  checklist?: SurveyChecklistItem[];
  open_questions?: SurveyQuestion[];
  site_name?: string | null;
  site_address?: string | null;
};

type SaveState = "idle" | "pending" | "saving" | "saved" | "error";

/* Ditado por voz — só onde o navegador oferece. */
type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> ; resultIndex: number }) => void) | null;
  onend: (() => void) | null; onerror: (() => void) | null;
  start: () => void; stop: () => void;
};
function recognitionCtor(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function SiteSurveyField({ surveyId }: { surveyId: string }) {
  const { data, state, message, refresh } = useCommercialResource<Payload>(`/api/commercial/site-surveys/${surveyId}`);
  const { success, error: notifyError } = useHudToast();
  const [draft, setDraft] = useState<Survey | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const pending = useRef<Patch>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [openSection, setOpenSection] = useState<string>("checklist");

  useEffect(() => {
    if (data?.survey) setDraft(data.survey);
  }, [data?.survey]);

  const flush = useCallback(async () => {
    const patch = pending.current;
    if (!Object.keys(patch).length) return;
    pending.current = {};
    setSaveState("saving");
    try {
      const response = await fetch(`/api/commercial/site-surveys/${surveyId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload?.error || "Não salvo.");
      setSaveState("saved");
    } catch (e) {
      // Devolve o que não foi gravado para a próxima tentativa — nada se perde.
      pending.current = { ...patch, ...pending.current,
        findings: { ...(patch.findings ?? {}), ...(pending.current.findings ?? {}) } };
      setSaveState("error");
      notifyError("Registro não salvo", (e as Error).message);
    }
  }, [surveyId, notifyError]);

  const queue = useCallback((patch: Patch) => {
    pending.current = {
      ...pending.current, ...patch,
      findings: patch.findings ? { ...(pending.current.findings ?? {}), ...patch.findings } : pending.current.findings,
    };
    if (!pending.current.findings) delete pending.current.findings;
    setSaveState("pending");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 900);
  }, [flush]);

  // Sair da tela não pode perder o último registro.
  useEffect(() => {
    const handler = () => { if (Object.keys(pending.current).length) void flush(); };
    window.addEventListener("pagehide", handler);
    return () => { window.removeEventListener("pagehide", handler); handler(); };
  }, [flush]);

  const setFindings = (partial: Partial<SurveyFindings>) => {
    if (!draft) return;
    setDraft({ ...draft, findings: { ...draft.findings, ...partial } });
    queue({ findings: partial });
  };

  const digest = useMemo(() => (draft ? digestSurvey(draft) : null), [draft]);

  if (state !== "ready" || !data || !draft || !digest) {
    return <div className="field-shell"><ResourceState state={state === "ready" ? "loading" : state} message={message} /></div>;
  }

  const editable = data.canManage && isSurveyRecordable(draft.status);
  const next = SURVEY_TRANSITIONS[draft.status].filter((s) => s !== "CANCELLED" && s !== "PLANNED");
  const primary: SiteSurveyStatus | undefined =
    draft.status === "IN_FIELD" ? "AWAITING_REPORT" : next[0];

  const transition = async (to: SiteSurveyStatus, note?: string) => {
    if (busy) return;
    if (to === "COMPLETED" && digest.requiredPending.length) {
      const ok = window.confirm(`${digest.requiredPending.length} item(ns) obrigatório(s) do checklist pendente(s). Concluir mesmo assim? A prontidão da proposta vai apontar a lacuna.`);
      if (!ok) return;
    }
    await flush();
    setBusy(to);
    try {
      const response = await fetch(`/api/commercial/site-surveys/${surveyId}/transition`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to, note: note ?? null }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload?.error || "Transição recusada.");
      success(SURVEY_STATUS_LABEL[to]);
      refresh();
    } catch (e) {
      notifyError("Não foi possível avançar", (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const toggle = (key: string) => setOpenSection((current) => (current === key ? "" : key));

  return (
    <div className="field-shell">
      <header className="field-top">
        <Link href={data.opportunity ? `/comercial?view=oportunidades&opportunity=${data.opportunity.id}` : "/comercial"}
          className="field-back" aria-label="Voltar à oportunidade">
          <ArrowLeft size={18} aria-hidden />
        </Link>
        <div className="min-w-0">
          <p className="crm-eyebrow">{draft.code} · {data.opportunity?.counterparty_name ?? draft.counterparty_name}</p>
          <h1>{draft.title}</h1>
          <div className="field-top-meta">
            <HudBadge variant={draft.status === "COMPLETED" ? "success" : draft.status === "CANCELLED" ? "subtle" : "info"} size="sm">
              {SURVEY_STATUS_LABEL[draft.status]}
            </HudBadge>
            <SurveyProgress status={draft.status} />
            <SaveIndicator state={saveState} onRetry={flush} />
          </div>
        </div>
      </header>

      <section className="field-context">
        <p><strong>Propósito:</strong> {draft.purpose}</p>
        <p className="crm-muted">
          {draft.planned_visit_date ? `Visita prevista ${day(draft.planned_visit_date)} · ` : ""}
          Responsável: {draft.technical_responsible_user_id ? data.owners[draft.technical_responsible_user_id] ?? "—" : "não definido"}
        </p>
        {editable ? (
          <div className="field-grid-2">
            <input className="field-input" aria-label="Local" placeholder="Local (ex.: SE Norte)" defaultValue={draft.site_name ?? ""}
              onBlur={(e) => { if (e.target.value !== (draft.site_name ?? "")) { setDraft({ ...draft, site_name: e.target.value }); queue({ site_name: e.target.value }); } }} />
            <input className="field-input" aria-label="Endereço" placeholder="Endereço" defaultValue={draft.site_address ?? ""}
              onBlur={(e) => { if (e.target.value !== (draft.site_address ?? "")) { setDraft({ ...draft, site_address: e.target.value }); queue({ site_address: e.target.value }); } }} />
          </div>
        ) : (
          <p className="crm-muted">{[draft.site_name, draft.site_address].filter(Boolean).join(" · ") || "Local não registrado"}</p>
        )}
        {draft.status === "CANCELLED" && <p className="field-alert">Cancelado: {draft.cancel_reason}</p>}
      </section>

      <div className="field-stats" aria-label="Resumo do levantamento">
        <span><Check size={13} aria-hidden /> {digest.checklistDone}/{digest.checklistTotal}</span>
        <span><ImageIcon size={13} aria-hidden /> {data.attachments.length}</span>
        <span><Wrench size={13} aria-hidden /> {digest.equipmentCount}</span>
        <span><AlertTriangle size={13} aria-hidden /> {digest.riskCount}</span>
        <span className={digest.openQuestions.length ? "field-warn" : undefined}><CircleHelp size={13} aria-hidden /> {digest.openQuestions.length}</span>
      </div>

      {/* ── Checklist ─────────────────────────────────────────────────── */}
      <FieldSection id="checklist" title="Checklist" count={`${digest.checklistDone}/${digest.checklistTotal}`} open={openSection === "checklist"} onToggle={toggle}>
        <ul className="field-checklist">
          {draft.checklist.map((item, index) => (
            <li key={item.key}>
              <button type="button" disabled={!editable} aria-pressed={item.done}
                onClick={() => {
                  const checklist = draft.checklist.map((c, i) => (i === index ? { ...c, done: !c.done } : c));
                  setDraft({ ...draft, checklist });
                  queue({ checklist });
                }}>
                <span className="field-check-box">{item.done && <Check size={14} aria-hidden />}</span>
                <span>{item.label}{item.required ? <em> obrigatório</em> : null}</span>
              </button>
            </li>
          ))}
        </ul>
        {editable && (
          <QuickAdd placeholder="Novo item do checklist" onAdd={(text) => {
            const checklist = [...draft.checklist, { key: localId("c"), label: text, done: false }];
            setDraft({ ...draft, checklist });
            queue({ checklist });
          }} />
        )}
      </FieldSection>

      {/* ── Fotos, vídeos, áudios e documentos ───────────────────────── */}
      <FieldSection id="media" title="Fotos e arquivos" count={String(data.attachments.length)} open={openSection === "media"} onToggle={toggle}>
        {data.canManage && draft.status !== "CANCELLED" && (
          <MediaCapture surveyId={surveyId} onUploaded={refresh} />
        )}
        {data.attachments.length === 0 ? (
          <p className="crm-muted">Nenhum arquivo. Fotografe placa, painel, acesso e qualquer anomalia.</p>
        ) : (
          <ul className="field-media">
            {data.attachments.map((file) => (
              <li key={file.id}>
                {file.document_type === "site_survey_photo" && file.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <a href={file.url} target="_blank" rel="noreferrer"><img src={file.url} alt={file.title} loading="lazy" /></a>
                ) : (
                  <a href={file.url ?? "#"} target="_blank" rel="noreferrer" className="field-media-file">
                    <FileText size={18} aria-hidden /><span>{file.title}</span>
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </FieldSection>

      {/* ── Equipamentos e dados de placa ───────────────────────────── */}
      <FieldSection id="equipment" title="Equipamentos e dados de placa" count={String(digest.equipmentCount)} open={openSection === "equipment"} onToggle={toggle}>
        <EquipmentEditor value={draft.findings.equipment ?? []} editable={editable}
          onChange={(equipment) => setFindings({ equipment })} />
      </FieldSection>

      {/* ── Medições ────────────────────────────────────────────────── */}
      <FieldSection id="measurements" title="Medições" count={String(draft.findings.measurements?.length ?? 0)} open={openSection === "measurements"} onToggle={toggle}>
        <MeasurementEditor value={draft.findings.measurements ?? []} editable={editable}
          onChange={(measurements) => setFindings({ measurements })} />
      </FieldSection>

      {/* ── Riscos ──────────────────────────────────────────────────── */}
      <FieldSection id="risks" title="Riscos" count={String(digest.riskCount)} open={openSection === "risks"} onToggle={toggle}>
        <RiskEditor value={draft.findings.risks ?? []} editable={editable} onChange={(risks) => setFindings({ risks })} />
      </FieldSection>

      {/* ── Seções de texto e de lista ──────────────────────────────── */}
      {FINDING_SECTIONS.map((section) => (
        <FieldSection key={section.key} id={section.key} title={section.label}
          count={section.kind === "list" ? String(((draft.findings[section.key] as SurveyListItem[] | undefined) ?? []).length) : (draft.findings[section.key] ? "✓" : "")}
          open={openSection === section.key} onToggle={toggle}>
          <p className="crm-muted">{section.hint}</p>
          {section.kind === "text" ? (
            <DictationArea label={section.label} value={(draft.findings[section.key] as string | undefined) ?? ""} editable={editable}
              onCommit={(text) => setFindings({ [section.key]: text } as Partial<SurveyFindings>)} />
          ) : (
            <ListEditor value={(draft.findings[section.key] as SurveyListItem[] | undefined) ?? []} editable={editable}
              placeholder={`Adicionar em ${section.label.toLowerCase()}`}
              onChange={(items) => setFindings({ [section.key]: items } as Partial<SurveyFindings>)} />
          )}
        </FieldSection>
      ))}

      {/* ── Questões em aberto ──────────────────────────────────────── */}
      <FieldSection id="questions" title="Questões em aberto" count={String(digest.openQuestions.length)} open={openSection === "questions"} onToggle={toggle}>
        <ul className="field-questions">
          {draft.open_questions.map((q, index) => (
            <li key={q.id} className={q.resolved ? "resolved" : undefined}>
              <button type="button" disabled={!editable} aria-pressed={q.resolved}
                aria-label={q.resolved ? `Reabrir: ${q.text}` : `Marcar como resolvida: ${q.text}`}
                onClick={() => {
                  const open_questions = draft.open_questions.map((x, i) => (i === index ? { ...x, resolved: !x.resolved } : x));
                  setDraft({ ...draft, open_questions });
                  queue({ open_questions });
                }}>
                {q.resolved ? <CheckCircle2 size={16} aria-hidden /> : <CircleHelp size={16} aria-hidden />}
              </button>
              <span>{q.text}</span>
            </li>
          ))}
        </ul>
        {editable && (
          <QuickAdd placeholder="O que ainda não se sabe?" onAdd={(text) => {
            const open_questions = [...draft.open_questions, { id: localId("q"), text, resolved: false }];
            setDraft({ ...draft, open_questions });
            queue({ open_questions });
          }} />
        )}
      </FieldSection>

      {/* ── Leitura da Apex ─────────────────────────────────────────── */}
      {(draft.status === "AWAITING_REPORT" || draft.status === "COMPLETED") && (
        <ApexCandidate survey={draft} canRequest={data.canManage} surveyId={surveyId} onDone={refresh} />
      )}

      {/* ── História ────────────────────────────────────────────────── */}
      <FieldSection id="history" title="História" count={String(data.events.length)} open={openSection === "history"} onToggle={toggle}>
        <ol className="crm-timeline">
          {data.events.map((event) => (
            <li key={event.id}>
              <div className="crm-timeline-mark" aria-hidden />
              <div className="min-w-0">
                <strong>{eventTitle(event)}</strong>
                {event.note && <p className="crm-muted">{event.note}</p>}
                <p className="crm-timeline-meta">
                  {formatMoment(event.occurred_at)} · {event.actor_source === "apex" ? "Apex" : event.actor_user_id ? data.owners[event.actor_user_id] ?? "Usuário da organização" : "—"}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </FieldSection>

      {/* ── Ação principal fixa ─────────────────────────────────────── */}
      {data.canManage && primary && (
        <div className="field-actionbar">
          {draft.status !== "COMPLETED" && draft.status !== "CANCELLED" && (
            <HudButton variant="ghost" size="sm" disabled={!!busy} onClick={() => {
              const reason = window.prompt("Motivo do cancelamento do levantamento:");
              if (reason?.trim()) void transition("CANCELLED", reason.trim());
            }}>Cancelar</HudButton>
          )}
          {draft.status === "IN_FIELD" && (
            <HudButton variant="secondary" disabled={!!busy} onClick={() => transition("COMPLETED")}>Concluir já</HudButton>
          )}
          <HudButton variant="primary" disabled={!!busy} onClick={() => transition(primary)} data-testid="survey-primary-action">
            {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : null}
            {SURVEY_TRANSITION_LABEL[primary]}
          </HudButton>
        </div>
      )}
    </div>
  );
}

function eventTitle(event: Payload["events"][number]): string {
  switch (event.event_type) {
    case "created": return `Levantamento criado (${SURVEY_STATUS_LABEL[(event.to_status ?? "PLANNED") as SiteSurveyStatus]})`;
    case "transition": return `${SURVEY_STATUS_LABEL[event.from_status as SiteSurveyStatus] ?? event.from_status} → ${SURVEY_STATUS_LABEL[event.to_status as SiteSurveyStatus] ?? event.to_status}`;
    case "findings_recorded": return "Registro de campo atualizado";
    case "attachment_added": return "Arquivo de campo anexado";
    case "apex_candidate_recorded": return "Leitura da Apex registrada";
    default: return event.event_type;
  }
}

function SaveIndicator({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  if (state === "idle") return null;
  if (state === "error") {
    return <button type="button" className="field-save field-save-error" onClick={onRetry}><CloudOff size={13} aria-hidden /> Não salvo · tentar</button>;
  }
  return (
    <span className="field-save" aria-live="polite">
      {state === "saved" ? <Cloud size={13} aria-hidden /> : <Loader2 size={13} className="animate-spin" aria-hidden />}
      {state === "saved" ? "Salvo" : "Salvando…"}
    </span>
  );
}

function FieldSection({ id, title, count, open, onToggle, children }: {
  id: string; title: string; count?: string; open: boolean; onToggle: (id: string) => void; children: React.ReactNode;
}) {
  return (
    <section className={`field-section${open ? " open" : ""}`}>
      <button type="button" className="field-section-head" aria-expanded={open} onClick={() => onToggle(id)}>
        <span>{title}</span>
        {count ? <i>{count}</i> : null}
        <ChevronDown size={16} aria-hidden />
      </button>
      {open && <div className="field-section-body">{children}</div>}
    </section>
  );
}

function QuickAdd({ placeholder, onAdd }: { placeholder: string; onAdd: (text: string) => void }) {
  const [text, setText] = useState("");
  const submit = () => { if (text.trim()) { onAdd(text.trim()); setText(""); } };
  return (
    <div className="field-quickadd">
      <input className="field-input" aria-label={placeholder} placeholder={placeholder} value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }} />
      <button type="button" className="field-add" onClick={submit} aria-label="Adicionar"><Plus size={18} aria-hidden /></button>
    </div>
  );
}

function ListEditor({ value, editable, placeholder, onChange }: {
  value: SurveyListItem[]; editable: boolean; placeholder: string; onChange: (items: SurveyListItem[]) => void;
}) {
  return (
    <>
      <ul className="field-list">
        {value.map((item) => (
          <li key={item.id}>
            <span>{item.text}</span>
            {editable && (
              <button type="button" aria-label={`Remover ${item.text}`} onClick={() => onChange(value.filter((x) => x.id !== item.id))}>
                <Trash2 size={14} aria-hidden />
              </button>
            )}
          </li>
        ))}
      </ul>
      {editable && <QuickAdd placeholder={placeholder} onAdd={(text) => onChange([...value, { id: localId(), text }])} />}
    </>
  );
}

function EquipmentEditor({ value, editable, onChange }: {
  value: SurveyEquipment[]; editable: boolean; onChange: (items: SurveyEquipment[]) => void;
}) {
  const [tag, setTag] = useState("");
  const [description, setDescription] = useState("");
  const [nameplate, setNameplate] = useState("");
  const add = () => {
    if (!tag.trim() && !description.trim()) return;
    onChange([...value, { id: localId("e"), tag: tag.trim(), description: description.trim(), nameplate: nameplate.trim() || null }]);
    setTag(""); setDescription(""); setNameplate("");
  };
  return (
    <>
      <ul className="field-list">
        {value.map((item) => (
          <li key={item.id}>
            <div className="min-w-0">
              <strong>{item.tag || "Sem TAG"}</strong> · {item.description}
              {item.nameplate && <p className="crm-muted">Placa: {item.nameplate}</p>}
            </div>
            {editable && (
              <button type="button" aria-label={`Remover ${item.tag}`} onClick={() => onChange(value.filter((x) => x.id !== item.id))}>
                <Trash2 size={14} aria-hidden />
              </button>
            )}
          </li>
        ))}
      </ul>
      {editable && (
        <div className="field-form">
          <div className="field-grid-2">
            <input className="field-input" aria-label="TAG do equipamento" placeholder="TAG (ex.: DJ-01)" value={tag} onChange={(e) => setTag(e.target.value)} />
            <input className="field-input" aria-label="Descrição do equipamento" placeholder="Descrição" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <textarea className="field-input" aria-label="Dados de placa" rows={2} placeholder="Dados de placa: fabricante, modelo, série, tensão, corrente…" value={nameplate} onChange={(e) => setNameplate(e.target.value)} />
          <HudButton variant="secondary" size="sm" onClick={add}><Plus size={14} aria-hidden /> Adicionar equipamento</HudButton>
        </div>
      )}
    </>
  );
}

function MeasurementEditor({ value, editable, onChange }: {
  value: SurveyMeasurement[]; editable: boolean; onChange: (items: SurveyMeasurement[]) => void;
}) {
  const [label, setLabel] = useState("");
  const [reading, setReading] = useState("");
  const [unit, setUnit] = useState("");
  const add = () => {
    if (!label.trim() || !reading.trim()) return;
    onChange([...value, { id: localId("m"), label: label.trim(), value: reading.trim(), unit: unit.trim() || null }]);
    setLabel(""); setReading(""); setUnit("");
  };
  return (
    <>
      <ul className="field-list">
        {value.map((item) => (
          <li key={item.id}>
            <span>{item.label}: <strong>{item.value}{item.unit ? ` ${item.unit}` : ""}</strong></span>
            {editable && <button type="button" aria-label={`Remover ${item.label}`} onClick={() => onChange(value.filter((x) => x.id !== item.id))}><Trash2 size={14} aria-hidden /></button>}
          </li>
        ))}
      </ul>
      {editable && (
        <div className="field-measure">
          <input className="field-input" aria-label="Grandeza medida" placeholder="Grandeza" value={label} onChange={(e) => setLabel(e.target.value)} />
          <input className="field-input" aria-label="Valor medido" inputMode="decimal" placeholder="Valor" value={reading} onChange={(e) => setReading(e.target.value)} />
          <input className="field-input" aria-label="Unidade" placeholder="Un." value={unit} onChange={(e) => setUnit(e.target.value)} />
          <button type="button" className="field-add" onClick={add} aria-label="Adicionar medição"><Plus size={18} aria-hidden /></button>
        </div>
      )}
    </>
  );
}

function RiskEditor({ value, editable, onChange }: {
  value: SurveyRisk[]; editable: boolean; onChange: (items: SurveyRisk[]) => void;
}) {
  const [severity, setSeverity] = useState<"low" | "medium" | "high">("medium");
  const label = { low: "Baixo", medium: "Médio", high: "Alto" } as const;
  return (
    <>
      <ul className="field-list">
        {value.map((risk) => (
          <li key={risk.id}>
            <span><em className={`field-sev field-sev-${risk.severity ?? "medium"}`}>{label[risk.severity ?? "medium"]}</em> {risk.text}</span>
            {editable && <button type="button" aria-label={`Remover risco ${risk.text}`} onClick={() => onChange(value.filter((x) => x.id !== risk.id))}><Trash2 size={14} aria-hidden /></button>}
          </li>
        ))}
      </ul>
      {editable && (
        <>
          <div className="field-sev-picker" role="radiogroup" aria-label="Severidade do risco">
            {(["low", "medium", "high"] as const).map((s) => (
              <button key={s} type="button" role="radio" aria-checked={severity === s} className={`field-sev field-sev-${s}`} onClick={() => setSeverity(s)}>{label[s]}</button>
            ))}
          </div>
          <QuickAdd placeholder="Descreva o risco" onAdd={(text) => onChange([...value, { id: localId("r"), text, severity }])} />
        </>
      )}
    </>
  );
}

function DictationArea({ label, value, editable, onCommit }: {
  label: string; value: string; editable: boolean; onCommit: (text: string) => void;
}) {
  const [text, setText] = useState(value);
  const [listening, setListening] = useState(false);
  const recognition = useRef<Recognition | null>(null);
  const Ctor = useMemo(() => recognitionCtor(), []);
  // O valor do servidor mudou (recarga): o rascunho local acompanha, sem efeito.
  const [seen, setSeen] = useState(value);
  if (seen !== value) { setSeen(value); setText(value); }

  const toggleDictation = () => {
    if (!Ctor) return;
    if (listening) { recognition.current?.stop(); return; }
    const rec = new Ctor();
    rec.lang = "pt-BR";
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (event) => {
      let appended = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        if (event.results[i].isFinal) appended += event.results[i][0].transcript;
      }
      if (appended.trim()) {
        setText((current) => {
          const next = `${current}${current && !current.endsWith(" ") ? " " : ""}${appended.trim()}`;
          onCommit(next);
          return next;
        });
      }
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recognition.current = rec;
    setListening(true);
    rec.start();
  };

  if (!editable) return <p className="field-readonly">{value || "—"}</p>;
  return (
    <div className="field-dictation">
      <textarea className="field-input" aria-label={label} rows={4} value={text}
        onChange={(e) => setText(e.target.value)} onBlur={() => { if (text !== value) onCommit(text); }} />
      {Ctor && (
        <button type="button" className={`field-mic${listening ? " on" : ""}`} onClick={toggleDictation}
          aria-pressed={listening} aria-label={listening ? "Parar ditado" : `Ditar ${label}`}>
          {listening ? <MicOff size={16} aria-hidden /> : <Mic size={16} aria-hidden />}
          {listening ? "Ouvindo…" : "Ditar"}
        </button>
      )}
    </div>
  );
}

function MediaCapture({ surveyId, onUploaded }: { surveyId: string; onUploaded: () => void }) {
  const [uploading, setUploading] = useState(0);
  const { error: notifyError, success } = useHudToast();
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    const list = Array.from(files);
    setUploading(list.length);
    let done = 0;
    for (const file of list) {
      try {
        const { path, sha256 } = await uploadWithSignedToken(`/api/commercial/site-surveys/${surveyId}/attachments`,
          { action: "authorize" }, file);
        const response = await fetch(`/api/commercial/site-surveys/${surveyId}/attachments`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "register", path, title: file.name, mimeType: file.type, contentSha256: sha256 }),
        });
        const payload = await response.json();
        if (!response.ok || !payload.ok) throw new Error(payload?.error || "Arquivo não registrado.");
        done += 1;
      } catch (e) {
        notifyError(`Falha em ${file.name}`, (e as Error).message);
      } finally {
        setUploading((n) => n - 1);
      }
    }
    if (done) { success(`${done} arquivo(s) anexado(s)`); onUploaded(); }
  };
  return (
    <div className="field-capture">
      <label className="field-capture-btn">
        <Camera size={18} aria-hidden /> Foto
        <input type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => upload(e.target.files)} />
      </label>
      <label className="field-capture-btn">
        <Plus size={18} aria-hidden /> Vídeo, áudio ou PDF
        <input type="file" accept="video/*,audio/*,application/pdf" multiple hidden onChange={(e) => upload(e.target.files)} />
      </label>
      {uploading > 0 && <span className="field-save"><Loader2 size={13} className="animate-spin" aria-hidden /> Enviando {uploading}…</span>}
    </div>
  );
}

function ApexCandidate({ survey, canRequest, surveyId, onDone }: {
  survey: Survey; canRequest: boolean; surveyId: string; onDone: () => void;
}) {
  const [running, setRunning] = useState(false);
  const { error: notifyError, success } = useHudToast();
  const run = async () => {
    setRunning(true);
    try {
      const response = await fetch(`/api/commercial/site-surveys/${surveyId}/apex`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload?.error || "Leitura não concluída.");
      success("Leitura da Apex registrada", "Revise antes de levar para a proposta.");
      onDone();
    } catch (e) {
      notifyError("Leitura da Apex", (e as Error).message);
    } finally {
      setRunning(false);
    }
  };
  const candidate = survey.apex_candidate;
  return (
    <section className="field-apex" data-testid="apex-candidate">
      <header>
        <div>
          <p className="crm-eyebrow"><Sparkles size={12} aria-hidden /> Leitura assistida · candidato</p>
          <p className="crm-muted">
            Sugestões com fonte e confiança. Não alteram o registro de campo e só viram escopo quando alguém as leva para a proposta.
          </p>
        </div>
        {canRequest && (
          <HudButton variant="secondary" size="sm" disabled={running} onClick={run}>
            {running ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Sparkles size={14} aria-hidden />}
            {candidate ? "Ler de novo" : "Pedir leitura da Apex"}
          </HudButton>
        )}
      </header>
      {candidate ? (
        <div className="field-apex-groups">
          {CANDIDATE_GROUPS.filter((group) => candidate[group]?.length).map((group) => (
            <div key={group}>
              <h5>{CANDIDATE_GROUP_LABEL[group]}</h5>
              <ul>
                {candidate[group].map((item, index) => (
                  <li key={index} className={item.supported ? undefined : "unsupported"}>
                    <span>{item.text}</span>
                    <small>
                      {item.supported ? `fonte: ${item.source}` : "sem fonte no levantamento"}
                      {item.confidence !== null ? ` · ${Math.round(item.confidence * 100)}%` : ""}
                    </small>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p className="crm-muted">Gerado {survey.apex_generated_at ? formatMoment(survey.apex_generated_at) : ""}{survey.apex_model ? ` · ${survey.apex_model}` : ""}</p>
        </div>
      ) : (
        <p className="crm-muted">Nenhuma leitura ainda.</p>
      )}
    </section>
  );
}
