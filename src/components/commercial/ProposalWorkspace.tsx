"use client";

/**
 * O ESPAÇO DE TRABALHO de UMA proposta comercial — o contexto PT + PC.
 *
 * Abrir a técnica ou a comercial abre a mesma proposta. Os dois documentos
 * continuam rastreáveis um a um (número, PDF, revisões independentes, fatos,
 * proveniência), mas a tela responde às perguntas do negócio, nesta ordem:
 *
 *   O QUE EXISTE?        — os documentos do contexto e seus PDFs
 *   O QUE REGE?          — a revisão regente de cada um
 *   O QUE A APEX ACHOU?  — fatos lidos, com página
 *   O QUE ESTÁ CONFIRMADO / EM CONFLITO?
 *   O QUE PRECISA DE APROVAÇÃO? — o pacote exato que pode ir ao cliente
 *   O QUE VEM A SEGUIR?
 *
 * ─── As coisas que esta tela se recusa a borrar ──────────────────────────
 *
 * • REVISÃO REGENTE ≠ revisão mais recente. A aceita continua regendo.
 * • FATO LIDO ≠ regra. Só fato com página e trecho, confirmado por gente.
 * • APROVAÇÃO INTERNA ≠ análise de IA. É a decisão de quem tem alçada sobre
 *   o pacote que será enviado — e revisão nova exige reaprovação.
 * • ACEITE ≠ trabalho autorizado. Fechar e iniciar execução é outro ato.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertOctagon, ArrowRight, CalendarPlus, CheckCircle2, CircleDashed, FilePlus2, FileText, Link2, Lock,
  Plus, Quote, Rocket, Send, ShieldCheck, Undo2, Zap,
} from "lucide-react";
import { HudButton, HudDrawer, HudModal, useHudToast } from "@/components/hud";
import { usePermissions } from "@/hooks/use-permissions";
import {
  divergenceScopeLabels, divergenceSeverityLabels, documentContextLabels,
  engagementStatusLabels, opportunityStageLabels, proposalStatusLabels,
  serviceOrderStatusLabels,
} from "@/lib/commercial/labels";
import type {
  DivergenceScope, DivergenceSeverity, DocumentContext, EngagementStatus,
  FactDomain, OpportunityStage, ProposalKind, ProposalRevisionStatus,
  ServiceOrderStatus,
} from "@/lib/commercial/types";
import { isFactPromotable } from "@/lib/commercial/types";
import {
  CONTEXT_STAGE_LABEL, CUSTOMER_STATE_LABEL, INTERNAL_APPROVAL_LABEL,
  buildContext, contextNextAction, packageAcceptance, revisionLabel as rl,
  type AcceptanceRecord, type PackageAcceptance,
  type ContextMember, type ProposalContext,
} from "@/lib/commercial/proposal-context";
import { paymentSummary, structurePaymentTerms } from "@/lib/commercial/payment-terms";
import { FOLLOWUP_STATE_LABEL, type FollowupState } from "@/lib/platform/followups/types";
import { brl, day, notifyCommercialChanged, ResourceState, useCommercialResource } from "./shared";
import {
  Section, SectionEmpty, SectionRestricted, Timeline, formatMoment,
  type TimelineEntry,
} from "./detail";
import { FlowTabPanel, FlowTabs } from "./tabs";
import { ProposalDocumentUpload } from "./ProposalDocumentUpload";
import { RevisionComparison, TechnicalCommercialCheck } from "./ProposalCompare";
import { BlueprintView, type BlueprintRow } from "./BlueprintView";
import { ExecutionStartPanel } from "./ExecutionStartPanel";
import { ExecutionStatusBanner, type ExecutionStartSummary } from "./ExecutionStatus";
import { RecordOutcomeModal } from "./RecordOutcomeModal";
import { ChunkedText, DocTag, KeyValue, PaymentSchedule, Provenance, type DocRole } from "./ProposalParts";
import { StatePill, UnlockHint, type Tone } from "./workspace";
import type { FactLike, RevisionLike } from "@/lib/commercial/proposal-compare";

type ProposalTab = "summary" | "revisions" | "facts" | "execution" | "activity";

const ROLE: Record<ProposalKind, DocRole> = { TECHNICAL: "PT", COMMERCIAL: "PC", COMBINED: "PT+PC" };
const KIND_LABEL: Record<ProposalKind, string> = {
  TECHNICAL: "Proposta técnica", COMMERCIAL: "Proposta comercial", COMBINED: "Técnica + comercial",
};

const FACT_GROUPS: Array<{ id: string; label: string; note: string; domains: FactDomain[] }> = [
  {
    id: "commercial", label: "Condições comerciais", note: "Valor, pagamento, medição e faturamento — governados pela PC.",
    domains: ["VALUE", "RATE", "UNIT_PRICE", "PAYMENT_TERM", "MEASUREMENT_RULE",
      "BILLING_MILESTONE", "BILLING_PREREQUISITE", "VALIDITY", "ACCEPTANCE_CONDITION"],
  },
  {
    id: "technical", label: "Escopo técnico", note: "O que será entregue, excluído e do que depende — governado pela PT.",
    domains: ["SCOPE", "DELIVERABLE", "REQUIREMENT", "EXCLUSION", "DEPENDENCY",
      "TEST", "DOCUMENT", "DATE", "MILESTONE", "RESOURCE"],
  },
  { id: "other", label: "Outros fatos", note: "Riscos e itens fora dos dois grupos acima.", domains: ["RISK", "OTHER"] },
];

type ProposalRow = {
  id: string; opportunity_id: string | null; proposal_number: string; kind: ProposalKind;
  title: string; counterparty_name: string; party_id?: string | null; currency: string;
  owner_user_id?: string | null; created_at?: string | null; context_id?: string | null;
};
type RevisionRow = {
  id: string; proposal_id: string; revision: number; status: ProposalRevisionStatus;
  total_value: string | null; currency: string | null; validity_until: string | null;
  payment_terms: string | null; scope_summary: string | null;
  acceptance_conditions: string | null; document_id: string | null;
  internal_review_at?: string | null; internally_approved_at?: string | null;
  internally_approved_by?: string | null; sent_at?: string | null; sent_by?: string | null;
  negotiation_at?: string | null; accepted_at?: string | null; acceptance_source?: string | null;
  acceptance_external_ref?: string | null; recorded_by?: string | null; rejected_at?: string | null;
  rejection_reason?: string | null; expired_at?: string | null; withdrawn_at?: string | null;
  superseded_at?: string | null; created_by?: string | null; created_at?: string | null;
};
type FactRow = {
  id: string; document_id: string | null; document_context: DocumentContext;
  subject_kind: string | null; subject_id: string | null; fact_domain: FactDomain;
  label: string; value_text: string | null; value_numeric: string | null;
  value_date: string | null; unit: string | null; currency: string | null;
  source_revision: string | null; source_page: number | null; source_section: string | null;
  source_quote: string | null; confidence: string | null; extraction_method: string;
  provenance_state: "ANCHORED" | "UNANCHORED";
  confirmation_state: "UNCONFIRMED" | "CONFIRMED" | "CORRECTED" | "REJECTED";
  corrected_value: string | null; confirmed_at: string | null;
};
type FollowupRow = {
  id: string; goal: string; expected_evidence: string | null; state: FollowupState;
  due_date: string | null; responsible_text: string | null; created_at: string;
};
type DocumentRow = { id: string; title: string; file_path: string; document_type: string; status: string; created_at: string };
type AuthorizationRow = {
  id: string; engagement_id: string; source_kind: string; proposal_revision_id: string | null;
  authorized_value: string | null; currency: string | null; governing: boolean; state: string;
};
type EngagementRow = {
  id: string; engagement_number: string | null; title: string; status: EngagementStatus;
  authorized_value: string | null; currency: string; authorized_at: string | null;
};
type ServiceOrderRow = {
  id: string; engagement_id: string; os_number: string; title: string; origin: string;
  status: ServiceOrderStatus; project_id: string | null; source_proposal_revision_id: string | null;
  issued_at: string | null;
};
type DivergenceRow = {
  id: string; scope: DivergenceScope; left_source_kind: string; left_value: string | null;
  right_source_kind: string; right_value: string | null; severity: DivergenceSeverity;
  summary: string; state: string;
};

type Payload = {
  proposal: ProposalRow;
  revisions: RevisionRow[];
  members?: ProposalRow[];
  contextRevisions?: RevisionRow[];
  /** Livro de aceite do contexto (217); nulo num banco sem a 217. */
  acceptances?: AcceptanceRecord[] | null;
  opportunity: {
    id: string; title: string; stage: OpportunityStage; counterparty_name: string;
    estimated_value: string | null; currency: string; expected_decision_date: string | null;
  } | null;
  facts: FactRow[];
  followups: FollowupRow[];
  documents: DocumentRow[];
  authorizations: AuthorizationRow[];
  engagements: EngagementRow[];
  serviceOrders: ServiceOrderRow[];
  divergences: DivergenceRow[];
  owners: Record<string, string>;
  executionVisibility: "visible" | "restricted";
  siblings?: ProposalRow[];
  siblingRevisions?: RevisionRow[];
  siblingFacts?: FactRow[];
  blueprints?: BlueprintRow[];
  executionStart?: ExecutionStartSummary | null;
};

