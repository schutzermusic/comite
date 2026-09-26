-- =============================================================================
-- 254 · Quantidades e valores do Supply sempre FINITOS (sem NaN nem ±Infinity)
-- =============================================================================
-- O defeito (revisão adversarial final, 26/09/2026): o tipo `numeric` do PostgreSQL aceita 'NaN', 'Infinity' e
-- '-Infinity' — e as checagens de sinal não os barram: NaN passa em `quantidade > 0` (NaN é maior que qualquer
-- número) e passa num CHECK (quantidade > 0). Pelas funções governadas, a prova (sempre desfeita) gravou:
--   - movimento de estoque de NaN, +Infinity e -Infinity (`inventory_adjust`) — no livro-razão, que é só de
--     acréscimo: NaN + x = NaN, e nenhum movimento compensatório conserta o saldo depois;
--   - requisito com quantidade NaN; requisição com quantidade NaN/Infinity e preço NaN; proposta com preço,
--     frete e imposto NaN/Infinity; alçada de compra com teto NaN (NaN >= qualquer valor: alçada ilimitada);
--     recebimento com rejeitado NaN; contagem com NaN/Infinity.
-- As rotas HTTP não deixam chegar (todas usam z.coerce.number().finite()), e as funções só executam pelo
-- service role — então é defesa em profundidade: o banco é a autoridade dos invariantes (reclamado ≤ requerido,
-- pedido ≤ aberto, recebido ≤ pedido) e todos eles se desfazem com NaN.
--
-- A correção: CHECK "finito" em toda coluna numeric das tabelas do Supply (vazio continua permitido onde já era).
-- Em NaN, `x <> 'NaN'` é falso (no numeric, NaN = NaN); em ±Infinity, os limites abertos são falsos.
-- O QA não tem nenhum valor não finito hoje (conferido coluna a coluna): as restrições nascem validadas.
-- =============================================================================

BEGIN;

ALTER TABLE public.goods_receipt_line_requirements ADD CONSTRAINT goods_receipt_line_requirements_quantity_finite
  CHECK (quantity IS NULL OR (quantity <> 'NaN'::numeric AND quantity > '-Infinity'::numeric AND quantity < 'Infinity'::numeric));
ALTER TABLE public.goods_receipt_lines ADD CONSTRAINT goods_receipt_lines_accepted_quantity_finite
  CHECK (accepted_quantity IS NULL OR (accepted_quantity <> 'NaN'::numeric AND accepted_quantity > '-Infinity'::numeric AND accepted_quantity < 'Infinity'::numeric));
ALTER TABLE public.goods_receipt_lines ADD CONSTRAINT goods_receipt_lines_rejected_quantity_finite
  CHECK (rejected_quantity IS NULL OR (rejected_quantity <> 'NaN'::numeric AND rejected_quantity > '-Infinity'::numeric AND rejected_quantity < 'Infinity'::numeric));
ALTER TABLE public.goods_receipt_lines ADD CONSTRAINT goods_receipt_lines_inspection_approved_quantity_finite
  CHECK (inspection_approved_quantity IS NULL OR (inspection_approved_quantity <> 'NaN'::numeric AND inspection_approved_quantity > '-Infinity'::numeric AND inspection_approved_quantity < 'Infinity'::numeric));
ALTER TABLE public.goods_receipt_lines ADD CONSTRAINT goods_receipt_lines_inspection_rejected_quantity_finite
  CHECK (inspection_rejected_quantity IS NULL OR (inspection_rejected_quantity <> 'NaN'::numeric AND inspection_rejected_quantity > '-Infinity'::numeric AND inspection_rejected_quantity < 'Infinity'::numeric));
ALTER TABLE public.inventory_count_lines ADD CONSTRAINT inventory_count_lines_expected_quantity_finite
  CHECK (expected_quantity IS NULL OR (expected_quantity <> 'NaN'::numeric AND expected_quantity > '-Infinity'::numeric AND expected_quantity < 'Infinity'::numeric));
ALTER TABLE public.inventory_count_lines ADD CONSTRAINT inventory_count_lines_counted_quantity_finite
  CHECK (counted_quantity IS NULL OR (counted_quantity <> 'NaN'::numeric AND counted_quantity > '-Infinity'::numeric AND counted_quantity < 'Infinity'::numeric));
ALTER TABLE public.inventory_movements ADD CONSTRAINT inventory_movements_quantity_finite
  CHECK (quantity IS NULL OR (quantity <> 'NaN'::numeric AND quantity > '-Infinity'::numeric AND quantity < 'Infinity'::numeric));
