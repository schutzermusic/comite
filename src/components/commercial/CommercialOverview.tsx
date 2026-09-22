"use client";

import { ArrowUpRight } from "lucide-react";
import { HudButton } from "@/components/hud";
import type { CommercialSectionId } from "@/lib/commercial/navigation";
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

type RevisionRow = {
  id: string;
  proposal_id: string;
  status: string;
  total_value: string | null;
  currency: string | null;
};
export function CommercialOverview({
  onNavigate,
}: {
  onNavigate: (section: CommercialSectionId) => void;
}) {
  const opportunities = useCommercialResource<{
    opportunities: OpportunityRow[];
    signals: PipelineSignal[];
  }>("/api/commercial/opportunities");
  const proposals = useCommercialResource<{
    revisions: RevisionRow[];
    proposals: { id: string; currency: string }[];
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
  const revisions = proposals.data?.revisions ?? [];
  const open = rows.filter((r) => OPEN_OPPORTUNITY_STAGES.includes(r.stage));
  const accepted = revisions.filter((r) => r.status === "ACCEPTED");
  const sent = revisions.filter((r) =>
    ["SENT", "NEGOTIATION"].includes(r.status),
  ).length;
  const won = rows.filter((r) => r.stage === "WON");
  const decided = rows.filter((r) => ["WON", "LOST"].includes(r.stage));
  const recent = rows.filter(
    (r) =>
      r.created_at &&
      Date.now() - new Date(r.created_at).getTime() <= 30 * 86400000,
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
  return (
    <section className="crm-workspace" aria-label="Visão geral do comercial">
      <WorkspaceHeading
        eyebrow="Visão geral · Relacionamento → Resultado"
        title="Clareza para o próximo movimento."
        description="Do primeiro contato ao aceite, uma visão conectada da operação comercial."
        action={
          <CreateCommercialButton
            kind="opportunity"
            onCreated={() => {
              opportunities.refresh();
              forecast.refresh();
            }}
          />
        }
      />
      <Metrics
        items={[
          {
            label: "Pipeline em aberto",
            value: moneyTotal(
              open.map((r) => ({
                value: r.estimated_value,
                currency: r.currency,
              })),
            ),
            hint: `${open.length} oportunidades em andamento`,
            accent: true,
            onClick: () => onNavigate("opportunities"),
          },
          {
            label: "Propostas com o cliente",
            value: sent,
            hint: "Revisões enviadas ou em negociação",
            onClick: () => onNavigate("proposals"),
          },
          {
            label: "Sinais bloqueantes",
            value: blocking,
            hint: blocking
              ? "Retorno atrasado ou validade vencida"
              : "Nenhuma pendência bloqueante",
            onClick: () => onNavigate("opportunities"),
          },
          {
            label: "Pipeline ponderado",
            value: moneyTotal(
              (forecast.data?.rows ?? []).map((r) => ({
                value: r.weighted_value,
                currency: r.currency,
              })),
            ),
            hint: "Valor × probabilidade aplicada",
            onClick: () => onNavigate("forecast"),
          },
        ]}
      />
      <div className="crm-split">
        <Panel
          title="O caminho até o aceite"
          note="Distribuição das oportunidades abertas por etapa"
          aside={
            <HudButton
              variant="ghost"
              size="sm"
              onClick={() => onNavigate("opportunities")}
            >
              Ver pipeline <ArrowUpRight size={14} />
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
                    <span>{stageRows.length} oportunidades</span>
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
            <span>Qualificação → Descoberta → Proposta → Negociação</span>
            <span>{won.length} ganha(s)</span>
          </div>
        </Panel>
        <Panel
          title="O que precisa de decisão"
          note="Regras determinísticas sobre datas e estados — não recomendações genéricas."
        >
          {QUEUE.map((entry) => {
            const total = signalCount(entry.kinds);
            return (
              <button
                key={entry.id}
                className="crm-queue-item"
                onClick={() => onNavigate(entry.target)}
              >
                <div>
                  {entry.label}
                  <p className="crm-muted">{entry.note}</p>
                </div>
                <strong className={total > 0 ? "crm-queue-open" : undefined}>{total}</strong>
              </button>
            );
          })}
          <button
            className="crm-queue-item"
            onClick={() => onNavigate("proposals")}
          >
            <div>
              Acompanhar resposta do cliente
              <p className="crm-muted">Revisões enviadas e em negociação</p>
            </div>
            <strong>{sent}</strong>
          </button>
          <button
            className="crm-queue-item"
            onClick={() => onNavigate("followups")}
          >
            <span>Abrir fila de follow-ups</span>
            <ArrowUpRight size={16} />
          </button>
        </Panel>
      </div>
      <Metrics
        items={[
          {
            label: "Conversão",
            value: decided.length
              ? `${Math.round((won.length / decided.length) * 100)}%`
              : "—",
            hint: decided.length
              ? "Ganhas ÷ (ganhas + perdidas)"
              : "Aguardando oportunidades decididas",
          },
          {
            label: "Ritmo comercial",
            value: recent,
            hint: "Oportunidades criadas nos últimos 30 dias",
          },
          {
            label: "Valor aceito pelo cliente",
            value: moneyTotal(
              accepted.map((r) => ({
                value: r.total_value,
                currency:
                  r.currency ??
                  proposals.data?.proposals.find((p) => p.id === r.proposal_id)
                    ?.currency,
              })),
            ),
            hint: "Valor das revisões aceitas",
          },
          {
            label: "Sinais abertos",
            value: signals.length,
            hint: signals.length
              ? Array.from(new Set(signals.map((s) => PIPELINE_SIGNAL_LABEL[s.kind])))
                  .slice(0, 3)
                  .join(" · ")
              : "Prazos, próximas ações e validade em dia",
          },
        ]}
      />
      <GovernanceNote>
        Aceite do cliente não é trabalho autorizado nem receita. A revisão
        aceita pode ser a fonte de uma autorização explícita; a execução segue
        na Carteira, nas Ordens de Serviço e nos Projetos.
      </GovernanceNote>
    </section>
  );
}