type Member = ContextMember<ProposalRow, RevisionRow>;
type Ctx = ProposalContext<ProposalRow, RevisionRow>;

const STAGE_TONE: Record<string, Tone> = {
  DRAFT: "neutral", INTERNAL_APPROVAL: "warning", APPROVED_FOR_SEND: "info", WITH_CUSTOMER: "accent",
  NEGOTIATION: "accent", ACCEPTED: "success", REJECTED: "danger", CLOSED: "neutral",
};
const REVISION_TONE = (s: ProposalRevisionStatus): Tone =>
  s === "ACCEPTED" ? "success" : s === "REJECTED" || s === "EXPIRED" ? "danger"
    : s === "INTERNAL_REVIEW" ? "warning" : s === "INTERNALLY_APPROVED" ? "info"
    : s === "SENT" || s === "NEGOTIATION" ? "accent" : "neutral";
const CLOSED: ProposalRevisionStatus[] = ["REJECTED", "WITHDRAWN", "EXPIRED", "SUPERSEDED"];

const factValue = (fact: FactRow, currency: string) =>
  fact.corrected_value ?? fact.value_text
    ?? (fact.value_numeric !== null ? brl(fact.value_numeric, fact.currency ?? currency)
      : fact.value_date ? day(fact.value_date) : "Sem valor registrado");

