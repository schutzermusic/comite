"use client";

/**
 * O ESPAÇO DE TRABALHO de uma proposta.
 *
 * A pergunta que ele responde não é "quais propostas existem" — isso a lista já
 * responde. É "o que exatamente foi proposto, em que revisão, com base em qual
 * documento, e o que disso já virou compromisso".
 *
 * ─── As três coisas que esta tela se recusa a borrar ─────────────────────
 *
 * • REVISÃO REGENTE ≠ revisão mais recente. A aceita continua regendo mesmo com
 *   um rascunho novo em cima. A tela marca qual é, sempre.
 * • FATO LIDO ≠ regra. Um fato extraído do PDF só vira regra de medição ou
 *   condição de faturamento quando tem página e trecho literal (ANCHORED) E
 *   confirmação humana. A tela mostra os dois estados lado a lado, em vez de
 *   apresentar tudo como se fosse dado do sistema.
 * • ACEITE ≠ trabalho autorizado. O cliente aceitar é do cliente; autorizar a
 *   execução é ato interno, com outra permissão. A passagem para a OS interna
 *   aparece como etapa, não como consequência automática.
 */
import { useEffect, useMemo, useState } from "react";
import {
  AlertOctagon, ArrowRight, CalendarPlus, CheckCircle2, FilePlus2, FileText, Link2, Lock, Quote, Rocket, Zap,
} from "lucide-react";
import { HudBadge, HudButton, HudDrawer, HudModal, useHudToast } from "@/components/hud";
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
import { governingRevision } from "@/lib/commercial/pipeline-signals";
import { FOLLOWUP_STATE_LABEL, type FollowupState } from "@/lib/platform/followups/types";
import { brl, day, notifyCommercialChanged, ResourceState, useCommercialResource } from "./shared";
import {
  Fact, FactGrid, Section, SectionEmpty, SectionRestricted, Timeline, formatMoment,
  type TimelineEntry,
} from "./detail";
import { FlowTabPanel, FlowTabs } from "./tabs";
import { ProposalDocumentUpload } from "./ProposalDocumentUpload";
import { RevisionComparison, TechnicalCommercialCheck } from "./ProposalCompare";
import { BlueprintView, type BlueprintRow } from "./BlueprintView";
import { ExecutionStartPanel } from "./ExecutionStartPanel";
import { ExecutionStatusBanner, type ExecutionStartSummary } from "./ExecutionStatus";
import { UnlockHint } from "./workspace";
import type { FactLike, RevisionLike } from "@/lib/commercial/proposal-compare";

type ProposalTab = "summary" | "revisions" | "facts" | "execution" | "activity";

const KIND_LABEL: Record<ProposalKind, string> = {
  TECHNICAL: "Proposta técnica",
  COMMERCIAL: "Proposta comercial",
  COMBINED: "Técnica + Comercial",
};

/**
 * Os domínios de fato que a tela agrupa.
 *
 * A separação é a mesma do §2 e da própria extração: a proposta TÉCNICA
 * responde "o que será feito" e a COMERCIAL responde "por quanto e sob qual
 * condição". Misturá-las numa lista só obrigaria quem revisa a triar
 * mentalmente vinte itens para achar a regra de medição.
 */
const FACT_GROUPS: Array<{ id: string; label: string; note: string; domains: FactDomain[] }> = [
  {
    id: "commercial",
    label: "Condições comerciais",
    note: "Valor, condição de pagamento, medição e faturamento.",
    domains: ["VALUE", "RATE", "UNIT_PRICE", "PAYMENT_TERM", "MEASUREMENT_RULE",
      "BILLING_MILESTONE", "BILLING_PREREQUISITE", "VALIDITY", "ACCEPTANCE_CONDITION"],
  },
  {
    id: "technical",
    label: "Escopo técnico",
    note: "O que será entregue, o que está excluído e do que depende.",
    domains: ["SCOPE", "DELIVERABLE", "REQUIREMENT", "EXCLUSION", "DEPENDENCY",
      "TEST", "DOCUMENT", "DATE", "MILESTONE", "RESOURCE"],
  },
  {
    id: "other",
    label: "Outros fatos",
    note: "Riscos e itens que não se enquadram nos dois grupos acima.",
    domains: ["RISK", "OTHER"],
  },
];

