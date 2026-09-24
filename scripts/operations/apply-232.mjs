/**
 * 232 — Supply: cadastro de itens e contrato de cobertura.
 *   node scripts/operations/apply-232.mjs [--apply]
 */
import { runMigration } from './lib/proof-kit.mjs';
import { confirmedMaterial, proofItem, proofProject } from './lib/fixtures.mjs';

await runMigration({
  version: '232',
  expectedTip: '231',
  async proofs(ctx) {
    const { one, all, check, rejects, browserCannotExecute, tablesAreGoverned, anchors } = ctx;
    const { org, actor } = anchors;
    const stamp = Date.now().toString(36).toUpperCase();

    await browserCannotExecute(['supply_item_upsert(uuid,uuid,jsonb)', 'project_requirement_upsert(uuid,uuid,jsonb)']);
    await tablesAreGoverned(['supply_items']);
    const perms = await all(`SELECT key FROM public.permissions WHERE module IN ('supply','inventory','procurement','receiving','suppliers')`);
    check('14 permissões de Supply semeadas', perms.length === 14, String(perms.length));
    const grants = await one(`SELECT
        bool_and(EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.roles r ON r.id = rp.role_id
          WHERE r.key = 'owner_admin' AND r.organization_id IS NULL AND rp.permission_id = p.id)) owner_all,
        bool_or(EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.roles r ON r.id = rp.role_id
          WHERE r.key = 'gestor_projetos' AND rp.permission_id = p.id AND p.key = 'procurement.approve')) pm_approves
      FROM public.permissions p WHERE p.module IN ('supply','inventory','procurement','receiving','suppliers')`);
    check('owner_admin detém todo o Supply; gestor de projetos NÃO aprova compra', grants.owner_all && !grants.pm_approves);

    const item = await proofItem(ctx, anchors, `CAB-${stamp}`, 'm');
    const code = await one(`SELECT code FROM public.supply_items WHERE id = $1`, [item]);
    check('código do item normalizado (maiúsculas, sem espaços nas pontas)', code.code === `CAB-${stamp}`);
    await rejects('código repetido no mesmo inquilino é recusado', 'SELECT public.supply_item_upsert($1,$2,$3)',
      [org, actor, JSON.stringify({ code: `cab-${stamp}`, description: 'dup', unit: 'm' })], /sitem_code_unique/);

    const projectId = await proofProject(ctx, anchors, `P232-${stamp}`);
    const upsert = 'SELECT public.project_requirement_upsert($1,$2,$3) r';
    const noItem = (await one(upsert, [org, actor, JSON.stringify({ project_id: projectId, requirement_type: 'MATERIAL',
      title: 'Cabo sem item', quantity: 10, unit: 'm', required_by: '2026-11-01' })])).r;
    await rejects('material sem item de catálogo não é confirmado', 'SELECT public.project_requirement_transition($1,$2,$3,$4,$5,$6)',
      [org, actor, noItem.requirement_id, 'CONFIRMED', null, null], /catalogued item/);
    await rejects('unidade diferente da do item é recusada', upsert, [org, actor, JSON.stringify({ project_id: projectId,
      requirement_type: 'MATERIAL', title: 'x', quantity: 1, unit: 'rolo', item_id: item })], /must be the item unit/);
    const withItem = (await one(upsert, [org, actor, JSON.stringify({ project_id: projectId, requirement_type: 'MATERIAL',
      title: 'Cabo com item', quantity: 5, item_id: item })])).r;
    const unit = await one(`SELECT unit FROM public.project_requirements WHERE id = $1`, [withItem.requirement_id]);
    check('sem unidade informada, o requisito fala a unidade do item', unit.unit === 'm');
    await rejects('item em uso não muda de unidade', 'SELECT public.supply_item_upsert($1,$2,$3)',
      [org, actor, JSON.stringify({ id: item, unit: 'km' })], /in use/);

    const req = await confirmedMaterial(ctx, anchors, projectId, item, 1000);
    const cov = await one(`SELECT required_qty, covered_qty, inbound_qty, shortage_qty FROM public.supply_requirement_coverage WHERE requirement_id = $1`, [req]);
    check('cobertura derivada: sem alocação, falta = requerido', Number(cov.required_qty) === 1000
      && Number(cov.covered_qty) === 0 && Number(cov.shortage_qty) === 1000);
    const planned = await one(`SELECT count(*)::int n FROM public.supply_requirement_coverage WHERE requirement_id = $1`, [noItem.requirement_id]);
    check('requisito só PLANEJADO não é demanda de Supply', planned.n === 0);

    await one('SELECT public.supply_item_upsert($1,$2,$3)', [org, actor, JSON.stringify({ id: item, active: false })]);
    await rejects('item inativo não recebe demanda nova', upsert, [org, actor, JSON.stringify({ project_id: projectId,
      requirement_type: 'MATERIAL', title: 'y', quantity: 1, item_id: item })], /inactive/);

    const otherOrg = await one(`SELECT id FROM public.organizations WHERE id <> $1 LIMIT 1`, [org]);
    await rejects('item de outro inquilino não entra no requisito', upsert, [otherOrg.id, actor, JSON.stringify({
      project_id: projectId, requirement_type: 'MATERIAL', title: 'z', quantity: 1, item_id: item })], /Item not found in tenant/);
  },
});
