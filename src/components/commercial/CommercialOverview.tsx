"use client";

import { useRouter } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { HudButton } from "@/components/hud";
import type { CommercialSectionId } from "@/lib/commercial/navigation";
import {
  contextMetrics, groupProposalContexts, type ContextProposal, type ContextRevision,
} from "@/lib/commercial/proposal-context";
import { OPEN_OPPORTUNITY_STAGES } from "@/lib/commercial/types";
import { opportunityStageLabels } from "@/lib/commercial/labels";
import {
  PIPELINE_SIGNAL_LABEL,
  type PipelineSignal,
  type PipelineSignalKind,
} from "@/lib/commercial/pipeline-signals";
import type { OpportunityRow } from "./CommercialOpportunities";
import type { ForecastRow } from "./CommercialForecast";
import { ResourceState, useCommercialResource } from "./shared";
import {
  GovernanceNote,
  Metrics,
  moneyTotal,
  Panel,
  WorkspaceHeading,
} from "./workspace";
import { CreateCommercialButton } from "./CreateCommercialModal";

/**
 * A fila da visão geral.
 *
 * Cada linha é um SINAL do funil, e não um contador inventado para a tela: os
 * mesmos que aparecem no dossiê e no recorte de Oportunidades, contados uma vez
 * só no servidor. É isto que impede a visão geral de dizer "3" enquanto a lista
 * mostra 5.
 */
const QUEUE: Array<{
  id: string;
  label: string;
  note: string;
  kinds: PipelineSignalKind[];
  target: CommercialSectionId;
}> = [
  {
    id: "no_next_action",
    label: "Combinar o próximo passo",
    note: "Oportunidades abertas sem acompanhamento",
    kinds: ["NO_NEXT_ACTION"],
    target: "opportunities",
  },
  {
    id: "overdue",
    label: "Retomar contato",
    note: "Cliente passou da data de retorno que combinou",
    kinds: ["CUSTOMER_RESPONSE_OVERDUE"],
    target: "followups",
  },
  {
    id: "proposal_risk",
    label: "Decidir antes da validade",
    note: "Propostas a vencer ou já fora da validade",
    kinds: ["PROPOSAL_EXPIRING", "PROPOSAL_VALIDITY_LAPSED"],
    target: "proposals",
  },
  {
    id: "stalled",
    label: "Destravar ou encerrar",
    note: "Paradas além do limiar declarado da etapa",
    kinds: ["OPPORTUNITY_STALLED"],
    target: "opportunities",
  },
  {
    id: "missing_close",
    label: "Definir previsão de decisão",
    note: "Abertas sem data — fora de todo mês do forecast",
    kinds: ["MISSING_EXPECTED_CLOSE"],
    target: "forecast",
  },
  {
    id: "won_without_work",
    label: "Revisar passagem para execução",
    note: "Ganhas sem trabalho autorizado aberto",
    kinds: ["WON_WITHOUT_AUTHORIZED_WORK"],
    target: "opportunities",
  },
];

