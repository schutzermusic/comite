/** UI-only fixtures are intercepted in this test. No business records are written. */
import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { readFileSync } from "node:fs";

const qa = JSON.parse(readFileSync("tests/.qa-env.json", "utf8")) as {
  email: string;
  password: string;
};
test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);
let context: BrowserContext;
let page: Page;
const areas = [
  ["", "Visão geral do comercial", "O que precisa de decisão"],
  ["contas", "Contas e contatos", "Base de relacionamento"],
  ["oportunidades", "Oportunidades", "Pipeline"],
  ["follow-ups", "Follow-ups comerciais", "Fila de acompanhamento"],
  ["propostas", "Propostas", "Central de propostas"],
  ["forecast", "Forecast", "Horizonte de decisão"],
] as const;
const zero: Record<string, unknown> = {
  opportunities: { opportunities: [], signals: [], nextActions: {}, owners: {} },
  contacts: { contacts: [] },
  proposals: { proposals: [], revisions: [] },
  followups: { followups: [], subjects: {}, owners: {} },
  forecast: {
    rows: [],
    movement: { days: 30, since: new Date(0).toISOString(), entered: [], left: [] },
    owners: {},
    disclaimer:
      "Pipeline ponderado. Não é receita contratada, backlog nem previsão contábil.",
  },
};
async function intercept(payloads: Record<string, unknown>) {
  await page.unroute("**/api/commercial/**");
  await page.route("**/api/commercial/**", async (route) => {
    if (route.request().method() !== "GET") return route.abort();
    const key = new URL(route.request().url()).pathname.split("/").pop()!;
    if (payloads[key])
      return route.fulfill({
        json: { ok: true, ...(payloads[key] as object) },
      });
    return route.continue();
  });
}
async function openArea(slug: string, heading: string) {
  await page.goto(`/comercial${slug ? `?view=${slug}` : ""}`);
  await expect(
    page.getByRole("heading", { name: heading, exact: true }),
  ).toBeVisible();
}
test.beforeAll(async ({ browser }) => {
  context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    reducedMotion: "reduce",
  });
  page = await context.newPage();
  page.setDefaultTimeout(30_000);
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(qa.email);
  await page.locator('input[type="password"]').fill(qa.password);
  await page.locator('input[type="password"]').press("Enter");
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
    timeout: 60_000,
  });
});
test.afterAll(async () => context?.close());

for (const theme of ["light", "dark"] as const) {
  test(`All six empty workspaces retain structure · ${theme} · desktop and mobile`, async ({}, info) => {
    await intercept(zero);
    await page.route("**/rest/v1/parties?*", (route) =>
      route.fulfill({ json: [] }),
    );
    await openArea("", "O que precisa de decisão");
    const toggle = page.getByRole("button", {
      name: `Switch to ${theme} mode`,
      exact: true,
    });
    if (await toggle.isVisible()) await toggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1100 });
      for (const [slug, label, heading] of areas) {
        await openArea(slug, heading);
        const region = page.getByRole("region", { name: label, exact: true });
        await expect(region).toBeVisible();
        await expect(region.locator(".crm-metrics").first()).toBeVisible();
        const action = (
          {
            "": "Nova oportunidade",
            contas: "Novo contato",
            oportunidades: "Nova oportunidade",
            propostas: "Nova proposta",
          } as Record<string, string>
        )[slug];
        if (action)
          await expect(
            region.getByRole("button", { name: action, exact: true }),
          ).toBeVisible();
        expect(
          await region.evaluate((el) =>
            [...el.children].every(
              (child) =>
                child.getBoundingClientRect().right <= window.innerWidth + 1,
            ),
          ),
        ).toBeTruthy();
        if (slug && !["oportunidades"].includes(slug))
          await expect(region.getByRole("table")).toBeVisible();
        if (slug === "oportunidades")
          await expect(region.locator(".crm-stage")).toHaveCount(4);
        if (slug === "forecast")
          await expect(region.locator(".crm-chart-axis span")).toHaveCount(6);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth + 1,
          ),
        ).toBeTruthy();
        await page.screenshot({
          path: info.outputPath(`${slug || "overview"}-${theme}-${width}.png`),
          fullPage: true,
        });
      }
    }
    await page.unroute("**/rest/v1/parties?*");
  });
}

