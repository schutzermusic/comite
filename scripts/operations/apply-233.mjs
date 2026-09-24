/**
 * 233 — Estoque: livro de movimentos, reservas atômicas, transferências e contagens.
 *   node scripts/operations/apply-233.mjs [--apply]
 */
import pg from 'pg';
import { runMigration } from './lib/proof-kit.mjs';
import { confirmedMaterial, proofItem, proofProject } from './lib/fixtures.mjs';

const ACTS = [
  'inventory_location_upsert(uuid,uuid,jsonb)', 'inventory_adjust(uuid,uuid,jsonb)', 'inventory_reserve(uuid,uuid,jsonb)',
  'inventory_release(uuid,uuid,uuid,numeric,text)', 'inventory_issue_to_project(uuid,uuid,jsonb)',
  'inventory_return_from_project(uuid,uuid,jsonb)', 'inventory_transfer_request(uuid,uuid,jsonb)',
  'inventory_transfer_approve(uuid,uuid,uuid)', 'inventory_transfer_dispatch(uuid,uuid,uuid,jsonb)',
  'inventory_transfer_receive(uuid,uuid,uuid,jsonb)', 'inventory_transfer_close(uuid,uuid,uuid,text)',
  'inventory_transfer_cancel(uuid,uuid,uuid,text)', 'inventory_count_open(uuid,uuid,jsonb)',
  'inventory_count_record(uuid,uuid,uuid,jsonb)', 'inventory_count_post(uuid,uuid,uuid,text)',
  'inventory_count_cancel(uuid,uuid,uuid,text)', 'inventory_post_movement(uuid,uuid,text,uuid,uuid,numeric,text,text,jsonb,text)',
];

