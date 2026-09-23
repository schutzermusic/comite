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
  Toolbar,
  WorkspaceHeading,
} from "./workspace";
type ProposalRow = {
  id: string;
  proposal_number: string;
  kind: ProposalKind;
  title: string;
  counterparty_name: string;
  currency: string;
  opportunity_id: string | null;
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

const kindLabels: Record<ProposalKind, string> = {
  TECHNICAL: "Técnica",
  COMMERCIAL: "Comercial",
  COMBINED: "Técnica + Comercial",
};

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
  const { success, error: notifyError } = useHudToast();
  // An accepted revision continues governing even when a newer draft exists.
  const governing = useMemo(() => {
    const map = new Map<string, RevisionRow>();
    for (const revision of data?.revisions ?? []) {
      const current = map.get(revision.proposal_id);
      if (revision.status === "ACCEPTED") {
        map.set(revision.proposal_id, revision);
        continue;
      }
      if (current?.status === "ACCEPTED") continue;
      if (!current || revision.revision > current.revision)
        map.set(revision.proposal_id, revision);
    }
    return map;
  }, [data]);
  const transition = async (revisionId: string, to: string) => {
    if (busy) return;
    setBusy(revisionId);
    try {
      const response = await fetch("/api/commercial/proposals", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ revisionId, to }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok)
        throw new Error(payload.error || "Não foi possível atualizar.");
      success(
        `Revisão em ${proposalStatusLabels[to as ProposalRevisionStatus] ?? to}`,
      );
      refresh();
    } catch (e) {
      notifyError("Transição recusada", (e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  if (state !== "ready" || !data)
    return <ResourceState state={state} message={message} />;
  const live = [...governing.values()];
  const withoutPdf = live.filter((r) => !r.document_id).length;
  const count = (...statuses: string[]) =>
    live.filter((r) => statuses.includes(r.status)).length;
  const rows = data.proposals.filter(
    (p) =>
      matches(search, p.title, p.counterparty_name, p.proposal_number) &&
      (kind === "all" || p.kind === kind) &&
      (status === "all" || governing.get(p.id)?.status === status),
  );
  return (
    <section className="crm-workspace" aria-label="Propostas">
      <WorkspaceHeading
        eyebrow="Comercial · Propostas"
        title="Propostas"
        description={
          <>
            <span><b>{count("DRAFT", "INTERNAL_REVIEW", "INTERNALLY_APPROVED")}</b> em preparação</span>
            <i className="crm-live-sep" aria-hidden />
            <span><b>{count("SENT", "NEGOTIATION")}</b> com o cliente</span>
            <i className="crm-live-sep" aria-hidden />
            <span><b>{count("ACCEPTED")}</b> aceita(s)</span>
            <i className="crm-live-sep" aria-hidden />
            <span className={withoutPdf ? "crm-tone-warning" : undefined}><b>{withoutPdf}</b> sem PDF</span>
          </>
        }
        action={<CreateCommercialButton kind="proposal" onCreated={refresh} onOpen={setOpenProposal} />}
      />
      <Metrics
        items={[
          {
            label: "Propostas",
            value: data.proposals.length,
            hint: "Documentos comerciais registrados",
            accent: true,
          },
          {
            label: "Em preparação",
            value: count("DRAFT", "INTERNAL_REVIEW", "INTERNALLY_APPROVED"),
            hint: "Da elaboração à aprovação interna",
          },
          {
            label: "Com o cliente",
            value: count("SENT", "NEGOTIATION"),
            hint: "Aguardando decisão",
          },
          {
            label: "Revisões aceitas",
            value: count("ACCEPTED"),
            hint: "Elegíveis para autorizar trabalho",
          },
        ]}
      />
      <Panel
        title="Central de propostas"
        note="A revisão aceita fica em destaque; na ausência de aceite, a mais recente."
      >
        <div className="p-4 border-b border-ig-border-subtle">
          <Segments
            label="Status das propostas"
            value={status}
            onChange={setStatus}
            options={[
              { value: "all", label: "Todas", count: data.proposals.length },
              { value: "DRAFT", label: "Rascunhos", count: count("DRAFT") },
              {
                value: "INTERNAL_REVIEW",
                label: "Revisão interna",
                count: count("INTERNAL_REVIEW"),
              },
              { value: "SENT", label: "Enviadas", count: count("SENT") },
              {
                value: "NEGOTIATION",
                label: "Negociação",
                count: count("NEGOTIATION"),
              },
              { value: "ACCEPTED", label: "Aceitas", count: count("ACCEPTED") },
            ]}
          />
        </div>
        <Toolbar
          search={search}
          onSearch={setSearch}
          placeholder="Buscar proposta, número ou cliente"
        >
          <Filter
            label="Status"
            value={status}
            onChange={setStatus}
            options={[
              { value: "all", label: "Todos os status" },
              ...Object.entries(proposalStatusLabels).map(([value, label]) => ({
                value,
                label,
              })),
            ]}
          />
          <Filter
            label="Tipo de proposta"
            value={kind}
            onChange={setKind}
            options={[
              { value: "all", label: "Todos os tipos" },
              ...Object.entries(kindLabels).map(([value, label]) => ({
                value,
                label,
              })),
            ]}
          />
        </Toolbar>
        <DataTable
          label="Propostas e revisões"
          columns={[
            "Proposta / cliente",
            "Oportunidade",
            "Tipo",
            "Revisão",
            "Valor",
            "Status",
            "Validade",
            "Próximo passo",
          ]}
          count={rows.length}
          footer="Somente a revisão aceita pode autorizar execução"
          empty={
            <EmptyNote
              title={
                data.proposals.length
                  ? "Nenhuma proposta neste recorte"
                  : "Nenhuma proposta registrada"
              }
              description="Crie a primeira proposta em rascunho. Revisão interna, envio ao cliente e registro de resposta permanecem etapas distintas."
            />
          }
        >
          {rows.map((proposal) => {
            const revision = governing.get(proposal.id);
            return (
              <Fragment key={proposal.id}>
                <tr>
                  <td>
                    <button
                      type="button"
                      className="crm-row-open"
                      onClick={() => setOpenProposal(proposal.id)}
                    >
                      <strong>
                        {proposal.proposal_number} · {proposal.title}
                      </strong>
                    </button>
                    <p className="crm-muted">{proposal.counterparty_name}</p>
                  </td>
                  <td>
                    {proposal.opportunity_id
                      ? opportunities.data?.opportunities.find(
                          (o) => o.id === proposal.opportunity_id,
                        )?.title || "Vinculada · título indisponível"
                      : "Sem vínculo"}
                  </td>
                  <td>{kindLabels[proposal.kind]}</td>
                  <td>
                    {revision
                      ? `R${String(revision.revision).padStart(2, "0")}`
                      : "—"}
                  </td>
                  <td>
                    {brl(
                      revision?.total_value ?? null,
                      revision?.currency ?? proposal.currency,
                    )}
                  </td>
                  <td>
                    {revision ? (
                      <HudBadge
                        variant={
                          revision.status === "ACCEPTED" ? "success" : "outline"
                        }
                      >
                        {proposalStatusLabels[revision.status]}
                      </HudBadge>
                    ) : (
                      "Sem revisão"
                    )}
                  </td>
                  <td>{day(revision?.validity_until ?? null)}</td>
                  <td>
                    {revision?.status === "DRAFT" && canManage && (
                      <HudButton
                        variant="secondary"
                        size="sm"
                        disabled={!!busy}
                        onClick={() =>
                          transition(revision.id, "INTERNAL_REVIEW")
                        }
                      >
                        Enviar para revisão interna
                      </HudButton>
                    )}
                    {revision?.status === "INTERNAL_REVIEW" &&
                      canManage &&
                      hasPermission(
                        "commercial.proposals.approve_internal",
                      ) && (
                        <HudButton
                          variant="primary"
                          size="sm"
                          disabled={!!busy}
                          onClick={() =>
                            transition(revision.id, "INTERNALLY_APPROVED")
                          }
                        >
                          Aprovar internamente
                        </HudButton>
                      )}
                    {revision?.status === "INTERNALLY_APPROVED" &&
                      canManage && (
                        <HudButton
                          variant="primary"
                          size="sm"
                          disabled={!!busy}
                          onClick={() => transition(revision.id, "SENT")}
                        >
                          Marcar como enviada
                        </HudButton>
                      )}
                    {(revision?.status === "SENT" ||
                      revision?.status === "NEGOTIATION") &&
                      hasPermission(
                        "commercial.proposals.record_acceptance",
                      ) && (
                        <HudButton
                          variant="primary"
                          size="sm"
                          onClick={() => setOutcomeTarget(revision)}
                        >
                          Registrar resposta do cliente
                        </HudButton>
                      )}
                    {revision?.status === "ACCEPTED" &&
                      hasPermission("commercial.engagements.manage") && (
                        <HudButton
                          variant="primary"
                          size="sm"
                          onClick={() =>
                            setAuthorizeTarget({ revision, proposal })
                          }
                        >
                          Gerar trabalho autorizado
                        </HudButton>
                      )}
                  </td>
                </tr>
                {revision?.status === "ACCEPTED" && (
                  <tr>
                    <td colSpan={8}>
                      <p className="crm-muted">
                        Aceita em {day(revision.accepted_at)} · manifestação:{" "}
                        {revision.acceptance_source}.{" "}
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
        Só a revisão aceita alimenta a execução. Aprovação interna e envio não
        representam aceite do cliente. Autorizar trabalho exige uma ação
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
