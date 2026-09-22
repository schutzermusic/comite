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
  ArrowRight, Building2, CalendarPlus, FileText, Mail, Phone, User,
} from "lucide-react";
import { HudBadge, HudButton, HudDrawer, useHudToast } from "@/components/hud";
import { usePermissions } from "@/hooks/use-permissions";
import { opportunityStageLabels, proposalStatusLabels } from "@/lib/commercial/labels";
import type { OpportunityStage, ProposalRevisionStatus } from "@/lib/commercial/types";
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
  id: string; proposal_number: string; kind: string; title: string;
  currency: string; created_at: string;
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
};

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
  const { hasPermission } = usePermissions();
  const canManage = hasPermission("commercial.manage");
  const [composing, setComposing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const { success, error: notifyError } = useHudToast();

  const governing = useMemo(
    () => governingRevision(data?.revisions ?? []),
    [data?.revisions],
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

  return (
    <>
      <HudDrawer
        isOpen
        onClose={onClose}
        width="760px"
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
              hint={
                nextAction
                  ? `${day(nextAction.due_date)} · ${nextAction.responsible_text ?? "sem responsável"}`
                  : "Sem acompanhamento aberto"
              }
              tone={nextAction ? "neutral" : "danger"}
            />
          </FactGrid>

          <Section title="Sinais" note="Regras determinísticas sobre datas e estados — não recomendações.">
            <SignalList signals={data.signals} />
          </Section>

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
              <SectionEmpty>
                Nenhum contato cadastrado nesta conta. Sem pessoa, o acompanhamento não tem
                para quem ir.
              </SectionEmpty>
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

          <Section
            title="Follow-ups"
            count={openFollowups.length}
            note="No motor canônico de acompanhamento. Concluir exige verificação."
            action={
              canManage ? (
                <HudButton variant="secondary" size="sm" onClick={() => setComposing(true)}>
                  <CalendarPlus size={14} aria-hidden />
                  Agendar
                </HudButton>
              ) : undefined
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
                        {followup.responsible_text || "Sem responsável"} ·{" "}
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

          <Section title="Propostas vinculadas" count={data.proposals.length}>
            {data.proposals.length === 0 ? (
              <SectionEmpty>
                Nenhuma proposta ligada a esta oportunidade.
              </SectionEmpty>
            ) : (
              <ul className="crm-linked-list">
                {data.proposals.map((proposal) => {
                  const revision = governing.get(proposal.id);
                  return (
                    <li key={proposal.id}>
                      <FileText size={14} aria-hidden />
                      <div className="min-w-0">
                        <strong>
                          {proposal.proposal_number} · {proposal.title}
                        </strong>
                        <p className="crm-muted">
                          {revision
                            ? `R${String(revision.revision).padStart(2, "0")} · ${proposalStatusLabels[revision.status]} · ${brl(revision.total_value, revision.currency ?? proposal.currency)}`
                            : "Sem revisão"}
                          {revision?.validity_until
                            ? ` · validade ${day(revision.validity_until)}`
                            : ""}
                        </p>
                      </div>
                      {onOpenProposal && (
                        <HudButton
                          variant="ghost"
                          size="sm"
                          onClick={() => onOpenProposal(proposal.id)}
                        >
                          Abrir <ArrowRight size={13} aria-hidden />
                        </HudButton>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          <Section title="Linha do tempo" note="Etapas, revisões e acompanhamentos — nenhum registro criado só para esta lista.">
            <Timeline entries={timeline} />
          </Section>

          {o.notes && (
            <Section title="Observações">
              <p className="crm-notes">{o.notes}</p>
            </Section>
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
    </>
  );
}