const now = new Date();
const date = (offset: number) => {
  const d = new Date(now);
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const opportunities = [
  {
    id: "opp-a",
    title: "Cenário de teste · qualificação",
    counterparty_name: "Conta de teste A",
    code: "TEST-A",
    stage: "QUALIFICATION",
    estimated_value: "100000",
    currency: "BRL",
    probability: "0.2",
    expected_decision_date: date(0),
    created_at: now.toISOString(),
    // Entrou na etapa há 40 dias: acima do limiar declarado de 21 dias para
    // QUALIFICAÇÃO, e por isso esta linha prova o sinal de "parada".
    stage_entered_at: new Date(now.getTime() - 40 * 86400000).toISOString(),
    party_id: "party-a",
    owner_user_id: "user-1",
    engagement_id: null,
  },
  {
    id: "opp-b",
    title: "Cenário de teste · negociação",
    counterparty_name: "Conta de teste B",
    code: "TEST-B",
    stage: "NEGOTIATION",
    estimated_value: "50000",
    currency: "USD",
    probability: null,
    expected_decision_date: null,
    created_at: now.toISOString(),
    stage_entered_at: now.toISOString(),
    party_id: null,
    owner_user_id: null,
    engagement_id: null,
  },
  {
    id: "opp-c",
    title: "Cenário de teste · ganha",
    counterparty_name: "Conta de teste C",
    stage: "WON",
    estimated_value: null,
    currency: "BRL",
    probability: "1",
    expected_decision_date: date(0),
    stage_entered_at: now.toISOString(),
    party_id: null,
    owner_user_id: "user-1",
    engagement_id: null,
  },
];

/*
  Os sinais chegam PRONTOS do servidor — a tela não os recalcula, e por isso o
  teste os entrega como a rota entregaria. Cada um aqui corresponde a uma regra
  coberta em `tests/unit/commercial-pipeline-signals.test.ts`.
*/
const signals = [
  {
    kind: "CUSTOMER_RESPONSE_OVERDUE",
    severity: "blocking",
    opportunityId: "opp-a",
    title: "Conta de teste A está 3 dia(s) além do retorno esperado",
    detail: "Resposta do cliente",
    suggestedAction: "Retomar o contato e registrar a nova data esperada",
  },
  {
    kind: "OPPORTUNITY_STALLED",
    severity: "attention",
    opportunityId: "opp-a",
    title: "Cenário de teste · qualificação está há 40 dias na mesma etapa",
    detail: "O limiar declarado para esta etapa é de 21 dias.",
    suggestedAction: "Avançar, recuar com motivo, ou encerrar a oportunidade",
  },
  {
    kind: "NO_NEXT_ACTION",
    severity: "attention",
    opportunityId: "opp-b",
    title: "Cenário de teste · negociação está sem próxima ação",
    detail: "Nenhum acompanhamento aberto para Conta de teste B.",
    suggestedAction: "Agendar o follow-up com objetivo, responsável e prazo",
  },
  {
    kind: "MISSING_EXPECTED_CLOSE",
    severity: "info",
    opportunityId: "opp-b",
    title: "Cenário de teste · negociação não tem previsão de decisão",
    detail: "Sem a data, a oportunidade não entra em nenhum mês do forecast.",
    suggestedAction: "Informar a data prevista de decisão",
  },
  {
    kind: "WON_WITHOUT_AUTHORIZED_WORK",
    severity: "attention",
    opportunityId: "opp-c",
    title: "Cenário de teste · ganha foi ganha sem trabalho autorizado",
    detail: "O resultado comercial está registrado e nenhuma autorização abriu a execução.",
    suggestedAction: "Abrir o trabalho autorizado a partir da fonte de autorização",
  },
];
const filled = {
  ...zero,
  opportunities: {
    opportunities,
    signals,
    nextActions: {
      "opp-a": {
        id: "f1",
        goal: "Compromisso atrasado de teste",
        state: "ACTIVE",
        due_date: date(-1),
        next_expected_event: "Resposta do cliente",
        next_expected_event_at: date(-3),
      },
    },
    owners: { "user-1": "Responsável de teste" },
  },
  contacts: {
    contacts: [
      {
        id: "contact-a",
        party_id: "party-a",
        full_name: "Contato de teste",
        role_title: "Compras",
        email: "qa@example.invalid",
        phone: null,
        active: true,
        is_primary: true,
        party: { legal_name: "Conta de teste A" },
      },
    ],
  },
  proposals: {
    proposals: [
      {
        id: "prop-a",
        proposal_number: "TEST-P",
        kind: "COMBINED",
        title: "Proposta de teste",
        counterparty_name: "Conta de teste A",
        currency: "BRL",
        opportunity_id: "opp-a",
      },
    ],
    revisions: [
      {
        id: "rev-a",
        proposal_id: "prop-a",
        revision: 2,
        status: "ACCEPTED",
        total_value: "100000",
        currency: "BRL",
        validity_until: date(7),
        accepted_at: date(0),
        acceptance_source: "customer_email",
      },
      {
        id: "rev-b",
        proposal_id: "prop-a",
        revision: 3,
        status: "DRAFT",
        total_value: "120000",
        currency: "BRL",
      },
    ],
  },
  followups: {
    subjects: {
      "commercial_opportunity:opp-a": {
        label: "Cenário de teste · qualificação",
        counterparty: "Conta de teste A",
      },
      "commercial_proposal:prop-a": {
        label: "TEST-P · Proposta de teste",
        counterparty: "Conta de teste A",
      },
      "commercial_opportunity:opp-b": {
        label: "Cenário de teste · negociação",
        counterparty: "Conta de teste B",
      },
    },
    owners: {},
    followups: [
      {
        id: "f1",
        goal: "Compromisso atrasado de teste",
        source_kind: "commercial_opportunity",
        source_id: "opp-a",
        due_date: date(-1),
        state: "ACTIVE",
        responsible_text: "Responsável de teste",
        next_expected_event: "Resposta do cliente",
        expected_evidence: "E-mail",
      },
      {
        id: "f2",
        goal: "Compromisso de hoje de teste",
        source_kind: "commercial_proposal",
        source_id: "prop-a",
        due_date: date(0),
        state: "WAITING_EXTERNAL_PARTY",
        responsible_text: null,
        next_expected_event: null,
      },
      {
        id: "f3",
        goal: "Compromisso futuro de teste",
        source_kind: "commercial_opportunity",
        source_id: "opp-b",
        due_date: date(3),
        state: "ACTIVE",
        next_expected_event: "Reunião",
      },
      {
        id: "f4",
        goal: "Compromisso concluído de teste",
        source_kind: "commercial_proposal",
        source_id: "prop-a",
        due_date: date(-2),
        state: "COMPLETED",
      },
      {
        id: "f5",
        goal: "Compromisso cancelado de teste",
        source_kind: "commercial_proposal",
        source_id: "prop-a",
        due_date: date(-3),
        state: "CANCELLED",
      },
    ],
  },
  forecast: {
    movement: {
      days: 30,
      since: date(-30),
      entered: [
        {
          id: "ev-1",
          opportunity_id: "opp-b",
          from_stage: null,
          to_stage: "QUALIFICATION",
          reason: null,
          actor_user_id: "user-1",
          occurred_at: new Date(now.getTime() - 5 * 86400000).toISOString(),
          opportunity: opportunities[1],
        },
      ],
      left: [
        {
          id: "ev-2",
          opportunity_id: "opp-c",
          from_stage: "NEGOTIATION",
          to_stage: "WON",
          reason: null,
          actor_user_id: "user-1",
          occurred_at: new Date(now.getTime() - 2 * 86400000).toISOString(),
          opportunity: opportunities[2],
        },
      ],
    },
    owners: { "user-1": "Responsável de teste" },
    rows: [
      {
        ...opportunities[0],
        opportunity_id: "opp-a",
        applied_probability: "0.2",
        probability_source: "informed",
        weighted_value: "20000",
      },
      {
        ...opportunities[1],
        opportunity_id: "opp-b",
        applied_probability: "0.7",
        probability_source: "stage_default",
        weighted_value: "35000",
      },
    ],
    disclaimer:
      "Pipeline ponderado. Não é receita contratada, backlog nem previsão contábil.",
  },
};

test("Data-ready views: filters, accepted revision, queue semantics, currencies and forecast", async ({}, info) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await intercept(filled);
  await page.route("**/rest/v1/parties?*", (route) =>
    route.fulfill({
      json: [
        {
          id: "party-a",
          legal_name: "Conta de teste A",
          document_number: "Documento de teste",
          active: true,
        },
      ],
    }),
  );
  for (const theme of ["light", "dark"] as const) {
    await openArea("", "O que precisa de decisão");
    const toggle = page.getByRole("button", {
      name: `Switch to ${theme} mode`,
      exact: true,
    });
    if (await toggle.isVisible()) await toggle.click();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1100 });
      for (const [slug, label, heading] of areas) {
        await openArea(slug, heading);
        expect(
          await page
            .getByRole("region", { name: label, exact: true })
            .evaluate((el) =>
              [...el.children].every(
                (child) =>
                  child.getBoundingClientRect().right <= window.innerWidth + 1,
              ),
            ),
        ).toBeTruthy();
        await page.screenshot({
          path: info.outputPath(
            `filled-${slug || "overview"}-${theme}-${width}.png`,
          ),
          fullPage: true,
        });
      }
    }
  }
  await page.setViewportSize({ width: 1440, height: 1100 });
  await openArea("", "O que precisa de decisão");
  await expect(
    page.getByRole("button", { name: /Pipeline aberto/ }),
  ).toContainText("US$");
  await expect(
    page.getByRole("button", { name: /Pipeline aberto/ }),
  ).toContainText("100.000");
  await openArea("contas", "Base de relacionamento");
  await expect(
    page.getByRole("table", { name: "Contas", exact: true }),
  ).toContainText("Conta de teste A");
  await page
    .getByRole("group", { name: "Tipo de cadastro" })
    .getByRole("button", { name: /Contatos/ })
    .click();
  await expect(
    page.getByRole("table", { name: "Contatos", exact: true }),
  ).toContainText("Contato de teste");
  await page.getByRole("searchbox").fill("inexistente");
  await expect(page.getByText("Nenhum contato neste recorte")).toBeVisible();
  await openArea("oportunidades", "Pipeline");
  await page.getByRole("button", { name: "Lista", exact: true }).click();
  await page.getByLabel("Etapa", { exact: true }).selectOption("WON");
  await expect(page.getByRole("table")).toContainText(
    "Cenário de teste · ganha",
  );
  await expect(page.getByRole("table")).not.toContainText(
    "Cenário de teste · qualificação",
  );
  await openArea("propostas", "Central de propostas");
  await expect(page.getByRole("table")).toContainText("R02");
  await expect(page.getByRole("table")).not.toContainText("R03");
  await expect(
    page.getByRole("button", {
      name: "Gerar trabalho autorizado",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Enviar para aprovação interna",
      exact: true,
    }),
  ).toHaveCount(0);
  await openArea("follow-ups", "Fila de acompanhamento");
  const buckets = page.getByRole("group", { name: "Prazo do acompanhamento" });
  await buckets.getByRole("button", { name: /Atrasados/ }).click();
  await expect(page.getByRole("table")).toContainText("Compromisso atrasado");
  await expect(page.getByRole("table")).not.toContainText(
    "Compromisso cancelado",
  );
  await buckets.getByRole("button", { name: /Sem próxima ação/ }).click();
  await expect(page.getByRole("table")).toContainText("Compromisso de hoje");
  await expect(page.getByRole("table")).not.toContainText(
    "Compromisso concluído",
  );
  await openArea("forecast", "Horizonte de decisão");
  await expect(
    page.getByRole("table", { name: "Composição do forecast" }),
  ).toContainText("20.000");
  await page.getByLabel("Moeda do forecast").selectOption("USD");
  await expect(
    page.getByText("Nenhuma decisão neste recorte"),
  ).toBeVisible();
  await expect(
    page.getByRole("table", { name: "Oportunidades fora do horizonte" }),
  ).toContainText("35.000");
  await page.getByLabel("Horizonte do forecast").selectOption("12");
  await expect(page.locator(".crm-chart-axis span")).toHaveCount(12);
  await page.unroute("**/rest/v1/parties?*");
});

