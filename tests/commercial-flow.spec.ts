/**
 * Fluxos da 213 na tela: descoberta → levantamento de campo → prontidão →
 * proposta (comparação, PT×PC, blueprint) → fechar negócio → OS → projeto,
 * o início excepcional, a posse dos follow-ups e o forecast investigativo.
 *
 * TODA chamada a `/api/commercial/**` é interceptada: leituras recebem
 * fixtures deste arquivo e escritas são CAPTURADAS e respondidas aqui. Nenhum
 * registro de negócio é gravado no banco. O caminho real no banco é provado
 * por `scripts/commercial/discovery-execution-proof.mjs` (sempre ROLLBACK).
 */
import { test, expect, type Page, type BrowserContext, type Route } from "@playwright/test";
import { readFileSync } from "node:fs";

const qa = JSON.parse(readFileSync("tests/.qa-env.json", "utf8")) as { email: string; password: string };
test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);

let context: BrowserContext;
let page: Page;
const now = new Date();
const date = (days: number) => new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10);
const month = (offset: number) => {
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 15);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

// ── fixtures ──────────────────────────────────────────────────────────────
const people = {
  people: [
    { id: "user-1", name: "Responsável de teste", self: true },
    { id: "user-2", name: "Engenheira de campo", self: false },
  ],
  me: "user-1",
};
const opportunity = {
  id: "opp-x", code: "OPP-213", title: "Retrofit SE Norte", counterparty_name: "Conta de teste A",
  party_id: "party-a", primary_contact_id: "contact-a", stage: "NEGOTIATION", estimated_value: "900000",
  currency: "BRL", probability: "0.6", expected_decision_date: `${month(1)}`.concat("-10"),
  owner_user_id: "user-1", engagement_id: null, closed_at: null, lost_reason: null, source: null,
  notes: null, stage_entered_at: new Date(now.getTime() - 4 * 86_400_000).toISOString(),
  created_at: new Date(now.getTime() - 30 * 86_400_000).toISOString(),
};
const survey = {
  id: "sv-1", code: "LT-2026-001", title: "Levantamento técnico — Retrofit SE Norte", status: "IN_FIELD",
  site_name: "SE Norte", site_address: "Rod. 101, km 12", purpose: "Avaliar disjuntores 138 kV",
  technical_responsible_user_id: "user-2", planned_visit_date: date(-1), started_at: date(-1), completed_at: null,
  findings: { equipment: [{ id: "e1", tag: "DJ-01", description: "Disjuntor 138 kV", nameplate: "ABB · 3150 A" }],
    risks: [{ id: "r1", text: "Área energizada", severity: "high" }] },
  checklist: [
    { key: "site_access", label: "Acesso e logística do local confirmados", done: true, required: true },
    { key: "nameplate", label: "Dados de placa dos equipamentos registrados", done: false, required: true },
  ],
  open_questions: [{ id: "q1", text: "Janela de desligamento?", resolved: false }],
  apex_generated_at: null, created_at: date(-5),
};
const readinessNotReady = {
  state: "NOT_READY",
  checks: [
    { key: "customer", label: "Cliente identificado", state: "ok", detail: "Vinculado ao cadastro único de contrapartes." },
    { key: "contact", label: "Contato principal", state: "ok", detail: "Há um destinatário definido para a proposta." },
    { key: "survey", label: "Levantamento técnico", state: "blocking", detail: "LT-2026-001 ainda não concluído(s)." },
    { key: "questions", label: "Questões técnicas", state: "blocking", detail: "1 em aberto — LT-2026-001: Janela de desligamento?" },
    { key: "scope", label: "Escopo suficiente", state: "warning", detail: "Nenhuma atividade estimada registrada." },
  ],
  missing: ["Levantamento técnico: LT-2026-001 ainda não concluído(s).", "Questões técnicas: 1 em aberto"],
};
const proposals = [
  { id: "prop-pt", proposal_number: "PT-213", kind: "TECHNICAL", title: "Proposta técnica retrofit", currency: "BRL", opportunity_id: "opp-x", counterparty_name: "Conta de teste A", created_at: date(-20) },
  { id: "prop-pc", proposal_number: "PC-213", kind: "COMMERCIAL", title: "Proposta comercial retrofit", currency: "BRL", opportunity_id: "opp-x", counterparty_name: "Conta de teste A", created_at: date(-20) },
];
const revPt = { id: "rev-pt1", proposal_id: "prop-pt", revision: 1, status: "SENT", total_value: null, currency: "BRL", validity_until: date(20), payment_terms: null, scope_summary: "Ensaios e retrofit de 3 disjuntores 138 kV.", acceptance_conditions: null, accepted_at: null, sent_at: date(-10), internally_approved_at: date(-11), document_id: null, created_at: date(-12) };
const revPc1 = { id: "rev-pc1", proposal_id: "prop-pc", revision: 1, status: "SUPERSEDED", total_value: "920000", currency: "BRL", validity_until: date(10), payment_terms: "30 dias", scope_summary: "Retrofit", acceptance_conditions: null, accepted_at: null, sent_at: date(-15), internally_approved_at: date(-16), superseded_at: date(-5), document_id: "doc-1", created_at: date(-17) };
const revPc2 = { ...revPc1, id: "rev-pc2", revision: 2, status: "SENT", total_value: "850000", payment_terms: "45 dias", validity_until: date(25), superseded_at: null, sent_at: date(-4), document_id: null, created_at: date(-5) };
const fact = (id: string, subject: string, over: Record<string, unknown>) => ({
  id, subject_id: subject, document_id: null, document_context: "COMMERCIAL_PROPOSAL", subject_kind: "proposal_revision",
  fact_domain: "MEASUREMENT_RULE", fact_key: null, label: "Regra de medição", value_text: "Mensal por avanço físico",
  value_numeric: null, value_date: null, unit: null, currency: null, source_revision: "Rev. 01", source_page: 4,
  source_section: "5.1", source_quote: "A medição será mensal", confidence: "0.9", extraction_method: "ai",
  provenance_state: "ANCHORED", confirmation_state: "CONFIRMED", corrected_value: null, confirmed_at: date(-3), ...over,
});
const pcFacts = [
  fact("f1", "rev-pc1", {}),
  fact("f2", "rev-pc2", { value_text: "Por marco de entrega", confirmation_state: "UNCONFIRMED" }),
  fact("f3", "rev-pc2", { fact_domain: "BILLING_MILESTONE", label: "Marco 1", value_text: "30% na mobilização" }),
];
const opportunityDetail = {
  opportunity, party: { id: "party-a", legal_name: "Conta de teste A S.A.", trade_name: "Conta de teste A", document_number: null },
  contacts: [{ id: "contact-a", full_name: "Contato de teste", role_title: "Manutenção", email: "qa@example.invalid", phone: null, is_primary: true }],
  proposals, revisions: [revPt, revPc2, revPc1],
  followups: [{ id: "fu-1", source_kind: "commercial_opportunity", source_id: "opp-x", goal: "Cobrar retorno da PC R02",
    expected_evidence: "E-mail", state: "ACTIVE", due_date: date(2), next_expected_event: null, next_expected_event_at: null,
    responsible_text: "Fulano (legado)", responsible_user_id: null, cadence_days: null, closed_at: null, created_at: date(-3) }],
  stageEvents: [{ id: "se-1", from_stage: null, to_stage: "QUALIFICATION", reason: null, actor_user_id: "user-1", occurred_at: date(-30) }],
  surveys: [survey], readiness: readinessNotReady, executionStart: null, engagement: null, serviceOrders: [],
  signals: [{ kind: "SURVEY_PENDING", severity: "attention", opportunityId: "opp-x", title: "LT-2026-001 ainda não concluído",
    detail: "Sem o levantamento concluído, a proposta técnica depende de suposição.", suggestedAction: "Concluir o levantamento em campo" }],
  owners: { "user-1": "Responsável de teste", "user-2": "Engenheira de campo" },
};
const pendingStart = {
  id: "start-1", engagement_id: "eng-1", mode: "EXCEPTIONAL", authorization_type: "declared", authorization_date: date(0),
  authorization_reference: "Ligação do gerente às 07h40", documentation_state: "PENDING", exception_reason: "Parada emergencial",
  regularization_owner_user_id: "user-2", regularization_due_date: date(10), regularized_at: null,
  service_order_id: "os-1", project_id: "proj-new", confirmed_by: "user-1", confirmed_at: new Date().toISOString(),
};
const proposalDetail = {
  proposal: { ...proposals[1], party_id: "party-a", owner_user_id: "user-1" },
  revisions: [revPc2, revPc1], opportunity: { id: "opp-x", title: opportunity.title, stage: "NEGOTIATION", counterparty_name: "Conta de teste A", estimated_value: "900000", currency: "BRL", expected_decision_date: opportunity.expected_decision_date },
  facts: pcFacts, followups: [], documents: [], authorizations: [], engagements: [], serviceOrders: [], divergences: [],
  owners: {}, executionVisibility: "visible",
  siblings: [proposals[0]], siblingRevisions: [revPt],
  siblingFacts: [fact("t1", "rev-pt1", { fact_domain: "SCOPE", label: "Escopo", document_context: "TECHNICAL_PROPOSAL" })],
  blueprints: [], executionStart: null,
};
const review = {
  opportunity, party: opportunityDetail.party, proposals, revisions: [revPt, revPc2, revPc1],
  governing: { "prop-pt": revPt, "prop-pc": revPc2 }, facts: pcFacts, surveys: [{ id: "sv-1", code: "LT-2026-001", status: "COMPLETED" }],
  executionStart: null, engagement: null, authorizations: [], divergences: [], serviceOrders: [], projectLinks: [], contract: null,
  projects: [{ id: "proj-existing", name: "Projeto existente", client: "Conta de teste A", code: "P-77", linked: false }],
  owners: {}, permissions: { canStart: true, canStartExceptional: true, canRecordAcceptance: true, canManageServiceOrders: true, canBindProject: true, canRegularize: true },
  visibility: { execution: "full", projects: "visible" },
};
const surveyDetail = {
  survey: { ...survey, counterparty_name: "Conta de teste A", cancel_reason: null, apex_candidate: null, apex_model: null },
  opportunity: { id: "opp-x", title: opportunity.title, counterparty_name: "Conta de teste A", stage: "NEGOTIATION" },
  attachments: [], events: [{ id: "ev-1", event_type: "created", from_status: null, to_status: "SCHEDULED", actor_user_id: "user-1", actor_source: "human", note: null, occurred_at: date(-5) }],
  owners: opportunityDetail.owners, canManage: true,
};

