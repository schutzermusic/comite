"use client";

/**
 * FECHAR NEGÓCIO E INICIAR EXECUÇÃO — um painel de revisão, não um assistente.
 *
 * À esquerda, o que será fechado: cliente, PT e PC que regem, valor, escopo,
 * datas, regra de medição, divergências, contrato, OS e projeto — inclusive o
 * que JÁ existe, porque o fechamento reusa em vez de duplicar. À direita, as
 * três decisões que só uma pessoa toma: a base comercial, a OS interna e o
 * projeto. Um botão confirma; uma transação faz tudo ou nada.
 *
 * O início EXCEPCIONAL é o mesmo painel com um interruptor, visível só para
 * quem tem a alçada. Ele pede motivo, autorizador, responsável e prazo — e
 * avisa, antes de confirmar, que o faturamento vai ficar bloqueado.
 */
import { useEffect, useMemo, useState } from "react";
import {
  AlertOctagon, AlertTriangle, ArrowRight, CheckCircle2, FileCheck2, FileText, FolderKanban,
  Link2, Lock, Rocket, ShieldAlert, Upload, Zap,
} from "lucide-react";
import { HudBadge, HudButton, HudDrawer, useHudToast } from "@/components/hud";
import {
  AUTHORIZATION_BASIS_LABEL, ACCEPTANCE_SOURCE_LABEL, DOCUMENTATION_STATE_LABEL, EXECUTION_BLOCK_LABEL,
  IMPLIED_ACCEPTANCE_SOURCE, buildExecutionStartPayload, validateExecutionStart,
  type AuthorizationBasis, type ExecutionStartForm,
} from "@/lib/commercial/execution-start";
import { proposalStatusLabels, serviceOrderStatusLabels, engagementStatusLabels } from "@/lib/commercial/labels";
import type { EngagementStatus, ProposalRevisionStatus, ServiceOrderStatus } from "@/lib/commercial/types";
import { factValue, type FactLike } from "@/lib/commercial/proposal-compare";
import { uploadWithSignedToken } from "@/lib/commercial/upload-client";
import { brl, day, ResourceState, useCommercialResource } from "./shared";
import { PersonSelect } from "./people";
import { SURVEY_STATUS_LABEL, type SiteSurveyStatus } from "@/lib/commercial/site-survey";
import "./commercial-flow.css";

type Revision = {
  id: string; proposal_id: string; revision: number; status: ProposalRevisionStatus;
  total_value: string | null; currency: string | null; validity_until: string | null;
  payment_terms: string | null; scope_summary: string | null; accepted_at: string | null;
};
type Proposal = { id: string; proposal_number: string; kind: "TECHNICAL" | "COMMERCIAL" | "COMBINED"; title: string; currency: string };
type Review = {
  opportunity: { id: string; title: string; counterparty_name: string; stage: string; estimated_value: string | null; currency: string } | null;
  party: { legal_name: string; trade_name: string | null; document_number: string | null } | null;
  proposals: Proposal[];
  revisions: Revision[];
  governing: Record<string, Revision>;
  facts: Array<FactLike & { fact_domain: string }>;
  surveys: Array<{ id: string; code: string; status: string }>;
  executionStart: {
    id: string; mode: string; documentation_state: keyof typeof DOCUMENTATION_STATE_LABEL;
    authorization_type: AuthorizationBasis; authorization_date: string; regularization_due_date: string | null;
  } | null;
  engagement: { id: string; engagement_number: string | null; title: string; status: EngagementStatus; authorized_value: string | null; currency: string } | null;
  authorizations: Array<{ id: string; source_kind: string; governing: boolean; external_reference: string | null }>;
  divergences: Array<{ id: string; scope: string; severity: string; summary: string }>;
  serviceOrders: Array<{ id: string; os_number: string; status: ServiceOrderStatus; project_id: string | null; origin: string }>;
  projectLinks: Array<{ project_id: string }>;
  contract: { contract_number: string | null; title: string; status: string } | null;
  projects: Array<{ id: string; name: string; client: string | null; code: string | null; linked: boolean }>;
  permissions: {
    canStart: boolean; canStartExceptional: boolean; canRecordAcceptance: boolean;
    canManageServiceOrders: boolean; canBindProject: boolean; canRegularize: boolean;
  };
  visibility: { execution: "full" | "status" | "restricted"; projects: "visible" | "restricted" };
};

type Result = {
  engagement_id: string; engagement_created: boolean; documentation_state: string;
  service_order_number: string | null; service_order_status: string | null; service_order_created: boolean;
  project_id: string | null; blocked: Array<{ code: string; detail: string }>;
};

const rev = (r: Revision | undefined) => (r ? `R${String(r.revision).padStart(2, "0")}` : "—");
const today = () => new Date().toISOString().slice(0, 10);