test("Creation submits the existing opportunity contract and recovers from server denial", async () => {
  await intercept(zero);
  await openArea("oportunidades", "Pipeline");
  await page.route("**/rest/v1/parties?*", (route) =>
    route.fulfill({
      json: [{ id: "party-a", legal_name: "Conta sem persistência", trade_name: null, document_number: null, kind: "organization", active: true }],
    }),
  );
  await page
    .getByRole("button", { name: "Nova oportunidade", exact: true })
    .click();
  // A conta vem do cadastro único: busca e escolha, nunca texto livre.
  await page.getByTestId("flow-opportunity").locator("input[role=combobox]").fill("Conta");
  await page.locator(".crm-combobox-list [role=option]", { hasText: "Conta sem persistência" }).click();
  await page.getByPlaceholder("Ex.: Retrofit da subestação SE-04").fill("Teste sem persistência");
  await page.getByLabel("Probabilidade (%) · opcional").fill("35");
  let submitted: Record<string, unknown> | undefined;
  await page.route("**/api/commercial/opportunities", async (route) => {
    if (route.request().method() === "POST") {
      submitted = route.request().postDataJSON();
      return route.fulfill({
        status: 403,
        json: { ok: false, error: "Sem permissão para salvar este registro." },
      });
    }
    return route.fallback();
  });
  await page.getByTestId("opportunity-submit").click();
  await expect(
    page.getByText("Sem permissão para salvar este registro."),
  ).toBeVisible();
  expect(submitted).toMatchObject({
    title: "Teste sem persistência",
    party_id: "party-a",
    counterparty_name: "Conta sem persistência",
    stage: "QUALIFICATION",
    probability: 0.35,
    currency: "BRL",
  });
  await expect(page.getByTestId("opportunity-submit")).toBeEnabled();
  await page.getByTestId("flow-opportunity").getByRole("button", { name: "Cancelar", exact: true }).click();
  await page.unroute("**/rest/v1/parties?*");
});

