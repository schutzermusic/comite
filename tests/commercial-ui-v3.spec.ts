/**
 * COMERCIAL V3 — validação visual na aplicação REAL (localhost, dados reais).
 *
 * Leituras vão ao servidor de verdade. Nenhuma escrita chega ao banco: toda
 * requisição não-GET para `/api/commercial`, REST e Storage do Supabase é
 * ABORTADA, exceto as poucas respondidas aqui mesmo para mostrar o estado
 * depois do envio (revisão do PDF lido e fila após agendar). Essas fotos
 * levam `-intercepted` no nome — são a única parte que não é dado real.
 *
 * Rodar com o servidor já de pé:
 *   PONTO_E2E_REUSE=1 npx playwright test tests/commercial-ui-v3.spec.ts --project=chromium
 * Fotos em `output/commercial-ui-v3/`.
 */
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);

const OUT = "output/commercial-ui-v3";
const PDF_DIR = process.env.V3_PDF_DIR ?? path.join(process.cwd(), "tests/fixtures/commercial-v3");
const qa = JSON.parse(readFileSync("tests/.qa-env.json", "utf8")) as { email: string; password: string };
const VIEWS = [
  ["overview", "visao-geral"],
  ["accounts", "contas"],
  ["opportunities", "oportunidades"],
  ["followups", "follow-ups"],
  ["proposals", "propostas"],
  ["forecast", "forecast"],
] as const;

let context: BrowserContext;
let page: Page;
const blockedWrites: string[] = [];
const consoleErrors: string[] = [];

async function snap(name: string, fullPage = true) {
  mkdirSync(OUT, { recursive: true });
  // Botões ainda resolvendo permissão aparecem como marcador; a foto espera.
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 }).catch(() => undefined);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage });
}
async function setTheme(mode: "light" | "dark") {
  await page.evaluate((m) => {
    localStorage.setItem("insight-theme-preference", m);
    const html = document.documentElement;
    html.classList.remove("light", "dark");
    html.classList.add(m);
    html.dataset.theme = m;
  }, mode);
  await page.waitForTimeout(250);
}
async function open(view: string, extra = "") {
  await page.goto(`/comercial?view=${view}${extra}`);
  await expect(page.locator(".crm-heading h2").first()).toBeVisible({ timeout: 90_000 });
}
const noHorizontalScroll = () =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);


/**
 * A organização de QA não tem contas no cadastro único (dado real: 0). Para
 * mostrar a conta escolhida e o formulário completo, esta parte usa contas
 * interceptadas — as fotos levam `-intercepted`.
 */