export function ExecutionStartPanel({
  opportunityId, proposalId, onClose: closePanel, onDone, initialMode = "STANDARD",
}: {
  opportunityId?: string | null;
  proposalId?: string | null;
  onClose: () => void;
  onDone: () => void;
  initialMode?: "STANDARD" | "EXCEPTIONAL";
}) {
  const query = opportunityId ? `opportunityId=${opportunityId}` : `proposalId=${proposalId}`;
  const { data, state, message } = useCommercialResource<Review>(`/api/commercial/execution-start/review?${query}`);
  const { success, error: notifyError } = useHudToast();
  const [form, setForm] = useState<ExecutionStartForm | null>(null);
  const [osFile, setOsFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const onClose = () => { if (result) onDone(); closePanel(); };

  const technicalOptions = useMemo(() => (data?.proposals ?? []).filter((p) => p.kind !== "COMMERCIAL"), [data]);
  const commercialOptions = useMemo(() => (data?.proposals ?? []).filter((p) => p.kind !== "TECHNICAL"), [data]);

  // Estado inicial derivado da revisão — nada é redigitado.
  useEffect(() => {
    if (!data || form) return;
    const gov = data.governing;
    const pc = commercialOptions.map((p) => gov[p.id]).find(Boolean);
    // Proposta COMBINADA entra como comercial: ela é as duas, e passá-la duas
    // vezes criaria duas fontes para o mesmo documento.
    const pt = technicalOptions.filter((p) => p.kind === "TECHNICAL").map((p) => gov[p.id]).find(Boolean);
    const existingOs = data.serviceOrders.find((o) => o.status !== "CANCELLED");
    const linkedProject = data.projectLinks[0]?.project_id ?? null;
    setForm({
      mode: initialMode,
      opportunityId: data.opportunity?.id ?? null,
      technicalRevisionId: pt?.id ?? null,
      commercialRevisionId: pc?.id ?? null,
      technicalStatus: pt?.status ?? null,
      commercialStatus: pc?.status ?? null,
      basis: initialMode === "EXCEPTIONAL" ? "declared" : pc?.status === "ACCEPTED" ? "accepted_proposal" : null,
      authorizationDate: today(),
      reference: "",
      context: "",
      acceptanceSource: null,
      customerAuthorizerName: "",
      exception: { reason: "", internalAuthorizerUserId: null, regularizationOwnerUserId: null, regularizationDueDate: "" },
      serviceOrder: { mode: existingOs ? "link" : "generate", serviceOrderId: existingOs?.id ?? null, osNumber: "" },
      project: linkedProject
        ? { mode: "link", projectId: linkedProject }
        : {
            mode: data.permissions.canBindProject ? "create" : "skip",
            name: data.opportunity?.title ?? data.proposals[0]?.title ?? "",
            client: data.party?.trade_name || data.party?.legal_name || data.opportunity?.counterparty_name || "",
            description: (pc ?? pt)?.scope_summary ?? "",
          },
    });
  }, [data, form, initialMode, commercialOptions, technicalOptions]);

  if (state !== "ready" || !data || !form) {
    return (
      <HudDrawer isOpen onClose={onClose} title="Fechar negócio e iniciar execução" width="960px" density="compact" className="flow-drawer-opaque">
        <ResourceState state={state === "ready" ? "loading" : state} message={message} />
      </HudDrawer>
    );
  }

  const patch = (next: Partial<ExecutionStartForm>) => setForm({ ...form, ...next });
  const pc = data.revisions.find((r) => r.id === form.commercialRevisionId);
  const pt = data.revisions.find((r) => r.id === form.technicalRevisionId);
  const valueRev = pc ?? pt;
  const issues = validateExecutionStart({ ...form, documentId: null });
  const exceptional = form.mode === "EXCEPTIONAL";
  const blockingDivergences = data.divergences.filter((d) => d.severity === "BLOCKING");
  const existingOs = data.serviceOrders.filter((o) => o.status !== "CANCELLED");
  const needsAcceptance = !exceptional && [pt?.status, pc?.status].some((s) => s === "SENT" || s === "NEGOTIATION");
  const impliedSource = form.basis ? IMPLIED_ACCEPTANCE_SOURCE[form.basis] : undefined;
  const factsOf = (domains: string[]) => data.facts.filter((f) =>
    domains.includes(f.fact_domain) && [pt?.id, pc?.id].includes(f.subject_id ?? ""));
  const measurement = factsOf(["MEASUREMENT_RULE"]);
  const dates = factsOf(["DATE", "MILESTONE"]);
  const dependencies = factsOf(["DEPENDENCY"]);
  const alreadyStarted = data.executionStart;

  const pickRevision = (kind: "technical" | "commercial", proposalIdValue: string) => {
    const r = proposalIdValue ? data.governing[proposalIdValue] : undefined;
    if (kind === "technical") patch({ technicalRevisionId: r?.id ?? null, technicalStatus: r?.status ?? null });
    else patch({ commercialRevisionId: r?.id ?? null, commercialStatus: r?.status ?? null });
  };

  const submit = async () => {
    if (submitting || issues.length) return;
    setSubmitting(true);
    setServerError(null);
    try {
      let submission = form;
      if (form.serviceOrder.mode === "upload" && osFile) {
        const uploaded = await uploadWithSignedToken("/api/commercial/execution-start",
          { action: "authorize_os_upload" }, osFile);
        submission = { ...form, serviceOrder: { ...form.serviceOrder,
          upload: { filePath: uploaded.path, contentSha256: uploaded.sha256, fileTitle: osFile.name } } };
      }
      const response = await fetch("/api/commercial/execution-start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildExecutionStartPayload(submission, null)),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload?.error || "O fechamento foi recusado.");
      setResult(payload as Result);
      success(exceptional ? "Execução iniciada com documentação pendente" : "Negócio fechado",
        payload.project_id ? "Trabalho autorizado, OS e projeto prontos." : "Veja o que ainda falta abaixo.");
      // O dossiê por trás só recarrega quando a pessoa fecha o resultado:
      // recarregar agora desmontaria este painel e apagaria o que ela precisa ler.
    } catch (e) {
      setServerError((e as Error).message);
      notifyError("Fechamento recusado", (e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const title = alreadyStarted ? "Execução iniciada" : "Fechar negócio e iniciar execução";

  /*
    O VEREDITO antes dos campos: pronto, atenção ou bloqueado — e a cadeia
    que o explica. É a mesma validação do formulário e o mesmo retrato que o
    servidor devolveu; nada é decidido aqui que a função governada não decida.
  */
  type StepTone = "ok" | "warning" | "blocked";
  const governingLabel = pc ?? pt;
  const governingProposal = data.proposals.find((x) => x.id === governingLabel?.proposal_id);
  const chain: { key: string; label: string; tone: StepTone; value: string; hint: string }[] = [
    {
      key: "proposal", label: "Proposta regente",
      tone: !governingLabel ? "blocked" : governingLabel.status === "ACCEPTED" || exceptional ? "ok" : "warning",
      value: governingLabel ? `${governingProposal?.proposal_number ?? ""} ${rev(governingLabel)}`.trim() : "Nenhuma",
      hint: !governingLabel ? "Escolha PT e/ou PC"
        : governingLabel.status === "ACCEPTED" ? "Aceita pelo cliente"
        : exceptional ? `${proposalStatusLabels[governingLabel.status]} · sem aceite registrado`
        : `${proposalStatusLabels[governingLabel.status]} · o aceite será registrado`,
    },
    {
      key: "authorization", label: "Autorização do cliente",
      tone: !form.basis ? "warning" : exceptional ? "warning" : "ok",
      value: form.basis ? AUTHORIZATION_BASIS_LABEL[form.basis] : "A escolher",
      hint: exceptional ? "Declarada — evidência formal pendente" : form.reference ? form.reference : "Informe a referência",
    },
    {
      key: "os", label: "OS interna",
      tone: !data.permissions.canManageServiceOrders || blockingDivergences.length ? "blocked" : "ok",
      value: !data.permissions.canManageServiceOrders ? "Sem alçada"
        : existingOs.length ? existingOs[0].os_number
        : form.serviceOrder.mode === "upload" ? "OS enviada" : "Gerada da proposta",
      hint: blockingDivergences.length ? `${blockingDivergences.length} divergência(s) bloqueante(s)`
        : existingOs.length ? "Reusada — nada duplicado" : "Emitida se nada bloquear",
    },
    {
      key: "project", label: "Projeto",
      tone: form.project.mode === "skip" || !data.permissions.canBindProject ? "warning" : "ok",
      value: !data.permissions.canBindProject ? "Depois" : form.project.mode === "create" ? "Será criado"
        : form.project.mode === "link" ? "Vinculado" : "Depois",
      hint: !data.permissions.canBindProject ? "Exige projects.create" : data.projectLinks.length ? "Reusado" : form.project.name || "—",
    },
    {
      key: "docs", label: "Documentação",
      tone: exceptional ? "warning" : "ok",
      value: exceptional ? "Pendente" : "Completa",
      hint: exceptional ? "Faturamento bloqueado até regularizar" : "Faturamento segue o fluxo normal",
    },
  ];
  const verdict: "ready" | "warning" | "blocked" =
    !data.permissions.canStart || chain.some((c) => c.tone === "blocked") ? "blocked"
    : issues.length || chain.some((c) => c.tone === "warning") ? "warning" : "ready";
  const VERDICT_TEXT = {
    ready: { title: "Pronto para iniciar", text: "Base comprovada, OS e projeto definidos. Uma transação faz tudo — ou nada muda." },
    warning: { title: exceptional ? "Início excepcional — atenção" : "Pronto, com atenção", text: issues.length ? `Falta: ${issues[0].message}${issues.length > 1 ? ` (+${issues.length - 1})` : ""}` : "Confira os pontos em amarelo antes de confirmar." },
    blocked: { title: "Bloqueado", text: !data.permissions.canStart ? "Sem a alçada commercial.execution.start." : chain.find((c) => c.tone === "blocked")?.hint ?? "Há um impedimento." },
  }[verdict];

  return (
    <HudDrawer
      isOpen
      onClose={onClose}
      width="960px"
      density="compact"
      className="flow-drawer-opaque"
      title={title}
      subtitle={
        <div className="crm-drawer-subtitle">
          <span>{data.party?.trade_name || data.party?.legal_name || data.opportunity?.counterparty_name}</span>
          {data.opportunity && <span className="crm-muted">{data.opportunity.title}</span>}
          {alreadyStarted && (
            <HudBadge variant={alreadyStarted.documentation_state === "PENDING" ? "danger" : "success"} size="sm">
              {DOCUMENTATION_STATE_LABEL[alreadyStarted.documentation_state]}
            </HudBadge>
          )}
        </div>
      }
      footer={!result ? (
        <div className="flow-footer">
          <div className="min-w-0">
            {issues.length > 0 ? (
              <p className="flow-footer-issue" role="status">
                <AlertTriangle size={13} aria-hidden /> {issues[0].message}
                {issues.length > 1 ? ` (+${issues.length - 1})` : ""}
              </p>
            ) : exceptional ? (
              <p className="flow-footer-issue flow-footer-danger" role="status">
                <ShieldAlert size={13} aria-hidden /> O projeto poderá começar. O faturamento fica bloqueado até a regularização.
              </p>
            ) : (
              <p className="crm-muted">Uma transação: aceite, trabalho autorizado, OS e projeto — ou nada muda.</p>
            )}
            {serverError && <p className="crm-form-error" role="alert">{serverError}</p>}
          </div>
          <div className="flex gap-2">
            <HudButton variant="ghost" onClick={onClose} disabled={submitting}>Cancelar</HudButton>
            <HudButton
              variant={exceptional ? "danger" : "primary"}
              onClick={submit}
              disabled={submitting || issues.length > 0 || !data.permissions.canStart}
              data-testid="confirm-execution-start"
            >
              <Rocket size={15} aria-hidden />
              {submitting ? "Confirmando…" : exceptional ? "Confirmar início excepcional" : "Confirmar e iniciar execução"}
            </HudButton>
          </div>
        </div>
      ) : undefined}
    >
      {result ? (
        <ExecutionResult result={result} onClose={onClose} />
      ) : (
        <div className="flow-review">
          <div style={{ gridColumn: "1 / -1" }} className="grid gap-2" data-testid="execution-verdict" data-verdict={verdict}>
            <div className={`crm-verdict crm-verdict-${verdict === "ready" ? "ready" : verdict}${exceptional ? " crm-verdict-exceptional" : ""}`}>
              <span className="crm-verdict-icon">
                {verdict === "ready" ? <CheckCircle2 size={18} aria-hidden /> : verdict === "warning" ? <AlertTriangle size={18} aria-hidden /> : <AlertOctagon size={18} aria-hidden />}
              </span>
              <div>
                <strong>{VERDICT_TEXT.title}</strong>
                <p>{VERDICT_TEXT.text}</p>
              </div>
              <span className={`crm-pill crm-pill-${verdict === "ready" ? "success" : verdict === "warning" ? "warning" : "danger"}`}>
                <i aria-hidden />{verdict === "ready" ? "READY" : verdict === "warning" ? "WARNING" : "BLOCKED"}
              </span>
            </div>
            <ol className="crm-verdict-chain" aria-label="Cadeia do fechamento">
              {chain.map((step) => (
                <li key={step.key} className={`crm-chain-step crm-chain-${step.tone}`}>
                  <span>
                    {step.tone === "ok" ? <CheckCircle2 size={11} aria-hidden /> : step.tone === "warning" ? <AlertTriangle size={11} aria-hidden /> : <AlertOctagon size={11} aria-hidden />}
                    {step.label}
                  </span>
                  <strong>{step.value}</strong>
                  <small>{step.hint}</small>
                </li>
              ))}
            </ol>
          </div>
          {/* ── O QUE SERÁ FECHADO ───────────────────────────────────────── */}
          <div className="flow-review-main">
            <div className="flow-summary">
              <div>
                <span className="crm-eyebrow">Valor autorizado</span>
                <strong>{brl(valueRev?.total_value ?? null, valueRev?.currency ?? "BRL")}</strong>
                <span className="crm-muted">{pc ? "Da proposta comercial regente" : pt ? "Da proposta técnica — sem PC" : "Sem proposta"}</span>
              </div>
              <div>
                <span className="crm-eyebrow">Pagamento</span>
                <strong className="flow-text">{pc?.payment_terms || "Não declarado"}</strong>
                <span className="crm-muted">Validade {day(valueRev?.validity_until ?? null)}</span>
              </div>
              <div>
                <span className="crm-eyebrow">Contrato formal</span>
                <strong className="flow-text">{data.contract ? (data.contract.contract_number ?? data.contract.title) : "Nenhum"}</strong>
                <span className="crm-muted">{data.contract ? data.contract.status : "Trabalho por proposta — sem instrumento contratual"}</span>
              </div>
            </div>

            <section className="flow-block">
              <header><FileText size={14} aria-hidden /><h4>Propostas que regem</h4></header>
              <div className="flow-grid-2">
                <label className="crm-field-label">
                  <span>Proposta técnica</span>
                  <select aria-label="Proposta técnica" value={technicalOptions.find((p) => data.governing[p.id]?.id === form.technicalRevisionId)?.id ?? ""}
                    onChange={(e) => pickRevision("technical", e.target.value)}>
                    <option value="">Nenhuma</option>
                    {technicalOptions.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.proposal_number} {rev(data.governing[p.id])} · {proposalStatusLabels[data.governing[p.id]?.status ?? "DRAFT"]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="crm-field-label">
                  <span>Proposta comercial</span>
                  <select aria-label="Proposta comercial" value={commercialOptions.find((p) => data.governing[p.id]?.id === form.commercialRevisionId)?.id ?? ""}
                    onChange={(e) => pickRevision("commercial", e.target.value)}>
                    <option value="">Nenhuma</option>
                    {commercialOptions.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.proposal_number} {rev(data.governing[p.id])} · {proposalStatusLabels[data.governing[p.id]?.status ?? "DRAFT"]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {valueRev?.scope_summary && <p className="flow-scope">{valueRev.scope_summary}</p>}
              {needsAcceptance && (
                <p className="flow-note">
                  <FileCheck2 size={13} aria-hidden />
                  A revisão está com o cliente. Confirmar registra o <strong>aceite do cliente</strong> em seu nome,
                  com a manifestação informada ao lado.
                </p>
              )}
              {exceptional && (pc?.status !== "ACCEPTED") && (
                <p className="flow-note">
                  <Lock size={13} aria-hidden />
                  No início excepcional nenhum aceite é registrado: a proposta continua {proposalStatusLabels[pc?.status ?? "SENT"].toLowerCase()}.
                </p>
              )}
            </section>

            <details className="flow-block crm-disclosure">
              <summary><FolderKanban size={14} aria-hidden /><h4>O que a execução herda</h4>
                <span className="crm-muted">{measurement.length} regra(s) de medição · {dates.length} data(s) · {dependencies.length} dependência(s)</span>
              </summary>
              <dl className="flow-dl">
                <dt>Regra de medição</dt>
                <dd>{measurement.length ? measurement.map((f) => `${f.label}: ${factValue(f) ?? "—"}`).join(" · ") : <span className="crm-muted">Nenhuma lida da proposta — nenhuma será suposta.</span>}</dd>
                <dt>Datas e marcos</dt>
                <dd>{dates.length ? dates.map((f) => `${f.label}: ${factValue(f) ?? "—"}`).join(" · ") : <span className="crm-muted">Sem data registrada.</span>}</dd>
                <dt>Dependências do cliente</dt>
                <dd>{dependencies.length ? dependencies.map((f) => f.label).join(" · ") : <span className="crm-muted">Nenhuma registrada.</span>}</dd>
                <dt>Levantamentos</dt>
                <dd>{data.surveys.length ? data.surveys.map((s) => `${s.code} (${(SURVEY_STATUS_LABEL[s.status as SiteSurveyStatus] ?? s.status).toLowerCase()})`).join(" · ") : <span className="crm-muted">Nenhum.</span>}</dd>
              </dl>
              {data.facts.some((f) => f.confirmation_state === "UNCONFIRMED") && (
                <p className="flow-note">
                  <AlertTriangle size={13} aria-hidden /> Parte destes itens é leitura da Apex ainda não confirmada —
                  aparece aqui como contexto, e só vira regra depois da confirmação humana.
                </p>
              )}
            </details>

            <section className="flow-block">
              <header><Link2 size={14} aria-hidden /><h4>Cadeia canônica</h4></header>
              {data.visibility.execution === "restricted" ? (
                <p className="crm-section-restricted"><Lock size={13} aria-hidden /> Sem alçada para ver o trabalho autorizado.</p>
              ) : (
                <ol className="flow-chain">
                  <li className={data.engagement ? "done" : undefined}>
                    <span>Trabalho autorizado</span>
                    <strong>{data.engagement
                      ? `${data.engagement.engagement_number ?? data.engagement.title} · ${engagementStatusLabels[data.engagement.status]}`
                      : "Será criado"}</strong>
                  </li>
                  <li className={existingOs.length ? "done" : undefined}>
                    <span>OS interna</span>
                    <strong>{existingOs.length
                      ? existingOs.map((o) => `${o.os_number} · ${serviceOrderStatusLabels[o.status]}`).join(", ")
                      : "Será gerada"}</strong>
                  </li>
                  <li className={data.projectLinks.length ? "done" : undefined}>
                    <span>Projeto</span>
                    <strong>{data.projectLinks.length ? `${data.projectLinks.length} vinculado(s)` : "Será criado ou vinculado"}</strong>
                  </li>
                </ol>
              )}
              {blockingDivergences.length > 0 && (
                <ul className="flow-divergences">
                  {blockingDivergences.map((d) => (
                    <li key={d.id}><AlertOctagon size={13} aria-hidden /> {d.summary}</li>
                  ))}
                </ul>
              )}
              {blockingDivergences.length > 0 && (
                <p className="flow-note">A OS não será emitida enquanto houver divergência bloqueante — o fechamento para ali e diz por quê.</p>
              )}
            </section>
          </div>

          {/* ── AS DECISÕES ──────────────────────────────────────────────── */}
          <div className="flow-review-side">
            {data.permissions.canStartExceptional && !alreadyStarted && (
              <div className="flow-mode" role="radiogroup" aria-label="Modo de início">
                <button type="button" role="radio" aria-checked={!exceptional}
                  onClick={() => patch({ mode: "STANDARD", basis: pc?.status === "ACCEPTED" ? "accepted_proposal" : null })}>
                  <CheckCircle2 size={14} aria-hidden /> Com base comprovada
                </button>
                <button type="button" role="radio" aria-checked={exceptional} className="flow-mode-danger"
                  onClick={() => patch({ mode: "EXCEPTIONAL", basis: "declared" })}>
                  <Zap size={14} aria-hidden /> Com documentação pendente
                </button>
              </div>
            )}

            <section className="flow-block">
              <header><ShieldAlert size={14} aria-hidden /><h4>Base comercial</h4></header>
              <label className="crm-field-label">
                <span>Autorização do cliente *</span>
                <select aria-label="Base da autorização" value={form.basis ?? ""}
                  onChange={(e) => patch({ basis: (e.target.value || null) as AuthorizationBasis | null })}>
                  <option value="">Escolha a base</option>
                  {(Object.keys(AUTHORIZATION_BASIS_LABEL) as AuthorizationBasis[])
                    .filter((key) => exceptional || key !== "declared")
                    .filter((key) => key !== "formal_contract")
                    .map((key) => <option key={key} value={key}>{AUTHORIZATION_BASIS_LABEL[key]}</option>)}
                </select>
              </label>
              <div className="flow-grid-2">
                <label className="crm-field-label">
                  <span>Data da autorização *</span>
                  <input type="date" aria-label="Data da autorização" max={today()} value={form.authorizationDate}
                    onChange={(e) => patch({ authorizationDate: e.target.value })} />
                </label>
                <label className="crm-field-label">
                  <span>Quem autorizou (cliente)</span>
                  <input aria-label="Quem autorizou pelo cliente" maxLength={300} value={form.customerAuthorizerName}
                    placeholder="Nome e cargo" onChange={(e) => patch({ customerAuthorizerName: e.target.value })} />
                </label>
              </div>
              <label className="crm-field-label">
                <span>{exceptional ? "Evidência disponível *" : "Referência / evidência"}</span>
                <input aria-label="Referência da autorização" maxLength={1000} value={form.reference}
                  placeholder={exceptional ? "Ex.: ligação do gerente às 07h40, confirmada por WhatsApp" : "Ex.: PO 4500012345 · e-mail de 20/09 de paula@cliente.com"}
                  onChange={(e) => patch({ reference: e.target.value })} />
              </label>
              {needsAcceptance && form.basis && !impliedSource && (
                <label className="crm-field-label">
                  <span>Como o cliente aceitou *</span>
                  <select aria-label="Manifestação do aceite" value={form.acceptanceSource ?? ""}
                    onChange={(e) => patch({ acceptanceSource: e.target.value || null })}>
                    <option value="">Escolha</option>
                    {Object.entries(ACCEPTANCE_SOURCE_LABEL).filter(([k]) => k !== "integration")
                      .map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </label>
              )}
              <p className="crm-muted flow-hint">Aprovação interna não é autorização do cliente e não está nesta lista.</p>
            </section>

            {exceptional && (
              <section className="flow-block flow-block-danger" data-testid="exception-fields">
                <header><Zap size={14} aria-hidden /><h4>Início excepcional</h4></header>
                <label className="crm-field-label">
                  <span>Motivo *</span>
                  <textarea aria-label="Motivo do início excepcional" rows={2} maxLength={2000} value={form.exception.reason}
                    onChange={(e) => patch({ exception: { ...form.exception, reason: e.target.value } })} />
                </label>
                <PersonSelect label="Autorizado internamente por" required value={form.exception.internalAuthorizerUserId}
                  onChange={(v) => patch({ exception: { ...form.exception, internalAuthorizerUserId: v } })} />
                <div className="flow-grid-2">
                  <PersonSelect label="Responsável pela regularização" required value={form.exception.regularizationOwnerUserId}
                    onChange={(v) => patch({ exception: { ...form.exception, regularizationOwnerUserId: v } })} />
                  <label className="crm-field-label">
                    <span>Prazo de regularização *</span>
                    <input type="date" aria-label="Prazo de regularização" min={today()} value={form.exception.regularizationDueDate}
                      onChange={(e) => patch({ exception: { ...form.exception, regularizationDueDate: e.target.value } })} />
                  </label>
                </div>
              </section>
            )}

            <section className="flow-block">
              <header><FileCheck2 size={14} aria-hidden /><h4>OS interna</h4></header>
              {!data.permissions.canManageServiceOrders ? (
                <p className="crm-section-restricted"><Lock size={13} aria-hidden /> Exige <code>commercial.service_orders.manage</code>.</p>
              ) : (
                <>
                  <div className="flow-choice" role="radiogroup" aria-label="OS interna">
                    {existingOs.length > 0 && (
                      <button type="button" role="radio" aria-checked={form.serviceOrder.mode === "link"}
                        onClick={() => patch({ serviceOrder: { ...form.serviceOrder, mode: "link", serviceOrderId: existingOs[0].id } })}>
                        <Link2 size={13} aria-hidden /> Vincular existente
                      </button>
                    )}
                    <button type="button" role="radio" aria-checked={form.serviceOrder.mode === "generate"}
                      disabled={existingOs.length > 0}
                      onClick={() => patch({ serviceOrder: { ...form.serviceOrder, mode: "generate" } })}>
                      <Zap size={13} aria-hidden /> Gerar da proposta
                    </button>
                    <button type="button" role="radio" aria-checked={form.serviceOrder.mode === "upload"}
                      disabled={existingOs.length > 0}
                      onClick={() => patch({ serviceOrder: { ...form.serviceOrder, mode: "upload" } })}>
                      <Upload size={13} aria-hidden /> Enviar OS existente
                    </button>
                  </div>
                  {form.serviceOrder.mode === "link" && (
                    <select aria-label="OS a vincular" value={form.serviceOrder.serviceOrderId ?? ""}
                      onChange={(e) => patch({ serviceOrder: { ...form.serviceOrder, serviceOrderId: e.target.value || null } })}>
                      {existingOs.map((o) => <option key={o.id} value={o.id}>{o.os_number} · {serviceOrderStatusLabels[o.status]}</option>)}
                    </select>
                  )}
                  {form.serviceOrder.mode === "generate" && (
                    <p className="crm-muted flow-hint">Número sequencial, valor, moeda e escopo vêm da proposta regente. Nada é redigitado.</p>
                  )}
                  {form.serviceOrder.mode === "upload" && (
                    <div className="flow-grid-2">
                      <label className="crm-field-label">
                        <span>PDF da OS *</span>
                        <input type="file" accept="application/pdf" aria-label="PDF da OS interna"
                          onChange={(e) => {
                            const file = e.target.files?.[0] ?? null;
                            setOsFile(file);
                            patch({ serviceOrder: { ...form.serviceOrder, upload: file ? { filePath: "pending", contentSha256: null, fileTitle: file.name } : null } });
                          }} />
                      </label>
                      <label className="crm-field-label">
                        <span>Número da OS *</span>
                        <input aria-label="Número da OS" maxLength={80} value={form.serviceOrder.osNumber ?? ""}
                          onChange={(e) => patch({ serviceOrder: { ...form.serviceOrder, osNumber: e.target.value } })} />
                      </label>
                      <label className="crm-field-label">
                        <span>Valor declarado na OS</span>
                        <input inputMode="decimal" aria-label="Valor declarado na OS" placeholder="Opcional — será confrontado"
                          value={form.serviceOrder.authorizedValue ?? ""}
                          onChange={(e) => patch({ serviceOrder: { ...form.serviceOrder, authorizedValue: e.target.value.replace(",", ".") } })} />
                      </label>
                    </div>
                  )}
                  {form.serviceOrder.mode === "upload" && (
                    <p className="crm-muted flow-hint">A OS enviada é confrontada com a proposta regente; divergência de valor impede a emissão.</p>
                  )}
                </>
              )}
            </section>

            <section className="flow-block">
              <header><FolderKanban size={14} aria-hidden /><h4>Projeto</h4></header>
              {!data.permissions.canBindProject ? (
                <p className="crm-section-restricted">
                  <Lock size={13} aria-hidden /> Criar ou vincular projeto exige <code>projects.create</code> e
                  <code>commercial.service_orders.bind_project</code>. O fechamento segue até a OS.
                </p>
              ) : (
                <>
                  <div className="flow-choice" role="radiogroup" aria-label="Projeto">
                    <button type="button" role="radio" aria-checked={form.project.mode === "create"}
                      disabled={data.projectLinks.length > 0}
                      onClick={() => patch({ project: { ...form.project, mode: "create" } })}>Criar projeto</button>
                    <button type="button" role="radio" aria-checked={form.project.mode === "link"}
                      onClick={() => patch({ project: { ...form.project, mode: "link", projectId: data.projectLinks[0]?.project_id ?? form.project.projectId ?? null } })}>Vincular existente</button>
                    <button type="button" role="radio" aria-checked={form.project.mode === "skip"}
                      onClick={() => patch({ project: { ...form.project, mode: "skip" } })}>Depois</button>
                  </div>
                  {form.project.mode === "create" && (
                    <div className="flow-grid-2">
                      <label className="crm-field-label"><span>Nome do projeto *</span>
                        <input aria-label="Nome do projeto" maxLength={300} value={form.project.name ?? ""}
                          onChange={(e) => patch({ project: { ...form.project, name: e.target.value } })} /></label>
                      <label className="crm-field-label"><span>Cliente *</span>
                        <input aria-label="Cliente do projeto" maxLength={300} value={form.project.client ?? ""}
                          onChange={(e) => patch({ project: { ...form.project, client: e.target.value } })} /></label>
                      <label className="crm-field-label"><span>Início previsto</span>
                        <input type="date" aria-label="Início previsto" value={form.project.startDate ?? ""}
                          onChange={(e) => patch({ project: { ...form.project, startDate: e.target.value } })} /></label>
                      <label className="crm-field-label"><span>Término previsto</span>
                        <input type="date" aria-label="Término previsto" value={form.project.finishDate ?? ""}
                          onChange={(e) => patch({ project: { ...form.project, finishDate: e.target.value } })} /></label>
                    </div>
                  )}
                  {form.project.mode === "link" && (
                    data.visibility.projects === "restricted" ? (
                      <p className="crm-section-restricted"><Lock size={13} aria-hidden /> Sem alçada para listar projetos.</p>
                    ) : (
                      <select aria-label="Projeto a vincular" value={form.project.projectId ?? ""}
                        onChange={(e) => patch({ project: { ...form.project, projectId: e.target.value || null } })}>
                        <option value="">Escolha o projeto</option>
                        {data.projects.map((p) => (
                          <option key={p.id} value={p.id}>{p.code ? `${p.code} · ` : ""}{p.name}{p.linked ? " (já vinculado)" : ""}</option>
                        ))}
                      </select>
                    )
                  )}
                  <p className="crm-muted flow-hint">O projeto nasce com o que se sabe — sem cronograma inventado. Medição e evidência seguem o fluxo de sempre.</p>
                </>
              )}
            </section>
          </div>
        </div>
      )}
    </HudDrawer>
  );
}

function ExecutionResult({ result, onClose }: { result: Result; onClose: () => void }) {
  const pending = result.documentation_state === "PENDING";
  return (
    <div className="flow-result" data-testid="execution-result">
      <div className={`flow-result-head ${pending ? "flow-result-danger" : ""}`}>
        {pending ? <ShieldAlert size={20} aria-hidden /> : <CheckCircle2 size={20} aria-hidden />}
        <div>
          <strong>{pending ? "Execução iniciada com documentação pendente" : "Negócio fechado e execução iniciada"}</strong>
          <p className="crm-muted">
            {pending ? "O faturamento está bloqueado até a regularização. O responsável foi avisado e há um acompanhamento aberto."
              : "Os objetos canônicos foram criados ou reusados — nada foi duplicado."}
          </p>
        </div>
      </div>
      <ol className="flow-chain">
        <li className="done"><span>Trabalho autorizado</span><strong>{result.engagement_created ? "Criado e autorizado" : "Reusado"}</strong></li>
        <li className={result.service_order_status ? "done" : undefined}>
          <span>OS interna</span>
          <strong>{result.service_order_number
            ? `${result.service_order_number} · ${serviceOrderStatusLabels[result.service_order_status as ServiceOrderStatus] ?? result.service_order_status}${result.service_order_created ? "" : " (reusada)"}`
            : "Não gerada"}</strong>
        </li>
        <li className={result.project_id ? "done" : undefined}>
          <span>Projeto</span>
          <strong>{result.project_id ? "Vinculado" : "Não vinculado"}</strong>
        </li>
      </ol>
      {result.blocked.length > 0 && (
        <ul className="flow-divergences">
          {result.blocked.map((b) => (
            <li key={b.code}><AlertOctagon size={13} aria-hidden /> <strong>{EXECUTION_BLOCK_LABEL[b.code] ?? b.code}</strong> — {b.detail}</li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        {result.project_id && (
          <HudButton variant="primary" onClick={() => { window.location.href = `/projetos/${result.project_id}`; }}>
            Abrir projeto <ArrowRight size={14} aria-hidden />
          </HudButton>
        )}
        <HudButton variant="ghost" onClick={onClose}>Fechar</HudButton>
      </div>
    </div>
  );
}
