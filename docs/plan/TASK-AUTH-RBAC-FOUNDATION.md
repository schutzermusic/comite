# TASK-AUTH-RBAC-FOUNDATION

TASK: Create enterprise Auth, Organization, Profiles, Roles and Permissions foundation
PROJECT: INSIGHT Governança Corporativa

You are a senior full-stack engineer specialized in Next.js, Supabase Auth, PostgreSQL, RLS, TypeScript, enterprise SaaS architecture, RBAC/ABAC access control and corporate governance systems.

Your mission is to create the authentication, organization, profile, roles and permissions foundation before migrating all business modules to Supabase.

This is a critical foundation task. Do it carefully, with production-grade structure, without redesigning the current UI and without breaking the existing Projects Supabase integration.

━━━━━━━━━━━━━━━━━━━━
CONTEXT
━━━━━━━━━━━━━━━━━━━━

The project is an enterprise corporate governance SaaS named INSIGHT Governança Corporativa.

Main modules:

- Dashboard / Executive Control Room
- Projetos
- Financeiro
- Contratos
- Riscos
- Reuniões
- Deliberações
- Pautas
- Atas
- Pessoas
- Organograma
- Comitês
- Admin / Users / Roles
- Audit Logs

Current state:

- Projects module is already partially connected to Supabase.
- Existing project tables include projects, project_files and Supabase Storage bucket project-files.
- Some other modules may still use mock data, generated files, JSON, localStorage or hardcoded arrays.
- Do not migrate all business modules in this task.
- This task is only for the auth/access foundation.
- Do not break existing project flows.

Design direction:

- Preserve the current premium futuristic HUD/glass UI style.
- Do not redesign the whole product.
- New auth/admin screens must follow the same premium dark/light glassmorphism design language.
- Keep typography, spacing and tokens consistent with the current design system.

━━━━━━━━━━━━━━━━━━━━
PRIMARY GOAL
━━━━━━━━━━━━━━━━━━━━

Create the enterprise foundation for:

1. Supabase Auth login flow
2. Organizations
3. User profiles
4. Roles
5. Permissions
6. Role-permission mapping
7. User-role mapping
8. Committee-based access
9. Route protection
10. Permission-based sidebar visibility
11. RLS-ready schema
12. Audit logs
13. Admin screens for users and roles

This must become the security and access-control layer used before migrating Financeiro, Contratos, Riscos, RH and the other modules to Supabase.

━━━━━━━━━━━━━━━━━━━━
INITIAL ROLES
━━━━━━━━━━━━━━━━━━━━

Create these system roles:

1. Owner / Admin
   key: owner_admin

2. CEO / Diretoria
   key: ceo_diretoria

3. Gestor de Projetos
   key: gestor_projetos

4. Financeiro
   key: financeiro

5. Jurídico / Contratos
   key: juridico_contratos

6. RH
   key: rh

7. Engenharia / PCP
   key: engenharia_pcp

━━━━━━━━━━━━━━━━━━━━
IMPORTANT BUSINESS RULES
━━━━━━━━━━━━━━━━━━━━

1. Owner / Admin has full access to everything.

2. CEO / Diretoria has executive visibility across the organization.

3. Financeiro must have the same visible modules as CEO / Diretoria, plus operational finance permissions.

Financeiro should see:

- Dashboard / Executive Control Room
- Projetos
- Financeiro
- Contratos
- Riscos
- Reuniões
- Deliberações
- Atas
- Pessoas / Organograma in executive or limited mode
- Comitês

Financeiro must also be able to operate the Financeiro module:

- create/edit financial entries
- view DRE
- view budget vs actual
- view forecasts
- view project costs
- export finance reports

But keep sensitive permissions granular:

- finance.view_margin
- people.view_salary
- people.view_costs
- admin.manage_users
- admin.manage_roles
- contracts.edit

4. Deliberações must be visible in the sidebar for ALL authenticated roles.

5. Every role must be able to create a deliberation/request through their own committee or department.

6. All roles must have at least:

- deliberations.view
- deliberations.create
- deliberations.view_own
- deliberations.comment

7. Committee members should have:

- deliberations.view_committee
- deliberations.vote

8. Owner/Admin and CEO/Diretoria should have:

- deliberations.view_all
- deliberations.approve
- deliberations.reject
- deliberations.close
- deliberations.export

9. Deliberações must NOT become public across the whole company by default.

Users can see deliberations only when:

- they created the request
- they are requester, responsible, participant or approver
- they belong to the assigned committee
- they have deliberations.view_all
- the deliberation is not confidential, unless they have deliberations.view_confidential

10. Committee-based access must support future governance workflows.

Suggested committees:

- Diretoria
- Financeiro
- Jurídico / Contratos
- RH
- Projetos
- Engenharia / PCP
- Riscos
- Comercial
- Compras

━━━━━━━━━━━━━━━━━━━━
REQUIRED ROUTES
━━━━━━━━━━━━━━━━━━━━

Create or improve these routes:

- /login
- /forgot-password
- /reset-password
- /onboarding or /setup-company
- /admin/users
- /admin/roles
- /admin/audit

Rules:

- Unauthenticated users must be redirected to /login.
- Authenticated users without profile setup must be redirected to /onboarding or /setup-company.
- Unauthorized users must see a premium “Access restricted” state or be redirected safely.
- Admin routes must require admin permissions.
- Deliberações menu must always be visible for authenticated users.

━━━━━━━━━━━━━━━━━━━━
DATABASE MIGRATIONS
━━━━━━━━━━━━━━━━━━━━

Create Supabase migrations for the following tables.

Important:
- Use UUID primary keys.
- Use created_at and updated_at.
- Use organization_id wherever applicable.
- Prepare all tables for RLS.
- Do not destroy or rewrite existing projects/project_files tables unless strictly needed.
- If you need to add organization_id to existing project tables, do it safely and document it.

Required tables:

organizations:

- id uuid primary key
- name text not null
- slug text unique not null
- status text default 'active'
- created_at timestamptz default now()
- updated_at timestamptz default now()

profiles:

- id uuid primary key
- user_id uuid references auth.users(id) on delete cascade
- organization_id uuid references organizations(id)
- full_name text
- avatar_url text
- phone text
- job_title text
- department text
- status text default 'active'
- created_at timestamptz default now()
- updated_at timestamptz default now()

roles:

- id uuid primary key
- organization_id uuid references organizations(id) nullable
- key text not null
- name text not null
- description text
- is_system_role boolean default false
- created_at timestamptz default now()
- updated_at timestamptz default now()

permissions:

- id uuid primary key
- key text unique not null
- module text not null
- action text not null
- description text
- created_at timestamptz default now()

role_permissions:

- role_id uuid references roles(id) on delete cascade
- permission_id uuid references permissions(id) on delete cascade
- primary key (role_id, permission_id)

user_roles:

- user_id uuid references auth.users(id) on delete cascade
- role_id uuid references roles(id) on delete cascade
- organization_id uuid references organizations(id) on delete cascade
- created_at timestamptz default now()
- primary key (user_id, role_id, organization_id)

departments:

- id uuid primary key
- organization_id uuid references organizations(id) on delete cascade
- name text not null
- key text not null
- description text
- created_at timestamptz default now()
- updated_at timestamptz default now()

committees:

- id uuid primary key
- organization_id uuid references organizations(id) on delete cascade
- name text not null
- key text not null
- description text
- status text default 'active'
- created_at timestamptz default now()
- updated_at timestamptz default now()

committee_members:

- committee_id uuid references committees(id) on delete cascade
- user_id uuid references auth.users(id) on delete cascade
- role text default 'member'
- can_vote boolean default false
- can_approve boolean default false
- created_at timestamptz default now()
- primary key (committee_id, user_id)

audit_logs:

- id uuid primary key
- organization_id uuid references organizations(id) on delete cascade
- actor_user_id uuid references auth.users(id)
- action text not null
- entity_type text not null
- entity_id uuid nullable
- metadata jsonb default '{}'::jsonb
- ip_address text nullable
- user_agent text nullable
- created_at timestamptz default now()

Optional but recommended:

user_project_access:

- id uuid primary key
- organization_id uuid references organizations(id) on delete cascade
- user_id uuid references auth.users(id) on delete cascade
- project_id uuid
- access_level text default 'viewer'
- created_at timestamptz default now()

Use this later for assigned project visibility.

━━━━━━━━━━━━━━━━━━━━
PERMISSIONS TO SEED
━━━━━━━━━━━━━━━━━━━━

Create granular permissions grouped by module.

Admin:

- admin.view
- admin.manage_users
- admin.manage_roles
- admin.manage_organization
- admin.manage_integrations

Dashboard:

- dashboard.view
- dashboard.view_executive
- dashboard.export

Projects:

- projects.view
- projects.create
- projects.edit
- projects.delete
- projects.export
- projects.upload
- projects.view_costs
- projects.view_margin
- projects.view_all
- projects.view_assigned

Project Gantt:

- project_gantt.view
- project_gantt.create
- project_gantt.edit
- project_gantt.delete
- project_gantt.update_progress

Finance:

- finance.view
- finance.view_executive
- finance.create_entry
- finance.edit_entry
- finance.delete_entry
- finance.view_dre
- finance.view_budget_actual
- finance.view_forecast
- finance.view_project_costs
- finance.view_margin
- finance.export
- finance.approve

Contracts:

- contracts.view
- contracts.create
- contracts.edit
- contracts.delete
- contracts.upload_file
- contracts.analyze_with_ai
- contracts.view_values
- contracts.view_penalties
- contracts.approve
- contracts.export

Risks:

- risks.view
- risks.create
- risks.edit
- risks.delete
- risks.approve_mitigation
- risks.view_all
- risks.view_assigned
- risks.export

Meetings:

- meetings.view
- meetings.create
- meetings.edit
- meetings.delete
- meetings.participate

Deliberations:

- deliberations.view
- deliberations.create
- deliberations.view_own
- deliberations.view_committee
- deliberations.view_all
- deliberations.comment
- deliberations.vote
- deliberations.approve
- deliberations.reject
- deliberations.close
- deliberations.export
- deliberations.view_confidential

Minutes / Atas:

- minutes.view
- minutes.create
- minutes.edit
- minutes.approve
- minutes.export

People:

- people.view
- people.create
- people.edit
- people.delete
- people.view_costs
- people.view_salary
- people.view_sensitive_data

Org Chart:

- org_chart.view
- org_chart.edit
- org_chart.export

Committees:

- committees.view
- committees.create
- committees.edit
- committees.delete
- committees.manage_members

Audit:

- audit.view
- audit.export

━━━━━━━━━━━━━━━━━━━━
ROLE PERMISSION MATRIX
━━━━━━━━━━━━━━━━━━━━

Seed role_permissions according to this logic.

Owner / Admin:

- All permissions.

CEO / Diretoria:

Should have:

- dashboard.view
- dashboard.view_executive
- dashboard.export
- projects.view
- projects.view_all
- projects.export
- project_gantt.view
- finance.view
- finance.view_executive
- finance.view_dre
- finance.view_budget_actual
- finance.view_forecast
- finance.view_project_costs
- finance.export
- contracts.view
- contracts.view_values
- contracts.view_penalties
- contracts.approve
- risks.view
- risks.view_all
- risks.approve_mitigation
- meetings.view
- meetings.create
- meetings.participate
- deliberations.view
- deliberations.create
- deliberations.view_own
- deliberations.view_committee
- deliberations.view_all
- deliberations.comment
- deliberations.vote
- deliberations.approve
- deliberations.reject
- deliberations.close
- deliberations.export
- minutes.view
- minutes.approve
- people.view
- org_chart.view
- committees.view
- audit.view

Financeiro:

Should have the same visible modules as CEO/Diretoria plus operational finance permissions.

Include:

- dashboard.view
- dashboard.view_executive
- projects.view
- projects.view_all
- projects.view_costs
- project_gantt.view
- finance.view
- finance.view_executive
- finance.create_entry
- finance.edit_entry
- finance.view_dre
- finance.view_budget_actual
- finance.view_forecast
- finance.view_project_costs
- finance.export
- finance.approve
- contracts.view
- contracts.view_values
- risks.view
- risks.view_all
- meetings.view
- meetings.create
- meetings.participate
- deliberations.view
- deliberations.create
- deliberations.view_own
- deliberations.view_committee
- deliberations.comment
- deliberations.vote
- minutes.view
- people.view
- org_chart.view
- committees.view

Do not give by default unless explicitly required:

- admin.manage_users
- admin.manage_roles
- people.view_salary
- contracts.edit
- finance.delete_entry
- finance.view_margin

Gestor de Projetos:

- dashboard.view
- projects.view
- projects.create
- projects.edit
- projects.upload
- projects.view_assigned
- project_gantt.view
- project_gantt.create
- project_gantt.edit
- project_gantt.update_progress
- risks.view
- risks.create
- risks.edit
- risks.view_assigned
- meetings.view
- meetings.create
- meetings.participate
- deliberations.view
- deliberations.create
- deliberations.view_own
- deliberations.view_committee
- deliberations.comment
- minutes.view
- contracts.view
- committees.view