type RevisionRow = ContextRevision;
export function CommercialOverview({
  onNavigate,
}: {
  onNavigate: (section: CommercialSectionId) => void;
}) {
  const router = useRouter();
  const opportunities = useCommercialResource<{
    opportunities: OpportunityRow[];
    signals: PipelineSignal[];
  }>("/api/commercial/opportunities");
  const proposals = useCommercialResource<{
    revisions: RevisionRow[];
    proposals: ContextProposal[];
  }>("/api/commercial/proposals");
  const forecast = useCommercialResource<{ rows: ForecastRow[] }>(
    "/api/commercial/forecast",
  );
  const resources = [opportunities, proposals, forecast];
  const failed = resources.find((r) => r.state === "error");
  if (failed) return <ResourceState state="error" message={failed.message} />;
  if (resources.some((r) => r.state === "loading"))
    return <ResourceState state="loading" message={null} />;
  const rows = opportunities.data?.opportunities ?? [];
  // PT + PC = uma proposta: contadores e valores por CONTEXTO, nunca por documento.
  const contexts = groupProposalContexts(proposals.data?.proposals ?? [], proposals.data?.revisions ?? []);
  const open = rows.filter((r) => OPEN_OPPORTUNITY_STAGES.includes(r.stage));
  const accepted = contexts.filter((c) => c.accepted);
  const sent = contextMetrics(contexts).withCustomer;
  const won = rows.filter((r) => r.stage === "WON");
  const decided = rows.filter((r) => ["WON", "LOST"].includes(r.stage));
  const now = new Date();
  const recent = rows.filter(
    (r) =>
      r.created_at &&
      now.getTime() - new Date(r.created_at).getTime() <= 30 * 86400000,
  ).length;
  const signals = opportunities.data?.signals ?? [];
  const signalCount = (kinds: PipelineSignalKind[]) =>
    signals.filter((signal) => kinds.includes(signal.kind)).length;
  const blocking = signals.filter((signal) => signal.severity === "blocking").length;
  const maxCount = Math.max(
    1,
    ...OPEN_OPPORTUNITY_STAGES.map(
      (s) => open.filter((r) => r.stage === s).length,
    ),
  );
  const weighted = moneyTotal(
    (forecast.data?.rows ?? []).map((r) => ({
      value: r.weighted_value,
      currency: r.currency,
    })),
  );
  const conversion = decided.length ? won.length / decided.length : null;
  const today = new Date().toISOString().slice(0, 10);
  const horizon = new Date(now.getTime() + 30 * 86400000).toISOString().slice(0, 10);
  const closing = open
    .filter((r) => r.expected_decision_date && r.expected_decision_date <= horizon)
    .sort((a, b) => (a.expected_decision_date ?? "").localeCompare(b.expected_decision_date ?? ""))
    .slice(0, 6);
  const openOpportunity = (id: string) =>
    router.push(`/comercial?view=oportunidades&opportunity=${id}`, { scroll: false });
  const queue = QUEUE.map((entry) => ({ ...entry, total: signalCount(entry.kinds) }));
  const pending = queue.reduce((n, q) => n + q.total, 0);
  return (
    <section className="crm-workspace" aria-label="Visão geral do comercial">
      <WorkspaceHeading
        eyebrow="Comercial · Visão geral"
        title="Visão geral"
        description={
          <>
            <span><b>{open.length}</b> abertas</span>
            <i className="crm-live-sep" aria-hidden />
            <span><b>{sent}</b> com o cliente</span>
            <i className="crm-live-sep" aria-hidden />
            <span className={blocking ? "crm-tone-danger" : undefined}><b>{blocking}</b> bloqueante(s)</span>
            <i className="crm-live-sep" aria-hidden />
            <span><b>{closing.length}</b> decisão(ões) em 30 dias</span>
          </>
        }
        action={
          <>
            <CreateCommercialButton kind="proposal" variant="secondary" onCreated={() => proposals.refresh()}
              onOpen={(id) => router.push(`/comercial?view=propostas&proposal=${id}`, { scroll: false })} />
            <CreateCommercialButton
              kind="opportunity"
              onCreated={() => {
                opportunities.refresh();
                forecast.refresh();
              }}
              onOpen={openOpportunity}
            />
          </>
        }
      />
      <Metrics
        items={[
          {
            label: "Pipeline aberto",
            value: moneyTotal(
              open.map((r) => ({
                value: r.estimated_value,
                currency: r.currency,
              })),
            ),
            hint: `${open.length} oportunidade(s) em andamento`,
            accent: true,
            onClick: () => onNavigate("opportunities"),
          },
          {
            label: "Ponderado",
            value: weighted,
            hint: "Valor × probabilidade",
            onClick: () => onNavigate("forecast"),
          },
          {
            label: "Com o cliente",
            value: sent,
            hint: "Revisões enviadas ou em negociação",
            onClick: () => onNavigate("proposals"),
          },
          {
            label: "Bloqueantes",
            value: blocking,
            tone: blocking ? "danger" : "neutral",
            hint: blocking ? "Retorno atrasado ou validade vencida" : "Nenhuma pendência bloqueante",
            onClick: () => onNavigate("opportunities"),
          },
          {
            label: "Conversão",
            value: conversion === null ? "—" : `${Math.round(conversion * 100)}%`,
            meter: conversion,
            hint: decided.length ? `${won.length} ganha(s) de ${decided.length} decidida(s)` : "Aguardando decisões",
          },
          {
            label: "Aceito pelo cliente",
            value: moneyTotal(
              accepted.map((c) => ({ value: c.value, currency: c.currency })),
            ),
            hint: `${recent} criada(s) em 30 dias`,
          },
        ]}
      />
      <div className="crm-split">
        <Panel
          title="O que precisa de decisão"
          note={pending ? `${pending} sinal(is) determinístico(s) sobre datas e estados` : "Nada pendente — prazos, próximas ações e validade em dia."}
          aside={
            <HudButton variant="ghost" size="sm" onClick={() => onNavigate("followups")}>
              Fila de follow-ups <ArrowUpRight size={14} />
            </HudButton>
          }
        >
          {queue
            .slice()
            .sort((a, b) => b.total - a.total)
            .map((entry) => (
              <button
                key={entry.id}
                className="crm-queue-item"
                onClick={() => onNavigate(entry.target)}
                data-empty={entry.total === 0}
              >
                <div>
                  {entry.label}
                  <p className="crm-muted">{entry.note}</p>
                </div>
                <strong className={entry.total > 0 ? "crm-queue-open" : undefined}>{entry.total}</strong>
              </button>
            ))}
          <button className="crm-queue-item" onClick={() => onNavigate("proposals")}>
            <div>
              Acompanhar resposta do cliente
              <p className="crm-muted">Revisões enviadas e em negociação</p>
            </div>
            <strong>{sent}</strong>
          </button>
        </Panel>
        <div className="grid gap-3 min-w-0">
          <Panel
            title="Decisões nos próximos 30 dias"
            note={closing.length ? "Previsão de decisão informada — clique para abrir o dossiê" : undefined}
          >
            {closing.length ? (
              <ul className="crm-linked-list">
                {closing.map((r) => (
                  <li key={r.id}>
                    <div>
                      <button type="button" className="crm-row-open" onClick={() => openOpportunity(r.id)}>
                        {r.title}
                      </button>
                      <p className="crm-muted">
                        {r.counterparty_name} · {opportunityStageLabels[r.stage]}
                      </p>
                    </div>
                    <div className="text-right">
                      <strong className="tabular-nums">
                        {moneyTotal([{ value: r.estimated_value, currency: r.currency }])}
                      </strong>
                      <p className={`crm-muted ${r.expected_decision_date! < today ? "crm-overdue" : ""}`}>
                        {new Date(`${r.expected_decision_date}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="crm-section-empty">
                Nenhuma oportunidade aberta com decisão prevista para os próximos 30 dias.
              </div>
            )}
          </Panel>
          <Panel
            title="Funil por etapa"
            aside={
              <HudButton variant="ghost" size="sm" onClick={() => onNavigate("opportunities")}>
                Pipeline <ArrowUpRight size={14} />
              </HudButton>
            }
          >
            <div className="crm-funnel">
              {OPEN_OPPORTUNITY_STAGES.map((s) => {
                const stageRows = open.filter((r) => r.stage === s);
                return (
                  <div className="crm-funnel-row" key={s}>
                    <span>{opportunityStageLabels[s]}</span>
                    <div className="crm-track">
                      <div
                        className="crm-track-fill"
                        style={{
                          width: `${(stageRows.length / maxCount) * 100}%`,
                        }}
                      />
                      <span>{stageRows.length}</span>
                    </div>
                    <span className="text-right tabular-nums">
                      {moneyTotal(
                        stageRows.map((r) => ({
                          value: r.estimated_value,
                          currency: r.currency,
                        })),
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="crm-table-footer">
              <span>{won.length} ganha(s)</span>
              <span>
                {signals.length
                  ? Array.from(new Set(signals.map((s) => PIPELINE_SIGNAL_LABEL[s.kind]))).slice(0, 2).join(" · ")
                  : "Sem sinais abertos"}
              </span>
            </div>
          </Panel>
        </div>
      </div>
      <GovernanceNote>
        Aceite do cliente não é trabalho autorizado nem receita. A revisão
        aceita pode ser a fonte de uma autorização explícita; a execução segue
        na Carteira, nas Ordens de Serviço e nos Projetos.
      </GovernanceNote>
    </section>
  );
}
