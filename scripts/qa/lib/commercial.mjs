/**
 * O ponto de partida comercial das provas no QA isolado: um pacote PT + PC
 * LIDO, aprovado, enviado e ACEITO pelo cliente, com o trabalho autorizado —
 * pelas funções governadas do Comercial (domínio já provado), com o titular
 * como ator. É daqui que a OS nasce; o resto do caminho é da prova.
 *
 * `one(sql, params)` executa no banco do QA (o chamador já passou pelo guarda).
 */
const J = (x) => JSON.stringify(x);

/** Um fato lido da proposta, com página e trecho — como a leitura grava. */
export const packageFact = (revisionId, context, domain, label, extra = {}) => ({
  subject_kind: 'proposal_revision', subject_id: revisionId, document_context: context, fact_domain: domain, label,
  value_text: extra.value_text ?? label, source_page: extra.page ?? 2, source_quote: extra.quote ?? `“${label}”`,
  confidence: 0.92, extraction_method: 'ai', ai_provider: 'qa', ai_model: 'qa-scenario', ai_pipeline_version: 'qa.v1', ...extra,
});

/** Os fatos típicos da PT: escopo, entregável, dependência do cliente, exclusão e o material principal. */
export const baseFacts = (scope, deliverable, dependency, material) => (rev) => [
  packageFact(rev, 'TECHNICAL_PROPOSAL', 'SCOPE', scope, { page: 3 }),
  packageFact(rev, 'TECHNICAL_PROPOSAL', 'DELIVERABLE', deliverable, { page: 7 }),
  packageFact(rev, 'TECHNICAL_PROPOSAL', 'DEPENDENCY', dependency, { page: 9 }),
  packageFact(rev, 'TECHNICAL_PROPOSAL', 'EXCLUSION', 'Obras civis de terceiros não incluídas', { page: 9 }),
  packageFact(rev, 'TECHNICAL_PROPOSAL', 'RESOURCE', material.label,
    { value_numeric: material.qty, unit: material.unit, value_text: `${material.qty} ${material.unit}`, page: 11 }),
];

/** Pacote aceito + trabalho autorizado pela proposta aceita. Devolve o aceite (de onde a OS nasce) e o trabalho. */
export async function acceptedPackage(one, { org, owner }, { code, title, customer, value, facts }) {
  const act = async (fn, ...args) => (await one(`SELECT public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')}) r`, args)).r;
  const create = (payload) => act('commercial_proposal_create', org, owner, J(payload));
  const pt = await create({ proposal_number: `PT-${code}`, kind: 'TECHNICAL', title, counterparty_name: customer });
  const pc = await create({ proposal_number: `PC-${code}`, kind: 'COMMERCIAL', counterparty_name: customer, total_value: String(value),
    currency: 'BRL', context_proposal_id: pt.proposal_id });
  for (const f of facts(pt.revision_id)) await one('SELECT public.commercial_fact_record($1,$2) id', [org, J(f)]);
  await one('SELECT public.commercial_fact_record($1,$2) id', [org, J(packageFact(pc.revision_id, 'COMMERCIAL_PROPOSAL', 'VALUE', 'Valor global',
    { value_numeric: value, currency: 'BRL', value_text: null, page: 1 }))]);
  for (const to of ['INTERNAL_REVIEW', 'INTERNALLY_APPROVED', 'SENT']) {
    await act('commercial_proposal_context_transition', org, owner, pt.proposal_id, to);
  }
  await act('commercial_proposal_context_record_outcome', org, owner, pc.proposal_id, 'ACCEPTED',
    J({ acceptance_source: 'purchase_order', acceptance_external_ref: `PED-${code}` }));
  const acceptance = await one(`SELECT id FROM public.commercial_proposal_context_acceptances WHERE organization_id = $1 AND context_id = $2
    ORDER BY created_at DESC LIMIT 1`, [org, pt.proposal_id]);
  const eng = (await one('SELECT public.commercial_engagement_create($1,$2,$3::jsonb) id', [org, owner,
    J({ title, counterparty_name: customer, currency: 'BRL' })])).id;
  await one('SELECT public.commercial_engagement_attach_authorization($1,$2,$3,$4::jsonb) r', [org, owner, eng,
    J({ source_kind: 'accepted_proposal', proposal_revision_id: pc.revision_id, authorized_value: value, currency: 'BRL' })]);
  await one('SELECT public.commercial_engagement_authorize($1,$2,$3,$4) r', [org, owner, eng, 'Pedido de compra do cliente']);
  return { acceptanceId: acceptance.id, engagementId: eng, pt, pc };
}
