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

/** Outro usuário do inquilino com `procurement.approve` por PAPEL (para a segregação de funções). */
export async function secondApprover({ one }, { org, actor }) {
  return one(`SELECT DISTINCT ur.user_id, ur.role_id FROM public.user_roles ur
    WHERE ur.organization_id = $1 AND ur.user_id <> $2 AND public.apex_actor_has_permission($1, ur.user_id, 'procurement.approve')
      AND EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions p ON p.id = rp.permission_id
                   WHERE rp.role_id = ur.role_id AND p.key = 'procurement.approve') LIMIT 1`, [org, actor]);
}

/**
 * Pedido de compra EMITIDO pelo caminho governado inteiro: falta → requisição
 * → cotação → proposta → decisão → alçada declarada → aprovação por outra
 * pessoa → emissão. `prices` mapeia item → preço unitário; `quantities`
 * (opcional) mapeia item → quantidade da proposta (proposta PARCIAL); sem ela,
 * a proposta cota a quantidade da linha da cotação, como sempre.
 */
export async function issuedPurchaseOrder(ctx, anchors, { tag, requirementIds, prices, deliveryLocationId, leadTimeDays = 10, quantities = {} }) {
  const { one, all } = ctx; const { org, actor } = anchors;
  const J = (x) => JSON.stringify(x);
  const act = async (fn, ...args) => (await one(`SELECT public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')}) r`, args)).r;
  const supplier = (await act('supplier_register', org, actor, J({ legal_name: `Fornecedor ${tag}` }))).supplier_id;
  await act('supplier_set_status', org, actor, supplier, 'HOMOLOGATED', null);
  const rc = await act('purchase_requisition_from_shortage', org, actor, J({ requirement_ids: requirementIds }));
  const reqLines = await all(`SELECT id FROM public.purchase_requisition_lines WHERE requisition_id = $1`, [rc.requisition_id]);
  const rfq = await act('procurement_rfq_create', org, actor, J({ requisition_line_ids: reqLines.map((l) => l.id), supplier_ids: [supplier] }));
  const rfqLines = await all(`SELECT id, item_id FROM public.procurement_rfq_lines WHERE rfq_id = $1`, [rfq.rfq_id]);
  const quote = await act('procurement_quote_record', org, actor, J({ rfq_id: rfq.rfq_id, supplier_id: supplier, lead_time_days: leadTimeDays,
    validity_date: '2099-01-01', lines: rfqLines.map((l) => ({ rfq_line_id: l.id, unit_price: prices[l.item_id] ?? 1,
      ...(quantities[l.item_id] != null ? { quantity: quantities[l.item_id] } : {}) })) }));
  const dec = await act('procurement_decide', org, actor, J({ rfq_id: rfq.rfq_id, quote_id: quote.quote_id, rationale: `Prova ${tag}: única proposta.` }));
  const po = dec.purchase_order_id;
  await act('purchase_order_update_draft', org, actor, po, J({ delivery_location_id: deliveryLocationId }));
  await act('purchase_order_submit', org, actor, po, null);
  const approver = await secondApprover(ctx, anchors);
  if (!approver) throw new Error('Sem segundo aprovador no inquilino de prova.');
  await act('procurement_authority_declare', org, actor, J({ grantee_kind: 'ROLE', grantee_role_id: approver.role_id,
    source_kind: 'BOARD_RESOLUTION', source_reference: `ATA-${tag}`, justification: 'Prova' }));
  await act('purchase_order_decide', org, approver.user_id, po, 'APPROVE', 'Prova');
  await act('purchase_order_issue', org, actor, po);
  const lines = await all(`SELECT id, item_id, quantity::float q FROM public.purchase_order_lines WHERE purchase_order_id = $1`, [po]);
  return { poId: po, supplierId: supplier, approver, lineOf: Object.fromEntries(lines.map((l) => [l.item_id, l.id])) };
}

/** Fornecedor cadastrado e HOMOLOGADO (pode ser convidado para cotação). */
export async function homologatedSupplier({ one }, { org, actor }, tag) {
  const J = (x) => JSON.stringify(x);
  const supplier = (await one('SELECT public.supplier_register($1,$2,$3) r', [org, actor, J({ legal_name: `Fornecedor ${tag}` })])).r.supplier_id;
  await one('SELECT public.supplier_set_status($1,$2,$3,$4,$5) r', [org, actor, supplier, 'HOMOLOGATED', null]);
  return supplier;
}

