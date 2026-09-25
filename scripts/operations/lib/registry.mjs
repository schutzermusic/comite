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
  '233': {
    tables: ['inventory_locations', 'inventory_movements', 'inventory_reservations', 'inventory_transfers',
      'inventory_transfer_lines', 'inventory_counts', 'inventory_count_lines'],
    ledgers: ['inventory_movements'],
    functions: [
      'inventory_location_upsert(uuid,uuid,jsonb)', 'inventory_adjust(uuid,uuid,jsonb)', 'inventory_reserve(uuid,uuid,jsonb)',
      'inventory_release(uuid,uuid,uuid,numeric,text)', 'inventory_issue_to_project(uuid,uuid,jsonb)',
      'inventory_return_from_project(uuid,uuid,jsonb)', 'inventory_transfer_request(uuid,uuid,jsonb)',
      'inventory_transfer_approve(uuid,uuid,uuid)', 'inventory_transfer_dispatch(uuid,uuid,uuid,jsonb)',
      'inventory_transfer_receive(uuid,uuid,uuid,jsonb)', 'inventory_transfer_close(uuid,uuid,uuid,text)',
      'inventory_transfer_cancel(uuid,uuid,uuid,text)', 'inventory_count_open(uuid,uuid,jsonb)',
      'inventory_count_record(uuid,uuid,uuid,jsonb)', 'inventory_count_post(uuid,uuid,uuid,text)',
      'inventory_count_cancel(uuid,uuid,uuid,text)',
    ],
    permissions: [],
  },
  '234': {
    tables: ['supplier_profiles', 'procurement_approval_authorities', 'purchase_requisitions', 'purchase_requisition_lines',
      'purchase_requisition_line_requirements', 'procurement_rfqs', 'procurement_rfq_lines', 'procurement_rfq_suppliers',
      'supplier_quotes', 'supplier_quote_lines', 'sourcing_decisions', 'purchase_orders', 'purchase_order_lines',
      'purchase_order_line_requirements', 'purchase_order_history'],
    ledgers: ['sourcing_decisions', 'purchase_order_history'],
    functions: [
      'supplier_register(uuid,uuid,jsonb)', 'supplier_set_status(uuid,uuid,uuid,text,text)',
      'procurement_authority_declare(uuid,uuid,jsonb)', 'procurement_authority_revoke(uuid,uuid,uuid,text)',
      'purchase_requisition_from_shortage(uuid,uuid,jsonb)', 'purchase_requisition_create_manual(uuid,uuid,jsonb)',
      'purchase_requisition_cancel(uuid,uuid,uuid,text)', 'procurement_rfq_create(uuid,uuid,jsonb)',
      'procurement_quote_record(uuid,uuid,jsonb)', 'procurement_decide(uuid,uuid,jsonb)',
      'purchase_order_update_draft(uuid,uuid,uuid,jsonb)', 'purchase_order_submit(uuid,uuid,uuid,text)',
      'purchase_order_decide(uuid,uuid,uuid,text,text)', 'purchase_order_apply_approval(uuid)',
      'purchase_order_issue(uuid,uuid,uuid)', 'purchase_order_cancel(uuid,uuid,uuid,text)',
    ],
    permissions: ['procurement.authorities.manage'],
  },
  '235': {
    tables: ['inbound_shipments', 'goods_receipts', 'goods_receipt_lines', 'goods_receipt_line_requirements', 'goods_receipt_evidence'],
    ledgers: ['goods_receipt_line_requirements', 'goods_receipt_evidence'],
    functions: [
      'inbound_shipment_record(uuid,uuid,jsonb)', 'goods_receipt_post(uuid,uuid,jsonb)', 'goods_receipt_inspect(uuid,uuid,uuid,jsonb)',
      'goods_receipt_attach_evidence(uuid,uuid,uuid,jsonb)', 'purchase_order_close(uuid,uuid,uuid,text)',
    ],
    permissions: [],
  },
  '236': {
    tables: ['supply_signals', 'supply_signal_history', 'supply_intelligence_runs'],
    ledgers: ['supply_signal_history'],
    functions: [
      'supply_signals_sync(uuid,jsonb,text)', 'supply_signal_dismiss(uuid,uuid,uuid,text)',
      'supply_signal_execute(uuid,uuid,uuid,jsonb)', 'supply_signal_link_followup(uuid,uuid,uuid,uuid)',
    ],
    permissions: [],
  },
  // 237/238: sem tabela nova; as funções reescritas continuam negadas ao navegador.
  '237': {
    tables: [],
    ledgers: [],
    functions: [
      'operations_require(uuid,uuid,text[])', 'procurement_authority_for_order(uuid,uuid,uuid)',
      'apex_event_routes_activate_for(text[])', 'purchase_order_reconcile_approvals(uuid,integer)',
      'purchase_order_submit(uuid,uuid,uuid,text)', 'purchase_order_cancel(uuid,uuid,uuid,text)',
    ],
    permissions: [],
  },
  '238': { tables: [], ledgers: [], functions: ['goods_receipt_post(uuid,uuid,jsonb)', 'inventory_reserve(uuid,uuid,jsonb)'], permissions: [] },
  // 239: reparo das guardas do motor (RPCs do motor seguem executáveis pelo navegador, por desenho — provadas em apply-239).
  '239': { tables: [], ledgers: [], functions: [], permissions: [] },
  // 240: Decisões — núcleo só servidor; as portas `*_for_viewer` são do navegador e ficam FORA desta lista.
  '240': {
    tables: ['decision_deliveries', 'notification_channel_integrations', 'user_notification_preferences'],
    ledgers: [],
    functions: [
      'decision_today(uuid)', 'decision_po_submission(uuid,uuid)', 'decision_po_timing(uuid,uuid)',
      'decision_po_approvers(uuid,uuid)', 'decision_engine_subject_live(uuid,text,uuid,uuid)',
      'decision_engine_stage_assignees(uuid,uuid,integer)', 'decision_inbox(uuid,uuid)', 'decision_resolve(uuid,text)',
      'decision_assignees(uuid,text)', 'decision_open_all(uuid)', 'decision_history(uuid,uuid,integer)',
      'decision_purchase_order_act(uuid,uuid,uuid,integer,text,text,text)', 'decision_channel_initial_state(uuid,uuid,text)',
      'decision_notices_plan(uuid,text,text,text)', 'decision_keys_for_event(uuid)', 'decision_deliveries_claim(uuid,integer,integer)',
      'decision_delivery_record(uuid,uuid,text,text,text,text,text,text)', 'decision_delivery_in_app(uuid,uuid,text,text,text)',
      'decision_delivery_mark_delivered(text,text,timestamp with time zone)', 'decision_deliveries_maintain(uuid)',
      'decision_sweep_plan(uuid)', 'decisions_enqueue_sweep(timestamp with time zone)',
      'notification_channel_set(uuid,uuid,text,text,text,text,text,jsonb)', 'notification_preference_set(uuid,uuid,text,boolean,text)',
    ],
    permissions: ['decisions.team.view', 'notifications.channels.manage'],
  },
  // 241: endurecimento — mesmas funções de núcleo, reescritas; a porta decision_viewer_reads_subject muda de assinatura.
  '241': { tables: [], ledgers: [], functions: ['decision_keys_for_event(uuid)', 'decision_notices_plan(uuid,text,text,text)',
    'decision_resolve(uuid,text)'], permissions: [] },
  // 242: notificações — leitura só no inquilino ativo, sem escrita do navegador; as portas
  // notification_mark_read/mark_all_read/dismiss e create_notification são do navegador, por desenho.
  '242': { tables: ['notifications'], ledgers: [], functions: ['create_notification_for(uuid,uuid,text,text,text,text)',
    'notification_recipient_is_active_member(uuid,uuid)'], permissions: [] },
  // 243: contatos externos do e-mail da folha — leitura governada, escrita só do servidor.
  '243': { tables: ['payroll_email_contacts'], ledgers: [], functions: ['payroll_email_member_directory(uuid)'], permissions: [] },
  // 244: permissão da folha na organização pedida — só servidor.
  '244': { tables: [], ledgers: [], functions: ['payroll_actor_can(uuid,uuid,text)', 'payroll_email_member_directory(uuid)'], permissions: [] },
};

/** Portas do navegador de Decisões: identidade de auth.uid(), sem parâmetro de ator — liberadas de propósito. */
export const BROWSER_DOORS = new Set(['decision_inbox_for_viewer', 'decision_inbox_count_for_viewer', 'decision_history_for_viewer',
  'decision_team_scope_for_viewer', 'decision_team_for_viewer', 'decision_access_for_viewer', 'decision_viewer_reads_subject',
  'decision_engine_actions', 'decision_category', 'decision_reason_required', 'decision_notice_channels']);

export function registryUpTo(version) {
  const out = { tables: [], ledgers: [], functions: [], permissions: [], versions: [] };
  for (const [v, entry] of Object.entries(OPERATIONS_REGISTRY)) {
    if (Number(v) > Number(version)) continue;
    out.versions.push(v);
    for (const k of ['tables', 'ledgers', 'functions', 'permissions']) out[k].push(...(entry[k] ?? []));
  }
  return out;
}