Jurídico / Contratos:

- dashboard.view
- contracts.view
- contracts.create
- contracts.edit
- contracts.upload_file
- contracts.analyze_with_ai
- contracts.view_values
- contracts.view_penalties
- contracts.export
- risks.view
- risks.create
- risks.edit
- meetings.view
- meetings.create
- meetings.participate
- deliberations.view
- deliberations.create
- deliberations.view_own
- deliberations.view_committee
- deliberations.comment
- deliberations.vote
- minutes.view
- projects.view
- committees.view

RH:

- dashboard.view
- people.view
- people.create
- people.edit
- org_chart.view
- org_chart.edit
- meetings.view
- meetings.create
- meetings.participate
- deliberations.view
- deliberations.create
- deliberations.view_own
- deliberations.view_committee
- deliberations.comment
- deliberations.vote
- minutes.view
- committees.view
- projects.view

Keep these separate and do not grant by default unless needed:

- people.view_salary
- people.view_costs
- people.view_sensitive_data

Engenharia / PCP:

- dashboard.view
- projects.view
- projects.view_assigned
- projects.edit
- projects.upload
- project_gantt.view
- project_gantt.create
- project_gantt.edit
- project_gantt.update_progress
- risks.view
- risks.create
- risks.edit
- meetings.view
- meetings.create
- meetings.participate
- deliberations.view
- deliberations.create
- deliberations.view_own
- deliberations.view_committee
- deliberations.comment
- deliberations.vote
- minutes.view
- contracts.view
- committees.view

Optional permission for Engenharia/PCP:

- projects.view_costs

Only grant if needed for authorized project costs.

━━━━━━━━━━━━━━━━━━━━
AUTH FLOW
━━━━━━━━━━━━━━━━━━━━

Implement the auth flow:

1. User opens /login.
2. User signs in with Supabase Auth.
3. System loads the authenticated user.
4. System loads profile.
5. System loads organization.
6. System loads roles.
7. System resolves permissions.
8. System redirects user to the correct route based on role.

Default redirects:

- Owner/Admin → /dashboard
- CEO/Diretoria → /dashboard
- Financeiro → /dashboard or /financeiro
- Gestor de Projetos → /projetos
- Jurídico/Contratos → /contratos
- RH → /pessoas
- Engenharia/PCP → /projetos?view=planejamento

If user has multiple roles, use highest priority:

1. owner_admin
2. ceo_diretoria
3. financeiro
4. gestor_projetos
5. juridico_contratos
6. rh
7. engenharia_pcp

━━━━━━━━━━━━━━━━━━━━
ROUTE PROTECTION
━━━━━━━━━━━━━━━━━━━━

Create route protection for authenticated and permission-based access.

Rules:

- Public routes:
  - /login
  - /forgot-password
  - /reset-password

- Protected routes:
  - all app/dashboard/module routes

- Admin-only routes:
  - /admin/users
  - /admin/roles
  - /admin/audit

- Deliberações route:
  - visible to all authenticated users
  - requires deliberations.view

- Financeiro route:
  - requires finance.view

- Contratos route:
  - requires contracts.view

- Projetos route:
  - requires projects.view

- Riscos route:
  - requires risks.view

- Pessoas route:
  - requires people.view

- Organograma route:
  - requires org_chart.view

Create reusable helpers:

- requireAuth()
- requirePermission(permissionKey)
- hasPermission(userPermissions, permissionKey)
- hasAnyPermission(userPermissions, permissionKeys)
- hasAllPermissions(userPermissions, permissionKeys)
- getDefaultRouteForRole(roleKey)

Create React hooks:

- useCurrentUser()
- useCurrentProfile()
- usePermissions()
- useHasPermission(permissionKey)
- useCanAccessModule(moduleKey)

━━━━━━━━━━━━━━━━━━━━
SIDEBAR / MENU ACCESS
━━━━━━━━━━━━━━━━━━━━

Update sidebar/menu logic to respect permissions.

Rules:

- Hide module menu items if user lacks permission.
- Always show Deliberações for authenticated users.
- Admin items only appear if user has admin permissions.
- Financeiro sees the same module set as CEO/Diretoria.
- CEO/Diretoria sees executive modules.
- Engenharia/PCP sees project/planning-related modules.
- RH sees people/org chart/deliberations.
- Jurídico sees contracts/legal/risk/deliberations.
- Gestor Projetos sees projects/gantt/risks/deliberations.

