/**
 * 230 — OS interna como handoff governado Comercial → Operações.
 *
 *   node scripts/operations/apply-230.mjs           # ensaio + provas, ROLLBACK
 *   node scripts/operations/apply-230.mjs --apply   # aplica e registra (provas desfeitas)
 */
import { runMigration } from './lib/proof-kit.mjs';
import { acceptedPackage, projectFromOrder } from './lib/fixtures.mjs';

await runMigration({
  version: '230',
  expectedTip: '217',
  async preflight(db) {
    const r = (await db.query(`SELECT count(*)::int n FROM public.internal_service_orders`)).rows[0];
    console.log(`Preflight: ${r.n} OS interna(s) existente(s).`);
  },
  async proofs(ctx) {
    const { one, all, check, rejects, succeeds, browserCannotExecute, tablesAreGoverned, anchors } = ctx;
    const { org, actor } = anchors;
    const stamp = Date.now().toString(36);

    // ── Superfície ────────────────────────────────────────────────────────
    await browserCannotExecute([
      'apex_actor_has_permission(uuid,uuid,text)',
      'internal_service_order_generate_from_package(uuid,uuid,uuid,jsonb)',
      'internal_service_order_register_upload(uuid,uuid,uuid,jsonb)',
      'internal_service_order_apply_extraction(uuid,uuid,uuid)',
      'internal_service_order_seed_from_package(uuid,uuid,uuid)',
      'internal_service_order_update_draft(uuid,uuid,uuid,jsonb)',
      'internal_service_order_item_upsert(uuid,uuid,uuid,jsonb)',
      'internal_service_order_items_decide(uuid,uuid,uuid,jsonb)',
      'internal_service_order_issue_with_exception(uuid,uuid,uuid,text,uuid)',
      'internal_service_order_amend(uuid,uuid,uuid,jsonb,text)',
      'internal_service_order_record_divergence(uuid,uuid,uuid,jsonb)',
      'internal_service_order_compare_with_governing(uuid,uuid)',
      'internal_service_order_issue(uuid,uuid,uuid)',
      'internal_service_order_bind_project(uuid,uuid,uuid,text,jsonb)',
    ]);
    await tablesAreGoverned(['internal_service_order_items', 'internal_service_order_revisions',
      'internal_service_order_issue_exceptions', 'internal_service_orders']);

    const perms = await all(`SELECT key FROM public.permissions WHERE module = 'operations' ORDER BY key`);
    check('quatro permissões de Operações cadastradas', perms.length === 4, perms.map((p) => p.key).join(', '));
    check('owner_admin da âncora detém a exceção de emissão',
      (await one(`SELECT public.apex_actor_has_permission($1,$2,'operations.service_orders.override') b`, [org, actor])).b);
    check('ator desconhecido não detém a exceção',
      !(await one(`SELECT public.apex_actor_has_permission($1,gen_random_uuid(),'operations.service_orders.override') b`, [org])).b);

    // ── Backfill ──────────────────────────────────────────────────────────
    const legacy = await all(`SELECT o.id, o.source_context_acceptance_id, o.governing_technical_revision_id,
        o.governing_commercial_revision_id, o.updated_at = o.issued_at AS untouched,
        (SELECT kind FROM public.internal_service_order_revisions r WHERE r.service_order_id = o.id AND r.revision = 1) rev1
      FROM public.internal_service_orders o WHERE o.created_at < now() - interval '1 minute'`);
    for (const o of legacy) {
      check(`backfill da OS ${o.id.slice(0, 8)}: pacote + revisão 1`,
        Boolean(o.source_context_acceptance_id && o.governing_technical_revision_id
                && o.governing_commercial_revision_id) && o.rev1 === 'BACKFILL' && o.untouched,
        JSON.stringify({ acceptance: o.source_context_acceptance_id, rev1: o.rev1, untouched: o.untouched }));
    }

    // ── Caminho dourado: pacote aceito → OS → revisão → emissão → projeto ─
    const pkg = await acceptedPackage(ctx, anchors, `P230-${stamp}`);
    const genSql = 'SELECT public.internal_service_order_generate_from_package($1,$2,$3,$4) r';
    const gen = (await one(genSql, [org, actor, pkg.acceptanceId, JSON.stringify({ os_number: `OS-P230-${stamp}` })])).r;
    const os = await one(`SELECT * FROM public.internal_service_orders WHERE id = $1`, [gen.service_order_id]);
    check('OS gerada do pacote guarda o aceite e as revisões exatas de PT e PC',
      os.source_context_acceptance_id === pkg.acceptanceId
      && os.governing_technical_revision_id === pkg.pt.revision_id
      && os.governing_commercial_revision_id === pkg.pc.revision_id
      && os.origin === 'from_accepted_proposal' && os.status === 'DRAFT');
    check('valor herdado da PC, sem redigitação', Number(os.authorized_value) === 1000 && os.currency === 'BRL');
    const items = await all(`SELECT * FROM public.internal_service_order_items WHERE service_order_id = $1 ORDER BY position`, [os.id]);
    check('conteúdo estruturado semeado do pacote (escopo, entregável, dependência, exclusão, recurso, valor)',
      items.length === 6 && ['SCOPE', 'DELIVERABLE', 'CUSTOMER_DEPENDENCY', 'EXCLUSION', 'RESOURCE', 'COMMERCIAL_REFERENCE']
        .every((k) => items.some((i) => i.kind === k)), items.map((i) => i.kind).join(','));
    check('cada linha carrega proveniência (fato, página, trecho, revisão)',
      items.every((i) => i.source_fact_id && i.source_page === 1 && i.source_quote && i.source_revision_id));
    const cable = items.find((i) => i.kind === 'RESOURCE');
    check('quantidade e unidade preservadas no recurso', Number(cable?.quantity) === 1000 && cable?.unit === 'm');
    check('leitura da IA chega PENDENTE de revisão humana', items.every((i) => i.confirmation_state === 'UNCONFIRMED'));

    const again = (await one(genSql, [org, actor, pkg.acceptanceId, '{}'])).r;
    check('gerar de novo devolve a MESMA OS (idempotência pelo aceite)',
      again.reused === true && again.service_order_id === os.id);

    await rejects('emissão recusada com linhas pendentes de revisão',
      'SELECT public.internal_service_order_issue($1,$2,$3)', [org, actor, os.id], /awaiting human review/);

    const exclusion = items.find((i) => i.kind === 'EXCLUSION');
    await one('SELECT public.internal_service_order_items_decide($1,$2,$3,$4) r', [org, actor, os.id,
      JSON.stringify(items.map((i) => ({ item_id: i.id, decision: i.id === exclusion.id ? 'REJECTED' : 'CONFIRMED' })))]);
    const decided = await one(`SELECT count(*) FILTER (WHERE confirmation_state = 'CONFIRMED' AND confirmed_by = $2)::int c,
        count(*) FILTER (WHERE confirmation_state = 'REJECTED')::int r
      FROM public.internal_service_order_items WHERE service_order_id = $1`, [os.id, actor]);
    check('revisão humana grava quem confirmou', decided.c === 5 && decided.r === 1);

    const cmp1 = (await one('SELECT public.internal_service_order_compare_with_governing($1,$2) r', [org, os.id])).r;
    const cmp2 = (await one('SELECT public.internal_service_order_compare_with_governing($1,$2) r', [org, os.id])).r;
    check('confronto aponta a exclusão da PT retirada na OS (WARNING)', cmp1.divergences_opened === 1);
    check('confronto é idempotente (segunda execução não duplica)', cmp2.divergences_opened === 0);

    const issued = (await one('SELECT public.internal_service_order_issue($1,$2,$3) r', [org, actor, os.id])).r;
    check('OS revisada e sem bloqueio emite', issued.status === 'ISSUED');
    const rev1 = await one(`SELECT kind, snapshot FROM public.internal_service_order_revisions
      WHERE service_order_id = $1 AND revision = 1`, [os.id]);
    check('emissão grava a revisão 1 com o instantâneo emitido (sem a linha rejeitada)',
      rev1?.kind === 'ISSUE' && rev1.snapshot.items.length === 5 && rev1.snapshot.governing_commercial_revision_id === pkg.pc.revision_id);
    const evIssued = await one(`SELECT count(*)::int n FROM public.domain_events
      WHERE aggregate_id = $1 AND event_type IN ('operations.service_order.created','operations.service_order.issued')`, [os.id]);
    check('fatos de domínio: criada e emitida', evIssued.n === 2);

    await rejects('campo material de OS emitida não se reescreve',
      `UPDATE public.internal_service_orders SET scope_summary = 'outro' WHERE id = $1`, [os.id], /governed amendment/);
    await rejects('linha de OS emitida não se acrescenta por fora da emenda',
      `INSERT INTO public.internal_service_order_items (organization_id, service_order_id, kind, title, origin)
       VALUES ($1,$2,'SCOPE','x','manual')`, [org, os.id], /governed amendment/);
    await rejects('revisão emitida não se reescreve',
      `UPDATE public.internal_service_order_revisions SET reason = 'x' WHERE service_order_id = $1`, [os.id], /append-only/);

    const amended = await succeeds('emenda governada grava a revisão 2',
      'SELECT public.internal_service_order_amend($1,$2,$3,$4,$5) r',
      [org, actor, os.id, JSON.stringify({ site_label: 'Subestação Norte',
        add_items: [{ kind: 'ACTIVITY', title: 'Ensaio de isolamento adicional' }] }), 'Cliente pediu ensaio extra por e-mail']);
    check('emenda devolve revisão 2', amended?.r?.revision === 2);
    await rejects('valor da OS de proposta não muda por emenda',
      'SELECT public.internal_service_order_amend($1,$2,$3,$4,$5)',
      [org, actor, os.id, JSON.stringify({ authorized_value: 2000 }), 'tentativa'], /new proposal revision/);

    const tag = `P230-${stamp}`;
    const projectId = await projectFromOrder(ctx, anchors, os.id, tag);
    const bindAgain = (await one('SELECT public.internal_service_order_bind_project($1,$2,$3,$4,$5) r',
      [org, actor, os.id, `proj-other-${stamp}`, JSON.stringify({ nome: 'x', cliente: 'y' })])).r;
    check('handoff OS → Projeto é idempotente (retentativa não cria segundo projeto)',
      bindAgain.reused === true && bindAgain.project_id === projectId);
    const projects = await one(`SELECT count(*)::int n FROM public.projects WHERE id IN ($1,$2)`, [projectId, `proj-other-${stamp}`]);
    check('um projeto só', projects.n === 1);
    const evLinked = await one(`SELECT count(*)::int n FROM public.domain_events
      WHERE aggregate_id = $1 AND event_type = 'operations.service_order.project_linked'`, [os.id]);
    check('fato de domínio: projeto vinculado', evLinked.n === 1);

    // ── Divergência bloqueante e exceção governada ────────────────────────
    const pkgB = await acceptedPackage(ctx, anchors, `P230B-${stamp}`);
    const manual = (await one('SELECT public.internal_service_order_create($1,$2,$3,$4) r', [org, actor, pkgB.engagementId,
      JSON.stringify({ origin: 'manual', os_number: `OS-P230B-${stamp}`, title: 'OS manual', authorized_value: 1500, currency: 'BRL' })])).r;
    const cmpB = (await one('SELECT public.internal_service_order_compare_with_governing($1,$2) r', [org, manual.service_order_id])).r;
    check('valor divergente abre BLOCKING e segura a OS em confirmação', cmpB.divergences_opened >= 1);
    await rejects('emissão normal recusada com divergência bloqueante',
      'SELECT public.internal_service_order_issue($1,$2,$3)', [org, actor, manual.service_order_id], /blocking divergence/);
    await rejects('exceção sem permissão é recusada NO BANCO',
      'SELECT public.internal_service_order_issue_with_exception($1,gen_random_uuid(),$2,$3,NULL)',
      [org, manual.service_order_id, 'Motivo suficientemente longo para a exceção'], /operations\.service_orders\.override/);
    await rejects('exceção sem motivo escrito é recusada',
      'SELECT public.internal_service_order_issue_with_exception($1,$2,$3,$4,NULL)',
      [org, actor, manual.service_order_id, 'curto'], /written reason/);
    const exc = (await one('SELECT public.internal_service_order_issue_with_exception($1,$2,$3,$4,NULL) r',
      [org, actor, manual.service_order_id, 'Cliente confirmou por ata que o valor da OS prevalece até o aditivo'])).r;
    check('exceção governada emite e nomeia as divergências dispensadas', exc.status === 'ISSUED' && exc.divergences_waived >= 1);
    const excRow = await one(`SELECT authorized_by, authorized_permission FROM public.internal_service_order_issue_exceptions
      WHERE service_order_id = $1`, [manual.service_order_id]);
    check('livro da exceção: ator e permissão verificada', excRow?.authorized_by === actor
      && excRow.authorized_permission === 'operations.service_orders.override');
    await rejects('exceção não se apaga pela aplicação (authenticated)',
      `SET LOCAL ROLE authenticated; DELETE FROM public.internal_service_order_issue_exceptions WHERE service_order_id = '${manual.service_order_id}'`);
    await one('RESET ROLE');

    // ── Pacote não muda sob a OS emitida (INV-03) ─────────────────────────
    // Uma segunda revisão ACEITA do mesmo documento é recusada pelo banco
    // (`cpr_one_accepted_per_proposal`); a regra PACKAGE_REVISION do confronto
    // é defesa em profundidade para o dia em que isso mudar.
    await rejects('segunda revisão aceita da PC é recusada estruturalmente',
      `INSERT INTO public.commercial_proposal_revisions (organization_id, proposal_id, revision, status, total_value,
         currency, internal_review_at, internally_approved_at, internally_approved_by, sent_at, sent_by,
         accepted_at, acceptance_source, recorded_by, created_by)
       VALUES ($1,$2,2,'ACCEPTED',1000,'BRL',now(),now(),$3,now(),$3,now(),'purchase_order',$3,$3)`,
      [org, pkg.pc.proposal_id, actor], /cpr_one_accepted_per_proposal/);
    await rejects('revisão aceita não é sucedida por revisão nova',
      'SELECT public.commercial_proposal_revise($1,$2,$3,$4)',
      [org, actor, pkg.pc.revision_id, JSON.stringify({ total_value: '900', currency: 'BRL' })], /cannot be superseded/);
    const osAfter = await one(`SELECT governing_commercial_revision_id g FROM public.internal_service_orders WHERE id = $1`, [os.id]);
    check('a OS emitida continua apontando a revisão aceita do pacote', osAfter.g === pkg.pc.revision_id);

    // ── Upload: mesmo arquivo, mesma OS ───────────────────────────────────
    const sha = 'a'.repeat(64);
    const upSql = 'SELECT public.internal_service_order_register_upload($1,$2,$3,$4) r';
    const upPayload = JSON.stringify({ file_path: `${org}/service-orders/${stamp}.pdf`, content_sha256: sha, file_title: 'OS.pdf' });
    const up1 = (await one(upSql, [org, actor, pkgB.engagementId, upPayload])).r;
    const up2 = (await one(upSql, [org, actor, pkgB.engagementId, upPayload])).r;
    check('importar o mesmo PDF devolve a mesma OS', up2.reused === true && up2.service_order_id === up1.service_order_id);
    await rejects('caminho fora do inquilino é recusado', upSql,
      [org, actor, pkgB.engagementId, JSON.stringify({ file_path: `outro/${stamp}.pdf`, content_sha256: sha })], /outside the tenant/);
    await one('SELECT public.commercial_fact_record($1,$2) id', [org, JSON.stringify({
      subject_kind: 'internal_service_order', subject_id: up1.service_order_id, document_context: 'INTERNAL_SERVICE_ORDER',
      document_id: up1.document_id, fact_domain: 'DELIVERABLE', label: 'Relatório fotográfico', value_text: 'Relatório fotográfico',
      source_page: 2, source_quote: '“relatório fotográfico”', extraction_method: 'ai',
      ai_provider: 'proof', ai_model: 'proof-model', ai_pipeline_version: 'proof.v1' })]);
    const applied = (await one('SELECT public.internal_service_order_apply_extraction($1,$2,$3) r', [org, actor, up1.service_order_id])).r;
    const appliedAgain = (await one('SELECT public.internal_service_order_apply_extraction($1,$2,$3) r', [org, actor, up1.service_order_id])).r;
    const upItem = await one(`SELECT origin, ai_model, source_document_id, confirmation_state FROM public.internal_service_order_items
      WHERE service_order_id = $1`, [up1.service_order_id]);
    check('leitura da OS carregada vira linha pendente com proveniência de IA',
      applied.items_added === 1 && appliedAgain.items_added === 0 && upItem.origin === 'document_extraction'
      && upItem.ai_model === 'proof-model' && upItem.source_document_id === up1.document_id && upItem.confirmation_state === 'UNCONFIRMED');

    // ── Inquilino ─────────────────────────────────────────────────────────
    const otherOrg = await one(`SELECT id FROM public.organizations WHERE id <> $1 LIMIT 1`, [org]);
    await rejects('linha de OS com organização trocada é recusada pela FK composta',
      `INSERT INTO public.internal_service_order_items (organization_id, service_order_id, kind, title, origin)
       VALUES ($1,$2,'SCOPE','x','manual')`, [otherOrg.id, up1.service_order_id], /foreign key|violates/);
    await rejects('gerar OS com aceite de outro inquilino responde "não encontrado"', genSql,
      [otherOrg.id, actor, pkg.acceptanceId, '{}'], /não encontrado/);
  },
});
