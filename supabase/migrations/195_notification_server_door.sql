-- ============================================================================
-- 195 — A PORTA DE SERVIDOR DA NOTIFICAÇÃO IN-APP
--
-- ─── O defeito que esta migration corrige ─────────────────────────────────
--
-- `create_notification` (026) resolve a organização por `current_user_
-- organization_id()`, que por sua vez lê `auth.uid()`. Ela funciona
-- perfeitamente para o navegador — e NÃO FUNCIONA para nenhuma rotina de
-- servidor, porque no service role `auth.uid()` é nulo e a função levanta
-- "Usuário sem organização ativa".
--
-- A consequência é concreta e silenciosa: todo handoff entregue por rota de
-- servidor ou por cron registra a notificação in-app como FALHA, e o canal
-- in-app simplesmente não existe para trabalho automatizado. É por e-mail que
-- se descobre, se houver chave de provedor.
--
-- ─── Por que uma porta nova, e não um motor novo ──────────────────────────
--
-- A mesma decisão da 191. A tabela continua sendo `notifications`, a caixa de
-- entrada continua sendo a mesma tela, o vocabulário de `type` continua sendo o
-- do produto. O que muda é UMA coisa: de onde vem a organização.
--
--   `create_notification`      organização = a do CHAMADOR  (navegador)
--   `create_notification_for`  organização = PARÂMETRO      (servidor)
--
-- Alterar a função de 026 para aceitar a organização como parâmetro seria pior:
-- ela é chamável por `authenticated`, e a organização deixaria de ser provada
-- pelo perfil para passar a ser AFIRMADA por quem chama — exatamente o oráculo
-- entre inquilinos que o produto fecha em todo lugar.
--
-- ─── O que a porta nova mantém ────────────────────────────────────────────
--
-- As duas validações que importam: a organização tem de existir, e o
-- destinatário tem de ser membro ATIVO dela. Um usuário que saiu da
-- organização não recebe aviso dela, venha o aviso de onde vier.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.create_notification_for(
  p_organization_id uuid,
  p_recipient       uuid,
  p_type            text,
  p_title           text,
  p_body            text DEFAULT NULL,
  p_link            text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_organization_id IS NULL OR p_recipient IS NULL THEN
    RAISE EXCEPTION 'NOTIFICATION_TARGET_REQUIRED: organização e destinatário são obrigatórios.'
      USING ERRCODE = 'check_violation';
  END IF;

  /*
    Defesa em profundidade, na forma da `emit_domain_event`: a função é revogada
    de `anon` e `authenticated`, então o navegador não a alcança. Se um dia
    alcançar, a organização que ele AFIRMA ter deixa de valer — vale a que o
    perfil dele diz.
  */
  IF current_user IN ('authenticated','anon') THEN
    IF public.current_user_organization_id() IS DISTINCT FROM p_organization_id THEN
      RAISE EXCEPTION 'PERMISSION_DENIED: notificação negada.' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Destinatário precisa ser membro ATIVO do inquilino. Mesma regra da 026, e
  -- ela não é formalidade: é o que impede um aviso com valor de contrato de
  -- chegar a quem já saiu da organização.
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.user_id = p_recipient
       AND p.organization_id = p_organization_id
       AND p.status = 'active'
  ) THEN
    RAISE EXCEPTION 'RECIPIENT_OUTSIDE_ORGANIZATION: destinatário não é membro ativo desta organização.'
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.notifications
    (organization_id, recipient_user_id, type, title, body, link_url)
  VALUES (p_organization_id, p_recipient, p_type, p_title, p_body, p_link)
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.create_notification_for(uuid, uuid, text, text, text, text)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.create_notification_for(uuid, uuid, text, text, text, text) IS
  'A porta de SERVIDOR da notificação in-app: mesma tabela, mesmo vocabulário e '
  'as mesmas validações de create_notification (026), com a organização vindo '
  'por parâmetro porque no service role não existe auth.uid(). Inalcançável '
  'pelo navegador — de propósito.';

COMMIT;