test("Failed requests never render misleading zero metrics", async () => {
  await page.unroute("**/api/commercial/**");
  await page.route("**/api/commercial/**", (route) =>
    route.fulfill({
      status: 403,
      json: { ok: false, error: "Esta ação exige: commercial.view" },
    }),
  );
  await page.goto("/comercial?view=oportunidades");
  await expect(
    page.getByText("Esta ação exige: commercial.view"),
  ).toBeVisible();
  await expect(page.locator(".crm-metrics")).toHaveCount(0);
});

test("Contact and proposal forms submit canonical references through existing APIs", async () => {
  await intercept(filled);
  await page.route("**/rest/v1/parties?*", (route) =>
    route.fulfill({
      json: [{ id: "party-a", legal_name: "Conta de teste A", active: true }],
    }),
  );
  for (const kind of ["contacts", "proposals"] as const) {
    await openArea(
      kind === "contacts" ? "contas" : "propostas",
      kind === "contacts" ? "Base de relacionamento" : "Central de propostas",
    );
    await page
      .getByRole("button", {
        name: kind === "contacts" ? "Novo contato" : "Nova proposta",
        exact: true,
      })
      .click();
    if (kind === "contacts") {
      // Primeiro a conta (cadastro único), depois a pessoa.
      await page.getByTestId("flow-contact").locator("input[role=combobox]").fill("Conta");
      await page.locator(".crm-combobox-list [role=option]", { hasText: "Conta de teste A" }).click();
      await page.getByPlaceholder("Nome e sobrenome").fill("Contato de teste");
    } else {
      // PDF primeiro; a criação manual continua como segunda opção.
      await expect(page.getByTestId("proposal-start-import")).toBeVisible();
      await page.getByTestId("proposal-start-manual").click();
      await page.getByTestId("proposal-opportunity").selectOption("opp-a");
      await page.getByPlaceholder("Ex.: PC-2026-118").fill("TEST-NOVA");
      await page.getByTestId("flow-proposal-manual").getByRole("textbox", { name: /Título/ }).fill("Proposta de teste");
      await expect(page.getByTestId("flow-proposal-manual")).toContainText("Conta de teste A");
    }
    let submitted: Record<string, unknown> | undefined;
    await page.route(`**/api/commercial/${kind}`, async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      submitted = route.request().postDataJSON();
      return route.fulfill({ json: { ok: true } });
    });
    await page
      .getByRole("button", {
        name: kind === "contacts" ? "Salvar contato" : "Criar e abrir",
        exact: true,
      })
      .click();
    await expect(page.locator(".crm-flow")).toHaveCount(0);
    expect(submitted).toMatchObject(
      kind === "contacts"
        ? { party_id: "party-a", full_name: "Contato de teste" }
        : {
            opportunity_id: "opp-a",
            kind: "COMBINED",
            proposal_number: "TEST-NOVA",
          },
    );
    await page.unroute(`**/api/commercial/${kind}`);
  }
  await page.unroute("**/rest/v1/parties?*");
});

test("Read-only users see the workspace without mutation controls", async () => {
  await intercept(filled);
  await page.route("**/rest/v1/role_permissions?*", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({
      response,
      json: body.filter(
        (row: { permissions?: { key: string } }) =>
          !row.permissions?.key.startsWith("commercial.") ||
          row.permissions?.key === "commercial.view",
      ),
    });
  });
  await openArea("propostas", "Central de propostas");
  // Wait for identity and permission queries to finish before checking absence.
  await expect(
    page.getByRole("button", { name: /QA Workforce Bot/ }),
  ).toBeVisible();
  // Nada some em silêncio: a entrada aparece desabilitada e diz o que falta.
  const create = page.getByRole("button", { name: "Nova proposta", exact: true });
  await expect(create).toHaveAttribute("title", /commercial\.proposals\.manage/);
  await expect(create).toBeDisabled();
  await expect(page.getByTestId("create-proposal")).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "Gerar trabalho autorizado",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.unroute("**/rest/v1/role_permissions?*");
});

/* ==========================================================================
   PROFUNDIDADE DE PRODUTO — os espaços de detalhe e os atos governados
   ==========================================================================
   Tudo abaixo continua interceptado dentro do Playwright: nenhuma linha de
   negócio é escrita. O que estes testes provam é o CONTRATO das telas novas —
   quais fatos aparecem, o que a tela manda ao servidor e o que ela recusa a
   mostrar quando a alçada não alcança. */

/** O dossiê da oportunidade, como a rota o entrega. */
const opportunityDetail = {
  opportunity: {
    ...opportunities[0],
    notes: "Observação de teste",
    lost_reason: null,
    source: "indicação",
  },
  party: {
    id: "party-a",
    legal_name: "Conta de teste A",
    trade_name: null,
    document_number: "Documento de teste",
  },
  contacts: [
    {
      id: "contact-a",
      full_name: "Contato de teste",
      role_title: "Compras",
      email: "qa@example.invalid",
      phone: "+55 11 0000-0000",
      is_primary: true,
      active: true,
    },
  ],
  proposals: [
    {
      id: "prop-a",
      proposal_number: "TEST-P",
      kind: "COMBINED",
      title: "Proposta de teste",
      currency: "BRL",
      created_at: now.toISOString(),
    },
  ],
  revisions: [
    {
      id: "rev-a",
      proposal_id: "prop-a",
      revision: 2,
      status: "ACCEPTED",
      total_value: "100000",
      currency: "BRL",
      validity_until: date(7),
      accepted_at: now.toISOString(),
      sent_at: null,
      internally_approved_at: null,
      created_at: now.toISOString(),
    },
  ],
  followups: [
    {
      id: "f1",
      source_kind: "commercial_opportunity",
      source_id: "opp-a",
      goal: "Compromisso atrasado de teste",
      expected_evidence: "E-mail do cliente",
      state: "ACTIVE",
      due_date: date(-1),
      next_expected_event: "Resposta do cliente",
      next_expected_event_at: date(-3),
      responsible_text: "Responsável de teste",
      responsible_user_id: null,
      cadence_days: null,
      closed_at: null,
      created_at: now.toISOString(),
    },
  ],
  stageEvents: [
    {
      id: "se-1",
      from_stage: null,
      to_stage: "QUALIFICATION",
      reason: null,
      actor_user_id: "user-1",
      occurred_at: new Date(now.getTime() - 40 * 86400000).toISOString(),
    },
  ],
  signals: signals.filter((signal) => signal.opportunityId === "opp-a"),
  owners: { "user-1": "Responsável de teste" },
};

