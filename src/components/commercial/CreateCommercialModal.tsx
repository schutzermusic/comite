"use client";

/**
 * AS ENTRADAS DO COMERCIAL — nova oportunidade, novo contato, nova proposta.
 *
 * Cada uma começa pelo que ancora o registro (a conta, ou o PDF), pede só o
 * que muda uma decisão e termina ABRINDO o que foi criado: quem acabou de
 * cadastrar uma oportunidade quer trabalhar nela, não procurá-la na lista.
 *
 * Nada aqui escreve direto em tabela: oportunidade, contato, proposta e
 * acompanhamento passam pelas mesmas rotas e funções governadas de sempre.
 */
import { useMemo, useState, type FormEvent } from "react";
import { AlertTriangle, CalendarClock, Plus, Star } from "lucide-react";
import { HudButton, HudModal, useHudToast } from "@/components/hud";
import { usePermissions } from "@/hooks/use-permissions";
import { OPEN_OPPORTUNITY_STAGES, type OpportunityStage } from "@/lib/commercial/types";
import { opportunityStageLabels } from "@/lib/commercial/labels";
import { AccountPicker, loadContacts, useAccountContacts, type PickedAccount } from "./AccountPicker";
import { PersonSelect, usePeople } from "./people";
import { ProposalIntakeFlow } from "./ProposalIntakeFlow";
import { GovernanceNote } from "./workspace";

type Kind = "opportunity" | "proposal" | "contact";
const labels: Record<Kind, string> = {
  opportunity: "Nova oportunidade",
  proposal: "Nova proposta",
  contact: "Novo contato",
};
const subtitles: Record<Kind, string> = {
  opportunity: "Conta, valor, dono e o próximo passo — o resto nasce no dossiê.",
  proposal: "Comece pelo PDF: a Apex lê, você revisa, a proposta nasce.",
  contact: "Primeiro a conta, depois a pessoa. Nada de cadastro duplicado.",
};

export interface CreateContext {
  account?: PickedAccount | null;
  opportunityId?: string | null;
}

type CreateButtonProps = {
  kind: Kind;
  onCreated: () => void;
  /** Abre o registro recém-criado (dossiê). */
  onOpen?: (id: string) => void;
  context?: CreateContext;
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
  label?: string;
  /**
   * Permissão já resolvida por quem renderiza (true/false; null = carregando).
   * Dentro de um dossiê, o dossiê já sabe — e cada `usePermissions` a mais é
   * uma nova rodada de consultas ao banco.
   */
  permitted?: boolean | null;
};

const permissionFor = (kind: Kind) => (kind === "proposal" ? "commercial.proposals.manage" : "commercial.manage");

export function CreateCommercialButton(props: CreateButtonProps) {
  return props.permitted === undefined
    ? <PermissionAwareCreateButton {...props} />
    : <CreateButtonView {...props} permitted={props.permitted} />;
}

function PermissionAwareCreateButton(props: CreateButtonProps) {
  const { hasPermission, loading } = usePermissions();
  return <CreateButtonView {...props} permitted={loading ? null : hasPermission(permissionFor(props.kind))} />;
}

function CreateButtonView({
  kind,
  onCreated,
  onOpen,
  context,
  variant = "primary",
  size = "md",
  label,
  permitted,
}: CreateButtonProps & { permitted: boolean | null }) {
  const [open, setOpen] = useState(false);
  const permission = permissionFor(kind);
  // Enquanto as permissões carregam: o botão já ocupa o lugar, sem dizer
  // "sem permissão" antes de saber.
  if (permitted === null) {
    return (
      <HudButton variant={variant} size={size} disabled aria-busy="true">
        <Plus size={15} aria-hidden />
        {label ?? labels[kind]}
      </HudButton>
    );
  }
  if (!permitted) {
    // Não some: diz por que não está disponível.
    return (
      <HudButton variant="secondary" size={size} disabled title={`Exige a permissão ${permission}.`}>
        <Plus size={15} aria-hidden />
        {label ?? labels[kind]}
      </HudButton>
    );
  }
  const done = (id: string | null) => {
    setOpen(false);
    onCreated();
    if (id) onOpen?.(id);
  };
  return (
    <>
      <HudButton variant={variant} size={size} onClick={() => setOpen(true)} data-testid={`create-${kind}`}>
        <Plus size={15} aria-hidden />
        {label ?? labels[kind]}
      </HudButton>
      {open && (
        <CreateCommercialModal kind={kind} context={context} onClose={() => setOpen(false)} onDone={done} />
      )}
    </>
  );
}

