-- ============================================================
-- FINANCE — Hierarchical category extension (DRE group → categoria → subcategoria)
-- Migration: 024_finance_category_hierarchy
--
-- Extends the existing 3-level management_category taxonomy (from 001) to support
-- deeper cost analysis WITHOUT renaming or renumbering any existing code/id:
--   • adds requirement flags (requires_contract / requires_cost_center),
--     a human description, optional org scoping and created/updated timestamps;
--   • seeds the new granular subcategories + the Frota / Viagens / Administrativo
--     categories and the granular Tributos lines.
--
-- organization_id is nullable: NULL rows are the GLOBAL shipped defaults shared
-- by every tenant. An org may later clone a row with its own organization_id to
-- customize. The read policy is widened to "global OR own-org" accordingly.
--
-- Conventions follow 021/022: idempotent (IF NOT EXISTS / ON CONFLICT),
-- set_updated_at() trigger from 005, RLS helpers from 002/005.
-- NOTE: clearing categories (group F) are client-only today; the
-- management_group_key enum has no 'clearing' value, so nothing here inserts it.
-- ============================================================
BEGIN;

-- ── 1. COLUMNS ──────────────────────────────────────────────
ALTER TABLE management_category
  ADD COLUMN IF NOT EXISTS organization_id      uuid        REFERENCES organizations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS description          text,
  ADD COLUMN IF NOT EXISTS requires_contract    boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS requires_cost_center boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS created_at           timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at           timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_mc_org ON management_category (organization_id);

-- updated_at trigger (reuse set_updated_at from 005).
DROP TRIGGER IF EXISTS trg_management_category_updated_at ON management_category;
CREATE TRIGGER trg_management_category_updated_at
  BEFORE UPDATE ON management_category
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 2. RLS — widen read to global + own-org ─────────────────
-- (Write policy from 002 — finance_admin — is left untouched.)
DROP POLICY IF EXISTS "ref_read_mc" ON management_category;
CREATE POLICY "ref_read_mc" ON management_category
  FOR SELECT TO authenticated
  USING (organization_id IS NULL OR organization_id = current_user_organization_id());

-- ── 3. SEED: requirement flags on existing leaves ───────────
-- Revenue from contract must carry a contract.
UPDATE management_category SET requires_contract = true WHERE code = 'A.1.1';
-- Mark existing P&L expense leaves as cost-center-required (non-revenue, level 3).
UPDATE management_category
   SET requires_cost_center = true
 WHERE level = 3 AND group_key <> 'revenue' AND requires_cost_center = false;

-- ── 4. SEED: new L2 categories FIRST ────────────────────────
-- Parents must be committed before their L3 children can resolve parent_id.
-- (Subquery parent lookups in a single INSERT cannot see that statement's own
-- not-yet-visible rows, so the new L2s go in their own statement.)
INSERT INTO management_category (code, name, level, parent_id, group_key, sign, requires_project, requires_cost_center, description)
VALUES
  ('B.6', 'Frota',                  2, (SELECT id FROM management_category WHERE code='B'), 'cogs',  -1, false, false, 'Custos da frota própria/locada alocados a obra.'),
  ('C.6', 'Viagens',                2, (SELECT id FROM management_category WHERE code='C'), 'opex',  -1, false, false, 'Viagens corporativas (não-campo).'),
  ('C.7', 'Administrativo',         2, (SELECT id FROM management_category WHERE code='C'), 'opex',  -1, false, false, 'Despesas administrativas gerais.'),
  ('E.4', 'Tributos sobre Folha',   2, (SELECT id FROM management_category WHERE code='E'), 'taxes', -1, false, false, 'Encargos e retenções incidentes sobre a folha.')
ON CONFLICT (code) DO NOTHING;