await runMigration({
  version: '233',
  expectedTip: '232',
  async proofs(ctx) {
    const { one, all, check, rejects, browserCannotExecute, tablesAreGoverned, anchors } = ctx;
    const { org, actor } = anchors;
    const stamp = Date.now().toString(36).toUpperCase();
    const J = (x) => JSON.stringify(x);
    const act = async (fn, ...args) => (await one(`SELECT public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')}) r`, args)).r;
    const position = (item, loc) => one(`SELECT on_hand_qty::float h, reserved_qty::float r, available_qty::float a,
      inspection_qty::float i, inbound_transit_qty::float t FROM public.inventory_position
      WHERE organization_id = $1 AND item_id = $2 AND location_id = $3`, [org, item, loc]);
    const coverage = (req) => one(`SELECT reserved_qty::float r, consumed_qty::float c, in_transit_qty::float t,
      covered_qty::float cov, inbound_qty::float inb, shortage_qty::float s FROM public.supply_requirement_coverage
      WHERE requirement_id = $1`, [req]);

    await browserCannotExecute(ACTS);
    await tablesAreGoverned(['inventory_locations', 'inventory_movements', 'inventory_reservations', 'inventory_transfers',
      'inventory_transfer_lines', 'inventory_counts', 'inventory_count_lines']);

    // ── Cenário: itens, locais, dois projetos com demanda confirmada ──────
    const cab = await proofItem(ctx, anchors, `CAB-${stamp}`, 'm');
    const lotItem = (await one('SELECT public.supply_item_upsert($1,$2,$3) r', [org, actor,
      J({ code: `ISO-${stamp}`, description: 'Isolador', unit: 'un', tracking: 'LOT' })])).r.item_id;
    const serialItem = (await one('SELECT public.supply_item_upsert($1,$2,$3) r', [org, actor,
      J({ code: `REL-${stamp}`, description: 'Relé', unit: 'un', tracking: 'SERIAL' })])).r.item_id;
    const p1 = await proofProject(ctx, anchors, `P233A-${stamp}`);
    const p2 = await proofProject(ctx, anchors, `P233B-${stamp}`);
    const loc = async (code, kind, extra = {}) => (await act('inventory_location_upsert', org, actor,
      J({ code: `${code}-${stamp}`, name: code, kind, ...extra }))).location_id;
    const whA = await loc('ALM-A', 'WAREHOUSE');
    const whB = await loc('ALM-B', 'WAREHOUSE');
    const site2 = await loc('OBRA-B', 'PROJECT_SITE', { project_id: p2 });
    const quar = await loc('QUAR', 'QUARANTINE');
    const zone = await loc('ZONA-A1', 'ZONE', { parent_id: whA });
    await rejects('hierarquia de locais não fecha ciclo', 'SELECT public.inventory_location_upsert($1,$2,$3)',
      [org, actor, J({ id: whA, parent_id: zone })], /loop/);
    await rejects('canteiro sem projeto é recusado', 'SELECT public.inventory_location_upsert($1,$2,$3)',
      [org, actor, J({ code: `X-${stamp}`, name: 'x', kind: 'PROJECT_SITE' })], /invloc_site_has_project/);

    // ── Livro ─────────────────────────────────────────────────────────────
    await act('inventory_adjust', org, actor, J({ item_id: cab, location_id: whA, quantity: 1000, reason: 'Saldo inicial', idempotency_key: `ob-${stamp}` }));
    const replay = await act('inventory_adjust', org, actor, J({ item_id: cab, location_id: whA, quantity: 1000, reason: 'Saldo inicial', idempotency_key: `ob-${stamp}` }));
    check('ajuste repetido com a mesma chave não posta de novo', replay.replayed === true);
    await rejects('ajuste sem motivo é recusado', 'SELECT public.inventory_adjust($1,$2,$3)',
      [org, actor, J({ item_id: cab, location_id: whA, quantity: 5 })], /reason/);
    await rejects('saída além do em mão é recusada', 'SELECT public.inventory_adjust($1,$2,$3)',
      [org, actor, J({ item_id: cab, location_id: whA, quantity: -1001, reason: 'avaria' })], /on hand would be negative/);
    const mov = await one(`SELECT id FROM public.inventory_movements WHERE organization_id = $1 AND item_id = $2 LIMIT 1`, [org, cab]);
    await rejects('livro de movimentos não se reescreve (nem com privilégio)', 'UPDATE public.inventory_movements SET quantity = 1 WHERE id = $1',
      [mov.id], /append-only/);
    let pos = await position(cab, whA);
    check('em mão = soma do livro; disponível = em mão sem reservas', pos.h === 1000 && pos.a === 1000);

    // ── Reservas atômicas ────────────────────────────────────────────────
    const reqA = await confirmedMaterial(ctx, anchors, p1, cab, 600);
    const reqB = await confirmedMaterial(ctx, anchors, p2, cab, 600);
    const resA = (await act('inventory_reserve', org, actor, J({ requirement_id: reqA, location_id: whA, quantity: 600, idempotency_key: `ra-${stamp}` }))).reservation_id;
    pos = await position(cab, whA);
    check('reserva tira da disponibilidade, não do físico', pos.h === 1000 && pos.r === 600 && pos.a === 400, J(pos));
    await rejects('projeto B NÃO reserva o que já está reservado para A', 'SELECT public.inventory_reserve($1,$2,$3)',
      [org, actor, J({ requirement_id: reqB, location_id: whA, quantity: 600 })], /Not enough available stock/);
    const resB = (await act('inventory_reserve', org, actor, J({ requirement_id: reqB, location_id: whA, quantity: 400 }))).reservation_id;
    pos = await position(cab, whA);
    check('reserva parcial consome o restante; disponível zero', pos.a === 0 && pos.r === 1000);
    const again = await act('inventory_reserve', org, actor, J({ requirement_id: reqA, location_id: whA, quantity: 600, idempotency_key: `ra-${stamp}` }));
    check('reserva repetida com a mesma chave devolve a mesma reserva', again.replayed && again.reservation_id === resA);
    await rejects('chave reusada para outra reserva é recusada', 'SELECT public.inventory_reserve($1,$2,$3)',
      [org, actor, J({ requirement_id: reqA, location_id: whA, quantity: 5, idempotency_key: `ra-${stamp}` })], /reused/);
    await act('inventory_adjust', org, actor, J({ item_id: cab, location_id: whB, quantity: 300, reason: 'Saldo inicial' }));
    await rejects('requisito não é coberto duas vezes (sobre-reserva)', 'SELECT public.inventory_reserve($1,$2,$3)',
      [org, actor, J({ requirement_id: reqA, location_id: whB, quantity: 1 })], /over-cover/);
    await rejects('ajuste negativo não come reserva alheia', 'SELECT public.inventory_adjust($1,$2,$3)',
      [org, actor, J({ item_id: cab, location_id: whA, quantity: -10, reason: 'avaria' })], /reserved for other demand/);
    await act('inventory_adjust', org, actor, J({ item_id: cab, location_id: quar, quantity: 20, reason: 'Em inspeção' }));
    pos = await position(cab, quar);
    check('quarentena: em inspeção, nada disponível', pos.i === 20 && pos.a === 0);
    await rejects('estoque em inspeção não é reservável', 'SELECT public.inventory_reserve($1,$2,$3)',
      [org, actor, J({ requirement_id: reqB, location_id: quar, quantity: 1 })], /not reservable/);
    await rejects('identidade da reserva não muda por escrita direta', 'UPDATE public.inventory_reservations SET quantity = 1 WHERE id = $1',
      [resA], /identity does not change/);

    // Concorrência: a reserva segura a trava (inquilino, item, local) até o fim da transação.
    const other = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
    await other.connect();
    try {
      const probe = await other.query(`SELECT pg_try_advisory_xact_lock(hashtextextended(format('inventory:%s:%s:%s', $1::uuid, $2::uuid, $3::uuid), 0)) got`,
        [org, cab, whA]);
      check('reserva concorrente no mesmo saldo espera (trava consultiva detida pela transação)', probe.rows[0].got === false);
    } finally { await other.end(); }

    // ── Liberar, entregar à obra, devolver ───────────────────────────────
    await rejects('liberar sem motivo é recusado', 'SELECT public.inventory_release($1,$2,$3,$4,$5)', [org, actor, resB, 100, ' '], /reason/);
    await act('inventory_release', org, actor, resB, 100, 'Replanejado');
    pos = await position(cab, whA);
    check('liberar devolve a disponibilidade', pos.a === 100 && pos.r === 900);
    await act('inventory_issue_to_project', org, actor, J({ reservation_id: resA, quantity: 200, idempotency_key: `is-${stamp}` }));
    let cov = await coverage(reqA);
    check('entrega à obra: consumido cobre, reservado cai, falta zero', cov.r === 400 && cov.c === 200 && cov.cov === 600 && cov.s === 0, J(cov));
    pos = await position(cab, whA);
    check('entrega baixa o físico e a reserva juntos (disponível intacto)', pos.h === 800 && pos.a === 100);
    await rejects('entrega além do reservado em aberto é recusada', 'SELECT public.inventory_issue_to_project($1,$2,$3)',
      [org, actor, J({ reservation_id: resA, quantity: 401 })], /within the open reservation/);
    await act('inventory_return_from_project', org, actor, J({ reservation_id: resA, quantity: 50, reason: 'Sobra de obra' }));
    cov = await coverage(reqA);
    check('devolução: volta como estoque livre e a falta reaparece', cov.c === 150 && cov.r === 400 && cov.s === 50, J(cov));

    // ── Transferência com requisito ─────────────────────────────────────
    const reqC = await confirmedMaterial(ctx, anchors, p2, cab, 250);
    const tr = await act('inventory_transfer_request', org, actor, J({ from_location_id: whB, to_location_id: site2,
      lines: [{ item_id: cab, quantity: 250, requirement_id: reqC }], idempotency_key: `tr-${stamp}` }));
    const trProject = await one(`SELECT project_id FROM public.inventory_transfers WHERE id = $1`, [tr.transfer_id]);
    check('transferência herda o projeto do requisito', trProject.project_id === p2);
    await rejects('despachar sem aprovar é recusado', 'SELECT public.inventory_transfer_dispatch($1,$2,$3,$4)',
      [org, actor, tr.transfer_id, '{}'], /only an approved/);
    await act('inventory_transfer_approve', org, actor, tr.transfer_id);
    await act('inventory_transfer_dispatch', org, actor, tr.transfer_id, J({ carrier: 'Frota própria' }));
    cov = await coverage(reqC);
    pos = await position(cab, whB);
    check('despacho: sai da origem e vira "em trânsito" para o requisito', pos.h === 50 && cov.t === 250 && cov.s === 0, J({ pos, cov }));
    await rejects('transferência despachada não se cancela', 'SELECT public.inventory_transfer_cancel($1,$2,$3,$4)',
      [org, actor, tr.transfer_id, 'x'], /not cancelled/);
    const line = await one(`SELECT id FROM public.inventory_transfer_lines WHERE transfer_id = $1`, [tr.transfer_id]);
    const rcv = await act('inventory_transfer_receive', org, actor, tr.transfer_id, J({ lines: [{ line_id: line.id, quantity: 100 }], idempotency_key: `rc-${stamp}` }));
    cov = await coverage(reqC);
    check('recebimento parcial reserva no destino o que chegou', rcv.status === 'PARTIALLY_RECEIVED' && cov.r === 100 && cov.t === 150, J(cov));
    const rcv2 = await act('inventory_transfer_receive', org, actor, tr.transfer_id, J({ lines: [{ line_id: line.id, quantity: 100 }], idempotency_key: `rc-${stamp}` }));
    pos = await position(cab, site2);
    check('recebimento repetido com a mesma chave não entra duas vezes', rcv2.replayed && pos.h === 100);
    await rejects('receber mais que o despachado é recusado', 'SELECT public.inventory_transfer_receive($1,$2,$3,$4)',
      [org, actor, tr.transfer_id, J({ lines: [{ line_id: line.id, quantity: 151 }] })], /not exceed/);
    await rejects('fechar com saldo não recebido exige motivo', 'SELECT public.inventory_transfer_close($1,$2,$3,$4)',
      [org, actor, tr.transfer_id, null], /requires a reason/);
    await act('inventory_transfer_close', org, actor, tr.transfer_id, 'Avaria no transporte — 150 m perdidos');
    cov = await coverage(reqC);
    check('fechada com perda: trânsito zera e a falta fica visível', cov.t === 0 && cov.s === 150, J(cov));

    // Transferência de estoque reservado: a cobertura muda de forma, não de tamanho.
    const before = await coverage(reqA);
    const tr2 = await act('inventory_transfer_request', org, actor, J({ from_location_id: whA, to_location_id: whB,
      lines: [{ item_id: cab, quantity: 100, requirement_id: reqA, source_reservation_id: resA }] }));
    await act('inventory_transfer_approve', org, actor, tr2.transfer_id);
    await act('inventory_transfer_dispatch', org, actor, tr2.transfer_id, '{}');
    const after = await coverage(reqA);
    check('reserva despachada vira trânsito sem dupla contagem', after.r === before.r - 100 && after.t === 100
      && after.cov + after.inb === before.cov + before.inb, J({ before, after }));
    const tr3 = await act('inventory_transfer_request', org, actor, J({ from_location_id: whA, to_location_id: whB,
      lines: [{ item_id: cab, quantity: 200 }] }));
    await act('inventory_transfer_approve', org, actor, tr3.transfer_id);
    await rejects('despacho não leva estoque reservado de outra obra', 'SELECT public.inventory_transfer_dispatch($1,$2,$3,$4)',
      [org, actor, tr3.transfer_id, '{}'], /reserved for other demand/);

    // ── Lote e série ─────────────────────────────────────────────────────
    await rejects('item com lote exige o lote', 'SELECT public.inventory_adjust($1,$2,$3)',
      [org, actor, J({ item_id: lotItem, location_id: whA, quantity: 10, reason: 'entrada' })], /lot\/serial is required/);
    await act('inventory_adjust', org, actor, J({ item_id: serialItem, location_id: whA, quantity: 1, lot_code: 'SN-1', reason: 'entrada' }));
    await rejects('mesmo número de série não entra duas vezes', 'SELECT public.inventory_adjust($1,$2,$3)',
      [org, actor, J({ item_id: serialItem, location_id: whB, quantity: 1, lot_code: 'SN-1', reason: 'entrada' })], /already in stock/);
    await rejects('série move uma unidade por linha', 'SELECT public.inventory_adjust($1,$2,$3)',
      [org, actor, J({ item_id: serialItem, location_id: whA, quantity: 2, lot_code: 'SN-2', reason: 'entrada' })], /one serial per line/);

    // ── Contagem ─────────────────────────────────────────────────────────
    const cnt = await act('inventory_count_open', org, actor, J({ location_id: whB }));
    const cl = await one(`SELECT id, expected_quantity::float e FROM public.inventory_count_lines WHERE count_id = $1 AND item_id = $2`, [cnt.count_id, cab]);
    check('contagem fotografa o esperado pelo livro', cl && cl.e === 50, J(cl));
    await act('inventory_count_record', org, actor, cnt.count_id, J([{ line_id: cl.id, counted_quantity: 40 }]));
    const posted = await act('inventory_count_post', org, actor, cnt.count_id, 'Inventário rotativo');
    pos = await position(cab, whB);
    check('postar contagem corrige pela diferença (COUNT_CORRECTION)', posted.corrections === 1 && pos.h === 40, J(pos));
    const stale = await act('inventory_count_open', org, actor, J({ location_id: whA, item_ids: [cab] }));
    const sl = await one(`SELECT id FROM public.inventory_count_lines WHERE count_id = $1 AND item_id = $2`, [stale.count_id, cab]);
    await act('inventory_count_record', org, actor, stale.count_id, J([{ line_id: sl.id, counted_quantity: 700 }]));
    await act('inventory_adjust', org, actor, J({ item_id: cab, location_id: whA, quantity: 5, reason: 'Recebido durante a contagem' }));
    await rejects('estoque que se moveu durante a contagem exige recontagem', 'SELECT public.inventory_count_post($1,$2,$3,$4)',
      [org, actor, stale.count_id, null], /Recount/);
    await rejects('uma contagem aberta por local', 'SELECT public.inventory_count_open($1,$2,$3)',
      [org, actor, J({ location_id: whA })], /invcnt_one_open_per_location/);

    // ── Autorização e inquilino ──────────────────────────────────────────
    await rejects('ator sem alçada não reserva (recheque no banco)', 'SELECT public.inventory_reserve($1,$2,$3)',
      [org, '00000000-0000-4000-8000-000000000001', J({ requirement_id: reqB, location_id: whB, quantity: 1 })], /lacks permission/);
    const otherOrg = await one(`SELECT id FROM public.organizations WHERE id <> $1 LIMIT 1`, [org]);
    await rejects('requisito de outro inquilino não é visto', 'SELECT public.inventory_reserve($1,$2,$3)',
      [otherOrg.id, actor, J({ requirement_id: reqB, location_id: whB, quantity: 1 })], /lacks permission|not found in tenant/);

    // ── Eventos ──────────────────────────────────────────────────────────
    const ev = await all(`SELECT event_type FROM public.domain_events WHERE organization_id = $1
      AND (aggregate_id = $2 OR aggregate_id = $3) ORDER BY occurred_at`, [org, resA, tr.transfer_id]);
    const types = new Set(ev.map((e) => e.event_type));
    check('eventos canônicos: reservado, entregue, transferência despachada/recebida/fechada',
      ['supply.inventory.reserved', 'supply.inventory.issued', 'supply.transfer.dispatched',
        'supply.transfer.partially_received', 'supply.transfer.closed'].every((t) => types.has(t)), [...types].join(','));
  },
});
