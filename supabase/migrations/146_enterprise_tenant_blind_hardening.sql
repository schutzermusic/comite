-- ============================================================
-- Fase 7.5 — 146: AS TABELAS QUE NÃO SABIAM DE QUEM SÃO
-- ============================================================
--
-- ─── O que a auditoria encontrou ─────────────────────────────────────────
--
-- Das 387 políticas RLS, 25 não mencionam organização. A maior parte delas é
-- legítima (a pessoa vê a própria notificação, o próprio desafio WebAuthn). Sete
-- não são: um resto do módulo financeiro antigo cujas tabelas NÃO TÊM coluna de
-- organização nenhuma.
--
--     allocation_result      sem organization_id   protegida só por papel
--     allocation_rule        sem organization_id   protegida só por papel
--     attachment             sem organization_id   SELECT USING (true)
--     category_mapping       sem organization_id   SELECT USING (true)
--     ingestion_batch        sem organization_id   protegida só por papel
--     payroll_batch          sem organization_id   protegida só por papel
--     user_finance_role      sem organization_id   papel financeiro GLOBAL
--
-- Com um inquilino só, "protegida por papel" e "protegida por inquilino" davam
-- no mesmo. Com dois, não dão: `has_finance_role('finance_admin')` responde
-- verdadeiro para o analista de QUALQUER organização, e `attachment` com
-- `USING (true)` entrega anexo de todo mundo a qualquer autenticado.
--
-- `user_finance_role` é a raiz: enquanto o papel financeiro for global, ele
-- atravessa organização por construção.
--
-- ─── O estado real dos dados ─────────────────────────────────────────────
--
--     allocation_result 0 · allocation_rule 0 · attachment 0
--     ingestion_batch 0 · payroll_batch 0 · user_finance_role 0
--     category_mapping 5 (dados de referência, do único inquilino que existe)
--
-- Com uma organização só em produção, a atribuição é determinística: tudo que
-- existe é dela. Não há relação ambígua, logo não há motivo para parar (§29).
--
-- ─── Também aqui ─────────────────────────────────────────────────────────
--
-- Quatro funções SECURITY DEFINER alcançáveis pelo navegador não fixavam
-- `search_path`. Numa função DEFINER isso é um caminho de execução com o dono
-- da função — a Fase 0 já tratou disso no resto do banco, e estas quatro
-- ficaram para trás.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 1) Dar organização a quem não tinha
-- ------------------------------------------------------------
ALTER TABLE public.allocation_result  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.allocation_rule    ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.attachment         ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.category_mapping   ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.ingestion_batch    ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.payroll_batch      ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.user_finance_role  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;

/*
  A atribuição só é feita quando ela é DEDUTÍVEL — isto é, quando existe
  exatamente uma organização. Se um dia esta migration rodar num banco com
  duas, ela para: preencher por chute é o que a §29 proíbe, e um NOT NULL
  aplicado sobre um chute transforma o chute em fato.
*/
DO $backfill$
DECLARE only_org uuid; n_orgs int; t text;
BEGIN
  SELECT count(*) INTO n_orgs FROM public.organizations;
  SELECT id INTO only_org FROM public.organizations ORDER BY created_at, id LIMIT 1;

  FOREACH t IN ARRAY ARRAY['allocation_result','allocation_rule','attachment',
                           'category_mapping','ingestion_batch','payroll_batch',
                           'user_finance_role'] LOOP
    IF n_orgs = 1 THEN
      EXECUTE format('UPDATE public.%I SET organization_id = %L WHERE organization_id IS NULL', t, only_org);
    ELSE
      EXECUTE format('SELECT 1 FROM public.%I WHERE organization_id IS NULL LIMIT 1', t);
      IF FOUND THEN
        RAISE EXCEPTION
          'MANUAL_REVIEW: % tem linhas sem organização e há % organizações — atribuição não é dedutível.',
          t, n_orgs;
      END IF;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN organization_id SET NOT NULL', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (organization_id)', t || '_org_idx', t);
  END LOOP;
END $backfill$;