Do not remove existing menu design.
Only add permission-aware visibility logic.

━━━━━━━━━━━━━━━━━━━━
RLS POLICIES
━━━━━━━━━━━━━━━━━━━━

Enable Row Level Security for new tables.

Create safe baseline policies:

organizations:

- Users can select their own organization through profiles.
- Owner/Admin can manage organization.

profiles:

- Users can select their own profile.
- Users can select profiles in their organization if they have admin.manage_users or executive visibility.
- Owner/Admin can insert/update profiles.
- User can update limited own profile fields if safe.

roles:

- Users with admin.manage_roles can manage roles.
- Authenticated users can select system roles assigned to them.

permissions:

- Authenticated users can read permissions.
- Only system/admin should modify permissions.

role_permissions:

- Users with admin.manage_roles can manage.
- Authenticated users can read role_permissions for their assigned roles.

user_roles:

- Users can read their own user_roles.
- Users with admin.manage_users can manage user_roles in their organization.

committees:

- Authenticated users can view committees in their organization.
- Users with committees.manage_members can manage.

committee_members:

- Users can view their own committee memberships.
- Users with committees.manage_members can manage.

audit_logs:

- Only users with audit.view can read.
- Insert through helper/service for critical actions.

Important:
- Keep RLS policies simple and safe.
- Avoid overly complex recursive RLS if possible.
- Use helper SQL functions if needed, such as:
  - current_user_organization_id()
  - current_user_has_permission(permission_key text)
  - current_user_is_admin()

━━━━━━━━━━━━━━━━━━━━
AUDIT LOGS
━━━━━━━━━━━━━━━━━━━━

Create audit log helper/service.

Track critical actions:

- user created
- user updated
- role assigned
- role removed
- permission changed
- organization updated
- login if practical
- failed access attempt if practical
- sensitive export
- contract AI analysis later
- finance export later

Create:

- logAuditEvent()
- maybe server-side utility for audit insert

Do not overcomplicate this task.
Create the foundation and use it in admin/user/role changes.

━━━━━━━━━━━━━━━━━━━━
ADMIN USERS UI
━━━━━━━━━━━━━━━━━━━━

Create /admin/users.

Must include:

- premium glass admin layout
- users table
- search by name/email/department
- filter by role/status
- user status badge
- assigned roles
- organization
- create user action or invite placeholder
- edit user profile
- assign/remove roles
- activate/deactivate user
- audit-friendly actions

Do not make it visually generic.
Use existing design tokens and premium glass components.

If user invitation is not fully implemented yet, create a clean placeholder and document limitation.

━━━━━━━━━━━━━━━━━━━━
ADMIN ROLES UI
━━━━━━━━━━━━━━━━━━━━

Create /admin/roles.

Must include:

- list of roles
- role details
- permissions grouped by module
- readable permission matrix
- system role indicator
- ability to view permissions per role
- ability to edit non-system roles if supported
- system roles should be protected from destructive edits

At minimum, create a functional read/manage foundation.

━━━━━━━━━━━━━━━━━━━━
ADMIN AUDIT UI
━━━━━━━━━━━━━━━━━━━━

Create /admin/audit.

Must include:

- audit log table
- filters by action, actor, entity type, date
- metadata drawer or expandable row
- premium enterprise audit style

If data is initially limited, show a polished empty state.

━━━━━━━━━━━━━━━━━━━━
SUPABASE CLIENT STRUCTURE
━━━━━━━━━━━━━━━━━━━━

Use the existing Supabase client conventions if already present.

If not present, create a clean structure like:

- src/lib/supabase/client.ts
- src/lib/supabase/server.ts
- src/lib/auth/permissions.ts
- src/lib/auth/roles.ts
- src/lib/auth/current-user.ts
- src/lib/audit/log-audit-event.ts
- src/hooks/use-current-user.ts
- src/hooks/use-permissions.ts

Adapt paths to the existing codebase conventions.

Do not duplicate Supabase clients if they already exist.
Refactor carefully.

━━━━━━━━━━━━━━━━━━━━
SEEDING
━━━━━━━━━━━━━━━━━━━━

Create seed logic for:

- system permissions
- system roles
- role_permissions
- default committees

Create default committees:

- Diretoria
- Financeiro
- Jurídico / Contratos
- RH
- Projetos
- Engenharia / PCP
- Riscos
- Comercial
- Compras

Do not create fake business data.
This task should not seed projects, contracts, finance entries or risks.

