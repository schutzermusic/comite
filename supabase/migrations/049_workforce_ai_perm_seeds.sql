-- ============================================================
-- INTELIGÊNCIA — Workforce AI permission seed
-- Migration: 049_workforce_ai_perm_seeds
--
-- Data-only, idempotent. Seeds people.ai_insights, used by the
-- Fase 8 intelligence cockpit and enforced at the API route level
-- (/api/ai/workforce-insights). The deterministic engine (simulador,
-- forecast) is gated in the UI by people.allocations_view; the LLM
-- narrative requires this dedicated permission (custo/token control).
--
-- Roles: owner_admin / ceo_diretoria / gestor_projetos / rh.
-- ============================================================
BEGIN;

INSERT INTO public.permissions (key, module, action, description) VALUES
  ('people.ai_insights', 'people', 'ai_insights', 'Gerar insights de IA sobre capacidade, alocacao e custo')
ON CONFLICT (key) DO NOTHING;

WITH r AS (
  SELECT id FROM public.roles
  WHERE organization_id IS NULL
    AND key IN ('owner_admin','ceo_diretoria','gestor_projetos','rh')
),
p AS (
  SELECT id FROM public.permissions WHERE key = 'people.ai_insights'
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM r, p
ON CONFLICT DO NOTHING;

COMMIT;