const proposalDetail = {
  proposal: {
    id: "prop-a",
    opportunity_id: "opp-a",
    proposal_number: "TEST-P",
    kind: "COMBINED",
    title: "Proposta de teste",
    counterparty_name: "Conta de teste A",
    party_id: "party-a",
    currency: "BRL",
    owner_user_id: "user-1",
    created_at: now.toISOString(),
  },
  revisions: [
    {
      id: "rev-a",
      proposal_id: "prop-a",
      revision: 2,
      status: "ACCEPTED",
      total_value: "100000",
      currency: "BRL",
      validity_until: date(7),
      payment_terms: "30 dias após a medição",
      scope_summary: "Escopo de teste",
      acceptance_conditions: null,
      document_id: "doc-a",
      internal_review_at: null,
      internally_approved_at: null,
      internally_approved_by: null,
      sent_at: new Date(now.getTime() - 3 * 86400000).toISOString(),
      sent_by: "user-1",
      negotiation_at: null,
      accepted_at: new Date(now.getTime() - 86400000).toISOString(),
      acceptance_source: "customer_email",
      acceptance_document_id: null,
      acceptance_external_ref: null,
      acceptance_note: null,
      recorded_by: "user-1",
      rejected_at: null,
      rejection_reason: null,
      expired_at: null,
      withdrawn_at: null,
      superseded_at: null,
      supersedes_id: null,
      superseded_by_id: null,
      created_by: "user-1",
      created_at: now.toISOString(),
    },
    {
      id: "rev-b",
      proposal_id: "prop-a",
      revision: 3,
      status: "DRAFT",
      total_value: "120000",
      currency: "BRL",
      validity_until: null,
      payment_terms: null,
      scope_summary: null,
      acceptance_conditions: null,
      document_id: null,
      internal_review_at: null,
      internally_approved_at: null,
      internally_approved_by: null,
      sent_at: null,
      sent_by: null,
      negotiation_at: null,
      accepted_at: null,
      acceptance_source: null,
      acceptance_document_id: null,
      acceptance_external_ref: null,
      acceptance_note: null,
      recorded_by: null,
      rejected_at: null,
      rejection_reason: null,
      expired_at: null,
      withdrawn_at: null,
      superseded_at: null,
      supersedes_id: null,
      superseded_by_id: null,
      created_by: "user-1",
      created_at: now.toISOString(),
    },
  ],
  opportunity: {
    id: "opp-a",
    title: "Cenário de teste · qualificação",
    stage: "QUALIFICATION",
    counterparty_name: "Conta de teste A",
    estimated_value: "100000",
    currency: "BRL",
    expected_decision_date: date(0),
  },
  facts: [
    {
      id: "fact-a",
      document_id: "doc-a",
      document_context: "COMMERCIAL_PROPOSAL",
      subject_kind: "proposal_revision",
      subject_id: "rev-a",
      fact_domain: "MEASUREMENT_RULE",
      label: "Regra de medição de teste",
      value_text: "Medição mensal por avanço físico",
      value_numeric: null,
      value_date: null,
      unit: null,
      currency: null,
      source_revision: "R02",
      source_page: 12,
      source_section: "Cláusula 4.2",
      source_quote: "A medição será mensal, por avanço físico verificado.",
      confidence: "0.91",
      extraction_method: "ai",
      provenance_state: "ANCHORED",
      confirmation_state: "CONFIRMED",
      corrected_value: null,
      confirmed_at: now.toISOString(),
    },
    {
      id: "fact-b",
      document_id: "doc-a",
      document_context: "COMMERCIAL_PROPOSAL",
      subject_kind: "proposal_revision",
      subject_id: "rev-a",
      fact_domain: "PAYMENT_TERM",
      label: "Condição de pagamento de teste",
      value_text: "30 dias",
      value_numeric: null,
      value_date: null,
      unit: null,
      currency: null,
      source_revision: null,
      source_page: null,
      source_section: null,
      source_quote: null,
      confidence: null,
      extraction_method: "ai",
      provenance_state: "UNANCHORED",
      confirmation_state: "UNCONFIRMED",
      corrected_value: null,
      confirmed_at: null,
    },
  ],
  followups: [],
  documents: [
    {
      id: "doc-a",
      title: "Proposta comercial de teste.pdf",
      file_path: "test/proposta.pdf",
      document_type: "contract",
      status: "uploaded",
      created_at: now.toISOString(),
    },
  ],
  authorizations: [
    {
      id: "auth-a",
      engagement_id: "eng-a",
      source_kind: "accepted_proposal",
      proposal_revision_id: "rev-a",
      authorized_value: "100000",
      currency: "BRL",
      effective_from: null,
      effective_until: null,
      governing: true,
      state: "ACTIVE",
    },
  ],
  engagements: [
    {
      id: "eng-a",
      engagement_number: "TA-TESTE-0001",
      title: "Trabalho autorizado de teste",
      status: "AUTHORIZED",
      authorized_value: "100000",
      currency: "BRL",
      authorized_at: now.toISOString(),
    },
  ],
  serviceOrders: [],
  divergences: [
    {
      id: "div-a",
      engagement_id: "eng-a",
      service_order_id: null,
      scope: "VALUE",
      field_path: null,
      left_source_kind: "accepted_proposal",
      left_value: "100000",
      right_source_kind: "internal_service_order",
      right_value: "90000",
      severity: "BLOCKING",
      summary: "Valor da OS diverge da proposta aceita",
      detected_by: "rule",
      state: "OPEN",
      resolved_source_kind: null,
    },
  ],
  owners: { "user-1": "Responsável de teste" },
  executionVisibility: "visible",
};

