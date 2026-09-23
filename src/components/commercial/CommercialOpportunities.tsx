"use client";

/**
 * OPORTUNIDADES — a área operacional do funil.
 *
 * ─── Paridade entre Pipeline e Lista ─────────────────────────────────────
 *
 * As duas visões mostram os MESMOS fatos: valor, responsável, idade na etapa,
 * próxima ação e sinais. O que muda é a forma de varrer — o kanban agrupa por
 * etapa, a lista ordena e compara. Quando uma visão sabia coisas que a outra
 * não, as pessoas aprendiam que "a de verdade é a Lista" e o kanban virava
 * decoração.
 *
 * O cruzamento entre oportunidade, acompanhamento e revisão é feito no
 * servidor (`/api/commercial/opportunities`): a tela recebe o veredito, não o
 * material bruto para recalculá-lo — e é por isso que lista, kanban, dossiê e
 * visão geral não conseguem discordar.
 */
import { useMemo, useState, type CSSProperties } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarPlus, Clock, X } from "lucide-react";
import { HudBadge, HudButton } from "@/components/hud";
import { usePermissions } from "@/hooks/use-permissions";
import { opportunityStageLabels } from "@/lib/commercial/labels";
import {
  OPEN_OPPORTUNITY_STAGES,
  type OpportunityStage,
} from "@/lib/commercial/types";
import { STAGE_STALL_DAYS, daysBetween, isOpenStage } from "@/lib/commercial/stage-policy";
import {
  signalsByOpportunity,
  type PipelineSignal,
  type PipelineSignalKind,
} from "@/lib/commercial/pipeline-signals";
import type { FollowupState } from "@/lib/platform/followups/types";
import { brl, day, ResourceState, useCommercialResource } from "./shared";
import {
  DataTable, EmptyNote, Filter, GovernanceNote, matches, Metrics, moneyTotal,
  Panel, Segments, Toolbar, WorkspaceHeading,
} from "./workspace";
import { SignalDots, relativeDays } from "./detail";
import { CreateCommercialButton } from "./CreateCommercialModal";
import { OpportunityWorkspace } from "./OpportunityWorkspace";
import { ProposalWorkspace } from "./ProposalWorkspace";
import { AccountWorkspace } from "./AccountWorkspace";
import { FollowupComposer } from "./FollowupComposer";

export type OpportunityRow = {
  id: string;
  code: string | null;
  title: string;
  counterparty_name: string;
  party_id: string | null;
  stage: OpportunityStage;
  estimated_value: string | null;
  currency: string;
  probability: string | null;
  expected_decision_date: string | null;
  owner_user_id: string | null;
  engagement_id: string | null;
  closed_at: string | null;
  lost_reason: string | null;
  stage_entered_at: string | null;
  created_at: string;
};

type NextAction = {
  id: string;
  goal: string;
  state: FollowupState;
  due_date: string | null;
  next_expected_event: string | null;
  next_expected_event_at: string | null;
};

type Payload = {
  opportunities: OpportunityRow[];
  signals: PipelineSignal[];
  nextActions: Record<string, NextAction>;
  owners: Record<string, string>;
};

export const stageHints: Record<string, string> = {
  QUALIFICATION: "Identifique a necessidade e o potencial da conta.",
  DISCOVERY: "Entenda o escopo, os envolvidos e a decisão.",
  PROPOSAL: "Estruture a solução e a proposta para o cliente.",
  NEGOTIATION: "Alinhe condições e registre a resposta do cliente.",
};
const stageColors = ["#6b9eca", "#8b8bc9", "#c49a63", "#64b6a4"];

