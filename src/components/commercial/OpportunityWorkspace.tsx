"use client";

/**
 * O ESPAÇO DE TRABALHO de uma oportunidade.
 *
 * ─── Por que uma gaveta, e não uma página ────────────────────────────────
 *
 * Quem trabalha um funil não abre uma oportunidade: abre seis, uma atrás da
 * outra. Uma rota própria por oportunidade custaria uma navegação inteira por
 * item — perde-se o recorte do pipeline, os filtros e a posição da rolagem a
 * cada volta. A gaveta preserva o contexto atrás dela, que é o que torna
 * possível varrer uma etapa inteira numa sessão.
 *
 * Tudo o que aparece aqui vem de uma leitura só (`/api/commercial/
 * opportunities/[id]`), e as duas escritas possíveis — mudar de etapa e abrir
 * acompanhamento — são atos governados, cada um com sua permissão.
 */
import { useMemo, useState } from "react";
import {
  ArrowRight, Building2, CalendarPlus, FileText, Lock, Mail, Phone, Rocket, ScanSearch, User, UserCheck, UserPlus, Zap,
} from "lucide-react";
import { HudBadge, HudButton, HudDrawer, useHudToast } from "@/components/hud";
import { usePermissions } from "@/hooks/use-permissions";
import { opportunityStageLabels, proposalStatusLabels } from "@/lib/commercial/labels";
import { groupProposalContexts } from "@/lib/commercial/proposal-context";
import { ProposalContextList } from "./ProposalParts";
import type { OpportunityStage, ProposalKind, ProposalRevisionStatus } from "@/lib/commercial/types";
import {
  ALLOWED_STAGE_TRANSITIONS, STAGES_REQUIRING_REASON, STAGE_STALL_DAYS,
  daysBetween, isOpenStage,
} from "@/lib/commercial/stage-policy";
import {
  governingRevision, isOpenFollowup, type PipelineSignal,
} from "@/lib/commercial/pipeline-signals";
import { FOLLOWUP_STATE_LABEL, type FollowupState } from "@/lib/platform/followups/types";
import { brl, day, ResourceState, useCommercialResource } from "./shared";
import {
  Fact, FactGrid, Section, SectionEmpty, SignalList, Timeline, relativeDays,
  type TimelineEntry,
} from "./detail";
import { FollowupComposer } from "./FollowupComposer";
import { StageTransition } from "./StageTransition";
import { DiscoveryPanel, SurveyRequestModal, type SurveySummary } from "./DiscoveryPanel";
import { CreateCommercialButton } from "./CreateCommercialModal";
import { UnlockHint } from "./workspace";
import { ExecutionStartPanel } from "./ExecutionStartPanel";
import { ExecutionStatusBanner, type ExecutionStartSummary } from "./ExecutionStatus";
import { AssignFollowupModal } from "./AssignFollowupModal";
import { FlowTabPanel, FlowTabs } from "./tabs";
import type { ReadinessResult } from "@/lib/commercial/proposal-readiness";
import { SURVEY_STATUS_LABEL } from "@/lib/commercial/site-survey";

type OpportunityDetail = {
  id: string; code: string | null; title: string; counterparty_name: string;
  party_id: string | null; stage: OpportunityStage; estimated_value: string | null;
  currency: string; probability: string | null; expected_decision_date: string | null;
  owner_user_id: string | null; engagement_id: string | null; closed_at: string | null;
  lost_reason: string | null; source: string | null; notes: string | null;
  stage_entered_at: string | null; created_at: string;
};
type PartyRow = {
  id: string; legal_name: string; trade_name: string | null; document_number: string | null;
};
type ContactRow = {
  id: string; full_name: string; role_title: string | null; email: string | null;
  phone: string | null; is_primary: boolean;
};
type ProposalRow = {
  id: string; proposal_number: string; kind: ProposalKind; title: string;
  currency: string; created_at: string; counterparty_name?: string;
  opportunity_id?: string | null; party_id?: string | null; context_id?: string | null;
};
type RevisionRow = {
  id: string; proposal_id: string; revision: number; status: ProposalRevisionStatus;
  total_value: string | null; currency: string | null; validity_until: string | null;
  accepted_at: string | null; sent_at: string | null; internally_approved_at: string | null;
  created_at: string;
};
type FollowupRow = {
  id: string; source_kind: string; source_id: string; goal: string;
  expected_evidence: string | null; state: FollowupState; due_date: string | null;
  next_expected_event: string | null; next_expected_event_at: string | null;
  responsible_text: string | null; responsible_user_id: string | null;
  cadence_days: number | null; closed_at: string | null; created_at: string;
};
type StageEventRow = {
  id: string; from_stage: string | null; to_stage: string; reason: string | null;
  actor_user_id: string | null; occurred_at: string;
};