-- `user_finance_role` deixa de ser global: o papel é POR organização.
ALTER TABLE public.user_finance_role DROP CONSTRAINT IF EXISTS user_finance_role_org_user_role_key;
ALTER TABLE public.user_finance_role
  ADD CONSTRAINT user_finance_role_org_user_role_key UNIQUE (organization_id, user_id, role);

-- ------------------------------------------------------------
-- 2) Os auxiliares de papel financeiro passam a ver o inquilino
-- ------------------------------------------------------------
/*
  Um `SET search_path` e um predicado de organização. É a diferença entre
  "esta pessoa é analista financeiro" e "esta pessoa é analista financeiro
  AQUI" — e com duas organizações só a segunda frase é uma autorização.
*/
CREATE OR REPLACE FUNCTION public.has_finance_role(required_role text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_finance_role ufr
     WHERE ufr.user_id = auth.uid()
       AND ufr.role = required_role
       AND ufr.organization_id = public.current_user_organization_id());
$$;

CREATE OR REPLACE FUNCTION public.has_any_finance_role(required_roles text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_finance_role ufr
     WHERE ufr.user_id = auth.uid()
       AND ufr.role = ANY (required_roles)
       AND ufr.organization_id = public.current_user_organization_id());
$$;

CREATE OR REPLACE FUNCTION public.user_business_unit_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE(
    (SELECT array_agg(DISTINCT bu)
       FROM public.user_finance_role ufr,
            LATERAL unnest(COALESCE(ufr.business_unit_ids, '{}'::uuid[])) AS bu
      WHERE ufr.user_id = auth.uid()
        AND ufr.organization_id = public.current_user_organization_id()),
    '{}'::uuid[]);
$$;

/*
  `user_project_ids` lia `project_members` sem `search_path` fixo. A tabela
  pode nem existir — o `to_regclass` original é mantido, agora com o caminho
  fechado e o filtro de inquilino aplicado quando a coluna existir.
*/
CREATE OR REPLACE FUNCTION public.user_project_ids()
RETURNS uuid[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_ids uuid[]; v_has_org boolean;
BEGIN
  IF to_regclass('public.project_members') IS NULL THEN
    RETURN '{}'::uuid[];
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'project_members'
       AND column_name = 'organization_id') INTO v_has_org;

  IF v_has_org THEN
    EXECUTE 'SELECT COALESCE(array_agg(project_id), ''{}'')
               FROM public.project_members
              WHERE user_id = auth.uid()
                AND organization_id = public.current_user_organization_id()'
      INTO v_ids;
  ELSE
    EXECUTE 'SELECT COALESCE(array_agg(project_id), ''{}'')
               FROM public.project_members WHERE user_id = auth.uid()'
      INTO v_ids;
  END IF;

  RETURN COALESCE(v_ids, '{}'::uuid[]);
END $$;

-- ------------------------------------------------------------
-- 3) Políticas: papel E inquilino, nunca papel sozinho
-- ------------------------------------------------------------
/*
  O predicado de organização entra em TODAS elas — inclusive nas duas que
  liam `USING (true)`. `attachment` guardava anexo de qualquer entidade;
  `category_mapping`, o plano de contas gerencial. Nenhum dos dois é público.
*/
DROP POLICY IF EXISTS alloc_select ON public.allocation_result;
DROP POLICY IF EXISTS alloc_write  ON public.allocation_result;
CREATE POLICY alloc_select ON public.allocation_result FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
         AND (public.has_finance_role_or_perm('finance_admin','finance.admin')
           OR public.has_finance_role_or_perm('finance_analyst','finance.edit')
           OR public.has_finance_role_or_perm('auditor','audit.view')));
CREATE POLICY alloc_write ON public.allocation_result FOR ALL TO authenticated
  USING (organization_id = public.current_user_organization_id()
         AND (public.has_finance_role_or_perm('finance_admin','finance.admin')
           OR public.has_finance_role_or_perm('finance_analyst','finance.edit')))
  WITH CHECK (organization_id = public.current_user_organization_id()
         AND (public.has_finance_role_or_perm('finance_admin','finance.admin')
           OR public.has_finance_role_or_perm('finance_analyst','finance.edit')));

