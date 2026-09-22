"use client";

/**
 * FOLLOW-UPS comerciais — a fila operacional, agora com porta de entrada.
 *
 * ─── O que mudou, e o que continua igual ─────────────────────────────────
 *
 * Antes a fila era somente leitura, e o botão de agendar vinha desabilitado
 * com um bilhete: o RPC humano do motor exigia `contracts.edit`, a permissão do
 * pós-venda. A migration 212 fez a autoridade perguntar de qual DOMÍNIO é o
 * acompanhamento, e a porta abriu — sem nenhum motor novo.
 *
 * Continua valendo tudo o que fazia dele um acompanhamento governado e não uma
 * lista de tarefas: responsável obrigatório, evidência esperada, próximo evento
 * esperado que cala a cobrança enquanto a bola está com o outro lado, e
 * conclusão só pelo caminho verificado. Cancelar não é concluir, e a fila
 * mostra os dois separados.
 */
import { useState } from "react";
import { CalendarPlus } from "lucide-react";
import { HudBadge, HudButton, useHudToast } from "@/components/hud";
import { usePermissions } from "@/hooks/use-permissions";
import {
  FOLLOWUP_STATE_LABEL,
  type FollowupState,
} from "@/lib/platform/followups/types";
import { day, ResourceState, useCommercialResource } from "./shared";
import {
  DataTable, EmptyNote, Filter, GovernanceNote, matches, Metrics, Panel,
  Segments, Toolbar, WorkspaceHeading,
} from "./workspace";
import { FollowupComposer, type FollowupSubjectKind } from "./FollowupComposer";
import { FollowupSubjectPicker } from "./FollowupSubjectPicker";
import { OpportunityWorkspace } from "./OpportunityWorkspace";
import { ProposalWorkspace } from "./ProposalWorkspace";

type FollowupRow = {
  id: string;
  source_kind: string;
  source_id: string;
  goal: string;
  expected_evidence: string | null;
  due_date: string | null;
  state: FollowupState;
  state_note: string | null;
  next_expected_event: string | null;
  next_expected_event_at: string | null;
  responsible_text: string | null;
  responsible_user_id: string | null;
  cadence_days: number | null;
  closed_at: string | null;
  closure_basis: string | null;
  created_at: string;
};
type Payload = {
  followups: FollowupRow[];
  subjects: Record<string, { label: string; counterparty: string | null }>;
  owners: Record<string, string>;
};

const sourceLabels: Record<string, string> = {
  commercial_opportunity: "Oportunidade",
  commercial_proposal: "Proposta",
  commercial_engagement: "Trabalho autorizado",
  internal_service_order: "Ordem de Serviço",
};