type ProposalRow = {
  id: string; opportunity_id: string | null; proposal_number: string; kind: ProposalKind;
  title: string; counterparty_name: string; party_id: string | null; currency: string;
  owner_user_id: string | null; created_at: string;
};
type RevisionRow = {
  id: string; proposal_id: string; revision: number; status: ProposalRevisionStatus;
  total_value: string | null; currency: string | null; validity_until: string | null;
  payment_terms: string | null; scope_summary: string | null;
  acceptance_conditions: string | null; document_id: string | null;
  internal_review_at: string | null; internally_approved_at: string | null;
  internally_approved_by: string | null; sent_at: string | null; sent_by: string | null;
  negotiation_at: string | null; accepted_at: string | null; acceptance_source: string | null;
  acceptance_document_id: string | null; acceptance_external_ref: string | null;
  acceptance_note: string | null; recorded_by: string | null; rejected_at: string | null;
  rejection_reason: string | null; expired_at: string | null; withdrawn_at: string | null;
  superseded_at: string | null; supersedes_id: string | null; superseded_by_id: string | null;
  created_by: string | null; created_at: string;
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
  due_date: string | null; next_expected_event: string | null;
  next_expected_event_at: string | null; responsible_text: string | null; created_at: string;
};
type DocumentRow = {
  id: string; title: string; file_path: string; document_type: string;
  status: string; created_at: string;
};
type AuthorizationRow = {
  id: string; engagement_id: string; source_kind: string; proposal_revision_id: string | null;
  authorized_value: string | null; currency: string | null; effective_from: string | null;
  effective_until: string | null; governing: boolean; state: string;
};
type EngagementRow = {
  id: string; engagement_number: string | null; title: string; status: EngagementStatus;
  authorized_value: string | null; currency: string; authorized_at: string | null;
};
type ServiceOrderRow = {
  id: string; engagement_id: string; os_number: string; title: string; origin: string;
  status: ServiceOrderStatus; authorized_value: string | null; currency: string | null;
  project_id: string | null; source_proposal_revision_id: string | null;
  issued_at: string | null; created_at: string;
};
type DivergenceRow = {
  id: string; engagement_id: string; service_order_id: string | null; scope: DivergenceScope;
  field_path: string | null; left_source_kind: string; left_value: string | null;
  right_source_kind: string; right_value: string | null; severity: DivergenceSeverity;
  summary: string; detected_by: string; state: string; resolved_source_kind: string | null;
};