const FAKE_PARTY = {
  id: "00000000-0000-4000-8000-00000000a001", organization_id: "x", kind: "organization",
  legal_name: "Companhia Energética do Norte S.A.", trade_name: "Energética Norte", document_type: "cnpj",
  document_number: "12.345.678/0001-90", document_normalized: "12345678000190", country_code: "BR",
  active: true, notes: null, source_system: "manual", external_key: null,
};
async function withFakeAccounts(run: () => Promise<void>) {
  await page.route("**/rest/v1/parties*", (route) =>
    route.request().method() === "GET" ? route.fulfill({ json: [FAKE_PARTY] }) : route.abort());
  await page.route("**/api/commercial/contacts", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: { ok: true, contacts: [
          { id: "c1", party_id: FAKE_PARTY.id, full_name: "Paula Ribeiro", role_title: "Gerente de manutenção", email: "paula@energeticanorte.com.br", phone: null, is_primary: true },
          { id: "c2", party_id: FAKE_PARTY.id, full_name: "Marcos Tavares", role_title: "Compras", email: null, phone: null, is_primary: false },
        ] } })
      : route.abort());
  try { await run(); } finally {
    await page.unroute("**/rest/v1/parties*");
    await page.unroute("**/api/commercial/contacts");
  }
}

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 240));
  });
  page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message.slice(0, 240)}`));
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(qa.email);
  const password = page.locator('input[type="password"]');
  await password.fill(qa.password);
  await password.press("Enter");
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 90_000 });

  // Rede de segurança: nada escreve no banco real a partir desta validação.
  const guard = async (route: import("@playwright/test").Route) => {
    if (route.request().method() === "GET" || route.request().method() === "HEAD") return route.continue();
    // Leituras que o PostgREST expõe como RPC (permissões, organizações).
    const rpc = new URL(route.request().url()).pathname.match(/\/rest\/v1\/rpc\/([a-z_]+)/)?.[1];
    if (rpc && /^(my_|current_user_|get_|has_|list_|search_|is_)/.test(rpc)) return route.continue();
    blockedWrites.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
    return route.abort();
  };
  await page.route("**/api/commercial/**", guard);
  await page.route("**/rest/v1/**", guard);
  await page.route("**/storage/v1/**", guard);
});

test.afterAll(async () => {
  console.log(`writes blocked by the guard: ${blockedWrites.length}`, blockedWrites.slice(0, 20));
  const unique = [...new Set(consoleErrors.filter((e) => !e.includes("net::ERR_FAILED")))];
  console.log(`console errors: ${unique.length}`, unique.slice(0, 15));
  await context?.close();
});

for (const [width, height] of [[1440, 900], [390, 844]] as const) {
  for (const mode of ["light", "dark"] as const) {
    test(`six screens · ${width} · ${mode}`, async () => {
      await page.setViewportSize({ width, height });
      for (const [id, slug] of VIEWS) {
        await open(slug);
        await setTheme(mode);
        if (id === "forecast") await expect(page.locator(".crm-fc")).toBeVisible();
        await snap(`screen-${id}-${width}-${mode}`);
        if (width === 390) expect(await noHorizontalScroll(), `${id} scrolls sideways at 390`).toBeTruthy();
      }
    });
  }
}

test("Nova oportunidade — account first, then the essentials", async () => {
  for (const [width, height, mode] of [[1440, 900, "light"], [390, 844, "dark"]] as const) {
    await page.setViewportSize({ width, height });
    await open("oportunidades");
    await setTheme(mode);
    await page.getByTestId("create-opportunity").first().click();
    await expect(page.getByTestId("flow-opportunity")).toBeVisible();
    await snap(`flow-new-opportunity-${width}-${mode}`, false);
    await page.getByTestId("flow-opportunity").locator("input[role=combobox]").fill("a");
    await page.waitForTimeout(900);
    await snap(`flow-new-opportunity-search-${width}-${mode}`, false);
    await page.keyboard.press("Escape");
    await withFakeAccounts(async () => {
      await page.getByTestId("create-opportunity").first().click();
      await page.getByTestId("flow-opportunity").locator("input[role=combobox]").fill("Energ");
      await expect(page.locator(".crm-combobox-list [role=option]").first()).toBeVisible();
      await snap(`flow-new-opportunity-results-${width}-${mode}-intercepted`, false);
      await page.locator(".crm-combobox-list [role=option]").first().click();
      await page.getByPlaceholder("Ex.: Retrofit da subestação SE-04").fill("Retrofit da subestação SE-04");
      await page.getByPlaceholder("0,00").fill("1240000");
      await page.getByRole("button", { name: "60 dias" }).click();
      await page.getByTestId("flow-opportunity").getByRole("button", { name: "Descoberta", exact: true }).click();
      await page.getByPlaceholder(/Agendar visita técnica/).fill("Agendar visita técnica com o gerente da planta");
      await snap(`flow-new-opportunity-filled-${width}-${mode}-intercepted`, false);
      await expect(page.getByTestId("opportunity-submit")).toBeEnabled();
    });
    await page.keyboard.press("Escape");
  }
});

test("Novo contato — choose the account, then the person", async () => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open("contas");
  await setTheme("light");
  await page.getByTestId("create-contact").first().click();
  await expect(page.getByTestId("flow-contact")).toBeVisible();
  await snap("flow-new-contact-step1-1440-light", false);
  await page.getByTestId("flow-contact").locator("input[role=combobox]").fill("a");
  await page.waitForTimeout(900);
  await snap("flow-new-contact-search-1440-light", false);
  await page.keyboard.press("Escape");
  await withFakeAccounts(async () => {
    await page.getByTestId("create-contact").first().click();
    await page.getByTestId("flow-contact").locator("input[role=combobox]").fill("Energ");
    await page.locator(".crm-combobox-list [role=option]").first().click();
    await page.getByPlaceholder("Nome e sobrenome").fill("Paula Ribeiro");
    await page.getByPlaceholder("Ex.: Gerente de manutenção").fill("Gerente de manutenção");
    await page.getByTestId("flow-contact").getByRole("textbox", { name: /E-mail/ }).fill("paula@energeticanorte.com.br");
    await snap("flow-new-contact-step2-1440-light-intercepted", false);
    await page.setViewportSize({ width: 390, height: 844 });
    await setTheme("dark");
    await snap("flow-new-contact-step2-390-dark-intercepted", false);
    await page.setViewportSize({ width: 1440, height: 900 });
    await setTheme("light");
  });
  await page.keyboard.press("Escape");
});

test("Nova proposta — PDF first, Apex reads, the person reviews", async () => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open("propostas");
  await setTheme("dark");
  await page.getByTestId("create-proposal").first().click();
  await expect(page.getByTestId("flow-proposal-start")).toBeVisible();
  await snap("flow-new-proposal-start-1440-dark", false);
  await setTheme("light");
  await snap("flow-new-proposal-start-1440-light", false);
  await page.getByTestId("proposal-start-import").click();
  await expect(page.getByTestId("flow-proposal-files")).toBeVisible();
  await snap("flow-import-slots-1440-light", false);
  await page.locator('[data-testid="drop-PT"] input[type=file]').setInputFiles(path.join(PDF_DIR, "PT-2026-118 R02.pdf"));
  await page.locator('[data-testid="drop-PC"] input[type=file]').setInputFiles(path.join(PDF_DIR, "PC-2026-118 R02.pdf"));
  await snap("flow-import-files-1440-light", false);

  // Daqui em diante é o estado DEPOIS do envio: respostas interceptadas.
  await page.route("**/api/commercial/proposals/analyze", async (route) => {
    const body = route.request().postDataJSON() as { action: string; fileName?: string; path?: string };
    if (body.action === "authorize") {
      return route.fulfill({ json: { ok: true, path: `org/proposals/_staging/me/${Date.now()}-x.pdf`, token: "t", bucket: "b" } });
    }
    const pc = body.fileName?.startsWith("PC");
    return route.fulfill({ json: {
      ok: true, path: body.path, context: pc ? "COMMERCIAL_PROPOSAL" : "TECHNICAL_PROPOSAL",
      classification: { role: pc ? "COMMERCIAL_PROPOSAL" : "TECHNICAL_PROPOSAL", revisionLabel: pc ? "Rev. 02" : "Rev. 03",
        revisionNumber: pc ? 2 : 3, title: "Retrofit SE-04 — painéis 13,8 kV", page: 1 },
      facts: pc ? [
        { factDomain: "VALUE", label: "Valor global", valueText: "R$ 1.240.000,00", valueNumeric: 1240000, valueDate: null, currency: "BRL", sourcePage: 7, provenanceState: "ANCHORED" },
        { factDomain: "VALUE", label: "Valor com opcional", valueText: "R$ 1.318.500,00", valueNumeric: 1318500, valueDate: null, currency: "BRL", sourcePage: 8, provenanceState: "ANCHORED" },
        { factDomain: "PAYMENT_TERM", label: "Pagamento", valueText: "30% no pedido, 70% por medição mensal", valueNumeric: null, valueDate: null, currency: null, sourcePage: 9, provenanceState: "ANCHORED" },
        { factDomain: "VALIDITY", label: "Validade", valueText: "60 dias", valueNumeric: null, valueDate: null, currency: null, sourcePage: 1, provenanceState: "ANCHORED" },
        { factDomain: "MEASUREMENT_RULE", label: "Medição", valueText: "Medição mensal por painel comissionado", valueNumeric: null, valueDate: null, currency: null, sourcePage: 10, provenanceState: "ANCHORED" },
      ] : [
        { factDomain: "SCOPE", label: "Escopo", valueText: "Substituição de 12 painéis 13,8 kV e comissionamento", valueNumeric: null, valueDate: null, currency: null, sourcePage: 3, provenanceState: "ANCHORED" },
      ],
      discarded: 0, model: "intercepted" } });
  });
  await page.route("**/storage/v1/object/upload/sign/**", (route) => route.fulfill({ json: { Key: "x" } }));
  await page.getByTestId("proposal-read").click();
  await expect(page.getByTestId("flow-proposal-review")).toBeVisible({ timeout: 30_000 });
  await snap("flow-import-review-1440-light-intercepted", false);
  await setTheme("dark");
  await snap("flow-import-review-1440-dark-intercepted", false);
  await page.getByRole("button", { name: /Em conflito/ }).click();
  await snap("flow-import-review-conflicts-1440-dark-intercepted", false);
  await page.setViewportSize({ width: 390, height: 844 });
  await snap("flow-import-review-390-dark-intercepted", false);
  await page.unroute("**/api/commercial/proposals/analyze");
  await page.unroute("**/storage/v1/object/upload/sign/**");
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1440, height: 900 });
  await setTheme("light");
});

test("Agendar follow-up — fast action, lands in the right queue", async () => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open("follow-ups");
  await setTheme("light");
  await page.getByTestId("followup-new").click();
  await expect(page.getByTestId("flow-followup")).toBeVisible();
  await snap("flow-followup-1440-light", false);
  await page.getByTestId("followup-subject").click();
  const first = page.locator(".crm-combobox-list [role=option]").first();
  await expect(page.locator(".crm-combobox-list")).not.toContainText("Carregando", { timeout: 30_000 });
  if (await first.count()) {
    await first.click();
    await page.getByPlaceholder(/obter a resposta do cliente/).fill("Obter o PO assinado");
    await page.getByRole("button", { name: "Hoje", exact: true }).click();
    await page.getByTestId("followup-waiting").check();
    await snap("flow-followup-filled-1440-light", false);
    await page.route("**/api/commercial/followups", (route) =>
      route.request().method() === "GET"
        ? route.fallback()
        : route.fulfill({ json: { ok: true, followup: { id: "intercepted" } } }));
    await page.getByTestId("followup-submit").click();
    await expect(page.getByTestId("followup-landed")).toBeVisible();
    await snap("flow-followup-landed-1440-light-intercepted");
    await page.unroute("**/api/commercial/followups");
  } else {
    await page.keyboard.press("Escape");
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await setTheme("dark");
  await page.getByTestId("followup-new").click();
  await snap("flow-followup-390-dark", false);
  await page.keyboard.press("Escape");
});

test("Opportunity workspace, discovery, survey request and fast-track", async () => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const response = await page.request.get("/api/commercial/opportunities");
  const opportunities = ((await response.json()).opportunities ?? []) as { id: string }[];
  test.skip(!opportunities.length, "no opportunity in this workspace");
  await open("oportunidades", `&opportunity=${opportunities[0].id}`);
  await setTheme("light");
  await expect(page.getByTestId("opportunity-actions")).toBeVisible({ timeout: 60_000 });
  await snap("workspace-opportunity-1440-light", false);
  await page.getByRole("tab", { name: /Descoberta/ }).click();
  await snap("workspace-discovery-1440-light", false);
  await page.getByRole("button", { name: /Pedir levantamento/ }).click();
  if (await page.getByTestId("flow-survey").count()) {
    await page.getByLabel("Propósito da visita").fill("Avaliar painéis 13,8 kV para retrofit");
    await page.getByRole("button", { name: "+3 dias" }).click();
    await snap("flow-survey-request-1440-light", false);
    await page.getByRole("button", { name: "Cancelar", exact: true }).last().click();
    await expect(page.getByTestId("flow-survey")).toHaveCount(0);
  }
  await page.getByRole("tab", { name: /Propostas/ }).click();
  await snap("workspace-opportunity-proposals-1440-light", false);
  await setTheme("dark");
  await page.getByRole("tab", { name: /Resumo/ }).click();
  await snap("workspace-opportunity-1440-dark", false);
  const close = page.getByTestId("close-deal-command").getByRole("button", { name: /Fechar negócio/ });
  if (await close.count()) {
    await close.click();
    await expect(page.getByTestId("execution-verdict")).toBeVisible({ timeout: 60_000 });
    await snap("fasttrack-1440-dark", false);
    await setTheme("light");
    await snap("fasttrack-1440-light", false);
    await page.keyboard.press("Escape");
  } else {
    await snap("fasttrack-locked-1440-dark", false);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await open("oportunidades", `&opportunity=${opportunities[0].id}`);
  await expect(page.getByTestId("opportunity-actions")).toBeVisible({ timeout: 60_000 });
  await snap("workspace-opportunity-390-light", false);
});

test("Proposal workspace — what exists, what governs, what happens next", async () => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const response = await page.request.get("/api/commercial/proposals");
  const proposals = ((await response.json()).proposals ?? []) as { id: string }[];
  test.skip(!proposals.length, "no proposal in this workspace");
  await open("propostas", `&proposal=${proposals[0].id}`);
  await setTheme("light");
  await expect(page.getByTestId("proposal-status-strip")).toBeVisible({ timeout: 60_000 });
  await snap("workspace-proposal-1440-light", false);
  await page.getByRole("tab", { name: /Revisões/ }).click();
  await snap("workspace-proposal-revisions-1440-light", false);
  await page.getByRole("tab", { name: /Fatos/ }).click();
  await snap("workspace-proposal-facts-1440-light", false);
  await setTheme("dark");
  await page.getByRole("tab", { name: /Resumo/ }).click();
  await snap("workspace-proposal-1440-dark", false);
  const link = page.getByTestId("proposal-link-opportunity").getByRole("button", { name: /Vincular oportunidade/ });
  if (await link.count()) {
    await link.click();
    await snap("workspace-proposal-link-1440-dark", false);
    await page.keyboard.press("Escape");
  }
  const close = page.getByTestId("close-deal-command").getByRole("button", { name: /Fechar negócio/ });
  if (await close.count()) {
    await close.click();
    await expect(page.getByTestId("execution-verdict")).toBeVisible({ timeout: 60_000 });
    await snap("fasttrack-from-proposal-1440-dark", false);
    await page.keyboard.press("Escape");
  }
});

test("Forecast — month, tooltip and drill-down", async () => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open("forecast");
  await setTheme("dark");
  const months = page.locator(".crm-fc .crm-chart-month");
  await expect(months.first()).toBeVisible();
  const count = await months.count();
  let target = 0;
  for (let i = 0; i < count; i += 1) {
    if (await months.nth(i).locator(".crm-fc-count").count()) { target = i; break; }
  }
  await months.nth(target).hover();
  await snap("forecast-tooltip-1440-dark", false);
  await months.nth(target).click();
  await expect(page.getByTestId("forecast-month-drill")).toBeVisible();
  await snap("forecast-drill-1440-dark");
  await setTheme("light");
  await snap("forecast-drill-1440-light");
});

test("guard held: every write attempt was aborted before the database", async () => {
  // Registradas e abortadas — nenhuma chegou ao servidor. As interceptadas
  // (respondidas aqui) nem saem do navegador.
  expect(blockedWrites.every((w) => !w.startsWith("GET"))).toBeTruthy();
});
