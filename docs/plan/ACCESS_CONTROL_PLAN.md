# Access Control & RBAC Stabilization Plan

Before doing any database reset or real-data migration, I want to stabilize the platform access structure first.

Do not reset demo data yet.
Do not delete any data yet.
Do not enable Anthropic API yet.

Current priority:
Audit and structure the pages, permissions, roles, menus, submenus, action-level access control, and the admin-facing “Funções Globais & Acessos” module, so Owner/Admin users can manage access directly inside the SaaS.

Goal:
Make sure every module is correctly protected, visible only to the right roles, and functionally ready before we clean the database and start loading real data.

## Scope

### 1. RBAC and permission audit
Inspect the current RBAC implementation:
- roles
- permissions
- role_permissions
- profiles
- middleware
- route guards
- UI permission gates
- menu/sidebar visibility
- action-level permissions

Create a clear access matrix for the main roles:
- Owner/Admin
- CEO / Diretoria
- Financeiro
- Jurídico / Contratos
- Gestor de Projetos
- RH
- Engenharia / Operações
- Viewer / Conselho, if applicable

### 2. Define module access by role
Audit and map access for:
- Dashboard / Control Room
- Projetos
- Insight Operations 3D
- Financeiro
- Riscos
- Deliberações
- Reuniões
- Atas
- Contratos
- Organograma
- Pessoas & Custos
- Administração
- Admin Users
- Admin Roles
- Admin Audit

For each module, define:
- who can view;
- who can create;
- who can edit;
- who can delete/archive;
- who can approve;
- who can vote;
- who can export;
- who can upload files;
- who can trigger AI scans;
- who can dismiss AI alerts;
- who can manage settings.

### 3. Page and route protection audit
Check all app routes and classify them as:
- public
- authenticated only
- permission-gated
- admin only

Make sure protected pages redirect correctly to:
- `/login` when unauthenticated;
- `/access-restricted` when authenticated but unauthorized.

### 4. Sidebar/menu visibility
Ensure sidebar/menu items are permission-aware.

Rules:
- Users should not see modules they cannot access.
- Users should not see submenus they cannot access.
- Users should not see action buttons they cannot use.
- If a user has partial access, show the module but hide restricted actions.
- Avoid broken links or empty pages caused by missing permissions.

### 5. Action-level permissions
Audit buttons/actions such as:
- New Project
- Edit Project
- Delete/Archive Project
- Export PDF
- Upload file
- Analyze with AI
- Approve deliberation
- Vote
- Create contract
- Upload contract
- Dismiss AI alert
- Manage users
- Manage roles
- Manage permissions

Every sensitive action should have both:
- UI gating;
- server/API permission validation.

### 6. Identify missing permissions
If a page/action needs a permission that does not exist yet, propose it before implementing.

Use a clear naming convention, for example:
- `dashboard.view`
- `projects.view`
- `projects.create`
- `projects.update`
- `projects.delete`
- `projects.upload_file`
- `projects.export`
- `finance.view`
- `finance.create`
- `finance.update`
- `finance.export`
- `risks.view`
- `risks.create`
- `risks.update`
- `risks.ai_scan`
- `risks.ai_dismiss`
- `contracts.view`
- `contracts.create`
- `contracts.upload_file`
- `contracts.ai_analyze`
- `deliberations.view`
- `deliberations.create`
- `deliberations.vote`
- `deliberations.approve`
- `meetings.view`
- `meetings.create`
- `minutes.view`
- `people_costs.view`
- `admin.users.manage`
- `admin.roles.manage`
- `admin.permissions.manage`
- `admin.audit.view`

### 7. Structure the “Funções Globais & Acessos” module
In addition to auditing RBAC, structure an admin-facing module called:

“Funções Globais & Acessos”
or
“Global Roles & Access Management”

Goal:
Allow Owner/Admin users to manage directly inside the SaaS who can access each module, submenu, page, and sensitive action.

This should become the central access-control console of the platform.

Required capabilities:

#### 7.1 Role management
Owner/Admin should be able to:
- view all roles;
- create custom roles;
- edit role name, description, and scope;
- duplicate an existing role;
- activate/deactivate roles;
- assign users to roles;
- see how many users are assigned to each role.

