-- 095: corrige a policy de SELECT de `contracts` para permitir o soft delete.
--
-- Bug: `contracts_select_scoped` (006/007) exige `deleted_at IS NULL` para
-- QUALQUER leitura. O Postgres RLS avalia essa mesma policy de SELECT sobre a
-- linha resultante de um UPDATE (mesmo sem RETURNING) — é assim que ele
-- garante que a linha modificada continua "visível" para quem a modificou.
-- Como `softDeleteContract` faz `UPDATE contracts SET deleted_at = now()`, a
-- linha nova nunca satisfaz `deleted_at IS NULL`, e o Postgres rejeita com
-- "new row violates row-level security policy for table contracts" — mesmo
-- para owner_admin com contracts.delete/contracts.edit concedidas.
--
-- Fix: a policy de SELECT passa a ter dois ramos —
--   1) linha ativa (deleted_at IS NULL) + permissão de visualização normal;
--   2) linha já soft-deletada, visível apenas para quem tem contracts.delete
--      (o mesmo ator que está autorizado a excluir).
-- O ramo 2 é o que faltava para o UPDATE de soft delete completar.

DROP POLICY IF EXISTS contracts_select_scoped ON contracts;
CREATE POLICY contracts_select_scoped ON contracts
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
    (
      deleted_at IS NULL
      AND (
        current_user_has_permission('contracts.view')
        OR current_user_has_permission('contracts.approve')
        OR (
          current_user_has_permission('projects.view_assigned')
          AND EXISTS (
            SELECT 1 FROM projects p
            WHERE p.id = contracts.project_id
              AND (p.project -> 'responsavel' ->> 'id') = auth.uid()::text
          )
        )
      )
    )
    OR (
      deleted_at IS NOT NULL
      AND current_user_has_permission('contracts.delete')
    )
  )
);