export function CreateCommercialModal({
  kind,
  context,
  onClose,
  onDone,
}: {
  kind: Kind;
  context?: CreateContext;
  onClose: () => void;
  onDone: (id: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <HudModal
      isOpen
      onClose={() => {
        if (!busy) onClose();
      }}
      title={labels[kind]}
      subtitle={subtitles[kind]}
      size={kind === "proposal" ? "xl" : "lg"}
    >
      {kind === "opportunity" && (
        <OpportunityFlow context={context} onBusy={setBusy} onCancel={onClose} onDone={onDone} />
      )}
      {kind === "contact" && (
        <ContactFlow context={context} onBusy={setBusy} onCancel={onClose} onDone={onDone} />
      )}
      {kind === "proposal" && (
        <ProposalIntakeFlow context={context} onBusy={setBusy} onCancel={onClose} onDone={onDone} />
      )}
    </HudModal>
  );
}

/* ------------------------------------------------------------------------ */
/* Nova oportunidade                                                         */
/* ------------------------------------------------------------------------ */

const plusDays = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};
const newKey = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random()}`;

function OpportunityFlow({
  context,
  onBusy,
  onCancel,
  onDone,
}: {
  context?: CreateContext;
  onBusy: (busy: boolean) => void;
  onCancel: () => void;
  onDone: (id: string | null) => void;
}) {
  const { me } = usePeople();
  const { success, error: notifyError } = useHudToast();
  const [account, setAccount] = useState<PickedAccount | null>(context?.account ?? null);
  const contacts = useAccountContacts(account?.id ?? null);
  const [contactId, setContactId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const [currency, setCurrency] = useState("BRL");
  const [owner, setOwner] = useState<string | null>(null);
  const [decision, setDecision] = useState("");
  const [stage, setStage] = useState<OpportunityStage>("QUALIFICATION");
  const [probability, setProbability] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [nextDue, setNextDue] = useState(plusDays(3));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ownerId = owner ?? me;
  const primary = contacts?.find((c) => c.is_primary) ?? null;
  const chosenContact = contactId ?? primary?.id ?? null;

  const missing = [!account && "conta", !title.trim() && "título"].filter(Boolean) as string[];

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || missing.length || !account) return;
    setSaving(true);
    onBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/commercial/opportunities", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          party_id: account.id,
          counterparty_name: account.name,
          primary_contact_id: chosenContact,
          estimated_value: value ? Number(value) : null,
          currency,
          owner_user_id: ownerId,
          expected_decision_date: decision || null,
          stage,
          probability: probability ? Number(probability) / 100 : null,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error ?? "Não foi possível criar a oportunidade.");
      const id = result.opportunityId as string;
      // O próximo passo é um compromisso real no motor canônico, com dono e prazo.
      if (nextAction.trim()) {
        const followup = await fetch("/api/commercial/followups", {
          method: "POST",
          headers: { "content-type": "application/json", "Idempotency-Key": newKey() },
          body: JSON.stringify({
            sourceKind: "commercial_opportunity",
            sourceId: id,
            goal: nextAction.trim(),
            dueDate: nextDue || undefined,
            responsibleUserId: ownerId ?? undefined,
          }),
        }).then((r) => r.json()).catch(() => null);
        if (!followup?.ok)
          notifyError("Oportunidade criada, próximo passo não", followup?.error ?? "Agende-o no dossiê que acabou de abrir.");
      }
      success("Oportunidade criada", `${title.trim()} · ${opportunityStageLabels[stage]}`);
      onDone(id);
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
      onBusy(false);
    }
  };

  return (
    <form className="crm-flow" onSubmit={submit} data-testid="flow-opportunity">
      <AccountPicker value={account} onChange={(a) => { setAccount(a); setContactId(null); }} autoFocus={!account} />

      {account && (
        <div className="crm-flow-section">
          <span className="crm-flow-label">Contato principal</span>
          {contacts === null ? (
            <p className="crm-field-hint">Carregando contatos…</p>
          ) : contacts.length ? (
            <div className="crm-chips" role="group" aria-label="Contato principal">
              {contacts.slice(0, 6).map((c) => (
                <button key={c.id} type="button" className="crm-chip" aria-pressed={chosenContact === c.id}
                  onClick={() => setContactId(c.id)}>
                  {c.is_primary && <Star size={11} aria-hidden />}
                  {c.full_name}
                  {c.role_title && <small style={{ opacity: 0.7 }}>· {c.role_title}</small>}
                </button>
              ))}
              <button type="button" className="crm-chip" aria-pressed={chosenContact === null && !primary}
                onClick={() => setContactId(null)}>Sem contato</button>
            </div>
          ) : (
            <p className="crm-field-hint">
              Esta conta ainda não tem contatos. Cadastre em Contas &amp; Contatos — a prontidão para propor pede um contato principal.
            </p>
          )}
        </div>
      )}

      <label className="crm-field-label crm-field-big">
        <span>Oportunidade *</span>
        <input value={title} maxLength={300} placeholder="Ex.: Retrofit da subestação SE-04"
          onChange={(e) => setTitle(e.target.value)} />
      </label>

      <div className="crm-flow-grid">
        <label className="crm-field-label">
          <span>Valor estimado</span>
          <span className="crm-money">
            <input type="number" min={0} step="0.01" inputMode="decimal" value={value} placeholder="0,00"
              onChange={(e) => setValue(e.target.value)} />
            <select aria-label="Moeda" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {["BRL", "USD", "EUR"].map((c) => <option key={c}>{c}</option>)}
            </select>
          </span>
        </label>
        <PersonSelect label="Dono" value={ownerId} onChange={setOwner} />
        <div className="crm-field">
          <label className="crm-field-label">
            <span>Decisão prevista</span>
            <input type="date" value={decision} onChange={(e) => setDecision(e.target.value)} />
          </label>
          <div className="crm-chips">
            {[30, 60, 90].map((d) => (
              <button key={d} type="button" className="crm-chip" aria-pressed={decision === plusDays(d)}
                onClick={() => setDecision(plusDays(d))}>{d} dias</button>
            ))}
          </div>
        </div>
        <div className="crm-field">
          <span className="crm-field-label"><span>Etapa inicial</span></span>
          <div className="crm-chips" role="group" aria-label="Etapa inicial">
            {OPEN_OPPORTUNITY_STAGES.map((s) => (
              <button key={s} type="button" className="crm-chip" aria-pressed={stage === s} onClick={() => setStage(s)}>
                {opportunityStageLabels[s]}
              </button>
            ))}
          </div>
          <label className="crm-field-label" style={{ maxWidth: 200 }}>
            <span>Probabilidade (%) · opcional</span>
            <input type="number" min={0} max={100} step="1" inputMode="numeric" value={probability}
              aria-label="Probabilidade (%) · opcional"
              placeholder="Padrão da etapa" onChange={(e) => setProbability(e.target.value)} />
          </label>
        </div>
      </div>

      <div className="crm-flow-section">
        <span className="crm-flow-label">Próxima ação</span>
        <div className="crm-flow-grid" style={{ gridTemplateColumns: "minmax(0, 1fr) 170px" }}>
          <label className="crm-field-label">
            <span className="sr-only">Próxima ação</span>
            <input value={nextAction} maxLength={500} placeholder="Ex.: Agendar visita técnica com o gerente da planta"
              onChange={(e) => setNextAction(e.target.value)} />
          </label>
          <label className="crm-field-label">
            <span className="sr-only">Prazo da próxima ação</span>
            <input type="date" value={nextDue} onChange={(e) => setNextDue(e.target.value)} />
          </label>
        </div>
        <p className="crm-field-hint">
          <CalendarClock size={11} aria-hidden className="inline" /> Vira um acompanhamento do dono, no mesmo motor de follow-ups — aparece na fila dele.
        </p>
      </div>

      {error && <p className="crm-flow-error" role="alert"><AlertTriangle size={14} aria-hidden /> {error}</p>}
      <GovernanceNote>
        A oportunidade não cria contrato, projeto nem receita. Mudanças de etapa depois da criação passam pela transição governada, com motivo.
      </GovernanceNote>
      <div className="crm-flow-footer">
        <p>{missing.length ? `Falta: ${missing.join(" e ")}.` : "Ao criar, o dossiê abre direto."}</p>
        <div>
          <HudButton type="button" variant="ghost" onClick={onCancel} disabled={saving}>Cancelar</HudButton>
          <HudButton type="submit" variant="primary" disabled={saving || missing.length > 0} data-testid="opportunity-submit">
            {saving ? "Criando…" : "Criar e abrir"}
          </HudButton>
        </div>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------------ */
/* Novo contato                                                              */
/* ------------------------------------------------------------------------ */

function ContactFlow({
  context,
  onBusy,
  onCancel,
  onDone,
}: {
  context?: CreateContext;
  onBusy: (busy: boolean) => void;
  onCancel: () => void;
  onDone: (id: string | null) => void;
}) {
  const { success } = useHudToast();
  const [account, setAccount] = useState<PickedAccount | null>(context?.account ?? null);
  const contacts = useAccountContacts(account?.id ?? null);
  const [v, setV] = useState({ full_name: "", role_title: "", email: "", phone: "", notes: "" });
  const [primary, setPrimary] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof v) => (e: { target: { value: string } }) => setV((p) => ({ ...p, [key]: e.target.value }));

  const hasPrimary = contacts?.some((c) => c.is_primary) ?? false;
  const duplicate = useMemo(() => {
    if (!contacts) return null;
    const email = v.email.trim().toLowerCase();
    const name = v.full_name.trim().toLowerCase();
    return contacts.find((c) => (email && c.email?.toLowerCase() === email) || (name.length > 3 && c.full_name.toLowerCase() === name)) ?? null;
  }, [contacts, v.email, v.full_name]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!account || !v.full_name.trim() || saving) return;
    setSaving(true);
    onBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/commercial/contacts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          party_id: account.id,
          full_name: v.full_name.trim(),
          role_title: v.role_title.trim() || null,
          email: v.email.trim() || null,
          phone: v.phone.trim() || null,
          notes: v.notes.trim() || null,
          is_primary: primary || (!hasPrimary && contacts?.length === 0),
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error ?? "Não foi possível salvar o contato.");
      loadContacts(true);
      success("Contato cadastrado", `${v.full_name.trim()} · ${account.name}`);
      onDone(account.id);
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
      onBusy(false);
    }
  };

  return (
    <form className="crm-flow" onSubmit={submit} data-testid="flow-contact">
      <ol className="crm-steps" aria-label="Etapas">
        <li className={account ? "done" : undefined} aria-current={!account ? "step" : undefined}><b>1</b> Conta</li>
        <li aria-current={account ? "step" : undefined}><b>2</b> Pessoa</li>
      </ol>
      <AccountPicker value={account} onChange={setAccount} autoFocus={!account} />

      {account ? (
        <>
          {contacts && contacts.length > 0 && (
            <p className="crm-field-hint">
              Já cadastrados nesta conta: {contacts.slice(0, 4).map((c) => c.full_name).join(", ")}
              {contacts.length > 4 ? ` e mais ${contacts.length - 4}` : ""}.
            </p>
          )}
          <div className="crm-flow-grid">
            <label className="crm-field-label crm-span-2 crm-field-big">
              <span>Nome *</span>
              <input value={v.full_name} onChange={set("full_name")} maxLength={200} autoFocus placeholder="Nome e sobrenome" />
            </label>
            <label className="crm-field-label">
              <span>Cargo</span>
              <input value={v.role_title} onChange={set("role_title")} maxLength={200} placeholder="Ex.: Gerente de manutenção" />
            </label>
            <label className="crm-field-label">
              <span>E-mail</span>
              <input type="email" value={v.email} onChange={set("email")} maxLength={200} />
            </label>
            <label className="crm-field-label">
              <span>Telefone</span>
              <input type="tel" value={v.phone} onChange={set("phone")} maxLength={60} />
            </label>
            <label className="crm-toggle">
              <input type="checkbox" checked={primary} onChange={(e) => setPrimary(e.target.checked)} />
              <span>
                Contato principal
                <small>{hasPrimary ? "Substitui o principal atual desta conta." : "A conta ainda não tem principal — a prontidão para propor pede um."}</small>
              </span>
            </label>
            <label className="crm-field-label crm-span-2">
              <span>Notas do relacionamento</span>
              <textarea value={v.notes} onChange={set("notes")} maxLength={2000}
                placeholder="Como prefere ser contatado, quem decide, histórico relevante…" />
            </label>
          </div>
          {duplicate && (
            <p className="crm-flow-error" role="status" style={{ color: "var(--ig-warning)", borderColor: "color-mix(in srgb, var(--ig-warning) 35%, transparent)", background: "color-mix(in srgb, var(--ig-warning) 7%, transparent)" }}>
              <AlertTriangle size={14} aria-hidden /> {duplicate.full_name} já está cadastrado nesta conta{duplicate.email ? ` (${duplicate.email})` : ""}. Confira antes de criar outro.
            </p>
          )}
        </>
      ) : (
        <p className="crm-field-hint">Escolha a conta primeiro — o contato pertence a ela, no cadastro único da plataforma.</p>
      )}

      {error && <p className="crm-flow-error" role="alert"><AlertTriangle size={14} aria-hidden /> {error}</p>}
      <div className="crm-flow-footer">
        <p>{!account ? "Falta: conta." : !v.full_name.trim() ? "Falta: nome." : "Pronto para salvar."}</p>
        <div>
          <HudButton type="button" variant="ghost" onClick={onCancel} disabled={saving}>Cancelar</HudButton>
          <HudButton type="submit" variant="primary" disabled={saving || !account || !v.full_name.trim()} data-testid="contact-submit">
            {saving ? "Salvando…" : "Salvar contato"}
          </HudButton>
        </div>
      </div>
    </form>
  );
}
