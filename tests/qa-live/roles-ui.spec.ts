/**
 * PAPÉIS NA TELA, COM SESSÃO REAL (QA isolado).
 *
 * A tela oferece cada ato EXATAMENTE quando o RBAC do banco concede a chave —
 * nem esconde o que o papel pode, nem oferece o que ele não pode. A
 * expectativa não é digitada à mão: sai de `role_permissions` para o papel de
 * cada usuário, como nas provas de API. Esconder o botão não é a autorização:
 * a recusa no servidor (403) e na RLS está provada em `roles-api.spec.ts`;
 * aqui se prova que a tela diz a mesma coisa que o servidor.
 *
 * Quem não lê a área vê a recusa com o nome da chave — e nenhum dado.
 */
import { expect, test, type Page } from '@playwright/test';
import type pg from 'pg';
import { authFile, one, qaDb, qaLive, type QaRole } from './support';

const ROLES: QaRole[] = ['owner', 'gestor', 'engenharia', 'compras', 'almoxarifado', 'financeiro', 'juridico', 'rh'];

interface Screen {
  label: string; path: string; read: string[]; rows: string;
  actions: Array<{ name: RegExp; anyOf: string[] }>;
}
const SCREENS: Screen[] = [
  { label: 'Ordens de Serviço', path: '/operacoes/ordens-servico', read: ['operations.view'], rows: '[data-testid="os-row"]',
    actions: [{ name: /Gerar a partir de proposta/, anyOf: ['commercial.service_orders.manage'] },
      { name: /^Importar OS/, anyOf: ['commercial.service_orders.manage'] }] },
  { label: 'Compras', path: '/supply/compras?stage=solicitacoes', read: ['procurement.view', 'supply.view'], rows: '[data-testid="requisition-row"]',
    actions: [{ name: /Requisição manual/, anyOf: ['procurement.request'] }, { name: /Abrir cotação/, anyOf: ['procurement.source'] }] },
  { label: 'Recebimentos', path: '/supply/recebimentos', read: ['receiving.view', 'supply.view', 'procurement.view'], rows: '[data-testid="inbound-row"]',
    actions: [{ name: /Receber material/, anyOf: ['receiving.receive'] }] },
  { label: 'Estoque · locais', path: '/supply/estoque?view=locais', read: ['inventory.view', 'supply.view'], rows: '.ax-loc',
    actions: [{ name: /Novo local/, anyOf: ['inventory.manage'] }] },
  { label: 'Estoque · transferências', path: '/supply/estoque?view=transferencias', read: ['inventory.view', 'supply.view'], rows: '[data-testid="transfer-row"]',
    actions: [{ name: /Nova transferência/, anyOf: ['inventory.manage', 'inventory.reserve'] }] },
  { label: 'Fornecedores', path: '/supply/fornecedores', read: ['suppliers.view', 'procurement.view'], rows: '[data-testid="supplier-row"]',
    actions: [{ name: /Cadastrar fornecedor/, anyOf: ['suppliers.manage'] }] },
];

let db: pg.Client;
const grants: Record<string, Set<string>> = {};

test.beforeAll(async () => {
  db = await qaDb();
  const live = qaLive();
  for (const role of ROLES) {
    const { rows } = await db.query(`SELECT p.key FROM public.user_roles ur JOIN public.role_permissions rp ON rp.role_id = ur.role_id
      JOIN public.permissions p ON p.id = rp.permission_id WHERE ur.user_id = $1 AND ur.organization_id = $2`,
    [live.users[role].id, live.organization.id]);
    grants[role] = new Set(rows.map((r) => r.key as string));
  }
});
test.afterAll(async () => { await db?.end(); });

const allowed = (role: QaRole, anyOf: string[]) => anyOf.some((k) => grants[role].has(k));

/** A tela assentou: ou o título da área (dado chegou), ou a recusa com a chave exigida. */
async function settled(page: Page) {
  await expect(page.locator('h1.ax-title').or(page.getByText(/Esta ação exige/))).toBeVisible({ timeout: 90_000 });
}

for (const role of ROLES) {
  test.describe(`papel ${role}`, () => {
    test.use({ storageState: authFile(role), viewport: { width: 1440, height: 900 } });

    test(`${role}: cada tela oferece exatamente os atos que o banco concede`, async ({ page }) => {
      const mismatches: string[] = [];
      for (const screen of SCREENS) {
        await page.goto(screen.path);
        await settled(page);
        const canRead = allowed(role, screen.read);
        const denied = await page.getByText(/Esta ação exige/).count() > 0;
        if (canRead === denied) {
          mismatches.push(`${screen.label}: leitura ${canRead ? 'concedida, mas a tela recusou' : 'negada, mas a tela abriu'}`);
          continue;
        }
        if (!canRead) {
          // Recusa com nome: e nenhum dado da área chegou à tela.
          if (await page.locator(screen.rows).count() > 0) mismatches.push(`${screen.label}: recusou, mas mostrou linhas`);
          continue;
        }
        for (const a of screen.actions) {
          const offered = await page.getByRole('button', { name: a.name }).count() > 0;
          const should = allowed(role, a.anyOf);
          if (offered !== should) mismatches.push(`${screen.label} · ${a.name}: ${should ? 'concedido e não oferecido' : 'oferecido sem a chave'}`);
        }
      }
      expect(mismatches, mismatches.join('\n')).toEqual([]);
    });
  });
}

test.describe('outro inquilino', () => {
  test.use({ storageState: authFile('outsider'), viewport: { width: 1440, height: 900 } });

  test('titular de OUTRA organização não vê nem abre a OS desta', async ({ page }) => {
    const live = qaLive();
    const os = await one<{ id: string; os_number: string }>(db, `SELECT id, os_number FROM public.internal_service_orders
      WHERE organization_id = $1 ORDER BY created_at LIMIT 1`, [live.organization.id]);
    await page.goto('/operacoes/ordens-servico');
    await settled(page);
    await expect(page.getByText(os.os_number)).toHaveCount(0);
    await page.goto(`/operacoes/ordens-servico/${os.id}`);
    await expect(page.getByText(/não encontrad|Esta ação exige|Não foi possível/i).first()).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId('os-workspace').getByText(os.os_number)).toHaveCount(0);
  });
});
