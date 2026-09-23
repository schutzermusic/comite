"use client";

/**
 * A CONTA vista por inteiro — dentro de Contas & Contatos, não numa sétima área.
 *
 * ─── O que esta tela não é ───────────────────────────────────────────────
 *
 * Não é um cadastro de clientes do Comercial. A identidade jurídica continua
 * em `parties`, a mesma que Contratos, Projetos e Faturamento usam, e nada
 * aqui a edita. O que a tela faz é REUNIR em volta de um `party_id` o que já
 * está espalhado — e reunir é o oposto de duplicar.
 *
 * Um segundo cadastro é sempre a saída mais rápida e sempre a mesma dívida:
 * duas razões sociais para a mesma empresa, dois CNPJs divergentes, e a nota
 * fiscal saindo pelo errado.
 */
import { useMemo, useState } from "react";
import {
  ArrowRight, Briefcase, CalendarPlus, FileText, Mail, Phone, User,
} from "lucide-react";
import { HudBadge, HudButton, HudDrawer } from "@/components/hud";
import "./commercial-flow.css";
import { SURVEY_STATUS_LABEL, type SiteSurveyStatus } from "@/lib/commercial/site-survey";
import { usePermissions } from "@/hooks/use-permissions";
import {
  engagementStatusLabels, opportunityStageLabels, proposalStatusLabels,
} from "@/lib/commercial/labels";
import type {
  EngagementStatus, OpportunityStage, ProposalRevisionStatus,
} from "@/lib/commercial/types";
import { isOpenStage } from "@/lib/commercial/stage-policy";
import {
  governingRevision, isOpenFollowup, signalsByOpportunity, type PipelineSignal,
} from "@/lib/commercial/pipeline-signals";
import type { FollowupState } from "@/lib/platform/followups/types";
import { brl, day, ResourceState, useCommercialResource } from "./shared";
import {
  Fact, FactGrid, Section, SectionEmpty, SectionRestricted, SignalDots, SignalList,
} from "./detail";
import { moneyTotal } from "./workspace";
import { CreateCommercialButton } from "./CreateCommercialModal";
import { FollowupComposer } from "./FollowupComposer";

type OpportunityRow = {
  id: string; code: string | null; title: string; counterparty_name: string;
  stage: OpportunityStage; estimated_value: string | null; currency: string;
  probability: string | null; expected_decision_date: string | null;
  owner_user_id: string | null; engagement_id: string | null; closed_at: string | null;
  lost_reason: string | null; stage_entered_at: string | null; created_at: string;
};
type Payload = {
  party: {
    id: string; legal_name: string; trade_name: string | null;
    document_number: string | null; created_at: string;
  };
  surveys?: Array<{ id: string; code: string; title: string; status: SiteSurveyStatus; opportunity_id: string;
    site_name: string | null; planned_visit_date: string | null; completed_at: string | null }>;
  executionStarts?: Array<{ id: string; opportunity_id: string | null; mode: string; documentation_state: string;
    regularization_due_date: string | null }>;
  contacts: Array<{
    id: string; full_name: string; role_title: string | null; email: string | null;
    phone: string | null; is_primary: boolean; active: boolean;
  }>;
  opportunities: OpportunityRow[];
  proposals: Array<{
    id: string; proposal_number: string; kind: string; title: string;
    opportunity_id: string | null; currency: string; created_at: string;
  }>;
  revisions: Array<{
    id: string; proposal_id: string; revision: number; status: ProposalRevisionStatus;
    total_value: string | null; currency: string | null; validity_until: string | null;
    accepted_at: string | null;
  }>;
  followups: Array<{
    id: string; source_kind: string; source_id: string; goal: string; state: FollowupState;
    due_date: string | null; next_expected_event: string | null;
    next_expected_event_at: string | null; responsible_text: string | null;
  }>;
  engagements: Array<{
    id: string; engagement_number: string | null; title: string; status: EngagementStatus;
    origin: string; authorized_value: string | null; currency: string;
    authorized_at: string | null; created_at: string;
  }>;
  projects: Array<{
    engagement_id: string; project_id: string; name: string | null; code: string | null;
  }>;
  signals: PipelineSignal[];
  owners: Record<string, string>;
  engagementVisibility: "visible" | "restricted";
  projectVisibility: "visible" | "restricted";
};

