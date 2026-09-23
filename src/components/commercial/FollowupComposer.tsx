"use client";

/**
 * AGENDAR FOLLOW-UP — uma ação rápida, no motor canônico, não num segundo.
 *
 * Cada campo corresponde a uma coluna de `apex_followups` (migration 156):
 * objeto, objetivo, responsável, prazo, evidência esperada e cadência. "Com a
 * contraparte" não é um campo a mais: é a transição governada para
 * WAITING_EXTERNAL_PARTY, feita logo depois da criação, com o que se espera do
 * cliente e quando — a mesma exigência de data da fila.
 *
 * Sem objeto não há compromisso: quando o formulário abre da fila, o vínculo
 * (oportunidade ou proposta) é o primeiro campo. Aberto de um dossiê, ele já
 * vem preenchido.
 *
 * A idempotência é gerada aqui e enviada no cabeçalho: o retry de rede não pode
 * virar dois compromissos com o mesmo cliente.
 */
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { AlertTriangle, CalendarPlus, ChevronDown, Handshake, FileText, Search, X } from "lucide-react";
import { HudButton, HudModal, useHudToast } from "@/components/hud";
import { opportunityStageLabels } from "@/lib/commercial/labels";
import { isOpenStage } from "@/lib/commercial/stage-policy";
import type { OpportunityStage } from "@/lib/commercial/types";
import { GovernanceNote, matches } from "./workspace";
import { EXTERNAL, PersonSelect, usePeople } from "./people";

export type FollowupSubjectKind =
  | "commercial_opportunity"
  | "commercial_proposal"
  | "commercial_engagement"
  | "internal_service_order";

export interface FollowupSubject {
  kind: FollowupSubjectKind;
  id: string;
  label: string;
}

/** Onde o acompanhamento criado aparece — a fila abre direto nela. */
export type FollowupQueue = "mine" | "today" | "overdue" | "waiting" | "upcoming" | "all";
export interface CreatedFollowup {
  id: string | null;
  queue: FollowupQueue;
}

const SUBJECT_LABEL: Record<FollowupSubjectKind, string> = {
  commercial_opportunity: "Oportunidade",
  commercial_proposal: "Proposta",
  commercial_engagement: "Trabalho autorizado",
  internal_service_order: "Ordem de Serviço",
};

function idempotencyKey(): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `commercial-followup:${random}`;
}

const isoDay = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toLocaleDateString("en-CA");
};

/** A mesma regra dos predicados da fila (CommercialFollowups). */
export function queueFor(input: { due: string | null; waiting: boolean; mine: boolean }): FollowupQueue {
  const today = isoDay(0);
  if (input.waiting) return "waiting";
  if (input.due && input.due < today) return "overdue";
  if (input.due === today) return "today";
  if (input.due && input.due > today) return "upcoming";
  return input.mine ? "mine" : "all";
}