/** Até onde `purchaseOrderFromLines` leva o pedido, na ordem do caminho governado. */
const ORDER_STAGES = ['QUOTED', 'DRAFT', 'APPROVAL_REQUIRED', 'APPROVED', 'ISSUED'];

/**
 * Pedido de compra a partir de linhas de requisição JÁ existentes, pelo mesmo
 * caminho governado de `issuedPurchaseOrder` (cotação → proposta → decisão →
 * rascunho com local de entrega → submissão → alçada → aprovação por outra
 * pessoa → emissão), parando em `until` (QUOTED | DRAFT | APPROVAL_REQUIRED |
 * APPROVED | ISSUED).
 *
 * `quantities` mapeia linha de requisição OU item → quantidade da proposta
 * (proposta PARCIAL; a chave da linha vence a do item); sem chave, a proposta
 * cota a quantidade da linha da cotação. Com `only`, a proposta cota SÓ as
 * linhas citadas em `quantities` (a outra fica sem preço).
 *
 * Devolve os ids e as respostas das funções (a da decisão e a da emissão
 * inteiras, com os números como o driver os entrega — quantidade exata se lê do
 * banco como texto).
 */
export async function purchaseOrderFromLines(ctx, anchors, { tag, lineIds, supplierId, quantities = {}, only = false, prices = {},
  deliveryLocationId, leadTimeDays = 10, until = 'ISSUED' }) {
  const { one, all } = ctx; const { org, actor } = anchors;
  const J = (x) => JSON.stringify(x);
  const act = async (fn, ...args) => (await one(`SELECT public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')}) r`, args)).r;
  const stage = ORDER_STAGES.indexOf(until);
  if (stage < 0) throw new Error(`Estágio desconhecido: ${until}.`);
  const supplier = supplierId ?? await homologatedSupplier(ctx, anchors, tag);
  const rfq = await act('procurement_rfq_create', org, actor, J({ requisition_line_ids: lineIds, supplier_ids: [supplier] }));
  const rfqLines = await all(`SELECT id, item_id, requisition_line_id FROM public.procurement_rfq_lines WHERE rfq_id = $1`, [rfq.rfq_id]);
  const quantityOf = (l) => quantities[l.requisition_line_id] ?? quantities[l.item_id];
  const quote = await act('procurement_quote_record', org, actor, J({ rfq_id: rfq.rfq_id, supplier_id: supplier, lead_time_days: leadTimeDays,
    validity_date: '2099-01-01', lines: rfqLines.filter((l) => !only || quantityOf(l) != null).map((l) => ({ rfq_line_id: l.id,
      unit_price: prices[l.item_id] ?? 5, ...(quantityOf(l) != null ? { quantity: quantityOf(l) } : {}) })) }));
  const out = { rfqId: rfq.rfq_id, rfqNumber: rfq.rfq_number, quoteId: quote.quote_id, supplierId: supplier };
  if (stage < ORDER_STAGES.indexOf('DRAFT')) return out;
  out.decision = await act('procurement_decide', org, actor, J({ rfq_id: rfq.rfq_id, quote_id: quote.quote_id, rationale: `Prova ${tag}: única proposta.` }));
  out.poId = out.decision.purchase_order_id;
  out.orderNumber = out.decision.order_number;
  await act('purchase_order_update_draft', org, actor, out.poId, J({ delivery_location_id: deliveryLocationId }));
  if (stage < ORDER_STAGES.indexOf('APPROVAL_REQUIRED')) return out;
  out.submitted = await act('purchase_order_submit', org, actor, out.poId, null);
  if (stage < ORDER_STAGES.indexOf('APPROVED')) return out;
  const approver = await secondApprover(ctx, anchors);
  if (!approver) throw new Error('Sem segundo aprovador no inquilino de prova.');
  await act('procurement_authority_declare', org, actor, J({ grantee_kind: 'ROLE', grantee_role_id: approver.role_id,
    source_kind: 'BOARD_RESOLUTION', source_reference: `ATA-${tag}`, justification: 'Prova' }));
  await act('purchase_order_decide', org, approver.user_id, out.poId, 'APPROVE', 'Prova');
  if (stage < ORDER_STAGES.indexOf('ISSUED')) return out;
  out.issued = await act('purchase_order_issue', org, actor, out.poId);
  return out;
}
