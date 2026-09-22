"use client";

/**
 * SOBRE O QUE é o acompanhamento.
 *
 * Um acompanhamento sem objeto é um lembrete, e lembrete não é governança: o
 * motor exige `source_kind` + `source_id`, e é esse par que faz a cobrança
 * aparecer no dossiê da oportunidade, entrar nos sinais e sumir sozinha quando
 * o assunto se resolve.
 *
 * Por isso a fila abre este passo antes do formulário, em vez de oferecer um
 * campo de texto livre. Dois cliques a mais, e nenhum compromisso órfão.
 */
import { useMemo, useState } from "react";
import { HudButton, HudModal } from "@/components/hud";
import { opportunityStageLabels, proposalStatusLabels } from "@/lib/commercial/labels";
import type { OpportunityStage, ProposalRevisionStatus } from "@/lib/commercial/types";
import { isOpenStage } from "@/lib/commercial/stage-policy";
import { governingRevision } from "@/lib/commercial/pipeline-signals";
import { ResourceState, useCommercialResource } from "./shared";
import { Segments, Toolbar, matches } from "./workspace";
import { SectionEmpty } from "./detail";
import type { FollowupSubjectKind } from "./FollowupComposer";

type OpportunityRow = {
  id: string; title: string; counterparty_name: string; stage: OpportunityStage;
};
type ProposalRow = {
  id: string; proposal_number: string; title: string; counterparty_name: string;
};
type RevisionRow = {
  id: string; proposal_id: string; revision: number; status: ProposalRevisionStatus;
};

export function FollowupSubjectPicker({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (subject: { kind: FollowupSubjectKind; id: string; label: string }) => void;
}) {
  const opportunities = useCommercialResource<{ opportunities: OpportunityRow[] }>(
    "/api/commercial/opportunities",
  );
  const proposals = useCommercialResource<{
    proposals: ProposalRow[]; revisions: RevisionRow[];
  }>("/api/commercial/proposals");
  const [kind, setKind] = useState<FollowupSubjectKind>("commercial_opportunity");
  const [search, setSearch] = useState("");

  const governing = useMemo(
    () => governingRevision(proposals.data?.revisions ?? []),
    [proposals.data?.revisions],
  );

  const loading = opportunities.state === "loading" || proposals.state === "loading";
  const failed = [opportunities, proposals].find((r) => r.state === "error");

  const openOpportunities = (opportunities.data?.opportunities ?? []).filter((row) =>
    isOpenStage(row.stage),
  );
  const proposalRows = proposals.data?.proposals ?? [];

  const items = kind === "commercial_opportunity"
    ? openOpportunities
        .filter((row) => matches(search, row.title, row.counterparty_name))
        .map((row) => ({
          id: row.id,
          label: row.title,
          hint: `${row.counterparty_name} · ${opportunityStageLabels[row.stage]}`,
        }))
    : proposalRows
        .filter((row) => matches(search, row.title, row.proposal_number, row.counterparty_name))
        .map((row) => {
          const revision = governing.get(row.id);
          return {
            id: row.id,
            label: `${row.proposal_number} · ${row.title}`,
            hint: `${row.counterparty_name}${revision ? ` · ${proposalStatusLabels[revision.status]}` : ""}`,
          };
        });

  return (
    <HudModal
      isOpen
      onClose={onClose}
      title="Sobre o que é o acompanhamento"
      subtitle="Oportunidade ou proposta — o vínculo é o que faz a cobrança aparecer no lugar certo."
      size="lg"
    >
      {loading || failed ? (
        <ResourceState
          state={failed ? "error" : "loading"}
          message={failed?.message ?? null}
        />
      ) : (
        <div className="crm-picker">
          <Segments
            label="Tipo de objeto"
            value={kind}
            onChange={(value) => setKind(value as FollowupSubjectKind)}
            options={[
              {
                value: "commercial_opportunity",
                label: "Oportunidades abertas",
                count: openOpportunities.length,
              },
              {
                value: "commercial_proposal",
                label: "Propostas",
                count: proposalRows.length,
              },
            ]}
          />
          <Toolbar search={search} onSearch={setSearch} placeholder="Buscar por título ou cliente" />
          {items.length === 0 ? (
            <SectionEmpty>
              {kind === "commercial_opportunity"
                ? "Nenhuma oportunidade aberta para acompanhar."
                : "Nenhuma proposta registrada para acompanhar."}
            </SectionEmpty>
          ) : (
            <ul className="crm-picker-list">
              {items.map((item) => (
                <li key={item.id}>
                  <div className="min-w-0">
                    <strong>{item.label}</strong>
                    <p className="crm-muted">{item.hint}</p>
                  </div>
                  <HudButton
                    variant="secondary"
                    size="sm"
                    onClick={() => onPick({ kind, id: item.id, label: item.label })}
                  >
                    Selecionar
                  </HudButton>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </HudModal>
  );
}