export function FollowupComposer({
  subject: initialSubject,
  onClose,
  onCreated,
}: {
  subject?: FollowupSubject | null;
  onClose: () => void;
  onCreated: (created: CreatedFollowup) => void;
}) {
  const formId = useId();
  const [subject, setSubject] = useState<FollowupSubject | null>(initialSubject ?? null);
  const [goal, setGoal] = useState("");
  // Responsável é uma IDENTIDADE da plataforma. Texto livre só para quem
  // não usa a plataforma — e a opção diz isso com todas as letras.
  const [responsibleUserId, setResponsibleUserId] = useState<string | null>(null);
  const [responsible, setResponsible] = useState("");
  const { me } = usePeople();
  useEffect(() => {
    if (me) setResponsibleUserId((current) => current ?? me);
  }, [me]);
  const external = responsibleUserId === EXTERNAL;
  const hasResponsible = external ? Boolean(responsible.trim()) : Boolean(responsibleUserId);
  const [dueDate, setDueDate] = useState(isoDay(2));
  const [evidence, setEvidence] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [waitingFor, setWaitingFor] = useState("");
  const [more, setMore] = useState(false);
  const [cadence, setCadence] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { success, error: notifyError } = useHudToast();

  // Gerada uma vez por abertura do formulário: reenviar o MESMO pedido depois
  // de uma falha de rede tem de cair no mesmo acompanhamento, e não abrir um
  // segundo.
  const key = useMemo(() => idempotencyKey(), []);
  const missing = [!subject && "vínculo", !goal.trim() && "objetivo", !hasResponsible && "responsável",
    waiting && !dueDate && "data de retorno"].filter(Boolean) as string[];

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || missing.length || !subject) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/commercial/followups", {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify({
          sourceKind: subject.kind,
          sourceId: subject.id,
          goal: goal.trim(),
          responsibleUserId: external ? null : responsibleUserId,
          responsibleText: external ? responsible.trim() || null : null,
          dueDate: dueDate || null,
          expectedEvidence: evidence.trim() || null,
          cadenceDays: cadence ? Number(cadence) : null,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload?.error || "Não foi possível abrir o acompanhamento.");
      }
      const id: string | null = payload.followup?.id ?? null;
      let landedWaiting = false;
      if (waiting && id) {
        const moved = await fetch("/api/commercial/followups", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            followupId: id,
            next: "WAITING_EXTERNAL_PARTY",
            nextExpectedEvent: waitingFor.trim() || goal.trim(),
            nextExpectedEventAt: dueDate,
          }),
        }).then((r) => r.json()).catch(() => null);
        landedWaiting = Boolean(moved?.ok);
        if (!moved?.ok) notifyError("Aberto, mas não marcado como “com a contraparte”", moved?.error ?? "Marque pela fila.");
      }
      const queue = queueFor({ due: dueDate || null, waiting: landedWaiting, mine: !external && responsibleUserId === me });
      success("Follow-up agendado", `${SUBJECT_LABEL[subject.kind]} · ${subject.label}`);
      onCreated({ id, queue });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const chips: [string, number][] = [["Hoje", 0], ["Amanhã", 1], ["+3 dias", 3], ["+1 semana", 7], ["+2 semanas", 14]];

  return (
    <HudModal
      isOpen
      onClose={onClose}
      title="Agendar follow-up"
      subtitle={subject ? `${SUBJECT_LABEL[subject.kind]} · ${subject.label}` : "Um compromisso com dono, prazo e evidência."}
      size="lg"
      footer={
        <div className="crm-flow-footer" style={{ border: 0, paddingTop: 0, width: "100%" }}>
          <p>{missing.length ? `Falta: ${missing.join(", ")}.` : "Aparece na fila certa assim que salvar."}</p>
          <div>
            <HudButton variant="ghost" onClick={onClose} disabled={saving}>Cancelar</HudButton>
            <HudButton variant="primary" type="submit" form={formId} disabled={saving || missing.length > 0}
              data-testid="followup-submit">
              <CalendarPlus size={15} aria-hidden />
              {saving ? "Agendando…" : "Agendar"}
            </HudButton>
          </div>
        </div>
      }
    >
      <form id={formId} className="crm-flow" onSubmit={submit} data-testid="flow-followup">
        {initialSubject ? null : (
          <SubjectField value={subject} onChange={setSubject} />
        )}
        <label className="crm-field-label crm-field-big">
          <span>Objetivo / próxima ação *</span>
          <input
            required
            autoFocus={Boolean(initialSubject)}
            maxLength={500}
            value={goal}
            placeholder="Ex.: obter a resposta do cliente sobre a revisão R02"
            onChange={(e) => setGoal(e.target.value)}
          />
        </label>
        <div className="crm-flow-grid">
          <PersonSelect
            label="Responsável"
            value={responsibleUserId}
            onChange={setResponsibleUserId}
            allowExternal
            externalText={responsible}
            onExternalText={setResponsible}
            required
          />
          <div className="crm-field">
            <label className="crm-field-label">
              <span>{waiting ? "Retorno do cliente até *" : "Prazo"}</span>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </label>
            <div className="crm-chips">
              {chips.map(([label, offset]) => (
                <button key={label} type="button" className="crm-chip" aria-pressed={dueDate === isoDay(offset)}
                  onClick={() => setDueDate(isoDay(offset))}>{label}</button>
              ))}
            </div>
          </div>
        </div>
        <label className="crm-toggle">
          <input type="checkbox" checked={waiting} onChange={(e) => setWaiting(e.target.checked)} data-testid="followup-waiting" />
          <span>
            Aguardando o cliente
            <small>Vai para “Com a contraparte”, com o que se espera dele e até quando.</small>
          </span>
        </label>
        {waiting && (
          <label className="crm-field-label">
            <span>O que o cliente deve entregar</span>
            <input maxLength={500} value={waitingFor} placeholder="Ex.: PO assinado, retorno sobre o prazo"
              onChange={(e) => setWaitingFor(e.target.value)} />
          </label>
        )}
        <label className="crm-field-label">
          <span>Evidência esperada / resultado</span>
          <input maxLength={1000} value={evidence} placeholder="Ex.: e-mail do cliente confirmando o aceite"
            onChange={(e) => setEvidence(e.target.value)} />
          <span className="crm-field-hint">Concluir exige verificação — diga agora o que vai provar que aconteceu.</span>
        </label>
        <button type="button" className="crm-chip" style={{ justifySelf: "start" }} aria-expanded={more}
          onClick={() => setMore((m) => !m)}>
          <ChevronDown size={12} aria-hidden style={{ transform: more ? "rotate(180deg)" : undefined }} /> Cadência de cobrança
        </button>
        {more && (
          <label className="crm-field-label" style={{ maxWidth: 220 }}>
            <span>Cobrar a cada (dias)</span>
            <input type="number" min={1} max={365} value={cadence} onChange={(e) => setCadence(e.target.value)} />
          </label>
        )}
        {error && (
          <p role="alert" className="crm-flow-error"><AlertTriangle size={14} aria-hidden /> {error}</p>
        )}
        <GovernanceNote>
          Entra em <code>apex_followups</code> — o mesmo motor do pós-venda, com histórico append-only. Concluído e cancelado são resultados distintos.
        </GovernanceNote>
      </form>
    </HudModal>
  );
}

