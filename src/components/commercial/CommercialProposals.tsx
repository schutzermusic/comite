"use client";

import { Fragment, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { HudBadge, HudButton, useHudToast } from "@/components/hud";
import { usePermissions } from "@/hooks/use-permissions";
import { proposalStatusLabels } from "@/lib/commercial/labels";
import type {
  ProposalKind,
  ProposalRevisionStatus,
} from "@/lib/commercial/types";
import {
  CONTEXT_STAGE_LABEL, contextMetrics, groupProposalContexts,
  type ContextStage, type ProposalContext,
} from "@/lib/commercial/proposal-context";
import { DocTag, type DocRole } from "./ProposalParts";
import { brl, day, ResourceState, useCommercialResource } from "./shared";
import { RecordOutcomeModal } from "./RecordOutcomeModal";
import { ProposalWorkspace } from "./ProposalWorkspace";
import { OpportunityWorkspace } from "./OpportunityWorkspace";
import { FollowupComposer } from "./FollowupComposer";
import { AuthorizeFromProposalModal } from "./AuthorizeFromProposalModal";
import { CreateCommercialButton } from "./CreateCommercialModal";
import {
  DataTable,
  EmptyNote,
  Filter,
  GovernanceNote,
  matches,
  Metrics,
  Panel,
  Segments,
  StatePill,
  Toolbar,
  WorkspaceHeading,
  type Tone,
} from "./workspace";
type ProposalRow = {
  id: string;
  proposal_number: string;
  kind: ProposalKind;
  title: string;
  counterparty_name: string;
  currency: string;
  opportunity_id: string | null;
  party_id?: string | null;
  context_id?: string | null;
  created_at?: string | null;
};
type RevisionRow = {
  id: string;
  proposal_id: string;
  revision: number;
  status: ProposalRevisionStatus;
  total_value: string | null;
  currency: string | null;
  validity_until: string | null;
  document_id: string | null;
  accepted_at: string | null;
  acceptance_source: string | null;
  internally_approved_at: string | null;
  sent_at: string | null;
  superseded_by_id: string | null;
};

const ROLE: Record<ProposalKind, DocRole> = { TECHNICAL: "PT", COMMERCIAL: "PC", COMBINED: "PT+PC" };
const composition = (ctx: ProposalContext) =>
  ctx.combined ? "COMBINED" : ctx.technical && ctx.commercial ? "PAIR" : ctx.technical ? "PT_ONLY" : "PC_ONLY";
const compositionLabels: Record<string, string> = {
  PAIR: "PT + PC", COMBINED: "Técnica + comercial (PDF único)", PT_ONLY: "Só PT", PC_ONLY: "Só PC",
};
const stageTone: Record<ContextStage, Tone> = {
  DRAFT: "neutral", INTERNAL_APPROVAL: "warning", APPROVED_FOR_SEND: "info", WITH_CUSTOMER: "accent",
  NEGOTIATION: "accent", ACCEPTED: "success", REJECTED: "danger", CLOSED: "neutral",
};

/**
 * A CENTRAL DE PROPOSTAS — uma linha por proposta comercial.
 *
 * PT e PC do mesmo cliente/obra são UM contexto (`proposal-context.ts`): uma
 * linha, uma contagem, com os dois documentos e suas revisões regentes à
 * vista. Contadores, filtros e ações operam sobre o pacote, nunca sobre
 * metade dele.
 */
export function CommercialProposals() {
  const { data, state, message, refresh } = useCommercialResource<{
    proposals: ProposalRow[];
    revisions: RevisionRow[];
  }>("/api/commercial/proposals");
  const opportunities = useCommercialResource<{
    opportunities: { id: string; title: string }[];
  }>("/api/commercial/opportunities");
  const [outcomeTarget, setOutcomeTarget] = useState<RevisionRow | null>(null);
  const [authorizeTarget, setAuthorizeTarget] = useState<{
    revision: RevisionRow;
    proposal: ProposalRow;
  } | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [kind, setKind] = useState("all");
  const [busy, setBusy] = useState<string | null>(null);
  const params = useSearchParams();
  const [openProposal, setOpenProposal] = useState<string | null>(() => params.get("proposal"));
  const [openOpportunity, setOpenOpportunity] = useState<string | null>(null);
  const [composing, setComposing] = useState<{ id: string; label: string } | null>(null);
  const { hasPermission } = usePermissions();
  const canManage = hasPermission("commercial.proposals.manage");
  const canApprove = hasPermission("commercial.proposals.approve_internal");
  const { success, error: notifyError } = useHudToast();
  const contexts = useMemo(
    () => groupProposalContexts<ProposalRow, RevisionRow>(data?.proposals ?? [], data?.revisions ?? []),
    [data],
  );
  const transition = async (ctx: ProposalContext<ProposalRow, RevisionRow>, to: string) => {
    if (busy) return;
    setBusy(ctx.key);
    try {
      const response = await fetch(`/api/commercial/proposals/${ctx.primaryId}/context`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok)
        throw new Error(payload.error || "Não foi possível atualizar.");
      success(proposalStatusLabels[to as ProposalRevisionStatus] ?? to,
        ctx.members.length > 1 ? "PT e PC andaram juntas." : undefined);
      refresh();
    } catch (e) {
      notifyError("Transição recusada", (e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  if (state !== "ready" || !data)
    return <ResourceState state={state} message={message} />;
  const metrics = contextMetrics(contexts);
  const rows = contexts.filter(
    (c) =>
      matches(search, c.title, c.counterparty, ...c.members.map((m) => m.proposal.proposal_number)) &&
      (kind === "all" || composition(c) === kind) &&
      (status === "all" || c.stage === status),
  );
  return (
    <section className="crm-workspace" aria-label="Propostas">
      <WorkspaceHeading
        eyebrow="Comercial · Propostas"
        title="Propostas"
        description={
          <>
            <span><b>{metrics.preparing}</b> em preparação</span>
            <i className="crm-live-sep" aria-hidden />
            <span><b>{metrics.internalApproval}</b> em aprovação interna</span>
            <i className="crm-live-sep" aria-hidden />
            <span><b>{metrics.withCustomer}</b> com o cliente</span>
            <i className="crm-live-sep" aria-hidden />
            <span><b>{metrics.accepted}</b> aceita(s)</span>
            <i className="crm-live-sep" aria-hidden />
            <span className={metrics.missingPdf ? "crm-tone-warning" : undefined}><b>{metrics.missingPdf}</b> sem PDF</span>
          </>
        }
        action={<CreateCommercialButton kind="proposal" onCreated={refresh} onOpen={setOpenProposal} />}
      />
      <Metrics
        items={[
          {
            label: "Propostas",
            value: metrics.total,
            hint: `PT + PC contam como uma · ${data.proposals.length} documento(s)`,
            accent: true,
          },
          {
            label: "Em preparação",
            value: metrics.preparing,
            hint: "Rascunho até aprovada para envio",
          },
          {
            label: "Com o cliente",
            value: metrics.withCustomer,
            hint: "Pacote enviado, aguardando decisão",
          },
          {
            label: "Aceitas",
            value: metrics.accepted,
            hint: "Elegíveis para iniciar execução",
          },
        ]}
      />
      <Panel
        title="Central de propostas"
        note="Uma linha por proposta: técnica e comercial juntas, cada uma com sua revisão regente."
      >
        <div className="p-4 border-b border-ig-border-subtle">
          <Segments
            label="Status das propostas"
            value={status}
            onChange={setStatus}
            options={[
              { value: "all", label: "Todas", count: metrics.total },
              { value: "DRAFT", label: "Rascunhos", count: metrics.count("DRAFT") },
              { value: "INTERNAL_APPROVAL", label: "Aprovação interna", count: metrics.count("INTERNAL_APPROVAL") },
              { value: "APPROVED_FOR_SEND", label: "Aprovadas p/ envio", count: metrics.count("APPROVED_FOR_SEND") },
              { value: "WITH_CUSTOMER", label: "Com o cliente", count: metrics.count("WITH_CUSTOMER") },
              { value: "NEGOTIATION", label: "Negociação", count: metrics.count("NEGOTIATION") },
              { value: "ACCEPTED", label: "Aceitas", count: metrics.count("ACCEPTED") },
            ]}
          />
        </div>
        <Toolbar
          search={search}
          onSearch={setSearch}
          placeholder="Buscar proposta, número PT/PC ou cliente"
        >
          <Filter
            label="Status"
            value={status}
            onChange={setStatus}
            options={[
              { value: "all", label: "Todos os status" },
              ...Object.entries(CONTEXT_STAGE_LABEL).map(([value, label]) => ({ value, label })),
            ]}
          />
          <Filter
            label="Documentos da proposta"
            value={kind}
            onChange={setKind}
            options={[
              { value: "all", label: "Todas as composições" },
              ...Object.entries(compositionLabels).map(([value, label]) => ({ value, label })),
            ]}
          />
        </Toolbar>
        <DataTable
          label="Propostas e revisões"
          columns={[
            "Proposta / cliente",
            "Documentos",
            "Oportunidade",
            "Valor",
            "Status",
            "Validade",
            "Próximo passo",
          ]}
          count={rows.length}
          footer="PT e PC contam como uma proposta · só a revisão aceita autoriza execução"
          empty={
            <EmptyNote
              title={
                contexts.length
                  ? "Nenhuma proposta neste recorte"
                  : "Nenhuma proposta registrada"
              }
              description="Importe a PT e a PC: a Apex lê, você revisa as exceções e a proposta nasce em rascunho. Aprovação interna, envio e resposta do cliente permanecem etapas distintas."
            />
          }
        >
          {rows.map((ctx) => {
            const primary = ctx.members.find((m) => m.proposal.id === ctx.primaryId)!;
            const g = primary.governing;
            // Aceita rege: nenhuma ação de aprovação sobre rascunho posterior.
            const pendingDraft = !ctx.accepted && ctx.members.some((m) => m.latest?.status === "DRAFT");
            const pendingReview = !ctx.accepted && ctx.members.some((m) => m.latest?.status === "INTERNAL_REVIEW");
            const approvedToSend = ctx.members.some((m) => m.latest?.status === "INTERNALLY_APPROVED")
              && !pendingDraft && !pendingReview;
            return (
              <Fragment key={ctx.key}>
                <tr>
                  <td>
                    <button
                      type="button"
                      className="crm-row-open"
                      onClick={() => setOpenProposal(ctx.primaryId)}
                    >
                      <strong>{ctx.title}</strong>
                    </button>
                    <p className="crm-muted">{ctx.counterparty}</p>
                  </td>
                  <td>
                    <div className="grid gap-1">
                      {ctx.members.map((m) => (
                        <span key={m.proposal.id} className="inline-flex items-center gap-1.5 whitespace-nowrap">
                          <DocTag role={ROLE[m.proposal.kind]} />
                          <span>{m.proposal.proposal_number}</span>
                          <b>{m.governing ? `R${String(m.governing.revision).padStart(2, "0")}` : "—"}</b>
                          {m.governing && !m.governing.document_id && <span className="crm-tone-warning">· sem PDF</span>}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>
                    {ctx.opportunityId
                      ? opportunities.data?.opportunities.find(
                          (o) => o.id === ctx.opportunityId,
                        )?.title || "Vinculada · título indisponível"
                      : "Sem vínculo"}
                  </td>
                  <td>{ctx.value !== null ? brl(ctx.value, ctx.currency) : "—"}</td>
                  <td>
                    <StatePill tone={stageTone[ctx.stage]}>{CONTEXT_STAGE_LABEL[ctx.stage]}</StatePill>
                    {ctx.internalApproval === "REAPPROVAL" && (
                      <p className="crm-muted">Parte do pacote sem aprovação</p>
                    )}
                    {ctx.partiallyAccepted && (
                      <p className="crm-tone-warning">Aceite parcial — pacote não aceito</p>
                    )}
                  </td>
                  <td>{day(ctx.validityUntil)}</td>
                  <td>
                    {pendingDraft && !pendingReview && canManage && (
                      <HudButton
                        variant="secondary"
                        size="sm"
                        disabled={!!busy}
                        onClick={() => transition(ctx, "INTERNAL_REVIEW")}
                      >
                        Enviar para aprovação interna
                      </HudButton>
                    )}
                    {pendingReview && canManage && canApprove && (
                      <HudButton
                        variant="primary"
                        size="sm"
                        disabled={!!busy}
                        onClick={() => transition(ctx, "INTERNALLY_APPROVED")}
                      >
                        Aprovar para envio
                      </HudButton>
                    )}
                    {approvedToSend && canManage && (
                      <HudButton
                        variant="primary"
                        size="sm"
                        disabled={!!busy}
                        onClick={() => transition(ctx, "SENT")}
                      >
                        Marcar como enviada
                      </HudButton>
                    )}
                    {!pendingDraft && !pendingReview && g && (g.status === "SENT" || g.status === "NEGOTIATION") &&
                      hasPermission("commercial.proposals.record_acceptance") && (
                        <HudButton
                          variant="primary"
                          size="sm"
                          onClick={() => setOutcomeTarget(g)}
                        >
                          Registrar resposta do cliente
                        </HudButton>
                      )}
                    {ctx.accepted && g?.status === "ACCEPTED" &&
                      hasPermission("commercial.engagements.manage") && (
                        <HudButton
                          variant="primary"
                          size="sm"
                          onClick={() =>
                            setAuthorizeTarget({ revision: g, proposal: primary.proposal })
                          }
                        >
                          Gerar trabalho autorizado
                        </HudButton>
                      )}
                    {!canManage && !g?.status && <span className="crm-muted">—</span>}
                  </td>
                </tr>
                {ctx.accepted && g?.status === "ACCEPTED" && (
                  <tr>
                    <td colSpan={7}>
                      <p className="crm-muted">
                        Pacote aceito em {day(g.accepted_at)} · manifestação:{" "}
                        {g.acceptance_source}
                        {ctx.members.length > 1 ? ` · ${ctx.members.map((m) => `${ROLE[m.proposal.kind]} R${String(m.governing?.revision ?? 0).padStart(2, "0")}`).join(" + ")}` : ""}.{" "}
                        <span>
                          Esta é a revisão que pode autorizar execução.
                        </span>
                      </p>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </DataTable>
      </Panel>
      <GovernanceNote>
        PT e PC do mesmo cliente/obra formam uma proposta: aprovação interna e
        envio acontecem para o pacote. Só a revisão aceita alimenta a execução.
        Aprovação interna e envio não representam aceite do cliente. Autorizar trabalho exige uma ação
        separada e mantém a fonte regente registrada.
      </GovernanceNote>
      {openProposal && (
        <ProposalWorkspace
          proposalId={openProposal}
          onClose={() => setOpenProposal(null)}
          onOpenOpportunity={(id) => setOpenOpportunity(id)}
          onComposeFollowup={(subject) => setComposing(subject)}
        />
      )}
      {openOpportunity && (
        <OpportunityWorkspace
          opportunityId={openOpportunity}
          onClose={() => setOpenOpportunity(null)}
          onChanged={refresh}
          onOpenProposal={(id) => setOpenProposal(id)}
        />
      )}
      {composing && (
        <FollowupComposer
          subject={{ kind: "commercial_proposal", id: composing.id, label: composing.label }}
          onClose={() => setComposing(null)}
          onCreated={() => {
            setComposing(null);
            refresh();
          }}
        />
      )}
      {authorizeTarget && (
        <AuthorizeFromProposalModal
          revisionId={authorizeTarget.revision.id}
          proposalNumber={authorizeTarget.proposal.proposal_number}
          title={authorizeTarget.proposal.title}
          counterpartyName={authorizeTarget.proposal.counterparty_name}
          totalValue={authorizeTarget.revision.total_value}
          currency={
            authorizeTarget.revision.currency ??
            authorizeTarget.proposal.currency
          }
          onClose={() => setAuthorizeTarget(null)}
          onDone={() => setAuthorizeTarget(null)}
        />
      )}
      {outcomeTarget && (
        <RecordOutcomeModal
          revisionId={outcomeTarget.id}
          revisionNumber={outcomeTarget.revision}
          onClose={() => setOutcomeTarget(null)}
        />
      )}
    </section>
  );
}