━━━━━━━━━━━━━━━━━━━━
ONBOARDING / SETUP COMPANY
━━━━━━━━━━━━━━━━━━━━

Create minimal onboarding route if needed.

Purpose:

- If authenticated user does not have organization/profile, allow initial setup.
- Create organization.
- Create profile.
- Assign owner_admin role to the first user if no admin exists.

Make this safe:
- Do not allow every user to create an owner account inside an existing organization.
- Document any limitation if invite flow is not fully implemented yet.

━━━━━━━━━━━━━━━━━━━━
SECURITY REQUIREMENTS
━━━━━━━━━━━━━━━━━━━━

- Never expose service role key to client.
- Do not hardcode secrets.
- Do not bypass RLS from client.
- Do not trust client-only permission checks.
- UI permission checks are for UX only.
- Real data protection must be enforced by RLS/server checks.
- Sensitive permissions must remain granular.
- Deliberações is visible to everyone but data visibility must still be scoped.
- Financeiro can see CEO-level modules but should not automatically receive admin permissions.

━━━━━━━━━━━━━━━━━━━━
DO NOT DO
━━━━━━━━━━━━━━━━━━━━

Do not:

- Redesign the whole UI.
- Remove the premium HUD/glass style.
- Break existing Projects Supabase integration.
- Migrate all modules to Supabase in this task.
- Delete existing mocks unless required for auth/admin foundation.
- Give all users access to all deliberations.
- Give Financeiro admin permissions by default.
- Give RH salary/cost access by default unless explicitly permissioned.
- Expose sensitive keys.
- Increase TypeScript errors.
- Ignore build failures.

━━━━━━━━━━━━━━━━━━━━
IMPLEMENTATION PLAN
━━━━━━━━━━━━━━━━━━━━

First create a plan document:

docs/plan/TASK-AUTH-RBAC-FOUNDATION.md

The plan must include:

1. Current auth/data access assessment
2. Database migration plan
3. Roles and permissions matrix
4. RLS strategy
5. Route protection strategy
6. Sidebar permission strategy
7. Admin UI implementation plan
8. Risks and rollback notes
9. Acceptance criteria

Then implement.

━━━━━━━━━━━━━━━━━━━━
VALIDATION
━━━━━━━━━━━━━━━━━━━━

Run:

- npm run typecheck, if available
- npm run lint, if available
- npm run build

If commands differ, inspect package.json and run the correct available commands.

Verify manually:

1. /login loads.
2. Auth routes work.
3. Protected routes redirect unauthenticated users.
4. Authenticated user profile loads.
5. Role and permissions resolve.
6. Sidebar hides unauthorized modules.
7. Deliberações appears for all authenticated users.
8. Financeiro sees CEO-level modules.
9. Admin users page requires admin.manage_users.
10. Admin roles page requires admin.manage_roles.
11. Existing Projetos pages still work.
12. Build passes.
13. TypeScript errors do not increase.

━━━━━━━━━━━━━━━━━━━━
ACCEPTANCE CRITERIA
━━━━━━━━━━━━━━━━━━━━

This task is complete only when:

- Supabase Auth login foundation exists.
- organizations table exists.
- profiles table exists.
- roles table exists.
- permissions table exists.
- role_permissions table exists.
- user_roles table exists.
- departments table exists.
- committees table exists.
- committee_members table exists.
- audit_logs table exists.
- Initial roles are seeded.
- Initial permissions are seeded.
- Role-permission mapping is seeded.
- Deliberações is visible for all authenticated users.
- Financeiro has same visible modules as CEO/Diretoria.
- Permission helpers/hooks exist.
- Protected routes exist.
- Sidebar respects permissions.
- Admin users route exists.
- Admin roles route exists.
- Admin audit route exists.
- RLS is enabled for new security tables.
- Existing Projects module is not broken.
- Build passes.
- TypeScript errors do not increase.

━━━━━━━━━━━━━━━━━━━━
DELIVERY
━━━━━━━━━━━━━━━━━━━━

At the end, report:

1. Summary of what was implemented
2. Files changed
3. Migrations created
4. Seeds created
5. Roles created
6. Permissions created
7. Routes created/protected
8. Sidebar/menu changes
9. RLS policies created
10. Admin screens created
11. Validation results
12. Any limitations
13. Next recommended task

Next recommended task should probably be:

TASK: Audit all business modules and migrate Contratos to Supabase as the next source-of-truth module.

