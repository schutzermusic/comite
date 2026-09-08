-- ============================================================
-- Fase 7.5 — 148: ÂNCORA EMPRESARIAL AUTOMÁTICA
-- ============================================================
--
-- ─── O que a 145 quebrou, e por quê ──────────────────────────────────────
--
-- A 145 tornou `organizations.enterprise_account_id` NOT NULL. A intenção está
-- certa — toda organização pertence a exatamente uma conta empresarial — mas a
-- consequência não foi antecipada: TODO caminho que insere organização sem
-- passar pela RPC de provisionamento passou a falhar. Nove suítes vivas
-- (Fases 0, 1, 1.5, 2, 7 e as de Motor de Aprovação, Event Graph e Medição)
-- criam organizações descartáveis com `INSERT INTO organizations (name, slug)`.
--
-- Havia duas saídas. Reescrever nove suítes para ensiná-las um conceito que não
-- é objeto de nenhuma delas — e arriscar enfraquecer provas da Fase 7 no
-- caminho. Ou fazer o esquema honrar o invariante sozinho.
--
-- ─── Por que o gatilho NÃO é invenção de autoridade ──────────────────────
--
-- A conta criada aqui nasce SEM nenhum vínculo empresarial. Ninguém ganha
-- autoridade de provisionamento por causa dela: `current_user_can_provision_organizations()`
-- pergunta por `enterprise_account_memberships`, e essa conta não tem nenhum.
--
-- Ela é o caso de uma organização que é, ela mesma, o próprio grupo — que é
-- exatamente o que a organização de produção era antes desta fase, e é o
-- agrupamento mais SEGURO possível: isolamento máximo por omissão. Agrupar
-- organizações num mesmo grupo continua exigindo ato explícito.
--
-- O provisionamento governado (147) não passa por aqui: ele informa a conta,
-- conferida contra a autoridade de quem chama.
-- ============================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.organizations_anchor_enterprise_account()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE ea uuid; candidate text; n int := 0;
BEGIN
  IF NEW.enterprise_account_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  /*
    O slug precisa ser único e a organização pode não ter um ainda no momento
    do BEFORE INSERT — daí o laço curto em vez de um `'ea-' || slug` cru, que
    colidiria com a conta de uma organização homônima já existente.
  */
  candidate := 'ea-' || coalesce(nullif(NEW.slug, ''), replace(NEW.id::text, '-', ''));
  WHILE EXISTS (SELECT 1 FROM public.enterprise_accounts WHERE slug = candidate) AND n < 50 LOOP
    n := n + 1;
    candidate := 'ea-' || coalesce(nullif(NEW.slug, ''), replace(NEW.id::text, '-', '')) || '-' || n::text;
  END LOOP;

  INSERT INTO public.enterprise_accounts (name, slug, status, created_by)
  VALUES (NEW.name, candidate, 'ACTIVE', NEW.created_by)
  RETURNING id INTO ea;

  NEW.enterprise_account_id := ea;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.organizations_anchor_enterprise_account() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS organizations_anchor_enterprise_trg ON public.organizations;
CREATE TRIGGER organizations_anchor_enterprise_trg
  BEFORE INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.organizations_anchor_enterprise_account();

COMMIT;