Default roles to support:
- Owner/Admin
- CEO / Diretoria
- Financeiro
- Jurídico / Contratos
- Gestor de Projetos
- RH
- Engenharia / Operações
- Viewer / Conselho

#### 7.2 Permission matrix UI
Create or propose a clear permission matrix where Admin can configure access by module.

Columns/actions:
- View
- Create
- Edit
- Delete/Archive
- Approve
- Vote
- Export
- Upload
- AI Scan
- AI Dismiss
- Manage Settings

Rows/modules:
- Dashboard / Control Room
- Projetos
- Insight Operations 3D
- Financeiro
- Riscos
- Deliberações
- Reuniões
- Atas
- Contratos
- Organograma
- Pessoas & Custos
- Administração
- Admin Users
- Admin Roles
- Admin Audit

Admin should be able to toggle permissions directly from this matrix if the current schema supports it.

#### 7.3 Page and submenu access control
The module must allow Admin to define which screens and submenus each role can access.

Examples:
- Financeiro > DRE Gerencial
- Financeiro > Forecast & Cenários
- Financeiro > Orçado x Realizado
- Financeiro > Contas a Pagar
- Financeiro > Contas a Receber
- Projetos > Portfolio
- Projetos > Insight Operations 3D
- Riscos > Matriz 5x5
- Riscos > Alertas IA
- Contratos > Overview
- Contratos > Risk Map
- Contratos > Timeline
- Contratos > Billing
- Contratos > Penalties & Clauses

Rules:
- If a user cannot access a submenu, hide it from navigation.
- If a user can view a page but cannot perform an action, show the page but hide/disable the restricted action.
- Backend/API must still enforce permissions even if the UI hides the button.

#### 7.4 User-level overrides
Support or propose optional user-specific permission overrides.

Example:
A Financeiro user can normally view Financeiro but not Riscos.
Admin can grant this specific user access to “Riscos > Alertas IA” without changing the entire Financeiro role.

The system should clearly show when a permission comes from:
- role default;
- user override;
- inherited admin privilege.

#### 7.5 Access preview / simulation
Add or propose a safe “Preview access as role/user” feature.

Admin should be able to select a role or user and see:
- visible modules;
- visible submenus;
- available actions;
- blocked pages.

This should be a simulation only, not real impersonation.

#### 7.6 Audit log
Every access-control change must be auditable.

Log:
- who changed;
- what role/user was changed;
- previous permissions;
- new permissions;
- timestamp;
- reason/comment if provided.

This should feed Admin Audit.

#### 7.7 Safety rules
- Owner/Admin cannot accidentally remove their own admin access.
- At least one Owner/Admin must always remain active.
- Dangerous permission changes should require confirmation.
- Permission changes should be reflected in sidebar/menu visibility and API route checks.
- Do not rely only on frontend gating.

#### 7.8 UI/UX direction
The module should look like a premium enterprise control panel:
- modern glass/HUD style;
- clean permission matrix;
- search users/roles;
- filter by module;
- badges for critical permissions;
- clear role cards;
- strong light/dark contrast;
- not a basic admin table.

### 8. Functional smoke test
After auditing, run a functional smoke test:
- unauthenticated user redirects to login;
- authenticated user without permission gets access restricted;
- Owner/Admin can access all intended modules;
- restricted roles only see allowed menus;
- action buttons are hidden/disabled correctly;
- API routes reject unauthorized actions;
- permission changes in “Funções Globais & Acessos” are reflected in menu/sidebar visibility if implemented.

### 9. Deliverables
Do not implement destructive database reset.

Deliver:
- RBAC/access matrix in markdown;
- list of current routes and required permissions;
- list of sidebar/menu visibility rules;
- list of missing permissions, if any;
- list of risky pages/actions without proper backend permission checks;
- proposed structure for “Funções Globais & Acessos”;
- list of schema changes required, if any;
- recommended fixes;
- implement only safe fixes supported by the existing schema.

Preferred document location:
`docs/auth/RBAC_ACCESS_MATRIX.md`

Constraints:
- Do not reset database.
- Do not delete demo data.
- Do not change finance business logic.
- Do not enable Anthropic API.
- Do not modify unrelated UI unless needed for permission consistency.
- Do not break current RBAC.
- If schema changes are required for advanced permission management, propose migrations before implementing.
- Preserve TypeScript safety.
- Build must pass.
