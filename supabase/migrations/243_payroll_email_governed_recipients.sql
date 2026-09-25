-- ============================================================================
-- 243 — E-MAIL DA FOLHA: DESTINATÁRIOS GOVERNADOS, ENVIO IDEMPOTENTE
--
-- ─── O defeito ────────────────────────────────────────────────────────────
--
-- `/api/payroll/email/send` recebia do navegador remetente, destinatários,
-- cc, bcc, assunto, HTML e anexos em base64 — e repassava ao provedor. Quem
-- tinha `people.payroll_send` mandava qualquer conteúdo, para qualquer
-- endereço, com o remetente que escolhesse: um relay de e-mail.
--
-- ─── O que esta migration traz ────────────────────────────────────────────
--
-- A correção mora na aplicação (a rota passa a aceitar só uma intenção tipada
-- e o servidor gera assunto, corpo e anexos). O banco traz as duas peças que
-- a intenção referencia:
--
--   • payroll_email_contacts — os endereços de FORA da organização (a
--     contabilidade, a caixa da diretoria) que o fechamento pode receber.
--     Membro ativo é destinatário por natureza; endereço externo só depois de
--     cadastrado por quem administra a folha (`people.payroll_admin`), com
--     autoria. O navegador lê (quem envia precisa escolher) e não escreve; o
--     endereço de um contato não muda — revoga-se e cadastra-se outro.
--   • payroll_email_packages.request_id — a chave da intenção de envio. O
--     mesmo clique repetido (duplo clique, nova tentativa) é o MESMO pacote e
--     as mesmas chaves de idempotência no provedor: um e-mail, não dois.
--   • payroll_email_member_directory(org) — os membros com vínculo ATIVO na
--     organização (não o perfil de origem): quem foi desligado deixa de ser
--     destinatário no mesmo instante. Só servidor.
--   • As tabelas da folha passam a ser escritas SÓ pelo servidor. A 018 dava
--     escrita direta (FOR ALL) a quem tinha `people.payroll_close`, e a revisão
--     adversarial mostrou o custo: uma linha de anexo forjada pelo navegador
--     apontava o download do servidor (service role) para qualquer objeto do
--     armazenamento, e a narrativa do e-mail podia ser reescrita direto no
--     banco. Nenhum código do navegador escreve nessas tabelas — toda escrita
--     passa pelas rotas da folha (repositório no servidor) ou pelo conector do
--     eSocial (servidor). A leitura pela RLS continua como estava.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.payroll_email_contacts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email          text NOT NULL,
  display_name   text NOT NULL,
  created_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  revoked_at     timestamptz,
  revoked_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  revoke_reason  text,
  CONSTRAINT payroll_email_contacts_org_id_key UNIQUE (organization_id, id),
  -- Caixa simples: sem espaço, aspas, vírgula, ponto e vírgula ou quebra de linha.
  CONSTRAINT payroll_email_contacts_mailbox CHECK (
    length(email) <= 254 AND email ~ '^[^[:space:]@<>"'';:,\\]+@[^[:space:]@<>"'';:,\\]+\.[^[:space:]@<>"'';:,\\]+$'),
  CONSTRAINT payroll_email_contacts_name CHECK (length(btrim(display_name)) BETWEEN 1 AND 120),
  CONSTRAINT payroll_email_contacts_revocation CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS payroll_email_contacts_active_email
  ON public.payroll_email_contacts (organization_id, lower(email)) WHERE revoked_at IS NULL;

COMMENT ON TABLE public.payroll_email_contacts IS
  'Endereços externos autorizados a receber o fechamento da folha, por organização. '
  'Cadastro e revogação só pelo servidor, com people.payroll_admin; o endereço é imutável (243).';

-- O endereço, o dono e a autoria não mudam; só a revogação (uma vez).
CREATE OR REPLACE FUNCTION public.payroll_email_contacts_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.display_name IS DISTINCT FROM OLD.display_name
     OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'PAYROLL_CONTACT_IMMUTABLE: o contato não muda — revogue e cadastre outro.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'PAYROLL_CONTACT_REVOKED: contato já revogado.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS payroll_email_contacts_guard ON public.payroll_email_contacts;
CREATE TRIGGER payroll_email_contacts_guard
  BEFORE UPDATE ON public.payroll_email_contacts
  FOR EACH ROW EXECUTE FUNCTION public.payroll_email_contacts_guard();

ALTER TABLE public.payroll_email_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payroll_email_contacts_select ON public.payroll_email_contacts;
CREATE POLICY payroll_email_contacts_select ON public.payroll_email_contacts
FOR SELECT TO authenticated
USING (
  organization_id = public.current_user_organization_id()
  AND (public.current_user_is_admin()
       OR public.current_user_has_permission('people.payroll_send')
       OR public.current_user_has_permission('people.payroll_admin'))
);

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.payroll_email_contacts FROM authenticated, anon;
REVOKE ALL ON public.payroll_email_contacts FROM anon;

-- ─── Intenção de envio idempotente ───────────────────────────────────────
ALTER TABLE public.payroll_email_packages ADD COLUMN IF NOT EXISTS request_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS payroll_email_packages_request
  ON public.payroll_email_packages (organization_id, request_id) WHERE request_id IS NOT NULL;

COMMENT ON COLUMN public.payroll_email_packages.request_id IS
  'Chave da intenção de envio (243): a mesma intenção repetida é o mesmo pacote e o mesmo e-mail.';

-- ─── Diretório de membros: vínculo ATIVO, organização ATIVA ──────────────
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
   ORDER BY 2;
$$;
REVOKE ALL ON FUNCTION public.payroll_email_member_directory(uuid) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.payroll_email_member_directory(uuid) IS
  'Destinatários-membro do e-mail da folha: vínculo ACTIVE na organização (243). Só servidor.';

-- ─── Tabelas da folha: escrita só do servidor ────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT c.relname FROM pg_class c
            WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relname LIKE 'payroll\_%'
  LOOP
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.%I FROM authenticated, anon', t);
  END LOOP;
END $$;

COMMIT;
