-- =============================================================================
-- 253 · Número de documento do Supply sem colisão (requisição, cotação, pedido,
--       embarque, recebimento e transferência)
-- =============================================================================
-- O defeito (medido no QA em 26/09/2026):
--   `procurement_number(prefixo)` (234) e o gerador em linha de `inventory_transfer_request`
--   sorteiam 5 dígitos hexadecimais por dia: 2^20 números por inquilino, prefixo e dia, sem
--   nova tentativa. O índice único (organization_id, número) impede duplicata — mas o documento
--   que sorteia um número já usado CAI (23505) e leva junto a transação inteira do usuário.
--   A chance por criação é k/2^20 (k = documentos do mesmo prefixo no dia, no inquilino); a de
--   ao menos uma queda no dia cresce com k². Com 478 requisições no dia, 6 000 criações pelo
--   caminho governado, em 6 sessões concorrentes, caíram 6 a 8 vezes em `preqn_number_unique`
--   e duas vezes em impasse (40P01): duas transações em voo com o número uma da outra esperam o
--   índice único uma da outra. Não é corrida de leitura-e-escrita (o sorteio não lê nada): é
--   colisão aleatória, e a concorrência só muda a forma da queda (espera → 23505, ou impasse).
--
-- A correção: guarda BEFORE INSERT genérica nas seis tabelas numeradas.
--   1. `pg_try_advisory_xact_lock` na chave (tabela, inquilino, número) — NUNCA espera: se outra
--      transação está gravando o mesmo número agora, sorteia outro. Sem espera, sem impasse.
--   2. Com a chave na mão, o número já gravado (e confirmado) no inquilino também é trocado.
--   3. Até 50 sorteios (com 2^20 números por dia, inalcançável na prática); depois, erro claro.
-- Quem cria continua igual: todos gravam com `RETURNING * INTO` e leem o número da linha
-- gravada — a troca é transparente. O formato (PREFIXO-AAMMDD-XXXXX) não muda.
-- A trava fica até o fim da transação (a linha só é visível aos outros depois do COMMIT); em
-- READ COMMITTED, a consulta da guarda vê o número confirmado por quem terminou antes.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.supply_document_number_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_col text := TG_ARGV[0];
  v_num text := to_jsonb(NEW)->>TG_ARGV[0];
  v_prefix text;
  v_taken boolean;
  v_try integer := 0;
BEGIN
  IF v_num IS NULL OR NEW.organization_id IS NULL THEN RETURN NEW; END IF;
  v_prefix := split_part(v_num, '-', 1);
  LOOP
    -- Número em voo noutra transação: não espera, sorteia outro (a trava da própria transação volta verdadeira).
    IF pg_try_advisory_xact_lock(hashtextextended(format('supply-number:%s:%s:%s', TG_TABLE_NAME, NEW.organization_id, v_num), 0)) THEN
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I.%I WHERE organization_id = $1 AND %I = $2)', TG_TABLE_SCHEMA, TG_TABLE_NAME, v_col)
         INTO v_taken USING NEW.organization_id, v_num;
      EXIT WHEN NOT v_taken;
    END IF;
    v_try := v_try + 1;
    IF v_try > 50 THEN
      RAISE EXCEPTION 'Could not allocate a free % number for this tenant today.', v_prefix USING ERRCODE = '23505';
    END IF;
    v_num := public.procurement_number(v_prefix);
  END LOOP;
  IF v_num IS DISTINCT FROM to_jsonb(NEW)->>v_col THEN
    NEW := jsonb_populate_record(NEW, jsonb_build_object(v_col, v_num));
  END IF;
  RETURN NEW;
END $$;
COMMENT ON FUNCTION public.supply_document_number_guard() IS
  'Guarda BEFORE INSERT dos números de documento do Supply (253): número em voo noutra transação ou já gravado no inquilino é trocado por outro sorteio de procurement_number(prefixo), sem esperar trava — nenhuma criação cai por colisão de número, nenhuma espera, nenhum impasse.';

CREATE TRIGGER preqn_number_guard BEFORE INSERT ON public.purchase_requisitions
  FOR EACH ROW EXECUTE FUNCTION public.supply_document_number_guard('requisition_number');
CREATE TRIGGER rfq_number_guard BEFORE INSERT ON public.procurement_rfqs
  FOR EACH ROW EXECUTE FUNCTION public.supply_document_number_guard('rfq_number');
CREATE TRIGGER po_number_guard BEFORE INSERT ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.supply_document_number_guard('order_number');
CREATE TRIGGER ship_number_guard BEFORE INSERT ON public.inbound_shipments
  FOR EACH ROW EXECUTE FUNCTION public.supply_document_number_guard('shipment_number');
CREATE TRIGGER grc_number_guard BEFORE INSERT ON public.goods_receipts
  FOR EACH ROW EXECUTE FUNCTION public.supply_document_number_guard('receipt_number');
CREATE TRIGGER invtr_number_guard BEFORE INSERT ON public.inventory_transfers
  FOR EACH ROW EXECUTE FUNCTION public.supply_document_number_guard('transfer_number');

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['public.supply_document_number_guard()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END $$;

COMMIT;