-- ── 5. SEED: new L3 subcategories ───────────────────────────
INSERT INTO management_category (code, name, level, parent_id, group_key, sign, requires_project, requires_cost_center, description)
VALUES
  -- Mobilização (B.2) granular
  ('B.2.7', 'Diárias',                        3, (SELECT id FROM management_category WHERE code='B.2'), 'cogs', -1, true, true, 'Diárias de viagem/campo pagas à equipe.'),
  ('B.2.8', 'Frete / Transporte de Material', 3, (SELECT id FROM management_category WHERE code='B.2'), 'cogs', -1, true, true, 'Frete e transporte de materiais/equipamentos para o campo.'),
  -- Materiais (B.3) granular
  ('B.3.4', 'Cabos',                          3, (SELECT id FROM management_category WHERE code='B.3'), 'cogs', -1, true, true, NULL),
  ('B.3.5', 'Peças',                          3, (SELECT id FROM management_category WHERE code='B.3'), 'cogs', -1, true, true, NULL),
  ('B.3.6', 'Equipamentos (consumo)',         3, (SELECT id FROM management_category WHERE code='B.3'), 'cogs', -1, true, true, NULL),
  -- Serviços Terceiros (B.4) granular
  ('B.4.4', 'Engenharia',                     3, (SELECT id FROM management_category WHERE code='B.4'), 'cogs', -1, true, true, NULL),
  ('B.4.5', 'Manutenção (terceiros)',         3, (SELECT id FROM management_category WHERE code='B.4'), 'cogs', -1, true, true, NULL),
  -- Frota (B.6)
  ('B.6.1', 'Locação',                        3, (SELECT id FROM management_category WHERE code='B.6'), 'cogs', -1, true, true, NULL),
  ('B.6.2', 'Combustível',                    3, (SELECT id FROM management_category WHERE code='B.6'), 'cogs', -1, true, true, NULL),
  ('B.6.3', 'Manutenção',                     3, (SELECT id FROM management_category WHERE code='B.6'), 'cogs', -1, true, true, NULL),
  ('B.6.4', 'Seguro',                         3, (SELECT id FROM management_category WHERE code='B.6'), 'cogs', -1, true, true, NULL),
  ('B.6.5', 'Pedágio',                        3, (SELECT id FROM management_category WHERE code='B.6'), 'cogs', -1, true, true, NULL),
  -- Viagens (C.6)
  ('C.6.1', 'Hospedagem',                     3, (SELECT id FROM management_category WHERE code='C.6'), 'opex', -1, false, true, NULL),
  ('C.6.2', 'Passagem Aérea',                 3, (SELECT id FROM management_category WHERE code='C.6'), 'opex', -1, false, true, NULL),
  ('C.6.3', 'Reembolso',                      3, (SELECT id FROM management_category WHERE code='C.6'), 'opex', -1, false, true, NULL),
  ('C.6.4', 'Alimentação',                    3, (SELECT id FROM management_category WHERE code='C.6'), 'opex', -1, false, true, NULL),
  ('C.6.5', 'Transporte',                     3, (SELECT id FROM management_category WHERE code='C.6'), 'opex', -1, false, true, NULL),
  -- Administrativo (C.7)
  ('C.7.1', 'Software',                       3, (SELECT id FROM management_category WHERE code='C.7'), 'opex', -1, false, true, NULL),
  ('C.7.2', 'Escritório',                     3, (SELECT id FROM management_category WHERE code='C.7'), 'opex', -1, false, true, NULL),
  ('C.7.3', 'Telefonia',                      3, (SELECT id FROM management_category WHERE code='C.7'), 'opex', -1, false, true, NULL),
  ('C.7.4', 'Internet',                       3, (SELECT id FROM management_category WHERE code='C.7'), 'opex', -1, false, true, NULL),
  ('C.7.5', 'Contabilidade',                  3, (SELECT id FROM management_category WHERE code='C.7'), 'opex', -1, false, true, NULL),
  ('C.7.6', 'Jurídico',                       3, (SELECT id FROM management_category WHERE code='C.7'), 'opex', -1, false, true, NULL),
  -- Tributos (E) granular
  ('E.1.4', 'PIS',                            3, (SELECT id FROM management_category WHERE code='E.1'), 'taxes', -1, false, false, NULL),
  ('E.1.5', 'COFINS',                         3, (SELECT id FROM management_category WHERE code='E.1'), 'taxes', -1, false, false, NULL),
  ('E.1.6', 'CSLL',                           3, (SELECT id FROM management_category WHERE code='E.1'), 'taxes', -1, false, false, NULL),
  ('E.4.1', 'INSS',                           3, (SELECT id FROM management_category WHERE code='E.4'), 'taxes', -1, false, false, NULL),
  ('E.4.2', 'FGTS',                           3, (SELECT id FROM management_category WHERE code='E.4'), 'taxes', -1, false, false, NULL),
  ('E.4.3', 'IRRF',                           3, (SELECT id FROM management_category WHERE code='E.4'), 'taxes', -1, false, false, NULL)
ON CONFLICT (code) DO NOTHING;

COMMIT;
