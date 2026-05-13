# Business Modules Audit and Contratos Migration Plan

## Executive Summary

The application is partially migrated to Supabase. Auth/RBAC, admin user/role screens, audit logs, organizations, profiles, committees foundation, and the Projects list persistence exist in Supabase. Most business modules still use mock files, generated files, localStorage, derived client state, or placeholders. Contratos was using `src/data/contractsFromExcel.generated.ts` plus derived governance data and in-memory upload state; it is now the next source-of-truth migration target.

Contratos should be migrated before Financeiro, Riscos, Deliberacoes/Votacoes, and RH because it already depends on Projects and can establish reusable patterns for organization-scoped RLS, private storage, audit logging, and AI-analysis placeholders.

## Module-by-Module Audit

| Module | Current data source | Main files/components/hooks/services | Reads Supabase | Writes Supabase | CRUD complete | RLS | organization_id | created_by/updated_by | File upload | Audit logging | Safe for real data entry |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Dashboard / Executive Control Room | Generated/mock/derived mixed | `src/app/(main)/dashboard/page.tsx`, `src/lib/dashboard-data.ts`, `src/components/dashboard/*`, `src/lib/workforce-data.ts`, `src/data/geo/*` | No | No | No | No | No | No | No | No | No |
| Projetos | Mixed Supabase + localStorage/mock fallback | `src/app/(main)/projetos/page.tsx`, `src/app/(main)/projetos/[id]/page.tsx`, `src/lib/services/projects.ts`, `src/lib/services/project-migration.ts`, `src/data/mock-projects-v2.ts`, `src/lib/mock-data.ts` | Yes, `projects`, `project_files` | Yes | Partial | Weak/demo policies in `004_projects_supabase_storage.sql` | No in `projects` table | Yes columns exist | Yes, `project-files` | Partial via project audit model/local UI | Partially; list persistence works, RLS needs hardening |
| Financeiro | Mock/client store + existing unused schema | `src/lib/finance/finance-store.ts`, `src/data/finance/mock-ledger.ts`, `src/app/(main)/financeiro/*`, `src/components/finance/control-room/*` | Mostly No | Client state only | No | Migrations exist for finance tables but UI is mock-backed | In migrations only | In migrations only | No | No | No |
| Contratos | Was generated/mock/in-memory; migrating to Supabase | `src/app/(main)/contratos/page.tsx`, `src/app/(main)/contratos/[id]/page.tsx`, `src/components/contracts/*`, `src/data/contractsFromExcel.generated.ts`, `src/data/portfolioContracts.ts`, `src/lib/contracts/contract-service.ts`, `src/hooks/use-contracts.ts`, `src/hooks/use-contract-detail.ts` | Yes after migration | Yes after migration | Partial | Yes in `006_contracts_supabase.sql` | Yes | Yes on `contracts`; upload/AI actors on related tables | Yes, private `contract-files` foundation | Yes for create/update/archive/upload/AI request | Yes for basic contract create/list/detail; related tabs are safe empty states until data exists |
| Riscos | Mock/client state | `src/app/(main)/riscos/page.tsx`, `src/components/risks/*`, `src/components/risks/risk-mock-data.ts`, `src/lib/risk-score.ts` | No | No | No | No | No | No | No | No | No |
| Reunioes | Mock file | `src/app/(main)/reunioes/page.tsx`, `src/app/(main)/reunioes/[id]/page.tsx`, `src/app/(main)/reunioes/nova/page.tsx`, `src/components/meetings/*`, `src/lib/mock-data.ts` | No | No | No | No | No | No | No | No | No |
| Deliberacoes | Safe placeholder/mixed local state | `src/app/(main)/deliberacoes/page.tsx`, `src/components/deliberacoes/*`, `src/components/deliberacoes/mock-data.ts`, `src/lib/deliberations-policy.ts` | No | No | No | Auth-aware visibility only | No | No | Placeholder only | Local audit trail model only | No, intentionally placeholder |
| Votacoes | Mock file/client state | `src/app/(main)/votacoes/page.tsx`, `src/app/(main)/votacoes/[id]/page.tsx`, `src/app/(main)/votacoes/nova/page.tsx`, `src/lib/mock-data.ts` | No | No | No | Auth/RBAC route visibility only | No | No | No | No | No |
| Pautas | Client state/local placeholder | `src/app/(main)/pautas/page.tsx`, `src/app/(main)/pautas/nova/page.tsx`, `src/components/agenda/*`, `src/lib/entities/pauta.json`, `src/lib/utils/project-utils.ts` | No | No | No | Auth/RBAC route visibility only | No | No | Attachment URL placeholder | Local audit trail model only | No |
| Atas | Placeholder page/entity JSON | `src/app/(main)/atas/page.tsx`, `src/lib/entities/reuniao.json`, `src/ai/flows/automated-minute-generation.ts`, `src/components/features/ai-minutes-generator.tsx` | No | No | No | Auth/RBAC route visibility only | No | No | No | Generated mock output | No |
| Pessoas | Mock file + Supabase admin profiles for admin only | `src/app/(main)/membros/page.tsx`, `src/components/member/*`, `src/lib/mock-data.ts`, `src/app/(main)/admin/users/page.tsx` | Admin users yes; Pessoas module no | Admin users yes; Pessoas module no | Admin partial only | Admin RLS yes | Profiles yes | Profiles yes | Invite placeholder | Admin audit partial | Pessoas module no; admin users partially safe |
| Organograma | Hardcoded/client state | `src/app/(main)/organograma/page.tsx`, `src/components/orgchart/org-tree-viewer.tsx`, `src/components/organization/org-chart.tsx` | No | No | Client only | No | No | No | No | No | No |
| Comites | Supabase foundation + mock UI | `src/app/(main)/comites/page.tsx`, `src/app/(main)/comites/[id]/page.tsx`, `src/app/(main)/comites/[id]/roles/page.tsx`, `src/app/(main)/comites/novo/page.tsx`, `src/lib/mock-data.ts`, `005_auth_rbac_foundation.sql` | Foundation tables yes; UI mostly no | Foundation/admin functions yes; UI mostly no | No | Yes for foundation tables | Yes | No for members beyond created_at | No | Foundation audit for org setup | Not yet |