/** Os recortes por sinal. Cada um é uma regra, não uma etiqueta subjetiva. */
const SIGNAL_FILTERS: Array<{ value: string; label: string; kinds: PipelineSignalKind[] }> = [
  { value: "stalled", label: "Paradas", kinds: ["OPPORTUNITY_STALLED"] },
  { value: "no_next_action", label: "Sem próxima ação", kinds: ["NO_NEXT_ACTION"] },
  { value: "overdue", label: "Retorno atrasado", kinds: ["CUSTOMER_RESPONSE_OVERDUE"] },
  { value: "no_close", label: "Sem previsão", kinds: ["MISSING_EXPECTED_CLOSE"] },
  {
    value: "proposal_risk",
    label: "Proposta a vencer",
    kinds: ["PROPOSAL_EXPIRING", "PROPOSAL_VALIDITY_LAPSED"],
  },
  {
    value: "inconsistent",
    label: "Etapa × probabilidade",
    kinds: ["STAGE_PROBABILITY_INCONSISTENT"],
  },
];

export function CommercialOpportunities() {
  const { data, state, message, refresh } = useCommercialResource<Payload>(
    "/api/commercial/opportunities",
  );
  const { hasPermission } = usePermissions();
  const canManage = hasPermission("commercial.manage");
  const [view, setView] = useState("pipeline");
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState("all");
  const [currency, setCurrency] = useState("all");
  const [owner, setOwner] = useState("all");
  const [signalFilter, setSignalFilter] = useState("all");
  /*
    Ligações diretas: `?opportunity=` abre o dossiê (aviso, tela de campo,
    link compartilhado); `?month=AAAA-MM` e `?owner=` chegam do forecast
    quando alguém clica num mês — o recorte vira filtro visível e removível.
  */
  const params = useSearchParams();
  const [openOpportunity, setOpenOpportunity] = useState<string | null>(() => params.get("opportunity"));
  const [month, setMonth] = useState<string | null>(() => {
    const value = params.get("month");
    return value && /^\d{4}-\d{2}$/.test(value) ? value : null;
  });
  const [openProposal, setOpenProposal] = useState<string | null>(null);
  const [openAccount, setOpenAccount] = useState<string | null>(null);
  const [composing, setComposing] = useState<{ id: string; label: string } | null>(null);

  const byOpportunity = useMemo(
    () => signalsByOpportunity(data?.signals ?? []),
    [data?.signals],
  );

  if (state !== "ready" || !data) {
    return <ResourceState state={state} message={message} />;
  }

  const all = data.opportunities;
  const ownerName = (row: OpportunityRow) =>
    row.owner_user_id
      ? (data.owners[row.owner_user_id] ?? "Não identificado")
      : "Sem responsável";

  const signalKinds = SIGNAL_FILTERS.find((f) => f.value === signalFilter)?.kinds;
  const rows = all.filter((r) => {
    if (!matches(search, r.title, r.counterparty_name, r.code)) return false;
    if (stage !== "all" && stage !== r.stage) return false;
    if (currency !== "all" && r.currency !== currency) return false;
    if (month && (r.expected_decision_date ?? "").slice(0, 7) !== month) return false;
    if (owner !== "all") {
      if (owner === "unassigned" ? !!r.owner_user_id : r.owner_user_id !== owner) return false;
    }
    if (signalKinds) {
      const found = byOpportunity.get(r.id) ?? [];
      if (!found.some((signal) => signalKinds.includes(signal.kind))) return false;
    }
    return true;
  });

  const open = all.filter((r) => isOpenStage(r.stage));
  const won = all.filter((r) => r.stage === "WON");
  const stages = stage !== "all" && isOpenStage(stage as OpportunityStage)
    ? [stage as OpportunityStage]
    : OPEN_OPPORTUNITY_STAGES;
  const countBySignal = (kinds: PipelineSignalKind[]) =>
    all.filter((r) =>
      (byOpportunity.get(r.id) ?? []).some((signal) => kinds.includes(signal.kind)),
    ).length;

  const empty = (
    <EmptyNote
      title={all.length ? "Nenhum resultado para estes filtros" : "Nenhuma oportunidade registrada"}
      description="Comece pela qualificação. O funil acompanha cada conversa até a decisão do cliente."
    />
  );

  const ageCell = (row: OpportunityRow) => {
    const age = daysBetween(row.stage_entered_at, new Date());
    const limit = STAGE_STALL_DAYS[row.stage];
    const stalled = age !== null && limit !== undefined && age > limit;
    return (
      <span className={stalled ? "crm-aging-stalled" : undefined}>
        {age === null ? "—" : `${age} d`}
        {limit !== undefined && (
          <span className="crm-muted"> / {limit} d</span>
        )}
      </span>
    );
  };

  const nextActionLabel = (row: OpportunityRow) => {
    const action = data.nextActions[row.id];
    if (!action) return <span className="crm-missing">Sem próxima ação</span>;
    return (
      <>
        <strong>{action.goal}</strong>
        <p className="crm-muted">
          {action.due_date ? day(action.due_date) : "sem prazo"}
          {action.next_expected_event_at
            ? ` · retorno ${day(action.next_expected_event_at)}`
            : ""}
        </p>
      </>
    );
  };

  return (
    <section className="crm-workspace" aria-label="Oportunidades">
      <WorkspaceHeading
        eyebrow="Comercial · Oportunidades"
        title="Oportunidades"
        description={
          <>
            <span><b>{open.length}</b> abertas</span>
            <i className="crm-live-sep" aria-hidden />
            <span><b>{moneyTotal(open.map((r) => ({ value: r.estimated_value, currency: r.currency })))}</b> em pipeline</span>
            <i className="crm-live-sep" aria-hidden />
            <span><b>{won.length}</b> ganha(s)</span>
          </>
        }
        action={<CreateCommercialButton kind="opportunity" onCreated={refresh} onOpen={setOpenOpportunity} />}
      />

      <Metrics
        items={[
          {
            label: "Pipeline em aberto",
            value: moneyTotal(
              open.map((r) => ({ value: r.estimated_value, currency: r.currency })),
            ),
            hint: `${open.length} oportunidades abertas`,
            accent: true,
          },
          {
            label: "Paradas",
            value: countBySignal(["OPPORTUNITY_STALLED"]),
            tone: countBySignal(["OPPORTUNITY_STALLED"]) ? "warning" : "neutral",
            hint: "Além do limiar declarado da etapa",
            onClick: () => setSignalFilter("stalled"),
          },
          {
            label: "Sem próxima ação",
            value: countBySignal(["NO_NEXT_ACTION"]),
            tone: countBySignal(["NO_NEXT_ACTION"]) ? "warning" : "neutral",
            hint: "Nenhum acompanhamento aberto",
            onClick: () => setSignalFilter("no_next_action"),
          },
          {
            label: "Retorno atrasado",
            value: countBySignal(["CUSTOMER_RESPONSE_OVERDUE"]),
            tone: countBySignal(["CUSTOMER_RESPONSE_OVERDUE"]) ? "danger" : "neutral",
            hint: "Cliente passou da data que combinou",
            onClick: () => setSignalFilter("overdue"),
          },
        ]}
      />

      <Panel
        title={view === "pipeline" ? "Pipeline" : "Lista"}
        note={view === "pipeline" ? "Quatro etapas abertas · encerradas ficam na Lista" : "Todas as oportunidades, abertas e encerradas"}
        aside={
          <Segments
            label="Visualização"
            value={view}
            onChange={setView}
            options={[
              { value: "pipeline", label: "Pipeline" },
              { value: "list", label: "Lista" },
            ]}
          />
        }
      >
        {month && (
          <div className="flow-filter-chip-row">
            <button type="button" className="flow-filter-chip" onClick={() => { setMonth(null); setView("pipeline"); }}
              aria-label={`Remover filtro de decisão em ${month}`}>
              Decisão prevista em {new Date(`${month}-15T12:00:00`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}
              <X size={12} aria-hidden />
            </button>
            <span className="crm-muted">{rows.length} oportunidade(s) · recorte vindo do forecast</span>
          </div>
        )}
        <div className="crm-subbar">
          <Segments
            label="Recorte por sinal"
            value={signalFilter}
            onChange={setSignalFilter}
            options={[
              { value: "all", label: "Todas", count: all.length },
              ...SIGNAL_FILTERS.map((filter) => ({
                value: filter.value,
                label: filter.label,
                count: countBySignal(filter.kinds),
              })),
            ]}
          />
        </div>

        <Toolbar
          search={search}
          onSearch={setSearch}
          placeholder="Buscar oportunidade ou cliente"
        >
          <Filter
            label="Etapa"
            value={stage}
            onChange={setStage}
            options={[
              { value: "all", label: "Todas as etapas" },
              ...Object.entries(opportunityStageLabels).map(([value, label]) => ({ value, label })),
            ]}
          />
          <Filter
            label="Responsável"
            value={owner}
            onChange={setOwner}
            options={[
              { value: "all", label: "Todos os responsáveis" },
              { value: "unassigned", label: "Sem responsável" },
              ...Object.entries(data.owners).map(([value, label]) => ({ value, label })),
            ]}
          />
          <Filter
            label="Moeda"
            value={currency}
            onChange={setCurrency}
            options={[
              { value: "all", label: "Todas as moedas" },
              ...Array.from(new Set(all.map((r) => r.currency))).map((value) => ({
                value,
                label: value,
              })),
            ]}
          />
        </Toolbar>

        {view === "pipeline" ? (
          <>
            <div
              className="crm-pipeline-scroll"
              role="region"
              aria-label="Etapas do pipeline"
              tabIndex={0}
            >
              <div
                className="crm-pipeline"
                style={stages.length === 1 ? { gridTemplateColumns: "minmax(240px, 1fr)" } : undefined}
              >
                {stages.map((s, i) => {
                  const items = rows.filter((r) => r.stage === s);
                  return (
                    <div
                      key={s}
                      className="crm-stage"
                      style={{ "--stage-color": stageColors[i % 4] } as CSSProperties}
                    >
                      <div className="crm-stage-heading">
                        <h3>{opportunityStageLabels[s]}</h3>
                        <HudBadge variant="subtle">{items.length}</HudBadge>
                      </div>
                      <p className="crm-stage-total">
                        {moneyTotal(
                          items.map((r) => ({ value: r.estimated_value, currency: r.currency })),
                        )}
                      </p>
                      <p className="crm-stage-limit">limiar de etapa · {STAGE_STALL_DAYS[s]} d</p>
                      {!items.length ? (
                        <p className="crm-stage-empty">
                          {stageHints[s] ?? "Resultados comerciais encerrados."}
                        </p>
                      ) : (
                        <ul>
                          {items.map((r) => {
                            const age = daysBetween(r.stage_entered_at, new Date());
                            const limit = STAGE_STALL_DAYS[r.stage];
                            const stalled = age !== null && limit !== undefined && age > limit;
                            const action = data.nextActions[r.id];
                            return (
                              <li key={r.id} className="crm-opportunity">
                                <button
                                  type="button"
                                  className="crm-opportunity-open"
                                  onClick={() => setOpenOpportunity(r.id)}
                                >
                                  <h4>{r.title}</h4>
                                  <p className="crm-muted">{r.counterparty_name}</p>
                                  <div className="crm-opportunity-footer">
                                    <strong>{brl(r.estimated_value, r.currency)}</strong>
                                    <span>
                                      {r.probability !== null
                                        ? `${Math.round(Number(r.probability) * 100)}%`
                                        : "Prob. do estágio"}
                                    </span>
                                  </div>
                                  {r.probability !== null && (
                                    <span className="crm-meter" aria-hidden>
                                      <i style={{ width: `${Math.round(Number(r.probability) * 100)}%` }} />
                                    </span>
                                  )}
                                  <div className="crm-opportunity-meta">
                                    <span className={stalled ? "crm-aging-stalled" : undefined}>
                                      <Clock size={11} aria-hidden />
                                      {age === null ? "—" : `${age} d na etapa`}
                                    </span>
                                    <SignalDots signals={byOpportunity.get(r.id) ?? []} />
                                  </div>
                                  <p className="crm-muted">
                                    Decisão · {day(r.expected_decision_date)} · {ownerName(r)}
                                  </p>
                                  <p
                                    className={
                                      action ? "crm-next-action" : "crm-next-action crm-missing"
                                    }
                                  >
                                    {action ? `Próxima: ${action.goal}` : "Sem próxima ação"}
                                  </p>
                                </button>
                                {canManage && !action && (
                                  <HudButton
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setComposing({ id: r.id, label: r.title })}
                                  >
                                    <CalendarPlus size={13} aria-hidden />
                                    Agendar
                                  </HudButton>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            {!rows.length && <div className="px-5 pb-5">{empty}</div>}
            <div className="crm-table-footer">
              <span>
                {rows.filter((r) => stages.includes(r.stage)).length} oportunidade(s) neste pipeline
              </span>
              <span>
                {rows.filter((r) => !isOpenStage(r.stage)).length} encerrada(s) no recorte · consulte
                Lista
              </span>
            </div>
          </>
        ) : (
          <DataTable
            label="Lista de oportunidades"
            columns={[
              "Oportunidade",
              "Cliente",
              "Etapa",
              "Idade / limiar",
              "Valor",
              "Probabilidade",
              "Decisão prevista",
              "Responsável",
              "Próxima ação",
              "Sinais",
            ]}
            count={rows.length}
            footer="Mesmos fatos da visão Pipeline"
            empty={empty}
          >
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <button
                    type="button"
                    className="crm-row-open"
                    onClick={() => setOpenOpportunity(r.id)}
                  >
                    <strong>{r.title}</strong>
                  </button>
                  <p className="crm-muted">{r.code || "Sem código"}</p>
                </td>
                <td>
                  {r.party_id ? (
                    <button
                      type="button"
                      className="crm-row-open"
                      onClick={() => setOpenAccount(r.party_id!)}
                    >
                      {r.counterparty_name}
                    </button>
                  ) : (
                    r.counterparty_name
                  )}
                </td>
                <td>
                  <HudBadge variant={r.stage === "WON" ? "success" : "outline"}>
                    {opportunityStageLabels[r.stage]}
                  </HudBadge>
                </td>
                <td>{ageCell(r)}</td>
                <td>{brl(r.estimated_value, r.currency)}</td>
                <td>
                  {r.probability !== null
                    ? `${Math.round(Number(r.probability) * 100)}%`
                    : "Padrão do estágio"}
                </td>
                <td>
                  {day(r.expected_decision_date)}
                  {r.expected_decision_date && (
                    <p className="crm-muted">
                      {relativeDays(-(daysBetween(r.expected_decision_date, new Date()) ?? 0))}
                    </p>
                  )}
                </td>
                <td>{ownerName(r)}</td>
                <td>{nextActionLabel(r)}</td>
                <td>
                  <SignalDots signals={byOpportunity.get(r.id) ?? []} />
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>

      <GovernanceNote>
        {won.filter((r) => !r.engagement_id).length} oportunidade(s) ganha(s) sem trabalho
        autorizado aberto. Ganhar registra o resultado comercial; a autorização da execução é um
        ato separado. Mudar de etapa é ato governado: fica no histórico, e encerrar como perdida
        ou abandonada exige motivo.
      </GovernanceNote>

      {openOpportunity && (
        <OpportunityWorkspace
          opportunityId={openOpportunity}
          onClose={() => setOpenOpportunity(null)}
          onChanged={refresh}
          onOpenProposal={(id) => setOpenProposal(id)}
          onOpenAccount={(id) => setOpenAccount(id)}
        />
      )}
      {openProposal && (
        <ProposalWorkspace
          proposalId={openProposal}
          onClose={() => setOpenProposal(null)}
          onOpenOpportunity={(id) => setOpenOpportunity(id)}
        />
      )}
      {openAccount && (
        <AccountWorkspace
          partyId={openAccount}
          onClose={() => setOpenAccount(null)}
          onOpenOpportunity={(id) => setOpenOpportunity(id)}
          onOpenProposal={(id) => setOpenProposal(id)}
        />
      )}
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
    </section>
  );
}