/** Vínculo do acompanhamento: busca em oportunidades abertas e propostas. */
function SubjectField({
  value,
  onChange,
}: {
  value: FollowupSubject | null;
  onChange: (s: FollowupSubject | null) => void;
}) {
  const [items, setItems] = useState<{ kind: FollowupSubjectKind; id: string; label: string; hint: string }[] | null>(null);
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const listId = useId();
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch("/api/commercial/opportunities").then((r) => r.json()).catch(() => null),
      fetch("/api/commercial/proposals").then((r) => r.json()).catch(() => null),
    ]).then(([o, p]) => {
      if (!alive) return;
      const opps = ((o?.opportunities ?? []) as { id: string; title: string; counterparty_name: string; stage: OpportunityStage }[])
        .filter((r) => isOpenStage(r.stage))
        .map((r) => ({ kind: "commercial_opportunity" as const, id: r.id, label: r.title,
          hint: `${r.counterparty_name} · ${opportunityStageLabels[r.stage]}` }));
      const props = ((p?.proposals ?? []) as { id: string; proposal_number: string; title: string; counterparty_name: string }[])
        .map((r) => ({ kind: "commercial_proposal" as const, id: r.id, label: `${r.proposal_number} · ${r.title}`,
          hint: r.counterparty_name }));
      setItems([...opps, ...props]);
    });
    const close = (event: MouseEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => {
      alive = false;
      document.removeEventListener("mousedown", close);
    };
  }, []);

  if (value) {
    return (
      <div className="crm-field">
        <span className="crm-flow-label">Vínculo</span>
        <div className="crm-picked">
          <span className="crm-picked-avatar" aria-hidden>
            {value.kind === "commercial_opportunity" ? <Handshake size={15} /> : <FileText size={15} />}
          </span>
          <div>
            <strong>{value.label}</strong>
            <small>{SUBJECT_LABEL[value.kind]}</small>
          </div>
          <HudButton variant="ghost" size="sm" onClick={() => onChange(null)}><X size={13} aria-hidden /> Trocar</HudButton>
        </div>
      </div>
    );
  }
  const shown = (items ?? []).filter((i) => matches(term, i.label, i.hint)).slice(0, 8);
  return (
    <div className="crm-field crm-combobox" ref={wrap}>
      <label className="crm-field-label">
        <span>Vínculo — oportunidade ou proposta *</span>
        <span style={{ position: "relative", display: "block" }}>
          <Search size={14} aria-hidden style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", opacity: 0.55 }} />
          <input role="combobox" aria-expanded={open} aria-controls={listId} autoFocus value={term} style={{ paddingLeft: 30 }}
            placeholder="Buscar por título, número ou cliente…"
            onFocus={() => setOpen(true)} onChange={(e) => { setTerm(e.target.value); setOpen(true); }}
            data-testid="followup-subject" />
        </span>
      </label>
      {open && (
        <div className="crm-combobox-list" role="listbox" id={listId}>
          {items === null && <div className="crm-combobox-empty">Carregando…</div>}
          {items !== null && !shown.length && (
            <div className="crm-combobox-empty">Nada encontrado. Um follow-up precisa de uma oportunidade aberta ou de uma proposta.</div>
          )}
          {shown.map((item) => (
            <button key={`${item.kind}:${item.id}`} type="button" role="option" aria-selected={false}
              onClick={() => onChange({ kind: item.kind, id: item.id, label: item.label })}>
              <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                {item.kind === "commercial_opportunity" ? <Handshake size={14} aria-hidden /> : <FileText size={14} aria-hidden />}
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.label}</span>
              </span>
              <small>{item.hint}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