export function ProposalWorkspace({
  proposalId,
  onClose,
  onOpenOpportunity,
  onComposeFollowup,
}: {
  proposalId: string;
  onClose: () => void;
  onOpenOpportunity?: (opportunityId: string) => void;
  onComposeFollowup?: (subject: { id: string; label: string }) => void;
}) {
  const { data, state, message, refresh } = useCommercialResource<Payload>(`/api/commercial/proposals/${proposalId}`);
  const { hasPermission, loading: permissionsLoading } = usePermissions();
  const canManage = hasPermission("commercial.manage");
  const canManageProposals = hasPermission("commercial.proposals.manage");
  const canApprove = hasPermission("commercial.proposals.approve_internal");
  const canRecordOutcome = hasPermission("commercial.proposals.record_acceptance");
  const canStart = hasPermission("commercial.execution.start");
  const canStartExceptional = hasPermission("commercial.execution.start_exceptional");
  const canRegularize = hasPermission("commercial.engagements.manage");
  const [tab, setTab] = useState<ProposalTab>("summary");
  const [closing, setClosing] = useState<null | "STANDARD" | "EXCEPTIONAL">(null);
  const [linking, setLinking] = useState<null | "link" | "create">(null);
  const [outcome, setOutcome] = useState<RevisionRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const { success, error: notifyError } = useHudToast();

  /*
    O contexto: com a API nova vêm `members` e `contextRevisions`; com a
    resposta antiga (ou uma fixture), a proposta aberta e as irmãs formam o
    mesmo contexto — a tela não depende da ordem de deploy.
  */
  const view = useMemo(() => {
    if (!data) return null;
    const members = data.members?.length ? data.members : [data.proposal, ...(data.siblings ?? [])];
    const revisions = data.contextRevisions?.length ? data.contextRevisions
      : [...data.revisions, ...(data.siblingRevisions ?? [])];
    const ctx = buildContext<ProposalRow, RevisionRow>(`ctx:${proposalId}`, members, revisions);
    const factMap = new Map<string, FactRow>();
    for (const f of [...data.facts, ...(data.siblingFacts ?? [])]) factMap.set(f.id, f);
    const facts = [...factMap.values()];
    const kindByRevision = new Map<string, ProposalKind>();
    const kindByDocument = new Map<string, ProposalKind>();
    for (const m of ctx.members) {
      for (const r of m.revisions) {
        kindByRevision.set(r.id, m.proposal.kind);
        if (r.document_id) kindByDocument.set(r.document_id, m.proposal.kind);
      }
    }
    const factKind = (f: FactRow): ProposalKind | null =>
      (f.subject_id && kindByRevision.get(f.subject_id)) || (f.document_id && kindByDocument.get(f.document_id)) || null;
    return { ctx, facts, factKind };
  }, [data, proposalId]);

  if (state !== "ready" || !data || !view) {
    return (
      <HudDrawer isOpen onClose={onClose} title="Proposta" width="760px" density="compact">
        <ResourceState state={state} message={message} />
      </HudDrawer>
    );
  }

  const { ctx, facts, factKind } = view;
  const primary = ctx.members.find((m) => m.proposal.id === ctx.primaryId)!;
  const opportunityId = ctx.opportunityId;
  const restricted = data.executionVisibility === "restricted";
  const contextRevisionIds = new Set(ctx.members.flatMap((m) => m.revisions.map((r) => r.id)));
  const acceptedMember = ctx.members.find((m) => m.governing?.status === "ACCEPTED") ?? null;
  const pkg = packageAcceptance(ctx, data.acceptances);
  const packageLabel = ctx.members.map((m) => `${ROLE[m.proposal.kind]} ${rl(m.governing?.revision)}`).join(" + ");
  const openDivergences = data.divergences.filter((d) => d.state === "OPEN");
  const blockingDivergences = openDivergences.filter((d) => d.severity === "BLOCKING");
  const anchoredFacts = facts.filter((f) => f.provenance_state === "ANCHORED").length;
  const confirmedFacts = facts.filter((f) => f.confirmation_state === "CONFIRMED" || f.confirmation_state === "CORRECTED").length;
  const pendingFacts = facts.filter((f) => f.confirmation_state === "UNCONFIRMED").length;
  const pt = ctx.technical ?? ctx.combined;
  const pc = ctx.commercial ?? ctx.combined;
  const crossFindingsInput = {
    technical: (ctx.technical?.governing ?? null) as unknown as RevisionLike | null,
    commercial: (ctx.commercial?.governing ?? null) as unknown as RevisionLike | null,
  };
  const nextStep = data.executionStart ? "Execução iniciada — acompanhe OS e projeto"
    : blockingDivergences.length ? `Resolver ${blockingDivergences.length} divergência(s) bloqueante(s)`
    : contextNextAction(ctx as unknown as ProposalContext);
  const headerLabel = ctx.members.map((m) => m.proposal.proposal_number).join(" · ");
  const liveForClosing = ctx.members.some((m) => m.governing && !CLOSED.includes(m.governing.status));

  const transition = async (to: "INTERNAL_REVIEW" | "INTERNALLY_APPROVED" | "SENT" | "DRAFT") => {
    if (busy) return;
    setBusy(to);
    try {
      const response = await fetch(`/api/commercial/proposals/${primary.proposal.id}/context`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ to }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload?.error || "Transição recusada.");
      const moved = (payload.moved ?? []) as Array<{ proposal_id: string; revision: number }>;
      const docs = moved.map((m) => {
        const member = ctx.members.find((x) => x.proposal.id === m.proposal_id);
        return member ? `${ROLE[member.proposal.kind]} ${rl(m.revision)}` : rl(m.revision);
      }).join(" + ");
      success({
        INTERNAL_REVIEW: "Enviada para aprovação interna", INTERNALLY_APPROVED: "Aprovada para envio",
        SENT: "Pacote marcado como enviado ao cliente", DRAFT: "Devolvida para ajuste",
      }[to], docs || undefined);
      notifyCommercialChanged();
      refresh();
    } catch (e) {
      notifyError("Aprovação interna", (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const revise = async (member: Member) => {
    if (!member.latest || busy) return;
    setBusy(`revise:${member.proposal.id}`);
    try {
      const response = await fetch("/api/commercial/proposals", {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ revisionId: member.latest.id, action: "revise", payload: {} }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload?.error || "Revisão recusada.");
      success(`${ROLE[member.proposal.kind]} ${rl(payload.revision)} criada em rascunho`,
        "A revisão anterior fica intacta. Anexe o PDF e leve o pacote à reaprovação.");
      notifyCommercialChanged();
      refresh();
    } catch (e) {
      notifyError("Nova revisão", (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const timeline: TimelineEntry[] = (() => {
    const owner = (id: string | null | undefined) => (id ? (data.owners[id] ?? "Usuário da organização") : null);
    const entries: TimelineEntry[] = [];
    for (const m of ctx.members) {
      for (const r of m.revisions) {
        const label = `${ROLE[m.proposal.kind]} ${rl(r.revision)}`;
        const push = (at: string | null | undefined, title: string, detail?: string | null, actor?: string | null, tone?: TimelineEntry["tone"]) => {
          if (at) entries.push({ id: `${title}-${r.id}`, at, title, detail, actor, tone });
        };
        push(r.created_at, `${label} criada`, null, owner(r.created_by));
        push(r.internal_review_at, `${label} enviada para aprovação interna`);
        push(r.internally_approved_at, `${label} aprovada para envio`, null, owner(r.internally_approved_by));
        push(r.sent_at, `${label} enviada ao cliente`, null, owner(r.sent_by), "accent");
        push(r.negotiation_at, `${label} em negociação`);
        push(r.accepted_at, `${label} aceita pelo cliente`,
          `Manifestação: ${r.acceptance_source ?? "não informada"}${r.acceptance_external_ref ? ` · ref. ${r.acceptance_external_ref}` : ""}`,
          owner(r.recorded_by), "success");
        push(r.rejected_at, `${label} recusada`, r.rejection_reason, null, "danger");
        push(r.expired_at, `${label} expirada`, null, null, "danger");
        push(r.withdrawn_at, `${label} retirada`);
        push(r.superseded_at, `${label} substituída por revisão posterior`);
      }
    }
    for (const order of data.serviceOrders) {
      if (order.issued_at) entries.push({ id: `os-${order.id}`, at: order.issued_at, title: `OS ${order.os_number} emitida`, tone: "success" });
    }
    return entries.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
  })();

  const tabs = [
    { id: "summary", label: "Resumo" },
    { id: "revisions", label: "Revisões", count: ctx.members.reduce((n, m) => n + m.revisions.length, 0) },
    { id: "facts", label: "Fatos e blueprint", count: facts.length },
    { id: "execution", label: "Execução", count: blockingDivergences.length || openDivergences.length, alert: blockingDivergences.length > 0 },
    { id: "activity", label: "Atividade" },
  ];
  const ordersFromProposal = data.serviceOrders.filter((o) => o.source_proposal_revision_id && contextRevisionIds.has(o.source_proposal_revision_id));

  return (
    <>
      <HudDrawer
        isOpen
        onClose={onClose}
        width="920px"
        density="compact"
        title={ctx.title}
        subtitle={
          <div className="crm-drawer-subtitle">
            <StatePill tone={STAGE_TONE[ctx.stage]}>{CONTEXT_STAGE_LABEL[ctx.stage]}</StatePill>
            <span>{ctx.counterparty}</span>
            <span className="crm-muted">{headerLabel}</span>
          </div>
        }
      >
        <div className="crm-detail pc-workspace" data-testid="proposal-context">
          {data.executionStart && (
            <ExecutionStatusBanner start={data.executionStart} owners={data.owners}
              canRegularize={canRegularize} onRegularized={refresh} />
          )}

          {/* ── O QUE EXISTE / O QUE REGE ─────────────────────────────── */}
          <header className="pc-hero" data-testid="proposal-context-header">
            <div className="pc-hero-id">
              <span className="pc-eyebrow">Cliente / obra</span>
              <strong>{ctx.counterparty}</strong>
              <span className="pc-muted">{ctx.title}</span>
            </div>
            <div className="pc-docs" data-single={Boolean(ctx.combined)}>
              {ctx.combined ? (
                <DocumentCard member={ctx.combined} role="PT+PC" governs="Escopo e condições comerciais — um PDF só" />
              ) : (["TECHNICAL", "COMMERCIAL"] as const).map((kind) => {
                const member = kind === "TECHNICAL" ? pt : pc;
                return member
                  ? <DocumentCard key={kind} member={member} role={ROLE[member.proposal.kind]} governs={kind === "TECHNICAL" ? "Escopo, entregáveis, exclusões" : "Valor, pagamento, validade"} />
                  : <MissingDocumentCard key={kind} role={kind === "TECHNICAL" ? "PT" : "PC"} />;
              })}
            </div>
            <div className="pc-figures">
              <KeyValue label="Valor" value={ctx.value !== null ? brl(ctx.value, ctx.currency) : "—"}
                hint={pc?.governing ? `${ROLE[pc.proposal.kind]} ${rl(pc.governing.revision)}` : "Sem PC"} tone="accent" />
              <KeyValue label="Validade" value={day(ctx.validityUntil)}
                hint={ctx.validityUntil ? "Depois disso, nova revisão" : "Não declarada"} />
              <KeyValue label="Aprovação interna" value={INTERNAL_APPROVAL_LABEL[ctx.internalApproval]}
                tone={ctx.internalApproval === "APPROVED" ? "success" : ctx.internalApproval === "REAPPROVAL" || ctx.internalApproval === "PENDING" ? "warning" : undefined} />
              <KeyValue label="Cliente"
                value={pkg.state === "CHANGED" ? "Pacote mudou após o aceite" : CUSTOMER_STATE_LABEL[ctx.customerState]}
                hint={pkg.state === "ACCEPTED" && pkg.record ? `${day(pkg.record.accepted_at)} · ${SOURCE_LABEL[pkg.record.acceptance_source ?? ""] ?? pkg.record.acceptance_source ?? ""}` : undefined}
                tone={pkg.state === "ACCEPTED" ? "success" : pkg.state === "CHANGED" || pkg.state === "PARTIAL" || ctx.customerState === "REJECTED" ? "danger" : undefined} />
              <KeyValue label="Próximo passo" value={nextStep} />
            </div>
          </header>

          {/* ── faixas de desbloqueio ───────────────────────────────────── */}
          {!data.executionStart && canStart && opportunityId && liveForClosing && (
            <div className="flow-command" data-testid="close-deal-command">
              <p>
                <strong>{ctx.accepted ? "Aceita pelo cliente." : ctx.customerState === "NOT_SENT" ? "Ainda não enviada." : "Com o cliente."}</strong>{" "}
                Fechar registra a base de autorização, gera a OS interna e abre o projeto — no mesmo caminho canônico. Contrato formal é opcional.
              </p>
              <div className="flex flex-wrap gap-2">
                {canStartExceptional && (
                  <HudButton variant="ghost" size="sm" onClick={() => setClosing("EXCEPTIONAL")}>
                    <Zap size={14} aria-hidden /> Início excepcional
                  </HudButton>
                )}
                <HudButton variant="primary" size="sm" onClick={() => setClosing("STANDARD")}>
                  <Rocket size={14} aria-hidden /> Fechar negócio e iniciar execução
                </HudButton>
              </div>
            </div>
          )}
          {!data.executionStart && !opportunityId && (
            <UnlockHint
              tone="warning"
              icon={<Link2 size={14} />}
              testId="proposal-link-opportunity"
              action={
                <div className="flex flex-wrap gap-2">
                  <HudButton variant="secondary" size="sm" onClick={() => setLinking("link")}>
                    <Link2 size={13} aria-hidden /> Vincular oportunidade
                  </HudButton>
                  <HudButton variant="primary" size="sm" onClick={() => setLinking("create")} data-testid="proposal-create-opportunity">
                    <Plus size={13} aria-hidden /> Criar a partir desta proposta
                  </HudButton>
                </div>
              }
            >
              <strong>Vincule esta proposta a uma oportunidade para iniciar execução.</strong>{" "}
              Vincule uma existente ou crie agora, sem sair daqui — PT e PC entram juntas.
            </UnlockHint>
          )}
          {!data.executionStart && opportunityId && !liveForClosing && (
            <UnlockHint tone="warning" icon={<Rocket size={14} />}>
              Nenhum documento do pacote está vivo — para fechar, crie uma nova revisão e leve-a ao cliente.
            </UnlockHint>
          )}
          {!data.executionStart && !canStart && opportunityId && liveForClosing && (
            <UnlockHint icon={<Lock size={14} />}>
              <strong>Fechar negócio e iniciar execução</strong> exige a alçada <code>commercial.execution.start</code>.
            </UnlockHint>
          )}

          {/* ── O QUE A APEX ACHOU / CONFIRMADO / CONFLITO / PRÓXIMO ───── */}
          <div className="pc-answers" aria-label="Situação da proposta" data-testid="proposal-status-strip">
            <Answer q="Apex encontrou" a={`${facts.length} fato(s)`} d={`${anchoredFacts} com página e trecho`} />
            <Answer q="Confirmado" a={String(confirmedFacts)} d={`${pendingFacts} aguardando confirmação`} tone={confirmedFacts ? "success" : undefined} />
            <Answer q="Em conflito" a={restricted ? "—" : String(openDivergences.length)}
              d={restricted ? "restrito a contratos" : `${blockingDivergences.length} bloqueante(s)`}
              tone={blockingDivergences.length ? "danger" : openDivergences.length ? "warning" : undefined} />
            <Answer q="Precisa de aprovação" a={ctx.internalApproval === "PENDING" || ctx.internalApproval === "REAPPROVAL" || ctx.internalApproval === "NOT_REQUESTED" ? "Sim" : "Não"}
              d={INTERNAL_APPROVAL_LABEL[ctx.internalApproval]} tone={ctx.internalApproval === "PENDING" || ctx.internalApproval === "REAPPROVAL" ? "warning" : undefined} />
          </div>

          <FlowTabs label="Seções da proposta" tabs={tabs} active={tab} onChange={(id) => setTab(id as ProposalTab)} />

          {tab === "summary" && (
            <FlowTabPanel label="Resumo">
              {ctx.members.filter((m) => m.governing && !m.governing.document_id).map((m) => (
                <UnlockHint key={m.proposal.id} tone="warning" icon={<FileText size={14} />} testId="proposal-attach-pdf"
                  action={canManageProposals && !CLOSED.includes(m.governing!.status) ? (
                    <ProposalDocumentUpload proposalId={m.proposal.id} revisionId={m.governing!.id}
                      revisionLabel={`${ROLE[m.proposal.kind]} ${rl(m.governing!.revision)}`} onDone={refresh} />
                  ) : undefined}>
                  <strong>{ROLE[m.proposal.kind]} {rl(m.governing!.revision)} sem PDF.</strong> Sem o documento, a Apex não lê fatos e o pacote não pode ser aprovado com segurança.
                  {!canManageProposals && " Anexar exige commercial.proposals.manage."}
                </UnlockHint>
              ))}

              <ApprovalWorkspace
                ctx={ctx}
                facts={facts}
                factKind={factKind}
                crossFacts={facts as unknown as FactLike[]}
                cross={crossFindingsInput}
                owners={data.owners}
                blockingDivergences={blockingDivergences.length}
                canManage={canManageProposals}
                canApprove={canApprove}
                canRecordOutcome={canRecordOutcome}
                busy={busy}
                onTransition={transition}
                onRecordOutcome={() => setOutcome(primary.governing)}
                onRevise={() => setTab("revisions")}
              />

              {(pkg.record || pkg.state !== "NONE") && (
                <AcceptancePanel pkg={pkg} owners={data.owners} />
              )}

              {data.opportunity && (
                <Section title="Oportunidade" action={onOpenOpportunity ? (
                  <HudButton variant="ghost" size="sm" onClick={() => onOpenOpportunity(data.opportunity!.id)}>
                    Abrir <ArrowRight size={13} aria-hidden />
                  </HudButton>
                ) : undefined}>
                  <div className="crm-account-line">
                    <div className="min-w-0">
                      <strong>{data.opportunity.title}</strong>
                      <p className="crm-muted">
                        {opportunityStageLabels[data.opportunity.stage]} · {brl(data.opportunity.estimated_value, data.opportunity.currency)} · decisão {day(data.opportunity.expected_decision_date)}
                      </p>
                    </div>
                  </div>
                </Section>
              )}
            </FlowTabPanel>
          )}

          {tab === "revisions" && (
            <FlowTabPanel label="Revisões">
              <p className="pc-lead">
                PT e PC têm histórias de revisão <strong>independentes</strong> dentro da mesma proposta. Revisar nunca edita a revisão enviada: cria a próxima, que volta para aprovação interna.
              </p>
              <div className="pc-lanes">
                {ctx.members.map((m) => (
                  <RevisionLane key={m.proposal.id} member={m} currency={ctx.currency} owners={data.owners}
                    canManage={canManageProposals} busy={busy}
                    primary={m.proposal.id === primary.proposal.id}
                    onRevise={() => revise(m)} onRefresh={refresh} />
                ))}
              </div>
              {ctx.members.some((m) => m.revisions.length >= 2) ? (
                ctx.members.filter((m) => m.revisions.length >= 2).map((m) => (
                  <Section key={m.proposal.id} title={`Comparar revisões · ${ROLE[m.proposal.kind]} ${m.proposal.proposal_number}`}
                    note="Mudanças materiais primeiro; o detalhe vem abaixo.">
                    <RevisionComparison revisions={m.revisions as unknown as RevisionLike[]}
                      facts={facts as unknown as FactLike[]} governingId={m.governing?.id ?? null} label={m.proposal.proposal_number} />
                  </Section>
                ))
              ) : (
                <UnlockHint icon={<FilePlus2 size={14} />} testId="revision-compare-locked">
                  <strong>Comparação disponível após uma nova revisão.</strong> Hoje cada documento tem uma revisão só.
                </UnlockHint>
              )}
            </FlowTabPanel>
          )}

          {tab === "facts" && (
            <FlowTabPanel label="Fatos e blueprint">
              {/*
                O blueprint é por REVISÃO (a função governada lê os fatos dela):
                um por documento — PC (medição, faturamento) e PT (escopo,
                entregáveis) — dentro do mesmo contexto.
              */}
              {[primary, ...ctx.members.filter((m) => m.proposal.id !== primary.proposal.id)].map((plan) => (
                <Section key={plan.proposal.id}
                  title={`Blueprint de execução · ${ROLE[plan.proposal.kind]} ${plan.governing ? rl(plan.governing.revision) : ""}`}
                  note={plan.proposal.kind === "TECHNICAL" ? "Escopo, entregáveis, datas e dependências — antes de virar trabalho."
                    : "Medição, evidência, faturamento e condições — antes de virar trabalho."}>
                  <BlueprintView
                    proposalId={plan.proposal.id}
                    revisionId={plan.governing?.id ?? null}
                    revisionLabel={plan.governing ? `${ROLE[plan.proposal.kind]} ${rl(plan.governing.revision)}` : "a revisão"}
                    authorized={data.authorizations.some((a) => a.proposal_revision_id === plan.governing?.id && a.state === "ACTIVE")}
                    blueprint={(data.blueprints ?? []).find((b) => b.proposal_revision_id === plan.governing?.id) ?? null}
                    facts={facts as unknown as FactLike[]}
                    canCreate={canManageProposals}
                    onCreated={refresh}
                    openQuestions={openDivergences.map((d) => d.summary)}
                  />
                </Section>
              ))}
              <Section title="Fatos lidos dos documentos" count={facts.length}
                note="Só fato com página e trecho literal, confirmado por gente, pode virar regra.">
                {facts.length === 0 ? (
                  <SectionEmpty>Nenhum fato extraído. O silêncio do documento é informação: nenhuma regra de medição será suposta.</SectionEmpty>
                ) : FACT_GROUPS.map((group) => {
                  const rows = facts.filter((f) => group.domains.includes(f.fact_domain));
                  if (!rows.length) return null;
                  return (
                    <div key={group.id} className="crm-fact-group">
                      <p className="crm-eyebrow">{group.label}</p>
                      <p className="crm-muted">{group.note}</p>
                      <ul className="crm-fact-list">
                        {rows.map((fact) => {
                          const promotable = isFactPromotable({ provenanceState: fact.provenance_state, confirmationState: fact.confirmation_state });
                          const kind = factKind(fact);
                          return (
                            <li key={fact.id}>
                              <div className="min-w-0">
                                <strong>{kind && <DocTag role={ROLE[kind]} />} {fact.label}</strong>
                                <p className="crm-fact-value">{factValue(fact, ctx.currency)}{fact.unit ? ` ${fact.unit}` : ""}</p>
                                <Provenance>
                                  {fact.provenance_state === "ANCHORED"
                                    ? `${documentContextLabels[fact.document_context] ?? "Documento"}${fact.source_page ? ` · p. ${fact.source_page}` : ""}${fact.source_section ? ` · ${fact.source_section}` : ""}`
                                    : "Sem página e trecho literal — não promovível a regra"}
                                </Provenance>
                                {fact.source_quote && <blockquote className="crm-quote">{fact.source_quote}</blockquote>}
                              </div>
                              <div className="crm-fact-state">
                                <StatePill tone={promotable ? "success" : fact.provenance_state === "ANCHORED" ? "warning" : "neutral"}>
                                  {promotable ? "Promovível a regra" : fact.confirmation_state === "UNCONFIRMED" ? "Aguarda confirmação"
                                    : fact.confirmation_state === "REJECTED" ? "Rejeitado" : "Não ancorado"}
                                </StatePill>
                                <span className="crm-muted">{fact.extraction_method === "ai" ? "Leitura da Apex" : "Registro humano"}</span>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
              </Section>
            </FlowTabPanel>
          )}

          {tab === "execution" && (
            <FlowTabPanel label="Execução">
              <Section title="Passagem para execução" note="Aceite não é autorização. Autorizar e emitir a OS são atos distintos.">
                {restricted ? <SectionRestricted permission="contracts.view" /> : !acceptedMember && !data.executionStart ? (
                  <SectionEmpty>
                    Nenhuma revisão desta proposta foi aceita pelo cliente. Com autorização do cliente em mãos, use “Fechar negócio e iniciar execução”.
                  </SectionEmpty>
                ) : (
                  <div className="crm-handoff">
                    <ol className="crm-handoff-steps">
                      <li className={acceptedMember ? "crm-handoff-done" : undefined}>
                        {acceptedMember ? <CheckCircle2 size={14} aria-hidden /> : <ArrowRight size={14} aria-hidden />}
                        <div>
                          <strong>Autorização do cliente</strong>
                          <p className="crm-muted">
                            {acceptedMember?.governing
                              ? `${ROLE[acceptedMember.proposal.kind]} ${rl(acceptedMember.governing.revision)} aceita em ${day(acceptedMember.governing.accepted_at ?? null)}`
                              : "Registrada no fechamento (início rápido)."}
                          </p>
                        </div>
                      </li>
                      <li className={data.engagements.length ? "crm-handoff-done" : undefined}>
                        {data.engagements.length ? <CheckCircle2 size={14} aria-hidden /> : <ArrowRight size={14} aria-hidden />}
                        <div>
                          <strong>Trabalho autorizado</strong>
                          <p className="crm-muted">
                            {data.engagements.length
                              ? data.engagements.map((e) => `${e.engagement_number ?? e.title} · ${engagementStatusLabels[e.status]}`).join(" · ")
                              : "Nenhuma autorização aponta para esta proposta."}
                          </p>
                        </div>
                      </li>
                      <li className={ordersFromProposal.length ? "crm-handoff-done" : undefined}>
                        {ordersFromProposal.length ? <CheckCircle2 size={14} aria-hidden /> : <ArrowRight size={14} aria-hidden />}
                        <div>
                          <strong>OS interna → projeto</strong>
                          <p className="crm-muted">
                            {data.serviceOrders.length
                              ? data.serviceOrders.map((o) => `${o.os_number} · ${serviceOrderStatusLabels[o.status]}${o.project_id ? "" : " · sem projeto"}`).join(" · ")
                              : "Nenhuma OS interna liberou o trabalho para execução."}
                          </p>
                          {blockingDivergences.length > 0 && (
                            <p className="crm-handoff-blocked">
                              {blockingDivergences.length} divergência(s) bloqueante(s) — a emissão da OS fica recusada até a decisão.
                            </p>
                          )}
                        </div>
                      </li>
                    </ol>
                  </div>
                )}
              </Section>

              <Section title="Divergências" count={openDivergences.length} note="Quando duas fontes discordam, quem decide é uma pessoa.">
                {restricted ? <SectionRestricted permission="contracts.view" /> : openDivergences.length === 0 ? (
                  <SectionEmpty>Nenhuma divergência em aberto.</SectionEmpty>
                ) : (
                  <ul className="crm-divergence-list">
                    {openDivergences.map((d) => (
                      <li key={d.id} className={`crm-divergence-${d.severity.toLowerCase()}`}>
                        <AlertOctagon size={14} aria-hidden />
                        <div className="min-w-0">
                          <strong>{divergenceScopeLabels[d.scope]} · {divergenceSeverityLabels[d.severity]}</strong>
                          <p className="crm-muted">{d.summary}</p>
                          <p className="crm-muted">{d.left_source_kind}: {d.left_value ?? "—"} · {d.right_source_kind}: {d.right_value ?? "—"}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              <Section title="Documentos" count={data.documents.length} note="O mesmo arquivo canônico do resto da plataforma — nenhuma cópia.">
                {restricted ? <SectionRestricted permission="contracts.view" /> : data.documents.length === 0 ? (
                  <SectionEmpty>Nenhum PDF anexado às revisões desta proposta.</SectionEmpty>
                ) : (
                  <ul className="crm-linked-list">
                    {data.documents.map((d) => {
                      const member = ctx.members.find((m) => m.revisions.some((r) => r.document_id === d.id));
                      return (
                        <li key={d.id}>
                          <FileText size={14} aria-hidden />
                          <div className="min-w-0">
                            <strong>{member && <DocTag role={ROLE[member.proposal.kind]} />} {d.title}</strong>
                            <p className="crm-muted">{d.document_type} · {d.status} · {formatMoment(d.created_at)}</p>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Section>

              <Section title="Follow-ups" count={data.followups.filter((f) => !["COMPLETED", "CANCELLED"].includes(f.state)).length}
                action={canManage && onComposeFollowup ? (
                  <HudButton variant="secondary" size="sm" onClick={() => onComposeFollowup({ id: primary.proposal.id, label: `${headerLabel} · ${ctx.title}` })}>
                    <CalendarPlus size={14} aria-hidden /> Agendar
                  </HudButton>
                ) : undefined}>
                {data.followups.length === 0 ? <SectionEmpty>Nenhum acompanhamento sobre esta proposta.</SectionEmpty> : (
                  <ul className="crm-followup-list">
                    {data.followups.map((f) => (
                      <li key={f.id}>
                        <div className="min-w-0">
                          <strong>{f.goal}</strong>
                          <p className="crm-muted">{f.responsible_text || "Sem responsável"} · {f.due_date ? `prazo ${day(f.due_date)}` : "sem prazo"}</p>
                        </div>
                        <StatePill tone={f.state === "COMPLETED" ? "success" : "neutral"}>{FOLLOWUP_STATE_LABEL[f.state] ?? f.state}</StatePill>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </FlowTabPanel>
          )}

          {tab === "activity" && (
            <FlowTabPanel label="Atividade">
              <Section title="Linha do tempo" note="Carimbos das revisões de PT e PC e da emissão — nenhum registro criado só para esta lista.">
                <Timeline entries={timeline} />
              </Section>
            </FlowTabPanel>
          )}
        </div>
      </HudDrawer>

      {linking && (
        <OpportunityForProposalModal
          ctx={ctx}
          primaryId={primary.proposal.id}
          initialMode={linking}
          allowed={permissionsLoading ? null : canManage && canManageProposals}
          onClose={() => setLinking(null)}
          onLinked={() => { setLinking(null); refresh(); }}
        />
      )}
      {closing && (
        <ExecutionStartPanel proposalId={primary.proposal.id} opportunityId={opportunityId}
          initialMode={closing} onClose={() => setClosing(null)} onDone={refresh} />
      )}
      {outcome && (
        <RecordOutcomeModal revisionId={outcome.id} revisionNumber={outcome.revision}
          packageLabel={ctx.members.length > 1 ? `pacote ${packageLabel}` : undefined}
          onClose={() => { setOutcome(null); refresh(); }} />
      )}
    </>
  );
}

const SOURCE_LABEL: Record<string, string> = {
  signed_document: "Documento assinado", customer_email: "E-mail do cliente", customer_portal: "Portal do cliente",
  purchase_order: "Pedido de compra", meeting_minutes: "Ata de reunião", integration: "Integração",
};
const ORIGIN_LABEL: Record<string, string> = {
  package: "Resposta ao pacote", revision_outcome: "Registro por revisão / fechamento", backfill: "Anterior ao contexto (backfill)",
};

/**
 * "Qual pacote exato o cliente aceitou?" — a linha do livro, documento a
 * documento, com evidência, quem registrou e quando. Se o pacote de hoje não
 * é o aceito, a tela diz o que mudou e NÃO trata o novo como aceito.
 */
function AcceptancePanel({ pkg, owners }: { pkg: PackageAcceptance; owners: Record<string, string> }) {
  const r = pkg.record;
  const tone: Tone = pkg.state === "ACCEPTED" ? "success" : pkg.state === "NONE" ? "neutral" : "danger";
  const label = { ACCEPTED: "Pacote aceito", PARTIAL: "Aceite parcial — não vale para o pacote",
    CHANGED: "Pacote mudou depois do aceite", NONE: "Sem aceite" }[pkg.state];
  return (
    <section className="pc-acceptance" data-testid="proposal-acceptance" data-state={pkg.state}>
      <header>
        <div className="min-w-0">
          <span className="pc-eyebrow">Aceite do cliente</span>
          <h4>{pkg.state === "ACCEPTED" ? "O cliente aceitou exatamente este pacote." : "O pacote atual não está aceito."}</h4>
        </div>
        <StatePill tone={tone}>{label}</StatePill>
      </header>
      {r ? (
        <div className="pc-acceptance-body">
          <div className="pc-acceptance-docs" aria-label="Pacote aceito">
            {pkg.accepted.map((x) => (
              <span key={x.revisionId} className="pc-review-doc">
                <DocTag role={ROLE[x.kind]} /> {rl(x.revision)}
                <small>{x.status === "ACCEPTED" ? "aceita" : `${(x.status ?? "—").toLowerCase()} — não aceita`}</small>
              </span>
            ))}
          </div>
          <div className="pc-kv-row">
            <KeyValue label="Evidência" value={SOURCE_LABEL[r.acceptance_source ?? ""] ?? r.acceptance_source ?? "—"}
              hint={r.acceptance_external_ref ?? undefined} />
            <KeyValue label="Registrado por" value={r.recorded_by ? owners[r.recorded_by] ?? "Usuário da organização" : "—"}
              hint={ORIGIN_LABEL[r.origin] ?? r.origin} />
            <KeyValue label="Quando" value={formatMoment(r.accepted_at)} />
          </div>
          {pkg.differences.length > 0 && (
            <ul className="pc-checks" aria-label="O que mudou">
              {pkg.differences.map((d) => (
                <li key={d} data-ok="false" data-blocking="true"><AlertOctagon size={13} aria-hidden /><div><span>{d}</span></div></li>
              ))}
            </ul>
          )}
          {pkg.state !== "ACCEPTED" && (
            <p className="pc-small pc-warn">
              Nenhuma revisão nova herda aceite. Leve o pacote atual ao cliente e registre a resposta com evidência.
            </p>
          )}
        </div>
      ) : (
        <p className="pc-small pc-muted" style={{ padding: "0 16px 14px" }}>
          {pkg.state === "PARTIAL" ? "Um documento foi aceito e outro não — o pacote não está aceito." : "O pacote está aceito pela regra do contexto."}
        </p>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------------ */

function Answer({ q, a, d, tone }: { q: string; a: string; d: string; tone?: "success" | "warning" | "danger" }) {
  return (
    <div className="pc-answer">
      <span>{q}</span>
      <strong className={tone ? `crm-tone-${tone}` : undefined}>{a}</strong>
      <small>{d}</small>
    </div>
  );
}

function DocumentCard({ member, role, governs }: { member: Member; role: DocRole; governs: string }) {
  const g = member.governing;
  return (
    <div className="pc-doc" data-testid={`proposal-doc-${role === "PT" ? "pt" : role === "PC" ? "pc" : "combined"}`}>
      <div className="pc-doc-head">
        <DocTag role={role} />
        <strong>{member.proposal.proposal_number}</strong>
        {g && <span className="pc-rev-chip">{rl(g.revision)}</span>}
      </div>
      <div className="pc-doc-meta">
        {g ? <StatePill tone={REVISION_TONE(g.status)}>{proposalStatusLabels[g.status]}</StatePill> : <span className="pc-muted">Sem revisão</span>}
        <span className={g?.document_id ? "pc-muted" : "pc-warn"}>
          <FileText size={11} aria-hidden /> {g?.document_id ? "PDF" : "Sem PDF"}
        </span>
        <span className="pc-muted">{member.revisions.length} rev.</span>
      </div>
      <small className="pc-muted">Rege: {governs}</small>
    </div>
  );
}

function MissingDocumentCard({ role }: { role: DocRole }) {
  return (
    <div className="pc-doc pc-doc-missing">
      <div className="pc-doc-head"><DocTag role={role} /><strong>{role === "PT" ? "Sem proposta técnica" : "Sem proposta comercial"}</strong></div>
      <small className="pc-muted">
        {role === "PT" ? "Escopo e entregáveis ficam sem documento que os governe." : "Sem PC não há valor governante para aprovar ou enviar."}
      </small>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Aprovação interna — o pacote exato que vai ao cliente                     */
/* ------------------------------------------------------------------------ */

type Check = { label: string; ok: boolean; blocking: boolean; detail?: string };

function ApprovalWorkspace({
  ctx, facts, factKind, crossFacts, cross, owners, blockingDivergences,
  canManage, canApprove, canRecordOutcome, busy, onTransition, onRecordOutcome, onRevise,
}: {
  ctx: Ctx;
  facts: FactRow[];
  factKind: (f: FactRow) => ProposalKind | null;
  crossFacts: FactLike[];
  cross: { technical: RevisionLike | null; commercial: RevisionLike | null };
  owners: Record<string, string>;
  blockingDivergences: number;
  canManage: boolean;
  canApprove: boolean;
  canRecordOutcome: boolean;
  busy: string | null;
  onTransition: (to: "INTERNAL_REVIEW" | "INTERNALLY_APPROVED" | "SENT" | "DRAFT") => void;
  onRecordOutcome: () => void;
  onRevise: () => void;
}) {
  const pt = ctx.technical ?? ctx.combined;
  const pc = ctx.commercial ?? ctx.combined;
  const of = (member: Member | null, domains: FactDomain[]) => facts.filter((f) =>
    domains.includes(f.fact_domain) && f.confirmation_state !== "REJECTED"
    && (!member || factKind(f) === member.proposal.kind || factKind(f) === null));
  const today = new Date().toISOString().slice(0, 10);
  const pcGov = pc?.governing ?? null;
  const pay = structurePaymentTerms(pcGov?.payment_terms, pcGov?.total_value);

  const checks: Check[] = [
    ...ctx.members.map((m) => ({
      label: `${ROLE[m.proposal.kind]} ${rl(m.latest?.revision)} com PDF`, ok: Boolean(m.latest?.document_id), blocking: true,
      detail: m.latest?.document_id ? undefined : "Aprove o documento, não um rascunho sem arquivo.",
    })),
    { label: "Valor governante na PC", ok: Boolean(pc && pc.latest?.total_value !== null && pc.latest?.total_value !== undefined), blocking: true,
      detail: pc ? undefined : "Não há proposta comercial neste contexto." },
    { label: "Validade declarada e vigente", ok: Boolean(ctx.validityUntil && ctx.validityUntil >= today), blocking: false,
      detail: ctx.validityUntil ? (ctx.validityUntil < today ? "Validade vencida — revise antes de enviar." : undefined) : "Sem validade, o aceite fica sem prazo." },
    { label: "Condição de pagamento estruturada", ok: pay.installments.length > 0 ? pay.complete !== false : Boolean(pay.original), blocking: false,
      detail: !pay.original ? "Não declarada." : pay.complete === false ? `Parcelas somam ${pay.percentTotal}%.` : undefined },
    { label: "Sem divergência bloqueante", ok: blockingDivergences === 0, blocking: true },
    { label: "Fatos lidos confirmados", ok: facts.every((f) => f.confirmation_state !== "UNCONFIRMED"), blocking: false,
      detail: `${facts.filter((f) => f.confirmation_state === "UNCONFIRMED").length} aguardando confirmação no dossiê.` },
  ];
  const blockers = checks.filter((c) => c.blocking && !c.ok);
  const approvals = ctx.members.map((m) => m.latest).filter((r): r is RevisionRow => Boolean(r?.internally_approved_at));
  const state = ctx.internalApproval;
  const stage = ctx.stage;

  let actions: ReactNode = null;
  if ((state === "NOT_REQUESTED" || state === "REAPPROVAL") && ctx.members.some((m) => m.latest?.status === "DRAFT")) {
    actions = (
      <HudButton variant="primary" size="sm" disabled={!canManage || blockers.length > 0 || Boolean(busy)}
        onClick={() => onTransition("INTERNAL_REVIEW")} data-testid="proposal-request-approval"
        title={!canManage ? "Exige commercial.proposals.manage." : blockers.length ? "Resolva os bloqueios acima." : undefined}>
        <Send size={13} aria-hidden /> {busy === "INTERNAL_REVIEW" ? "Enviando…" : "Enviar para aprovação interna"}
      </HudButton>
    );
  } else if (state === "PENDING" || (state === "REAPPROVAL" && ctx.members.some((m) => m.latest?.status === "INTERNAL_REVIEW"))) {
    actions = (
      <>
        <HudButton variant="ghost" size="sm" disabled={!canManage || Boolean(busy)} onClick={() => onTransition("DRAFT")}>
          <Undo2 size={13} aria-hidden /> Devolver para ajuste
        </HudButton>
        <HudButton variant="primary" size="sm" disabled={!canApprove || blockers.length > 0 || Boolean(busy)}
          onClick={() => onTransition("INTERNALLY_APPROVED")} data-testid="proposal-approve"
          title={!canApprove ? "Exige a alçada commercial.proposals.approve_internal." : undefined}>
          <ShieldCheck size={13} aria-hidden /> {busy === "INTERNALLY_APPROVED" ? "Aprovando…" : "Aprovar para envio"}
        </HudButton>
      </>
    );
  } else if (stage === "APPROVED_FOR_SEND" || (state === "APPROVED" && ctx.members.some((m) => m.latest?.status === "INTERNALLY_APPROVED"))) {
    actions = (
      <HudButton variant="primary" size="sm" disabled={!canManage || Boolean(busy)} onClick={() => onTransition("SENT")}
        data-testid="proposal-mark-sent">
        <Send size={13} aria-hidden /> Marcar pacote como enviado ao cliente
      </HudButton>
    );
  } else if (stage === "WITH_CUSTOMER" || stage === "NEGOTIATION") {
    actions = (
      <>
        <HudButton variant="ghost" size="sm" onClick={onRevise}>
          <FilePlus2 size={13} aria-hidden /> Cliente pediu mudança
        </HudButton>
        {canRecordOutcome && (
          <HudButton variant="primary" size="sm" onClick={onRecordOutcome}>Registrar resposta do cliente</HudButton>
        )}
      </>
    );
  }

  const question = stage === "ACCEPTED" ? "Aceita pelo cliente — o pacote aprovado virou compromisso."
    : state === "APPROVED" && (stage === "WITH_CUSTOMER" || stage === "NEGOTIATION") ? "O pacote aprovado está com o cliente."
    : "Este pacote exato PT/PC está autorizado a ir ao cliente?";

  return (
    <section className="pc-approval" data-testid="proposal-approval" data-state={state}>
      <header>
        <div className="min-w-0">
          <span className="pc-eyebrow">Aprovação interna</span>
          <h4>{question}</h4>
          <p className="pc-muted">Decisão de quem tem alçada sobre o que será enviado — não é análise da Apex. Revisão nova exige reaprovação.</p>
        </div>
        <StatePill tone={state === "APPROVED" ? "success" : state === "PENDING" || state === "REAPPROVAL" ? "warning" : "neutral"}>
          {INTERNAL_APPROVAL_LABEL[state]}
        </StatePill>
      </header>

      <div className="pc-approval-grid">
        <ApprovalBlock title="Técnico" role={pt ? ROLE[pt.proposal.kind] : "PT"} sub={pt?.governing ? `${pt.proposal.proposal_number} · ${rl(pt.governing.revision)}` : "Sem PT"}>
          <Label>Escopo</Label>
          <ChunkedText text={pt?.governing?.scope_summary ?? of(pt, ["SCOPE"]).map((f) => f.value_text ?? f.label).join("\n")} max={4} empty="Escopo não registrado." />
          <FactBullets title="Entregáveis" rows={of(pt, ["DELIVERABLE", "MILESTONE"])} />
          <FactBullets title="Premissas e dependências" rows={of(pt, ["REQUIREMENT", "DEPENDENCY"])} />
          <FactBullets title="Exclusões" rows={of(pt, ["EXCLUSION"])} />
          <FactBullets title="Riscos técnicos" rows={of(pt, ["RISK", "TEST"])} />
        </ApprovalBlock>

        <ApprovalBlock title="Comercial" role={pc ? ROLE[pc.proposal.kind] : "PC"} sub={pcGov ? `${pc!.proposal.proposal_number} · ${rl(pcGov.revision)}` : "Sem PC"}>
          <div className="pc-kv-row">
            <KeyValue label="Valor" value={pcGov?.total_value != null ? brl(pcGov.total_value, pcGov.currency ?? ctx.currency) : "—"} tone="accent" />
            <KeyValue label="Validade" value={day(pcGov?.validity_until ?? ctx.validityUntil)} />
            <KeyValue label="Pagamento" value={paymentSummary(pay)} />
          </div>
          <Label>Parcelas</Label>
          <PaymentSchedule text={pcGov?.payment_terms} total={pcGov?.total_value} currency={pcGov?.currency ?? ctx.currency} compact />
          <FactBullets title="Medição e faturamento" rows={of(pc, ["MEASUREMENT_RULE", "BILLING_MILESTONE", "BILLING_PREREQUISITE"])} />
        </ApprovalBlock>

        <ApprovalBlock title="Consistência" sub="PT × PC">
          <TechnicalCommercialCheck technical={cross.technical} commercial={cross.commercial} facts={crossFacts}
            technicalLabel={ctx.technical?.proposal.proposal_number ?? "PT"} commercialLabel={ctx.commercial?.proposal.proposal_number ?? "PC"} />
        </ApprovalBlock>

        <ApprovalBlock title="Governança" sub="Alçadas e condições">
          <ul className="pc-checks">
            {checks.map((c) => (
              <li key={c.label} data-ok={c.ok} data-blocking={c.blocking}>
                {c.ok ? <CheckCircle2 size={13} aria-hidden /> : c.blocking ? <AlertOctagon size={13} aria-hidden /> : <CircleDashed size={13} aria-hidden />}
                <div><span>{c.label}</span>{!c.ok && c.detail && <small>{c.detail}</small>}</div>
              </li>
            ))}
          </ul>
          <Label>Alçada exigida</Label>
          <p className="pc-small">
            Aprovar exige <code>commercial.proposals.approve_internal</code>{canApprove ? " — você tem." : " — você não tem; outra pessoa aprova."}
          </p>
          {approvals.length > 0 && (
            <>
              <Label>Aprovações registradas</Label>
              <ul className="pc-approvals">
                {approvals.map((r) => {
                  const m = ctx.members.find((x) => x.proposal.id === r.proposal_id)!;
                  return (
                    <li key={r.id}>
                      <DocTag role={ROLE[m.proposal.kind]} /> {rl(r.revision)} · {r.internally_approved_by ? owners[r.internally_approved_by] ?? "Usuário da organização" : "—"} · {day(r.internally_approved_at ?? null)}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </ApprovalBlock>
      </div>

      {(actions || blockers.length > 0) && (
        <footer>
          <p className={blockers.length ? "pc-warn" : "pc-muted"}>
            {blockers.length
              ? `Antes de aprovar: ${blockers.map((b) => b.label.toLowerCase()).join("; ")}.`
              : state === "REAPPROVAL" ? "Há revisão nova depois do envio: o pacote volta à aprovação antes de ir ao cliente."
              : "PT e PC andam juntas: ou o pacote todo avança, ou nada muda."}
          </p>
          <div className="flex flex-wrap gap-2">{actions}</div>
        </footer>
      )}
    </section>
  );
}

function ApprovalBlock({ title, role, sub, children }: { title: string; role?: DocRole; sub?: string; children: ReactNode }) {
  return (
    <div className="pc-block">
      <div className="pc-block-head">
        <span className="pc-eyebrow">{title}</span>
        {role && <DocTag role={role} />}
        {sub && <small className="pc-muted">{sub}</small>}
      </div>
      {children}
    </div>
  );
}

const Label = ({ children }: { children: ReactNode }) => <p className="pc-label">{children}</p>;

function FactBullets({ title, rows }: { title: string; rows: FactRow[] }) {
  if (!rows.length) return null;
  return (
    <>
      <Label>{title}</Label>
      <ul className="pc-bullets">
        {rows.slice(0, 6).map((f) => (
          <li key={f.id}>
            <span>{f.corrected_value ?? f.value_text ?? f.label}</span>
            {f.source_page ? <Provenance>Apex · p.{f.source_page}</Provenance> : null}
          </li>
        ))}
        {rows.length > 6 && <li className="pc-muted">+{rows.length - 6} no dossiê de fatos</li>}
      </ul>
    </>
  );
}

/* ------------------------------------------------------------------------ */
/* Revisões — PT e PC independentes, no mesmo contexto                      */
/* ------------------------------------------------------------------------ */

function RevisionLane({
  member, currency, owners, canManage, busy, primary, onRevise, onRefresh,
}: {
  member: Member; currency: string; owners: Record<string, string>; canManage: boolean;
  busy: string | null; primary: boolean; onRevise: () => void; onRefresh: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const role = ROLE[member.proposal.kind];
  const latest = member.latest;
  const canRevise = canManage && Boolean(latest) && !["ACCEPTED", "WITHDRAWN", "SUPERSEDED"].includes(latest?.status ?? "");
  return (
    <section className="pc-lane" data-testid={`revision-lane-${role === "PT" ? "pt" : role === "PC" ? "pc" : "combined"}`}>
      <header>
        <div className="min-w-0">
          <span className="pc-lane-title"><DocTag role={role} /> {KIND_LABEL[member.proposal.kind]}</span>
          <small className="pc-muted">{member.proposal.proposal_number} · rege {rl(member.governing?.revision)}</small>
        </div>
        <HudButton variant={confirm ? "primary" : "secondary"} size="sm" disabled={!canRevise || busy === `revise:${member.proposal.id}`}
          onClick={() => { if (confirm) { setConfirm(false); onRevise(); } else setConfirm(true); }}
          data-testid={primary ? "proposal-new-revision" : undefined}
          title={canRevise ? undefined : canManage ? "A revisão corrente não admite nova revisão." : "Exige commercial.proposals.manage."}>
          <FilePlus2 size={13} aria-hidden />
          {confirm ? `Confirmar ${role} ${rl((latest?.revision ?? 0) + 1)}` : "Nova revisão"}
        </HudButton>
      </header>
      <div className="pc-rev-list">
        {member.revisions.map((r) => (
          <RevisionCard key={r.id} revision={r} role={role} kind={member.proposal.kind} governing={r.id === member.governing?.id}
            currency={r.currency ?? currency} owners={owners} proposalId={member.proposal.id}
            canManage={canManage} onRefresh={onRefresh} />
        ))}
      </div>
    </section>
  );
}

function RevisionCard({
  revision: r, role, kind, governing, currency, owners, proposalId, canManage, onRefresh,
}: {
  revision: RevisionRow; role: DocRole; kind: ProposalKind; governing: boolean; currency: string;
  owners: Record<string, string>; proposalId: string; canManage: boolean; onRefresh: () => void;
}) {
  const [open, setOpen] = useState(governing);
  const pay = structurePaymentTerms(r.payment_terms, r.total_value);
  const isTech = kind === "TECHNICAL";
  return (
    <article className="pc-rev" data-governing={governing} data-testid="revision-card">
      <header>
        <div className="pc-rev-id">
          <strong>{role} {rl(r.revision)}</strong>
          <span className={governing ? "pc-rev-role pc-rev-role-governing" : "pc-rev-role"}>
            {governing ? "Regente" : r.status === "SUPERSEDED" ? "Histórico" : r.status === "DRAFT" ? "Rascunho" : "Não regente"}
          </span>
        </div>
        <StatePill tone={REVISION_TONE(r.status)}>{proposalStatusLabels[r.status]}</StatePill>
      </header>
      <div className="pc-rev-figures">
        <KeyValue label="Valor" value={isTech ? "—" : brl(r.total_value, currency)} hint={isTech ? "Rege a PC" : undefined} />
        <KeyValue label="Validade" value={day(r.validity_until)} />
        <KeyValue label="Pagamento" value={isTech ? "—" : paymentSummary(pay)} />
        <KeyValue label="PDF" value={r.document_id ? <span className="pc-ok"><FileText size={12} aria-hidden /> Anexado</span> : <span className="pc-warn">Sem PDF</span>} />
      </div>
      {(r.scope_summary || (!isTech && r.payment_terms)) && (
        <>
          <button type="button" className="pc-disclosure" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? "Ocultar detalhes" : isTech ? "Ver escopo" : "Ver escopo e parcelas"}
          </button>
          {open && (
            <div className="pc-rev-detail">
              {r.scope_summary && (<><p className="pc-label">Escopo técnico</p><ChunkedText text={r.scope_summary} max={4} /></>)}
              {!isTech && r.payment_terms && (<><p className="pc-label">Pagamento</p><PaymentSchedule text={r.payment_terms} total={r.total_value} currency={currency} compact /></>)}
            </div>
          )}
        </>
      )}
      {r.rejection_reason && <p className="pc-small pc-warn">Recusa: {r.rejection_reason}</p>}
      <footer>
        <span className="pc-muted">
          {r.created_at ? `Criada ${day(r.created_at)}` : ""}
          {r.internally_approved_at ? ` · aprovada ${day(r.internally_approved_at)}${r.internally_approved_by ? ` por ${owners[r.internally_approved_by] ?? "usuário"}` : ""}` : ""}
          {r.sent_at ? ` · enviada ${day(r.sent_at)}` : ""}
        </span>
        <div className="flex flex-wrap gap-2">
          {!r.document_id && canManage && !CLOSED.includes(r.status) && (
            <ProposalDocumentUpload proposalId={proposalId} revisionId={r.id} revisionLabel={`${role} ${rl(r.revision)}`} onDone={onRefresh} />
          )}
        </div>
      </footer>
    </article>
  );
}

/* ------------------------------------------------------------------------ */
/* Oportunidade — vincular existente OU criar a partir da proposta           */
/* ------------------------------------------------------------------------ */

type OpportunityOption = { id: string; title: string; counterparty_name: string; party_id: string | null; stage: OpportunityStage; currency: string };

function OpportunityForProposalModal({
  ctx, primaryId, initialMode, allowed, onClose, onLinked,
}: {
  ctx: Ctx; primaryId: string; initialMode: "link" | "create"; allowed: boolean | null;
  onClose: () => void; onLinked: () => void;
}) {
  const { success, error: notifyError } = useHudToast();
  const [mode, setMode] = useState(initialMode);
  const [options, setOptions] = useState<OpportunityOption[] | null>(null);
  const [chosen, setChosen] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const docs = ctx.members.map((m) => `${m.proposal.proposal_number} ${rl(m.governing?.revision)}`).join(" / ");
  const [form, setForm] = useState(() => ({
    title: ctx.title,
    estimated_value: ctx.value !== null ? String(ctx.value) : "",
    expected_decision_date: ctx.validityUntil ?? "",
    notes: `Criada a partir da proposta ${docs}.`,
  }));

  useEffect(() => {
    let alive = true;
    fetch("/api/commercial/opportunities").then((r) => r.json()).then((payload) => {
      if (!alive) return;
      const rows = ((payload?.opportunities ?? []) as OpportunityOption[]).filter((o) => o.stage !== "LOST" && o.stage !== "ABANDONED");
      const same = (o: OpportunityOption) => (ctx.partyId && o.party_id === ctx.partyId)
        || o.counterparty_name.trim().toLowerCase() === ctx.counterparty.trim().toLowerCase();
      setOptions([...rows.filter(same), ...rows.filter((o) => !same(o))]);
    }).catch(() => alive && setOptions([]));
    return () => { alive = false; };
  }, [ctx.partyId, ctx.counterparty]);

  const picked = options?.find((o) => o.id === chosen) ?? null;
  const accountClash = Boolean(picked && ctx.partyId && picked.party_id && picked.party_id !== ctx.partyId);
  const canSubmit = allowed && !saving && (mode === "link" ? Boolean(chosen) && !accountClash : Boolean(form.title.trim()));

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      const body = mode === "link"
        ? { opportunityId: chosen, reason: reason.trim() || null }
        : { create: { title: form.title.trim(), counterparty_name: ctx.counterparty, party_id: ctx.partyId,
            estimated_value: form.estimated_value || null, currency: ctx.currency,
            expected_decision_date: form.expected_decision_date || null, notes: form.notes.trim() || null } };
      const response = await fetch(`/api/commercial/proposals/${primaryId}/opportunity`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        if (payload?.opportunity_id) notifyError("Oportunidade criada, vínculo recusado", "Ela já aparece para vincular.");
        throw new Error(payload?.error || "Vínculo recusado.");
      }
      success(mode === "create" ? "Oportunidade criada e vinculada" : "Proposta vinculada",
        `${ctx.members.length > 1 ? "PT e PC entraram" : "A proposta entrou"} na oportunidade. Fechamento liberado.`);
      if (payload.currency_differs) notifyError("Moedas diferentes", "A proposta e a oportunidade usam moedas distintas — confira o forecast.");
      notifyCommercialChanged();
      onLinked();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  return (
    <HudModal isOpen onClose={() => { if (!saving) onClose(); }} title="Oportunidade da proposta" subtitle={`${docs} · ${ctx.counterparty}`} size="md">
      <div className="crm-flow" data-testid="link-opportunity-modal">
        {allowed === false ? (
          <UnlockHint icon={<Lock size={14} />}>
            Vincular mexe nas duas pontas do funil e exige <code>commercial.proposals.manage</code> e <code>commercial.manage</code>.
          </UnlockHint>
        ) : (
          <>
            <div className="pc-seg" role="radiogroup" aria-label="Como vincular">
              <button type="button" role="radio" aria-checked={mode === "create"} onClick={() => setMode("create")} data-testid="opportunity-mode-create">
                <Plus size={13} aria-hidden /> Criar a partir desta proposta
              </button>
              <button type="button" role="radio" aria-checked={mode === "link"} onClick={() => setMode("link")} data-testid="opportunity-mode-link">
                <Link2 size={13} aria-hidden /> Vincular existente
              </button>
            </div>

            {mode === "link" ? (
              <>
                <label className="crm-field-label">
                  <span>Oportunidade *</span>
                  <select value={chosen} onChange={(e) => setChosen(e.target.value)} data-testid="link-opportunity-select">
                    <option value="">{options ? "Escolha a oportunidade" : "Carregando…"}</option>
                    {(options ?? []).map((o) => (
                      <option key={o.id} value={o.id}>{o.title} — {o.counterparty_name} · {opportunityStageLabels[o.stage]}</option>
                    ))}
                  </select>
                </label>
                {options && options.length === 0 && (
                  <p className="crm-field-hint">
                    Nenhuma oportunidade viva.{" "}
                    <button type="button" className="pc-link" onClick={() => setMode("create")}>Criar a partir desta proposta</button>
                  </p>
                )}
                {accountClash && (
                  <p className="crm-flow-error" role="status"><AlertOctagon size={14} aria-hidden /> Esta oportunidade é de outra conta — o vínculo será recusado.</p>
                )}
                <label className="crm-field-label">
                  <span>Motivo (fica no histórico)</span>
                  <textarea value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)}
                    placeholder="Ex.: proposta importada antes de a oportunidade ser criada" />
                </label>
              </>
            ) : (
              <div className="pc-create" data-testid="opportunity-create-form">
                <div className="pc-create-prefill">
                  <KeyValue label="Cliente" value={ctx.counterparty} hint={ctx.partyId ? "Cadastro único" : "Da proposta"} />
                  <KeyValue label="Etapa" value="Proposta" hint="A proposta já existe" />
                  <KeyValue label="Responsável" value="Você" hint="Pode ser reatribuído depois" />
                </div>
                <label className="crm-field-label"><span>Título *</span>
                  <input value={form.title} maxLength={300} onChange={(e) => setForm({ ...form, title: e.target.value })} data-testid="opportunity-create-title" /></label>
                <div className="crm-flow-grid">
                  <label className="crm-field-label"><span>Valor estimado ({ctx.currency})</span>
                    <input type="number" min={0} step="0.01" value={form.estimated_value} onChange={(e) => setForm({ ...form, estimated_value: e.target.value })} /></label>
                  <label className="crm-field-label"><span>Decisão esperada</span>
                    <input type="date" value={form.expected_decision_date} onChange={(e) => setForm({ ...form, expected_decision_date: e.target.value })} /></label>
                </div>
                <label className="crm-field-label"><span>Contexto comercial</span>
                  <textarea value={form.notes} maxLength={2000} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
                <p className="pc-small pc-muted">
                  Próxima ação sugerida: <strong>{contextNextAction(ctx as unknown as ProposalContext)}</strong>. Valor e decisão vêm da PC (valor e validade).
                </p>
              </div>
            )}
            <p className="crm-field-hint">
              Vincular é definitivo e fica registrado com seu nome. {ctx.members.length > 1 ? "PT e PC são vinculadas juntas." : ""}
            </p>
          </>
        )}
        {error && <p className="crm-flow-error" role="alert"><AlertOctagon size={14} aria-hidden /> {error}</p>}
        <div className="crm-flow-footer">
          <p>{mode === "link" ? (chosen ? "" : "Falta: oportunidade.") : "A tela continua aberta — nada a refazer."}</p>
          <div>
            <HudButton variant="ghost" onClick={onClose} disabled={saving}>Cancelar</HudButton>
            <HudButton variant="primary" onClick={submit} disabled={!canSubmit} data-testid="link-opportunity-submit">
              {mode === "create" ? <Plus size={14} aria-hidden /> : <Link2 size={14} aria-hidden />}
              {saving ? "Salvando…" : mode === "create" ? "Criar e vincular" : "Vincular"}
            </HudButton>
          </div>
        </div>
      </div>
    </HudModal>
  );
}
