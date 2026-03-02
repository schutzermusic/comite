-- ============================================================
-- FINANCE MODULE — Canonical Data Model
-- Migration: 001_finance_module
-- ============================================================

-- ENUMS
CREATE TYPE cost_center_type AS ENUM ('direct', 'indirect', 'admin');
CREATE TYPE management_group_key AS ENUM ('revenue', 'cogs', 'opex', 'financial', 'taxes');
CREATE TYPE ledger_entry_type AS ENUM ('actual', 'budget', 'forecast', 'adjustment');
CREATE TYPE ledger_entry_status AS ENUM ('draft', 'in_review', 'approved', 'posted', 'reconciled', 'void');
CREATE TYPE payroll_batch_status AS ENUM ('draft', 'approved', 'posted');
CREATE TYPE allocation_method AS ENUM ('fixed_pct', 'headcount', 'revenue', 'timesheet_hh');
CREATE TYPE allocation_rule_status AS ENUM ('draft', 'active', 'archived');
CREATE TYPE allocation_result_status AS ENUM ('preview', 'posted', 'reversed');
CREATE TYPE apar_type AS ENUM ('payable', 'receivable');
CREATE TYPE apar_status AS ENUM ('open', 'partial', 'paid', 'overdue', 'cancelled');
CREATE TYPE period_close_status AS ENUM ('open', 'soft_close', 'closed');
CREATE TYPE ingestion_batch_status AS ENUM ('running', 'completed', 'failed');