ALTER TABLE public.inventory_reservations ADD CONSTRAINT inventory_reservations_quantity_finite
  CHECK (quantity IS NULL OR (quantity <> 'NaN'::numeric AND quantity > '-Infinity'::numeric AND quantity < 'Infinity'::numeric));
ALTER TABLE public.inventory_reservations ADD CONSTRAINT inventory_reservations_consumed_quantity_finite
  CHECK (consumed_quantity IS NULL OR (consumed_quantity <> 'NaN'::numeric AND consumed_quantity > '-Infinity'::numeric AND consumed_quantity < 'Infinity'::numeric));
ALTER TABLE public.inventory_reservations ADD CONSTRAINT inventory_reservations_released_quantity_finite
  CHECK (released_quantity IS NULL OR (released_quantity <> 'NaN'::numeric AND released_quantity > '-Infinity'::numeric AND released_quantity < 'Infinity'::numeric));
ALTER TABLE public.inventory_transfer_lines ADD CONSTRAINT inventory_transfer_lines_quantity_finite
  CHECK (quantity IS NULL OR (quantity <> 'NaN'::numeric AND quantity > '-Infinity'::numeric AND quantity < 'Infinity'::numeric));
ALTER TABLE public.inventory_transfer_lines ADD CONSTRAINT inventory_transfer_lines_dispatched_quantity_finite
  CHECK (dispatched_quantity IS NULL OR (dispatched_quantity <> 'NaN'::numeric AND dispatched_quantity > '-Infinity'::numeric AND dispatched_quantity < 'Infinity'::numeric));
ALTER TABLE public.inventory_transfer_lines ADD CONSTRAINT inventory_transfer_lines_received_quantity_finite
  CHECK (received_quantity IS NULL OR (received_quantity <> 'NaN'::numeric AND received_quantity > '-Infinity'::numeric AND received_quantity < 'Infinity'::numeric));
ALTER TABLE public.procurement_approval_authorities ADD CONSTRAINT procurement_approval_authorities_max_amount_finite
  CHECK (max_amount IS NULL OR (max_amount <> 'NaN'::numeric AND max_amount > '-Infinity'::numeric AND max_amount < 'Infinity'::numeric));
ALTER TABLE public.procurement_coverage_exceptions ADD CONSTRAINT procurement_coverage_exceptions_shortage_qty_finite
  CHECK (shortage_qty IS NULL OR (shortage_qty <> 'NaN'::numeric AND shortage_qty > '-Infinity'::numeric AND shortage_qty < 'Infinity'::numeric));
ALTER TABLE public.procurement_coverage_exceptions ADD CONSTRAINT procurement_coverage_exceptions_requested_qty_finite
  CHECK (requested_qty IS NULL OR (requested_qty <> 'NaN'::numeric AND requested_qty > '-Infinity'::numeric AND requested_qty < 'Infinity'::numeric));
ALTER TABLE public.procurement_coverage_exceptions ADD CONSTRAINT procurement_coverage_exceptions_pending_transfer_qty_finite
  CHECK (pending_transfer_qty IS NULL OR (pending_transfer_qty <> 'NaN'::numeric AND pending_transfer_qty > '-Infinity'::numeric AND pending_transfer_qty < 'Infinity'::numeric));
ALTER TABLE public.procurement_coverage_exceptions ADD CONSTRAINT procurement_coverage_exceptions_purchasable_qty_finite
  CHECK (purchasable_qty IS NULL OR (purchasable_qty <> 'NaN'::numeric AND purchasable_qty > '-Infinity'::numeric AND purchasable_qty < 'Infinity'::numeric));
ALTER TABLE public.procurement_coverage_exceptions ADD CONSTRAINT procurement_coverage_exceptions_requisitioned_qty_finite
  CHECK (requisitioned_qty IS NULL OR (requisitioned_qty <> 'NaN'::numeric AND requisitioned_qty > '-Infinity'::numeric AND requisitioned_qty < 'Infinity'::numeric));
ALTER TABLE public.procurement_requisition_releases ADD CONSTRAINT procurement_requisition_releases_quantity_finite
  CHECK (quantity IS NULL OR (quantity <> 'NaN'::numeric AND quantity > '-Infinity'::numeric AND quantity < 'Infinity'::numeric));
ALTER TABLE public.procurement_rfq_lines ADD CONSTRAINT procurement_rfq_lines_quantity_finite
  CHECK (quantity IS NULL OR (quantity <> 'NaN'::numeric AND quantity > '-Infinity'::numeric AND quantity < 'Infinity'::numeric));
ALTER TABLE public.project_requirements ADD CONSTRAINT project_requirements_quantity_finite
  CHECK (quantity IS NULL OR (quantity <> 'NaN'::numeric AND quantity > '-Infinity'::numeric AND quantity < 'Infinity'::numeric));
