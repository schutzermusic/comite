# Payroll Closing — Staging Validation Runbook

End-to-end validation of the payroll closing workflow in **staging**. This repo's
sandbox cannot reach the database (`psql` absent, single pooled Supabase project,
no real secrets/spreadsheet), so the steps below are run by an operator against a
**staging** project. Nothing here is destructive; the smoke test cleans up after
itself.

## 0. Prerequisites
- A **staging** Supabase project (never run the apply step against production first).
- `SUPABASE_DB_URL` pointing at staging, plus `SUPABASE_SERVICE_ROLE_KEY` and
  `NEXT_PUBLIC_SUPABASE_URL` in `.env.local`.
- The RBAC foundation migrations (005/007) already applied (organizations,
  profiles, roles, permissions, `current_user_*` helpers, `audit_logs`).

## 1. Apply migrations (in order)
```bash
for f in 017_payroll_closing 018_payroll_closing_rls 019_payroll_storage 020_payroll_perm_seeds; do
  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "supabase/migrations/$f.sql"
done
```
All are idempotent / non-destructive (`CREATE … IF NOT EXISTS`, guarded `CREATE TYPE`,
`ON CONFLICT DO NOTHING`). Re-running is safe.

## 2. Verify the schema (read-only)
```bash
psql "$SUPABASE_DB_URL" -f scripts/verify-payroll-migrations.sql
```
Expect: 10 tables, 10 enums, 10 triggers, 5 private buckets, 15 storage policies,
RLS on 10 tables, ≥20 RLS policies, 6 permissions, role grants for
owner_admin/rh/financeiro/ceo_diretoria, and the `uq_pcb_org_comp_active` index.

## 3. Environment variables (staging app)
```
PAYROLL_CLOSING_REPOSITORY_MODE=supabase
NEXT_PUBLIC_PAYROLL_CLOSING_REPOSITORY_MODE=supabase
RESEND_API_KEY=<staging key>            # omit → e-mail stays in dry-run ('simulated')
PAYROLL_EMAIL_FROM="Folha <folha@suaempresa.com.br>"   # must be a Resend-verified domain
ANTHROPIC_API_KEY=<key>                 # omit → AI narrative uses deterministic fallback
```

## 4. End-to-end smoke test (writes + cleans up)
```bash
PAYROLL_SMOKE_CONFIRM=1 npx tsx scripts/payroll-staging-smoke.ts
# optional: PAYROLL_SMOKE_ORG_ID / PAYROLL_SMOKE_USER_ID to pin the tenant
```
Validates: create batch → upload to secure bucket (security_level/checksum/size) →
bytes round-trip from Storage → generated attachment → save parsed data → report →
package + dispatch → approve → `sendToFinance` (creates one finance `payroll_batch`) →
**anti-duplication** (2nd call fails) → audit rows present. Then deletes all of it.

## 5. Parser calibration with the REAL spreadsheet
```bash
npx tsx scripts/payroll-parse-check.ts /caminho/para/folha-real.xlsx
```
Review the printed extraction (competence, total, previous month, variation, cost
centers, bank lines, flags). If any value is wrong, adjust the deterministic rules
in `src/lib/payroll/parser.ts` (sheet-detection regex `SHEET_PATTERNS`, label
matchers in the totals block, `parseCostCenters/parseEmployees/parseBankLines`).
**Never** delegate numeric extraction to the AI.

Already calibrated against a synthetic messy pt-BR workbook (run with no argument):
the grand-total vs subtotal disambiguation ("Total de Proventos/Descontos" vs
"TOTAL GERAL"), `Salário Bruto` vs `Total de Proventos`, `12.000` thousands, and
`Colaboradores: 142` colon cells all pass.

## 6. RBAC matrix to confirm in the app (per role)
| Action | rh | financeiro | ceo_diretoria | sem permissão |
|---|---|---|---|---|
| Criar fechamento / upload (`payroll_close`) | ✅ | ❌ | ❌ | ❌ |
| Enviar e-mail (`payroll_send`) | ✅ | ❌ | ❌ | ❌ |
| Anexos sensíveis (`payroll_send_sensitive`) | ✅ | ❌ | ❌ | ❌ |
| Ler arquivos bancários (`payroll_bank_file_access`) | ❌ | ✅ | ❌ | ❌ |
| Ler holerites (`payroll_holerite_access`) | ✅ | ❌ | ❌ | ❌ |
| Ver dados sensíveis (`payroll_view_sensitive`) | ✅ | ✅ | ✅ | ❌ |

Confirm an unauthorized user gets 401/403 from `/api/payroll/batches*` and cannot
read payroll Storage objects (RLS denies). The service-role key stays server-side.

## 7. Manual UI walkthrough (Pessoas & Custos > Fechamento da Folha)
Upload real files → validate → generate AI report → build each package (Board,
Board Confidential, Finance, HR) → send test → send final → approve → send to
Finance → open Financeiro > Folha & Alocação and confirm the batch is consumable
and **no LedgerEntry exists until Finance posts the allocation**.

## 8. Audit verification
```sql
SELECT action, entity_type, created_at FROM audit_logs
WHERE organization_id = '<org>' AND entity_type LIKE 'payroll%'
ORDER BY created_at DESC LIMIT 50;
```
Expect rows for: created, uploaded, parsed, generated, email_package created,
dispatch (sent/simulated/failed), sent_to_finance.
