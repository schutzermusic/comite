/**
 * 231 — Planejamento: requisitos de execução.
 *
 *   node scripts/operations/apply-231.mjs           # ensaio + provas, ROLLBACK
 *   node scripts/operations/apply-231.mjs --apply   # aplica e registra (provas desfeitas)
 */
import { runMigration } from './lib/proof-kit.mjs';
import { issuedOrderFromPackage, projectFromOrder } from './lib/fixtures.mjs';

await runMigration({
  version: '231',
  expectedTip: '230',
  async proofs(ctx) {
    const { one, all, check, rejects, browserCannotExecute, tablesAreGoverned, anchors } = ctx;
    const { org, actor } = anchors;
    const stamp = Date.now().toString(36);

    await browserCannotExecute([
      'project_requirement_upsert(uuid,uuid,jsonb)',
      'project_requirement_transition(uuid,uuid,uuid,text,text,uuid)',
      'project_requirement_mark_satisfied(uuid,uuid,uuid,text,uuid,boolean)',
      'project_requirements_import_from_service_order(uuid,uuid,text,uuid)',
    ]);
    await tablesAreGoverned(['project_requirements', 'project_requirement_history']);

    // ── OS emitida → projeto → requisitos importados ───────────────────────
    const tag = `P231-${stamp}`;
    const os = await issuedOrderFromPackage(ctx, anchors, tag);
    const projectId = await projectFromOrder(ctx, anchors, os.serviceOrderId, tag);

    const importSql = 'SELECT public.project_requirements_import_from_service_order($1,$2,$3,$4) r';
    const imp1 = (await one(importSql, [org, actor, projectId, os.serviceOrderId])).r;
    const imp2 = (await one(importSql, [org, actor, projectId, os.serviceOrderId])).r;
    const imported = await all(`SELECT * FROM public.project_requirements WHERE project_id = $1`, [projectId]);
    check('linhas de recurso/dependência da OS viram requisitos PLANEJADOS com proveniência',
      imp1.requirements_added >= 2 && imported.every((r) => r.source === 'SERVICE_ORDER' && r.service_order_item_id
        && r.status === 'PLANNED' && r.required_by === null), `${imp1.requirements_added} importado(s)`);
    check('importar de novo não duplica (idempotente pela linha da OS)', imp2.requirements_added === 0);
    const dep = imported.find((r) => r.requirement_type === 'CUSTOMER_DEPENDENCY');
    check('dependência do cliente da PT chega como requisito', Boolean(dep));

    // ── Material: confirmar exige data e quantidade ────────────────────────
    const upsert = 'SELECT public.project_requirement_upsert($1,$2,$3) r';
    const transition = 'SELECT public.project_requirement_transition($1,$2,$3,$4,$5,$6) r';
    const mat = (await one(upsert, [org, actor, JSON.stringify({ project_id: projectId, requirement_type: 'MATERIAL',
      title: 'Cabo 35 mm', quantity: 1000, unit: 'm' })])).r;
    await rejects('material sem data não é confirmado', transition, [org, actor, mat.requirement_id, 'CONFIRMED', null, null],
      /required-by date/);
    await one(upsert, [org, actor, JSON.stringify({ id: mat.requirement_id, required_by: '2026-11-18' })]);
    const conf = (await one(transition, [org, actor, mat.requirement_id, 'CONFIRMED', null, null])).r;
    const matRow = await one(`SELECT status, confirmed_by FROM public.project_requirements WHERE id = $1`, [mat.requirement_id]);
    check('material confirmado com data e quantidade, atribuído a quem confirmou',
      conf.status === 'CONFIRMED' && matRow.confirmed_by === actor);
    const ev = await one(`SELECT count(*)::int n FROM public.domain_events
      WHERE aggregate_id = $1 AND event_type = 'operations.requirement.confirmed'`, [mat.requirement_id]);
    check('fato de domínio: requisito confirmado (com project_id no payload)', ev.n === 1);
    const noQty = (await one(upsert, [org, actor, JSON.stringify({ project_id: projectId, requirement_type: 'EXTERNAL_SERVICE',
      title: 'Ensaio de óleo', required_by: '2026-11-20' })])).r;
    await rejects('serviço externo sem quantidade não é confirmado', transition,
      [org, actor, noQty.requirement_id, 'CONFIRMED', null, null], /needs a quantity/);

    // ── Atendido: só sem domínio de suprimento ─────────────────────────────
    const satisfy = 'SELECT public.project_requirement_mark_satisfied($1,$2,$3,$4,$5,$6) r';
    await rejects('material não é marcado atendido à mão (é cobertura do Supply)', satisfy,
      [org, actor, mat.requirement_id, 'chegou', null, false], /covered by Supply/);
    await one(upsert, [org, actor, JSON.stringify({ id: dep.id, required_by: '2026-10-30' })]);
    await one(transition, [org, actor, dep.id, 'CONFIRMED', null, null]);
    const sat = (await one(satisfy, [org, actor, dep.id, 'Cliente liberou o pátio por e-mail', null, false])).r;
    check('dependência do cliente atendida por ato nomeado', sat.satisfied === true);
    await rejects('atender sem nota é recusado', satisfy, [org, actor, dep.id, ' ', null, false], /note/);

    // ── Cancelar e substituir ─────────────────────────────────────────────
    await rejects('cancelar sem motivo é recusado', transition, [org, actor, noQty.requirement_id, 'CANCELLED', ' ', null], /reason/);
    await one(transition, [org, actor, noQty.requirement_id, 'CANCELLED', 'Ensaio incluído no escopo do cliente', null]);
    await rejects('requisito cancelado não se edita', upsert,
      [org, actor, JSON.stringify({ id: noQty.requirement_id, title: 'x' })], /history is not edited/);
    await rejects('substituir sem substituto vivo é recusado', transition,
      [org, actor, mat.requirement_id, 'SUPERSEDED', null, null], /live replacement/);
    const repl = (await one(upsert, [org, actor, JSON.stringify({ project_id: projectId, requirement_type: 'MATERIAL',
      title: 'Cabo 50 mm', quantity: 800, unit: 'm', required_by: '2026-11-18' })])).r;
    const sup = (await one(transition, [org, actor, mat.requirement_id, 'SUPERSEDED', 'Engenharia trocou a bitola', repl.requirement_id])).r;
    check('substituição aponta o requisito novo', sup.status === 'SUPERSEDED');
    await rejects('tipo de requisito confirmado não muda por edição', upsert,
      [org, actor, JSON.stringify({ id: dep.id, requirement_type: 'MATERIAL' })], /superseding/);

    // ── Proveniência de IA ────────────────────────────────────────────────
    await rejects('proposta da IA sem provedor/modelo é recusada', upsert,
      [org, actor, JSON.stringify({ project_id: projectId, requirement_type: 'MATERIAL', title: 'x', source: 'AI_PROPOSAL' })],
      /preq_source_provenance/);
    await rejects('requisito de OS não nasce por upsert (tem caminho próprio)', upsert,
      [org, actor, JSON.stringify({ project_id: projectId, requirement_type: 'MATERIAL', title: 'x', source: 'SERVICE_ORDER' })],
      /own governed path/);

    // ── Atividade do mesmo projeto e inquilino ────────────────────────────
    const act = await one(`INSERT INTO public.project_timeline_items (organization_id, project_id, title)
      VALUES ($1,$2,'Lançamento de cabos') RETURNING id`, [org, projectId]);
    const withAct = (await one(upsert, [org, actor, JSON.stringify({ project_id: projectId, activity_id: act.id,
      requirement_type: 'EQUIPMENT', title: 'Guindaste 30 t' })])).r;
    const actRow = await one(`SELECT source FROM public.project_requirements WHERE id = $1`, [withAct.requirement_id]);
    check('requisito criado na atividade herda a fonte ACTIVITY', actRow.source === 'ACTIVITY');
    const other = await one(`SELECT id FROM public.projects WHERE organization_id = $1 AND id <> $2 LIMIT 1`, [org, projectId]);
    if (other) {
      await rejects('atividade de OUTRO projeto é recusada pela FK composta', upsert,
        [org, actor, JSON.stringify({ project_id: other.id, activity_id: act.id, requirement_type: 'EQUIPMENT', title: 'x' })],
        /preq_activity_same_project/);
    }
    const otherOrg = await one(`SELECT id FROM public.organizations WHERE id <> $1 LIMIT 1`, [org]);
    await rejects('projeto de outro inquilino é recusado', upsert,
      [otherOrg.id, actor, JSON.stringify({ project_id: projectId, requirement_type: 'EQUIPMENT', title: 'x' })],
      /preq_project_tenant/);
    await one(`DELETE FROM public.project_timeline_items WHERE id = $1`, [act.id]);
    const detached = await one(`SELECT activity_id, project_id FROM public.project_requirements WHERE id = $1`, [withAct.requirement_id]);
    check('atividade apagada não apaga o requisito: ele volta a ser do projeto',
      detached.activity_id === null && detached.project_id === projectId);

    const hist = await one(`SELECT count(*)::int n FROM public.project_requirement_history WHERE requirement_id = $1`, [mat.requirement_id]);
    check('toda mudança do requisito fica na história', hist.n >= 4, `${hist.n} evento(s)`);
    await rejects('história do requisito não se reescreve',
      `UPDATE public.project_requirement_history SET reason = 'x' WHERE requirement_id = $1`, [mat.requirement_id], /append-only/);
  },
});
