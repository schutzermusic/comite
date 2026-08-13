-- ============================================================
-- INSIGHT eSOCIAL — contagens da auditoria técnica em SQL
-- Migration: 086_esocial_audit_counts
--
-- O painel "Controle eSocial" precisa de três agrupamentos sobre
-- `esocial_events`: quantos eventos por tipo, quantos por competência e de que
-- software/versão vieram. O PostgREST não faz GROUP BY, então a primeira
-- versão da rota paginava o acervo INTEIRO para dentro do Node e contava lá.
--
-- Funciona com milhares de eventos e para de funcionar com centenas de
-- milhares: um acervo de 200 mil eventos são ~200 requisições ao banco e
-- dezenas de MB atravessando a rede para produzir três tabelinhas de contagem.
--
-- Uma ida ao banco, três agregados. A função é STABLE e SEM SECURITY DEFINER:
-- quem a chama é o service role, e a permissão do usuário é conferida antes,
-- na rota (`resolvePayrollActor`).
-- ============================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.esocial_audit_counts(p_organization_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    -- Eventos por tipo, com em quantas competências distintas cada um aparece.
    'byType', (
      SELECT coalesce(jsonb_agg(t ORDER BY t.event_type), '[]'::jsonb) FROM (
        SELECT event_type,
               count(*)::bigint                        AS total,
               count(DISTINCT competence)::bigint      AS competences,
               max(received_at)                        AS last_received_at
        FROM public.esocial_events
        WHERE organization_id = p_organization_id
        GROUP BY event_type
      ) t
    ),

    -- Procedência declarada no ideEvento. Guardada no metadata jsonb pela
    -- ingestão (e preenchida retroativamente pela reapuração).
    'byOrigin', (
      SELECT coalesce(jsonb_agg(o ORDER BY o.total DESC), '[]'::jsonb) FROM (
        SELECT metadata -> 'origin' ->> 'procEmi'  AS proc_emi,
               metadata -> 'origin' ->> 'verProc'  AS ver_proc,
               count(*)::bigint                    AS total,
               count(DISTINCT competence)::bigint  AS competences
        FROM public.esocial_events
        WHERE organization_id = p_organization_id
          AND event_type <> 'RETORNO-LOTE'
        GROUP BY 1, 2
      ) o
    ),

    -- Eventos por competência, para a grade de cobertura.
    'byCompetence', (
      SELECT coalesce(jsonb_agg(c ORDER BY c.competence), '[]'::jsonb) FROM (
        SELECT competence, count(*)::bigint AS total
        FROM public.esocial_events
        WHERE organization_id = p_organization_id
          AND competence IS NOT NULL
          AND event_type <> 'RETORNO-LOTE'
        GROUP BY competence
      ) c
    )
  );
$$;

REVOKE ALL ON FUNCTION public.esocial_audit_counts(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.esocial_audit_counts(uuid) TO service_role;

-- Sustenta os três GROUP BY acima sem varrer a tabela inteira.
CREATE INDEX IF NOT EXISTS esocial_events_audit_idx
  ON public.esocial_events (organization_id, event_type, competence);

COMMENT ON FUNCTION public.esocial_audit_counts(uuid) IS
  'Agregados do painel Controle eSocial em uma ida ao banco. Substitui a paginação do acervo inteiro para dentro do Node, que não escala além de algumas dezenas de milhares de eventos.';

COMMIT;