const accountDetail = {
  party: {
    id: "party-a",
    legal_name: "Conta de teste A",
    trade_name: null,
    document_number: "Documento de teste",
    created_at: now.toISOString(),
  },
  contacts: opportunityDetail.contacts.map((contact) => ({
    ...contact,
    created_at: now.toISOString(),
  })),
  opportunities: [opportunities[0]],
  proposals: [
    {
      id: "prop-a",
      proposal_number: "TEST-P",
      kind: "COMBINED",
      title: "Proposta de teste",
      opportunity_id: "opp-a",
      currency: "BRL",
      created_at: now.toISOString(),
    },
  ],
  revisions: [
    {
      id: "rev-a",
      proposal_id: "prop-a",
      revision: 2,
      status: "ACCEPTED",
      total_value: "100000",
      currency: "BRL",
      validity_until: date(7),
      accepted_at: now.toISOString(),
    },
  ],
  followups: opportunityDetail.followups,
  engagements: proposalDetail.engagements,
  projects: [
    { engagement_id: "eng-a", project_id: "proj-teste", name: "Projeto de teste", code: "PT-01" },
  ],
  signals: signals.filter((signal) => signal.opportunityId === "opp-a"),
  owners: { "user-1": "Responsável de teste" },
  engagementVisibility: "visible",
  projectVisibility: "visible",
};

const deep = {
  ...filled,
  "opp-a": opportunityDetail,
  "prop-a": proposalDetail,
  "party-a": accountDetail,
};

test("Opportunity workspace: account, value, aging, next action, signals and timeline", async ({}, info) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await intercept(deep);
  await openArea("oportunidades", "Pipeline");

  // O kanban leva ao dossiê, e o dossiê abre sobre o pipeline sem perder o recorte.
  await page
    .getByRole("button", { name: /Cenário de teste · qualificação/ })
    .first()
    .click();
  const drawer = page.getByRole("heading", {
    level: 2,
    name: "Cenário de teste · qualificação",
    exact: true,
  });
  await expect(drawer).toBeVisible();

  // Os fatos que um CRM tem de responder sem uma segunda tela.
  await expect(page.getByText("Valor estimado", { exact: true })).toBeVisible();
  await expect(page.getByText("Idade na etapa", { exact: true })).toBeVisible();
  await expect(page.getByText("Limiar declarado: 21 dias")).toBeVisible();
  await expect(page.getByText("Próxima ação", { exact: true })).toBeVisible();
  await expect(page.getByText("Decisão prevista", { exact: true })).toBeVisible();
  // Escopado à faixa de fatos da gaveta: o mesmo nome também povoa o <option>
  // do filtro de responsável que ficou atrás dela.
  await expect(page.locator(".crm-facts").last()).toContainText("Responsável de teste");

  // Os sinais são os MESMOS que a lista mostra — um cálculo só, no servidor.
  await expect(page.getByText(/está há 40 dias na mesma etapa/)).toBeVisible();
  await expect(
    page.getByText("Retomar o contato e registrar a nova data esperada", { exact: false }),
  ).toBeVisible();

  // Conta, contatos, follow-ups, propostas e linha do tempo — no mesmo
  // dossiê, cada um na sua aba: tudo a um clique, nada empilhado de uma vez.
  const tabs: Array<[RegExp, string]> = [
    [/^Conta/, "Conta e contatos"],
    [/^Follow-ups/, "Follow-ups"],
    [/^Propostas/, "Propostas vinculadas"],
    [/^Atividade/, "Linha do tempo"],
  ];
  for (const [tab, section] of tabs) {
    await page.getByRole("tab", { name: tab }).click();
    await expect(
      page.getByRole("heading", { level: 4, name: new RegExp(section) }),
    ).toBeVisible();
    // Cada asserção é escopada à sua seção: os mesmos nomes reaparecem em
    // rótulos acessíveis e em listas atrás da gaveta.
    if (section === "Conta e contatos") {
      await expect(page.locator(".crm-contacts")).toContainText("Contato de teste");
    }
    if (section === "Follow-ups") {
      await expect(page.locator(".crm-followup-list")).toContainText("Compromisso atrasado de teste");
      // Responsável em texto livre (legado) aparece marcado como tal.
      await expect(page.locator(".crm-followup-list")).toContainText("(texto)");
    }
    if (section === "Propostas vinculadas") {
      // Uma linha por proposta (contexto PT + PC), com documento e revisão regente.
      await expect(page.locator(".crm-linked-list")).toContainText("Proposta de teste");
      await expect(page.locator(".crm-linked-list")).toContainText("TEST-P R02");
    }
    if (section === "Linha do tempo") {
      await expect(page.locator(".crm-timeline")).toContainText("Oportunidade registrada em Qualificação");
    }
  }
  await page.getByRole("tab", { name: /^Resumo/ }).click();

  await page.screenshot({
    path: info.outputPath("opportunity-workspace-1440.png"),
    fullPage: true,
  });

  // Mobile: a gaveta ocupa a tela inteira e nada vaza para os lados.
  await page.setViewportSize({ width: 390, height: 1100 });
  await expect(drawer).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: info.outputPath("opportunity-workspace-390.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.keyboard.press("Escape");
});

test("Governed stage change: the reason is demanded before the request leaves the screen", async () => {
  await intercept(deep);
  await openArea("oportunidades", "Pipeline");
  await page
    .getByRole("button", { name: /Cenário de teste · qualificação/ })
    .first()
    .click();
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "Cenário de teste · qualificação",
      exact: true,
    }),
  ).toBeVisible();

  let submitted: Record<string, unknown> | undefined;
  await page.route("**/api/commercial/opportunities/opp-a/stage", async (route) => {
    submitted = route.request().postDataJSON();
    return route.fulfill({
      status: 422,
      json: { ok: false, error: "Perder ou abandonar exige o motivo declarado." },
    });
  });

  const move = page.getByLabel("Mover para a etapa");
  // Uma etapa encerrada não está na lista: o banco recusaria, e a tela não oferece.
  await expect(move).toBeVisible();
  await move.selectOption("LOST");

  // O motivo só aparece quando o destino o exige — e enquanto ele está vazio,
  // o botão não manda nada.
  const reason = page.getByLabel("Motivo do encerramento");
  await expect(reason).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Registrar mudança", exact: true }),
  ).toBeDisabled();

  await reason.fill("Cliente optou pelo concorrente");
  await page.getByRole("button", { name: "Registrar mudança", exact: true }).click();
  await expect
    .poll(() => submitted)
    .toMatchObject({ to: "LOST", reason: "Cliente optou pelo concorrente" });

  await page.unroute("**/api/commercial/opportunities/opp-a/stage");
  await page.keyboard.press("Escape");
});