export function AccountWorkspace({
  partyId,
  onClose,
  onOpenOpportunity,
  onOpenProposal,
}: {
  partyId: string;
  onClose: () => void;
  onOpenOpportunity?: (opportunityId: string) => void;
  onOpenProposal?: (proposalId: string) => void;
}) {
  const { data, state, message, refresh } = useCommercialResource<Payload>(
    `/api/commercial/accounts/${partyId}`,
  );
  const { hasPermission, loading: permissionsLoading } = usePermissions();
  const canCreate = permissionsLoading ? null : hasPermission("commercial.manage");
  const canManage = hasPermission("commercial.manage");
  const [composing, setComposing] = useState<{ id: string; label: string } | null>(null);

  const governing = useMemo(
    () => governingRevision(data?.revisions ?? []),
    [data?.revisions],
  );
  const byOpportunity = useMemo(
    () => signalsByOpportunity(data?.signals ?? []),
    [data?.signals],
  );

  if (state !== "ready" || !data) {
    return (
      <HudDrawer isOpen onClose={onClose} title="Conta" width="760px" density="compact">
        <ResourceState state={state} message={message} />
      </HudDrawer>
    );
  }

  const account = {
    id: data.party.id,
    name: data.party.trade_name || data.party.legal_name,
    document: data.party.document_number ?? null,
  };
  const open = data.opportunities.filter((row) => isOpenStage(row.stage));
  const won = data.opportunities.filter((row) => row.stage === "WON");
  const decided = data.opportunities.filter((row) => ["WON", "LOST"].includes(row.stage));
  const openFollowups = data.followups.filter(isOpenFollowup);
  const activeContacts = data.contacts.filter((contact) => contact.active);
  const acceptedRevisions = data.revisions.filter((r) => r.status === "ACCEPTED");
  const activeEngagements = data.engagements.filter(
    (engagement) => engagement.status === "AUTHORIZED" || engagement.status === "UNDER_ANALYSIS",
  );

  return (
    <>
      <HudDrawer
        isOpen
        onClose={onClose}
        width="820px"
        density="compact"
        title={data.party.trade_name || data.party.legal_name}
        subtitle={
          <div className="crm-drawer-subtitle">
            <span>{data.party.legal_name}</span>
            {data.party.document_number && (
              <span className="crm-muted">{data.party.document_number}</span>
            )}
            <HudBadge variant="subtle" size="sm">Cadastro único</HudBadge>
          </div>
        }
      >
        <div className="crm-detail">
          <FactGrid>
            <Fact
              label="Pipeline em aberto"
              value={moneyTotal(open.map((row) => ({ value: row.estimated_value, currency: row.currency })))}
              hint={`${open.length} oportunidade(s) aberta(s)`}
              tone="accent"
            />
            <Fact
              label="Aceito pelo cliente"
              value={moneyTotal(acceptedRevisions.map((r) => ({ value: r.total_value, currency: r.currency })))}
              hint={`${acceptedRevisions.length} revisão(ões) aceita(s)`}
            />
            <Fact
              label="Conversão"
              value={decided.length ? `${Math.round((won.length / decided.length) * 100)}%` : "—"}
              hint={decided.length ? "Ganhas ÷ (ganhas + perdidas)" : "Sem oportunidades decididas"}
            />
            <Fact
              label="Contatos ativos"
              value={activeContacts.length}
              hint={activeContacts.some((c) => c.is_primary) ? "Com contato principal" : "Sem contato principal"}
              tone={activeContacts.length ? "neutral" : "warning"}
            />
            <Fact
              label="Acompanhamentos abertos"
              value={openFollowups.length}
              hint="No motor canônico do Apex"
            />
            <Fact
              label="Trabalho autorizado"
              value={
                data.engagementVisibility === "restricted" ? "Reservado" : activeEngagements.length
              }
              hint={
                data.engagementVisibility === "restricted"
                  ? "Exige contracts.view"
                  : "Autorizados ou em análise"
              }
            />
          </FactGrid>

          <div className="crm-command-actions" data-testid="account-actions">
            <CreateCommercialButton
              kind="opportunity"
              permitted={canCreate}
              size="sm"
              variant="secondary"
              label="Nova oportunidade"
              context={{ account }}
              onCreated={refresh}
              onOpen={onOpenOpportunity}
            />
            <CreateCommercialButton
              kind="contact"
              permitted={canCreate}
              size="sm"
              variant="secondary"
              label="Novo contato"
              context={{ account }}
              onCreated={refresh}
            />
          </div>

          <Section title="Atenção" note="Sinais determinísticos das oportunidades desta conta.">
            <SignalList
              signals={data.signals}
              emptyLabel="Nenhum sinal aberto nesta conta."
            />
          </Section>

          {(data.executionStarts ?? []).filter((s) => s.documentation_state === "PENDING").map((start) => (
            <p key={start.id} className="flow-banner flow-banner-danger" role="status">
              <span aria-hidden>⚠</span>
              <span>
                <strong>Execução com documentação comercial pendente</strong>
                {" — "}{data.opportunities.find((o) => o.id === start.opportunity_id)?.title ?? "oportunidade"}
                {start.regularization_due_date ? ` · prazo ${new Date(`${start.regularization_due_date}T12:00:00`).toLocaleDateString("pt-BR")}` : ""}
                {" · faturamento bloqueado"}
              </span>
              <span />
            </p>
          ))}

          <Section title="Levantamentos técnicos" count={(data.surveys ?? []).length}
            note="Visitas técnicas desta conta, em qualquer oportunidade.">
            {(data.surveys ?? []).length === 0 ? (
              <SectionEmpty>Nenhum levantamento técnico registrado para esta conta.</SectionEmpty>
            ) : (
              <ul className="crm-linked-list">
                {(data.surveys ?? []).map((survey) => (
                  <li key={survey.id}>
                    <div className="min-w-0">
                      <strong>{survey.code} · {survey.title}</strong>
                      <p className="crm-muted">
                        {survey.site_name ?? "Local não registrado"}
                        {survey.planned_visit_date ? ` · visita ${new Date(`${survey.planned_visit_date}T12:00:00`).toLocaleDateString("pt-BR")}` : ""}
                      </p>
                    </div>
                    <HudBadge variant={survey.status === "COMPLETED" ? "success" : "outline"} size="sm">
                      {SURVEY_STATUS_LABEL[survey.status]}
                    </HudBadge>
                    <a className="flow-link" href={`/comercial/levantamentos/${survey.id}`}>Abrir</a>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Contatos" count={activeContacts.length}>
            {activeContacts.length === 0 ? (
              <SectionEmpty>
                Nenhum contato ativo. Sem pessoa, não há para quem mandar a proposta.
              </SectionEmpty>
            ) : (
              <ul className="crm-contacts">
                {activeContacts.map((contact) => (
                  <li key={contact.id}>
                    <User size={14} aria-hidden />
                    <div className="min-w-0">
                      <strong>
                        {contact.full_name}
                        {contact.is_primary && (
                          <HudBadge variant="info" size="sm">Principal</HudBadge>
                        )}
                      </strong>
                      <p className="crm-muted">{contact.role_title || "Cargo não informado"}</p>
                    </div>
                    <div className="crm-contact-links">
                      {contact.email && (
                        <a href={`mailto:${contact.email}`} title={contact.email}>
                          <Mail size={13} aria-hidden />
                          <span className="sr-only">{`E-mail de ${contact.full_name}`}</span>
                        </a>
                      )}
                      {contact.phone && (
                        <a href={`tel:${contact.phone}`} title={contact.phone}>
                          <Phone size={13} aria-hidden />
                          <span className="sr-only">{`Telefone de ${contact.full_name}`}</span>
                        </a>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Oportunidades" count={data.opportunities.length}>
            {data.opportunities.length === 0 ? (
              <SectionEmpty>Nenhuma oportunidade registrada para esta conta.</SectionEmpty>
            ) : (
              <ul className="crm-linked-list">
                {data.opportunities.map((row) => (
                  <li key={row.id}>
                    <div className="min-w-0">
                      <strong>
                        {row.title}
                        <SignalDots signals={byOpportunity.get(row.id) ?? []} />
                      </strong>
                      <p className="crm-muted">
                        {opportunityStageLabels[row.stage]} ·{" "}
                        {brl(row.estimated_value, row.currency)}
                        {row.expected_decision_date ? ` · decisão ${day(row.expected_decision_date)}` : ""}
                        {row.lost_reason ? ` · ${row.lost_reason}` : ""}
                      </p>
                    </div>
                    <div className="crm-followup-actions">
                      {canManage && isOpenStage(row.stage) && (
                        <HudButton
                          variant="ghost"
                          size="sm"
                          onClick={() => setComposing({ id: row.id, label: row.title })}
                        >
                          <CalendarPlus size={13} aria-hidden />
                          <span className="sr-only">{`Agendar follow-up para ${row.title}`}</span>
                        </HudButton>
                      )}
                      {onOpenOpportunity && (
                        <HudButton variant="ghost" size="sm" onClick={() => onOpenOpportunity(row.id)}>
                          Abrir <ArrowRight size={13} aria-hidden />
                        </HudButton>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Propostas" count={data.proposals.length}>
            {data.proposals.length === 0 ? (
              <SectionEmpty>Nenhuma proposta emitida para esta conta.</SectionEmpty>
            ) : (
              <ul className="crm-linked-list">
                {data.proposals.map((proposal) => {
                  const revision = governing.get(proposal.id);
                  return (
                    <li key={proposal.id}>
                      <FileText size={14} aria-hidden />
                      <div className="min-w-0">
                        <strong>{proposal.proposal_number} · {proposal.title}</strong>
                        <p className="crm-muted">
                          {revision
                            ? `R${String(revision.revision).padStart(2, "0")} · ${proposalStatusLabels[revision.status]} · ${brl(revision.total_value, revision.currency ?? proposal.currency)}`
                            : "Sem revisão"}
                        </p>
                      </div>
                      {onOpenProposal && (
                        <HudButton variant="ghost" size="sm" onClick={() => onOpenProposal(proposal.id)}>
                          Abrir <ArrowRight size={13} aria-hidden />
                        </HudButton>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          <Section
            title="Trabalho autorizado"
            count={data.engagements.length}
            note="A execução que esta conta já autorizou — contrato, proposta aceita, pedido ou autorização."
          >
            {data.engagementVisibility === "restricted" ? (
              <SectionRestricted permission="contracts.view" />
            ) : data.engagements.length === 0 ? (
              <SectionEmpty>Nenhum trabalho autorizado para esta conta.</SectionEmpty>
            ) : (
              <ul className="crm-linked-list">
                {data.engagements.map((engagement) => (
                  <li key={engagement.id}>
                    <Briefcase size={14} aria-hidden />
                    <div className="min-w-0">
                      <strong>{engagement.engagement_number ?? engagement.title}</strong>
                      <p className="crm-muted">
                        {engagementStatusLabels[engagement.status]} ·{" "}
                        {engagement.authorized_value === null
                          ? "valor não autorizado ainda"
                          : brl(engagement.authorized_value, engagement.currency)}
                        {engagement.authorized_at ? ` · desde ${day(engagement.authorized_at)}` : ""}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Projetos" count={data.projects.length} note="Onde o trabalho autorizado é executado, medido e evidenciado.">
            {data.projectVisibility === "restricted" ? (
              <SectionRestricted permission="projects.view" />
            ) : data.projects.length === 0 ? (
              <SectionEmpty>Nenhum projeto vinculado ao trabalho autorizado desta conta.</SectionEmpty>
            ) : (
              <ul className="crm-linked-list">
                {data.projects.map((project) => (
                  <li key={`${project.engagement_id}-${project.project_id}`}>
                    <Briefcase size={14} aria-hidden />
                    <div className="min-w-0">
                      <strong>{project.name ?? project.project_id}</strong>
                      <p className="crm-muted">{project.code ?? "Sem código"}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Acompanhamentos abertos" count={openFollowups.length}>
            {openFollowups.length === 0 ? (
              <SectionEmpty>Nenhum compromisso em aberto com esta conta.</SectionEmpty>
            ) : (
              <ul className="crm-followup-list">
                {openFollowups.map((followup) => (
                  <li key={followup.id}>
                    <div className="min-w-0">
                      <strong>{followup.goal}</strong>
                      <p className="crm-muted">
                        {followup.responsible_text || "Sem responsável"} ·{" "}
                        {followup.due_date ? `prazo ${day(followup.due_date)}` : "sem prazo"}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </HudDrawer>

      {composing && (
        <FollowupComposer
          subject={{ kind: "commercial_opportunity", id: composing.id, label: composing.label }}
          onClose={() => setComposing(null)}
          onCreated={() => {
            setComposing(null);
            refresh();
          }}
        />
      )}
    </>
  );
}