DROP POLICY IF EXISTS ar_select ON public.allocation_rule;
DROP POLICY IF EXISTS ar_write  ON public.allocation_rule;
CREATE POLICY ar_select ON public.allocation_rule FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
         AND (public.has_finance_role_or_perm('finance_admin','finance.admin')
           OR public.has_finance_role_or_perm('finance_analyst','finance.edit')
           OR public.has_finance_role_or_perm('auditor','audit.view')));
CREATE POLICY ar_write ON public.allocation_rule FOR ALL TO authenticated
  USING (organization_id = public.current_user_organization_id()
         AND public.has_finance_role_or_perm('finance_admin','finance.admin'))
  WITH CHECK (organization_id = public.current_user_organization_id()
         AND public.has_finance_role_or_perm('finance_admin','finance.admin'));

DROP POLICY IF EXISTS att_select ON public.attachment;
DROP POLICY IF EXISTS att_insert ON public.attachment;
CREATE POLICY att_select ON public.attachment FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id());
CREATE POLICY att_insert ON public.attachment FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.current_user_organization_id()
         AND (public.has_finance_role_or_perm('finance_admin','finance.admin')
           OR public.has_finance_role_or_perm('finance_analyst','finance.edit')
           OR public.has_finance_role('project_manager')));

DROP POLICY IF EXISTS ref_read_cm ON public.category_mapping;
CREATE POLICY ref_read_cm ON public.category_mapping FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id());

DROP POLICY IF EXISTS ib_select ON public.ingestion_batch;
DROP POLICY IF EXISTS ib_write  ON public.ingestion_batch;
CREATE POLICY ib_select ON public.ingestion_batch FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
         AND (public.has_finance_role_or_perm('finance_admin','finance.admin')
           OR public.has_finance_role_or_perm('auditor','audit.view')));
CREATE POLICY ib_write ON public.ingestion_batch FOR ALL TO authenticated
  USING (organization_id = public.current_user_organization_id()
         AND public.has_finance_role_or_perm('finance_admin','finance.admin'))
  WITH CHECK (organization_id = public.current_user_organization_id()
         AND public.has_finance_role_or_perm('finance_admin','finance.admin'));

DROP POLICY IF EXISTS pb_select ON public.payroll_batch;
DROP POLICY IF EXISTS pb_insert ON public.payroll_batch;
DROP POLICY IF EXISTS pb_update ON public.payroll_batch;
CREATE POLICY pb_select ON public.payroll_batch FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
         AND (public.has_finance_role_or_perm('finance_admin','finance.admin')
           OR public.has_finance_role_or_perm('finance_analyst','finance.edit')
           OR public.has_finance_role_or_perm('auditor','audit.view')));
CREATE POLICY pb_insert ON public.payroll_batch FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.current_user_organization_id()
         AND (public.has_finance_role_or_perm('finance_admin','finance.admin')
           OR public.has_finance_role_or_perm('finance_analyst','finance.edit')));
CREATE POLICY pb_update ON public.payroll_batch FOR UPDATE TO authenticated
  USING (organization_id = public.current_user_organization_id()
         AND (public.has_finance_role_or_perm('finance_admin','finance.admin')
           OR public.has_finance_role_or_perm('finance_analyst','finance.edit')))
  WITH CHECK (organization_id = public.current_user_organization_id()
         AND (public.has_finance_role_or_perm('finance_admin','finance.admin')
           OR public.has_finance_role_or_perm('finance_analyst','finance.edit')));

DROP POLICY IF EXISTS ufr_select ON public.user_finance_role;
DROP POLICY IF EXISTS ufr_write  ON public.user_finance_role;
CREATE POLICY ufr_select ON public.user_finance_role FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
         AND (user_id = auth.uid()
           OR public.has_finance_role_or_perm('finance_admin','finance.admin')));
CREATE POLICY ufr_write ON public.user_finance_role FOR ALL TO authenticated
  USING (organization_id = public.current_user_organization_id()
         AND public.has_finance_role_or_perm('finance_admin','finance.admin'))
  WITH CHECK (organization_id = public.current_user_organization_id()
         AND public.has_finance_role_or_perm('finance_admin','finance.admin'));

COMMIT;