-- ============================================================
-- 1. BUSINESS UNIT
-- ============================================================
CREATE TABLE business_unit (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          varchar(20)  NOT NULL UNIQUE,
  name          varchar(200) NOT NULL,
  cnpj          varchar(18)  UNIQUE,
  uf            char(2)      NOT NULL,
  city          varchar(100),
  active        boolean      NOT NULL DEFAULT true,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX idx_bu_uf   ON business_unit (uf);
CREATE INDEX idx_bu_code ON business_unit (code);

-- ============================================================
-- 2. COST CENTER
-- ============================================================
CREATE TABLE cost_center (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             varchar(30)      NOT NULL UNIQUE,
  name             varchar(200)     NOT NULL,
  business_unit_id uuid             NOT NULL REFERENCES business_unit(id),
  parent_id        uuid             REFERENCES cost_center(id),
  type             cost_center_type NOT NULL,
  active           boolean          NOT NULL DEFAULT true,
  created_at       timestamptz      NOT NULL DEFAULT now(),
  updated_at       timestamptz      NOT NULL DEFAULT now()
);

CREATE INDEX idx_cc_bu     ON cost_center (business_unit_id);
CREATE INDEX idx_cc_parent ON cost_center (parent_id);

-- ============================================================
-- 3. MANAGEMENT CATEGORY (Cost Stack — 3 levels)
-- ============================================================
CREATE TABLE management_category (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             varchar(20)        NOT NULL UNIQUE,
  name             varchar(200)       NOT NULL,
  level            smallint           NOT NULL CHECK (level BETWEEN 1 AND 3),
  parent_id        uuid               REFERENCES management_category(id),
  group_key        management_group_key NOT NULL,
  sign             smallint           NOT NULL CHECK (sign IN (-1, 1)),
  requires_project boolean            NOT NULL DEFAULT false,
  active           boolean            NOT NULL DEFAULT true
);

CREATE INDEX idx_mc_parent ON management_category (parent_id);
CREATE INDEX idx_mc_group  ON management_category (group_key);

-- ============================================================
-- 4. SUPPLIER
-- ============================================================
CREATE TABLE supplier (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          varchar(300) NOT NULL,
  cpf_cnpj      varchar(18)  UNIQUE,
  category      varchar(100),
  uf            char(2),
  active        boolean      NOT NULL DEFAULT true,
  source_system varchar(30)  NOT NULL DEFAULT 'manual',
  external_key  varchar(100),
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now()
);

-- ============================================================
-- 5. CLIENT
-- ============================================================
CREATE TABLE client (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          varchar(300) NOT NULL,
  cnpj          varchar(18)  UNIQUE,
  segment       varchar(100),
  active        boolean      NOT NULL DEFAULT true,
  source_system varchar(30)  NOT NULL DEFAULT 'manual',
  external_key  varchar(100),
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now()
);

-- ============================================================
-- 6. INGESTION BATCH
-- ============================================================
CREATE TABLE ingestion_batch (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_system   varchar(30)            NOT NULL,
  started_at      timestamptz            NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  status          ingestion_batch_status NOT NULL DEFAULT 'running',
  records_total   int,
  records_created int,
  records_updated int,
  records_skipped int,
  error_log       jsonb
);

-- ============================================================
-- 7. PAYROLL BATCH
-- ============================================================
CREATE TABLE payroll_batch (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_key           char(7)              NOT NULL,
  business_unit_id     uuid                 NOT NULL REFERENCES business_unit(id),
  total_gross_cents    bigint               NOT NULL,
  total_charges_cents  bigint               NOT NULL,
  total_benefits_cents bigint               NOT NULL,
  headcount            int                  NOT NULL,
  status               payroll_batch_status NOT NULL DEFAULT 'draft',
  evidence_url         varchar(500),
  notes                text,
  source_system        varchar(30)          NOT NULL DEFAULT 'manual',
  created_by           uuid                 NOT NULL,
  approved_by          uuid,
  approved_at          timestamptz,
  created_at           timestamptz          NOT NULL DEFAULT now(),
  updated_at           timestamptz          NOT NULL DEFAULT now(),
  UNIQUE (period_key, business_unit_id)
);

CREATE INDEX idx_pb_period_bu ON payroll_batch (period_key, business_unit_id);

-- ============================================================
-- 8. ALLOCATION RULE (versioned)
-- ============================================================
CREATE TABLE allocation_rule (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             varchar(200)           NOT NULL,
  version          int                    NOT NULL DEFAULT 1,
  cost_center_id   uuid                   NOT NULL REFERENCES cost_center(id),
  method           allocation_method      NOT NULL,
  rules_json       jsonb                  NOT NULL,
  effective_from   date                   NOT NULL,
  effective_to     date,
  status           allocation_rule_status NOT NULL DEFAULT 'draft',
  created_by       uuid                   NOT NULL,
  approved_by      uuid,
  created_at       timestamptz            NOT NULL DEFAULT now(),
  updated_at       timestamptz            NOT NULL DEFAULT now()
);

CREATE INDEX idx_ar_cc_effective ON allocation_rule (cost_center_id, effective_from);

-- ============================================================
-- 9. ALLOCATION RESULT
-- ============================================================
CREATE TABLE allocation_result (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id             uuid                     NOT NULL REFERENCES allocation_rule(id),
  period_key          char(7)                  NOT NULL,
  payroll_batch_id    uuid                     REFERENCES payroll_batch(id),
  source_amount_cents bigint                   NOT NULL,
  result_entries      jsonb                    NOT NULL,
  status              allocation_result_status NOT NULL DEFAULT 'preview',
  posted_at           timestamptz,
  reversed_at         timestamptz,
  reverse_reason      varchar(500),
  created_by          uuid                     NOT NULL,
  created_at          timestamptz              NOT NULL DEFAULT now()
);

CREATE INDEX idx_alloc_period ON allocation_result (period_key, rule_id);

-- ============================================================
-- 10. PERIOD CLOSE
-- ============================================================
CREATE TABLE period_close (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_key     char(7)             NOT NULL UNIQUE,
  status         period_close_status NOT NULL DEFAULT 'open',
  soft_closed_at timestamptz,
  closed_at      timestamptz,
  closed_by      uuid,
  snapshot_json  jsonb,
  notes          text
);

-- ============================================================
-- 11. LEDGER ENTRY (canonical transaction)
-- ============================================================
CREATE TABLE ledger_entry (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_date           date                NOT NULL,
  description          varchar(500)        NOT NULL,
  amount_cents         bigint              NOT NULL,
  currency             char(3)             NOT NULL DEFAULT 'BRL',
  category_id          uuid                NOT NULL REFERENCES management_category(id),
  cost_center_id       uuid                NOT NULL REFERENCES cost_center(id),
  project_id           uuid,
  contract_id          uuid,
  supplier_id          uuid                REFERENCES supplier(id),
  client_id            uuid                REFERENCES client(id),
  business_unit_id     uuid                NOT NULL REFERENCES business_unit(id),
  period_key           char(7)             NOT NULL,
  entry_type           ledger_entry_type   NOT NULL DEFAULT 'actual',
  status               ledger_entry_status NOT NULL DEFAULT 'draft',
  source_system        varchar(30)         NOT NULL DEFAULT 'manual',
  source_ref           varchar(200),
  external_key         varchar(200),
  ingestion_batch_id   uuid                REFERENCES ingestion_batch(id),
  payroll_batch_id     uuid                REFERENCES payroll_batch(id),
  allocation_result_id uuid                REFERENCES allocation_result(id),
  parent_entry_id      uuid                REFERENCES ledger_entry(id),
  evidence_required    boolean             NOT NULL DEFAULT false,
  evidence_provided    boolean             NOT NULL DEFAULT false,
  template_key         varchar(50),
  tags                 jsonb,
  metadata             jsonb,
  created_by           uuid                NOT NULL,
  approved_by          uuid,
  approved_at          timestamptz,
  posted_by            uuid,
  posted_at            timestamptz,
  voided_by            uuid,
  voided_at            timestamptz,
  void_reason          varchar(500),
  created_at           timestamptz         NOT NULL DEFAULT now(),
  updated_at           timestamptz         NOT NULL DEFAULT now(),
  CONSTRAINT chk_amount CHECK (status = 'void' OR amount_cents != 0)
);

CREATE INDEX idx_le_period      ON ledger_entry (period_key, status);
CREATE INDEX idx_le_project     ON ledger_entry (project_id);
CREATE INDEX idx_le_contract    ON ledger_entry (contract_id);
CREATE INDEX idx_le_category    ON ledger_entry (category_id);
CREATE INDEX idx_le_cc          ON ledger_entry (cost_center_id);
CREATE INDEX idx_le_bu          ON ledger_entry (business_unit_id);
CREATE INDEX idx_le_source      ON ledger_entry (source_system, external_key);
CREATE INDEX idx_le_batch       ON ledger_entry (ingestion_batch_id);
CREATE INDEX idx_le_status      ON ledger_entry (status);
CREATE INDEX idx_le_type_period ON ledger_entry (entry_type, period_key);

-- ============================================================
-- 12. AP/AR TITLE
-- ============================================================
CREATE TABLE apar_title (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type              apar_type   NOT NULL,
  title_number      varchar(50) NOT NULL,
  supplier_id       uuid        REFERENCES supplier(id),
  client_id         uuid        REFERENCES client(id),
  contract_id       uuid,
  project_id        uuid,
  issue_date        date        NOT NULL,
  due_date          date        NOT NULL,
  amount_cents      bigint      NOT NULL,
  paid_amount_cents bigint      NOT NULL DEFAULT 0,
  status            apar_status NOT NULL DEFAULT 'open',
  linked_entry_id   uuid        REFERENCES ledger_entry(id),
  source_system     varchar(30) NOT NULL DEFAULT 'manual',
  external_key      varchar(200),
  notes             text,
  created_by        uuid        NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_apar_due    ON apar_title (type, due_date, status);
CREATE INDEX idx_apar_source ON apar_title (source_system, external_key);

-- ============================================================
-- 13. ATTACHMENT
-- ============================================================
CREATE TABLE attachment (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type     varchar(50)   NOT NULL,
  entity_id       uuid          NOT NULL,
  file_name       varchar(300)  NOT NULL,
  file_url        varchar(1000) NOT NULL,
  file_size_bytes int,
  mime_type       varchar(100),
  uploaded_by     uuid          NOT NULL,
  created_at      timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX idx_att_entity ON attachment (entity_type, entity_id);

-- ============================================================
-- 14. AUDIT LOG (immutable, append-only)
-- ============================================================
CREATE TABLE finance_audit_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type    varchar(50)  NOT NULL,
  entity_id      uuid         NOT NULL,
  action         varchar(50)  NOT NULL,
  changed_fields jsonb,
  reason_code    varchar(50),
  reason_text    varchar(500),
  performed_by   uuid         NOT NULL,
  performed_at   timestamptz  NOT NULL DEFAULT now(),
  ip_address     inet
);

CREATE INDEX idx_audit_entity ON finance_audit_log (entity_type, entity_id, performed_at DESC);

-- ============================================================
-- 15. CATEGORY MAPPING (ERP -> Management)
-- ============================================================
CREATE TABLE category_mapping (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_system          varchar(30)  NOT NULL,
  source_account_code    varchar(50)  NOT NULL,
  source_account_name    varchar(200),
  management_category_id uuid         NOT NULL REFERENCES management_category(id),
  confidence             decimal(3,2),
  active                 boolean      NOT NULL DEFAULT true,
  notes                  text,
  UNIQUE (source_system, source_account_code)
);

CREATE INDEX idx_cm_source ON category_mapping (source_system, source_account_code);

-- ============================================================
-- TRIGGER: auto-update updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_bu_updated   BEFORE UPDATE ON business_unit   FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_cc_updated   BEFORE UPDATE ON cost_center     FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_sup_updated  BEFORE UPDATE ON supplier        FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_cli_updated  BEFORE UPDATE ON client          FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_le_updated   BEFORE UPDATE ON ledger_entry    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_pb_updated   BEFORE UPDATE ON payroll_batch   FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_ar_updated   BEFORE UPDATE ON allocation_rule FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_apar_updated BEFORE UPDATE ON apar_title      FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- TRIGGER: enforce period lock
-- ============================================================
CREATE OR REPLACE FUNCTION enforce_period_lock()
RETURNS TRIGGER AS $$
DECLARE
  v_status period_close_status;
BEGIN
  SELECT status INTO v_status FROM period_close WHERE period_key = NEW.period_key;

  IF v_status = 'closed' AND NEW.entry_type != 'adjustment' THEN
    RAISE EXCEPTION 'Period % is closed. Only adjustments are allowed.', NEW.period_key;
  END IF;

  IF v_status = 'soft_close' AND NEW.entry_type = 'actual' AND TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'Period % is soft-closed. New actual entries are not allowed.', NEW.period_key;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_period_lock
  BEFORE INSERT OR UPDATE ON ledger_entry
  FOR EACH ROW EXECUTE FUNCTION enforce_period_lock();

-- ============================================================
-- TRIGGER: auto-set evidence_required based on amount
-- ============================================================
CREATE OR REPLACE FUNCTION set_evidence_required()
RETURNS TRIGGER AS $$
BEGIN
  IF ABS(NEW.amount_cents) >= 500000 THEN
    NEW.evidence_required = true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_evidence_required
  BEFORE INSERT OR UPDATE ON ledger_entry
  FOR EACH ROW EXECUTE FUNCTION set_evidence_required();

-- ============================================================
-- TRIGGER: derive period_key from entry_date
-- ============================================================
CREATE OR REPLACE FUNCTION derive_period_key()
RETURNS TRIGGER AS $$
BEGIN
  NEW.period_key = to_char(NEW.entry_date, 'YYYY-MM');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_derive_period_key
  BEFORE INSERT OR UPDATE ON ledger_entry
  FOR EACH ROW EXECUTE FUNCTION derive_period_key();
