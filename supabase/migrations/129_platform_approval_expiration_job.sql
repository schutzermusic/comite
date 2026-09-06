-- ============================================================
-- PLATAFORMA — expiração de aprovação como TRABALHO DURÁVEL
-- Migration: 129_platform_approval_expiration_job
--
-- ─── Por que existe uma migration a mais ───────────────────────────────────
--
-- A 127 entregou a expiração correta e completa em SEMÂNTICA: uma decisão
-- depois do prazo é recusada na hora, sem depender de agendador nenhum. O que
-- faltou nela foi o ponto de entrada por INQUILINO.
--
-- `approval_requests_expire_due` varre a plataforma inteira, e `apex_jobs`
-- exige `organization_id NOT NULL` em cada trabalho — o que é o desenho certo
-- da Fase 4, não um obstáculo. Sem uma função por inquilino, o único jeito de
-- ligar a expiração à fila seria enfileirar um trabalho "global" com o
-- inquilino de alguém, e essa mentira estrutural apareceria no primeiro
-- relatório por organização.
--
-- A 127 já está aplicada, e migration aplicada é registro. Corrige-se com
-- arquivo novo, como a 123 e a 124 fizeram.
--
-- ─── O que a expiração NÃO é ───────────────────────────────────────────────
--
-- Não é rejeição. Rejeitado é um parecer que alguém deu; expirado é a ausência
-- de parecer dentro do prazo. Relatar um como o outro mentiria sobre o que a
-- organização decidiu — e é por isso que os dois são estados distintos, com
-- eventos distintos, desde a 126.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 1) Varredura por inquilino
-- ------------------------------------------------------------
CREATE FUNCTION public.approval_requests_expire_due_for_org(
  p_organization_id uuid,
  p_limit integer DEFAULT 500
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r record; n integer := 0;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'Expiração sem organização.' USING ERRCODE = 'check_violation';
  END IF;
  -- A lição da 124: `LIMIT NULL` é "sem limite" no Postgres, e uma guarda que
  -- deixa NULL passar não é guarda.
  IF p_limit IS NULL OR p_limit <= 0 THEN
    RAISE EXCEPTION 'Limite de expiração inválido.' USING ERRCODE = 'check_violation';
  END IF;

  FOR r IN
    SELECT id FROM public.approval_requests
     WHERE organization_id = p_organization_id
       AND status = 'PENDING'
       AND expires_at IS NOT NULL AND expires_at <= now()
     ORDER BY expires_at
     LIMIT p_limit
  LOOP
    IF public.approval_request_expire(r.id) THEN n := n + 1; END IF;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.approval_requests_expire_due_for_org(uuid, integer)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.approval_requests_expire_due_for_org(uuid, integer) IS
  'Materializa a expiração de UM inquilino. Idempotente: só toca pedido '
  'PENDING cujo prazo já passou, e um pedido já expirado devolve false.';

-- ------------------------------------------------------------
-- 2) Produtor
-- ------------------------------------------------------------
/*
  A chave de idempotência é (organização, HORA), e a hora é deliberada.

  O relógio como chave criaria um trabalho a cada passagem do agendador — 144
  por dia e por inquilino, quase todos sem nada a fazer. O DIA como chave, no
  outro extremo, deixaria a projeção desatualizada por até 24 horas.

  A hora é o meio-termo defensável porque a EXATIDÃO não depende dela: quem
  garante que ninguém decide depois do prazo é a recusa dentro de
  `approval_decide`, que não espera pelo agendador. O que este trabalho faz é
  só materializar a projeção — atrasá-la em minutos não concede autoridade a
  ninguém.
*/
CREATE FUNCTION public.approval_enqueue_expiration(p_as_of timestamptz DEFAULT now())
RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE org record; n integer := 0;
BEGIN
  FOR org IN
    SELECT DISTINCT organization_id FROM public.approval_requests
     WHERE status = 'PENDING' AND expires_at IS NOT NULL AND expires_at <= p_as_of
  LOOP
    PERFORM public.apex_jobs_enqueue(
      org.organization_id,
      'platform.approvals.expire',
      'approval-expire:' || org.organization_id::text || ':' || to_char(p_as_of, 'YYYY-MM-DD"T"HH24'),
      jsonb_build_object('as_of', to_char(p_as_of, 'YYYY-MM-DD"T"HH24:MI:SSOF')),
      1, now(), 5, NULL, NULL);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.approval_enqueue_expiration(timestamptz)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.approval_enqueue_expiration(timestamptz) IS
  'Enfileira a expiração APENAS para inquilinos que têm pedido vencido. '
  'Chave por (organização, hora): o relógio como chave criaria 144 trabalhos '
  'por dia e por inquilino, quase todos sem nada a fazer.';

COMMIT;