type Captured = { method: string; path: string; body: unknown };
let captured: Captured[] = [];
const consoleErrors: string[] = [];
let overrides: Record<string, unknown> = {};

async function wire() {
  captured = [];
  await page.unroute("**/api/commercial/**");
  await page.route("**/api/commercial/**", async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/api/commercial/", "");
    const method = request.method();
    if (method !== "GET") {
      const body = request.postDataJSON?.() ?? null;
      captured.push({ method, path, body });
      const reply = overrides[`${method} ${path}`];
      return route.fulfill({ json: reply ?? { ok: true } });
    }
    const reads: Record<string, unknown> = {
      assignees: people,
      opportunities: { opportunities: [opportunity], signals: opportunityDetail.signals, nextActions: {}, owners: opportunityDetail.owners },
      "opportunities/opp-x": opportunityDetail,
      proposals: { proposals, revisions: [revPt, revPc2, revPc1] },
      "proposals/prop-pc": proposalDetail,
      "execution-start/review": review,
      "site-surveys/sv-1": surveyDetail,
      contacts: { contacts: [] },
      followups: { followups: (opportunityDetail.followups as unknown[]).concat([{ ...opportunityDetail.followups[0], id: "fu-2", goal: "Enviar PT revisada", responsible_text: null, responsible_user_id: "user-1" }]),
        subjects: { "commercial_opportunity:opp-x": { label: opportunity.title, counterparty: "Conta de teste A" } }, owners: opportunityDetail.owners, me: "user-1" },
      forecast: {
        rows: [
          { ...opportunity, opportunity_id: "opp-x", informed_probability: "0.6", applied_probability: "0.6", probability_source: "informed", weighted_value: "540000", accepted_revision_count: 0, expected_decision_date: `${month(1)}-10` },
          { ...opportunity, opportunity_id: "opp-y", title: "Manutenção anual", estimated_value: "200000", applied_probability: "0.3", probability_source: "stage_default", weighted_value: "60000", accepted_revision_count: 0, expected_decision_date: `${month(1)}-20` },
        ],
        movement: { days: 30, since: date(-30), entered: [], left: [
          { id: "m1", opportunity_id: "opp-z", from_stage: "NEGOTIATION", to_stage: "LOST", reason: "Preço acima do orçamento", actor_user_id: "user-1", occurred_at: date(-2),
            opportunity: { ...opportunity, id: "opp-z", title: "Obra perdida", stage: "LOST" } },
        ] },
        owners: opportunityDetail.owners, disclaimer: "Pipeline ponderado. Não é receita contratada, backlog nem previsão contábil.",
      },
    };
    const key = Object.keys(overrides).find((k) => k === `GET ${path}`);
    const payload = key ? overrides[key] : reads[path];
    if (payload) return route.fulfill({ json: { ok: true, ...(payload as object) } });
    return route.fulfill({ status: 404, json: { ok: false, error: `fixture ausente: ${path}` } });
  });
}

