-- ============================================================
-- CONTRACTS V2 · FASE 1.2 — PERMISSÕES DE PARTY
-- Migration: 103_parties_perm_seeds
--
-- Data-only, idempotente (mesmo padrão de 013/061). Semeia `parties.*` e
-- concede aos papéis de sistema.
--
-- O PRINCÍPIO DA CONCESSÃO
--
-- Nenhum papel ganha autoridade que já não exercia na prática. Antes desta
-- fase, cadastro de contraparte era feito digitando texto livre no contrato ou
-- inserindo linha em `client`/`supplier` — as mesmas pessoas, sem controle
-- nenhum. A matriz abaixo apenas dá nome ao que já acontecia:
--
--   owner_admin        -> todas
--   juridico_contratos -> view + create + edit   (é quem cadastra contraparte
--                         ao criar contrato; já tem contracts.create/edit)
--   financeiro         -> view + create + edit   (já tinha finance.edit, e
--                         `supplier`/`client` sempre foram cadastro dele)
--   ceo_diretoria      -> view
--   gestor_projetos    -> view
--
-- `parties.delete` fica SÓ com owner_admin. Apagar uma party referenciada por
-- outro registro é operação que a chave estrangeira já recusa; apagar uma não
-- referenciada ainda é destruir cadastro, e destruir não é a mesma autoridade
-- que criar — o mesmo raciocínio que a 099 aplicou a `supplier`.
--
-- Ninguém precisa de `parties.view` para ENXERGAR contraparte: a política de
-- SELECT da 102 já aceita `contracts.view` e `finance.view`. Esta permissão
-- existe para um papel futuro que só mexa com cadastro, sem ver contratos —
-- semeá-la agora custa uma linha e evita ter que reabrir a política depois.
-- ============================================================
BEGIN;

-- 1) Seed permissions
INSERT INTO public.permissions (key, module, action, description) VALUES
  ('parties.view',   'parties', 'view',   'Visualizar o cadastro canônico de contrapartes'),
  ('parties.create', 'parties', 'create', 'Cadastrar nova contraparte canônica'),
  ('parties.edit',   'parties', 'edit',   'Corrigir cadastro de contraparte e atribuir/remover papéis'),
  ('parties.delete', 'parties', 'delete', 'Excluir cadastro de contraparte (não referenciado)')
ON CONFLICT (key) DO NOTHING;

-- 2) owner_admin -> todas
WITH r AS (
  SELECT id FROM public.roles WHERE key = 'owner_admin' AND organization_id IS NULL
),
p AS (
  SELECT id FROM public.permissions
   WHERE key IN ('parties.view','parties.create','parties.edit','parties.delete')
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM r, p
ON CONFLICT DO NOTHING;

-- 3) juridico_contratos -> cadastra e corrige (não apaga)
WITH r AS (
  SELECT id FROM public.roles WHERE key = 'juridico_contratos' AND organization_id IS NULL
),
p AS (
  SELECT id FROM public.permissions
   WHERE key IN ('parties.view','parties.create','parties.edit')
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM r, p
ON CONFLICT DO NOTHING;

-- 4) financeiro -> cadastra e corrige (não apaga)
WITH r AS (
  SELECT id FROM public.roles WHERE key = 'financeiro' AND organization_id IS NULL
),
p AS (
  SELECT id FROM public.permissions
   WHERE key IN ('parties.view','parties.create','parties.edit')
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM r, p
ON CONFLICT DO NOTHING;

-- 5) ceo_diretoria e gestor_projetos -> leitura
WITH r AS (
  SELECT id FROM public.roles
   WHERE key IN ('ceo_diretoria','gestor_projetos') AND organization_id IS NULL
),
p AS (
  SELECT id FROM public.permissions WHERE key = 'parties.view'
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM r, p
ON CONFLICT DO NOTHING;

-- 6) Verificação — papel de sistema ausente é erro de premissa, não detalhe
--
-- As CTEs acima falham em SILÊNCIO quando o papel não existe: o produto
-- cartesiano fica vazio e nenhuma linha é inserida. Sem esta checagem, um papel
-- renomeado produziria uma migration "bem-sucedida" que não concedeu nada.
DO $$
DECLARE
  faltando text;
  n_perms  integer;
BEGIN
  SELECT string_agg(k, ', ') INTO faltando
    FROM (VALUES ('owner_admin'),('juridico_contratos'),('financeiro'),
                 ('ceo_diretoria'),('gestor_projetos')) AS want(k)
   WHERE NOT EXISTS (
     SELECT 1 FROM public.roles r WHERE r.key = want.k AND r.organization_id IS NULL
   );

  IF faltando IS NOT NULL THEN
    RAISE EXCEPTION
      E'[103] Papel de sistema ausente: %.\n'
      '       As concessões acima assumem os papéis semeados pela 005. Se o conjunto mudou,\n'
      '       a matriz de acesso precisa ser decidida de novo, não silenciosamente reduzida.', faltando;
  END IF;

  SELECT count(*) INTO n_perms FROM public.permissions WHERE key LIKE 'parties.%';
  RAISE NOTICE '[103] % permissão(ões) parties.* registradas e concedidas.', n_perms;
END $$;

COMMIT;
