-- ============================================================================
-- 245 — ALERTA DE ASO: DESTINATÁRIOS DO SERVIDOR
--
-- `/api/workforce/aso-alerts` (POST) recebia do navegador a lista de e-mails e
-- mandava a eles o resumo de vencimento de ASO — nomes, lotação e situação de
-- exame ocupacional, dado de saúde — sem validar endereço, sem teto, sem
-- inquilino. A rota passa a aceitar só referências a MEMBROS; este diretório
-- diz quem pode receber: vínculo ATIVO na organização, e-mail confirmado e a
-- própria permissão de ver dado sensível de pessoas (quem recebe o resumo
-- identificado precisa poder vê-lo na tela). Só servidor.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.aso_alert_member_directory(p_organization_id uuid)
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
     AND public.payroll_actor_can(p_organization_id, om.user_id, 'people.view_sensitive_data')
   ORDER BY 2;
$$;
REVOKE ALL ON FUNCTION public.aso_alert_member_directory(uuid) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.aso_alert_member_directory(uuid) IS
  'Destinatários do alerta de ASO: vínculo ACTIVE, e-mail confirmado e people.view_sensitive_data na organização (245). Só servidor.';

COMMIT;