/** O tema pelo MESMO botão que a pessoa usa — não por classe injetada. */
async function theme(mode: "light" | "dark") {
  const toggle = page.getByRole("button", { name: `Switch to ${mode} mode`, exact: true });
  // Sob uma gaveta aberta o botão fica atrás do fundo escurecido; o clique
  // vai ao próprio botão (o mesmo manipulador), sem atravessar o fundo.
  if (await toggle.count()) await toggle.first().dispatchEvent("click");
  await page.waitForTimeout(300);
}
/** Gavetas entram com mola; a foto espera o movimento assentar. */
const settle = () => page.waitForTimeout(900);
/** A evidência visual fica também em `output/commercial-ui/`, fora do diretório que cada execução apaga. */
async function snap(info: { outputPath: (name: string) => string }, name: string) {
  await settle();
  await page.screenshot({ path: info.outputPath(name), fullPage: true });
  await page.screenshot({ path: `output/commercial-ui/flow-${name}`, fullPage: true });
}
const noHorizontalScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  page = await context.newPage();
  page.setDefaultTimeout(30_000);
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text().slice(0, 400));
  });
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message.slice(0, 400)}`));
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(qa.email);
  await page.locator('input[type="password"]').fill(qa.password);
  await page.locator('input[type="password"]').press("Enter");
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 90_000 });
});
test.afterAll(async () => {
  if (consoleErrors.length) console.log("CONSOLE_ERRORS", JSON.stringify(consoleErrors, null, 1));
  await context?.close();
});
test.beforeEach(() => { overrides = {}; });

test("Discovery: readiness says exactly what is missing, and a survey is requested from the opportunity", async ({}, info) => {
  await wire();
  await page.goto("/comercial?view=oportunidades&opportunity=opp-x");
  await expect(page.getByRole("heading", { level: 2, name: "Retrofit SE Norte", exact: true })).toBeVisible();

  // Comando principal no topo do dossiê, antes dos fatos.
  await expect(page.getByTestId("close-deal-command")).toBeVisible();
  await page.getByRole("tab", { name: /Descoberta/ }).click();
  const readiness = page.getByTestId("proposal-readiness");
  await expect(readiness).toContainText("Não pronta");
  await expect(readiness).toContainText("Janela de desligamento?");
  await expect(page.locator(".flow-survey-list")).toContainText("LT-2026-001");
  await expect(page.locator(".flow-survey-list")).toContainText("Engenheira de campo");
  await snap(info, "discovery-1440-light.png");

  await page.getByRole("button", { name: /Solicitar levantamento técnico/ }).click();
  await page.getByLabel("Propósito da visita", { exact: true }).fill("Medir resistência de malha de terra");
  await page.getByLabel("Responsável técnico").selectOption("user-2");
  await page.getByLabel("Data prevista da visita", { exact: true }).fill(date(3));
  await page.getByRole("button", { name: "Solicitar", exact: true }).click();
  await expect.poll(() => captured.find((c) => c.path === "site-surveys")?.body).toMatchObject({
    opportunityId: "opp-x", purpose: "Medir resistência de malha de terra",
    technicalResponsibleUserId: "user-2", plannedVisitDate: date(3),
  });

  await theme("dark");
  await snap(info, "discovery-1440-dark.png");
  await theme("light");
  await page.keyboard.press("Escape");
});

test("Field survey: checklist, questions and the next state from a phone, saved without a form", async ({}, info) => {
  await wire();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/comercial/levantamentos/sv-1");
  await expect(page.getByRole("heading", { level: 1, name: /Levantamento técnico — Retrofit SE Norte/ })).toBeVisible();
  expect(await noHorizontalScroll()).toBeTruthy();

  // Checklist: um toque marca, e o registro vai sozinho, só com o que mudou.
  await page.getByRole("button", { name: /Dados de placa dos equipamentos registrados/ }).click();
  await expect.poll(() => captured.find((c) => c.method === "PATCH")?.body, { timeout: 5_000 }).toMatchObject({
    checklist: [{ key: "site_access", done: true }, { key: "nameplate", done: true }],
  });

  await page.getByRole("button", { name: /Questões em aberto/ }).click();
  await page.getByRole("button", { name: "Marcar como resolvida: Janela de desligamento?" }).click();
  await expect.poll(() => captured.filter((c) => c.method === "PATCH").at(-1)?.body, { timeout: 5_000 })
    .toMatchObject({ open_questions: [{ id: "q1", resolved: true }] });

  await page.getByRole("button", { name: /Equipamentos e dados de placa/ }).click();
  await expect(page.locator(".field-list").first()).toContainText("DJ-01");
  await snap(info, "field-390-light.png");

  // A ação principal fica fixa embaixo: encerrar o campo.
  await page.getByTestId("survey-primary-action").click();
  await expect.poll(() => captured.find((c) => c.path === "site-surveys/sv-1/transition")?.body)
    .toMatchObject({ to: "AWAITING_REPORT" });
  await theme("dark");
  await snap(info, "field-390-dark.png");
  await theme("light");
  await page.setViewportSize({ width: 1440, height: 1000 });
});

test("PT + PC are ONE proposal: one row, one count, both documents traceable", async ({}, info) => {
  await wire();
  await page.goto("/comercial?view=propostas");
  const table = page.getByRole("table", { name: "Propostas e revisões" });
  await expect(table.getByRole("button", { name: "Proposta comercial retrofit", exact: true })).toHaveCount(1);
  await expect(table.getByRole("button", { name: "Proposta técnica retrofit", exact: true })).toHaveCount(0);
  await expect(table).toContainText("PT-213");
  await expect(table).toContainText("PC-213");
  await expect(table).toContainText("R02");
  const metrics = page.locator(".crm-metrics > *").first();
  await expect(metrics.locator(".crm-metric-value")).toHaveText("1");
  await expect(metrics).toContainText("2 documento(s)");
  await snap(info, "proposal-list-context-1440.png");
});

test("Proposal workspace: revision comparison, PT × PC cross-check and the planning blueprint", async ({}, info) => {
  await wire();
  await page.goto("/comercial?view=propostas");
  await page.getByRole("button", { name: "Proposta comercial retrofit", exact: true }).first().click();
  await expect(page.getByRole("heading", { level: 2, name: "Proposta comercial retrofit", exact: true })).toBeVisible();
  const header = page.getByTestId("proposal-context-header");
  await expect(header.getByTestId("proposal-doc-pt")).toContainText("PT-213");
  await expect(header.getByTestId("proposal-doc-pc")).toContainText("PC-213");
  await expect(header.getByTestId("proposal-doc-pc")).toContainText("R02");
  await expect(header).toContainText("R$ 850.000");
  await snap(info, "proposal-context-header-1440.png");

  await page.getByRole("tab", { name: /Revisões/ }).click();
  // Histórias independentes, lado a lado, no mesmo contexto.
  await expect(page.getByTestId("revision-lane-pt")).toContainText("PT R01");
  await expect(page.getByTestId("revision-lane-pc")).toContainText("PC R02");
  await expect(page.getByTestId("revision-lane-pc")).toContainText("PC R01");
  const material = page.getByTestId("revision-material");
  await expect(material).toContainText("30 → 45 dias");
  await expect(material).toContainText("+15 dias");
  await expect(material).toContainText("−R$ 70.000");
  const comparison = page.getByTestId("revision-comparison");
  await expect(comparison).toContainText("R01 → R02");
  await expect(comparison).toContainText("45 dias");
  await expect(comparison).toContainText("+15 dias");
  await expect(comparison).toContainText("leitura não confirmada");
  await snap(info, "proposal-compare-1440.png");

  await page.getByRole("tab", { name: "Resumo" }).click();
  await expect(page.getByTestId("pt-pc-check")).toContainText("PT-213");

  await page.getByRole("tab", { name: /Fatos e blueprint/ }).click();
  // Um blueprint por documento do contexto; o da PC (medição) vem primeiro.
  await expect(page.getByTestId("execution-blueprint")).toHaveCount(2);
  const blueprint = page.getByTestId("execution-blueprint").first();
  await expect(blueprint).toContainText("Contexto de planejamento");
  await expect(blueprint).toContainText("Modelo de medição");
  await expect(blueprint).toContainText("a confirmar");
  await page.keyboard.press("Escape");
});

test("Linking a loose proposal to its opportunity goes through the governed route and unlocks closing", async () => {
  await wire();
  // A proposta nasceu solta: sem oportunidade, o fechamento não aparece — e a tela diz o porquê.
  overrides["GET proposals/prop-pc"] = {
    ...proposalDetail, proposal: { ...proposalDetail.proposal, opportunity_id: null }, opportunity: null,
    siblings: [], siblingRevisions: [], siblingFacts: [],
  };
  overrides["POST proposals/prop-pc/opportunity"] = {
    ok: true, proposal_id: "prop-pc", opportunity_id: "opp-x", linked: true, party_inherited: false,
  };
  await page.goto("/comercial?view=propostas&proposal=prop-pc");
  const hint = page.getByTestId("proposal-link-opportunity");
  await expect(hint).toContainText("Vincule esta proposta a uma oportunidade para iniciar execução.");
  await expect(page.getByTestId("close-deal-command")).toHaveCount(0);

  await hint.getByRole("button", { name: /Vincular oportunidade/ }).click();
  await page.getByTestId("link-opportunity-select").selectOption("opp-x");
  // Depois do ato, o servidor devolve a proposta vinculada.
  overrides["GET proposals/prop-pc"] = proposalDetail;
  await page.getByTestId("link-opportunity-submit").click();

  await expect.poll(() => captured.find((c) => c.path === "proposals/prop-pc/opportunity")?.body)
    .toMatchObject({ opportunityId: "opp-x" });
  // Nenhuma escrita direta: o único POST é a rota governada.
  expect(captured.filter((c) => c.method !== "GET").map((c) => c.path)).toEqual(["proposals/prop-pc/opportunity"]);
  await expect(page.getByTestId("close-deal-command")).toBeVisible();
  await expect(page.getByTestId("proposal-link-opportunity")).toHaveCount(0);
  await page.keyboard.press("Escape");
});

test("A missing opportunity is created from the proposal and linked without leaving the workspace", async ({}, info) => {
  await wire();
  overrides["GET proposals/prop-pc"] = {
    ...proposalDetail, proposal: { ...proposalDetail.proposal, opportunity_id: null }, opportunity: null,
    siblings: [{ ...proposals[0], opportunity_id: null }],
  };
  overrides["POST proposals/prop-pc/opportunity"] = {
    ok: true, proposal_id: "prop-pc", opportunity_id: "opp-new", linked: true, documents_linked: 2, party_inherited: false, created: true,
  };
  await page.goto("/comercial?view=propostas&proposal=prop-pc");
  await page.getByTestId("proposal-link-opportunity").getByTestId("proposal-create-opportunity").click();
  const form = page.getByTestId("opportunity-create-form");
  await expect(form).toBeVisible();
  // Pré-preenchido pelo contexto: cliente, título, valor da PC e validade.
  await expect(page.getByTestId("opportunity-create-title")).toHaveValue("Proposta comercial retrofit");
  await expect(form).toContainText("Conta de teste A");
  await expect(form.getByLabel(/Valor estimado/)).toHaveValue("850000");
  await snap(info, "proposal-create-opportunity-1440.png");
  overrides["GET proposals/prop-pc"] = proposalDetail;
  await page.getByTestId("link-opportunity-submit").click();
  await expect.poll(() => captured.find((c) => c.path === "proposals/prop-pc/opportunity")?.body).toMatchObject({
    create: { title: "Proposta comercial retrofit", counterparty_name: "Conta de teste A", estimated_value: "850000", currency: "BRL" },
  });
  expect(captured.filter((c) => c.method !== "GET").map((c) => c.path)).toEqual(["proposals/prop-pc/opportunity"]);
  // Mesma tela, fechamento destravado — ninguém saiu e voltou.
  await expect(page.getByTestId("close-deal-command")).toBeVisible();
  await expect(page.getByTestId("proposal-link-opportunity")).toHaveCount(0);
  await page.keyboard.press("Escape");
});

test("Internal approval is about the exact PT/PC package, with structured payment terms", async ({}, info) => {
  await wire();
  const pay = "10% (dez por cento) na mobilização; 20% no Marco 1 – entrega do projeto executivo; 20% no Marco 2; "
    + "50% na entrega das bobinas, com pagamento em até 45 dias após emissão da fatura pro-forma";
  const draftPc = { ...revPc2, status: "DRAFT", sent_at: null, internally_approved_at: null, document_id: "doc-pc", payment_terms: pay, total_value: "803179" };
  const draftPt = { ...revPt, status: "DRAFT", sent_at: null, internally_approved_at: null, document_id: "doc-pt" };
  overrides["GET proposals/prop-pc"] = { ...proposalDetail, revisions: [draftPc], siblingRevisions: [draftPt] };
  overrides["POST proposals/prop-pc/context"] = { ok: true, moved: [
    { proposal_id: "prop-pt", revision_id: "rev-pt1", revision: 1 }, { proposal_id: "prop-pc", revision_id: "rev-pc2", revision: 2 }] };
  await page.goto("/comercial?view=propostas&proposal=prop-pc");
  const approval = page.getByTestId("proposal-approval");
  await expect(approval).toContainText("Este pacote exato PT/PC está autorizado a ir ao cliente?");
  await expect(approval).toContainText("Não enviada para aprovação");
  // Parcelas, não parágrafo: percentual, valor, gatilho e prazo em colunas.
  const schedule = approval.getByTestId("payment-schedule");
  await expect(schedule.locator("tbody tr")).toHaveCount(4);
  await expect(schedule).toContainText("R$ 80.317,90");
  await expect(schedule).toContainText("Mobilização");
  await expect(schedule).toContainText("Marco 1");
  await expect(schedule).toContainText("Até 45 dias após emissão da fatura pro-forma");
  await snap(info, "proposal-approval-1440.png");
  await approval.getByTestId("proposal-request-approval").click();
  await expect.poll(() => captured.find((c) => c.path === "proposals/prop-pc/context")?.body).toMatchObject({ to: "INTERNAL_REVIEW" });
  expect(captured.filter((c) => c.method !== "GET").map((c) => c.path)).toEqual(["proposals/prop-pc/context"]);
  await page.keyboard.press("Escape");
});

test("Customer acceptance names the exact PT + PC package, and a later revision never inherits it", async ({}, info) => {
  await wire();
  const accPt = { ...revPt, status: "ACCEPTED", accepted_at: date(-1), acceptance_source: "purchase_order" };
  const accPc = { ...revPc2, status: "ACCEPTED", accepted_at: date(-1), acceptance_source: "purchase_order" };
  const ledger = [{ id: "acc-1", context_id: "prop-pt", technical_revision_id: "rev-pt1", technical_status: "ACCEPTED",
    commercial_revision_id: "rev-pc2", commercial_status: "ACCEPTED", combined_revision_id: null, combined_status: null,
    complete: true, acceptance_source: "purchase_order", acceptance_external_ref: "PO 4500012345", recorded_by: "user-1",
    accepted_at: new Date(now.getTime() - 86_400_000).toISOString(), origin: "package" }];
  overrides["GET proposals/prop-pc"] = { ...proposalDetail, revisions: [accPc, revPc1], siblingRevisions: [accPt],
    acceptances: ledger, owners: { "user-1": "Responsável de teste" } };
  await page.goto("/comercial?view=propostas&proposal=prop-pc");
  const panel = page.getByTestId("proposal-acceptance");
  await expect(panel).toHaveAttribute("data-state", "ACCEPTED");
  await expect(panel).toContainText("O cliente aceitou exatamente este pacote.");
  await expect(panel).toContainText("PT");
  await expect(panel).toContainText("R01");
  await expect(panel).toContainText("R02");
  await expect(panel).toContainText("Pedido de compra");
  await expect(panel).toContainText("PO 4500012345");
  await expect(panel).toContainText("Responsável de teste");
  await snap(info, "proposal-acceptance-1440.png");
  await page.keyboard.press("Escape");

  // A PT ganhou R02 depois do aceite: o pacote de hoje NÃO é o aceito.
  const ptR02 = { ...revPt, id: "rev-pt2", revision: 2, status: "DRAFT", sent_at: null, internally_approved_at: null, accepted_at: null };
  overrides["GET proposals/prop-pc"] = { ...proposalDetail, revisions: [accPc, revPc1],
    siblingRevisions: [ptR02, { ...revPt, status: "SUPERSEDED" }], acceptances: ledger };
  await page.goto("/comercial?view=propostas&proposal=prop-pc");
  await expect(panel).toHaveAttribute("data-state", "CHANGED");
  await expect(panel).toContainText("O pacote atual não está aceito.");
  await expect(panel).toContainText("PT hoje é regida pela R02; o aceite foi da R01");
  await expect(page.getByTestId("proposal-context-header")).toContainText("Pacote mudou após o aceite");
  await expect(page.getByTestId("proposal-approval")).toContainText("Parte do pacote sem aprovação interna");
  await snap(info, "proposal-acceptance-changed-1440.png");
  await page.keyboard.press("Escape");
});

test("Fast-track from the proposal: PO basis → engagement, OS and project in one confirmation", async ({}, info) => {
  await wire();
  overrides["POST execution-start"] = {
    ok: true, engagement_id: "eng-1", engagement_created: true, documentation_state: "COMPLETE",
    service_order_id: "os-1", service_order_number: "OS-2026-0001", service_order_status: "IN_EXECUTION",
    service_order_created: true, project_id: "proj-new", blocked: [], followupId: null,
  };
  await page.goto("/comercial?view=propostas");
  await page.getByRole("button", { name: "Proposta comercial retrofit", exact: true }).first().click();
  await page.getByTestId("close-deal-command").getByRole("button", { name: /Fechar negócio e iniciar execução/ }).click();

  await expect(page.getByRole("heading", { level: 2, name: "Fechar negócio e iniciar execução" })).toBeVisible();
  await expect(page.locator(".flow-summary")).toContainText("R$ 850.000");
  // Só os fatos da revisão REGENTE (R02) — a regra da R01 substituída não é herdada.
  await expect(page.locator(".flow-review")).toContainText("Por marco de entrega");
  await expect(page.locator(".flow-review")).not.toContainText("Mensal por avanço físico");
  await expect(page.locator(".flow-review")).toContainText("LT-2026-001 (concluído)");
  const confirm = page.getByTestId("confirm-execution-start");
  await expect(confirm).toBeDisabled();

  await page.getByLabel("Base da autorização").selectOption("customer_po");
  await expect(page.locator(".flow-footer-issue")).toContainText("referência verificável");
  await page.getByLabel("Referência da autorização").fill("PO 4500012345");
  await expect(confirm).toBeEnabled();
  await snap(info, "fast-track-panel-1440.png");
  await confirm.click();

  await expect.poll(() => captured.find((c) => c.path === "execution-start")?.body).toMatchObject({
    mode: "STANDARD", opportunity_id: "opp-x", technical_revision_id: "rev-pt1", commercial_revision_id: "rev-pc2",
    authorization: { type: "customer_po", reference: "PO 4500012345" },
    service_order: { mode: "generate" }, project: { mode: "create", payload: { nome: "Retrofit SE Norte", cliente: "Conta de teste A" } },
  });
  const result = page.getByTestId("execution-result");
  await expect(result).toContainText("Negócio fechado e execução iniciada");
  await expect(result).toContainText("OS-2026-0001");
  await expect(result).toContainText("Vinculado");

  await page.setViewportSize({ width: 390, height: 900 });
  expect(await noHorizontalScroll()).toBeTruthy();
  await snap(info, "fast-track-result-390.png");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.keyboard.press("Escape");
});

test("No-contract normal path: link an existing project, never a blank project form", async () => {
  await wire();
  overrides["POST execution-start"] = {
    ok: true, engagement_id: "eng-2", engagement_created: true, documentation_state: "COMPLETE",
    service_order_id: "os-2", service_order_number: "OS-2026-0002", service_order_status: "IN_EXECUTION",
    service_order_created: true, project_id: "proj-existing", blocked: [],
  };
  await page.goto("/comercial?view=oportunidades&opportunity=opp-x");
  await page.getByTestId("close-deal-command").getByRole("button", { name: /Fechar negócio e iniciar execução/ }).click();
  await page.getByLabel("Base da autorização").selectOption("customer_email");
  await page.getByLabel("Referência da autorização").fill("E-mail de 20/09 — Eng. Paula");
  await page.getByRole("radio", { name: "Vincular existente" }).last().click();
  await page.getByLabel("Projeto a vincular").selectOption("proj-existing");
  await page.getByTestId("confirm-execution-start").click();
  await expect.poll(() => captured.find((c) => c.path === "execution-start")?.body).toMatchObject({
    authorization: { type: "customer_email" }, project: { mode: "link", project_id: "proj-existing" },
  });
  await expect(page.getByTestId("execution-result")).toContainText("OS-2026-0002");
  await page.keyboard.press("Escape");
});

test("Exceptional start: governed fields, a loud warning, and the pending condition stays visible", async ({}, info) => {
  await wire();
  overrides["POST execution-start"] = {
    ok: true, engagement_id: "eng-1", engagement_created: true, documentation_state: "PENDING",
    service_order_id: "os-1", service_order_number: "OS-2026-0003", service_order_status: "IN_EXECUTION",
    service_order_created: true, project_id: "proj-new", blocked: [], followupId: "fu-9",
  };
  await page.goto("/comercial?view=oportunidades&opportunity=opp-x");
  await page.getByTestId("close-deal-command").getByRole("button", { name: /Início excepcional/ }).click();
  await expect(page.getByTestId("exception-fields")).toBeVisible();
  await expect(page.locator(".flow-review")).toContainText("nenhum aceite é registrado");
  const confirm = page.getByTestId("confirm-execution-start");
  await expect(confirm).toBeDisabled();

  await page.getByLabel("Referência da autorização").fill("Ligação do gerente às 07h40");
  await page.getByLabel("Motivo do início excepcional").fill("Parada emergencial da subestação");
  await page.getByLabel("Autorizado internamente por").selectOption("user-1");
  await page.getByLabel("Responsável pela regularização").selectOption("user-2");
  await page.getByLabel("Prazo de regularização").fill(date(10));
  await expect(page.locator(".flow-footer-danger")).toContainText("faturamento fica bloqueado");
  await theme("dark");
  await snap(info, "exceptional-panel-1440-dark.png");
  await theme("light");
  await confirm.click();
  await expect.poll(() => captured.find((c) => c.path === "execution-start")?.body).toMatchObject({
    mode: "EXCEPTIONAL", authorization: { type: "declared", reference: "Ligação do gerente às 07h40" },
    exception: { reason: "Parada emergencial da subestação", internal_authorizer_user_id: "user-1",
      regularization_owner_user_id: "user-2", regularization_due_date: date(10) },
  });
  await expect(page.getByTestId("execution-result")).toContainText("documentação pendente");
  await page.keyboard.press("Escape");

  // Depois: o dossiê mostra a pendência no topo, com o efeito no faturamento.
  overrides["GET opportunities/opp-x"] = { ...opportunityDetail,
    opportunity: { ...opportunity, stage: "WON", engagement_id: "eng-1" }, executionStart: pendingStart,
    serviceOrders: [{ id: "os-1", os_number: "OS-2026-0003", status: "IN_EXECUTION", project_id: "proj-new" }] };
  await page.goto("/comercial?view=oportunidades&opportunity=opp-x");
  const status = page.getByTestId("execution-status");
  await expect(status).toContainText("Autorizado com documentação pendente");
  await expect(status).toContainText("faturamento bloqueado");
  await expect(page.getByTestId("close-deal-command")).toHaveCount(0);
  await page.getByRole("button", { name: /Regularizar/ }).click();
  await page.getByLabel("Referência verificável").fill("PO 4500099999");
  await page.getByLabel("Nota de regularização").fill("PO recebido do cliente");
  await page.getByRole("button", { name: "Regularizar", exact: true }).last().click();
  await expect.poll(() => captured.find((c) => c.path === "execution-start/start-1/regularize")?.body).toMatchObject({
    sourceKind: "customer_po", externalReference: "PO 4500099999" });
  await snap(info, "pending-documentation-1440.png");
  await page.keyboard.press("Escape");
});

test("Follow-up ownership: my queue, legacy text marked, reassignment to a platform identity", async () => {
  await wire();
  await page.goto("/comercial?view=follow-ups&queue=mine");
  const table = page.getByRole("table", { name: "Fila de follow-ups" });
  await expect(table).toContainText("Enviar PT revisada");
  await expect(table).not.toContainText("Cobrar retorno da PC R02");
  await page.getByRole("button", { name: /^Todos/ }).first().click();
  await expect(table).toContainText("Fulano (legado) (texto)");
  await page.getByRole("button", { name: "Designar · Cobrar retorno da PC R02" }).click();
  await page.getByLabel("Nova pessoa responsável").selectOption("user-2");
  await page.getByRole("button", { name: /^Designar$/ }).click();
  await expect.poll(() => captured.find((c) => c.path === "followups/fu-1/assign")?.body)
    .toMatchObject({ responsibleUserId: "user-2" });
});

test("Forecast is investigative: hover shows contributors, click drills into the month", async ({}, info) => {
  await wire();
  await page.goto("/comercial?view=forecast");
  const column = page.getByRole("button", { name: new RegExp(`${new Date(`${month(1)}-15T12:00:00`).toLocaleDateString("pt-BR", { month: "long" })}`, "i") });
  await column.hover();
  await expect(page.getByRole("tooltip")).toContainText("Retrofit SE Norte");
  await expect(page.getByRole("tooltip")).toContainText("Manutenção anual");
  await column.click();
  const drill = page.getByTestId("forecast-month-drill");
  await expect(drill).toContainText(/Oportunidades\s*2/);
  await expect(drill.getByRole("link", { name: /Ver no pipeline/ })).toHaveAttribute("href", `/comercial?view=oportunidades&month=${month(1)}`);
  await expect(page.getByLabel("Motivos de saída")).toContainText("Preço acima do orçamento");
  await snap(info, "forecast-drill-1440.png");
});
