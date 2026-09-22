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
import { useMemo } from "react";
import {
  AlertOctagon, ArrowRight, CalendarPlus, CheckCircle2, FileText, Quote,
} from "lucide-react";
import { HudBadge, HudButton, HudDrawer } from "@/components/hud";
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
import { brl, day, ResourceState, useCommercialResource } from "./shared";
import {
  Fact, FactGrid, Section, SectionEmpty, SectionRestricted, Timeline, formatMoment,
  type TimelineEntry,
} from "./detail";

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
  const { data, state, message } = useCommercialResource<Payload>(
    `/api/commercial/proposals/${proposalId}`,
  );
  const { hasPermission } = usePermissions();
  const canManage = hasPermission("commercial.manage");

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
  const ordersFromProposal = new Set(
    data.serviceOrders.map((o) => o.source_proposal_revision_id).filter(Boolean) as string[],
  );

  return (
    <HudDrawer
      isOpen
      onClose={onClose}
      width="820px"
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
                </li>
              ))}
            </ul>
          )}
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

        <Section title="Linha do tempo" note="Carimbos das revisões e da emissão — nenhum registro criado só para esta lista.">
          <Timeline entries={timeline} />
        </Section>
      </div>
    </HudDrawer>
  );
}