type Payload = {
  opportunity: OpportunityDetail;
  party: PartyRow | null;
  contacts: ContactRow[];
  proposals: ProposalRow[];
  revisions: RevisionRow[];
  followups: FollowupRow[];
  stageEvents: StageEventRow[];
  signals: PipelineSignal[];
  owners: Record<string, string>;
  surveys: SurveySummary[];
  readiness: ReadinessResult;
  executionStart: ExecutionStartSummary | null;
  engagement: { id: string; status: string } | null;
  serviceOrders: Array<{ id: string; os_number: string; status: string; project_id: string | null }>;
};

type TabId = "summary" | "discovery" | "proposals" | "followups" | "account" | "activity";

export function OpportunityWorkspace({
  opportunityId,
  onClose,
  onChanged,
  onOpenProposal,
  onOpenAccount,
}: {
  opportunityId: string;
  onClose: () => void;
  onChanged: () => void;
  onOpenProposal?: (proposalId: string) => void;
  onOpenAccount?: (partyId: string) => void;
}) {
  const { data, state, message, refresh } = useCommercialResource<Payload>(
    `/api/commercial/opportunities/${opportunityId}`,
  );
  const { hasPermission, loading: permissionsLoading } = usePermissions();
  const canManage = hasPermission("commercial.manage");
  const canProposals = permissionsLoading ? null : hasPermission("commercial.proposals.manage");
  const canContacts = permissionsLoading ? null : canManage;
  const canStart = hasPermission("commercial.execution.start");
  const canStartExceptional = hasPermission("commercial.execution.start_exceptional");
  const canRegularize = hasPermission("commercial.engagements.manage");
  const canSurvey = hasPermission("commercial.surveys.manage");
  const [tab, setTab] = useState<TabId>("summary");
  const [closing, setClosing] = useState<null | "STANDARD" | "EXCEPTIONAL">(null);
  const [assigning, setAssigning] = useState<FollowupRow | null>(null);
  const [composing, setComposing] = useState(false);
  const [requestingSurvey, setRequestingSurvey] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const { success, error: notifyError } = useHudToast();

  const governing = useMemo(
    () => governingRevision(data?.revisions ?? []),
    [data?.revisions],
  );
  // PT + PC = uma proposta: a aba e o contador falam de contextos.
  const proposalContexts = useMemo(
    () => groupProposalContexts(
      (data?.proposals ?? []).map((p) => ({ ...p, counterparty_name: p.counterparty_name ?? data?.opportunity.counterparty_name ?? "" })),
      data?.revisions ?? []),
    [data?.proposals, data?.revisions, data?.opportunity],
  );

  const timeline = useMemo<TimelineEntry[]>(() => {
    if (!data) return [];
    const owner = (id: string | null) =>
      (id && data.owners[id]) || (id ? "Responsável não identificado" : null);
    const entries: TimelineEntry[] = [];

    for (const event of data.stageEvents) {
      entries.push({
        id: `stage-${event.id}`,
        at: event.occurred_at,
        title: event.from_stage
          ? `${opportunityStageLabels[event.from_stage as OpportunityStage]} → ${opportunityStageLabels[event.to_stage as OpportunityStage]}`
          : `Oportunidade registrada em ${opportunityStageLabels[event.to_stage as OpportunityStage]}`,
        detail: event.reason,
        actor: owner(event.actor_user_id),
        tone: event.to_stage === "WON" ? "success"
          : ["LOST", "ABANDONED"].includes(event.to_stage) ? "danger" : "neutral",
      });
    }

    for (const proposal of data.proposals) {
      for (const revision of data.revisions.filter((r) => r.proposal_id === proposal.id)) {
        const label = `${proposal.proposal_number} R${String(revision.revision).padStart(2, "0")}`;
        if (revision.internally_approved_at) {
          entries.push({
            id: `approved-${revision.id}`, at: revision.internally_approved_at,
            title: `${label} aprovada internamente`, tone: "neutral",
          });
        }
        if (revision.sent_at) {
          entries.push({
            id: `sent-${revision.id}`, at: revision.sent_at,
            title: `${label} enviada ao cliente`, tone: "accent",
          });
        }
        if (revision.accepted_at) {
          entries.push({
            id: `accepted-${revision.id}`, at: revision.accepted_at,
            title: `${label} aceita pelo cliente`, tone: "success",
          });
        }
      }
    }

    for (const followup of data.followups) {
      entries.push({
        id: `followup-${followup.id}`, at: followup.created_at,
        title: `Acompanhamento aberto · ${followup.goal}`,
        detail: followup.due_date ? `Prazo ${day(followup.due_date)}` : "Sem prazo",
        actor: followup.responsible_text ?? owner(followup.responsible_user_id),
      });
      if (followup.closed_at) {
        entries.push({
          id: `followup-closed-${followup.id}`, at: followup.closed_at,
          title: `Acompanhamento ${followup.state === "COMPLETED" ? "concluído" : "cancelado"} · ${followup.goal}`,
          tone: followup.state === "COMPLETED" ? "success" : "neutral",
        });
      }
    }

    for (const survey of data.surveys ?? []) {
      entries.push({
        id: `survey-${survey.id}`, at: survey.created_at,
        title: `Levantamento ${survey.code} solicitado`, detail: survey.purpose, tone: "accent",
      });
      if (survey.completed_at) {
        entries.push({
          id: `survey-done-${survey.id}`, at: survey.completed_at,
          title: `Levantamento ${survey.code} concluído`, tone: "success",
        });
      }
    }
    if (data.executionStart) {
      const start = data.executionStart;
      entries.push({
        id: `start-${start.id}`, at: start.confirmed_at,
        title: start.mode === "EXCEPTIONAL" ? "Execução iniciada com documentação pendente" : "Negócio fechado — execução iniciada",
        detail: start.exception_reason ?? start.authorization_reference,
        actor: owner(start.confirmed_by),
        tone: start.mode === "EXCEPTIONAL" ? "danger" : "success",
      });
      if (start.regularized_at) {
        entries.push({ id: `regularized-${start.id}`, at: start.regularized_at, title: "Documentação comercial regularizada", tone: "success" });
      }
    }

    return entries.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
  }, [data]);

  if (state !== "ready" || !data) {
    return (
      <HudDrawer isOpen onClose={onClose} title="Oportunidade" width="720px" density="compact">
        <ResourceState state={state} message={message} />
      </HudDrawer>
    );
  }

  const o = data.opportunity;
  const open = isOpenStage(o.stage);
  const ageInStage = daysBetween(o.stage_entered_at, new Date());
  const stallLimit = STAGE_STALL_DAYS[o.stage];
  const stalled = ageInStage !== null && stallLimit !== undefined && ageInStage > stallLimit;
  const openFollowups = data.followups.filter(isOpenFollowup);
  const nextAction = [...openFollowups].sort(
    (a, b) => (a.due_date ?? "9999-12-31").localeCompare(b.due_date ?? "9999-12-31"),
  )[0];
  const primaryContact = data.contacts.find((c) => c.is_primary) ?? data.contacts[0];
  const ownerName = o.owner_user_id
    ? (data.owners[o.owner_user_id] ?? "Responsável não identificado")
    : "Sem responsável";

  const transitionFollowup = async (followup: FollowupRow, next: string) => {
    if (busy) return;
    setBusy(followup.id);
    try {
      const response = await fetch("/api/commercial/followups", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          followupId: followup.id,
          next,
          nextExpectedEvent: next === "WAITING_EXTERNAL_PARTY"
            ? (followup.next_expected_event ?? followup.goal) : null,
          nextExpectedEventAt: next === "WAITING_EXTERNAL_PARTY"
            ? (followup.next_expected_event_at ?? followup.due_date) : null,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload?.error || "Recusado.");
      success("Acompanhamento atualizado");
      refresh();
      onChanged();
    } catch (e) {
      notifyError("Transição recusada", (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const surveys = data.surveys ?? [];
  const openSurveys = surveys.filter((survey) => !["COMPLETED", "CANCELLED"].includes(survey.status));
  const blockingSignals = data.signals.filter((signal) => signal.severity === "blocking").length;
  const start = data.executionStart;
  const closable = !start && o.stage !== "LOST" && o.stage !== "ABANDONED" && data.proposals.length > 0;
  const personName = (followup: FollowupRow) =>
    followup.responsible_user_id
      ? (data.owners[followup.responsible_user_id] ?? "Responsável não identificado")
      : followup.responsible_text
        ? `${followup.responsible_text} (texto)`
        : "Sem responsável";

  const tabs = [
    { id: "summary", label: "Resumo", count: blockingSignals, alert: blockingSignals > 0 },
    { id: "discovery", label: "Descoberta", count: openSurveys.length || (data.readiness?.state === "NOT_READY" ? 1 : 0),
      alert: data.readiness?.state === "NOT_READY" },
    { id: "proposals", label: "Propostas", count: proposalContexts.length },
    { id: "followups", label: "Follow-ups", count: openFollowups.length },
    { id: "account", label: "Conta", count: data.contacts.length },
    { id: "activity", label: "Atividade" },
  ];

  return (
    <>
      <HudDrawer
        isOpen
        onClose={onClose}
        width="800px"
        density="compact"
        title={o.title}
        subtitle={
          <div className="crm-drawer-subtitle">
            <HudBadge variant={o.stage === "WON" ? "success" : open ? "info" : "subtle"} size="sm">
              {opportunityStageLabels[o.stage]}
            </HudBadge>
            <span>{o.counterparty_name}</span>
            {o.code && <span className="crm-muted">{o.code}</span>}
          </div>
        }
      >
        <div className="crm-detail">
          {start && (
            <ExecutionStatusBanner
              start={start}
              owners={data.owners}
              canRegularize={canRegularize}
              onRegularized={() => { refresh(); onChanged(); }}
            />
          )}

          {!start && closable && canStart && (
            <div className="flow-command" data-testid="close-deal-command">
              <p>
                <strong>Proposta pronta para virar trabalho?</strong>{" "}
                Fechar registra a base do cliente, autoriza a execução, gera a OS interna e abre o projeto — reusando o que já existe.
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
          {!start && o.stage !== "LOST" && o.stage !== "ABANDONED" && !(closable && canStart) && (
            data.proposals.length === 0 ? (
              <UnlockHint
                icon={<Rocket size={14} />}
                testId="close-deal-locked"
                action={
                  <CreateCommercialButton
                    kind="proposal"
                    permitted={canProposals}
                    size="sm"
                    variant="secondary"
                    label="Nova proposta"
                    context={{ opportunityId: o.id }}
                    onCreated={() => { refresh(); onChanged(); }}
                    onOpen={onOpenProposal}
                  />
                }
              >
                <strong>Fechar negócio e iniciar execução</strong> fica disponível quando houver uma proposta
                vinculada. Importe a PT/PC para começar.
              </UnlockHint>
            ) : (
              <UnlockHint icon={<Lock size={14} />} testId="close-deal-locked">
                <strong>Fechar negócio e iniciar execução</strong> exige a alçada{" "}
                <code>commercial.execution.start</code> (administração, diretoria ou jurídico). Peça a quem a tem.
              </UnlockHint>
            )
          )}

          <FactGrid>
            <Fact
              label="Valor estimado"
              value={brl(o.estimated_value, o.currency)}
              hint={o.estimated_value === null ? "Não informado" : o.currency}
              tone="accent"
            />
            <Fact
              label="Idade na etapa"
              value={ageInStage === null ? "—" : `${ageInStage} d`}
              hint={
                stallLimit === undefined
                  ? "Etapa encerrada"
                  : `Limiar declarado: ${stallLimit} dias`
              }
              tone={stalled ? "warning" : "neutral"}
            />
            <Fact
              label="Probabilidade"
              value={o.probability !== null ? `${Math.round(Number(o.probability) * 100)}%` : "—"}
              hint={o.probability !== null ? "Informada" : "Padrão do estágio no forecast"}
            />
            <Fact
              label="Decisão prevista"
              value={day(o.expected_decision_date)}
              hint={
                o.expected_decision_date
                  ? relativeDays(-(daysBetween(o.expected_decision_date, new Date()) ?? 0))
                  : "Fora do forecast mensal"
              }
              tone={o.expected_decision_date ? "neutral" : "warning"}
            />
            <Fact label="Responsável" value={ownerName} hint="Dono da oportunidade" />
            <Fact
              label="Próxima ação"
              value={nextAction ? nextAction.goal : "Nenhuma"}
              hint={nextAction ? `${day(nextAction.due_date)} · ${personName(nextAction)}` : "Sem acompanhamento aberto"}
              tone={nextAction ? "neutral" : "danger"}
            />
          </FactGrid>

          <div className="crm-command-actions" data-testid="opportunity-actions">
            <HudButton variant="secondary" size="sm" onClick={() => setComposing(true)} disabled={!canManage}
              title={canManage ? undefined : "Exige commercial.manage."}>
              <CalendarPlus size={13} aria-hidden /> Agendar follow-up
            </HudButton>
            <HudButton variant="secondary" size="sm" onClick={() => setRequestingSurvey(true)} disabled={!canSurvey || !open}
              title={!open ? "Oportunidade encerrada." : canSurvey ? undefined : "Exige commercial.surveys.manage."}>
              <ScanSearch size={13} aria-hidden /> Pedir levantamento
            </HudButton>
            {data.proposals.length > 0 && (
              <CreateCommercialButton
                kind="proposal"
                permitted={canProposals}
                size="sm"
                variant="secondary"
                label="Nova proposta"
                context={{ opportunityId: o.id }}
                onCreated={() => { refresh(); onChanged(); }}
                onOpen={onOpenProposal}
              />
            )}
            {o.party_id && onOpenAccount && (
              <HudButton variant="ghost" size="sm" onClick={() => onOpenAccount(o.party_id!)}>
                <Building2 size={13} aria-hidden /> Conta 360
              </HudButton>
            )}
          </div>

          <FlowTabs label="Seções da oportunidade" tabs={tabs} active={tab} onChange={(id) => setTab(id as TabId)} />

          {tab === "summary" && (
            <FlowTabPanel label="Resumo">
              <Section title="Sinais" note="Regras determinísticas sobre datas e estados — não recomendações.">
                <SignalList signals={data.signals} />
              </Section>
              {!canManage && open && (
                <UnlockHint icon={<Lock size={14} />}>
                  Mudar de etapa exige a permissão <code>commercial.manage</code>.
                </UnlockHint>
              )}
              {canManage && open && (
                <Section
                  title="Etapa"
                  note="Avançar, recuar ou encerrar. Encerrar como perdida ou abandonada exige motivo."
                >
                  <StageTransition
                    opportunityId={o.id}
                    current={o.stage}
                    options={ALLOWED_STAGE_TRANSITIONS[o.stage]}
                    requiresReason={STAGES_REQUIRING_REASON}
                    onDone={() => {
                      refresh();
                      onChanged();
                    }}
                  />
                </Section>
              )}
              {data.readiness && (
                <p className="crm-muted">
                  Prontidão para propor: <strong>{data.readiness.state === "READY_TO_PROPOSE" ? "pronta" : data.readiness.state === "REVIEW_REQUIRED" ? "revisão necessária" : "não pronta"}</strong>
                  {openSurveys.length ? ` · ${openSurveys.map((s) => `${s.code} ${SURVEY_STATUS_LABEL[s.status].toLowerCase()}`).join(", ")}` : ""}
                  {" · "}
                  <button type="button" className="flow-link" onClick={() => setTab("discovery")}>ver descoberta</button>
                </p>
              )}
            </FlowTabPanel>
          )}

          {tab === "discovery" && (
            <FlowTabPanel label="Descoberta">
              <DiscoveryPanel
                opportunityId={o.id}
                opportunityTitle={o.title}
                surveys={surveys}
                readiness={data.readiness}
                owners={data.owners}
                canRequest={canSurvey}
                open={open}
                onChanged={() => { refresh(); onChanged(); }}
              />
            </FlowTabPanel>
          )}

          {tab === "account" && (
            <FlowTabPanel label="Conta">
          <Section
            title="Conta e contatos"
            count={data.contacts.length}
            action={
              o.party_id && onOpenAccount ? (
                <HudButton variant="ghost" size="sm" onClick={() => onOpenAccount(o.party_id!)}>
                  Abrir conta <ArrowRight size={13} aria-hidden />
                </HudButton>
              ) : undefined
            }
          >
            <div className="crm-account-line">
              <Building2 size={15} aria-hidden />
              <div className="min-w-0">
                <strong>{data.party?.trade_name || data.party?.legal_name || o.counterparty_name}</strong>
                <p className="crm-muted">
                  {data.party
                    ? `${data.party.legal_name}${data.party.document_number ? ` · ${data.party.document_number}` : ""}`
                    : "Contraparte ainda não vinculada ao cadastro único — a oportunidade nasce antes do cadastro."}
                </p>
              </div>
            </div>
            {data.contacts.length === 0 ? (
              <div className="crm-section-body">
                <UnlockHint
                  tone="warning"
                  icon={<UserPlus size={14} />}
                  action={o.party_id ? (
                    <CreateCommercialButton
                      kind="contact"
                      permitted={canContacts}
                      size="sm"
                      variant="secondary"
                      label="Novo contato"
                      context={{ account: { id: o.party_id, name: data.party?.trade_name || data.party?.legal_name || o.counterparty_name, document: data.party?.document_number ?? null } }}
                      onCreated={() => { refresh(); onChanged(); }}
                    />
                  ) : undefined}
                >
                  {o.party_id
                    ? "Nenhum contato nesta conta. A prontidão para propor pede um contato principal."
                    : "A oportunidade ainda não está ligada a uma conta do cadastro único — sem conta, não há contatos nem prontidão para propor."}
                </UnlockHint>
              </div>
            ) : (
              <ul className="crm-contacts">
                {data.contacts.map((contact) => (
                  <li key={contact.id}>
                    <User size={14} aria-hidden />
                    <div className="min-w-0">
                      <strong>
                        {contact.full_name}
                        {contact.id === primaryContact?.id && (
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
            </FlowTabPanel>
          )}

          {tab === "followups" && (
            <FlowTabPanel label="Follow-ups">
          <Section
            title="Follow-ups"
            count={openFollowups.length}
            note="No motor canônico de acompanhamento. Concluir exige verificação."
            action={
              <HudButton variant="secondary" size="sm" onClick={() => setComposing(true)} disabled={!canManage}
                title={canManage ? undefined : "Exige commercial.manage."}>
                <CalendarPlus size={14} aria-hidden />
                Agendar
              </HudButton>
            }
          >
            {data.followups.length === 0 ? (
              <SectionEmpty>
                Nenhum acompanhamento. Uma oportunidade sem próximo passo combinado avança
                por acaso.
              </SectionEmpty>
            ) : (
              <ul className="crm-followup-list">
                {data.followups.map((followup) => (
                  <li key={followup.id}>
                    <div className="min-w-0">
                      <strong>{followup.goal}</strong>
                      <p className="crm-muted">
                        {personName(followup)} ·{" "}
                        {followup.due_date ? `prazo ${day(followup.due_date)}` : "sem prazo"}
                        {followup.next_expected_event_at
                          ? ` · retorno esperado ${day(followup.next_expected_event_at)}`
                          : ""}
                      </p>
                      {followup.expected_evidence && (
                        <p className="crm-muted">Evidência: {followup.expected_evidence}</p>
                      )}
                    </div>
                    <div className="crm-followup-actions">
                      <HudBadge
                        variant={
                          followup.state === "COMPLETED" ? "success"
                            : followup.state === "ESCALATED" || followup.state === "BLOCKED" ? "danger"
                            : "outline"
                        }
                        size="sm"
                      >
                        {FOLLOWUP_STATE_LABEL[followup.state] ?? followup.state}
                      </HudBadge>
                      {canManage && isOpenFollowup(followup) && (
                        <HudButton
                          variant="ghost"
                          size="sm"
                          aria-label={`${followup.responsible_user_id ? "Redesignar" : "Designar"} · ${followup.goal}`}
                          onClick={() => setAssigning(followup)}
                        >
                          <UserCheck size={13} aria-hidden />
                          {followup.responsible_user_id ? "Redesignar" : "Designar"}
                        </HudButton>
                      )}
                      {canManage && isOpenFollowup(followup) && followup.state !== "BLOCKED" && (
                        <HudButton
                          variant="ghost"
                          size="sm"
                          disabled={busy === followup.id}
                          onClick={() => transitionFollowup(followup, "BLOCKED")}
                        >
                          Bloquear
                        </HudButton>
                      )}
                      {canManage && isOpenFollowup(followup) && (
                        <HudButton
                          variant="ghost"
                          size="sm"
                          disabled={busy === followup.id}
                          onClick={() => transitionFollowup(followup, "CANCELLED")}
                        >
                          Cancelar
                        </HudButton>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>
            </FlowTabPanel>
          )}

          {tab === "proposals" && (
            <FlowTabPanel label="Propostas">
          <Section title="Propostas vinculadas" count={proposalContexts.length}
            note={data.proposals.length > proposalContexts.length ? "PT e PC da mesma obra formam uma proposta." : undefined}>
            {data.proposals.length === 0 ? (
              <div className="crm-section-body">
                <UnlockHint
                  icon={<FileText size={14} />}
                  action={
                    <CreateCommercialButton
                      kind="proposal"
                      permitted={canProposals}
                      size="sm"
                      label="Importar PT / PC"
                      context={{ opportunityId: o.id }}
                      onCreated={() => { refresh(); onChanged(); }}
                      onOpen={onOpenProposal}
                    />
                  }
                >
                  Nenhuma proposta ligada a esta oportunidade. Comece pelo PDF: a Apex lê e você revisa antes de criar.
                </UnlockHint>
              </div>
            ) : (
              <ProposalContextList contexts={proposalContexts} onOpen={onOpenProposal} empty="Nenhuma proposta." />
            )}
          </Section>
          {(data.serviceOrders ?? []).length > 0 && (
            <Section title="Execução" count={data.serviceOrders.length} note="OS interna e projeto nascidos deste negócio.">
              <ul className="crm-linked-list">
                {data.serviceOrders.map((order) => (
                  <li key={order.id}>
                    <FileText size={14} aria-hidden />
                    <div className="min-w-0">
                      <strong>{order.os_number}</strong>
                      <p className="crm-muted">{order.status}{order.project_id ? " · projeto vinculado" : " · sem projeto"}</p>
                    </div>
                    {order.project_id && (
                      <a className="flow-link" href={`/projetos/${order.project_id}`}>Projeto <ArrowRight size={12} aria-hidden /></a>
                    )}
                  </li>
                ))}
              </ul>
            </Section>
          )}
            </FlowTabPanel>
          )}

          {tab === "activity" && (
            <FlowTabPanel label="Atividade">
              <Section title="Linha do tempo" note="Etapas, levantamentos, revisões, acompanhamentos e execução — nenhum registro criado só para esta lista.">
                <Timeline entries={timeline} />
              </Section>
              {o.notes && (
                <Section title="Observações">
                  <p className="crm-notes">{o.notes}</p>
                </Section>
              )}
            </FlowTabPanel>
          )}
        </div>
      </HudDrawer>

      {composing && (
        <FollowupComposer
          subject={{ kind: "commercial_opportunity", id: o.id, label: o.title }}
          onClose={() => setComposing(false)}
          onCreated={() => {
            setComposing(false);
            refresh();
            onChanged();
          }}
        />
      )}

      {requestingSurvey && (
        <SurveyRequestModal
          opportunityId={o.id}
          opportunityTitle={o.title}
          onClose={() => setRequestingSurvey(false)}
          onCreated={() => { refresh(); onChanged(); }}
          onDone={() => { setRequestingSurvey(false); setTab("discovery"); }}
        />
      )}

      {assigning && (
        <AssignFollowupModal
          followup={assigning}
          currentLabel={personName(assigning)}
          onClose={() => setAssigning(null)}
          onAssigned={() => { setAssigning(null); refresh(); onChanged(); }}
        />
      )}

      {closing && (
        <ExecutionStartPanel
          opportunityId={o.id}
          initialMode={closing}
          onClose={() => setClosing(null)}
          onDone={() => { refresh(); onChanged(); }}
        />
      )}
    </>
  );
}