ALTER TABLE public.project_requirements ADD CONSTRAINT project_requirements_ai_confidence_finite
  CHECK (ai_confidence IS NULL OR (ai_confidence <> 'NaN'::numeric AND ai_confidence > '-Infinity'::numeric AND ai_confidence < 'Infinity'::numeric));
ALTER TABLE public.purchase_order_line_requirements ADD CONSTRAINT purchase_order_line_requirements_quantity_finite
  CHECK (quantity IS NULL OR (quantity <> 'NaN'::numeric AND quantity > '-Infinity'::numeric AND quantity < 'Infinity'::numeric));
ALTER TABLE public.purchase_order_line_requirements ADD CONSTRAINT purchase_order_line_requirements_received_quantity_finite
  CHECK (received_quantity IS NULL OR (received_quantity <> 'NaN'::numeric AND received_quantity > '-Infinity'::numeric AND received_quantity < 'Infinity'::numeric));
ALTER TABLE public.purchase_order_lines ADD CONSTRAINT purchase_order_lines_quantity_finite
  CHECK (quantity IS NULL OR (quantity <> 'NaN'::numeric AND quantity > '-Infinity'::numeric AND quantity < 'Infinity'::numeric));
ALTER TABLE public.purchase_order_lines ADD CONSTRAINT purchase_order_lines_unit_price_finite
  CHECK (unit_price IS NULL OR (unit_price <> 'NaN'::numeric AND unit_price > '-Infinity'::numeric AND unit_price < 'Infinity'::numeric));
ALTER TABLE public.purchase_order_lines ADD CONSTRAINT purchase_order_lines_received_quantity_finite
  CHECK (received_quantity IS NULL OR (received_quantity <> 'NaN'::numeric AND received_quantity > '-Infinity'::numeric AND received_quantity < 'Infinity'::numeric));
ALTER TABLE public.purchase_orders ADD CONSTRAINT purchase_orders_freight_amount_finite
  CHECK (freight_amount IS NULL OR (freight_amount <> 'NaN'::numeric AND freight_amount > '-Infinity'::numeric AND freight_amount < 'Infinity'::numeric));
ALTER TABLE public.purchase_orders ADD CONSTRAINT purchase_orders_tax_amount_finite
  CHECK (tax_amount IS NULL OR (tax_amount <> 'NaN'::numeric AND tax_amount > '-Infinity'::numeric AND tax_amount < 'Infinity'::numeric));
ALTER TABLE public.purchase_requisition_line_requirements ADD CONSTRAINT purchase_requisition_line_requirements_quantity_finite
  CHECK (quantity IS NULL OR (quantity <> 'NaN'::numeric AND quantity > '-Infinity'::numeric AND quantity < 'Infinity'::numeric));
ALTER TABLE public.purchase_requisition_lines ADD CONSTRAINT purchase_requisition_lines_quantity_finite
  CHECK (quantity IS NULL OR (quantity <> 'NaN'::numeric AND quantity > '-Infinity'::numeric AND quantity < 'Infinity'::numeric));
ALTER TABLE public.purchase_requisition_lines ADD CONSTRAINT purchase_requisition_lines_estimated_unit_price_finite
  CHECK (estimated_unit_price IS NULL OR (estimated_unit_price <> 'NaN'::numeric AND estimated_unit_price > '-Infinity'::numeric AND estimated_unit_price < 'Infinity'::numeric));
ALTER TABLE public.supplier_quote_lines ADD CONSTRAINT supplier_quote_lines_unit_price_finite
  CHECK (unit_price IS NULL OR (unit_price <> 'NaN'::numeric AND unit_price > '-Infinity'::numeric AND unit_price < 'Infinity'::numeric));
ALTER TABLE public.supplier_quote_lines ADD CONSTRAINT supplier_quote_lines_quantity_finite
  CHECK (quantity IS NULL OR (quantity <> 'NaN'::numeric AND quantity > '-Infinity'::numeric AND quantity < 'Infinity'::numeric));
ALTER TABLE public.supplier_quotes ADD CONSTRAINT supplier_quotes_freight_amount_finite
  CHECK (freight_amount IS NULL OR (freight_amount <> 'NaN'::numeric AND freight_amount > '-Infinity'::numeric AND freight_amount < 'Infinity'::numeric));
ALTER TABLE public.supplier_quotes ADD CONSTRAINT supplier_quotes_tax_amount_finite
  CHECK (tax_amount IS NULL OR (tax_amount <> 'NaN'::numeric AND tax_amount > '-Infinity'::numeric AND tax_amount < 'Infinity'::numeric));

COMMIT;
