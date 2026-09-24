/**
 * O que a auditoria de Operações e Supply confere — cresce a cada wave.
 *
 *  tables:      tabelas novas (RLS, política de leitura, sem escrita do navegador,
 *               sem leitura anônima, FKs de domínio compostas com organization_id)
 *  ledgers:     livros append-only (UPDATE recusado a todos; DELETE pela regra canônica)
 *  functions:   funções governadas (negadas a anon/authenticated, alcançáveis pelo service_role)
 *  permissions: chaves semeadas e concedidas ao owner_admin
 */
export const OPERATIONS_REGISTRY = {
  '230': {
    tables: ['internal_service_order_items', 'internal_service_order_revisions', 'internal_service_order_issue_exceptions'],
    ledgers: ['internal_service_order_revisions', 'internal_service_order_issue_exceptions'],
    functions: [
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
      'internal_service_order_snapshot(uuid,uuid)',
    ],
    permissions: ['operations.view', 'operations.service_orders.override', 'operations.planning.view',
      'operations.planning.manage'],
  },
  '231': {
    tables: ['project_requirements', 'project_requirement_history'],
    ledgers: ['project_requirement_history'],
    functions: [
      'project_requirement_upsert(uuid,uuid,jsonb)',
      'project_requirement_transition(uuid,uuid,uuid,text,text,uuid)',
      'project_requirement_mark_satisfied(uuid,uuid,uuid,text,uuid,boolean)',
      'project_requirements_import_from_service_order(uuid,uuid,text,uuid)',
    ],
    permissions: [],
  },
  '232': {
    tables: ['supply_items'],
    ledgers: [],
    functions: ['supply_item_upsert(uuid,uuid,jsonb)', 'project_requirement_upsert(uuid,uuid,jsonb)'],
    permissions: ['supply.view', 'supply.plan', 'inventory.view', 'inventory.manage', 'inventory.reserve',
      'procurement.view', 'procurement.request', 'procurement.source', 'procurement.approve', 'procurement.orders.issue',
      'receiving.view', 'receiving.receive', 'suppliers.view', 'suppliers.manage'],
  },
};

export function registryUpTo(version) {
  const out = { tables: [], ledgers: [], functions: [], permissions: [], versions: [] };
  for (const [v, entry] of Object.entries(OPERATIONS_REGISTRY)) {
    if (Number(v) > Number(version)) continue;
    out.versions.push(v);
    for (const k of ['tables', 'ledgers', 'functions', 'permissions']) out[k].push(...(entry[k] ?? []));
  }
  return out;
}
