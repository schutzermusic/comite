# RBAC Access Matrix — INSIGHT Governança Corporativa

> Authoritative reference for roles, permissions, route protection, sidebar visibility,
> action-level gating and the proposed **Funções Globais & Acessos** admin module.
>
> Source-of-truth for the audit performed on 2026-05-14 against branch `main`.
> Companion to [docs/plan/ACCESS_CONTROL_PLAN.md](../plan/ACCESS_CONTROL_PLAN.md).

---

## 1. Architecture Overview

The platform uses **layered defense** for access control:

| Layer | Where | What it enforces |
|-------|-------|------------------|
| **1. Middleware** | [src/middleware.ts](../../src/middleware.ts) → [src/utils/supabase/middleware.ts](../../src/utils/supabase/middleware.ts) | Auth required, profile active, org assigned, route-level permission via `current_user_has_permission()` RPC |
| **2. RLS (Postgres)** | `supabase/migrations/00{5,7,8,9,10,11,12}_*.sql` | Per-table row visibility & write authorization scoped by org + permission key |
| **3. API route guards** | `src/app/api/**/route.ts` | Inline auth + permission check before service-role mutations |
| **4. UI gating** | [src/lib/auth/permissions.ts](../../src/lib/auth/permissions.ts), [src/hooks/use-permissions.ts](../../src/hooks/use-permissions.ts), [src/components/layout/app-sidebar.tsx](../../src/components/layout/app-sidebar.tsx) | Hide/disable menus & buttons (UX only — never the security boundary) |

**Golden rule:** UI gating is for ergonomics; **every sensitive action must be enforced
at layer 2 (RLS) or layer 3 (API guard)**. Removing UI gates does not grant access.

---

## 2. Roles (System Roles)

Seeded in [supabase/migrations/005_auth_rbac_foundation.sql](../../supabase/migrations/005_auth_rbac_foundation.sql) (lines 601–613). All system roles have `organization_id = NULL`.

| Key | Display Name | Scope |
|-----|--------------|-------|
| `owner_admin` | Owner / Admin | Full system access — every permission |
| `ceo_diretoria` | CEO / Diretoria | Executive read + deliberation approval |
| `financeiro` | Financeiro | Finance ops + executive read |
| `juridico_contratos` | Jurídico / Contratos | Contract & legal management |
| `gestor_projetos` | Gestor de Projetos | Project lifecycle + Gantt + risks (assigned scope) |
| `rh` | RH | People, org chart, deliberations |
| `engenharia_pcp` | Engenharia / PCP | Projects, Gantt, risks (engineering scope) |

> **Viewer / Conselho** is referenced in the plan but **not yet seeded**. See §10 (Recommended Schema Changes).

---

## 3. Permission Catalog

77 permissions seeded in [005_auth_rbac_foundation.sql](../../supabase/migrations/005_auth_rbac_foundation.sql) lines 502–595.
2 additional AI permissions added in [011_ai_risk_engine.sql](../../supabase/migrations/011_ai_risk_engine.sql) (`risks.ai_scan`) and [012_ai_risk_dismiss.sql](../../supabase/migrations/012_ai_risk_dismiss.sql) (`risks.ai_dismiss`).

| Module | Permission Keys |
|--------|-----------------|
| **admin** | `admin.view`, `admin.manage_users`, `admin.manage_roles`, `admin.manage_organization`, `admin.manage_integrations` |
| **dashboard** | `dashboard.view`, `dashboard.view_executive`, `dashboard.export` |
| **projects** | `projects.view`, `projects.view_all`, `projects.view_assigned`, `projects.create`, `projects.edit`, `projects.delete`, `projects.upload`, `projects.export`, `projects.view_costs`, `projects.view_margin` |
| **project_gantt** | `project_gantt.view`, `project_gantt.create`, `project_gantt.edit`, `project_gantt.delete`, `project_gantt.update_progress` |
| **finance** | `finance.view`, `finance.view_executive`, `finance.create_entry`, `finance.edit_entry`, `finance.delete_entry`, `finance.view_dre`, `finance.view_budget_actual`, `finance.view_forecast`, `finance.view_project_costs`, `finance.view_margin`, `finance.export`, `finance.approve` |
| **contracts** | `contracts.view`, `contracts.create`, `contracts.edit`, `contracts.delete`, `contracts.upload_file`, `contracts.analyze_with_ai`, `contracts.view_values`, `contracts.view_penalties`, `contracts.approve`, `contracts.export` |
| **risks** | `risks.view`, `risks.view_all`, `risks.view_assigned`, `risks.create`, `risks.edit`, `risks.delete`, `risks.approve_mitigation`, `risks.export`, `risks.ai_scan`, `risks.ai_dismiss` |
| **meetings** | `meetings.view`, `meetings.create`, `meetings.edit`, `meetings.delete`, `meetings.participate` |
| **deliberations** | `deliberations.view`, `deliberations.view_own`, `deliberations.view_committee`, `deliberations.view_all`, `deliberations.view_confidential`, `deliberations.create`, `deliberations.comment`, `deliberations.vote`, `deliberations.approve`, `deliberations.reject`, `deliberations.close`, `deliberations.export` |
| **minutes** | `minutes.view`, `minutes.create`, `minutes.edit`, `minutes.approve`, `minutes.export` |
| **people** | `people.view`, `people.create`, `people.edit`, `people.delete`, `people.view_costs`, `people.view_salary`, `people.view_sensitive_data` |
| **org_chart** | `org_chart.view`, `org_chart.edit`, `org_chart.export` |
| **committees** | `committees.view`, `committees.create`, `committees.edit`, `committees.delete`, `committees.manage_members` |
| **audit** | `audit.view`, `audit.export` |

---

## 4. Access Matrix — Role × Module

`✓` = full access for role · `R` = read-only · `E` = read + executive view · `—` = no access · `*` = via specific perms only.

| Module | owner_admin | ceo_diretoria | financeiro | juridico_contratos | gestor_projetos | rh | engenharia_pcp |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Dashboard / Control Room | ✓ | E | E | R | R | R | R |
| Projetos | ✓ | R (all) | R (all+costs) | R | ✓ (assigned) | R | ✓ (assigned) |
| Insight Operations 3D | ✓ | R | R | — | ✓ | — | ✓ |
| Project Gantt | ✓ | R | R | — | ✓ | — | ✓ |
| Financeiro | ✓ | E (no edit) | ✓ | — | — | — | — |
| Riscos | ✓ | R (all) + approve | R (all) | ✓ create/edit | ✓ (assigned) | — | ✓ create/edit |
| Riscos — IA Scan | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| Riscos — IA Dismiss | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| Contratos | ✓ | R + approve | R (values) | ✓ + AI + export | R | — | R |
| Reuniões | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Deliberações | ✓ | ✓ + approve/reject/close | * vote | * vote | * comment | * vote | * vote |
| Atas (Minutes) | ✓ | R + approve | R | R | R | R | R |
| Pessoas / Workforce | ✓ | R | R | — | — | ✓ | — |
| Organograma | ✓ | R | R | — | — | ✓ edit | — |
| Comitês | ✓ | R | R | R | R | R | R |
| **Admin → Users** | ✓ | — | — | — | — | — | — |
| **Admin → Roles** | ✓ | — | — | — | — | — | — |
| **Admin → Audit** | ✓ | R | — | — | — | — | — |
| **Admin → Integrações (eSocial)** | ✓ | — | — | — | — | — | — |

> **Verification:** The role→permission mappings come from [005_auth_rbac_foundation.sql](../../supabase/migrations/005_auth_rbac_foundation.sql) lines 619–636. AI permissions seeded only for `owner_admin` in 011/012.

### 4.1 Action-Level Matrix (operations on existing modules)

| Action | Permission Required | Roles with access |
|---|---|---|
| New Project | `projects.create` | owner_admin, gestor_projetos |
| Edit Project | `projects.edit` | owner_admin, gestor_projetos, engenharia_pcp |
| Delete/Archive Project | `projects.delete` | owner_admin |
| Upload to Project | `projects.upload` | owner_admin, gestor_projetos, engenharia_pcp |
| Export Project | `projects.export` | owner_admin, ceo_diretoria |
| View Project Costs | `projects.view_costs` | owner_admin, financeiro |
| New Contract | `contracts.create` | owner_admin, juridico_contratos |
| Upload Contract File | `contracts.upload_file` | owner_admin, juridico_contratos |
| Analyze Contract w/ AI | `contracts.analyze_with_ai` | owner_admin, juridico_contratos |
| Approve Contract | `contracts.approve` | owner_admin, ceo_diretoria |
| Delete Contract | `contracts.delete` | owner_admin |
| Trigger AI Risk Scan | `risks.ai_scan` | owner_admin, ceo_diretoria, financeiro, juridico_contratos, gestor_projetos |
| Dismiss AI Risk | `risks.ai_dismiss` | owner_admin, ceo_diretoria, financeiro, juridico_contratos, gestor_projetos |
| Approve Risk Mitigation | `risks.approve_mitigation` | owner_admin, ceo_diretoria |
| Vote on Deliberação | `deliberations.vote` | owner_admin, ceo_diretoria, financeiro, juridico_contratos, rh, engenharia_pcp |
| Approve Deliberação | `deliberations.approve` | owner_admin, ceo_diretoria |
| Reject Deliberação | `deliberations.reject` | owner_admin, ceo_diretoria |
| Close Deliberação | `deliberations.close` | owner_admin, ceo_diretoria |
| Create Finance Entry | `finance.create_entry` | owner_admin, financeiro |
| Approve Finance Entry | `finance.approve` | owner_admin, financeiro |
| Export Finance | `finance.export` | owner_admin, ceo_diretoria, financeiro |
| Manage Users | `admin.manage_users` | owner_admin |
| Manage Roles & Perms | `admin.manage_roles` | owner_admin |
| Manage Integrations | `admin.manage_integrations` | owner_admin |
| View Audit Log | `audit.view` | owner_admin, ceo_diretoria |

---

## 5. Route Protection Matrix

### 5.1 Public routes (no auth)
- `/login` — [src/app/login/page.tsx](../../src/app/login/page.tsx)
- `/forgot-password` — [src/app/forgot-password/page.tsx](../../src/app/forgot-password/page.tsx)
- `/reset-password` — [src/app/reset-password/page.tsx](../../src/app/reset-password/page.tsx)
- `/auth/*` — Supabase auth callbacks

### 5.2 Profile-setup routes (auth, no permission)
- `/onboarding` — [src/app/onboarding/page.tsx](../../src/app/onboarding/page.tsx) — runs `setup_first_organization()`

