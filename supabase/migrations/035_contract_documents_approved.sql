-- 035_contract_documents_approved.sql
-- Phase 5: add a true "approved" status to contract_documents plus approval
-- provenance columns. Purely additive and idempotent — existing statuses and
-- rows are preserved, RLS policies are untouched.

-- 1) Widen the status CHECK to include 'approved'. The original constraint in
--    034 was defined inline (unnamed) → Postgres named it
--    contract_documents_status_check. Drop-if-exists then recreate.
ALTER TABLE public.contract_documents
  DROP CONSTRAINT IF EXISTS contract_documents_status_check;

ALTER TABLE public.contract_documents
  ADD CONSTRAINT contract_documents_status_check
  CHECK (status IN ('uploaded', 'missing', 'expired', 'expiring_soon', 'pending_approval', 'approved', 'rejected'));

-- 2) Approval provenance / rejection reason (nullable, backfill-free).
ALTER TABLE public.contract_documents
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;

ALTER TABLE public.contract_documents
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.contract_documents
  ADD COLUMN IF NOT EXISTS rejection_reason text;
