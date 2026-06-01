-- ============================================================
-- Verify payroll closing migrations (017–020) — READ ONLY.
-- Run in staging AFTER applying the migrations:
--   psql "$SUPABASE_DB_URL" -f scripts/verify-payroll-migrations.sql
-- Every block prints a PASS/FAIL count; nothing is modified.
-- ============================================================
\echo '== 1. Tables (expect 10) =='
SELECT count(*) AS payroll_tables
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name IN (
  'payroll_closing_batches','payroll_import_files','payroll_attachments',
  'payroll_generated_reports','payroll_email_packages','payroll_email_dispatches',
  'payroll_cost_center_summaries','payroll_employee_lines','payroll_bank_payment_lines',
  'payroll_validation_flags');

\echo '== 2. Enums (expect 10) =='
SELECT count(*) AS payroll_enums
FROM pg_type
WHERE typtype = 'e' AND typname IN (
  'payroll_closing_status','payroll_import_file_type','payroll_attachment_file_type',
  'payroll_security_level','payroll_report_type','payroll_report_status',
  'payroll_email_audience','payroll_email_package_status','payroll_delivery_status',
  'payroll_validation_severity');

\echo '== 3. updated_at triggers (expect 10) =='
SELECT count(*) AS payroll_triggers
FROM pg_trigger
WHERE NOT tgisinternal
  AND tgname LIKE 'trg_payroll_%_updated_at';

\echo '== 4. Storage buckets (expect 5, all private) =='
SELECT id, public FROM storage.buckets
WHERE id IN ('payroll-imports','payroll-holerites','payroll-bank-files',
             'payroll-reports','payroll-supporting-documents')
ORDER BY id;

\echo '== 5. Storage policies on storage.objects (expect 15: 5 insert + 5 delete + 5 read) =='
SELECT count(*) AS payroll_storage_policies
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
  AND (policyname LIKE 'payroll-%' OR policyname LIKE 'payroll_%');

\echo '== 6. RLS enabled on all 10 payroll tables (expect 10 = true) =='
SELECT count(*) AS rls_enabled
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relrowsecurity = true
  AND c.relname LIKE 'payroll_%';

\echo '== 7. RLS policies on payroll tables (expect >= 20: select + write per table, attachments x2) =='
SELECT count(*) AS payroll_rls_policies
FROM pg_policies
WHERE schemaname = 'public' AND tablename LIKE 'payroll_%';

\echo '== 8. Permission seeds (expect 6) =='
SELECT key FROM public.permissions
WHERE key IN ('people.payroll_close','people.payroll_send','people.payroll_send_sensitive',
              'people.payroll_view_sensitive','people.payroll_bank_file_access','people.payroll_holerite_access')
ORDER BY key;

\echo '== 9. Role grants (rh / financeiro / ceo_diretoria / owner_admin) =='
SELECT r.key AS role, count(*) AS payroll_perms
FROM public.roles r
JOIN public.role_permissions rp ON rp.role_id = r.id
JOIN public.permissions p ON p.id = rp.permission_id
WHERE r.organization_id IS NULL
  AND r.key IN ('owner_admin','rh','financeiro','ceo_diretoria')
  AND p.key LIKE 'people.payroll_%'
GROUP BY r.key ORDER BY r.key;

\echo '== 10. finance_batch_id FK + anti-duplication unique index =='
SELECT indexname FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'payroll_closing_batches'
  AND indexname = 'uq_pcb_org_comp_active';
