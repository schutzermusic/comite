/**
 * Cenários de prova montados SÓ por funções governadas — o mesmo caminho da
 * aplicação. Sempre dentro do SAVEPOINT de provas: nada sobra no banco.
 */

const fact = (revisionId, context, domain, label, extra = {}) => ({
  subject_kind: 'proposal_revision', subject_id: revisionId, document_context: context,
  fact_domain: domain, label, value_text: extra.value_text ?? label,
  source_page: extra.source_page ?? 1, source_quote: extra.source_quote ?? `“${label}”`,
  confidence: 0.9, extraction_method: 'ai',
  ai_provider: 'proof', ai_model: 'proof-model', ai_pipeline_version: 'proof.v1',
  ...extra,
});

/**
 * PT + PC pareadas, lidas (fatos com página e trecho), aprovadas, enviadas e
 * ACEITAS como pacote; engajamento com a PC aceita como fonte regente e
 * autorizado.
 */
export async function acceptedPackage({ one }, { org, actor }, tag, value = 1000) {
  const create = (payload) => one('SELECT public.commercial_proposal_create($1,$2,$3) r',
    [org, actor, JSON.stringify(payload)]).then((x) => x.r);
  const pt = await create({ proposal_number: `PT-${tag}`, kind: 'TECHNICAL', title: `Prova ${tag}`,
    counterparty_name: 'Prova Operações' });
  const pc = await create({ proposal_number: `PC-${tag}`, kind: 'COMMERCIAL', counterparty_name: 'Prova Operações',
    total_value: String(value), currency: 'BRL', context_proposal_id: pt.proposal_id });

  const facts = [
    fact(pt.revision_id, 'TECHNICAL_PROPOSAL', 'SCOPE', 'Montagem eletromecânica da subestação'),
    fact(pt.revision_id, 'TECHNICAL_PROPOSAL', 'DELIVERABLE', 'Relatório de comissionamento'),
    fact(pt.revision_id, 'TECHNICAL_PROPOSAL', 'DEPENDENCY', 'Cliente libera acesso ao pátio'),
    fact(pt.revision_id, 'TECHNICAL_PROPOSAL', 'EXCLUSION', 'Obras civis não incluídas'),
    fact(pt.revision_id, 'TECHNICAL_PROPOSAL', 'RESOURCE', 'Cabo 35 mm',
      { value_numeric: 1000, unit: 'm', value_text: '1000 m' }),
    fact(pc.revision_id, 'COMMERCIAL_PROPOSAL', 'VALUE', 'Valor global',
      { value_numeric: value, currency: 'BRL', value_text: null }),
  ];
  for (const f of facts) await one('SELECT public.commercial_fact_record($1,$2) id', [org, JSON.stringify(f)]);

  for (const to of ['INTERNAL_REVIEW', 'INTERNALLY_APPROVED', 'SENT']) {
    await one('SELECT public.commercial_proposal_context_transition($1,$2,$3,$4) r', [org, actor, pt.proposal_id, to]);
  }
  await one('SELECT public.commercial_proposal_context_record_outcome($1,$2,$3,$4,$5) r',
    [org, actor, pc.proposal_id, 'ACCEPTED',
     JSON.stringify({ acceptance_source: 'purchase_order', acceptance_external_ref: `PO-${tag}` })]);
  const acceptance = await one(`SELECT id FROM public.commercial_proposal_context_acceptances
    WHERE organization_id = $1 AND context_id = $2 ORDER BY created_at DESC LIMIT 1`, [org, pt.proposal_id]);

  const engagementId = (await one('SELECT public.commercial_engagement_create($1,$2,$3::jsonb) id',
    [org, actor, JSON.stringify({ title: `Obra ${tag}`, counterparty_name: 'Prova Operações', currency: 'BRL' })])).id;
  await one('SELECT public.commercial_engagement_attach_authorization($1,$2,$3,$4::jsonb) r',
    [org, actor, engagementId, JSON.stringify({ source_kind: 'accepted_proposal',
      proposal_revision_id: pc.revision_id, authorized_value: value, currency: 'BRL' })]);
  await one('SELECT public.commercial_engagement_authorize($1,$2,$3,$4) r', [org, actor, engagementId, 'prova']);

  return { pt, pc, acceptanceId: acceptance.id, engagementId };
}

/** OS gerada do pacote, revisada (linhas confirmadas) e emitida. */
export async function issuedOrderFromPackage(ctx, anchors, tag) {
  const { one } = ctx;
  const pkg = await acceptedPackage(ctx, anchors, tag);
  const gen = (await one('SELECT public.internal_service_order_generate_from_package($1,$2,$3,$4) r',
    [anchors.org, anchors.actor, pkg.acceptanceId, JSON.stringify({ os_number: `OS-${tag}` })])).r;
  const items = (await ctx.all(`SELECT id FROM public.internal_service_order_items WHERE service_order_id = $1`,
    [gen.service_order_id])).map((r) => ({ item_id: r.id, decision: 'CONFIRMED' }));
  await one('SELECT public.internal_service_order_items_decide($1,$2,$3,$4) r',
    [anchors.org, anchors.actor, gen.service_order_id, JSON.stringify(items)]);
  await one('SELECT public.internal_service_order_issue($1,$2,$3) r', [anchors.org, anchors.actor, gen.service_order_id]);
  return { ...pkg, serviceOrderId: gen.service_order_id };
}

/** Projeto criado a partir de OS emitida (caminho canônico). */
export async function projectFromOrder({ one }, { org, actor }, serviceOrderId, tag) {
  const r = (await one('SELECT public.internal_service_order_bind_project($1,$2,$3,$4,$5) r',
    [org, actor, serviceOrderId, `proj-${tag}`, JSON.stringify({ nome: `Projeto ${tag}`, cliente: 'Prova Operações' })])).r;
  return r.project_id;
}

/** Projeto canônico mínimo para provas de Supply (dentro do SAVEPOINT). */
export async function proofProject({ one }, { org, actor }, tag) {
  const id = `proj-${tag}`;
  await one(`INSERT INTO public.projects (id, organization_id, project, created_by)
    VALUES ($1, $2, $3, $4) RETURNING id`, [id, org, JSON.stringify({ id, nome: `Projeto ${tag}`, cliente: 'Prova Supply', status: 'em_andamento' }), actor]);
  return id;
}

/** Item de catálogo para provas. */
export async function proofItem({ one }, { org, actor }, code, unit = 'm') {
  return (await one('SELECT public.supply_item_upsert($1,$2,$3) r', [org, actor,
    JSON.stringify({ code, description: `Item ${code}`, unit, category: 'Cabos' })])).r.item_id;
}

/** Requisito de material CONFIRMADO (item + quantidade + data). */
export async function confirmedMaterial({ one }, { org, actor }, projectId, itemId, quantity, requiredBy = '2026-11-18') {
  const req = (await one('SELECT public.project_requirement_upsert($1,$2,$3) r', [org, actor, JSON.stringify({
    project_id: projectId, requirement_type: 'MATERIAL', title: 'Material de prova', quantity, item_id: itemId,
    required_by: requiredBy })])).r;
  await one('SELECT public.project_requirement_transition($1,$2,$3,$4,$5,$6) r', [org, actor, req.requirement_id, 'CONFIRMED', null, null]);
  return req.requirement_id;
}