test("Commercial follow-up creation reaches the canonical engine with idempotency", async () => {
  await intercept(deep);
  await openArea("follow-ups", "Fila de acompanhamento");

  let submitted: Record<string, unknown> | undefined;
  let idempotency: string | null = null;
  await page.route("**/api/commercial/followups", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    submitted = route.request().postDataJSON();
    idempotency = route.request().headers()["idempotency-key"] ?? null;
    return route.fulfill({
      status: 422,
      json: { ok: false, error: "Um acompanhamento governado exige responsável." },
    });
  });

  await page.getByTestId("followup-new").click();
  // O vínculo é o primeiro campo: sem objeto não há compromisso.
  await page.getByTestId("followup-subject").click();
  await page.locator(".crm-combobox-list [role=option]").first().click();

  await page
    .getByPlaceholder("Ex.: obter a resposta do cliente sobre a revisão R02")
    .fill("Obter a resposta do cliente sobre a revisão");
  // Responsável é uma IDENTIDADE da plataforma; texto livre só para quem está
  // fora dela — e, escolhida essa opção, sem nome o motor recusaria e a tela
  // recusa antes. Escopado ao formulário: a fila atrás tem um <select> com o
  // mesmo nome acessível.
  await page.locator('.crm-flow select[aria-label="Responsável"]').selectOption("__external__");
  await expect(page.getByTestId("followup-submit")).toBeDisabled();
  await page
    .getByRole("textbox", { name: /Responsável — nome de quem não usa a plataforma/ })
    .fill("Responsável de teste");
  await page.getByPlaceholder("Ex.: e-mail do cliente confirmando o aceite").fill("E-mail do cliente");
  await page.getByTestId("followup-submit").click();

  await expect
    .poll(() => submitted)
    .toMatchObject({
      sourceKind: "commercial_opportunity",
      goal: "Obter a resposta do cliente sobre a revisão",
      responsibleText: "Responsável de teste",
      responsibleUserId: null,
      expectedEvidence: "E-mail do cliente",
    });
  expect(idempotency ?? "").toMatch(/^commercial-followup:[\w-]{8,}/);
  await expect(
    page.getByText("Um acompanhamento governado exige responsável."),
  ).toBeVisible();

  await page.unroute("**/api/commercial/followups");
  // Escape em vez do botão: "Cancelar" também nomeia a ação de cancelar
  // acompanhamento em cada linha da fila, atrás do formulário.
  await page.keyboard.press("Escape");
});