type Payload = {
  proposal: ProposalRow;
  revisions: RevisionRow[];
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
  siblings?: Array<{ id: string; proposal_number: string; kind: ProposalKind; title: string; currency: string }>;
  siblingRevisions?: Array<RevisionLike & { proposal_id: string }>;
  siblingFacts?: FactLike[];
  blueprints?: BlueprintRow[];
  executionStart?: ExecutionStartSummary | null;
};

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
  const { data, state, message, refresh } = useCommercialResource<Payload>(
    `/api/commercial/proposals/${proposalId}`,
  );
  const { hasPermission, loading: permissionsLoading } = usePermissions();
  const canManage = hasPermission("commercial.manage");
  const canManageProposals = hasPermission("commercial.proposals.manage");
  const canStart = hasPermission("commercial.execution.start");
  const canStartExceptional = hasPermission("commercial.execution.start_exceptional");
  const canRegularize = hasPermission("commercial.engagements.manage");
  const [tab, setTab] = useState<ProposalTab>("summary");
  const [closing, setClosing] = useState<null | "STANDARD" | "EXCEPTIONAL">(null);
  const [linking, setLinking] = useState(false);
  const [revising, setRevising] = useState<"idle" | "confirm" | "busy">("idle");
  const { success, error: notifyError } = useHudToast();

  const governing = useMemo(() => {
    if (!data) return null;
    return governingRevision(data.revisions).get(proposalId) ?? null;
  }, [data, proposalId]);

  const timeline = useMemo<TimelineEntry[]>(() => {
    if (!data) return [];
    const owner = (id: string | null) => (id ? (data.owners[id] ?? "Registrado por usuário da organização") : null);
    const entries: TimelineEntry[] = [];
    for (const revision of data.revisions) {
      const label = `R${String(revision.revision).padStart(2, "0")}`;
      const push = (
        at: string | null, title: string, detail?: string | null,
        actor?: string | null, tone?: TimelineEntry["tone"],
      ) => {
        if (!at) return;
        entries.push({ id: `${title}-${revision.id}`, at, title, detail, actor, tone });
      };
      push(revision.created_at, `${label} criada`, null, owner(revision.created_by));
      push(revision.internal_review_at, `${label} em revisão interna`);
      push(revision.internally_approved_at, `${label} aprovada internamente`, null,
        owner(revision.internally_approved_by));
      push(revision.sent_at, `${label} enviada ao cliente`, null, owner(revision.sent_by), "accent");
      push(revision.negotiation_at, `${label} em negociação`);
      push(revision.accepted_at, `${label} aceita pelo cliente`,
        `Manifestação: ${revision.acceptance_source ?? "não informada"}${revision.acceptance_external_ref ? ` · ref. ${revision.acceptance_external_ref}` : ""}`,
        owner(revision.recorded_by), "success");
      push(revision.rejected_at, `${label} recusada`, revision.rejection_reason, null, "danger");
      push(revision.expired_at, `${label} expirada`, null, null, "danger");
      push(revision.withdrawn_at, `${label} retirada`);
      push(revision.superseded_at, `${label} substituída por revisão posterior`);
    }
    for (const order of data.serviceOrders) {
      if (order.issued_at) {
        entries.push({
          id: `os-${order.id}`, at: order.issued_at,
          title: `OS ${order.os_number} emitida`, tone: "success",
        });
      }
    }
    return entries.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
  }, [data]);

  if (state !== "ready" || !data) {
    return (
      <HudDrawer isOpen onClose={onClose} title="Proposta" width="760px" density="compact">
        <ResourceState state={state} message={message} />
      </HudDrawer>
    );
  }

  const p = data.proposal;
  const restricted = data.executionVisibility === "restricted";
  const accepted = data.revisions.find((r) => r.status === "ACCEPTED") ?? null;
  const openDivergences = data.divergences.filter((d) => d.state === "OPEN");
  const blockingDivergences = openDivergences.filter((d) => d.severity === "BLOCKING");
  const allFacts = [...data.facts, ...(data.siblingFacts ?? [])] as unknown as FactLike[];
  /*
    O PAR técnica/comercial desta proposta: ela mesma de um lado, a irmã da
    mesma oportunidade do outro. Proposta combinada é as duas ao mesmo tempo
    — e aí não há cruzamento a fazer.
  */
  const siblingGoverning = governingRevision(data.siblingRevisions ?? []);
  const sibling = (kind: "TECHNICAL" | "COMMERCIAL") =>
    (data.siblings ?? []).find((x) => x.kind === kind && siblingGoverning.get(x.id));
  const selfRevision = governing as unknown as RevisionLike | null;
  const pair = p.kind === "TECHNICAL"
    ? { technical: selfRevision, technicalLabel: p.proposal_number,
        commercial: (sibling("COMMERCIAL") && siblingGoverning.get(sibling("COMMERCIAL")!.id)) ?? null,
        commercialLabel: sibling("COMMERCIAL")?.proposal_number ?? "PC" }
    : p.kind === "COMMERCIAL"
      ? { commercial: selfRevision, commercialLabel: p.proposal_number,
          technical: (sibling("TECHNICAL") && siblingGoverning.get(sibling("TECHNICAL")!.id)) ?? null,
          technicalLabel: sibling("TECHNICAL")?.proposal_number ?? "PT" }
      : { technical: null, commercial: null, technicalLabel: "PT", commercialLabel: "PC" };
  const tabs = [
    { id: "summary", label: "Resumo" },
    { id: "revisions", label: "Revisões", count: data.revisions.length },
    { id: "facts", label: "Fatos e blueprint", count: data.facts.length },
    { id: "execution", label: "Execução", count: blockingDivergences.length || openDivergences.length,
      alert: blockingDivergences.length > 0 },
    { id: "activity", label: "Atividade" },
  ];
  const governingHasPdf = Boolean(governing?.document_id);
  const anchoredFacts = data.facts.filter((f) => f.provenance_state === "ANCHORED").length;
  const confirmedFacts = data.facts.filter((f) => f.confirmation_state === "CONFIRMED" || f.confirmation_state === "CORRECTED").length;
  const pendingFacts = data.facts.filter((f) => f.confirmation_state === "UNCONFIRMED").length;
  const nextStep = data.executionStart
    ? "Execução iniciada — acompanhe OS e projeto"
    : !governing ? "Criar a primeira revisão"
    : !governingHasPdf ? `Anexar o PDF da R${String(governing.revision).padStart(2, "0")}`
    : blockingDivergences.length ? `Resolver ${blockingDivergences.length} divergência(s) bloqueante(s)`
    : pendingFacts ? `Confirmar ${pendingFacts} fato(s) lido(s)`
    : ["DRAFT", "INTERNAL_REVIEW"].includes(governing.status) ? "Aprovar internamente e enviar ao cliente"
    : governing.status === "INTERNALLY_APPROVED" ? "Enviar ao cliente"
    : ["SENT", "NEGOTIATION"].includes(governing.status) ? "Registrar a resposta do cliente"
    : governing.status === "ACCEPTED" ? (p.opportunity_id ? "Fechar negócio e iniciar execução" : "Vincular a uma oportunidade")
    : "Criar nova revisão";
  const revise = async () => {
    if (!governing) return;
    if (revising === "idle") { setRevising("confirm"); return; }
    setRevising("busy");
    try {
      const response = await fetch("/api/commercial/proposals", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ revisionId: governing.id, action: "revise", payload: {} }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload?.error || "Revisão recusada.");
      success(`R${String(payload.revision).padStart(2, "0")} criada em rascunho`, "Anexe o PDF da nova revisão para comparar.");
      refresh();
    } catch (e) {
      notifyError("Nova revisão", (e as Error).message);
    } finally {
      setRevising("idle");
    }
  };
  const canRevise = canManageProposals && Boolean(governing)
    && !["WITHDRAWN", "SUPERSEDED"].includes(governing?.status ?? "");
  const reviseButton = (
    <HudButton variant={revising === "confirm" ? "primary" : "secondary"} size="sm" onClick={revise}
      disabled={!canRevise || revising === "busy"} data-testid="proposal-new-revision"
      title={canRevise ? undefined : canManageProposals ? "A revisão regente não admite revisão." : "Exige commercial.proposals.manage."}>
      <FilePlus2 size={13} aria-hidden />
      {revising === "confirm" ? `Confirmar R${String((governing?.revision ?? 0) + 1).padStart(2, "0")}` : revising === "busy" ? "Criando…" : "Nova revisão"}
    </HudButton>
  );
  const ordersFromProposal = new Set(
    data.serviceOrders.map((o) => o.source_proposal_revision_id).filter(Boolean) as string[],
  );

  return (
    <>
    <HudDrawer
      isOpen
      onClose={onClose}
      width="840px"
      density="compact"
      title={`${p.proposal_number} · ${p.title}`}
      subtitle={
        <div className="crm-drawer-subtitle">
          <HudBadge variant={governing?.status === "ACCEPTED" ? "success" : "info"} size="sm">
            {governing ? proposalStatusLabels[governing.status] : "Sem revisão"}
          </HudBadge>
          <span>{p.counterparty_name}</span>
          <span className="crm-muted">{KIND_LABEL[p.kind]}</span>
        </div>
      }
    >
      <div className="crm-detail">
        {data.executionStart && (
          <ExecutionStatusBanner
            start={data.executionStart}
            owners={data.owners}
            canRegularize={canRegularize}
            onRegularized={refresh}
          />
        )}
        {!data.executionStart && canStart && data.proposal.opportunity_id
          && governing && !["REJECTED", "WITHDRAWN", "EXPIRED", "SUPERSEDED"].includes(governing.status) && (
          <div className="flow-command" data-testid="close-deal-command">
            <p>
              <strong>{governing.status === "ACCEPTED" ? "Aceita pelo cliente." : "Com o cliente."}</strong>{" "}
              Fechar registra a base de autorização, gera a OS interna e abre o projeto — no mesmo caminho canônico.
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

        {!data.executionStart && !data.proposal.opportunity_id && (
          <UnlockHint
            tone="warning"
            icon={<Link2 size={14} />}
            testId="proposal-link-opportunity"
            action={
              <HudButton variant="secondary" size="sm" onClick={() => setLinking(true)}>
                <Link2 size={13} aria-hidden /> Vincular oportunidade
              </HudButton>
            }
          >
            <strong>Vincule esta proposta a uma oportunidade para iniciar execução.</strong>{" "}
            Sem oportunidade não há fechamento, cliente do cadastro único nem comparação PT × PC.
          </UnlockHint>
        )}
        {!data.executionStart && data.proposal.opportunity_id && governing
          && ["REJECTED", "WITHDRAWN", "EXPIRED", "SUPERSEDED"].includes(governing.status) && (
          <UnlockHint tone="warning" icon={<Rocket size={14} />}>
            A revisão regente está <strong>{proposalStatusLabels[governing.status].toLowerCase()}</strong> — para
            fechar, crie uma nova revisão e leve-a ao cliente.
          </UnlockHint>
        )}
        {!data.executionStart && !canStart && data.proposal.opportunity_id && governing
          && !["REJECTED", "WITHDRAWN", "EXPIRED", "SUPERSEDED"].includes(governing.status) && (
          <UnlockHint icon={<Lock size={14} />}>
            <strong>Fechar negócio e iniciar execução</strong> exige a alçada <code>commercial.execution.start</code>.
          </UnlockHint>
        )}

        <FactGrid>
          <Fact
            label="Revisão regente"
            value={governing ? `R${String(governing.revision).padStart(2, "0")}` : "—"}
            hint={
              governing?.status === "ACCEPTED"
                ? "Aceita — é esta que pode autorizar execução"
                : "Mais recente; nenhuma aceita ainda"
            }
            tone="accent"
          />
          <Fact
            label="Valor"
            value={brl(governing?.total_value ?? null, governing?.currency ?? p.currency)}
            hint={governing?.total_value === null ? "Não informado" : (governing?.currency ?? p.currency)}
          />
          <Fact
            label="Validade"
            value={day(governing?.validity_until ?? null)}
            hint={governing?.validity_until ? "Depois disso, o aceite exige nova revisão" : "Sem validade declarada"}
          />
          <Fact
            label="Condição de pagamento"
            value={governing?.payment_terms || "Não declarada"}
            hint="Texto do documento; a versão estruturada vive nos fatos"
          />
          <Fact
            label="Estado do aceite"
            value={accepted ? "Aceita pelo cliente" : "Sem aceite"}
            hint={
              accepted
                ? `${day(accepted.accepted_at)} · ${accepted.acceptance_source ?? "manifestação não informada"}`
                : "O aceite é do cliente e exige manifestação registrada"
            }
            tone={accepted ? "accent" : "neutral"}
          />
          <Fact
            label="Revisões"
            value={data.revisions.length}
            hint="Revisar cria a próxima; nunca edita a anterior"
          />
        </FactGrid>

        <div className="crm-command-strip" aria-label="Situação da proposta" data-testid="proposal-status-strip">
          <div className="crm-command-cell">
            <span>Existe</span>
            <strong>{data.revisions.length} revisão(ões)</strong>
            <small className={governingHasPdf ? undefined : "crm-missing"}>{governingHasPdf ? "PDF da regente anexado" : "Regente sem PDF"}</small>
          </div>
          <div className="crm-command-cell">
            <span>Apex entendeu</span>
            <strong>{data.facts.length} fato(s)</strong>
            <small>{anchoredFacts} com página e trecho</small>
          </div>
          <div className="crm-command-cell">
            <span>Confirmado</span>
            <strong className={confirmedFacts ? "crm-tone-success" : undefined}>{confirmedFacts}</strong>
            <small>{pendingFacts} aguardando confirmação</small>
          </div>
          <div className="crm-command-cell">
            <span>Em conflito</span>
            <strong className={blockingDivergences.length ? "crm-tone-danger" : openDivergences.length ? "crm-tone-warning" : undefined}>
              {restricted ? "—" : openDivergences.length}
            </strong>
            <small>{restricted ? "restrito a contratos" : `${blockingDivergences.length} bloqueante(s)`}</small>
          </div>
          <div className="crm-command-cell">
            <span>Rege</span>
            <strong className="crm-tone-accent">{governing ? `R${String(governing.revision).padStart(2, "0")}` : "—"}</strong>
            <small>{governing ? proposalStatusLabels[governing.status] : "Sem revisão"}</small>
          </div>
          <div className="crm-command-cell">
            <span>Próximo passo</span>
            <strong style={{ fontSize: 12.5 }}>{nextStep}</strong>
          </div>
        </div>

        <FlowTabs label="Seções da proposta" tabs={tabs} active={tab} onChange={(id) => setTab(id as ProposalTab)} />

        {tab === "summary" && (
          <FlowTabPanel label="Resumo">
        {governing && !governingHasPdf && (
          <UnlockHint
            tone="warning"
            icon={<FileText size={14} />}
            testId="proposal-attach-pdf"
            action={canManageProposals && !["SUPERSEDED", "WITHDRAWN"].includes(governing.status) ? (
              <ProposalDocumentUpload proposalId={p.id} revisionId={governing.id}
                revisionLabel={`R${String(governing.revision).padStart(2, "0")}`} onDone={refresh} />
            ) : undefined}
          >
            <strong>A R{String(governing.revision).padStart(2, "0")} não tem PDF.</strong> Sem o documento, a Apex não lê fatos,
            o blueprint não nasce e a comparação PT × PC fica sem base.
            {!canManageProposals && " Anexar exige commercial.proposals.manage."}
          </UnlockHint>
        )}
        {data.opportunity && (
          <Section
            title="Oportunidade de origem"
            action={
              onOpenOpportunity ? (
                <HudButton
                  variant="ghost"
                  size="sm"
                  onClick={() => onOpenOpportunity(data.opportunity!.id)}
                >
                  Abrir <ArrowRight size={13} aria-hidden />
                </HudButton>
              ) : undefined
            }
          >
            <div className="crm-account-line">
              <div className="min-w-0">
                <strong>{data.opportunity.title}</strong>
                <p className="crm-muted">
                  {opportunityStageLabels[data.opportunity.stage]} ·{" "}
                  {brl(data.opportunity.estimated_value, data.opportunity.currency)} · decisão{" "}
                  {day(data.opportunity.expected_decision_date)}
                </p>
              </div>
            </div>
          </Section>
        )}

            <Section title="Técnica × Comercial" note="O par que forma a proposta. Só o que é conferível é afirmado.">
              <TechnicalCommercialCheck
                technical={pair.technical}
                commercial={pair.commercial}
                facts={allFacts}
                technicalLabel={pair.technicalLabel}
                commercialLabel={pair.commercialLabel}
              />
            </Section>
          </FlowTabPanel>
        )}

        {tab === "revisions" && (
          <FlowTabPanel label="Revisões">
            <Section title="Comparar revisões" note="Adicionado, removido e alterado — o que é material vem primeiro."
              action={data.revisions.length >= 2 ? reviseButton : undefined}>
              {data.revisions.length < 2 ? (
                <div className="crm-section-body">
                  <UnlockHint icon={<FilePlus2 size={14} />} action={reviseButton} testId="revision-compare-locked">
                    <strong>Comparação disponível após uma nova revisão.</strong> Hoje só existe a
                    {" "}R{String(data.revisions[0]?.revision ?? 1).padStart(2, "0")}. Revisar cria a próxima — a anterior nunca é editada.
                  </UnlockHint>
                </div>
              ) : (
                <RevisionComparison revisions={data.revisions} facts={allFacts} governingId={governing?.id ?? null} label={p.proposal_number} />
              )}
            </Section>
        <Section title="Revisões" count={data.revisions.length} note="A aceita rege mesmo quando existe rascunho mais novo.">
          {data.revisions.length === 0 ? (
            <SectionEmpty>Nenhuma revisão registrada.</SectionEmpty>
          ) : (
            <ul className="crm-revision-list">
              {data.revisions.map((revision) => (
                <li
                  key={revision.id}
                  className={revision.id === governing?.id ? "crm-revision-governing" : undefined}
                >
                  <div className="min-w-0">
                    <strong>
                      R{String(revision.revision).padStart(2, "0")}
                      {revision.id === governing?.id && (
                        <HudBadge variant="primary" size="sm">Regente</HudBadge>
                      )}
                    </strong>
                    <p className="crm-muted">
                      {brl(revision.total_value, revision.currency ?? p.currency)}
                      {revision.validity_until ? ` · validade ${day(revision.validity_until)}` : ""}
                      {revision.payment_terms ? ` · ${revision.payment_terms}` : ""}
                    </p>
                    {revision.scope_summary && (
                      <p className="crm-muted">{revision.scope_summary}</p>
                    )}
                    {revision.rejection_reason && (
                      <p className="crm-muted">Recusa: {revision.rejection_reason}</p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <HudBadge
                      variant={
                        revision.status === "ACCEPTED" ? "success"
                          : revision.status === "REJECTED" || revision.status === "EXPIRED" ? "danger"
                          : "outline"
                      }
                      size="sm"
                    >
                      {proposalStatusLabels[revision.status]}
                    </HudBadge>
                    {revision.document_id ? (
                      <span className="crm-muted"><FileText size={11} aria-hidden /> PDF anexado</span>
                    ) : canManageProposals && !["SUPERSEDED", "WITHDRAWN"].includes(revision.status) ? (
                      <ProposalDocumentUpload proposalId={p.id} revisionId={revision.id}
                        revisionLabel={`R${String(revision.revision).padStart(2, "0")}`} onDone={refresh} />
                    ) : (
                      <span className="crm-muted" title={canManageProposals ? "Revisão encerrada" : "Anexar exige commercial.proposals.manage"}>
                        <Lock size={11} aria-hidden /> Sem PDF{canManageProposals ? " · revisão encerrada" : " · sem permissão para anexar"}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>

          </FlowTabPanel>
        )}

        {tab === "facts" && (
          <FlowTabPanel label="Fatos e blueprint">
            <Section title="Blueprint de execução" note="Escopo, entregáveis, medição, evidência, datas, dependências e condições — antes de virar trabalho.">
              <BlueprintView
                proposalId={p.id}
                revisionId={governing?.id ?? null}
                revisionLabel={governing ? `R${String(governing.revision).padStart(2, "0")}` : "a revisão"}
                authorized={data.authorizations.some((a) => a.proposal_revision_id === governing?.id && a.state === "ACTIVE")}
                blueprint={(data.blueprints ?? []).find((b) => b.proposal_revision_id === governing?.id) ?? null}
                facts={allFacts}
                canCreate={canManageProposals}
                onCreated={refresh}
                openQuestions={openDivergences.map((d) => d.summary)}
              />
            </Section>
        <Section
          title="Fatos lidos do documento"
          count={data.facts.length}
          note="Só fato com página e trecho literal, confirmado por gente, pode virar regra."
        >
          {data.facts.length === 0 ? (
            <SectionEmpty>
              Nenhum fato extraído para esta proposta. O silêncio do documento é informação:
              nenhuma regra de medição será suposta.
            </SectionEmpty>
          ) : (
            FACT_GROUPS.map((group) => {
              const rows = data.facts.filter((fact) => group.domains.includes(fact.fact_domain));
              if (!rows.length) return null;
              return (
                <div key={group.id} className="crm-fact-group">
                  <p className="crm-eyebrow">{group.label}</p>
                  <p className="crm-muted">{group.note}</p>
                  <ul className="crm-fact-list">
                    {rows.map((fact) => {
                      /*
                        A mesma regra do banco (`commercial_fact_promotable`),
                        chamada pelo helper canônico. A linha de conversão existe
                        só porque a API devolve as colunas em snake_case — e
                        reimplementar a condição aqui seria criar a terceira
                        cópia de uma regra que já tem duas.
                      */
                      const promotable = isFactPromotable({
                        provenanceState: fact.provenance_state,
                        confirmationState: fact.confirmation_state,
                      });
                      return (
                        <li key={fact.id}>
                          <div className="min-w-0">
                            <strong>{fact.label}</strong>
                            <p className="crm-fact-value">
                              {fact.corrected_value
                                ?? fact.value_text
                                ?? (fact.value_numeric !== null
                                  ? brl(fact.value_numeric, fact.currency ?? p.currency)
                                  : fact.value_date
                                    ? day(fact.value_date)
                                    : "Sem valor registrado")}
                              {fact.unit ? ` ${fact.unit}` : ""}
                            </p>
                            <p className="crm-provenance">
                              <Quote size={11} aria-hidden />
                              {fact.provenance_state === "ANCHORED"
                                ? `${documentContextLabels[fact.document_context]}${fact.source_page ? `, p. ${fact.source_page}` : ""}${fact.source_section ? ` · ${fact.source_section}` : ""}`
                                : "Sem página e trecho literal — não promovível a regra"}
                            </p>
                            {fact.source_quote && (
                              <blockquote className="crm-quote">{fact.source_quote}</blockquote>
                            )}
                          </div>
                          <div className="crm-fact-state">
                            <HudBadge
                              variant={promotable ? "success" : fact.provenance_state === "ANCHORED" ? "warning" : "subtle"}
                              size="sm"
                            >
                              {promotable
                                ? "Promovível a regra"
                                : fact.confirmation_state === "UNCONFIRMED"
                                  ? "Aguarda confirmação"
                                  : fact.confirmation_state === "REJECTED"
                                    ? "Rejeitado"
                                    : "Não ancorado"}
                            </HudBadge>
                            <span className="crm-muted">
                              {fact.extraction_method === "ai" ? "Leitura da Apex" : "Registro humano"}
                            </span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })
          )}
        </Section>

          </FlowTabPanel>
        )}

        {tab === "execution" && (
          <FlowTabPanel label="Execução">
        <Section
          title="Passagem para execução"
          note="Aceite não é autorização. Autorizar e emitir a OS são atos distintos."
        >
          {restricted ? (
            <SectionRestricted permission="contracts.view" />
          ) : !accepted ? (
            <SectionEmpty>
              A execução só pode ser autorizada por uma revisão ACEITA. Nenhuma revisão desta
              proposta foi aceita pelo cliente.
            </SectionEmpty>
          ) : (
            <div className="crm-handoff">
              <ol className="crm-handoff-steps">
                <li className="crm-handoff-done">
                  <CheckCircle2 size={14} aria-hidden />
                  <div>
                    <strong>Revisão aceita</strong>
                    <p className="crm-muted">
                      R{String(accepted.revision).padStart(2, "0")} em {day(accepted.accepted_at)} ·{" "}
                      {accepted.acceptance_source ?? "manifestação não informada"}
                    </p>
                  </div>
                </li>
                <li className={data.engagements.length ? "crm-handoff-done" : undefined}>
                  {data.engagements.length ? <CheckCircle2 size={14} aria-hidden /> : <ArrowRight size={14} aria-hidden />}
                  <div>
                    <strong>Trabalho autorizado</strong>
                    {data.engagements.length ? (
                      <p className="crm-muted">
                        {data.engagements.map((engagement) =>
                          `${engagement.engagement_number ?? engagement.title} · ${engagementStatusLabels[engagement.status]}`,
                        ).join(" · ")}
                      </p>
                    ) : (
                      <p className="crm-muted">
                        Nenhuma autorização aponta para esta proposta. Gerar trabalho autorizado
                        exige <code>commercial.engagements.manage</code>.
                      </p>
                    )}
                  </div>
                </li>
                <li className={ordersFromProposal.size ? "crm-handoff-done" : undefined}>
                  {ordersFromProposal.size ? <CheckCircle2 size={14} aria-hidden /> : <ArrowRight size={14} aria-hidden />}
                  <div>
                    <strong>Ordem de Serviço interna</strong>
                    {data.serviceOrders.length ? (
                      <p className="crm-muted">
                        {data.serviceOrders.map((order) =>
                          `${order.os_number} · ${serviceOrderStatusLabels[order.status]}${order.project_id ? "" : " · sem projeto"}`,
                        ).join(" · ")}
                      </p>
                    ) : (
                      <p className="crm-muted">
                        O trabalho está vendido e nenhuma OS interna o liberou para execução.
                      </p>
                    )}
                    {blockingDivergences.length > 0 && (
                      <p className="crm-handoff-blocked">
                        {blockingDivergences.length} divergência(s) bloqueante(s) em aberto —
                        a emissão da OS fica recusada pelo banco até a decisão.
                      </p>
                    )}
                  </div>
                </li>
              </ol>
              <p className="crm-muted">
                A execução continua na Carteira, nas Ordens de Serviço e nos Projetos. Esta tela
                mostra onde a passagem parou; ela não a completa por ninguém.
              </p>
            </div>
          )}
        </Section>

        <Section
          title="Divergências"
          count={openDivergences.length}
          note="Quando duas fontes discordam, quem decide é uma pessoa — nunca a máquina."
        >
          {restricted ? (
            <SectionRestricted permission="contracts.view" />
          ) : openDivergences.length === 0 ? (
            <SectionEmpty>
              Nenhuma divergência em aberto entre esta proposta e o que foi registrado depois.
            </SectionEmpty>
          ) : (
            <ul className="crm-divergence-list">
              {openDivergences.map((divergence) => (
                <li key={divergence.id} className={`crm-divergence-${divergence.severity.toLowerCase()}`}>
                  <AlertOctagon size={14} aria-hidden />
                  <div className="min-w-0">
                    <strong>
                      {divergenceScopeLabels[divergence.scope]} ·{" "}
                      {divergenceSeverityLabels[divergence.severity]}
                    </strong>
                    <p className="crm-muted">{divergence.summary}</p>
                    <p className="crm-muted">
                      {divergence.left_source_kind}: {divergence.left_value ?? "—"} ·{" "}
                      {divergence.right_source_kind}: {divergence.right_value ?? "—"}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Documentos" count={data.documents.length} note="O mesmo arquivo canônico do resto da plataforma — nenhuma cópia.">
          {restricted ? (
            <SectionRestricted permission="contracts.view" />
          ) : data.documents.length === 0 ? (
            <SectionEmpty>Nenhum PDF anexado às revisões desta proposta.</SectionEmpty>
          ) : (
            <ul className="crm-linked-list">
              {data.documents.map((document) => (
                <li key={document.id}>
                  <FileText size={14} aria-hidden />
                  <div className="min-w-0">
                    <strong>{document.title}</strong>
                    <p className="crm-muted">
                      {document.document_type} · {document.status} ·{" "}
                      {formatMoment(document.created_at)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          title="Follow-ups"
          count={data.followups.filter((f) => !["COMPLETED", "CANCELLED"].includes(f.state)).length}
          action={
            canManage && onComposeFollowup ? (
              <HudButton
                variant="secondary"
                size="sm"
                onClick={() => onComposeFollowup({ id: p.id, label: `${p.proposal_number} · ${p.title}` })}
              >
                <CalendarPlus size={14} aria-hidden />
                Agendar
              </HudButton>
            ) : undefined
          }
        >
          {data.followups.length === 0 ? (
            <SectionEmpty>Nenhum acompanhamento sobre esta proposta.</SectionEmpty>
          ) : (
            <ul className="crm-followup-list">
              {data.followups.map((followup) => (
                <li key={followup.id}>
                  <div className="min-w-0">
                    <strong>{followup.goal}</strong>
                    <p className="crm-muted">
                      {followup.responsible_text || "Sem responsável"} ·{" "}
                      {followup.due_date ? `prazo ${day(followup.due_date)}` : "sem prazo"}
                    </p>
                  </div>
                  <HudBadge
                    variant={followup.state === "COMPLETED" ? "success" : "outline"}
                    size="sm"
                  >
                    {FOLLOWUP_STATE_LABEL[followup.state] ?? followup.state}
                  </HudBadge>
                </li>
              ))}
            </ul>
          )}
        </Section>

          </FlowTabPanel>
        )}

        {tab === "activity" && (
          <FlowTabPanel label="Atividade">
        <Section title="Linha do tempo" note="Carimbos das revisões e da emissão — nenhum registro criado só para esta lista.">
          <Timeline entries={timeline} />
        </Section>
          </FlowTabPanel>
        )}
      </div>
    </HudDrawer>
    {linking && (
      <LinkOpportunityModal
        proposal={{ id: p.id, label: `${p.proposal_number} · ${p.title}`, partyId: p.party_id,
          counterparty: p.counterparty_name, currency: p.currency }}
        allowed={permissionsLoading ? null : canManage && canManageProposals}
        onClose={() => setLinking(false)}
        onLinked={() => { setLinking(false); refresh(); }}
      />
    )}
    {closing && (
      <ExecutionStartPanel
        proposalId={p.id}
        opportunityId={data.proposal.opportunity_id}
        initialMode={closing}
        onClose={() => setClosing(null)}
        onDone={refresh}
      />
    )}
    </>
  );
}

/**
 * Vincular pelo ato governado da 216. As oportunidades vivas da MESMA conta
 * vêm primeiro; a função recusa conta ou trabalho autorizado divergentes e a
 * mensagem dela aparece aqui, inteira.
 */
function LinkOpportunityModal({
  proposal, allowed, onClose, onLinked,
}: {
  proposal: { id: string; label: string; partyId: string | null; counterparty: string; currency: string };
  allowed: boolean | null;
  onClose: () => void;
  onLinked: () => void;
}) {
  const { success, error: notifyError } = useHudToast();
  const [options, setOptions] = useState<Array<{ id: string; title: string; counterparty_name: string;
    party_id: string | null; stage: OpportunityStage; currency: string }> | null>(null);
  const [chosen, setChosen] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/commercial/opportunities").then((r) => r.json()).then((payload) => {
      if (!alive) return;
      const rows = ((payload?.opportunities ?? []) as NonNullable<typeof options>)
        // Perdida ou abandonada a função recusa; ganha ainda pode receber a PT/PC que faltava.
        .filter((o) => o.stage !== "LOST" && o.stage !== "ABANDONED");
      const sameAccount = (o: (typeof rows)[number]) =>
        (proposal.partyId && o.party_id === proposal.partyId)
        || o.counterparty_name.trim().toLowerCase() === proposal.counterparty.trim().toLowerCase();
      setOptions([...rows.filter(sameAccount), ...rows.filter((o) => !sameAccount(o))]);
    }).catch(() => alive && setOptions([]));
    return () => { alive = false; };
  }, [proposal.partyId, proposal.counterparty]);

  const picked = options?.find((o) => o.id === chosen) ?? null;
  const accountClash = Boolean(picked && proposal.partyId && picked.party_id && picked.party_id !== proposal.partyId);

  const submit = async () => {
    if (!chosen || saving || !allowed) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/commercial/proposals/${proposal.id}/opportunity`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ opportunityId: chosen, reason: reason.trim() || null }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload?.error || "Vínculo recusado.");
      success("Proposta vinculada", payload.party_inherited
        ? "A conta do cadastro único veio da oportunidade."
        : `Agora em ${picked?.title ?? "oportunidade"}.`);
      if (payload.currency_differs) notifyError("Moedas diferentes", "A proposta e a oportunidade usam moedas distintas — confira o valor no forecast.");
      notifyCommercialChanged();
      onLinked();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  return (
    <HudModal isOpen onClose={() => { if (!saving) onClose(); }} title="Vincular oportunidade" subtitle={proposal.label} size="md">
      <div className="crm-flow" data-testid="link-opportunity-modal">
        {allowed === false ? (
          <UnlockHint icon={<Lock size={14} />}>
            Vincular mexe nas duas pontas do funil e exige <code>commercial.proposals.manage</code> e <code>commercial.manage</code>.
          </UnlockHint>
        ) : (
          <>
            <label className="crm-field-label">
              <span>Oportunidade *</span>
              <select value={chosen} onChange={(e) => setChosen(e.target.value)} data-testid="link-opportunity-select">
                <option value="">{options ? "Escolha a oportunidade" : "Carregando…"}</option>
                {(options ?? []).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.title} — {o.counterparty_name} · {opportunityStageLabels[o.stage]}
                  </option>
                ))}
              </select>
            </label>
            {options && options.length === 0 && (
              <p className="crm-field-hint">Nenhuma oportunidade viva. Crie a oportunidade do cliente e volte aqui.</p>
            )}
            {accountClash && (
              <p className="crm-flow-error" role="status">
                <AlertOctagon size={14} aria-hidden /> Esta oportunidade é de outra conta do cadastro único — o vínculo será recusado.
              </p>
            )}
            {picked && picked.currency !== proposal.currency && (
              <p className="crm-field-hint">A oportunidade usa {picked.currency}; a proposta, {proposal.currency}.</p>
            )}
            <label className="crm-field-label">
              <span>Motivo (fica no histórico)</span>
              <textarea value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)}
                placeholder="Ex.: proposta importada antes de a oportunidade ser criada" />
            </label>
            <p className="crm-field-hint">
              Vincular é definitivo e fica registrado com seu nome. Mover a proposta para outra oportunidade depois não é permitido.
            </p>
          </>
        )}
        {error && <p className="crm-flow-error" role="alert"><AlertOctagon size={14} aria-hidden /> {error}</p>}
        <div className="crm-flow-footer">
          <p>{chosen ? "" : "Falta: oportunidade."}</p>
          <div>
            <HudButton variant="ghost" onClick={onClose} disabled={saving}>Cancelar</HudButton>
            <HudButton variant="primary" onClick={submit} disabled={!chosen || saving || !allowed || accountClash}
              data-testid="link-opportunity-submit">
              <Link2 size={14} aria-hidden /> {saving ? "Vinculando…" : "Vincular"}
            </HudButton>
          </div>
        </div>
      </div>
    </HudModal>
  );
}
