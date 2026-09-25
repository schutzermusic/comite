-- ============================================================================
-- 244 — E-MAIL DA FOLHA: ENDURECIMENTO APÓS VERIFICAÇÃO ADVERSARIAL
--
-- A 243 fechou o relay (intenção tipada, destinatários governados, tabelas da
-- folha escritas só pelo servidor). A verificação adversarial da 243 achou o
-- que ainda sobrava no mesmo caminho:
--
--   1. MEMBRO virava destinatário só por ter vínculo ativo. O convite do Ponto
--      cria usuário + vínculo ATIVO para o e-mail que estiver no cadastro da
--      pessoa — quem cadastra pessoas conseguia transformar um endereço
--      qualquer em "membro" e mandar a folha para ele, contornando os contatos
--      que só o admin da folha autoriza. Agora membro-destinatário precisa
--      PODER LER A FOLHA naquela organização e ter e-mail confirmado.
--   2. Os BYTES atrás de um anexo podiam ser trocados pelo navegador: a 019
--      dá INSERT/DELETE em storage.objects dos buckets da folha a quem tem
--      `people.payroll_close`. Todo upload real passa pelas rotas da folha
--      (service role) — as políticas de escrita do navegador saem.
--   3. `email_dispatches` (o livro do transporte, que decide quem já recebeu
--      numa nova tentativa) aceitava INSERT do navegador (026): dava para
--      forjar "enviado" e suprimir uma entrega, ou falsificar a auditoria.
--   4. A permissão era checada numa chamada e a organização lida em outra:
--      quem troca de organização entre as duas agia numa organização com a
--      permissão da outra. `payroll_actor_can` checa a permissão NA
--      organização pedida, numa chamada só, e as rotas da folha passam a
--      usá-la com a organização resolvida uma vez.
--   5. O pacote guarda o resumo da intenção: a mesma chave com outra intenção
--      (outros destinatários) é recusada, não reaproveitada.
-- ============================================================================

BEGIN;

-- ─── 4. Permissão numa organização EXPLÍCITA (servidor) ──────────────────
CREATE OR REPLACE FUNCTION public.payroll_actor_can(p_organization_id uuid, p_actor uuid, p_key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.apex_actor_has_permission(p_organization_id, p_actor, p_key)
      OR EXISTS (
        SELECT 1 FROM public.user_roles ur
          JOIN public.roles r ON r.id = ur.role_id AND r.key = 'owner_admin'
          JOIN public.organization_memberships m ON m.user_id = ur.user_id AND m.organization_id = ur.organization_id
          JOIN public.organizations o ON o.id = m.organization_id
         WHERE ur.user_id = p_actor AND ur.organization_id = p_organization_id
           AND m.status = 'ACTIVE' AND o.status = 'active');
$$;
REVOKE ALL ON FUNCTION public.payroll_actor_can(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.payroll_actor_can(uuid, uuid, text) IS
  'Permissão da folha na organização PEDIDA (vínculo ativo + papel/override, ou owner_admin), numa chamada só (244). Só servidor.';

-- ─── 1. Membro-destinatário: lê a folha e tem e-mail confirmado ──────────
CREATE OR REPLACE FUNCTION public.payroll_email_member_directory(p_organization_id uuid)
RETURNS TABLE (user_id uuid, full_name text, email text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT om.user_id, coalesce(nullif(btrim(p.full_name), ''), u.email::text), u.email::text
    FROM public.organization_memberships om
    JOIN public.organizations o ON o.id = om.organization_id AND o.status = 'active'
    JOIN auth.users u ON u.id = om.user_id
    LEFT JOIN public.profiles p ON p.user_id = om.user_id
   WHERE om.organization_id = p_organization_id
     AND om.status = 'ACTIVE'
     AND u.email IS NOT NULL
     AND u.email_confirmed_at IS NOT NULL
     AND (public.payroll_actor_can(p_organization_id, om.user_id, 'people.payroll_view_sensitive')
       OR public.payroll_actor_can(p_organization_id, om.user_id, 'people.payroll_close')
       OR public.payroll_actor_can(p_organization_id, om.user_id, 'people.payroll_admin'))
   ORDER BY 2;
$$;
REVOKE ALL ON FUNCTION public.payroll_email_member_directory(uuid) FROM PUBLIC, anon, authenticated;

-- ─── 2. Armazenamento da folha: escrita só do servidor ───────────────────
DROP POLICY IF EXISTS "payroll-imports_insert" ON storage.objects;
DROP POLICY IF EXISTS "payroll-imports_delete" ON storage.objects;
DROP POLICY IF EXISTS "payroll-holerites_insert" ON storage.objects;
DROP POLICY IF EXISTS "payroll-holerites_delete" ON storage.objects;
DROP POLICY IF EXISTS "payroll-bank-files_insert" ON storage.objects;
DROP POLICY IF EXISTS "payroll-bank-files_delete" ON storage.objects;
DROP POLICY IF EXISTS "payroll-reports_insert" ON storage.objects;
DROP POLICY IF EXISTS "payroll-reports_delete" ON storage.objects;
DROP POLICY IF EXISTS "payroll-supporting-documents_insert" ON storage.objects;
DROP POLICY IF EXISTS "payroll-supporting-documents_delete" ON storage.objects;

-- ─── 3. Livro do transporte de e-mail: escrita só do servidor ────────────
DROP POLICY IF EXISTS email_dispatches_insert ON public.email_dispatches;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.email_dispatches FROM authenticated, anon;

-- ─── 5. Resumo da intenção no pacote ─────────────────────────────────────
ALTER TABLE public.payroll_email_packages ADD COLUMN IF NOT EXISTS intent_digest text;
COMMENT ON COLUMN public.payroll_email_packages.intent_digest IS
  'SHA-256 da intenção de envio (fechamento, público, destinatários, anexos, confirmação) — 244.';

COMMIT;
