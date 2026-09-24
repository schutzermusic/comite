/**
 * 236 — Inteligência de Supply: livro de recomendações da Apex, execução
 * governada e acompanhamento com origens de Supply.
 *   node scripts/operations/apply-236.mjs [--apply]
 */
import { runMigration } from './lib/proof-kit.mjs';
import { confirmedMaterial, proofItem, proofProject } from './lib/fixtures.mjs';

await runMigration({
  version: '236',
  expectedTip: '235',
  async proofs(ctx) {
    const { one, all, check, rejects, browserCannotExecute, tablesAreGoverned, anchors } = ctx;
    const { org, actor } = anchors;
    const stamp = Date.now().toString(36).toUpperCase();
    const J = (x) => JSON.stringify(x);
    const act = async (fn, ...args) => (await one(`SELECT public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')}) r`, args)).r;
    const sync = (signals) => act('supply_signals_sync', org, J(signals), 'proof.v1');
    const status = async (key) => (await one(`SELECT status FROM public.supply_signals WHERE organization_id = $1 AND signal_key = $2`, [org, key]))?.status;

    await browserCannotExecute(['supply_signals_sync(uuid,jsonb,text)', 'supply_signal_dismiss(uuid,uuid,uuid,text)',
      'supply_signal_execute(uuid,uuid,uuid,jsonb)', 'supply_signal_link_followup(uuid,uuid,uuid,uuid)']);
    await tablesAreGoverned(['supply_signals', 'supply_signal_history', 'supply_intelligence_runs']);

    // ── Cenário: falta com estoque disponível e falta sem estoque ──
    const item = await proofItem(ctx, anchors, `CAB-${stamp}`, 'm');
    const project = await proofProject(ctx, anchors, `P236-${stamp}`);
    const reqA = await confirmedMaterial(ctx, anchors, project, item, 300);
    const reqB = await confirmedMaterial(ctx, anchors, project, item, 200);
    const wh = (await act('inventory_location_upsert', org, actor, J({ code: `ALM-${stamp}`, name: 'Almox', kind: 'WAREHOUSE' }))).location_id;
    await act('inventory_adjust', org, actor, J({ item_id: item, location_id: wh, quantity: 300, reason: 'Saldo inicial' }));
    const reserveSig = { signal_key: `alt:${reqA}:${wh}`, kind: 'ALTERNATE_STOCK', severity: 'high', project_id: project, requirement_id: reqA,
      item_id: item, location_id: wh, title: 'Reservar 300 m', rationale: 'Há 300 livres no Almox.', evidence: [{ label: 'Livre', value: '300 m' }],
      recommended_action: { kind: 'RESERVE', label: 'Reservar 300 m', payload: { requirement_id: reqA, location_id: wh, quantity: 300 } } };
    const buySig = { signal_key: `shortage:${reqB}`, kind: 'SHORTAGE', severity: 'critical', project_id: project, requirement_id: reqB, item_id: item,
      title: 'Comprar 200 m', rationale: 'Sem cobertura nem estoque.', evidence: [],
      recommended_action: { kind: 'REQUISITION', label: 'Requisitar 200 m', payload: { requirement_ids: [reqB], quantity: 200, priority: 'critical' } } };
    const followSig = { signal_key: `late:x-${stamp}`, kind: 'LATE_INBOUND', severity: 'medium', project_id: project, title: 'Pedido atrasado',
      rationale: 'Prometido para ontem.', evidence: [], recommended_action: { kind: 'FOLLOW_UP', label: 'Acompanhar', payload: {} } };

    const s1 = await sync([reserveSig, buySig, followSig]);
    check('leitura abre as recomendações (sistema, sem ator humano)', s1.opened === 3 && s1.resolved === 0, J(s1));
    const s2 = await sync([reserveSig, buySig]);
    check('o que deixou de ser verdade é resolvido sozinho (verificação)', s2.updated === 2 && s2.resolved === 1
      && await status(followSig.signal_key) === 'RESOLVED', J(s2));
    const s3 = await sync([reserveSig, buySig, followSig]);
    check('condição que volta reabre a recomendação', s3.opened === 1 && await status(followSig.signal_key) === 'OPEN', J(s3));

    const id = async (key) => (await one(`SELECT id FROM public.supply_signals WHERE organization_id = $1 AND signal_key = $2`, [org, key])).id;
    await rejects('descartar exige motivo', 'SELECT public.supply_signal_dismiss($1,$2,$3,$4)', [org, actor, await id(followSig.signal_key), ' '], /requires a reason/);
    await act('supply_signal_dismiss', org, actor, await id(followSig.signal_key), 'Cliente fornece este material');
    await sync([reserveSig, buySig, followSig]);
    check('descartada continua descartada enquanto a condição for a mesma (a pessoa já disse não)', await status(followSig.signal_key) === 'DISMISSED');

    // ── Executar = o MESMO ato governado, com a identidade de quem aceitou ──
    await rejects('recomendação de acompanhamento não é ato executável', 'SELECT public.supply_signal_execute($1,$2,$3,$4)',
      [org, actor, await id(followSig.signal_key), '{}'], /is DISMISSED|not executable/);
    await rejects('ator sem alçada não executa (o ato refaz a checagem)', 'SELECT public.supply_signal_execute($1,$2,$3,$4)',
      [org, '00000000-0000-4000-8000-000000000001', await id(reserveSig.signal_key), '{}'], /lacks permission/);
    const ex = await act('supply_signal_execute', org, actor, await id(reserveSig.signal_key), '{}');
    const res = await one(`SELECT count(*)::int n, sum(quantity)::float q FROM public.inventory_reservations WHERE requirement_id = $1`, [reqA]);
    check('aceitar reserva pelo ato governado (reserva real, idempotente pelo sinal)', ex.status === 'EXECUTED' && res.n === 1 && res.q === 300, J({ ex, res }));
    await rejects('executada não se executa de novo', 'SELECT public.supply_signal_execute($1,$2,$3,$4)',
      [org, actor, await id(reserveSig.signal_key), '{}'], /nothing to execute/);
    await sync([reserveSig, buySig, followSig]);
    check('condição que persiste depois da ação reabre (a ação não bastou)', await status(reserveSig.signal_key) === 'OPEN');
    await rejects('reexecutar depois de reabrir é ato novo — e o banco refaz as checagens (sem saldo livre, sem cobrir duas vezes)',
      'SELECT public.supply_signal_execute($1,$2,$3,$4)', [org, actor, await id(reserveSig.signal_key), '{}'], /over-cover|Not enough available/);
    const buy = await act('supply_signal_execute', org, actor, await id(buySig.signal_key), '{}');
    const rq = await one(`SELECT r.source, r.justification, l.quantity::float q FROM public.purchase_requisitions r
      JOIN public.purchase_requisition_lines l ON l.requisition_id = r.id WHERE r.id = $1`, [buy.result.requisition_id]);
    check('aceitar compra requisita pela falta, com a recomendação como justificativa', rq.source === 'SHORTAGE' && rq.q === 200
      && /Recomendação da Apex/.test(rq.justification), J(rq));

    // ── Acompanhamento do Apex com origens de Supply ──
    const kinds = await one(`SELECT 'purchase_order' = ANY (public.apex_followup_source_kinds()) po,
      'project_requirement' = ANY (public.apex_followup_source_kinds()) req,
      'contract' = ANY (public.apex_followup_source_kinds()) contract, 'internal_service_order' = ANY (public.apex_followup_source_kinds()) os`);
    check('acompanhamento aprende as origens de Supply sem perder as anteriores', kinds.po && kinds.req && kinds.contract && kinds.os);
    const fu = await one(`INSERT INTO public.apex_followups (organization_id, idempotency_key, source_kind, source_id, goal, responsible_text,
      state, created_by) VALUES ($1, $2, 'project_requirement', $3, 'Garantir cabo', 'Comprador', 'ACTIVE', $4) RETURNING id`,
      [org, `proof-${stamp}`, reqB, actor]);
    await act('supply_signal_link_followup', org, actor, await id(buySig.signal_key), fu.id);
    const linked = await one(`SELECT followup_id FROM public.supply_signals WHERE id = $1`, [await id(buySig.signal_key)]);
    check('recomendação ligada ao acompanhamento', linked.followup_id === fu.id);

    // ── Livro ──
    const hist = await all(`SELECT transition, actor_kind FROM public.supply_signal_history h JOIN public.supply_signals s ON s.id = h.signal_id
      WHERE s.organization_id = $1 AND s.project_id = $2`, [org, project]);
    const t = hist.map((h) => `${h.actor_kind}:${h.transition}`);
    check('histórico: Apex abre/reabre/resolve; pessoa descarta/executa/acompanha',
      ['apex:opened', 'apex:resolved', 'apex:reopened', 'human:dismissed', 'human:executed', 'human:followed_up'].every((x) => t.includes(x)), t.join(','));
    await rejects('Apex não "descarta" (decisão é humana)', `INSERT INTO public.supply_signal_history (organization_id, signal_id, transition, actor_kind)
      VALUES ($1, $2, 'dismissed', 'apex')`, [org, await id(buySig.signal_key)], /ssigh_actor_coherent/);
    await rejects('histórico não se reescreve', `UPDATE public.supply_signal_history SET note = 'x' WHERE signal_id = $1`,
      [await id(buySig.signal_key)], /append-only/);
    const runs = await one(`SELECT count(*)::int n FROM public.supply_intelligence_runs WHERE organization_id = $1`, [org]);
    check('cada leitura fica registrada', runs.n >= 5);
  },
});