export function CommercialFollowups() {
  const { data, state, message, refresh } =
    useCommercialResource<Payload>("/api/commercial/followups");
  const { hasPermission } = usePermissions();
  const canManage = hasPermission("commercial.manage");
  const [bucket, setBucket] = useState("all");
  const [search, setSearch] = useState("");
  const [owner, setOwner] = useState("all");
  const [picking, setPicking] = useState(false);
  const [composing, setComposing] = useState<{
    kind: FollowupSubjectKind; id: string; label: string;
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [openSubject, setOpenSubject] = useState<{ kind: string; id: string } | null>(null);
  const { success, error: notifyError } = useHudToast();

  if (state !== "ready" || !data) {
    return <ResourceState state={state} message={message} />;
  }

  const today = new Date().toLocaleDateString("en-CA");
  const active = (r: FollowupRow) => !["COMPLETED", "CANCELLED"].includes(r.state);
  const predicates: Record<string, (r: FollowupRow) => boolean> = {
    all: () => true,
    overdue: (r) => active(r) && !!r.due_date && r.due_date.slice(0, 10) < today,
    today: (r) => active(r) && r.due_date?.slice(0, 10) === today,
    upcoming: (r) => active(r) && !!r.due_date && r.due_date.slice(0, 10) > today,
    waiting: (r) => r.state === "WAITING_EXTERNAL_PARTY",
    completed: (r) => r.state === "COMPLETED",
    missing: (r) => active(r) && !r.next_expected_event,
    undated: (r) => active(r) && !r.due_date,
  };
  const all = data.followups;
  const count = (key: string) => all.filter(predicates[key]).length;
  const responsibleOf = (r: FollowupRow) =>
    r.responsible_text
    || (r.responsible_user_id ? (data.owners[r.responsible_user_id] ?? "Não identificado") : null);

  const rows = all.filter(
    (r) =>
      predicates[bucket](r) &&
      matches(
        search,
        r.goal,
        responsibleOf(r),
        r.next_expected_event,
        data.subjects[`${r.source_kind}:${r.source_id}`]?.label,
      ) &&
      (owner === "all"
        || (owner === "unassigned" ? !responsibleOf(r) : responsibleOf(r) === owner)),
  );

  const transition = async (followup: FollowupRow, next: string) => {
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
    } catch (e) {
      notifyError("Transição recusada", (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const responsibles = Array.from(
    new Set(all.map(responsibleOf).filter((value): value is string => !!value)),
  );

  return (
    <section className="crm-workspace" aria-label="Follow-ups comerciais">
      <WorkspaceHeading
        eyebrow="Central de ação"
        title="Nenhum compromisso fora do radar."
        description="Prazo, responsável e evidência esperada em uma fila operacional governada."
        action={
          canManage ? (
            <HudButton variant="primary" onClick={() => setPicking(true)}>
              <CalendarPlus size={15} aria-hidden />
              Agendar follow-up
            </HudButton>
          ) : undefined
        }
      />
      <Metrics
        items={[
          {
            label: "Atrasados",
            value: count("overdue"),
            hint: "Prazo vencido, ainda em aberto",
            onClick: () => setBucket("overdue"),
          },
          {
            label: "Hoje",
            value: count("today"),
            hint: "Compromissos para hoje",
            accent: true,
            onClick: () => setBucket("today"),
          },
          {
            label: "Com a contraparte",
            value: count("waiting"),
            hint: "Esperando retorno, com data declarada",
            onClick: () => setBucket("waiting"),
          },
          {
            label: "Concluídos",
            value: count("completed"),
            hint: "Encerrados com verificação",
            onClick: () => setBucket("completed"),
          },
        ]}
      />
      <Panel
        title="Fila de acompanhamento"
        note="Cada ação mantém o vínculo com sua origem e a evidência necessária."
      >
        <div className="p-4 border-b border-ig-border-subtle">
          <Segments
            label="Prazo do acompanhamento"
            value={bucket}
            onChange={setBucket}
            options={[
              { value: "all", label: "Todos", count: all.length },
              { value: "overdue", label: "Atrasados", count: count("overdue") },
              { value: "today", label: "Hoje", count: count("today") },
              { value: "upcoming", label: "Próximos", count: count("upcoming") },
              { value: "waiting", label: "Com a contraparte", count: count("waiting") },
              { value: "completed", label: "Concluídos", count: count("completed") },
              { value: "missing", label: "Sem próxima ação", count: count("missing") },
              { value: "undated", label: "Sem prazo", count: count("undated") },
            ]}
          />
        </div>
        <Toolbar
          search={search}
          onSearch={setSearch}
          placeholder="Buscar compromisso, cliente ou responsável"
        >
          <Filter
            label="Responsável"
            value={owner}
            onChange={setOwner}
            options={[
              { value: "all", label: "Todos os responsáveis" },
              { value: "unassigned", label: "Sem responsável" },
              ...responsibles.map((value) => ({ value, label: value })),
            ]}
          />
        </Toolbar>
        <DataTable
          label="Fila de follow-ups"
          columns={[
            "Compromisso",
            "Origem",
            "Responsável",
            "Prazo",
            "Próxima ação",
            "Evidência esperada",
            "Estado",
            "",
          ]}
          count={rows.length}
          footer="Concluir exige verificação; cancelar é outro resultado"
          empty={
            <EmptyNote
              title={
                all.length
                  ? "Nenhum acompanhamento neste recorte"
                  : "Nenhum follow-up comercial em aberto"
              }
              description={
                canManage
                  ? "Agende o primeiro compromisso: objetivo, responsável, prazo e a evidência que encerra a ação."
                  : "Os compromissos aparecerão aqui com responsável, prazo e o que precisa acontecer para concluir cada ação."
              }
            />
          }
        >
          {rows.map((r) => {
            const subject = data.subjects[`${r.source_kind}:${r.source_id}`];
            const isOpen = active(r);
            return (
              <tr key={r.id}>
                <td>
                  <strong>{r.goal}</strong>
                  {r.state_note && <p className="crm-muted">{r.state_note}</p>}
                </td>
                <td>
                  {subject ? (
                    <button
                      type="button"
                      className="crm-row-open"
                      onClick={() => setOpenSubject({ kind: r.source_kind, id: r.source_id })}
                    >
                      {subject.label}
                    </button>
                  ) : (
                    <span className="crm-muted">
                      {sourceLabels[r.source_kind] ?? r.source_kind}
                    </span>
                  )}
                  <p className="crm-muted">
                    {sourceLabels[r.source_kind] ?? r.source_kind}
                    {subject?.counterparty ? ` · ${subject.counterparty}` : ""}
                  </p>
                </td>
                <td>{responsibleOf(r) || "Não atribuído"}</td>
                <td>
                  <span className={predicates.overdue(r) ? "crm-overdue" : undefined}>
                    {day(r.due_date)}
                  </span>
                </td>
                <td>
                  {r.next_expected_event || (
                    <span className="crm-missing">Sem próxima ação</span>
                  )}
                  {r.next_expected_event_at && (
                    <p className="crm-muted">retorno {day(r.next_expected_event_at)}</p>
                  )}
                </td>
                <td>{r.expected_evidence || "Não declarada"}</td>
                <td>
                  <HudBadge
                    variant={
                      r.state === "COMPLETED" ? "success"
                        : r.state === "BLOCKED" || r.state === "ESCALATED" ? "danger"
                        : "outline"
                    }
                  >
                    {FOLLOWUP_STATE_LABEL[r.state] ?? r.state}
                  </HudBadge>
                </td>
                <td>
                  {canManage && isOpen && (
                    <div className="crm-followup-actions">
                      {r.state !== "BLOCKED" && (
                        <HudButton
                          variant="ghost"
                          size="sm"
                          disabled={busy === r.id}
                          onClick={() => transition(r, "BLOCKED")}
                        >
                          Bloquear
                        </HudButton>
                      )}
                      <HudButton
                        variant="ghost"
                        size="sm"
                        disabled={busy === r.id}
                        onClick={() => transition(r, "CANCELLED")}
                      >
                        Cancelar
                      </HudButton>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </DataTable>
      </Panel>
      <GovernanceNote>
        Conclusão com evidência: o acompanhamento comercial usa o mesmo motor governado do
        pós-venda — <code>apex_followups</code> —, com o mesmo histórico append-only. Concluído e
        cancelado são resultados distintos, e nenhum deles é um clique que substitui verificação.
      </GovernanceNote>

      {picking && (
        <FollowupSubjectPicker
          onClose={() => setPicking(false)}
          onPick={(subject) => {
            setPicking(false);
            setComposing(subject);
          }}
        />
      )}
      {composing && (
        <FollowupComposer
          subject={composing}
          onClose={() => setComposing(null)}
          onCreated={() => {
            setComposing(null);
            refresh();
          }}
        />
      )}
      {openSubject?.kind === "commercial_opportunity" && (
        <OpportunityWorkspace
          opportunityId={openSubject.id}
          onClose={() => setOpenSubject(null)}
          onChanged={refresh}
        />
      )}
      {openSubject?.kind === "commercial_proposal" && (
        <ProposalWorkspace
          proposalId={openSubject.id}
          onClose={() => setOpenSubject(null)}
        />
      )}
    </section>
  );
}
