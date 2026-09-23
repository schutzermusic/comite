"use client";

import { useEffect, useState } from "react";
import { HudBadge } from "@/components/hud";
import { listParties } from "@/lib/parties/party-service";
import type { PartyRow } from "@/lib/parties/types";
import { ResourceState, useCommercialResource } from "./shared";
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
import { CreateCommercialButton } from "./CreateCommercialModal";
import { AccountWorkspace } from "./AccountWorkspace";
import { OpportunityWorkspace } from "./OpportunityWorkspace";
import { ProposalWorkspace } from "./ProposalWorkspace";

type ContactRow = {
  id: string;
  party_id: string;
  full_name: string;
  role_title: string | null;
  email: string | null;
  phone: string | null;
  is_primary: boolean;
  active: boolean;
  party: {
    legal_name: string;
    trade_name: string | null;
    document_number: string | null;
  } | null;
};
export function CommercialAccounts() {
  const { data, state, message, refresh } = useCommercialResource<{
    contacts: ContactRow[];
  }>("/api/commercial/contacts");
  const [parties, setParties] = useState<PartyRow[]>([]);
  const [partyState, setPartyState] = useState("loading");
  const [partyError, setPartyError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [view, setView] = useState("accounts");
  const [filter, setFilter] = useState("all");
  const [openAccount, setOpenAccount] = useState<string | null>(null);
  const [openOpportunity, setOpenOpportunity] = useState<string | null>(null);
  const [openProposal, setOpenProposal] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    listParties()
      .then((rows) => {
        if (active) {
          setParties(rows);
          setPartyState("ready");
        }
      })
      .catch(() => {
        if (active) {
          setPartyError("Não foi possível carregar o cadastro de contas.");
          setPartyState("error");
        }
      });
    return () => {
      active = false;
    };
  }, []);
  if (state !== "ready" || !data)
    return <ResourceState state={state} message={message} />;
  if (partyState !== "ready")
    return <ResourceState state={partyState} message={partyError} />;
  const contacts = data.contacts;
  const byParty = (id: string) => contacts.filter((c) => c.party_id === id);
  const accountRows = parties.filter(
    (p) =>
      matches(search, p.legal_name, p.trade_name, p.document_number) &&
      (filter === "all" ||
        (filter === "with"
          ? byParty(p.id).length > 0
          : byParty(p.id).length === 0)),
  );
  const contactRows = contacts.filter(
    (c) =>
      matches(
        search,
        c.full_name,
        c.email,
        c.party?.legal_name,
        c.party?.trade_name,
      ) &&
      (filter === "all" ||
        (filter === "primary" ? c.is_primary : !c.email && !c.phone)),
  );
  return (
    <section className="crm-workspace" aria-label="Contas e contatos">
      <WorkspaceHeading
        eyebrow="Comercial · Contas & Contatos"
        title="Contas & Contatos"
        description={
          <>
            <span><b>{parties.length}</b> contas</span>
            <i className="crm-live-sep" aria-hidden />
            <span><b>{contacts.length}</b> contatos</span>
            <i className="crm-live-sep" aria-hidden />
            <span className={parties.filter((p) => !byParty(p.id).length).length ? "crm-tone-warning" : undefined}>
              <b>{parties.filter((p) => !byParty(p.id).length).length}</b> conta(s) sem contato
            </span>
          </>
        }
        action={<CreateCommercialButton kind="contact" onCreated={refresh} onOpen={setOpenAccount} />}
      />
      <Metrics
        items={[
          {
            label: "Contas ativas",
            value: parties.length,
            hint: "Contrapartes do cadastro canônico",
            accent: true,
          },
          {
            label: "Contatos ativos",
            value: contacts.length,
            hint: "Pessoas de relacionamento",
          },
          {
            label: "Contatos principais",
            value: contacts.filter((c) => c.is_primary).length,
            hint: "Pontos de contato prioritários",
          },
          {
            label: "Sem contato",
            value: parties.filter((p) => !byParty(p.id).length).length,
            hint: "Contas a desenvolver",
          },
        ]}
      />
      <Panel
        title="Base de relacionamento"
        note="Conta é a contraparte. Contato é a pessoa com quem você conversa."
        aside={
          <Segments
            label="Tipo de cadastro"
            value={view}
            onChange={(v) => {
              setView(v);
              setFilter("all");
            }}
            options={[
              { value: "accounts", label: "Contas", count: parties.length },
              { value: "contacts", label: "Contatos", count: contacts.length },
            ]}
          />
        }
      >
        <Toolbar
          search={search}
          onSearch={setSearch}
          placeholder="Buscar conta, contato ou documento"
        >
          <Filter
            label="Relacionamento"
            value={filter}
            onChange={setFilter}
            options={
              view === "accounts"
                ? [
                    { value: "all", label: "Todas as contas" },
                    { value: "with", label: "Com contatos" },
                    { value: "without", label: "Sem contatos" },
                  ]
                : [
                    { value: "all", label: "Todos os contatos" },
                    { value: "primary", label: "Principais" },
                    { value: "missing", label: "Sem e-mail e telefone" },
                  ]
            }
          />
        </Toolbar>
        {view === "accounts" ? (
          <DataTable
            label="Contas"
            columns={[
              "Conta / razão social",
              "Documento",
              "Contatos",
              "Contato principal",
              "Situação",
            ]}
            count={accountRows.length}
            empty={
              <EmptyNote
                title={
                  parties.length
                    ? "Nenhuma conta neste recorte"
                    : "Nenhuma conta disponível"
                }
                description="As contas reutilizam o cadastro único de contrapartes da plataforma. Não é necessário manter um segundo cadastro comercial."
              />
            }
          >
            {accountRows.map((p) => (
              <tr key={p.id}>
                <td>
                  <button
                    type="button"
                    className="crm-row-open"
                    onClick={() => setOpenAccount(p.id)}
                  >
                    <strong>{p.trade_name || p.legal_name}</strong>
                  </button>
                  {p.trade_name && <p className="crm-muted">{p.legal_name}</p>}
                </td>
                <td>{p.document_number || "Não informado"}</td>
                <td>{byParty(p.id).length}</td>
                <td>
                  {byParty(p.id).find((c) => c.is_primary)?.full_name ||
                    "Não definido"}
                </td>
                <td>
                  <HudBadge variant="success">Ativa</HudBadge>
                </td>
              </tr>
            ))}
          </DataTable>
        ) : (
          <DataTable
            label="Contatos"
            columns={[
              "Contato",
              "Conta",
              "Cargo",
              "E-mail",
              "Telefone",
              "Relacionamento",
            ]}
            count={contactRows.length}
            empty={
              <EmptyNote
                title={
                  contacts.length
                    ? "Nenhum contato neste recorte"
                    : "Nenhum contato cadastrado"
                }
                description="Adicione o primeiro contato e vincule-o a uma conta existente para iniciar o relacionamento."
              />
            }
          >
            {contactRows.map((c) => (
              <tr key={c.id}>
                <td>
                  <strong>{c.full_name}</strong>
                </td>
                <td>
                  <button
                    type="button"
                    className="crm-row-open"
                    onClick={() => setOpenAccount(c.party_id)}
                  >
                    {c.party?.trade_name || c.party?.legal_name || "Contraparte"}
                  </button>
                </td>
                <td>{c.role_title || "—"}</td>
                <td>
                  {c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : "—"}
                </td>
                <td>{c.phone || "—"}</td>
                <td>
                  <HudBadge variant={c.is_primary ? "info" : "subtle"}>
                    {c.is_primary ? "Principal" : "Contato"}
                  </HudBadge>
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>
      <GovernanceNote>
        Cadastro único de clientes e contrapartes: a mesma identidade utilizada
        por Contratos e Faturamento. Abrir uma conta reúne contatos,
        oportunidades, propostas, trabalho autorizado e projetos em volta do
        mesmo <code>party_id</code> — reunir é o oposto de duplicar.
      </GovernanceNote>

      {openAccount && (
        <AccountWorkspace
          partyId={openAccount}
          onClose={() => setOpenAccount(null)}
          onOpenOpportunity={(id) => setOpenOpportunity(id)}
          onOpenProposal={(id) => setOpenProposal(id)}
        />
      )}
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
    </section>
  );
}
