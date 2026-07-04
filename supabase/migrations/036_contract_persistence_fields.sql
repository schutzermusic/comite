-- 036_contract_persistence_fields.sql
-- Phase 6: promote values that Phase 4/5 captured audit-only into real columns,
-- and add approval start/finish timestamps for step-level SLA. Purely additive
-- and idempotent — no column is dropped, no row is rewritten, RLS is untouched.

-- Obligations: completion provenance.
ALTER TABLE public.contract_obligations
  ADD COLUMN IF NOT EXISTS completion_note text;
ALTER TABLE public.contract_obligations
  ADD COLUMN IF NOT EXISTS completed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.contract_obligations
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

-- Approvals: step SLA timestamps + request-changes note.
-- (deadline_date, rejection_reason, approval_timestamp already exist from 034.)
ALTER TABLE public.contract_approvals
  ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE public.contract_approvals
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE public.contract_approvals
  ADD COLUMN IF NOT EXISTS requested_changes_note text;

-- Billing events: realized provenance (paid_at alone is not enough for value/ref).
ALTER TABLE public.contract_billing_events
  ADD COLUMN IF NOT EXISTS realized_amount numeric;
ALTER TABLE public.contract_billing_events
  ADD COLUMN IF NOT EXISTS invoice_reference text;
ALTER TABLE public.contract_billing_events
  ADD COLUMN IF NOT EXISTS realized_note text;
ALTER TABLE public.contract_billing_events
  ADD COLUMN IF NOT EXISTS realized_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.contract_billing_events
  ADD COLUMN IF NOT EXISTS realized_at timestamptz;
