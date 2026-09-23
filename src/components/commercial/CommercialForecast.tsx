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
import Link from "next/link";
import { ArrowDownRight, ArrowRight, ArrowUpRight, X } from "lucide-react";
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
import { ProposalWorkspace } from "./ProposalWorkspace";
import { AccountWorkspace } from "./AccountWorkspace";

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
  const { data, state, message, refresh } = useCommercialResource<Payload>(
    `/api/commercial/forecast?movementDays=${movementDays}`,
  );
  const [period, setPeriod] = useState("6");
  const [selectedCurrency, setSelectedCurrency] = useState<string | null>(null);
  const [owner, setOwner] = useState("all");
  const [customer, setCustomer] = useState("all");
  const [stage, setStage] = useState("all");
  const [openOpportunity, setOpenOpportunity] = useState<string | null>(null);
  const [openProposal, setOpenProposal] = useState<string | null>(null);
  const [openAccount, setOpenAccount] = useState<string | null>(null);
  // Investigação: o mês sob o cursor mostra quem compõe a barra; o mês
  // clicado vira recorte da tabela e atalho para o pipeline filtrado.
  const [hoverMonth, setHoverMonth] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);

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
  // Escala "redonda": 1, 2, 2.5 ou 5 × 10ⁿ — as linhas de grade caem em valores legíveis.
  const scale = (() => {
    if (!max) return 1;
    const magnitude = 10 ** Math.floor(Math.log10(max));
    const step = [1, 2, 2.5, 5, 10].find((m) => m * magnitude >= max) ?? 10;
    return step * magnitude;
  })();
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * scale);
  const compactFormat = new Intl.NumberFormat("pt-BR", {
    style: "currency", currency, notation: "compact", maximumFractionDigits: 1,
  });
  const compact = (value: number) => compactFormat.format(value);
  const grossTotal = rows.reduce((sum, r) => sum + Number(r.estimated_value ?? 0), 0);
  const weightedTotal = rows.reduce((sum, r) => sum + Number(r.weighted_value ?? 0), 0);
  const noAmounts = rows.length > 0 && rows.every((r) => r.estimated_value === null);

  const tableRows = selectedMonth
    ? rows.filter((r) => r.expected_decision_date?.startsWith(selectedMonth))
    : rows;
  const monthLabel = (value: string) =>
    new Date(`${value}-15T12:00:00`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  const entered = data.movement.entered;
  const left = data.movement.left;
  // Por que saíram: o motivo declarado no encerramento, agrupado.
  const exitReasons = Object.entries(
    left.filter((item) => item.to_stage !== "WON").reduce<Record<string, number>>((acc, item) => {
      const reason = item.reason?.trim() || "Motivo não declarado";
      acc[reason] = (acc[reason] ?? 0) + 1;
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);
  const wonCount = left.filter((item) => item.to_stage === "WON").length;
  const lostCount = left.length - wonCount;

  return (
    <section className="crm-workspace" aria-label="Forecast">
      <WorkspaceHeading
        eyebrow="Comercial · Forecast"
        title="Forecast"
        description={
          <>
            <span><b>{moneyTotal(rows.map((r) => ({ value: r.weighted_value, currency })))}</b> ponderado</span>
            <i className="crm-live-sep" aria-hidden />
            <span><b>{grossTotal ? `${Math.round((weightedTotal / grossTotal) * 100)}%` : "—"}</b> do bruto</span>
            <i className="crm-live-sep" aria-hidden />
            <span><b className="crm-delta-in">+{entered.length}</b> / <b className="crm-delta-out">−{left.length}</b> em {data.movement.days} dias</span>
          </>
        }
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
            meter: grossTotal ? weightedTotal / grossTotal : null,
            hint: `${rows.length} oportunidades · régua = peso ponderado`,
          },
          {
            label: "Entraram no forecast",
            value: entered.length,
            tone: entered.length ? "accent" : "neutral",
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
        title="Horizonte de decisão"
        note={`${currency} por mês de decisão prevista · mês atual incluído · filtros movem gráfico e tabelas`}
        aside={
          <div className="crm-fc-legend">
            <span><i className="l-gross" /> Bruto</span>
            <span><i className="l-weighted" /> Ponderado</span>
            <span className="l-ratio">{grossTotal ? `${Math.round((weightedTotal / grossTotal) * 100)}% ponderado/bruto` : ""}</span>
          </div>
        }
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
        <div
          className="crm-fc"
          role="group"
          aria-label={`Gráfico mensal de pipeline bruto e ponderado em ${currency}. ${rows.length} oportunidades no período. Escolha um mês para ver quem o compõe.`}
        >
          <div className="crm-fc-y" aria-hidden>
            {ticks.map((t) => (
              <span key={t} style={{ bottom: `${(t / scale) * 100}%` }}>{compact(t)}</span>
            ))}
          </div>
          <div className="crm-chart-grid">
            {ticks.slice(1).map((t) => (
              <i key={t} className="crm-fc-gridline" style={{ bottom: `${(t / scale) * 100}%` }} aria-hidden />
            ))}
            {points.map((p, index) => {
              const k = key(p.date);
              const contributors = [...p.items]
                .sort((a, b) => Number(b.weighted_value ?? 0) - Number(a.weighted_value ?? 0));
              const grossH = scale ? (p.gross / scale) * 100 : 0;
              const weightedH = p.gross ? (p.weighted / p.gross) * 100 : 0;
              return (
                <button
                  type="button"
                  className={`crm-chart-month${selectedMonth === k ? " selected" : ""}${selectedMonth && selectedMonth !== k ? " dimmed" : ""}`}
                  key={k}
                  aria-pressed={selectedMonth === k}
                  aria-label={`${monthLabel(k)}: bruto ${brl(p.gross, currency)}, ponderado ${brl(p.weighted, currency)}, ${p.items.length} oportunidade(s)`}
                  onMouseEnter={() => setHoverMonth(k)}
                  onMouseLeave={() => setHoverMonth((current) => (current === k ? null : current))}
                  onFocus={() => setHoverMonth(k)}
                  onBlur={() => setHoverMonth((current) => (current === k ? null : current))}
                  onClick={() => setSelectedMonth((current) => (current === k ? null : k))}
                >
                  {p.items.length > 0 && <span className="crm-fc-count">{p.items.length}</span>}
                  <div className="crm-bar crm-bar-gross" style={{ height: `${grossH}%` }}>
                    <div className="crm-bar-weighted" style={{ height: `${weightedH}%` }} />
                    {p.gross > 0 && <span className="crm-fc-value" style={{ bottom: "100%" }}>{compact(p.gross)}</span>}
                  </div>
                  {hoverMonth === k && (
                    <div className={`crm-chart-tip${index > points.length / 2 ? " crm-chart-tip-left" : ""}`} role="tooltip">
                      <strong>{monthLabel(k)}</strong>
                      <span>
                        Bruto <b>{brl(p.gross, currency)}</b> · Ponderado <b>{brl(p.weighted, currency)}</b>
                        {p.gross ? ` · ${Math.round((p.weighted / p.gross) * 100)}%` : ""}
                      </span>
                      {contributors.length ? (
                        <ul>
                          {contributors.slice(0, 4).map((r) => (
                            <li key={r.opportunity_id}>
                              <span>{r.title}</span>
                              <b>{brl(r.weighted_value, r.currency)}</b>
                            </li>
                          ))}
                          {contributors.length > 4 && <li className="crm-muted">+{contributors.length - 4} outras</li>}
                        </ul>
                      ) : (
                        <span className="crm-muted">Nenhuma decisão prevista</span>
                      )}
                      <em>{selectedMonth === k ? "Clique para limpar o recorte" : "Clique para investigar o mês"}</em>
                    </div>
                  )}
                </button>
              );
            })}
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
              <span key={key(p.date)} className={selectedMonth === key(p.date) ? "selected" : undefined}>
                {p.date.toLocaleDateString("pt-BR", {
                  month: "short",
                  year: period === "12" ? "2-digit" : undefined,
                })}
              </span>
            ))}
          </div>
        </div>
        {selectedMonth && (() => {
          const gross = tableRows.reduce((sum, r) => sum + Number(r.estimated_value ?? 0), 0);
          const weighted = tableRows.reduce((sum, r) => sum + Number(r.weighted_value ?? 0), 0);
          return (
            <div className="crm-fc-drill" data-testid="forecast-month-drill">
              <div><span>Mês</span><b>{monthLabel(selectedMonth).replace(/^./, (c) => c.toUpperCase())}</b></div>
              <div><span>Oportunidades</span><b>{tableRows.length}</b></div>
              <div><span>Bruto</span><b>{brl(gross, currency)}</b></div>
              <div><span>Ponderado · peso</span><b>{brl(weighted, currency)} · {gross ? `${Math.round((weighted / gross) * 100)}%` : "—"}</b></div>
              <div>
                <Link className="flow-link" href={`/comercial?view=oportunidades&month=${selectedMonth}`}>
                  Ver no pipeline <ArrowRight size={12} aria-hidden />
                </Link>
                <button type="button" className="flow-filter-chip" onClick={() => setSelectedMonth(null)}
                  aria-label={`Remover recorte de ${monthLabel(selectedMonth)}`}>
                  Limpar <X size={12} aria-hidden />
                </button>
              </div>
            </div>
          );
        })()}
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
          title={`Entraram · ${entered.length}`}
          note={`Passaram a ocupar uma etapa aberta nos últimos ${data.movement.days} dias.`}
        >
          {entered.length === 0 ? (
            <div className="p-3">
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
          title={`Saíram · ${left.length}`}
          note="Ganhas, perdidas ou abandonadas — com o motivo declarado no encerramento."
        >
          {exitReasons.length > 0 && (
            <div className="crm-exit-reasons" aria-label="Motivos de saída">
              <p className="crm-eyebrow">Por que saíram sem ganho</p>
              <ul>
                {exitReasons.map(([reason, count]) => (
                  <li key={reason}><span>{reason}</span><b>{count}</b></li>
                ))}
              </ul>
            </div>
          )}
          {left.length === 0 ? (
            <div className="p-3">
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
        note={selectedMonth
          ? `Recorte: ${monthLabel(selectedMonth)} — clique no mês de novo para ver o horizonte inteiro.`
          : "A probabilidade e sua origem permanecem visíveis em cada oportunidade."}
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
          count={tableRows.length}
          empty={
            <EmptyNote
              title={data.rows.length ? "Nenhuma decisão neste recorte" : "Nada em aberto no funil"}
              description="O forecast pondera oportunidades abertas. Defina valor e previsão de decisão para visualizar a distribuição mensal."
            />
          }
        >
          {tableRows.map((r) => (
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
    </section>
  );
}