## Mock / localStorage / Generated Inventory

| Source | Used by | Notes |
| --- | --- | --- |
| `src/lib/mock-data.ts` | Reunioes, Votacoes, Pautas, Pessoas, Comites, project detail side panels, notifications, reports | Largest mock source; still central to many modules. |
| `src/data/contractsFromExcel.generated.ts` | Contratos legacy source, `portfolioContracts` | Replaced as Contratos source of truth by Supabase service; still used by portfolio/finance-adjacent components until those modules migrate. |
| `src/data/portfolioContracts.ts` | Portfolio/contract company views and charts | Derived from generated contracts. |
| `src/lib/finance/finance-store.ts` + `src/data/finance/mock-ledger.ts` | Financeiro | Client-side mock store despite finance migrations. |
| `src/components/finance/control-room/mock-data.ts` | Finance control room | Derived/illustrative finance intelligence. |
| `src/components/risks/risk-mock-data.ts` | Riscos | Main risk data source. |
| `src/components/deliberacoes/mock-data.ts` | Deliberacoes | Placeholder governance workflow. |
| `src/data/mock-projects-v2.ts` | Projetos detail enrichment | V2 overlays and allocations still local/mock. |
| `localStorage: insight_projects`, `insight_projects_v2` | Projects fallback/cache | Supabase-backed list caches locally and seeds from mocks when empty. |
| `localStorage: deliberation_drafts` | Pautas/project utility draft flow | Draft-only persistence. |
| `src/lib/entities/*.json` | Entity shape/reference files | Static JSON definitions, not live persistence. |
| Hardcoded arrays in pages | Organograma, reports, notifications config, committee roles | UI-only placeholders. |

## Risk List

1. Projects Supabase table lacks `organization_id` and currently has permissive demo RLS. Contratos links to it by text `project_id` to avoid breaking Projects, but project-level scoping remains limited.
2. Financeiro has schema migrations but the UI store is mock-backed, which can confuse users if they believe entries persist.
3. Deliberacoes/Votacoes/Pautas contain mature UI but are not durable; current behavior should remain explicitly placeholder until migration.
4. Contratos related subtables may be empty after migration; tabs must show empty/placeholder states without inventing real data.
5. Private Supabase Storage policies depend on `contract_files` metadata being inserted after upload. Orphaned objects can occur if metadata insert fails after object upload.
6. `client_id` and `supplier_id` are foundations only because no source-of-truth clients/suppliers tables exist yet.

## Recommended Migration Order

1. Contratos: source-of-truth contracts, files, clauses, penalties, milestones, billing events, risks, AI placeholder, audit logs.
2. Harden Projetos RLS: add `organization_id`, ownership/assignment model, and migrate V2 detail overlays.
3. Riscos: use shared risk model and link `contract_risks` and project risks.
4. Deliberacoes/Votacoes/Pautas/Atas: migrate governance workflow as one bounded domain to avoid split-brain voting state.
5. Financeiro: connect existing finance migrations to UI service layer.
6. Pessoas/Organograma/RH: migrate people source of truth and org hierarchy.
7. Comites: connect UI to existing `committees` and `committee_members`.
8. Dashboard: replace derived mocks with aggregate queries/views from migrated domains.

## Contratos Migration Plan

1. Create idempotent migration `006_contracts_supabase.sql`.
2. Add tables: `contracts`, `contract_clauses`, `contract_penalties`, `contract_milestones`, `contract_billing_events`, `contract_risks`, `contract_files`, `contract_ai_analyses`.
3. Add `updated_at` triggers and indexes.
4. Enable RLS and policies using existing helpers: `current_user_organization_id()`, `current_user_has_permission()`, `current_user_is_admin()`.
5. Configure private `contract-files` bucket with scoped read/upload policies.
6. Add service/hook layer: `src/lib/contracts/contract-service.ts`, `src/hooks/use-contracts.ts`, `src/hooks/use-contract-detail.ts`.
7. Wire `/contratos` to list/create from Supabase and hide create when `contracts.create` is missing.
8. Wire `/contratos/[id]` to Supabase detail and related tables.
9. Keep AI analysis as explicit placeholder via `contract_ai_analyses`, with no real document claims.
10. Log critical actions: created, updated, archived, file uploaded, AI requested.

## Contratos Acceptance Notes

- Contract list and detail now read from Supabase instead of `contractsFromExcel.generated`.
- New contract flow writes `contracts` and optionally uploads a file to private `contract-files`.
- Related tabs read the new related tables and show safe empty/placeholder text when no related rows exist.
- Full AI contract analysis is intentionally not implemented; only a durable pending request foundation exists.