test("Proposal workspace: governing revision, provenance, divergences and handoff", async ({}, info) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await intercept(deep);
  await openArea("propostas", "Central de propostas");
  await page.getByRole("button", { name: "Proposta de teste", exact: true }).first().click();

  await expect(
    page.getByRole("heading", { level: 2, name: "Proposta de teste", exact: true }),
  ).toBeVisible();

  // A ACEITA rege mesmo com um rascunho R03 mais novo em cima.
  const header = page.getByTestId("proposal-context-header");
  await expect(header.getByTestId("proposal-doc-combined")).toContainText("TEST-P");
  await expect(header.getByTestId("proposal-doc-combined")).toContainText("R02");
  await expect(header.getByTestId("proposal-doc-combined")).toContainText("Aceita pelo cliente");
  await page.getByRole("tab", { name: /^Revisões/ }).click();
  await expect(page.getByText("Regente", { exact: true })).toBeVisible();

  // Valor, condição de pagamento, validade e estado do aceite, sem segunda tela.
  await expect(page.getByText("30 dias após a medição").first()).toBeVisible();
  await expect(header).toContainText("Aceita");

  await page.getByRole("tab", { name: /^Fatos e blueprint/ }).click();
  // Fato ancorado E confirmado vira regra; o não ancorado é dito como tal.
  // `exact` importa: a frase do fato NÃO ancorado termina em "não promovível a
  // regra", e um match por substring acertaria as duas.
  await expect(page.getByText("Promovível a regra", { exact: true })).toBeVisible();
  await expect(page.getByText(/p\. 12/)).toBeVisible();
  await expect(
    page.getByText("A medição será mensal, por avanço físico verificado."),
  ).toBeVisible();
  await expect(
    page.getByText("Sem página e trecho literal — não promovível a regra"),
  ).toBeVisible();

  // Divergência bloqueante aparece, e a passagem para a OS diz onde parou.
  await page.getByRole("tab", { name: /^Execução/ }).click();
  await expect(page.getByText("Valor da OS diverge da proposta aceita")).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 4, name: /Passagem para execução/ }),
  ).toBeVisible();
  await expect(page.getByText("TA-TESTE-0001 · Autorizado")).toBeVisible();
  await expect(
    page.getByText(/1 divergência\(s\) bloqueante\(s\)/).first(),
  ).toBeVisible();

  await page.screenshot({
    path: info.outputPath("proposal-workspace-1440.png"),
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 1100 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: info.outputPath("proposal-workspace-390.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.keyboard.press("Escape");
});

test("Restricted execution sections say so instead of rendering a misleading emptiness", async () => {
  await intercept({
    ...deep,
    "prop-a": {
      ...proposalDetail,
      documents: [],
      authorizations: [],
      engagements: [],
      serviceOrders: [],
      divergences: [],
      executionVisibility: "restricted",
    },
  });
  await openArea("propostas", "Central de propostas");
  await page.getByRole("button", { name: "Proposta de teste", exact: true }).first().click();
  await expect(
    page.getByRole("heading", { level: 2, name: "Proposta de teste", exact: true }),
  ).toBeVisible();

  await page.getByRole("tab", { name: /^Execução/ }).click();
  const restricted = page.locator(".crm-section-restricted");
  await expect(restricted.first()).toContainText("contracts.view");
  await expect(restricted.first()).toContainText("não confunda com ausência de registros");
  await expect(page.getByText("Nenhuma divergência em aberto")).toHaveCount(0);
  await page.keyboard.press("Escape");
});

test("Account 360 gathers contacts, pipeline, proposals, authorized work and projects", async ({}, info) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await intercept(deep);
  await page.route("**/rest/v1/parties?*", (route) =>
    route.fulfill({
      json: [
        {
          id: "party-a",
          legal_name: "Conta de teste A",
          document_number: "Documento de teste",
          active: true,
        },
      ],
    }),
  );
  await openArea("contas", "Base de relacionamento");
  await page.getByRole("button", { name: "Conta de teste A", exact: true }).first().click();

  await expect(
    page.getByRole("heading", { level: 2, name: "Conta de teste A", exact: true }),
  ).toBeVisible();
  // A etiqueta da gaveta, não a frase da nota de governança atrás dela.
  await expect(page.getByText("Cadastro único", { exact: true })).toBeVisible();
  for (const section of [
    "Contatos",
    "Oportunidades",
    "Propostas",
    "Trabalho autorizado",
    "Projetos",
  ]) {
    await expect(
      page.getByRole("heading", { level: 4, name: new RegExp(section) }),
    ).toBeVisible();
  }
  await expect(page.getByText("Projeto de teste")).toBeVisible();
  await expect(page.getByText("TA-TESTE-0001")).toBeVisible();
  await expect(page.getByText("Conversão", { exact: true })).toBeVisible();

  await page.screenshot({
    path: info.outputPath("account-workspace-1440.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 1100 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: info.outputPath("account-workspace-390.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.keyboard.press("Escape");
  await page.unroute("**/rest/v1/parties?*");
});

test("Pipeline and list show the same facts, and the signal filters narrow both", async () => {
  await intercept(deep);
  await openArea("oportunidades", "Pipeline");

  // Kanban: idade na etapa e próxima ação no próprio cartão.
  const card = page.locator(".crm-opportunity").first();
  await expect(card).toContainText("40 d na etapa");
  await expect(card).toContainText("Próxima: Compromisso atrasado de teste");

  // Lista: os mesmos fatos, em colunas.
  await page.getByRole("button", { name: "Lista", exact: true }).click();
  const table = page.getByRole("table", { name: "Lista de oportunidades" });
  await expect(table).toContainText("Idade / limiar");
  await expect(table).toContainText("40 d");
  await expect(table).toContainText("Responsável de teste");
  await expect(table).toContainText("Compromisso atrasado de teste");
  await expect(table).toContainText("Sem próxima ação");

  // O recorte por sinal é uma regra, e vale nas duas visões.
  const cuts = page.getByRole("group", { name: "Recorte por sinal" });
  await cuts.getByRole("button", { name: /Sem próxima ação/ }).click();
  await expect(table).toContainText("Cenário de teste · negociação");
  await expect(table).not.toContainText("Cenário de teste · qualificação");

  await cuts.getByRole("button", { name: /Paradas/ }).click();
  await expect(table).toContainText("Cenário de teste · qualificação");
  await expect(table).not.toContainText("Cenário de teste · negociação");

  await page.getByRole("button", { name: "Pipeline", exact: true }).click();
  await expect(page.locator(".crm-opportunity")).toHaveCount(1);
  await cuts.getByRole("button", { name: /^Todas/ }).click();
});

test("Forecast movement is read from stage history, not from a daily snapshot", async ({}, info) => {
  await intercept(deep);
  await openArea("forecast", "Horizonte de decisão");

  // Métricas sem destino de clique são `div`, não `button`: o recorte do
  // movimento já é a janela escolhida ao lado, e um clique aqui não teria
  // para onde levar.
  await expect(
    page.locator(".crm-metric", { hasText: "Entraram no forecast" }),
  ).toContainText("1");
  await expect(
    page.locator(".crm-metric", { hasText: "Saíram do forecast" }),
  ).toContainText("1 ganha(s)");

  const entered = page.getByRole("heading", { name: /^Entraram · \d+/ });
  const left = page.getByRole("heading", { name: /^Saíram · \d+/ });
  await expect(entered).toBeVisible();
  await expect(left).toBeVisible();
  await expect(page.getByText("Cenário de teste · ganha").first()).toBeVisible();

  // Os filtros executivos movem o gráfico, e não só a tabela de baixo.
  await page.getByLabel("Responsável", { exact: true }).selectOption("user-1");
  await expect(
    page.getByRole("table", { name: "Composição do forecast" }),
  ).toContainText("Responsável de teste");
  await page.getByLabel("Cliente", { exact: true }).selectOption("Conta de teste B");
  await expect(page.getByText("Nenhuma decisão neste recorte")).toBeVisible();
  await page.getByLabel("Cliente", { exact: true }).selectOption("all");
  await page.getByLabel("Responsável", { exact: true }).selectOption("all");

  // A janela do movimento é uma consulta, não um job noturno.
  await page.getByLabel("Janela do movimento").selectOption("7");
  await expect(entered).toBeVisible();

  await page.screenshot({
    path: info.outputPath("forecast-movement-1440.png"),
    fullPage: true,
  });
});

test("Overview counts the same deterministic signals the areas show", async () => {
  await intercept(deep);
  await openArea("", "O que precisa de decisão");
  const queue = page.getByRole("heading", { name: "O que precisa de decisão" });
  await expect(queue).toBeVisible();
  for (const entry of [
    "Combinar o próximo passo",
    "Retomar contato",
    "Destravar ou encerrar",
    "Definir previsão de decisão",
    "Revisar passagem para execução",
  ]) {
    // O rótulo e a nota dividem o mesmo `div`, então a asserção é sobre o item
    // da fila e não sobre um nó de texto isolado.
    await expect(page.locator(".crm-queue-item", { hasText: entry })).toBeVisible();
  }
  // Um bloqueante no recorte — o mesmo que a área de Oportunidades acusa.
  await expect(
    page.getByRole("button", { name: /Bloqueantes/ }),
  ).toContainText("1");
});
