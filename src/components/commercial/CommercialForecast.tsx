"use client";

/**
 * FORECAST — a leitura executiva do funil.
 *
 * ─── O que este número é, e o que ele nunca será ─────────────────────────
 *
 * É pipeline ponderado: valor estimado × probabilidade aplicada, por mês de
 * decisão prevista. Não é receita contratada, não é backlog e não entra em
 * contabilidade — e a tela diz isso em vez de confiar que todo mundo saiba.
 *
 * ─── Movimento sem fotografia diária ─────────────────────────────────────
 *
 * "O que entrou e o que saiu" costuma exigir uma tabela de snapshots do
 * pipeline, que envelhece sozinha e mente no dia em que o job não roda. Aqui o
 * movimento vem do HISTÓRICO DE ETAPA (migration 212), que é append-only e já
 * existe porque mudar de etapa virou um ato. Entrou quem passou a estar em
 * etapa aberta; saiu quem foi para ganha, perdida ou abandonada — e a janela é
 * reconstruível para qualquer período, inclusive retroativamente.
 *
 * A estrutura permanece com zero registros: eixo, colunas e tabelas continuam
 * desenhados, e o vazio é dito por escrito. Um gráfico que some quando não há
 * dado faz a pessoa duvidar se a tela carregou.
 */
import { useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { HudBadge } from "@/components/hud";
import { opportunityStageLabels } from "@/lib/commercial/labels";
import type { OpportunityStage } from "@/lib/commercial/types";
import { brl, day, ResourceState, useCommercialResource } from "./shared";
import {
  DataTable, EmptyNote, Filter, GovernanceNote, Metrics, moneyTotal, Panel,
  WorkspaceHeading,
} from "./workspace";
import { formatMoment } from "./detail";
import { OpportunityWorkspace } from "./OpportunityWorkspace";

export type ForecastRow = {
  opportunity_id: string;
  code: string | null;
  title: string;
  counterparty_name: string;
  party_id: string | null;
  stage: OpportunityStage;
  currency: string;
  estimated_value: string | null;
  informed_probability: string | null;
  applied_probability: string | null;
  probability_source: "informed" | "stage_default";
  weighted_value: string | null;
  expected_decision_date: string | null;
  owner_user_id: string | null;
  accepted_revision_count: number;
};

type MovementItem = {
  id: string;
  opportunity_id: string;
  from_stage: string | null;
  to_stage: string;
  reason: string | null;
  actor_user_id: string | null;
  occurred_at: string;
  opportunity: {
    id: string; title: string; counterparty_name: string; stage: OpportunityStage;
    estimated_value: string | null; currency: string; probability: string | null;
    expected_decision_date: string | null; lost_reason: string | null;
  };
};

type Payload = {
  rows: ForecastRow[];
  movement: { days: number; since: string; entered: MovementItem[]; left: MovementItem[] };
  owners: Record<string, string>;
  disclaimer: string;
};

export function CommercialForecast() {
  const [movementDays, setMovementDays] = useState("30");
  const { data, state, message } = useCommercialResource<Payload>(
    `/api/commercial/forecast?movementDays=${movementDays}`,
  );
  const [period, setPeriod] = useState("6");
  const [selectedCurrency, setSelectedCurrency] = useState<string | null>(null);
  const [owner, setOwner] = useState("all");
  const [customer, setCustomer] = useState("all");
  const [stage, setStage] = useState("all");
  const [openOpportunity, setOpenOpportunity] = useState<string | null>(null);

  const months = useMemo(() => {
    const now = new Date();
    return Array.from(
      { length: Number(period) },
      (_, i) => new Date(now.getFullYear(), now.getMonth() + i, 1),
    );
  }, [period]);

  if (state !== "ready" || !data) {
    return <ResourceState state={state} message={message} />;
  }

  const currencies = Array.from(new Set(data.rows.map((r) => r.currency))).sort();
  if (!currencies.length) currencies.push("BRL");
  const currency =
    selectedCurrency && currencies.includes(selectedCurrency) ? selectedCurrency : currencies[0];

  const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const keys = months.map(key);

  const ownerName = (id: string | null) =>
    id ? (data.owners[id] ?? "Não identificado") : "Sem responsável";

  /*
    Os filtros executivos se aplicam ANTES do recorte por período: a pergunta
    "qual é o forecast da carteira de fulano?" tem de mover o gráfico, e não só
    a tabela de baixo.
  */
  const scoped = data.rows.filter(
    (r) =>
      r.currency === currency
      && (owner === "all"
        || (owner === "unassigned" ? !r.owner_user_id : r.owner_user_id === owner))
      && (customer === "all" || r.counterparty_name === customer)
      && (stage === "all" || r.stage === stage),
  );

  const rows = scoped.filter(
    (r) => r.expected_decision_date && keys.includes(r.expected_decision_date.slice(0, 7)),
  );
  const undated = scoped.filter((r) => !r.expected_decision_date);
  const outside = scoped.filter(
    (r) => r.expected_decision_date && !keys.includes(r.expected_decision_date.slice(0, 7)),
  );

  const points = months.map((date) => {
    const items = rows.filter((r) => r.expected_decision_date?.startsWith(key(date)));
    return {
      date,
      items,
      gross: items.reduce((sum, r) => sum + Number(r.estimated_value ?? 0), 0),
      weighted: items.reduce((sum, r) => sum + Number(r.weighted_value ?? 0), 0),
    };
  });
  const max = Math.max(0, ...points.map((p) => p.gross), ...points.map((p) => p.weighted));
  const noAmounts = rows.length > 0 && rows.every((r) => r.estimated_value === null);

  const entered = data.movement.entered;
  const left = data.movement.left;
  const wonCount = left.filter((item) => item.to_stage === "WON").length;
  const lostCount = left.length - wonCount;

  return (
    <section className="crm-workspace" aria-label="Forecast">
      <WorkspaceHeading
        eyebrow="Inteligência comercial · Forecast"
        title="Potencial, com perspectiva."
        description="Bruto e ponderado por mês de decisão. Movimento lido do histórico de etapa, não de fotografias diárias."
        action={
          <>
            <Filter
              label="Horizonte do forecast"
              value={period}
              onChange={setPeriod}
              options={[
                { value: "3", label: "Próximos 3 meses" },
                { value: "6", label: "Próximos 6 meses" },
                { value: "12", label: "Próximos 12 meses" },
              ]}
            />
            <Filter
              label="Moeda do forecast"
              value={currency}
              onChange={setSelectedCurrency}
              options={currencies.map((value) => ({ value, label: value }))}
            />
          </>
        }
      />

      <Metrics
        items={[
          {
            label: "Pipeline ponderado",
            value: moneyTotal(rows.map((r) => ({ value: r.weighted_value, currency }))),
            hint: "Valor × probabilidade aplicada",
            accent: true,
          },
          {
            label: "Pipeline bruto",
            value: moneyTotal(rows.map((r) => ({ value: r.estimated_value, currency }))),
            hint: `${rows.length} oportunidades no período`,
          },
          {
            label: "Entraram no forecast",
            value: entered.length,
            hint: `Últimos ${data.movement.days} dias`,
          },
          {
            label: "Saíram do forecast",
            value: left.length,
            hint: `${wonCount} ganha(s) · ${lostCount} encerrada(s) sem ganho`,
          },
        ]}
      />

      <Panel
        title="Recorte executivo"
        note="Responsável, cliente e etapa — aplicados ao gráfico e às tabelas ao mesmo tempo."
      >
        <div className="crm-toolbar">
          <div className="crm-filters">
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
              label="Cliente"
              value={customer}
              onChange={setCustomer}
              options={[
                { value: "all", label: "Todos os clientes" },
                ...Array.from(new Set(data.rows.map((r) => r.counterparty_name)))
                  .sort()
                  .map((value) => ({ value, label: value })),
              ]}
            />
            <Filter
              label="Etapa"
              value={stage}
              onChange={setStage}
              options={[
                { value: "all", label: "Todas as etapas abertas" },
                ...Array.from(new Set(data.rows.map((r) => r.stage))).map((value) => ({
                  value,
                  label: opportunityStageLabels[value],
                })),
              ]}
            />
            <Filter
              label="Janela do movimento"
              value={movementDays}
              onChange={setMovementDays}
              options={[
                { value: "7", label: "Movimento · 7 dias" },
                { value: "30", label: "Movimento · 30 dias" },
                { value: "90", label: "Movimento · 90 dias" },
              ]}
            />
          </div>
        </div>
      </Panel>

      <Panel
        title="Horizonte de decisão"
        note={`Distribuição mensal · ${currency} · mês atual incluído`}
        aside={
          <div className="crm-legend">
            <span>
              <i style={{ opacity: 0.35 }} />
              Bruto
            </span>
            <span>
              <i />
              Ponderado
            </span>
          </div>
        }
      >
        <div
          className="crm-chart"
          role="img"
          aria-label={`Gráfico mensal de pipeline bruto e ponderado em ${currency}. ${rows.length} oportunidades no período. Valores detalhados na tabela abaixo.`}
        >
          <div className="flex justify-between mb-3 crm-muted">
            <span>{max ? brl(max, currency) : brl(0, currency)}</span>
            <span>Valor por mês de decisão</span>
          </div>
          <div className="crm-chart-grid">
            {points.map((p) => (
              <div
                className="crm-chart-month"
                key={key(p.date)}
                title={`${p.date.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}: bruto ${brl(p.gross, currency)}, ponderado ${brl(p.weighted, currency)} · ${p.items.length} oportunidade(s)`}
              >
                <div
                  className="crm-bar crm-bar-gross"
                  style={{ height: `${max ? (p.gross / max) * 100 : 0}%` }}
                />
                <div
                  className="crm-bar"
                  style={{ height: `${max ? (p.weighted / max) * 100 : 0}%` }}
                />
              </div>
            ))}
            {(!rows.length || noAmounts) && (
              <div className="crm-chart-zero">
                <span>
                  {noAmounts
                    ? "Valores ainda não informados"
                    : "Sem oportunidades com decisão neste período"}
                </span>
              </div>
            )}
          </div>
          <div className="crm-chart-axis">
            {points.map((p) => (
              <span key={key(p.date)}>
                {p.date.toLocaleDateString("pt-BR", {
                  month: "short",
                  year: period === "12" ? "2-digit" : undefined,
                })}
              </span>
            ))}
          </div>
        </div>
        <div className="crm-table-footer">
          <span>
            {undated.length} sem data · {outside.length} fora do período · excluídas do gráfico
          </span>
          <span>
            {rows.filter((r) => r.estimated_value === null).length} valor(es) não informado(s) ·
            fechadas fora do forecast
          </span>
        </div>
      </Panel>

      <div className="crm-split">
        <Panel
          title="Entraram no forecast"
          note={`Passaram a ocupar uma etapa aberta nos últimos ${data.movement.days} dias.`}
        >
          {entered.length === 0 ? (
            <div className="p-5">
              <EmptyNote
                title="Nenhuma entrada na janela"
                description="Oportunidades novas e retomadas aparecem aqui assim que a etapa é registrada."
              />
            </div>
          ) : (
            <ul className="crm-movement">
              {entered.map((item) => (
                <li key={item.id}>
                  <ArrowUpRight size={14} aria-hidden className="crm-movement-in" />
                  <div className="min-w-0">
                    <button
                      type="button"
                      className="crm-row-open"
                      onClick={() => setOpenOpportunity(item.opportunity_id)}
                    >
                      <strong>{item.opportunity.title}</strong>
                    </button>
                    <p className="crm-muted">
                      {item.opportunity.counterparty_name} ·{" "}
                      {brl(item.opportunity.estimated_value, item.opportunity.currency)} ·{" "}
                      {opportunityStageLabels[item.to_stage as OpportunityStage]}
                    </p>
                    <p className="crm-muted">{formatMoment(item.occurred_at)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Saíram do forecast"
          note="Ganhas, perdidas ou abandonadas — com o motivo declarado no encerramento."
        >
          {left.length === 0 ? (
            <div className="p-5">
              <EmptyNote
                title="Nenhuma saída na janela"
                description="Encerramentos aparecem aqui com a etapa de destino e o motivo registrado."
              />
            </div>
          ) : (
            <ul className="crm-movement">
              {left.map((item) => (
                <li key={item.id}>
                  <ArrowDownRight
                    size={14}
                    aria-hidden
                    className={item.to_stage === "WON" ? "crm-movement-won" : "crm-movement-out"}
                  />
                  <div className="min-w-0">
                    <button
                      type="button"
                      className="crm-row-open"
                      onClick={() => setOpenOpportunity(item.opportunity_id)}
                    >
                      <strong>{item.opportunity.title}</strong>
                    </button>
                    <p className="crm-muted">
                      {item.opportunity.counterparty_name} ·{" "}
                      {brl(item.opportunity.estimated_value, item.opportunity.currency)}
                    </p>
                    <p className="crm-muted">
                      {opportunityStageLabels[item.to_stage as OpportunityStage]}
                      {item.reason ? ` · ${item.reason}` : ""} · {formatMoment(item.occurred_at)}
                    </p>
                  </div>
                  <HudBadge variant={item.to_stage === "WON" ? "success" : "subtle"} size="sm">
                    {opportunityStageLabels[item.to_stage as OpportunityStage]}
                  </HudBadge>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel
        title="Composição do forecast"
        note="A probabilidade e sua origem permanecem visíveis em cada oportunidade."
      >
        <DataTable
          label="Composição do forecast"
          columns={[
            "Oportunidade / cliente",
            "Etapa",
            "Responsável",
            "Decisão",
            "Bruto",
            "Probabilidade / origem",
            "Ponderado",
          ]}
          count={rows.length}
          empty={
            <EmptyNote
              title={data.rows.length ? "Nenhuma decisão neste recorte" : "Nada em aberto no funil"}
              description="O forecast pondera oportunidades abertas. Defina valor e previsão de decisão para visualizar a distribuição mensal."
            />
          }
        >
          {rows.map((r) => (
            <tr key={r.opportunity_id}>
              <td>
                <button
                  type="button"
                  className="crm-row-open"
                  onClick={() => setOpenOpportunity(r.opportunity_id)}
                >
                  <strong>{r.title}</strong>
                </button>
                <p className="crm-muted">{r.counterparty_name}</p>
              </td>
              <td>{opportunityStageLabels[r.stage]}</td>
              <td>{ownerName(r.owner_user_id)}</td>
              <td>{day(r.expected_decision_date)}</td>
              <td>{brl(r.estimated_value, r.currency)}</td>
              <td>
                <HudBadge variant={r.probability_source === "informed" ? "info" : "subtle"}>
                  {r.applied_probability === null
                    ? "—"
                    : `${Math.round(Number(r.applied_probability) * 100)}%`}{" "}
                  · {r.probability_source === "informed" ? "Informada" : "Padrão do estágio"}
                </HudBadge>
              </td>
              <td>
                <strong>{brl(r.weighted_value, r.currency)}</strong>
              </td>
            </tr>
          ))}
        </DataTable>
      </Panel>

      {(undated.length > 0 || outside.length > 0) && (
        <Panel
          title="Fora do horizonte selecionado"
          note="Oportunidades sem data ou com decisão fora do período, no recorte atual."
        >
          <DataTable
            label="Oportunidades fora do horizonte"
            columns={["Oportunidade", "Cliente", "Decisão", "Bruto", "Ponderado"]}
            count={undated.length + outside.length}
            empty={null}
          >
            {[...undated, ...outside].map((r) => (
              <tr key={r.opportunity_id}>
                <td>
                  <button
                    type="button"
                    className="crm-row-open"
                    onClick={() => setOpenOpportunity(r.opportunity_id)}
                  >
                    {r.title}
                  </button>
                </td>
                <td>{r.counterparty_name}</td>
                <td>{r.expected_decision_date ? day(r.expected_decision_date) : "Sem data"}</td>
                <td>{brl(r.estimated_value, r.currency)}</td>
                <td>{brl(r.weighted_value, r.currency)}</td>
              </tr>
            ))}
          </DataTable>
        </Panel>
      )}

      <GovernanceNote>
        {data.disclaimer} Valores sem conversão cambial, separados por moeda. A probabilidade
        aplicada vem do modelo de forecast da plataforma, e o movimento é derivado do histórico
        append-only de etapa — não de uma fotografia diária que envelhece sozinha.
      </GovernanceNote>

      {openOpportunity && (
        <OpportunityWorkspace
          opportunityId={openOpportunity}
          onClose={() => setOpenOpportunity(null)}
          onChanged={() => setOpenOpportunity(null)}
        />
      )}
    </section>
  );
}
