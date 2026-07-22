-- ============================================================
-- INSIGHT PONTO — explicit "requires attendance" flag on allocation
-- Migration: 071_allocation_requires_ponto
--
-- Nem toda alocação ativa exige registro de ponto. Este campo torna a
-- exigência EXPLÍCITA por alocação (a tabela projects é JSONB, então o
-- campo relacional vive na alocação, onde a reconciliação já consulta).
-- Default false para registros existentes — nada é auto-provisionado sem
-- marcação deliberada.
-- ============================================================
BEGIN;

ALTER TABLE public.project_allocations
  ADD COLUMN IF NOT EXISTS requires_ponto boolean NOT NULL DEFAULT false;

-- índice parcial p/ a reconciliação varrer só o que exige ponto
CREATE INDEX IF NOT EXISTS project_allocations_requires_ponto_idx
  ON public.project_allocations (organization_id, status)
  WHERE requires_ponto = true;

COMMIT;

-- ============================================================
-- Rollback (manual):
--   DROP INDEX IF EXISTS project_allocations_requires_ponto_idx;
--   ALTER TABLE project_allocations DROP COLUMN IF EXISTS requires_ponto;
-- ============================================================