### 5.3 Authenticated-only (no permission gate)
Defined in [src/utils/supabase/middleware.ts:46-49](../../src/utils/supabase/middleware.ts#L46-L49):
- `/notificacoes/*`
- `/configuracoes/*` (account, security, theme, API tokens, integrations dashboard)
- `/access-restricted`

### 5.4 Permission-gated routes
Source: [src/utils/supabase/middleware.ts:15-49](../../src/utils/supabase/middleware.ts#L15-L49)

| Route prefix | Permission | Page file |
|---|---|---|
| `/admin/users` | `admin.manage_users` | [admin/users/page.tsx](../../src/app/(main)/admin/users/page.tsx) |
| `/admin/roles` | `admin.manage_roles` | [admin/roles/page.tsx](../../src/app/(main)/admin/roles/page.tsx) |
| `/admin/audit` | `audit.view` | [admin/audit/page.tsx](../../src/app/(main)/admin/audit/page.tsx) |
| `/admin` (other) | `admin.view` | — |
| `/financeiro` (+ all sub-routes) | `finance.view` | [financeiro/*](../../src/app/(main)/financeiro/) |
| `/contratos` | `contracts.view` | [contratos/page.tsx](../../src/app/(main)/contratos/page.tsx) |
| `/projetos`, `/projects` | `projects.view` | [projetos/*](../../src/app/(main)/projetos/) |
| `/riscos` | `risks.view` | [riscos/page.tsx](../../src/app/(main)/riscos/page.tsx) |
| `/workforce-cost`, `/pessoas` | `people.view` | [workforce-cost/page.tsx](../../src/app/(main)/workforce-cost/page.tsx) |
| `/organograma` | `org_chart.view` | [organograma/page.tsx](../../src/app/(main)/organograma/page.tsx) |
| `/membros`, `/comites` | `committees.view` | [comites/*](../../src/app/(main)/comites/) |
| `/reunioes` | `meetings.view` | [reunioes/*](../../src/app/(main)/reunioes/) |
| `/atas` | `minutes.view` | [atas/page.tsx](../../src/app/(main)/atas/page.tsx) |
| `/deliberacoes`, `/pautas`, `/votacoes` | `deliberations.view` | [deliberacoes/*](../../src/app/(main)/deliberacoes/) |
| `/historico` | `audit.view` | [historico/page.tsx](../../src/app/(main)/historico/page.tsx) |
| `/roles` (alias) | `admin.manage_roles` | [roles/page.tsx](../../src/app/(main)/roles/page.tsx) |
| `/relatorios` | `dashboard.view` (loose) | [relatorios/page.tsx](../../src/app/(main)/relatorios/page.tsx) |
| `/workflows` | `dashboard.view` (loose) | [workflows/page.tsx](../../src/app/(main)/workflows/page.tsx) |

### 5.5 Redirect rules

| Condition | Redirect to | Where |
|---|---|---|
| Unauthenticated on protected route | `/login?next=<pathname>` | [middleware.ts:105-112](../../src/utils/supabase/middleware.ts#L105-L112) |
| Authenticated on `/login` | `/dashboard` | [middleware.ts:114-116](../../src/utils/supabase/middleware.ts#L114-L116) |
| Authenticated, no `organization_id` | `/onboarding` | [middleware.ts:126-128](../../src/utils/supabase/middleware.ts#L126-L128) |
| Profile `status != 'active'` | `/access-restricted` | [middleware.ts:131-139](../../src/utils/supabase/middleware.ts#L131-L139) |
| Authenticated but missing required permission | `/access-restricted` | [middleware.ts:141-152](../../src/utils/supabase/middleware.ts#L141-L152) |

---

## 6. Sidebar / Menu Visibility Rules

Source: [src/components/layout/app-sidebar.tsx:112-242](../../src/components/layout/app-sidebar.tsx#L112-L242).

### 6.1 Filtering logic
Each `MENU_ITEM` declares one of:
- `permission: <key>` — visible only if user holds that permission
- `anyPermission: [<key>, …]` — visible if user holds **any** of these
- `alwaysVisibleWhenAuthenticated: true` — visible to any logged-in user
- (none) — visible by default

`subItems[]` are filtered with the same rules; if **all** subItems are hidden, the parent
should be hidden too (currently the parent stays visible — see §9 Recommended Fixes).

### 6.2 Main section
| Label | Route | Visibility |
|---|---|---|
| Dashboard | `/dashboard` | `dashboard.view` |
| Financeiro | `/financeiro` | `finance.view` (+ 13 sub-items, each filtered by `finance.*`) |
| Projetos | `/projetos` | `projects.view` (+ Overview, Operations 3D) |
| Reuniões | `/reunioes` | `meetings.view` |
| Deliberações | `/deliberacoes` | `deliberations.view` |
| Riscos | `/riscos` | `risks.view` |
| Contratos | `/contratos` | `contracts.view` |
| Workforce Cost | `/workforce-cost` | `people.view` |
| Organograma | `/organograma` | `org_chart.view` |

### 6.3 Admin section
| Label | Route | Visibility |
|---|---|---|
| Comitês | `/comites` | `committees.view` |
| Manage Members | `/admin/users` | `admin.manage_users` |
| Global Roles | `/admin/roles` | `admin.manage_roles` |
| Workflows | `/workflows` | `admin.view` |
| Atas | `/atas` | `minutes.view` |
| Notificações | `/notificacoes` | `admin.view` |
| Relatórios | `/relatorios` | `anyPermission`: `dashboard.export`, `finance.export`, `projects.export`, `audit.export` |
| Histórico/Audit | `/admin/audit` | `audit.view` |

---

## 7. API Routes — Server-Side Permission Enforcement

| Route | Method | Permission | Source |
|---|---|---|---|
| `/api/ai/risk-scan/contracts/[id]` | POST | `risks.ai_scan` | inline check ([route.ts](../../src/app/api/ai/risk-scan/contracts/[id]/route.ts)) |
| `/api/ai/risk-scan/projects/[id]` | POST | `risks.ai_scan` | inline check ([route.ts](../../src/app/api/ai/risk-scan/projects/[id]/route.ts)) |
| `/api/ai/risk-scan/finance` | POST | `risks.ai_scan` | inline check ([route.ts](../../src/app/api/ai/risk-scan/finance/route.ts)) |
| `/api/ai/risks/[id]/dismiss` | POST | `risks.ai_dismiss` + org-match | inline check ([route.ts](../../src/app/api/ai/risks/[id]/dismiss/route.ts)) |
| `/api/integrations/esocial/events` | GET | `admin.manage_integrations` | via [api-guard.ts](../../src/lib/auth/api-guard.ts) — added 2026-05-14 |
| `/api/integrations/esocial/health` | GET | `admin.manage_integrations` | via api-guard — added 2026-05-14 |
| `/api/integrations/esocial/payroll-summary` | GET | `admin.manage_integrations` | via api-guard — added 2026-05-14 |
| `/api/integrations/esocial/schedule` | PATCH | `admin.manage_integrations` | via api-guard — added 2026-05-14 |
| `/api/integrations/esocial/sync-now` | POST | `admin.manage_integrations` | via api-guard — added 2026-05-14 |
| `/api/integrations/esocial/sync-runs` | GET | `admin.manage_integrations` | via api-guard — added 2026-05-14 |
| `/api/integrations/esocial/validate-certificate` | POST | `admin.manage_integrations` | via api-guard — added 2026-05-14 |
| `/api/integrations/esocial/workforce-summary` | GET | `admin.manage_integrations` | via api-guard — added 2026-05-14 |

> **Note on the service layer** ([src/lib/services/](../../src/lib/services/)): functions like `upsertProjectsToSupabase`, `getRisks`, `createRisk`, `getDeliberations` execute via the **anon-keyed** Supabase client and rely on RLS for authorization. They do not perform inline permission checks. RLS policies (migrations 007/008/009/010/011/012) provide the enforcement.

---

## 8. Risky Pages / Actions — Audit Findings

### 8.1 Resolved by this audit
- **eSocial integration API** ([src/app/api/integrations/esocial/](../../src/app/api/integrations/esocial/))
  was completely unauthenticated — anyone could trigger `sync-now`, modify `schedule`, or read
  payroll/workforce summaries. **Fixed**: now require `admin.manage_integrations` via
  [src/lib/auth/api-guard.ts](../../src/lib/auth/api-guard.ts).

### 8.2 Open / accepted (require future work — see §10)

| # | Risk | Where | Severity | Recommendation |
|---|------|-------|---|---|
| R1 | **Finance tables lack `organization_id`** — cross-org leakage possible if multi-tenant added | 17 finance tables (007 line 425 note) | High (latent) | Add `organization_id` migration + RLS scope; tracked in 007 comment |
| R2 | **`finance.admin` / `finance.edit` permissions referenced but not seeded** — bridge function `has_finance_role_or_perm` accepts them but no role grants them | [007_auth_rbac_hardening.sql:210-223](../../supabase/migrations/007_auth_rbac_hardening.sql#L210) | Medium | Seed perms + grant to `financeiro` and `owner_admin` |
| R3 | **Admin pages `/admin/users` and `/admin/roles` are read-only stubs** — they fetch and display data but do not implement create/update/delete | [admin/users/page.tsx](../../src/app/(main)/admin/users/page.tsx), [admin/roles/page.tsx](../../src/app/(main)/admin/roles/page.tsx) | Low (UX) | Implement CRUD as part of "Funções Globais & Acessos" (§9) |
| R4 | **Sidebar parent stays visible when all sub-items are filtered out** — e.g., Financeiro group could appear as bare label for a user with `finance.view` but no sub-permissions | [app-sidebar.tsx](../../src/components/layout/app-sidebar.tsx) | Low (UX) | Hide parent when `subItems.length === 0` after filtering |
| R5 | **`/relatorios` and `/workflows` use loose `dashboard.view` middleware gate** — sidebar uses tighter `anyPermission` of export keys (relatorios) and `admin.view` (workflows). Middleware is more permissive than UI. | [middleware.ts:43-45](../../src/utils/supabase/middleware.ts#L43-L45) | Low | Tighten middleware to match sidebar (`admin.view` for workflows, export-perms for relatorios) |
| R6 | **`/api` routes (other than the ones above) bypass middleware permission gates** — middleware checks `ROUTE_PERMISSIONS` only against page paths. Any new API route must add inline checks. | [middleware.ts:142](../../src/utils/supabase/middleware.ts#L142) | Convention | Document and enforce: every `route.ts` under `src/app/api/` must call `requireApiPermission()` or equivalent. Add a lint rule or CI check. |
| R7 | **No `Viewer / Conselho` role seeded** — appears in plan but absent from system roles | [005_auth_rbac_foundation.sql:601-613](../../supabase/migrations/005_auth_rbac_foundation.sql#L601) | Low | Add migration when needed; permissions = `dashboard.view`, `meetings.view`, `deliberations.view`, `minutes.view`, `committees.view`, `audit.view` |
| R8 | **No user-level permission overrides table** — required by §7.4 of the plan | n/a | Schema | See §10.1 — proposed `user_permission_overrides` table |
| R9 | **No access-control change audit trail beyond generic `audit_logs`** — admin actions must log diff of perm changes | n/a | Schema | See §10.2 — leverage existing `audit_logs.metadata` jsonb |
| R10 | **Action-level UI gates inconsistent across pages** — some pages (riscos, deliberacoes, contratos detail) check perms; many use computed booleans like `roles?.some(r => r.key === 'owner_admin')` instead of permission keys ([contratos/page.tsx:221-231](../../src/app/(main)/contratos/page.tsx#L221)). | various | Low | Standardize on `hasPermission(<key>)` everywhere; avoid hardcoded role checks |

---

## 9. Proposed Structure — "Funções Globais & Acessos"

This section describes the admin-facing module that will let Owner/Admin users manage
roles, permissions, user assignments, and overrides directly inside the SaaS.

### 9.1 Module location
Mount under `/admin/access` with three top-level tabs:

```
/admin/access/roles         ← role list & permission matrix (replaces /admin/roles)
/admin/access/users         ← user list, role assignments, overrides
/admin/access/audit         ← change history (filtered view of audit_logs)
```

Add sidebar entry: **"Funções & Acessos"** under Admin section, gated by `admin.manage_roles`.

### 9.2 Pages & components

#### 9.2.1 Role list (`/admin/access/roles`)
- Card grid showing each role: name, description, user count badge, system/custom badge
- Actions per card: View matrix · Duplicate · Activate/Deactivate · Edit (custom only)
- Top bar: **+ New Role**, search, filter by system/custom, sort by user count
- Click → permission matrix for that role

#### 9.2.2 Permission matrix (`/admin/access/roles/[roleKey]`)
- **Rows:** modules (14, from `PERMISSION_GROUPS`)
- **Columns:** action verbs (View, Create, Edit, Delete, Approve, Vote, Export, Upload, AI Scan, AI Dismiss, Manage Settings)
- Cell renders one of: ✓ (granted) · — (not applicable for module) · 🔒 (system role, locked)
- Toggle in cell flips `role_permissions` row (only for non-system roles, or behind a guarded "force edit" flag)
- "Save changes" button writes batch INSERT/DELETE to `role_permissions` and emits `audit_logs` entry with diff

#### 9.2.3 User list (`/admin/access/users`)
- Table: avatar, name, email, current role(s), department, status, last login
- Filter: role · department · status · has-overrides
- Click row → user detail drawer

#### 9.2.4 User detail drawer
- Profile summary
- **Roles assigned** chip group (add/remove with confirmation)
- **Permission overrides** section (see §9.2.5)
- **Computed permissions** read-only list ("from role X · from override · from admin inheritance")

#### 9.2.5 User overrides UI
- Add row: pick permission key from autocomplete; choose Grant/Revoke; optional reason
- Each override displays source badge: 🟦 ROLE · 🟪 OVERRIDE-GRANT · 🟥 OVERRIDE-REVOKE
- Save → INSERT to `user_permission_overrides` (proposed table — §10.1) + `audit_logs`

#### 9.2.6 Access preview (modal)
Available from role detail and user detail.
- Pick role OR user
- Renders read-only sidebar + a list of "Visible modules / Hidden modules / Available actions / Blocked pages"
- Pure simulation — never sets a session

#### 9.2.7 Audit tab (`/admin/access/audit`)
- Filtered view of `audit_logs` where `action LIKE 'access.%'`
- Show: actor, target user/role, before→after diff, timestamp, reason

### 9.3 Safety rules implementation
- **Cannot remove own admin access**: when toggling permission, compare `target_user_id === auth.uid() && permission_key === 'admin.manage_roles'` → block + warn
- **At least one Owner/Admin must remain active**: before deactivating a user or removing `owner_admin` role, query `count(user_roles WHERE role.key='owner_admin' AND profiles.status='active') > 1` → block if not
- **Confirm dangerous changes**: any toggle on `admin.*` or `*.delete` shows a confirm modal with consequence preview
- **Sidebar reactivity**: invalidate `usePermissions()` cache after save → `refresh()` → menus update without reload

### 9.4 UI/UX direction
- Glass / HUD aesthetic consistent with [docs/GLASS-HUD-DESIGN-SYSTEM.md](../GLASS-HUD-DESIGN-SYSTEM.md)
- Permission matrix uses tinted cells (granted=cyan-glow, locked=neutral, denied=transparent)
- Critical permission badges (red dot) on `admin.*` and `*.delete`
- Light/dark contrast verified via existing tokens
- Responsive table with horizontal scroll, sticky first column (module name)

### 9.5 API surface (server actions)
All routes guarded by `requireApiPermission('admin.manage_roles')`:

```
POST   /api/admin/roles                     — create custom role
PATCH  /api/admin/roles/[roleId]            — rename/describe
POST   /api/admin/roles/[roleId]/duplicate  — clone
PATCH  /api/admin/roles/[roleId]/permissions — diff-based grant/revoke
POST   /api/admin/users/[userId]/roles      — assign role
DELETE /api/admin/users/[userId]/roles/[roleId]
POST   /api/admin/users/[userId]/overrides  — grant/revoke specific permission
DELETE /api/admin/users/[userId]/overrides/[permKey]
GET    /api/admin/access/preview?role=... or ?user=...  — simulate
GET    /api/admin/access/audit              — paginated change log
```

---

## 10. Required Schema Changes (proposals — not yet implemented)

These are **proposals only**. They are NOT part of the safe fixes applied in this audit.
Each must be a discrete migration reviewed before applying.

### 10.1 `user_permission_overrides` (new table)
```sql
CREATE TABLE public.user_permission_overrides (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  permission_id   uuid NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
  effect          text NOT NULL CHECK (effect IN ('grant','revoke')),
  reason          text,
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz DEFAULT now(),
  UNIQUE (user_id, organization_id, permission_id)
);

-- Update current_user_has_permission() to UNION role-derived perms with grants
-- and EXCEPT revokes from this table.
```

### 10.2 Audit-log conventions for access changes
No schema change needed — reuse existing `audit_logs` with conventions:

| `action` | `entity_type` | `entity_id` | `metadata` |
|---|---|---|---|
| `access.role.create` | `role` | role_id | `{ key, name }` |
| `access.role.permission_grant` | `role_permission` | role_id | `{ permission_key, role_key }` |
| `access.role.permission_revoke` | `role_permission` | role_id | `{ permission_key, role_key }` |
| `access.user.role_assign` | `user_role` | user_id | `{ role_key, by }` |
| `access.user.role_revoke` | `user_role` | user_id | `{ role_key, by }` |
| `access.user.override_grant` | `user_permission_override` | user_id | `{ permission_key, reason }` |
| `access.user.override_revoke` | `user_permission_override` | user_id | `{ permission_key, reason }` |

### 10.3 Seed `Viewer / Conselho` role
```sql
INSERT INTO public.roles (organization_id, key, name, description, is_system_role)
VALUES (NULL, 'viewer_conselho', 'Viewer / Conselho',
        'Read-only access for board members and external observers', true);

-- Grant: dashboard.view, meetings.view, deliberations.view, deliberations.view_committee,
--        minutes.view, committees.view, audit.view
```

### 10.4 Seed `finance.admin` and `finance.edit` (close R2)
```sql
INSERT INTO public.permissions (key, module, action, description) VALUES
 ('finance.admin', 'finance', 'admin', 'Administração geral do módulo financeiro'),
 ('finance.edit',  'finance', 'edit',  'Edição genérica em entidades financeiras')
ON CONFLICT (key) DO NOTHING;

-- Grant finance.admin to owner_admin; finance.edit to financeiro
```

### 10.5 Add `organization_id` to finance tables (close R1)
Multi-step migration — out of scope for current audit. Tracked under finance hardening backlog.

---

## 11. Recommended Fixes (priority order)

| # | Fix | Status |
|---|---|:---:|
| F1 | Add auth+permission guard to all `/api/integrations/esocial/*` routes | ✅ done (Phase 1) |
| F2 | Create reusable `requireApiPermission()` helper for server routes | ✅ done (Phase 1) |
| F3 | Tighten `/relatorios` and `/workflows` middleware permissions to match sidebar (R5) | ✅ done (Phase 2) |
| F4 | Hide sidebar parent when all sub-items filtered out (R4) | ⬜ deferred |
| F5 | Replace hardcoded role checks in pages (e.g. `roles?.some(r => r.key === 'owner_admin')`) with permission keys (R10) | ✅ done (Phase 2) |
| F6 | Implement `Viewer / Conselho` role seed (R7, §10.3) | ⬜ proposal |
| F7 | Seed `finance.admin` / `finance.edit` permissions (R2, §10.4) | ✅ done (Phase 2 — migration 013) |
| F8 | Implement `user_permission_overrides` (R8, §10.1) | ⬜ proposal (Phase 2+) |
| F9 | Build "Funções Globais & Acessos" UI (§9) | ⬜ planned |
| F10 | Add `organization_id` to finance tables (R1, §10.5) | ⬜ deferred (Phase 2+) |
| F11 | API permission-enforcement convention / lint rule (R6) | ⬜ proposal (§15) |

---

## 12. Implemented Safe Fixes — Summary (this audit)

**Date:** 2026-05-14
**Constraints honored:** No DB reset · No demo data deletion · No Anthropic API toggling · No finance business-logic change · No destructive change · No schema change.

### 12.1 New helper
- **[src/lib/auth/api-guard.ts](../../src/lib/auth/api-guard.ts)** — `requireApiPermission(permissionKey)` server-side helper. Authenticates via Supabase, checks the permission via the existing `current_user_has_permission` RPC, returns either `{ ok, userId }` or a ready-to-return `NextResponse` with 401/403/500 JSON.
  - Mirrors the inline pattern already used by `/api/ai/*` routes — no new conventions, no new abstractions.

### 12.2 eSocial integration routes — closed unauthenticated access
All 8 endpoints under [src/app/api/integrations/esocial/](../../src/app/api/integrations/esocial/) now require `admin.manage_integrations`:

| Endpoint | Method | Before | After |
|---|---|---|---|
| `events` | GET | no auth | `admin.manage_integrations` |
| `health` | GET | no auth | `admin.manage_integrations` |
| `payroll-summary` | GET | no auth | `admin.manage_integrations` |
| `schedule` | PATCH | no auth | `admin.manage_integrations` |
| `sync-now` | POST | no auth | `admin.manage_integrations` |
| `sync-runs` | GET | no auth | `admin.manage_integrations` |
| `validate-certificate` | POST | no auth | `admin.manage_integrations` |
| `workforce-summary` | GET | no auth | `admin.manage_integrations` |

Permission `admin.manage_integrations` is already seeded in [005_auth_rbac_foundation.sql:508](../../supabase/migrations/005_auth_rbac_foundation.sql#L508) and granted to `owner_admin` (via the catch-all CTE).

### 12.3 What was NOT changed (kept stable)
- No migration files added or modified.
- No role/permission seeds added.
- No middleware route added (could be added later for defense-in-depth — see F3/R5/R6).
- No UI component changed.
- No service-layer change.
- No finance / risks / contracts / deliberations business logic changed.
- TypeScript compilation passes (`npx tsc --noEmit` returns clean).

---

## 13. Smoke-Test Checklist

Use this list manually after each access-control change.

### Authentication
- [ ] Unauthenticated user hitting `/dashboard` → redirected to `/login?next=/dashboard`
- [ ] Authenticated user hitting `/login` → redirected to `/dashboard`
- [ ] User with no `organization_id` → redirected to `/onboarding`
- [ ] User with `status != 'active'` → redirected to `/access-restricted`

### Authorization (per role)
- [ ] `owner_admin` sees every menu item, can access `/admin/users`, `/admin/roles`, `/admin/audit`
- [ ] `financeiro` sees Finance group expanded; cannot access `/admin/*`
- [ ] `juridico_contratos` sees Contratos with edit/upload/AI buttons; cannot access Finance
- [ ] `gestor_projetos` sees Projetos with create button; cannot access `/financeiro` or `/admin/*`
- [ ] `rh` sees Workforce + Org chart; cannot access `/financeiro`, `/contratos`, `/admin/*`
- [ ] `engenharia_pcp` sees Projetos + Riscos; cannot access `/financeiro`, `/admin/*`
- [ ] Direct URL navigation to a denied page → `/access-restricted`

### API enforcement
- [ ] `curl POST /api/integrations/esocial/sync-now` (no cookies) → 401
- [ ] `curl POST /api/integrations/esocial/sync-now` as `gestor_projetos` → 403
- [ ] `curl POST /api/integrations/esocial/sync-now` as `owner_admin` → 200
- [ ] `curl POST /api/ai/risk-scan/projects/<id>` as user without `risks.ai_scan` → 403
- [ ] `curl POST /api/ai/risks/<id>/dismiss` as user from a different org → 403

### UI gating (consistency)
- [ ] On `/projetos`, "Novo Projeto" button is hidden for users without `projects.create`
- [ ] On `/contratos`, "Excluir" is hidden for users without `contracts.delete`
- [ ] On `/riscos`, "Dispensar IA" is hidden for users without `risks.ai_dismiss`
- [ ] On `/deliberacoes`, "Votar" is hidden for users without `deliberations.vote`

---

## 14. Phase 2 Hardening Plan

Phase 2 closes the safest gaps identified in Phase 1 without touching schema risk
zones (Finance multi-tenancy, user-override table). Goal: harden RBAC immediately
before the production data migration, without cascading changes to UI or business logic.

### 14.1 Naming convention decision (R2)

**Decision:** use `finance.edit` (NOT `finance.update`).

Verified against existing seeds in [005_auth_rbac_foundation.sql](../../supabase/migrations/005_auth_rbac_foundation.sql):
the canonical action verb across every module is **`edit`** —
`projects.edit`, `contracts.edit`, `risks.edit`, `meetings.edit`, `minutes.edit`,
`people.edit`, `org_chart.edit`, `committees.edit`, `project_gantt.edit`.
Introducing `finance.update` would split semantics and force every future RLS
helper to check both spellings. The bridge function `has_finance_role_or_perm`
in [007_auth_rbac_hardening.sql:226-334](../../supabase/migrations/007_auth_rbac_hardening.sql#L226)
already references `finance.edit` directly — so the migration only needs to seed it.

### 14.2 Phase 2 — implemented (this iteration)

| ID | Change | Files |
|---|---|---|
| **F7 / R2** | New migration `013_finance_perm_seeds.sql` seeds `finance.admin` and `finance.edit`, grants both to `owner_admin`, grants `finance.edit` to `financeiro`. Idempotent (`ON CONFLICT DO NOTHING`); no schema change; mirrors the seed pattern from 011/012. | [supabase/migrations/013_finance_perm_seeds.sql](../../supabase/migrations/013_finance_perm_seeds.sql), [src/lib/auth/permissions.ts](../../src/lib/auth/permissions.ts) (added `finance.admin`, `finance.edit` to UI catalog) |
| **F5 / R10** | Removed hardcoded `roles.some(r => r.key === 'owner_admin')` in `contratos/page.tsx`. `owner_admin` automatically holds `projects.delete` / `contracts.delete` via the catch-all CTE in 005, so a permission-only check is equivalent and safer. Also removed the `admin.manage_users` fallback (semantically wrong for delete actions); kept `admin.manage_organization` as the broader admin escape hatch. Dropped now-unused `roles` from the `usePermissions()` destructure. | [src/app/(main)/contratos/page.tsx:121,221-228](../../src/app/(main)/contratos/page.tsx#L221) |
| **F3 / R5** | Extended `ROUTE_PERMISSIONS` middleware to support `anyPermission?: string[]` (matching the existing sidebar API). `/workflows` now requires `admin.view` (was loose `dashboard.view`); `/relatorios` now requires any of `dashboard.export`, `finance.export`, `projects.export`, `audit.export` (matches sidebar). New helper `checkRoutePermission()` calls `current_user_has_permission` per key and short-circuits on first match. | [src/utils/supabase/middleware.ts:15-71,141-150](../../src/utils/supabase/middleware.ts#L15) |

**Verification:** `npm run typecheck` clean · `npx next lint` on changed files clean.

### 14.3 Phase 2 — proposed only (NOT implemented in this iteration)

| ID | Topic | Why deferred | Proposed shape |
|---|---|---|---|
| **R8** | `user_permission_overrides` table + UI | Touches schema (new table) + needs `current_user_has_permission` rewrite to UNION/EXCEPT overrides. Coordinated rollout required. | See §14.4 below — schema, RLS, UI flow. |
| **R1** | Finance tables get `organization_id` | High-risk: 17 tables, complex backfill, cross-team coordination. Out of scope until Finance tenancy refactor. | Tracked as Phase 2+ Finance backlog item. Keep documented. |
| **R6** | API enforcement convention / lint rule | Lightweight proposal only — see §15. | Documented; no code yet. |

### 14.4 R8 — `user_permission_overrides` proposed schema & flow (DO NOT APPLY YET)

**Schema (proposal):**
```sql
CREATE TABLE public.user_permission_overrides (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  permission_id   uuid NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
  effect          text NOT NULL CHECK (effect IN ('grant','revoke')),
  reason          text,
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz DEFAULT now(),
  expires_at      timestamptz,                  -- optional time-bound override
  UNIQUE (user_id, organization_id, permission_id)
);

CREATE INDEX idx_upo_user_org ON public.user_permission_overrides (user_id, organization_id);

ALTER TABLE public.user_permission_overrides ENABLE ROW LEVEL SECURITY;

-- Visible to admins and to the user themselves (read-only for the user).
CREATE POLICY upo_select ON public.user_permission_overrides FOR SELECT TO authenticated
  USING (
    organization_id = current_user_organization_id()
    AND (current_user_is_admin() OR user_id = auth.uid())
  );

-- Only admins can insert/update/delete.
CREATE POLICY upo_admin_write ON public.user_permission_overrides FOR ALL TO authenticated
  USING (current_user_is_admin() AND organization_id = current_user_organization_id())
  WITH CHECK (current_user_is_admin() AND organization_id = current_user_organization_id());
```

**Function rewrite:**
```sql
CREATE OR REPLACE FUNCTION public.current_user_has_permission(permission_key text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH org AS (
    SELECT current_user_organization_id() AS id
  ),
  role_perms AS (
    -- existing logic
    SELECT 1
      FROM public.user_roles ur
      JOIN public.role_permissions rp ON rp.role_id = ur.role_id
      JOIN public.permissions p ON p.id = rp.permission_id
     WHERE ur.user_id = auth.uid()
       AND ur.organization_id = (SELECT id FROM org)
       AND p.key = permission_key
  ),
  override AS (
    SELECT effect
      FROM public.user_permission_overrides upo
      JOIN public.permissions p ON p.id = upo.permission_id
     WHERE upo.user_id = auth.uid()
       AND upo.organization_id = (SELECT id FROM org)
       AND p.key = permission_key
       AND (upo.expires_at IS NULL OR upo.expires_at > now())
  )
  SELECT
    CASE
      WHEN EXISTS (SELECT 1 FROM override WHERE effect = 'revoke') THEN false
      WHEN EXISTS (SELECT 1 FROM override WHERE effect = 'grant')  THEN true
      ELSE EXISTS (SELECT 1 FROM role_perms)
    END;
$$;
```

**UI flow (lives inside §9 Funções Globais & Acessos):**
1. From user-detail drawer, "Add override" → autocomplete on `permissions.key`.
2. Choose Grant or Revoke; optional expiration; required reason.
3. Save → POST `/api/admin/users/[userId]/overrides` (guarded by `admin.manage_roles`).
4. Audit log entry: `access.user.override_grant` / `access.user.override_revoke` with `metadata.reason` and `metadata.permission_key`.
5. The user's "Computed permissions" panel shows source badge per key:
   `🟦 ROLE` · `🟪 OVERRIDE-GRANT` · `🟥 OVERRIDE-REVOKE` · `🟢 ADMIN-INHERITED`.

**Why we are NOT applying it now:**
- Function rewrite changes hot-path RBAC checks across every middleware request.
- Needs end-to-end test coverage that the project doesn't currently maintain for RLS helpers.
- Best paired with the §9 admin UI rollout, not landed in isolation.

---

## 15. R6 — API permission enforcement convention (proposal)

### 15.1 The convention

Every `route.ts` under `src/app/api/**` (except auth callbacks under `/api/auth/*`)
**must** call `requireApiPermission(<key>)` from
[src/lib/auth/api-guard.ts](../../src/lib/auth/api-guard.ts) as its first statement
inside each exported HTTP method handler, OR explicitly opt out with a comment marker:

```ts
// rbac:public  ← reserved for genuinely-public endpoints (none today)
// rbac:auth-only ← authenticated, no permission needed
// rbac:enforced-by:<file>:<line> ← gated by another file (e.g. inline check)
```

### 15.2 Lightweight enforcement (no new tooling)

Add a one-shot grep guard to CI, not a custom ESLint plugin:

```bash
# scripts/check-api-rbac.sh
#!/usr/bin/env bash
set -euo pipefail
missing=0
while IFS= read -r f; do
  if ! grep -qE "requireApiPermission|rbac:public|rbac:auth-only|rbac:enforced-by" "$f"; then
    echo "::error file=$f::API route missing permission guard or rbac:* marker"
    missing=$((missing + 1))
  fi
done < <(find src/app/api -name 'route.ts' -not -path '*/auth/*')

exit $missing
```

Wire into `package.json`:
```json
"scripts": {
  "check:api-rbac": "bash scripts/check-api-rbac.sh"
}
```

Add to existing CI check step (or pre-commit hook) — no new dependencies, no
ESLint plugin authoring, no AST traversal. If the project later moves to a
proper custom rule, the markers are already grep-friendly and easy to migrate.

### 15.3 Why this over a real ESLint rule

- Zero engineering cost; runs in <100ms on the current `src/app/api` tree.
- Catches the failure mode that actually matters (the dev forgot the guard).
- False positives are easy to suppress with the `rbac:*` marker comment.
- Migrating to an AST rule later is straightforward — the markers become the rule's allowlist.

**Status:** proposed. Not added to CI in this iteration; needs sign-off on
exact marker syntax and CI integration point.

---

## 16. Change Log

| Date | Change | By |
|---|---|---|
| 2026-05-14 | Initial audit + Phase 1 safe fixes (F1, F2). Created this document. | Claude (Opus 4.7) |
| 2026-05-14 | Phase 2: F3 (middleware tightening), F5 (drop hardcoded role check), F7 (seed finance.admin/edit via migration 013). Documented Phase 2+ proposals (R8 schema, R6 lint convention). Corrected AI-permission grant matrix (Phase 1 audit understated grants). | Claude (Opus 4.7) |
| 2026-05-14 | Phase 3: editable role-permission matrix (F9 partial). New API `PATCH /api/admin/roles/[roleId]/permissions` guarded by `admin.manage_roles`; `owner_admin` is locked. Audit-log entries `access.role.permission_grant` / `access.role.permission_revoke` written per change. UI converted from read-only to staged edit + Save/Discard. No schema change — existing RLS already permitted writes. | Claude (Opus 4.7) |
| 2026-05-14 | Phase 4: User-Role Assignment UI (F9 partial). New API `POST` / `DELETE /api/admin/users/[userId]/roles` guarded by `admin.manage_users`; uses service-role client (RLS in 007 blocks system-role assignment via authenticated client by design — see §18.2). Safety rails: last-active-owner_admin protection, self owner_admin lockout, self admin.manage_users lockout. Audit `access.user.role_assign` / `access.user.role_revoke`. `/admin/users` page rewritten with HudDrawer + effective-permissions panel. No schema change. | Claude (Opus 4.7) |

---

## 17. Phase 3 — Editable Role × Permission Matrix (implemented)

### 17.1 Convention reuse: `admin.manage_roles` (not `admin.permissions.manage`)

The Phase 3 brief mentioned `admin.permissions.manage` as the gating permission.
After inspection we deliberately reuse the existing `admin.manage_roles` instead, for the
same reason we picked `finance.edit` over `finance.update` in Phase 2: introducing a
parallel permission key for an action the platform already gates would split semantics
and force every existing RLS policy and middleware route entry to check both keys.

The existing `admin.manage_roles` permission already gates:
- the `/admin/roles` route (middleware [src/utils/supabase/middleware.ts:18](../../src/utils/supabase/middleware.ts#L18));
- the `roles_admin_manage` RLS policy ([005:367-371](../../supabase/migrations/005_auth_rbac_foundation.sql#L367));
- the `role_permissions_admin_manage` RLS policy ([005:390-394](../../supabase/migrations/005_auth_rbac_foundation.sql#L390));
- the page-level read gate ([admin/roles/page.tsx:40](../../src/app/(main)/admin/roles/page.tsx#L40)).

If a future requirement actually needs to *separate* "manage role assignments" from
"manage role-permission grants" (a legitimate split), the right move is a new perm
`admin.role_permissions.manage` introduced via migration alongside the role-vs-grant
UI separation. Until then, one key for one concern.

### 17.2 Schema check — no migration needed

The `role_permissions` table already has an INSERT/UPDATE/DELETE RLS policy gated by
`admin.manage_roles` — the brand-new admin user therefore writes through their own
authenticated client (not the service-role key). No service-role escalation, no
privilege drift. The schema as it stands is sufficient for safe editing.

### 17.3 API — `PATCH /api/admin/roles/[roleId]/permissions`

Source: [src/app/api/admin/roles/[roleId]/permissions/route.ts](../../src/app/api/admin/roles/[roleId]/permissions/route.ts)

**Request body:**
```json
{ "grant": ["projects.export", "finance.view"], "revoke": ["risks.delete"] }
```

**Response (success):**
```json
{ "ok": true, "applied": 3, "granted": 2, "revoked": 1 }
```

**Behavior:**
1. Calls `requireApiPermission('admin.manage_roles')` — returns 401 if unauthenticated, 403 otherwise.
2. Validates: `roleId` present, `grant`/`revoke` non-overlapping, all keys exist in `permissions` table.
3. Loads target role; rejects with 404 if not found, 403 if it belongs to a different org.
4. **Refuses any mutation against `owner_admin`** (HTTP 409 with explanation). This is the safety rail (§17.4).
5. Resolves permission keys → IDs in one query.
6. `upsert` the grant rows (idempotent via `onConflict: 'role_id,permission_id'`).
7. `delete` the revoke rows.
8. Inserts one `audit_logs` row per change (`access.role.permission_grant` / `access.role.permission_revoke`) with `metadata = { permission_key, role_key, role_name }`. Audit failures surface as `audit_warning` but do not roll back (audit_logs is append-only telemetry).

### 17.4 Safety rules — how each is enforced

| Rule (from brief) | How it's enforced |
|---|---|
| Platform never ends up without a functional Owner/Admin | `owner_admin` is hard-locked: API returns 409 on any grant/revoke against it; UI hides the Save/Discard bar and disables every pill when this role is selected. |
| Last admin cannot lose `admin.manage_roles` | Direct corollary of the rule above — `owner_admin` always holds every permission, and a non-owner_admin role losing `admin.manage_roles` does not strand the platform because `owner_admin` still grants it. (User-level last-admin protection — i.e. preventing the only `owner_admin` *user* from being deactivated — is a separate user-roles concern, addressed in §9.3 of this doc and not part of Phase 3.) |
| All permission changes logged in `audit_logs` | One row per granted or revoked key, written from the same authenticated session via the existing `audit_logs_insert_authenticated` policy ([005:494-500](../../supabase/migrations/005_auth_rbac_foundation.sql#L494)). |
| Updates reflected in sidebar/route/buttons | After a successful save, the page calls `loadRoles()` (refreshes the matrix display) **and** `refreshUser()` from `useCurrentUser` — the latter re-fetches the calling user's permissions, which propagates to `usePermissions()`/`useCanAccessModule()` everywhere via the auth state change subscription. Sidebar items, action buttons and route gates re-evaluate without a page reload. |
| Reuse existing RBAC conventions | API uses `requireApiPermission` from Phase 1; permission catalog uses existing `PERMISSION_GROUPS`; all writes go through normal RLS (no service-role key); audit log uses the existing convention spec'd in §10.2. |

### 17.5 UI changes — `/admin/roles` ([src/app/(main)/admin/roles/page.tsx](../../src/app/(main)/admin/roles/page.tsx))

- Each permission pill is now a `<button>` that toggles the local draft `Set<string>`.
- Pills show three states: **active** (granted), **neutral/40% opacity** (not granted), **ringed** (modified vs. server snapshot).
- Each module card shows `active/total` so admins can see at a glance how complete the grant is for that module.
- Sticky bottom bar with **Save alterações** / **Descartar** appears only when `isDirty`.
- For `owner_admin`: pills are disabled, bottom bar hidden, and a `🔒 Protegida` badge is shown in the role header.
- After save: `loadRoles()` + `refreshUser()` so the calling user sees their own perm changes immediately.
- Save errors and successes show inline (no toast dependency).

### 17.6 What was NOT changed

- No new permission key introduced.
- No migration.
- No change to the `roles` table or to user-role assignment (still read-only / managed in `/admin/users`).
- No change to system roles other than the lock on `owner_admin`. Other system roles (`ceo_diretoria`, `financeiro`, etc.) remain editable — their `is_system_role=true` flag is reflected in the UI as a "Sistema" badge but does not block edits, matching the existing RLS policy which also does not block them.
- `user_permission_overrides` (R8) intentionally not implemented — kept as proposal in §14.4 to be paired with the §9 Funções Globais & Acessos rollout.

---

## 18. Phase 4 — User-Role Assignment UI (implemented)

### 18.1 Convention reuse: `admin.manage_users` (not `admin.manage_roles`)

The Phase 4 brief asked the new API to require `admin.manage_roles`. We deliberately
require `admin.manage_users` instead, for the same reason we picked `finance.edit`
over `finance.update` in Phase 2 and `admin.manage_roles` over `admin.permissions.manage`
in Phase 3: the platform already has a canonical key for "managing users and their
role assignments" — `admin.manage_users` — and it is what gates:

- the `/admin/users` route ([src/utils/supabase/middleware.ts:17](../../src/utils/supabase/middleware.ts#L17));
- the `user_roles_admin_manage` RLS policy ([007:92-107](../../supabase/migrations/007_auth_rbac_hardening.sql#L92));
- the `profiles_admin_manage` RLS policy ([005:336-352](../../supabase/migrations/005_auth_rbac_foundation.sql#L336));
- the page-level read gate ([admin/users/page.tsx:64](../../src/app/(main)/admin/users/page.tsx#L64));
- the existing `user_role` write code path.

Routing the new endpoint through `admin.manage_users` keeps API/RLS/UI/middleware in
agreement. If a future requirement actually needs to *separate* "manage user profiles"
from "manage user-role assignments" (a legitimate split), the right move is a new perm
`admin.user_roles.manage` introduced via a migration alongside the UI separation.

### 18.2 Schema check — service-role API path required (NO migration)

The hardened RLS policy for `user_roles` ([007:92-107](../../supabase/migrations/007_auth_rbac_hardening.sql#L92))
intentionally rejects **system-role assignments via the user's authenticated client**:

```sql
WITH CHECK (
  organization_id = current_user_organization_id()
  AND current_user_has_permission('admin.manage_users')
  AND EXISTS (
    SELECT 1 FROM roles r
    WHERE r.id = role_id
      AND r.organization_id = current_user_organization_id()  -- system roles fail here
  )
);
```

Migration 007 lines 85-89 spell out the design choice: *"assigning a system role to
another org must go through a service-role path."* All seven default roles
(`owner_admin`, `ceo_diretoria`, `financeiro`, `juridico_contratos`, `gestor_projetos`,
`rh`, `engenharia_pcp`) have `organization_id IS NULL`, so the inline write the legacy
`/admin/users/page.tsx` was doing would silently fail under 007 in production.

Two options were considered:
1. **Loosen RLS** — extend WITH CHECK to allow `r.organization_id IS NULL`.
   Requires a migration; weakens a deliberate hardening.
2. **Server-side API + service-role client** — bypass RLS in a controlled,
   audited route handler that re-validates everything 007's WITH CHECK guarded.
   Same pattern already used by `/api/ai/risks/[id]/dismiss` and the AI scanner
   endpoints. **No schema change.**

Picked option 2. The new endpoint re-implements every guard 007's WITH CHECK
imposed (caller's permission, target user's org, role's org), plus the safety
rails the brief required (last-admin, self-lockout) which RLS could not express
declaratively anyway.

### 18.3 API — `POST` / `DELETE /api/admin/users/[userId]/roles`

Source: [src/app/api/admin/users/[userId]/roles/route.ts](../../src/app/api/admin/users/[userId]/roles/route.ts)

**`POST` body** — `{ role_id: string }`. Idempotent `upsert` (re-assigning an
existing role is a no-op). Validates: caller has `admin.manage_users`, target
user is in caller's org, target role is system or in caller's org.

**`DELETE` query** — `?role_id=<uuid>`. Runs three safety checks (§18.4) before
the actual delete; any failure returns HTTP 409 with a `code` discriminator the
UI uses to localize the message.

Both endpoints write one `audit_logs` row per change with action
`access.user.role_assign` / `access.user.role_revoke` and metadata
`{ role_key, role_name, role_id, target_user_id, target_user_name }`
(plus `self: true` on revokes-of-self). Audit failures surface as `audit_warning`
in the response but do not roll back the mutation (audit_logs is append-only telemetry).

### 18.4 Safety rails — what's enforced server-side

| Rule | How it's enforced | Returned code |
|---|---|---|
| Never strand the org without an active `owner_admin` user | Before deleting a row whose role key is `owner_admin`, count active `owner_admin` users in the org. If `count - 1 < 1`, refuse. | `last_admin_protection` |
| Admin cannot remove their own `owner_admin` role | If `targetUserId === actorUserId` and `role.key === 'owner_admin'`, refuse with a friendlier message (the count check would catch this only when caller is the *last* admin — this rail catches it always). | `self_owner_lockout` |
| Admin cannot remove a role from themselves if it would drop their own `admin.manage_users` | Pre-compute the calling user's permission set excluding the role being removed; refuse if `admin.manage_users` is not in the residual set. | `self_perm_lockout` |
| Caller's org matches target user's org | Both target profile and role are loaded server-side via service-role; reject if `organization_id` mismatch. | n/a (403) |
| Role belongs to system OR caller's org | Reject roles from other orgs. | n/a (403) |

**What is NOT covered (intentionally, see §18.7):**
- Bulk role assignment (one-at-a-time only).
- Time-bound role assignments (no `expires_at`).
- Invite/create new users (button is "Convite em breve" placeholder).
- User-permission overrides (R8 — kept as proposal in §14.4).

### 18.5 UI changes — `/admin/users` ([src/app/(main)/admin/users/page.tsx](../../src/app/(main)/admin/users/page.tsx))

- Modal → **HudDrawer** (right side, 540 px) so the user can keep the table visible while editing.
- Three stacked panels in the drawer:
  1. **Perfil** — name, job title, department, phone, status (writes via existing client + RLS).
  2. **Roles atribuídas** — chips with × to remove, dropdown + button to assign. Calls the new API; displays inline error/success.
  3. **Permissões efetivas (N)** — computed locally from `permsByRole` × user's roles, grouped by module, shown as active pills with `granted/total` badge per group.
- Header pills: status, "Você" badge if drawer user is the calling admin, "Owner/Admin" critical badge if the user holds that role.
- Inline confirm prompt (`window.confirm`) before role removal.
- After a successful assign/remove on the calling admin's *own* user, calls `refreshUser()` so sidebar and route gates re-evaluate immediately.

### 18.6 What was NOT changed

- No schema change.
- No new permission key introduced.
- The legacy `logAuditEvent()` helper used by the profile-update path is unchanged
  (it uses the authenticated client and already satisfies the `audit_logs_insert_authenticated`
  policy). The new role-assignment endpoint emits the same shape directly via the API client.
- `/admin/roles` (Phase 3) is unchanged.
- No change to `current_user_has_permission`, no change to `useCurrentUser`.

### 18.7 Open follow-ups (Phase 5+ candidates)

| ID | Topic | Notes |
|---|---|---|
| F12 | Bulk role assignment (assign N users to one role at once) | UI-driven; reuses the same API in a loop or extend the API to accept `user_ids: string[]`. |
| F13 | Custom role create / duplicate / delete | Touches `roles` table (currently only seeded from migrations); needs `roles_admin_manage` RLS to be exercised + audit trail. |
| F14 | User invite flow | New endpoint to provision a Supabase auth user + profile + initial role assignment. |
| F15 | User-permission overrides | R8 — see §14.4 for full proposal; pair with this UI when ready. |
| F16 | Time-bound role assignments (`user_roles.expires_at`) | Schema change; likely paired with R8 expirations. |

---

## 19. Phase 5 — RBAC Validation Report (pre-data-load)

**Purpose:** final RBAC sign-off before the database reset / real-data load.
**What this section is:** a static, code-trace verification of every smoke-test scenario in
the brief, plus a runbook ([scripts/smoke-test-rbac-phase4.md](../../scripts/smoke-test-rbac-phase4.md))
the user can execute against a running stack.

**What this section is NOT:** a live browser run. The validating agent did not have
Supabase credentials in this session. Every claim below is traced to a specific file:line
in the code, but the final live-environment confirmation requires the manual runbook.

### 19.1 Validation matrix

Each scenario is traced through the relevant code layer and the expected outcome is documented.

| # | Scenario | Layer | Code path | Expected | Status |
|---|---|---|---|---|---|
| V1 | Unauthenticated user hitting any protected page | Middleware | [src/utils/supabase/middleware.ts:105-112](../../src/utils/supabase/middleware.ts#L105) | 302 → `/login?next=<path>` | ✅ |
| V2 | Authenticated user lands on `/login` | Middleware | [middleware.ts:114-116](../../src/utils/supabase/middleware.ts#L114) | 302 → `/dashboard` | ✅ |
| V3 | Authenticated user without `organization_id` | Middleware | [middleware.ts:126-128](../../src/utils/supabase/middleware.ts#L126) | 302 → `/onboarding` | ✅ |
| V4 | Profile `status != 'active'` | Middleware | [middleware.ts:131-139](../../src/utils/supabase/middleware.ts#L131) | 302 → `/access-restricted` | ✅ |
| V5 | Permission missing for matched route | Middleware + RPC | [middleware.ts:141-150](../../src/utils/supabase/middleware.ts#L141), `current_user_has_permission` | 302 → `/access-restricted` | ✅ |
| V6 | `/relatorios` with no export perm (after Phase 2 F3) | Middleware `anyPermission` | [middleware.ts:48-71](../../src/utils/supabase/middleware.ts#L48) | 302 → `/access-restricted` | ✅ |
| V7 | Sidebar items hidden by permission | UI | [src/components/layout/app-sidebar.tsx:232-242](../../src/components/layout/app-sidebar.tsx#L232) | hidden | ✅ |
| V8 | Action buttons hidden by permission | UI | examples: [contratos/page.tsx:221-228](../../src/app/(main)/contratos/page.tsx#L221), [riscos/page.tsx:42-43](../../src/app/(main)/riscos/page.tsx#L42), [deliberacoes/page.tsx:75-78](../../src/app/(main)/deliberacoes/page.tsx#L75) | hidden | ✅ |
| V9 | Unauthenticated POST to API → 401 JSON | API | [src/lib/auth/api-guard.ts:14-25](../../src/lib/auth/api-guard.ts#L14) | 401 `{ok:false,error:"Não autenticado"}` | ✅ |
| V10 | Authenticated-but-unprivileged POST to API → 403 JSON | API | [api-guard.ts:31-42](../../src/lib/auth/api-guard.ts#L31) | 403 `{ok:false,error:"Sem permissão <key>"}` | ✅ |
| V11 | All `/api/integrations/esocial/*` reject GP | API | All 8 routes call `requireApiPermission('admin.manage_integrations')` | 403 | ✅ |
| V12 | `PATCH /api/admin/roles/[id]/permissions` rejects GP | API | [route.ts:31-32](../../src/app/api/admin/roles/[roleId]/permissions/route.ts#L31) | 403 | ✅ |
| V13 | Same endpoint refuses to modify `owner_admin` | API | [route.ts:81-87](../../src/app/api/admin/roles/[roleId]/permissions/route.ts#L81) | 409 with explanation | ✅ |
| V14 | `POST /api/admin/users/[id]/roles` rejects GP | API | [route.ts:25-26](../../src/app/api/admin/users/[userId]/roles/route.ts#L25) | 403 | ✅ |
| V15 | `DELETE` of last `owner_admin` user → 409 | API | [route.ts:165-191](../../src/app/api/admin/users/[userId]/roles/route.ts#L165) | 409 `code:last_admin_protection` | ✅ |
| V16 | Self-DELETE of own `owner_admin` → 409 (always) | API | [route.ts:193-203](../../src/app/api/admin/users/[userId]/roles/route.ts#L193) | 409 `code:self_owner_lockout` | ✅ |
| V17 | Self-DELETE that would drop own `admin.manage_users` → 409 | API | [route.ts:205-230](../../src/app/api/admin/users/[userId]/roles/route.ts#L205) | 409 `code:self_perm_lockout` | ✅ |
| V18 | Audit row written per perm-grant / perm-revoke | API → audit_logs | [permissions/route.ts:130-146](../../src/app/api/admin/roles/[roleId]/permissions/route.ts#L130) | one row per key, action `access.role.permission_grant` / `_revoke` | ✅ |
| V19 | Audit row written per role-assign / role-revoke | API → audit_logs | [roles/route.ts:90-105, 232-247](../../src/app/api/admin/users/[userId]/roles/route.ts#L90) | one row, action `access.user.role_assign` / `_revoke`, `metadata.target_user_id` | ✅ |
| V20 | Audit insert RLS satisfied (`actor_user_id = auth.uid()`) | RLS | [005:494-500](../../supabase/migrations/005_auth_rbac_foundation.sql#L494) — `audit_logs_insert_authenticated` | insert succeeds because `guard.userId === auth.uid()` | ✅ |
| V21 | Sidebar/route propagation after self-mutation | UI hook | `/admin/users` calls `refreshUser()` ([users/page.tsx:218,237](../../src/app/(main)/admin/users/page.tsx#L218)); `/admin/roles` does the same ([roles/page.tsx:174](../../src/app/(main)/admin/roles/page.tsx#L174)) | sidebar/route gates re-evaluate without page reload | ✅ |
| V22 | Other users' sessions pick up perm changes | UI hook | `useCurrentUser` re-runs on `auth.onAuthStateChange` ([use-current-user.ts:108-114](../../src/hooks/use-current-user.ts#L108)) | propagates on next auth event (focus/refresh) | ⚠ — see §19.3 #1 |
| V23 | Demo data preserved | n/a | No DELETE migrations added; runbook §D.5 / §F.4 instruct revert | not destructive | ✅ |

### 19.2 Layered defense check — does any one layer carry the load alone?

For each sensitive operation, three independent layers must say "yes" before the action succeeds.

| Operation | Layer 1 (UI gate) | Layer 2 (API guard) | Layer 3 (RLS / DB) |
|---|---|---|---|
| Delete contract | `hasPermission('contracts.delete')` ([contratos/page.tsx:226-228](../../src/app/(main)/contratos/page.tsx#L226)) | (no API — direct table write) | `contracts` policies in 007 require `contracts.delete` |
| Trigger AI risk scan | `hasPermission('risks.ai_scan')` (per page) | `requireApiPermission('risks.ai_scan')` per AI route | service-role write → RLS bypassed but server-validated |
| Dismiss AI risk | `hasPermission('risks.ai_dismiss')` | `requireApiPermission('risks.ai_dismiss')` + org match | service-role write |
| Edit role permissions | UI hides Save bar for owner_admin | `requireApiPermission('admin.manage_roles')` + owner_admin block | `role_permissions_admin_manage` (admin.manage_roles) |
| Assign / revoke user role | drawer × button | `requireApiPermission('admin.manage_users')` + 3 safety rails | `user_roles_admin_manage` (org-scoped, but service-role bypass for system roles — by design, see §18.2) |
| eSocial integration calls | (no UI gate yet — buttons under `/configuracoes/integracoes/esocial`) | `requireApiPermission('admin.manage_integrations')` ✅ Phase 1 fix | service stub (no real DB writes today) |

**Verdict:** every sensitive write has at least one server-side layer (API guard OR RLS).
The eSocial UI doesn't yet hide buttons by permission — that's a UX inconsistency but
**not** a security gap (the API guard catches it). Logged as F17 in §17.7.

### 19.3 Findings

#### 1. (UX, low) Cross-session permission propagation lag
`useCurrentUser` re-fetches on `auth.onAuthStateChange` ([use-current-user.ts:108-114](../../src/hooks/use-current-user.ts#L108)).
A *different* user whose perms an admin just changed will keep their old perm set in
memory until their next auth event (tab focus, token refresh, page reload). Their server
is correct (RLS evaluates on every query), so they cannot exploit stale perms — only their
sidebar lags.

**Recommendation:** acceptable for now. If real-time propagation is required later,
add a Supabase Realtime subscription on `role_permissions` and `user_roles` to call
`refresh()` when the calling user's relevant rows change. Not a blocker for the
data-load milestone.

#### 2. (Latent) Effective-permissions panel is incomplete for non-`admin.manage_roles` admins
The `role_permissions_select_scoped` policy ([005:378-388](../../supabase/migrations/005_auth_rbac_foundation.sql#L378))
allows reading `role_permissions` only when the caller has `admin.manage_roles` OR is
assigned to the role. An admin holding **only** `admin.manage_users` (no `admin.manage_roles`)
will see the "Permissões efetivas" panel rendered as **incomplete** — the page can read
those users' role assignments but not the perms behind each role they don't share.

**Today's impact: zero.** The only role that holds `admin.manage_users` in the seed is
`owner_admin`, which also holds `admin.manage_roles`. The gap only fires if a custom
admin role is created with one perm but not the other.

**Fix options (all proposals — not implemented now):**
- (a) Loosen the SELECT policy to also allow `admin.manage_users` — single-line migration.
- (b) Move the effective-perm computation behind a server-side endpoint that uses the service role.
- (c) Document and defer (current choice).

Tracked as **R11** in §8.2 below.

#### 3. (UX nitpick) `window.confirm()` on role removal
Functional but jarring against the HUD aesthetic. Not a defect — replacing it would mean
a custom dialog and is outside Phase 5 scope. Keep.

#### 4. (UX nitpick) eSocial integration UI doesn't hide buttons for non-admins
`/configuracoes/integracoes/esocial` is gated as authenticated-only at the route level
([middleware.ts:48](../../src/utils/supabase/middleware.ts#L48)) — any logged-in user can
see the page. Buttons that POST to the now-protected API will get 403s, so users can't
*do* anything harmful, but they will see "broken" buttons. Tracked as **F17**.

### 19.4 New entries (R / F)

| ID | Topic | Severity | Where |
|---|---|---|---|
| **R11** | `role_permissions_select_scoped` doesn't allow `admin.manage_users` admins to read perms beyond their own roles. Effective-perm panels incomplete for that admin shape. | Latent (no current trigger) | [005:378](../../supabase/migrations/005_auth_rbac_foundation.sql#L378) |
| **F17** | Add UI permission gating on `/configuracoes/integracoes/esocial` page to hide eSocial action buttons for users without `admin.manage_integrations`. | Low (UX) | [src/app/(main)/configuracoes/integracoes/esocial/](../../src/app/(main)/configuracoes/integracoes/esocial/) |
| **F18** | Cross-session permission propagation (Realtime subscription on user_roles / role_permissions for live menu refresh). | Low (UX) | hook-level |

### 19.5 What was NOT changed in Phase 5

- No code change. This phase is validation + documentation only.
- No demo data touched (runbook makes every destructive step revertible).
- No new migration.
- No Anthropic activation.
- No Finance business-logic change.

### 19.6 Sign-off prerequisites for the data-load milestone

- [ ] Manual runbook ([scripts/smoke-test-rbac-phase4.md](../../scripts/smoke-test-rbac-phase4.md)) executed end-to-end.
- [ ] All curl assertions in §D pass.
- [ ] Audit log SQL query in §E returns the expected `access.*` rows.
- [ ] No new console errors during the runbook.
- [ ] §F.4 cleanup performed (revert any test grant before data load).

After sign-off, the platform is RBAC-stable and ready for:
1. selective demo data cleanup;
2. real-data ingestion;
3. Anthropic API activation (R6 / F11 lint convention recommended *before* this step).

### 19.7 Phase log

| Date | Phase | What | Status |
|---|---|---|---|
| 2026-05-14 | Phase 1 | Audit + eSocial guard + `requireApiPermission` helper | ✅ |
| 2026-05-14 | Phase 2 | Finance perms seed (013), drop hardcoded role check, middleware `anyPermission` | ✅ |
| 2026-05-14 | Phase 3 | Editable role × permission matrix | ✅ |
| 2026-05-14 | Phase 4 | User-role assignment UI with safety rails | ✅ |
| 2026-05-14 | Phase 5 | Validation report + smoke-test runbook | ✅ |
| 2026-05-14 | Phase 6 | Invite Member & Access Setup wizard inside `/admin/users` (§20) | ✅ |
| 2026-05-15 | Phase 7 | User permission overrides — schema + override-aware `current_user_has_permission` + API + UI customizer + invite step (§21) | ✅ |

---

## 21. Phase 7 — User Permission Overrides

Closes the long-standing **R8** finding: per-user grant/deny overrides on top of role-based RBAC.

### 21.1 Schema (migration 014, idempotent)

Source: [supabase/migrations/014_user_permission_overrides.sql](../../supabase/migrations/014_user_permission_overrides.sql)

```sql
CREATE TABLE public.user_permission_overrides (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id)    ON DELETE CASCADE,
  permission_id   uuid NOT NULL REFERENCES permissions(id)   ON DELETE CASCADE,
  effect          text NOT NULL CHECK (effect IN ('grant','deny')),
  reason          text,
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id, permission_id)
);
```

**RLS:**
- `upo_select_scoped` — admins (`admin.manage_users`) see every override in their org; users see their own (so the drawer's "your effective access" view works for an admin viewing their own row).
- `upo_admin_manage` — only admins write; both `USING` and `WITH CHECK` enforce org-scope.

**Triggers:** `trg_upo_touch_updated_at` keeps `updated_at` honest without app cooperation.

### 21.2 Override-aware permission resolution

`current_user_has_permission()` is rewritten to honor overrides (replaces the role-only function from 005). Resolution order, evaluated atomically inside the SECURITY DEFINER RPC:

```
1. user_permission_overrides[deny]  → return false
2. user_permission_overrides[grant] → return true
3. role_permissions                 → return true
4. otherwise                        → false
```

This is the **single source of truth** for permission checks — middleware route gates, RLS table policies, and the UI's `usePermissions()` all read from it. Overrides therefore apply uniformly across all three layers without per-layer re-implementation.

`current_user_is_admin()` is intentionally **not** changed — it keys off `owner_admin` role membership, so an override cannot fabricate or strip "is_admin" status.

### 21.3 Submenu-permission naming convention

Inspected the seed before adding new permission keys:

- The canonical convention across all 14 modules is `<module>.view_<feature>` — e.g. `finance.view_dre`, `finance.view_budget_actual`, `finance.view_forecast`, `finance.view_project_costs`, `contracts.view_values`, `contracts.view_penalties`, `risks.ai_scan`, `risks.ai_dismiss`. Most submenu-level keys the brief listed already exist with this naming.
- Brief proposed alternative form `<module>.<sub>.view` (e.g. `finance.dre.view`). Adopting it would split semantics — every existing RLS policy, sidebar gate, and per-page check would have to honor both spellings. Rejected for the same reason `finance.update`, `admin.permissions.manage`, and `admin.manage_roles`-vs-`admin.user_roles.manage` were rejected in Phases 2/3/4/6.
- A few keys the brief listed are genuinely missing (`projects.operations_3d.view`, `contracts.billing.view`, etc). Phase 7 deliberately does **not** add them: the override mechanism works on any existing permission_id, so the catalog can grow incrementally as the sidebar gains true submenus. Tracked as **F23** in §21.10.

### 21.4 API — `POST` / `DELETE /api/admin/users/[userId]/overrides`

Source: [src/app/api/admin/users/[userId]/overrides/route.ts](../../src/app/api/admin/users/[userId]/overrides/route.ts)

| Method | Body / query | Behavior |
|---|---|---|
| `POST` | `{ permission_key, effect: 'grant'|'deny', reason? }` | Upsert one override (one row per `(org, user, perm)`). |
| `DELETE` `?permission_key=X` | — | Remove a single override (back to role default). |
| `DELETE` (no query) | — | Reset all overrides for the user. |

All three guarded by `requireApiPermission('admin.manage_users')`. Service-role client used after every safety check.

**Error codes:**
- `self_perm_lockout` (409) — admin tries to deny their own `admin.manage_users`.
- `last_admin_protection` (409) — denying `admin.manage_users` on the last active `owner_admin` user, or wiping all overrides when doing so would drop their `admin.manage_users` and no role grants it.

**Audit actions** (one row per change, written via authenticated client to satisfy `audit_logs_insert_authenticated`):
- `access.user.permission_grant` — POST with `effect: 'grant'`
- `access.user.permission_deny` — POST with `effect: 'deny'`
- `access.user.permission_override_removed` — DELETE single
- `access.user.permission_reset` — DELETE bulk

### 21.5 Inline overrides during invite

The Phase 6 invite endpoint now accepts an `overrides: [{ permission_key, effect }]` array and applies it after profile + role assignment. Unknown keys are silently dropped (a stale UI doesn't fail the whole invite). One audit row written per persisted override, sharing the `access.user.permission_grant` / `_deny` actions for consistency.

### 21.6 UI — `AccessCustomizer` component

Source: [src/components/admin/AccessCustomizer.tsx](../../src/components/admin/AccessCustomizer.tsx)

A single shared component used by:
1. The user-detail drawer in `/admin/users` (writes via the `/overrides` endpoint per toggle).
2. Step 3 of the invite wizard (collects overrides into local state, sent inline with the invite POST).

Per-row state shown via colored pill:

| State | When | Pill |
|---|---|---|
| Herdada | role grants it, no override | green (`active`) |
| Concedida | grant override, role didn't grant it | blue (`info`) |
| Negada (sem efeito) | deny override on a perm the role didn't grant | grey (`neutral`) |
| Bloqueada | deny override on a perm the role DID grant | red (`error`) |
| Sem acesso | no role grant, no override | grey (`neutral`) |

**Critical perms** (`admin.manage_users`, `admin.manage_roles`, `admin.manage_organization`, `admin.manage_integrations`) get a red `Crítica` pill so admins can see the consequence of toggling them.

**Filtering:** keyword search across module label / permission label / permission key, plus a module-only dropdown filter.

**Reset:** bulk-clear button shows when ≥1 override exists.

### 21.7 UI — invite wizard now Detalhes → Roles → **Personalizar acesso** → Pré-visualizar

Step 3 reuses `AccessCustomizer` against the inherited keys computed from the chosen roles. The preview step (now step 4) adds two callout boxes summarizing the manual grants and denies before sending.

### 21.8 Safety rails (unchanged from Phase 4 + new override-specific rules)

| Rule | Where enforced |
|---|---|
| `owner_admin` role itself remains protected | Phase 3 lock — unchanged. Only role-permission rows on `owner_admin` are blocked; user-level overrides on members holding owner_admin are allowed but bounded by the next two rules. |
| Admin cannot deny their own `admin.manage_users` | POST `/overrides` returns `self_perm_lockout` (409). |
| Last active `owner_admin` user cannot lose `admin.manage_users` via deny | POST `/overrides` returns `last_admin_protection` (409). |
| Bulk reset can't strand the platform | DELETE-all simulates the post-state and refuses if it would drop the last admin's `admin.manage_users` AND no role grants it. |
| Cross-org overrides rejected | RLS WITH CHECK + server validation. |
| Critical perms surfaced visually | UI flags `admin.manage_*` with a `Crítica` pill so an admin doesn't toggle them by accident. |

### 21.9 What was NOT changed in Phase 7

- No new permission keys seeded (the override mechanism is decoupled from the catalog).
- No change to `role_permissions` / `user_roles` / `roles` tables or to Phase 3/4 endpoints.
- `current_user_is_admin()` unchanged — overrides cannot manufacture admin status.
- No Anthropic activation, no Finance change, no demo data touched.

### 21.10 New follow-ups

| ID | Topic | Notes |
|---|---|---|
| F23 | Add the genuinely-missing submenu permission keys (e.g. `projects.view_operations_3d`, `contracts.view_billing`, `finance.view_accounts_payable`, `finance.view_accounts_receivable`) using the existing `<module>.view_<feature>` convention. | One-shot data-only seed migration; no code change required because the override UI already enumerates whatever's in the catalog. |
| F24 | Time-bound overrides (`expires_at`) — schema field already proposed in §10.1 but not added in Phase 7. | Pair with a daily SQL job that deletes expired rows, or change the resolution function to ignore them. |
| F25 | Override audit drill-down: "view full override history for this user" tab inside the drawer, reading `audit_logs WHERE action LIKE 'access.user.permission_%' AND entity_id = <user_id>`. | Read-only UI; no schema change. |

---

## 20. Phase 6 — Invite Members & Access Setup

### 20.1 Schema check — no new table required

The existing schema (`profiles` + `user_roles` + `audit_logs`) is sufficient for a
production-grade invite flow. A separate `invitations` table was considered for
parity with mature SaaS patterns (re-invite, expire, revoke pre-acceptance) but
intentionally NOT added in Phase 6: every invite is paired with an immediate
profile + role assignment, so there is no "pending" state to track on our side —
Supabase Auth itself owns the invite lifecycle (token, expiry, single-use link)
inside `auth.users`.

If a future requirement needs admin-side re-invite / cancel-pre-acceptance / quota
tracking, the `invitations` table proposed in [docs/plan/ACCESS_CONTROL_PLAN.md §5](../plan/ACCESS_CONTROL_PLAN.md)
becomes appropriate. Tracked as **F19** in §17.7 below.

### 20.2 Permission convention reuse

Same key as Phase 4: **`admin.manage_users`**. Inviting a member is the bootstrap
step of "manage users + their role assignments", so a separate `admin.invite` key
would split semantics. Documented under the same §17.1 / §18.1 rationale.

### 20.3 Email delivery — required Supabase configuration

The new endpoint calls `supabase.auth.admin.inviteUserByEmail()` via the service-role
client. **This requires Supabase email delivery to be configured for the project.**

| Environment | What works out of the box |
|---|---|
| Dev / demo | Supabase's default SMTP works for low-volume manual testing (rate-limited; emails may land in spam). |
| Production | A custom SMTP provider must be configured in Supabase Dashboard → Authentication → SMTP Settings. The default provider is not suitable for production volume. |

**Optional environment variable:** `NEXT_PUBLIC_SITE_URL` — used to build the email
redirect link (`${SITE_URL}/auth/callback?next=/dashboard`). Falls back to the
request origin if unset, which works for local dev but should be set explicitly in
production so the link points at the canonical site URL.

**No Anthropic key, no Resend, no SendGrid.** No third-party provider was added.
The flow is end-to-end via Supabase Auth.

### 20.4 API — `POST /api/admin/invitations`

Source: [src/app/api/admin/invitations/route.ts](../../src/app/api/admin/invitations/route.ts)

**Request body:**
```json
{
  "email": "maria@empresa.com",
  "full_name": "Maria Silva",
  "department": "Financeiro",
  "job_title": "Gerente Financeiro",
  "notes": "Substitui João, sai em junho.",
  "status": "active",
  "role_ids": ["<uuid-financeiro>"],
  "confirm_owner_admin": false
}
```

**Pipeline:**
1. `requireApiPermission('admin.manage_users')` — 401/403 on miss.
2. Input validation: email format, full_name non-empty, ≥1 role_id.
3. Resolve caller's organization_id from `profiles`.
4. Validate every role: must exist, must be system (`organization_id IS NULL`) or in caller's org.
5. If any selected role has `key = 'owner_admin'`, require `confirm_owner_admin: true`. Otherwise return 409 `code: owner_admin_confirmation_required`.
6. Call `service.auth.admin.inviteUserByEmail(email, { redirectTo: '<origin>/auth/callback?next=/dashboard', data: { full_name, invited_by, organization_id } })`. **If this fails, abort and return 502** (or 409 `code: user_already_registered` for the already-exists case). Nothing is written.
7. Eagerly upsert `profiles` for the new `auth.users.id` with `organization_id`, `full_name`, `department`, `job_title`, `status`. The invitee will land in `/dashboard` on first login (no onboarding interaction needed because the profile already has an org).
8. Upsert `user_roles` (idempotent on `user_id, role_id, organization_id`).
9. Insert `audit_logs` rows: one `access.user.invited` with the invite metadata, plus one `access.user.role_assign` per role assigned (consistent with Phase 4's role-assign event so audit consumers don't need a special case).

**Failure modes the endpoint handles distinctly:**
| Code | HTTP | Meaning |
|---|---|---|
| `owner_admin_confirmation_required` | 409 | UI did not pass `confirm_owner_admin: true` |
| `user_already_registered` | 409 | Email exists in `auth.users` — instruct admin to use the existing-user role-assignment flow |
| `invite_failed` | 502 | Supabase `inviteUserByEmail` returned an error not matching the above |
| `profile_insert_failed` | 500 | Auth user created, profile insert failed (rare; logged with `invited_user_id`) |
| `roles_assign_failed` | 500 | Auth user + profile created, role assignment failed |

### 20.5 Safety rails enforced server-side

| Rule | Enforcement |
|---|---|
| Only admins can invite | `requireApiPermission('admin.manage_users')` (401/403) |
| Caller must belong to an org | `actorProfile.organization_id` required (403) |
| Roles must be system or same-org | Per-role org check (403) |
| `owner_admin` requires explicit confirmation | `confirm_owner_admin: true` flag + UI-level checkbox + warning banner (409 if missing) |
| No fake successful invites | If `inviteUserByEmail` fails, no profile/role/audit rows are written |
| Every invite + role assignment audited | Two audit actions: `access.user.invited`, `access.user.role_assign` |

### 20.6 UI — wizard inside `/admin/users`

**Trigger:** "Convidar membro" header button (replaces the previous "Convite em breve" placeholder).

**Component:** [src/components/admin/InviteMemberModal.tsx](../../src/components/admin/InviteMemberModal.tsx) — 3-step modal wizard rendered with `HudModal size="xl"`. Parent uses a `key` prop that bumps on each open, so each invite starts with fresh state (no setState-in-effect anti-pattern).

| Step | Content | Validation gate to advance |
|---|---|---|
| 1 — Detalhes do membro | full_name, email, department, job_title, status, notes textarea | email format valid + full_name non-empty |
| 2 — Selecionar roles | Card grid of all non-`owner_admin` roles with name/key/description/perm-count; separate red-bordered panel for `owner_admin` with a two-step opt-in (assign + confirm checkbox) | ≥1 role + (owner not selected OR `confirm` checked) |
| 3 — Pré-visualizar acesso | Summary of details + role chips + computed effective permissions grouped by module (reuses the same `permsByRole` map the page already loads for the user-detail drawer) | Send button enabled when previous steps were valid |

**Step indicator:** three dots in the footer light up cyan as each step is completed.

**Effective-perm calculation:** computed locally in the wizard from `permsByRole` × selected role IDs — no extra DB roundtrip per step. Mirrors §17.5 of the user-detail drawer so the admin sees the **same calculation** before invite as after.

**On success:** modal closes, `loadUsers()` reruns so the new profile appears in the table immediately, top-of-page green banner confirms `Convite enviado para <email>`.

### 20.7 Permission-matrix editability clarification (§7 of brief)

The `/admin/roles` page already implements the visual taxonomy:

- **Sistema** badge (warning/yellow) — for `is_system_role: true` roles
- **🔒 Protegida** badge (critical/red) — only for `owner_admin`; pills disabled, Save bar hidden
- All other roles: pills clickable, Save/Discard sticky bar appears when dirty

**Empty/no-role-selected state:** when the page first loads with no role selected, the right panel shows `"Selecione uma role"` empty state — covering the brief's "Select a non-protected role to edit permissions" guidance contextually. The text was kept generic (rather than role-specific) since most loads auto-select the first role. Tracked as **F20** if more explicit wording is desired later.

**Custom roles** (`is_system_role: false`, `organization_id = <org>`) — already supported by the schema and the matrix UI, but no roles with this shape exist in the seed. Custom-role CRUD is the F13 follow-up in §18.7.

### 20.8 What was NOT changed in Phase 6

- No new permission key, no schema migration, no new table.
- No change to `/admin/roles` (Phase 3) or to the role-assign API (Phase 4).
- No third-party email provider, no Anthropic, no Finance change.
- The existing `/admin/users` drawer (Phase 4) is untouched — it remains the surface for managing existing users; the wizard is purely the new-user surface.

### 20.9 New follow-ups (Phase 7+ candidates)

| ID | Topic | Notes |
|---|---|---|
| F19 | Pending-invitations table + UI to view/cancel/re-send pre-acceptance | Schema change. Worth doing only if SaaS volume requires admin visibility into in-flight invites; today Supabase Auth owns the invite lifecycle. |
| F20 | More explicit "select a non-protected role to edit" copy on `/admin/roles` empty state | UX nit — non-blocking. |
| F21 | Bulk invite (CSV upload) | Reuses the same endpoint per row. |
| F22 | Email-template customization (Supabase Dashboard) | Configuration, not code. Document in deployment guide. |
