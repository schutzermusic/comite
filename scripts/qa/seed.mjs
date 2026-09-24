/**
 * Semeia o inquilino de QA ISOLADO: identidade real, um usuário por papel,
 * e o mínimo de configuração que o caminho dourado pressupõe.
 *
 *   node scripts/qa/seed.mjs
 *
 * Idempotente: rodar de novo reusa conta, organização, usuários e cadastros;
 * só a senha é trocada (e gravada em `tests/.qa-live.json`, fora do git).
 *
 * ─── O que é semeado, e por quê só isto ──────────────────────────────────
 *
 * • Conta empresarial: o ÚNICO passo fora de fluxo governado — é o
 *   bootstrap de plataforma (a primeira conta não tem quem a provisione).
 * • Organização: pelo fluxo REAL `organization_provision`, como o titular.
 * • Um usuário de verdade por papel (GoTrue local), com vínculo, perfil,
 *   organização ativa e papel — a mesma forma que o convite produz.
 * • Configuração de Supply que o caminho dourado PRESSUPÕE e não prova:
 *   locais, fornecedores homologados e a alçada declarada do Financeiro —
 *   tudo pelas funções governadas, com o titular como ator nomeado.
 *
 * Nenhum fato do caminho dourado (OS, projeto, requisito, reserva, pedido,
 * recebimento) nasce aqui: esses são escritos pelo NAVEGADOR, na prova.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { withQaDb, kit, asUser, authAdmin } from './lib/qa-db.mjs';
import { QA_LIVE_FILE } from './lib/qa-env.mjs';

export const QA_PEOPLE = [
  { key: 'owner', email: 'qa.owner@apex-qa.test', name: 'QA Titular (Admin)', role: 'owner_admin' },
  { key: 'gestor', email: 'qa.gestor@apex-qa.test', name: 'QA Gestor de Operações', role: 'gestor_projetos' },
  { key: 'engenharia', email: 'qa.engenharia@apex-qa.test', name: 'QA Engenharia / PCP', role: 'engenharia_pcp' },
  { key: 'compras', email: 'qa.compras@apex-qa.test', name: 'QA Compras', role: 'compras' },
  { key: 'almoxarifado', email: 'qa.almoxarifado@apex-qa.test', name: 'QA Almoxarifado', role: 'almoxarifado' },
  { key: 'financeiro', email: 'qa.financeiro@apex-qa.test', name: 'QA Financeiro', role: 'financeiro' },
  { key: 'juridico', email: 'qa.juridico@apex-qa.test', name: 'QA Jurídico', role: 'juridico_contratos' },
  { key: 'rh', email: 'qa.rh@apex-qa.test', name: 'QA RH', role: 'rh' },
  { key: 'outsider', email: 'qa.outsider@apex-qa.test', name: 'QA Outro Inquilino', role: 'owner_admin', tenant: 'outsider' },
];

const TENANTS = {
  primary: { account: 'apex-qa', accountName: 'Apex QA', org: '[QA] Apex Operações', legal: '[QA] Apex Operações Ltda', key: 'apex-qa-primary' },
  outsider: { account: 'apex-qa-outsider', accountName: 'Apex QA Outro Grupo', org: '[QA] Outro Inquilino', legal: '[QA] Outro Inquilino Ltda', key: 'apex-qa-outsider' },
};

const password = `Qa-${crypto.randomBytes(9).toString('base64url')}-9!`;

await withQaDb(async (c) => {
  const { one, all } = kit(c);
  const J = (x) => JSON.stringify(x);

  const roleIds = Object.fromEntries((await all(`SELECT key, id FROM public.roles WHERE organization_id IS NULL`)).map((r) => [r.key, r.id]));
  const missing = [...new Set(QA_PEOPLE.map((p) => p.role))].filter((r) => !roleIds[r]);
  if (missing.length) console.warn(`! papéis ausentes no QA: ${missing.join(', ')} — aplique a migration 237 no QA e rode de novo.`);

  console.log('▸ usuários (GoTrue local)');
  const auth = authAdmin();
  const users = {};
  for (const p of QA_PEOPLE) users[p.key] = { ...p, id: await auth.ensureUser(p.email, password, p.name) };
  console.log(`   ${Object.keys(users).length} usuários`);

  console.log('▸ contas empresariais e organizações (fluxo real de provisionamento)');
  const orgs = {};
  for (const [tenantKey, t] of Object.entries(TENANTS)) {
    const titular = tenantKey === 'primary' ? users.owner : users.outsider;
    const ea = (await one(`INSERT INTO public.enterprise_accounts (name, slug, created_by) VALUES ($1,$2,$3)
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [t.accountName, t.account, titular.id])).id;
    await one(`INSERT INTO public.enterprise_account_memberships (enterprise_account_id, user_id, role, granted_basis, created_by)
      VALUES ($1,$2,'OWNER','qa-bootstrap',$2) ON CONFLICT (enterprise_account_id, user_id) DO UPDATE SET status = 'ACTIVE' RETURNING id`, [ea, titular.id]);
    const [row] = await asUser(c, titular.id,
      `SELECT public.organization_provision($1,$2,'BR','BRL','America/Sao_Paulo',NULL,$3,$4) r`, [t.org, t.legal, t.key, ea]);
    orgs[tenantKey] = { id: row.r.organization_id, name: t.org, enterpriseAccountId: ea };
  }
  console.log(`   principal ${orgs.primary.id} · outro inquilino ${orgs.outsider.id}`);

  console.log('▸ vínculos, perfis, organização ativa e papéis');
  for (const u of Object.values(users)) {
    const org = orgs[u.tenant ?? 'primary'].id;
    await one(`INSERT INTO public.profiles (user_id, organization_id, full_name, status) VALUES ($1,$2,$3,'active')
      ON CONFLICT (user_id) DO UPDATE SET organization_id = EXCLUDED.organization_id, full_name = EXCLUDED.full_name, status = 'active'
      RETURNING id`, [u.id, org, u.name]);
    await one(`INSERT INTO public.organization_memberships (organization_id, user_id, status, source, joined_at, created_by)
      VALUES ($1,$2,'ACTIVE','INVITE',now(),$3) ON CONFLICT (organization_id, user_id) DO UPDATE
      SET status = 'ACTIVE', disabled_at = NULL, disabled_by = NULL RETURNING id`, [org, u.id, users.owner.id]);
    await one(`INSERT INTO public.user_active_organization (user_id, organization_id) VALUES ($1,$2)
      ON CONFLICT (user_id) DO UPDATE SET organization_id = EXCLUDED.organization_id RETURNING user_id`, [u.id, org]);
    // Um papel por pessoa: o que ela tinha de outra semeadura sai, para a matriz provar exatamente este papel.
    await c.query(`DELETE FROM public.user_roles WHERE user_id = $1 AND organization_id = $2 AND role_id <> $3`, [u.id, org, roleIds[u.role] ?? null]);
    if (roleIds[u.role]) {
      await c.query(`INSERT INTO public.user_roles (user_id, role_id, organization_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [u.id, roleIds[u.role], org]);
    }
    u.organizationId = org;
  }

  console.log('▸ configuração de Supply pressuposta (funções governadas, titular como ator)');
  const org = orgs.primary.id; const actor = users.owner.id;
  const act = async (fn, ...args) => (await one(`SELECT public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')}) r`, args)).r;
  const location = async (code, name, kind, extra = {}) => {
    const found = await one(`SELECT id FROM public.inventory_locations WHERE organization_id = $1 AND code = $2`, [org, code]);
    if (found) return found.id;
    return (await act('inventory_location_upsert', org, actor, J({ code, name, kind, ...extra }))).location_id;
  };
  const central = await location('QA-CENTRAL', 'Almoxarifado Central — Belém', 'WAREHOUSE',
    { address_label: 'Belém, PA', latitude: -1.4558, longitude: -48.4902 });
  const norte = await location('QA-NORTE', 'Almoxarifado Norte — Tucuruí', 'WAREHOUSE',
    { address_label: 'Tucuruí, PA', latitude: -3.7662, longitude: -49.6725 });
  const quarentena = await location('QA-QUARENTENA', 'Quarentena de inspeção — Central', 'QUARANTINE', { parent_id: central });

  const supplier = async (legal, doc, lead) => {
    const r = await act('supplier_register', org, actor, J({ legal_name: legal, document_type: 'cnpj', document_number: doc,
      categories: ['Cabos', 'Elétricos'], default_payment_terms: '28 dias', default_lead_time_days: lead,
      contact_name: 'Comercial', contact_email: `vendas+${doc.slice(0, 4)}@fornecedor-qa.test` }));
    const status = await one(`SELECT status FROM public.supplier_profiles WHERE id = $1`, [r.supplier_id]);
    if (status?.status !== 'HOMOLOGATED') await act('supplier_set_status', org, actor, r.supplier_id, 'HOMOLOGATED', null);
    return r.supplier_id;
  };
  const supplierA = await supplier('[QA] Cabos Amazônia Ltda', '11222333000181', 12);
  const supplierB = await supplier('[QA] Elétrica Rápida Norte S.A.', '44555666000172', 5);

  if (roleIds.financeiro) {
    const has = await one(`SELECT id FROM public.procurement_approval_authorities WHERE organization_id = $1
      AND grantee_role_id = $2 AND revoked_at IS NULL`, [org, roleIds.financeiro]);
    if (!has) {
      await act('procurement_authority_declare', org, actor, J({ grantee_kind: 'ROLE', grantee_role_id: roleIds.financeiro,
        max_amount: 500000, currency: 'BRL', source_kind: 'BOARD_RESOLUTION', source_reference: 'ATA-QA-001',
        justification: 'Alçada de compras do Financeiro até R$ 500 mil (QA isolado).' }));
    }
  }

  const live = {
    generatedAt: new Date().toISOString(),
    password,
    organization: orgs.primary,
    outsiderOrganization: orgs.outsider,
    users: Object.fromEntries(Object.values(users).map((u) => [u.key, { id: u.id, email: u.email, name: u.name, role: u.role, organizationId: u.organizationId }])),
    locations: { central, norte, quarentena },
    suppliers: { a: supplierA, b: supplierB },
  };
  fs.writeFileSync(QA_LIVE_FILE, `${JSON.stringify(live, null, 2)}\n`);
  console.log(`\n✓ QA semeado. Credenciais em ${QA_LIVE_FILE} (fora do git).`);
});
