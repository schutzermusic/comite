# Insight Apex — Phase 7.5: Enterprise Multi-Organization Foundation

**Status:** DRAFT FOR ARCHITECTURAL FREEZE  
**Placement:** After Contracts V2 Phase 7 and before Phase 8  
**Recommended repo path:** `plan/contracts-v2/phase-7.5-enterprise-multi-organization.md`

---

## 0. Executive Decision

Insight Apex must evolve from a system where `organization_id` behaves mostly as an internal tenant key into a first-class **enterprise multi-organization platform**.

This phase exists to make the following statement structurally true:

> **An organization is a security boundary, not a UI filter.**

And, above it:

> **An Enterprise Account groups organizations for administration and consolidation, but never removes tenant isolation between them.**

The immediate business requirement is to allow a user to create or switch to a new organization/company and start with a completely clean operational environment.

The strategic requirement is larger:

- support enterprise customers with multiple legal entities;
- support multiple CNPJs/subsidiaries under one commercial customer;
- allow users to belong to more than one organization;
- allow enterprise-level administration without cross-tenant leakage;
- enable future consolidated reporting without weakening organization isolation;
- prepare Insight Apex for sale to large enterprises;
- allow Demo/QA and Production to coexist without mixing facts.

This phase is **not** a cosmetic organization dropdown.

It is a tenancy, authorization, identity, lifecycle and enterprise-administration foundation.

---

# 0.1 ADENDO DE IMPLEMENTAÇÃO — CORREÇÕES PROVADAS PELA AUDITORIA

**Status:** IMPLEMENTADO · migrations 145–148 aplicadas · registro na ponta 148

Este adendo registra os pontos em que o desenho proposto acima divergia da
arquitetura real do repositório. Onde há divergência, **vale o adendo** — os
invariantes de segurança do MD foram preservados; o mecanismo mudou porque a
realidade auditada exigiu.

## 0.1.1 A fronteira de inquilino já era UM ponto, não trezentos

A auditoria do banco de produção encontrou:

```text
387  políticas RLS em public
362  passam por current_user_organization_id()
 34  funções passam por current_user_organization_id()
TODAS as políticas de storage.objects passam por ela
120  funções SECURITY DEFINER (86 alcançáveis pelo navegador)
```

O MD (§5, §49) previa refatoração de RLS domínio a domínio. Isso teria sido um
erro: reescrever 362 políticas para ensinar-lhes multi-organização é 362
oportunidades de errar uma.

**Correção adotada:** a 145 **redefine** `current_user_organization_id()` em vez
de substituí-la. A fonte da resposta muda de "a organização do perfil" para "a
organização ATIVA, provada por vínculo ATIVO em organização ATIVA". As 362
políticas, as 34 funções e todas as políticas de Storage tornaram-se
multi-organização **atomicamente**, sem uma linha de política reescrita.

## 0.1.2 `profiles` não podia ser a fonte — nem parcialmente

`profiles.user_id` é **UNIQUE**. Com essa restrição, "pertencer a duas
organizações" é inexprimível — não é limitação de produto, é de esquema.

`profiles` permanece como perfil da pessoa e **organização de origem**. Deixou
de ser prova de acesso. Um gatilho (`profiles_project_membership`) projeta
perfil → vínculo, de modo que todo caminho de provisionamento existente segue
funcionando. As regras da projeção são deliberadamente conservadoras: vínculo
`REVOKED` não ressuscita, perfil desativado suspende o vínculo, e migrar o
perfil de A para B **suspende** o vínculo com A (mantê-lo ampliaria acesso em
relação ao comportamento anterior, o que a §29 proíbe).

## 0.1.3 Mecanismo do contexto ativo (§7 ficava em aberto)

Escolhido: tabela `user_active_organization (user_id PK, organization_id)`,
escrita apenas por `organization_switch()`.

Por que este e não um claim no JWT: a escolha guardada **não autoriza nada
sozinha**. `current_user_organization_id()` reconfere vínculo e estado da
organização a cada resolução. Revogar vínculo ou suspender organização derruba
o contexto **no ato**, sem caçar sessão nem esperar expirar token — o que um
claim assinado não daria.

## 0.1.4 Buraco de escrita cross-tenant encontrado em `organizations`

A política `organizations_admin_manage` era `FOR ALL` com
`current_user_has_permission('admin.manage_organization')` e **nenhum predicado
de organização**. Com um inquilino só, invisível. Com dois, é escrita
cross-tenant escancarada.

Substituída por `organizations_select_member` (SELECT) e
`organizations_update_active` (UPDATE, escopado à organização ativa). INSERT e
DELETE deixaram de existir para o navegador: criar é RPC governada; apagar
inquilino não é fluxo de usuário (§14).

## 0.1.5 Sete tabelas eram cegas ao inquilino (não previsto no MD)

Sem coluna `organization_id` nenhuma, protegidas só por papel financeiro
**global**:

```text
allocation_result · allocation_rule · attachment · category_mapping
ingestion_batch · payroll_batch · user_finance_role
```

`attachment` e `category_mapping` liam `USING (true)`. A 146 deu organização às
sete, retroalimentou de forma determinística (uma única organização em
produção), tornou a coluna NOT NULL e reescreveu as políticas para exigir papel
**E** inquilino. `user_finance_role` era a raiz: papel financeiro global
atravessa organização por construção.

Quatro funções `SECURITY DEFINER` alcançáveis pelo navegador não fixavam
`search_path` (`has_finance_role`, `has_any_finance_role`,
`user_business_unit_ids`, `user_project_ids`). Corrigidas na mesma migration.

## 0.1.6 `REVOKE ... FROM PUBLIC` não bastava

O Supabase mantém DEFAULT PRIVILEGES que concedem EXECUTE a `anon`
**diretamente**. Revogar de PUBLIC não remove privilégio direto. Todas as RPCs
da fase — inclusive as que escrevem — precisaram de `REVOKE ... FROM anon`
nominal. Há teste permanente para isso.

## 0.1.7 Não há Realtime, e não há react-query

O MD (§17, §39) supõe caches de consulta com chave e assinaturas de tempo real.
O produto não usa `@tanstack/react-query` e **não abre nenhum canal Realtime**
(`supabase_realtime` não publica nenhuma tabela de `public`). O estado
tenant-bound vive na memória dos componentes e no Router Cache do Next.

**Correção adotada:** a troca de organização faz **navegação dura**
(`window.location.assign`), que descarta o processo de renderização inteiro.
É a única invalidação que não depende de enumerar cada lugar a invalidar. Um
teste permanente falha no dia em que uma tabela entrar na publicação Realtime,
obrigando a tratar o caso.

## 0.1.8 Storage já era isolado por inquilino

Todas as políticas de `storage.objects` já usam o prefixo
`organization_id/...` comparado a `current_user_organization_id()`. Endurecer a
função endureceu o Storage junto. Nenhuma política de Storage precisou mudar.

**Pendência anterior à fase, registrada e não resolvida aqui:** o bucket
`project-files` é `public = true`, o que expõe objetos por URL sem autenticação
independentemente de RLS. É achado pré-existente, fora do escopo desta fase
porque fechá-lo quebra as URLs em uso no produto.

## 0.1.9 Âncora empresarial automática (148)

Tornar `enterprise_account_id` NOT NULL quebrou nove suítes vivas que criam
organizações descartáveis com `INSERT INTO organizations (name, slug)`. A 148
adiciona gatilho `BEFORE INSERT` que cria uma conta empresarial dedicada quando
nenhuma é informada.

Isso **não** inventa autoridade: a conta nasce sem vínculo empresarial nenhum,
logo ninguém ganha direito de provisionamento por causa dela. É o caso da
organização que é o próprio grupo — que era exatamente o estado da organização
de produção antes desta fase — e é o agrupamento mais seguro por omissão.

## 0.1.10 Retroalimentação: o que foi derivado, e de quê

```text
1 organização em produção (INSIGHT ENERGY)
  → 1 conta empresarial, nomeada a partir dela
94 perfis, dos quais 4 com organização
  → 4 vínculos, com o estado que o perfil já tinha
2 detentores de admin.manage_organization
  → 2 ADMIN empresariais
```

A titularidade empresarial foi derivada de quem **hoje** detém
`admin.manage_organization` — precisamente quem, pela política defeituosa da
§0.1.4, já podia escrever em qualquer linha de `organizations`. O mapeamento
**preserva** autoridade existente; não a amplia.

**Ponto para decisão humana:** um dos dois é a conta `QA Workforce Bot`. Ela já
tinha essa autoridade antes da fase; a fase não a removeu porque remover
autoridade também é inventar governança. Recomenda-se revisá-la.

## 0.1.11 Organização descartável não é apagável — e isso está certo

`audit_logs` é append-only por gatilho e sua FK de organização é
`ON DELETE CASCADE`. Uma organização que registrou qualquer auditoria — e
provisionar registra — não pode ser apagada sem reescrever história imutável.

**Correção adotada:** as baterias de organização descartável rodam dentro de
`SAVEPOINT` sempre revertido. Resíduo zero por construção, e não por faxina que
precisaria violar a imutabilidade da auditoria. Pelo mesmo motivo, identidades
de teste que agiram permanecem em `auth.users` — sem vínculo, sem perfil e sem
contexto, o que a suíte verifica em vez de prometer.

## 0.1.12 Separação RBAC × autoridade empresarial

As permissões `enterprise.organizations.create|manage` e
`enterprise.memberships.manage` foram registradas como **vocabulário** e não
concedidas a papel nenhum — conceder seria repetir o erro que a 141 desfez. A
autoridade de provisionamento vem de `enterprise_account_memberships`, onde ela
é declarada com base rastreável (`granted_basis`).

Provado por teste: `owner_admin` de uma organização **não** obtém autoridade de
provisionamento, e administrador empresarial **não** obtém leitura operacional
das organizações do grupo — vê o registro (nome, estado) e administra o ciclo
de vida, e nada mais.

---

# 1. Phase Position

Existing roadmap remains:

- Phase 0 — Truth & Security
- Phase 1 — Canonical Party & Tenant Foundation
- Phase 2 — Structured Contract
- Phase 3 — Obligations Engine
- Phase 4 — Event Graph
- Phase 5 — Apex Approval Engine
- Phase 6 — Contract ↔ Project / Measurement
- Phase 7 — Billing ↔ Fiscal ↔ Finance
- Phase 8 — Risks & Clauses
- Phase 9 — Control Tower
- Phase 10 — Autonomy

This new work is inserted as:

> **Phase 7.5 — Enterprise Multi-Organization Foundation**

Do **not** renumber Phases 8–10.

Reason:

- the dependency is architectural;
- Phase 8 should be validated with real contracts;
- real contracts should be onboarded into the final tenant model;
- migrating tenancy after real financial/fiscal/contractual data accumulates would be materially riskier.

Dependency:

```text
Phase 7
   ↓
Phase 7.5 — Enterprise Multi-Organization Foundation
   ↓
Create clean Insight Energy Production organization
   ↓
Enable Anthropic / document intelligence
   ↓
Onboard real contracts
   ↓
Phase 8
   ↓
Phase 9
   ↓
Phase 10
```

---

# 2. Product Model

The platform must distinguish these concepts.

## 2.1 Enterprise Account

The **Enterprise Account** represents the customer/commercial account using Insight Apex.

Examples:

```text
Insight Energy Group
Grupo ABC
Empresa XYZ Holding
```

It is not the operational/legal entity where contracts, invoices or projects live.

It is the umbrella for:

- subscription/account ownership;
- enterprise administration;
- organization registry;
- future licensing;
- future SSO/domain configuration;
- future consolidated views;
- future branding/white-label settings;
- future enterprise policy inheritance where explicitly supported.

Suggested canonical concept:

```text
enterprise_accounts
```

Do not prematurely add SaaS billing, SCIM, SAML, custom domain or white-label implementation in this phase.

The schema must make those possible later.

---

## 2.2 Organization

An **Organization** is the primary operational and security tenant.

Typical meaning:

- legal entity;
- company;
- subsidiary;
- operating entity;
- one or more CNPJs only if explicitly modeled by Fiscal establishments below it.

Examples:

```text
Insight Energy Ltda.
Insight Engenharia Ltda.
Insight Energy — Demo
```

Every operational fact remains organization-scoped.

Examples:

- contracts;
- parties scoped to tenant;
- projects;
- obligations;
- measurements;
- billing;
- fiscal;
- AR;
- settlements;
- reconciliation;
- risks;
- approvals;
- domain events;
- jobs;
- documents/evidence;
- people/cost allocations;
- operations.

A new organization must contain **zero operational facts** by default.

---

## 2.3 Business Unit / Establishment / Cost Center

Do not use Organization to represent every internal hierarchy level.

Conceptual hierarchy:

```text
Enterprise Account
  └── Organization
       ├── Business Units
       ├── Establishments / legal/fiscal locations
       ├── Cost Centers
       └── Projects
```

Reuse existing canonical structures where they already exist.

Known architecture already contains:

```text
finance_cost_centers
```

Do not create duplicate cost-center concepts.

The truth audit must identify existing business unit / establishment / branch structures before any new schema is added.

---

# 3. Core Enterprise Use Case

A single authenticated user may belong to multiple organizations.

Example:

```text
Sergio
├── Insight Energy — Production
├── Insight Energy — Demo
├── Insight Engenharia
└── Another Enterprise Organization
```

Switching organization must change the full application security context.

The correct model is:

```text
authenticated user
        ↓
authorized memberships
        ↓
active organization
        ↓
RLS + RPC + API + jobs + queries + UI
        ↓
only facts from that organization
```

The browser must never gain access merely by sending an arbitrary `organization_id`.

---

# 4. Absolute Security Invariants

These are merge-blocking invariants.

## 4.1 Organization is not a frontend filter

Forbidden architecture:

```text
SELECT *
FROM contracts
WHERE organization_id = selectedOrganizationFromUI
```

when access authorization depends only on the client-selected value.

The selected organization is a **requested context**.

Authorization must be independently proven server-side / database-side.

---

## 4.2 Membership is mandatory

A user may operate inside an organization only if an active membership exists.

Conceptual rule:

```text
user
AND active membership
AND organization active
→ may establish active organization context
```

No membership means no access.

---

## 4.3 Cross-enterprise isolation

Membership in one Enterprise Account must never create visibility into another Enterprise Account.

Cross-tenant UUID knowledge must not become an existence oracle.

For protected RPCs:

```text
foreign UUID
```

must produce the same externally observable result as:

```text
nonexistent UUID
```

where appropriate.

---

## 4.4 SECURITY DEFINER hardening

The defects discovered during Phase 7 establish a permanent rule:

> **Never rely on RLS inside `SECURITY DEFINER`.**

Every browser-callable `SECURITY DEFINER` function that touches org-scoped rows must:

1. identify caller safely;
2. resolve active organization/membership;
3. validate row organization explicitly;
4. avoid cross-tenant existence oracles;
5. derive actor from `auth.uid()` where human attribution is required;
6. explicitly audit `anon` / `authenticated` EXECUTE grants;
7. never rely on `current_user` as the browser identity.

---

## 4.5 Jobs and Event Graph

Async work must never derive tenant from ambient UI state.

Every job/event must carry authoritative:

```text
organization_id
```

and handlers must verify the aggregate belongs to the same organization.

No cross-org job fan-out unless a future enterprise-level orchestration primitive explicitly supports it.

---

## 4.6 AI tenant boundary

AI/document processing must receive only data from the organization of the source job/request.

No shared conversational or retrieval context across organizations.

No cross-organization vector/retrieval search.

No prompt should contain data from another tenant merely because the same user belongs to both.

---

# 5. Truth Audit — Mandatory Before Schema Changes

Implementation must begin with an audit, not assumptions.

Inspect production and repository for:

- `organizations`
- `profiles`
- user ↔ organization relationship
- roles
- user_roles
- permission overrides
- `current_user_organization_id()`
- admin helpers
- all RLS policies referencing organization
- all SECURITY DEFINER functions
- service-role/server paths
- caches
- React/query state keyed by organization
- API routes
- background jobs
- Event Graph
- Approval Engine
- Fiscal
- Finance
- Projects
- People
- Operations
- Fleet
- documents/storage paths
- storage bucket RLS
- Resend/email jobs
- Supabase realtime subscriptions
- scheduled workflows
- domain-level organization FKs
- tables without `organization_id` that may still contain tenant-owned facts

Produce a matrix:

| Object | Current tenant field | Current authorization model | Multi-org safe? | Required action |
|---|---|---|---|---|

Do not fabricate the answer.

---

# 6. Canonical Data Model

Exact names may be adjusted after the truth audit, but semantics are frozen.

## 6.1 enterprise_accounts

Suggested fields:

```text
id
name
slug
status
created_at
updated_at
```

Possible status:

```text
ACTIVE
SUSPENDED
ARCHIVED
```

Do not overload `organizations` to represent both enterprise customer and operating company.

---

## 6.2 organizations

Preserve the existing canonical table if already authoritative.

Add enterprise ownership only if required:

```text
enterprise_account_id
```

Each organization belongs to exactly one Enterprise Account unless the truth audit proves a legitimate alternate requirement.

New operational organizations start empty.

---

## 6.3 organization_memberships

Canonical many-to-many relationship:

```text
organization_memberships
- id
- organization_id
- user_id
- status
- joined_at
- created_at
- created_by
- disabled_at
- disabled_by
```

Recommended membership states:

```text
INVITED
ACTIVE
SUSPENDED
REVOKED
```

Membership is not the same as role.

Do not encode full RBAC in membership.

Roles/permissions remain separate.

---

## 6.4 enterprise_account_memberships

Only create this if enterprise-level administration is genuinely required for the first implementation.

Purpose:

- account owner;
- enterprise admin;
- organization provisioning admin;
- future consolidated access governance.

Enterprise membership must **not automatically grant operational read access** to every child organization unless explicitly designed and proven.

Preferred default:

```text
enterprise admin
≠
implicit organization data reader
```

Provisioning authority and operational data authority are different concepts.

---

# 7. Active Organization Context

This is the most security-sensitive design decision in the phase.

The implementation must not treat a browser-local value as authoritative.

Required properties:

- user can request a switch;
- server/database verifies membership;
- chosen organization becomes the authorized working context;
- context is invalidated if membership is suspended/revoked;
- stale context cannot continue granting access;
- switching organizations clears/refetches tenant-bound state;
- no cached data from Organization A remains rendered after switching to B.

Potential implementation patterns may include:

- server-managed active membership/session state;
- signed/verified org context tied to user;
- explicit org parameter with membership validation in every boundary;
- another proven equivalent.

Do **not** freeze a mechanism before auditing the existing authentication architecture.

Freeze the invariant instead:

> Every request must prove that the authenticated user is authorized for the organization it operates on.

---

# 8. Switching Organizations — UX

Organization administration belongs in Settings.

Organization switching should also be available globally.

Recommended top-level UX:

```text
Insight Energy — Production ▾
```

Switcher:

```text
INSIGHT ENERGY GROUP

Organizations
✓ Insight Energy — Production
  Insight Energy — Demo
  Insight Engenharia

────────────────────
Manage organizations
+ New organization
```

Requirements:

- current organization visibly identified;
- no silent organization switch;
- organization switch must invalidate tenant-scoped caches;
- navigation remains in same module where possible;
- if equivalent route is unavailable, fall back to module landing page;
- do not show organizations user cannot access;
- suspended/revoked memberships disappear immediately after authorization refresh.

---

# 9. Settings — Organization Management

Suggested navigation:

```text
Settings
→ Enterprise
   → Organizations
   → Members
   → Access
```

or equivalent existing settings architecture.

Do not create a redundant parallel admin console if the current settings shell can host this.

---

# 10. Create Organization Flow

A user with enterprise provisioning authority may create a new organization.

Minimum onboarding fields should be conservative.

Possible first step:

```text
Organization name
Legal name
Country
Default currency
Timezone
Optional legal identifier / CNPJ
```

Do not require data that belongs to Fiscal if it is not authoritative yet.

Creation must atomically establish:

1. organization row;
2. enterprise-account relationship;
3. creator membership;
4. required administrator capability only if authorized by enterprise governance;
5. baseline tenant configuration that is truly structural;
6. audit/event trail.

Creation must **not** copy operational facts.

---

# 11. New Organization Must Start Clean

A newly created organization must have zero rows in all operational domains unless a row is an explicit required configuration object.

Expected zero operational facts include at minimum:

```text
contracts
contract amendments
contract clauses
contract obligations
project links
projects
measurements
billing events
fiscal documents
receivables
settlements
reconciliations
risks
documents/evidence
operational events
business approvals/requests
```

Do not seed:

- demo contracts;
- demo projects;
- fake finance;
- fake risks;
- fake invoices;
- fake measurements;
- fake receivables;
- fake approvals;
- fake authority;
- fake cost centers unless explicitly chosen during onboarding.

---

# 12. Configuration vs Business Facts

The implementation must distinguish:

## Structural/platform configuration

May exist automatically if it is universal:

```text
global permission vocabulary
platform role vocabulary if globally canonical
schema-level defaults
feature availability metadata
```

## Organization-specific governance/configuration

Must default to absent unless explicitly configured:

```text
billing release authority
approval policies
finance posting rules
AR basis policy
fiscal issuer configuration
tax provider credentials
cost center hierarchy
business units
currency-specific rules
```

Missing configuration must stay:

```text
NOT_CONFIGURED
UNKNOWN
PENDING_CONFIGURATION
```

It must never be inferred.

---

# 13. Demo vs Production

Do not delete the existing demo tenant as part of this phase.

Preferred strategy:

```text
Existing organization
→ rename / classify as DEMO or LEGACY DEMO

New organization
→ Insight Energy — Production
→ starts empty
→ receives only real data
```

Operational expectation:

```text
Demo
→ QA / development / demonstrations

Production
→ real operational facts only
```

`data_class = live|demo|unclassified` remains useful as defense-in-depth.

Tenant separation does not make data classification obsolete.

---

# 14. Organization Lifecycle

Organizations should support lifecycle states.

Suggested:

```text
ACTIVE
SUSPENDED
ARCHIVED
```

Rules:

- ARCHIVE must not physically delete operational history;
- SUSPENDED blocks normal operations;
- archived organization remains auditable;
- delete is not an ordinary user workflow;
- enterprise customer offboarding requires future explicit retention/export policy.

Do not implement destructive tenant deletion in this phase unless legal/retention requirements are proven.

---

# 15. Membership Lifecycle

Membership changes are security events.

Required operations:

```text
invite
activate
suspend
revoke
```

Requirements:

- membership changes are audited;
- revoked user immediately loses ability to establish/use org context;
- active sessions must not preserve stale authorization indefinitely;
- role/permission assignments must be scoped consistently;
- self-escalation must be prevented;
- a user cannot grant themselves membership/authority without a governed source.

---

# 16. RBAC Semantics

Keep these concepts separate:

```text
Membership
→ may enter organization

Role / Permission
→ what user can do inside organization

Authority / Approval policy
→ what governed business decisions user may make
```

Examples:

```text
member of organization
≠ can release billing

admin platform capability
≠ commercial authority

enterprise provisioning admin
≠ automatic finance visibility
```

This separation is permanent.

---

# 17. Organization-Aware Queries and Caching

Audit all client and server caches.

Every tenant-bound cache key must include organization identity or be invalidated completely on switch.

Examples:

```text
contracts
projects
billing
finance
people
risks
operations
fleet
documents
dashboards
```

Forbidden:

```text
queryKey = ['contracts']
```

if the cache can survive organization switch.

Required semantic form:

```text
queryKey = ['contracts', organizationId]
```

or equivalent secure invalidation strategy.

Switching organization must clear:

- stale query results;
- optimistic updates;
- selected record IDs from prior tenant;
- local UI state that can expose tenant data;
- tenant-specific realtime subscriptions.

---

# 18. Storage and Documents

Supabase Storage must be included in tenancy review.

Every object path / metadata strategy must ensure organization isolation.

Preferred logical shape:

```text
organization_id/domain/object_id/file
```

Do not rely only on obscurity of storage object names.

Audit:

- bucket policies;
- signed URL issuance;
- service-role access;
- document ingestion;
- AI extraction source retrieval;
- previews/downloads;
- deletion/retention.

---

# 19. Event Graph

All enterprise-facing organization changes should emit factual events only if they are useful domain facts.

Possible factual events:

```text
platform.organization.created
platform.organization.suspended
platform.organization.archived
platform.organization.membership.activated
platform.organization.membership.revoked
```

Do not event-source the organization.

Authoritative tables remain truth.

Events must carry:

```text
enterprise_account_id where relevant
organization_id
actor
correlation
causation
schema_version
```

No sensitive credential payload.

---

# 20. Apex Jobs

Every organization-scoped job must remain explicit.

Audit all job producers and consumers for:

- missing `organization_id`;
- aggregate lookup without same-org validation;
- stale active-org assumptions;
- cross-tenant retry bugs.

A job created for Organization A must never mutate Organization B even if aggregate UUID collision/foreign ID is supplied.

---

# 21. Approval Engine

Approval Engine remains platform-owned and organization-scoped.

Multi-organization changes must not:

- reuse a policy across organizations without explicit enterprise inheritance model;
- infer authority from enterprise-admin status;
- let an approver from Org A approve Org B because they share the same Enterprise Account.

Future enterprise policy inheritance is out of scope unless specifically designed.

Default:

```text
approval policy organization-scoped
```

---

# 22. Fiscal

Fiscal configuration remains organization/legal-entity scoped.

A new organization must have:

```text
no fiscal establishment
no certificate
no issuer config
no provider production gate
no fiscal documents
```

until real configuration is entered.

No credentials are copied from another organization.

---

# 23. Finance

A new organization starts with:

```text
0 receivables
0 settlements
0 reconciliations
0 ledger entries
0 posting rules
0 AR basis rules
```

unless explicit real configuration is performed.

Never copy financial facts from Demo to Production.

---

# 24. Contracts

After this phase, real contracts must be created inside the new production organization.

Preferred onboarding:

```text
original PDF
→ contract born UNCLASSIFIED
→ document extraction/proposals
→ human review
→ canonical party resolution
→ contract structure
→ classification LIVE
→ project link
→ obligations
→ measurement/billing chain
```

Never relabel an old demo contract as live merely to reuse it.

---

# 25. Risks / Phase 8 Dependency

Phase 8 should consume real contracts from the new production organization.

Phase 8 must not depend on existing demo risks to define official enterprise metrics.

This phase is complete before Phase 8 starts.

---

# 26. Enterprise Consolidation — Architecture Only

Large enterprises will need consolidated views.

Do not build the full Enterprise Control Tower here.

But design so future aggregation can safely operate over:

```text
Enterprise Account
→ authorized Organizations
→ explicit consolidated read models
```

Consolidation must not weaken RLS.

A user sees consolidated data only from organizations they are explicitly authorized to see, or through a future separately governed enterprise-level reporting permission.

No implicit “parent account sees everything” shortcut.

---

# 27. Explicitly Out of Scope

Do not implement in Phase 7.5:

```text
Phase 8 Risks & Clauses
Phase 9 Control Tower
Phase 10 Autonomy
SAML
SCIM
full enterprise SSO
SaaS subscription billing
custom domains
white-label complete
multi-region data residency
cross-enterprise data sharing
organization mergers
tenant export/import
tenant hard-delete
full consolidated finance
full consolidated contract dashboard
```

Architecture may prepare for them.

Implementation must not drift into them.

---

# 28. Migration Strategy

Existing migrations are immutable.

Before creating new migration numbers:

1. audit production registry;
2. confirm current tip;
3. confirm intentionally missing/superseded migrations;
4. do not edit applied migrations;
5. allocate new versions sequentially.

Migration plan should likely include distinct steps for:

```text
enterprise account foundation
organization membership foundation
existing organization backfill
existing user membership backfill
active-context support
RLS hardening
SECURITY DEFINER hardening
organization provisioning RPC
membership governance
organization lifecycle
```

Exact migration count is not frozen.

Correctness is more important than fitting arbitrary migration numbers.

---

# 29. Existing Data Backfill

This phase must preserve existing production/demo facts.

Rules:

- existing organizations remain valid tenants;
- existing users are mapped to memberships based only on provable current relationships;
- no user is automatically granted membership to unknown organizations;
- no role or permission is broadened during backfill;
- no Demo fact becomes Live;
- no business fact is copied into the new Production organization;
- no authority is inferred.

If an existing relationship is ambiguous:

```text
STOP / MANUAL_REVIEW
```

not guess.

---

# 30. Organization Creation RPC

Organization creation should be transactional.

Conceptual RPC/service:

```text
create organization
→ validate enterprise provisioning authority
→ create organization
→ create creator membership
→ establish safe baseline
→ emit audit/factual event
→ return organization id
```

Do not expose raw browser INSERT into foundational tenancy tables if a governed RPC is the safer boundary.

Actor must come from authenticated identity.

---

# 31. Organization Switch Boundary

Switching should not mutate business data.

It changes operating context only.

Security requirements:

- requested org is checked against active membership;
- organization is active;
- context transition is auditable if persisted;
- no arbitrary caller-supplied user ID;
- cross-enterprise switch rejected;
- revoked membership invalidates switch;
- old tenant caches/subscriptions cleared.

---

# 32. UI States

The product must distinguish:

```text
NO_ORGANIZATION
NO_MEMBERSHIP
MEMBERSHIP_SUSPENDED
ORGANIZATION_SUSPENDED
ORGANIZATION_ARCHIVED
ACTIVE
```

Do not collapse authorization/configuration failures into generic “something went wrong”.

---

# 33. First-Login / No Organization UX

If a user has no active organization memberships:

```text
No organization available
```

Possible actions only if authorized:

```text
Create organization
Accept invitation
Contact enterprise administrator
```

Do not drop the user into an arbitrary tenant.

---

# 34. New Organization Onboarding Checklist

After creation, show truthful readiness.

Example:

```text
Organization created

Company profile              INCOMPLETE
Members                      READY
Contracts                    EMPTY
Projects                     EMPTY
Fiscal configuration         NOT_CONFIGURED
Finance configuration        NOT_CONFIGURED
Billing release governance   NOT_CONFIGURED
Document AI                  AVAILABLE / NOT_CONFIGURED
```

Do not auto-fill missing enterprise decisions.

---

# 35. Production Organization for Insight Energy

After Phase 7.5 is merged and deployed:

Create:

```text
Insight Energy — Production
```

or rename appropriately after the demo tenant is relabeled.

Expected state:

```text
contracts = 0
projects = 0
obligations = 0
measurements = 0
billing events = 0
fiscal documents = 0
receivables = 0
settlements = 0
reconciliations = 0
risks = 0
```

Then onboard only real data.

Existing demo organization remains isolated.

---

# 36. Anthropic / Document Intelligence Gate

Before uploading real contracts:

- resolve Anthropic credit/billing;
- verify extraction provider health;
- verify dead-letter handling;
- retry only safe/idempotent jobs;
- verify tenant-bound document ingestion;
- verify real PDF stays authoritative;
- AI output is proposal/extraction, not silent legal truth.

No real-contract onboarding should depend on a provider currently failing due to exhausted credit.

---

# 37. Security Test Matrix

Permanent automated tests are mandatory.

## 37.1 Membership

Prove:

- user with Org A membership can access A;
- user without Org B membership cannot access B;
- revoked membership loses access;
- suspended membership loses access;
- enterprise admin does not gain operational B access unless explicitly granted.

## 37.2 Switcher

Prove:

- only authorized organizations returned;
- switching to foreign org refused;
- stale organization context rejected after membership revoke;
- context switch does not leak prior tenant records.

## 37.3 Cross-tenant UUID attacks

For browser-callable RPCs:

```text
foreign contract UUID
foreign project UUID
foreign billing UUID
foreign document UUID
foreign receivable UUID
foreign organization UUID
```

must not leak or mutate foreign tenant.

## 37.4 RLS

Two-organization live DB tests on every critical domain:

```text
Contracts
Projects
Obligations
Measurements
Billing
Fiscal
Finance
Approval
Events
Jobs where applicable
Documents/storage
```

## 37.5 SECURITY DEFINER

Enumerate all browser-executable DEFINER functions.

Fail test if a new org-scoped function becomes exposed without an explicit organization guard.

## 37.6 New organization emptiness

Create disposable organization and assert:

```text
0 operational facts
```

across the defined domain matrix.

Then delete/cleanup only disposable test data safely.

---

# 38. Concurrency Tests

At minimum:

- simultaneous organization creation with same uniqueness key;
- membership invite/activate race;
- membership revoke vs organization switch;
- membership revoke vs governed mutation;
- organization suspend vs write;
- duplicate organization provisioning request idempotency.

No partial tenant provisioning.

---

# 39. Cache Isolation Tests

Browser E2E:

1. login;
2. open Org A contracts;
3. switch to Org B;
4. assert no A names/IDs remain;
5. navigate back/forward;
6. assert no stale A data;
7. verify realtime subscriptions replaced;
8. switch rapidly A → B → A;
9. verify tenant-correct results every time.

---

# 40. Storage Isolation Tests

Two-tenant test:

- upload file A;
- user B cannot list/read/download A;
- guessed storage path fails;
- signed URL generation validates tenant;
- AI extraction job B cannot fetch A;
- server/service paths require explicit organization matching.

---

# 41. Audit Requirements

At minimum preserve:

```text
organization created
organization suspended
organization archived
membership created
membership activated
membership suspended
membership revoked
organization context switch if persisted/auditable
```

Audit actor must be authentic.

Never accept caller-supplied actor identity.

---

# 42. Data Classification

Continue using:

```text
live
demo
unclassified
```

where current architecture requires it.

Rules:

- new real contracts born `unclassified`;
- explicit governance promotes to `live`;
- demo stays demo;
- organization type/environment must not silently rewrite `data_class`.

A Production organization is expected operationally to contain Live data, but classification remains independent defense-in-depth.

---

# 43. Naming

Avoid ambiguous UI wording such as only “Tenant”.

Preferred user-facing language:

```text
Empresa
Organização
Grupo empresarial
```

Technical internal terminology may use:

```text
enterprise account
organization
membership
tenant boundary
```

---

# 44. Enterprise Account vs Organization Permissions

Freeze the separation.

Example enterprise permissions:

```text
enterprise.organizations.create
enterprise.organizations.manage
enterprise.memberships.manage
```

Example organization permissions remain domain-scoped.

Do not make:

```text
enterprise admin
```

synonymous with:

```text
contracts.read
finance.read
billing.release
```

inside every organization.

---

# 45. No Implicit Inheritance

Unless explicitly designed later:

```text
Enterprise Account policy
```

does not automatically become:

```text
Organization business authority
```

Examples that must not inherit silently:

- billing release authority;
- approval thresholds;
- fiscal credentials;
- finance posting policy;
- contract approval policy.

---

# 46. Failure Semantics

Missing or unauthorized states must be explicit.

Examples:

```text
ORGANIZATION_NOT_FOUND
ORGANIZATION_ACCESS_DENIED
MEMBERSHIP_NOT_ACTIVE
ORGANIZATION_SUSPENDED
ENTERPRISE_PROVISIONING_NOT_ALLOWED
```

Where foreign-row existence is sensitive, unauthorized and nonexistent should intentionally converge to prevent oracle behavior.

---

# 47. Observability

Add organization context to:

- structured logs;
- job logs;
- audit logs;
- event tracing;
- error diagnostics.

Never include secrets.

Cross-tenant anomalies should be detectable.

Potential high-severity signals:

```text
foreign organization mismatch
membership bypass attempt
SECURITY DEFINER tenant mismatch
job aggregate organization mismatch
storage tenant mismatch
```

---

# 48. Performance

Do not sacrifice tenant security for convenience.

But audit indexes for new access patterns:

```text
organization_memberships(user_id, status)
organization_memberships(organization_id, status)
organizations(enterprise_account_id)
user_roles(user_id, organization_id)
```

Use exact indexes based on real query plans.

Do not add speculative indexes blindly.

---

# 49. Rollout Strategy

Recommended rollout:

## Step 1 — Audit

No behavior change.

## Step 2 — Foundation schema

Enterprise accounts + memberships + compatibility.

## Step 3 — Backfill existing tenancy

Provable relationships only.

## Step 4 — Dual-read / compatibility if required

Maintain current product until all critical paths understand multi-org.

## Step 5 — RLS/RPC hardening

Permanent tenant boundary.

## Step 6 — Organization switcher

Only after backend isolation proven.

## Step 7 — Organization creation

Governed provisioning.

## Step 8 — Create disposable org

Prove clean-slate behavior.

## Step 9 — Production pilot

Create real Insight Energy Production organization.

## Step 10 — Real contract onboarding

Only after full security gate passes.

---

# 50. Stop Conditions

Stop implementation and report instead of guessing if:

- current profile/organization relationship is ambiguous;
- existing table ownership conflicts with proposed enterprise hierarchy;
- a critical domain lacks organization scope;
- RLS depends on a single-org profile assumption that cannot be safely migrated;
- organization switch would weaken existing security;
- a SECURITY DEFINER browser path cannot establish caller membership;
- existing production facts cannot be mapped deterministically;
- organization creation requires invented roles/authority;
- demo and real records cannot be distinguished safely;
- cleanup would require destructive rewriting of immutable history.

---

# 51. Required Deliverables

Implementation is incomplete without:

1. truth audit;
2. frozen schema/ownership decision;
3. migrations;
4. membership model;
5. active organization boundary;
6. server/database authorization;
7. organization switcher;
8. organization management UI;
9. create organization flow;
10. clean-slate proof;
11. RLS hardening;
12. SECURITY DEFINER audit;
13. storage tenant audit;
14. async jobs/event audit;
15. two-tenant live tests;
16. cache isolation E2E;
17. runbook;
18. production smoke;
19. demo-to-production separation plan.

---

# 52. Acceptance Criteria

Phase 7.5 can close only when all are true.

```text
ENTERPRISE ACCOUNT MODEL: IMPLEMENTED / NOT_IMPLEMENTED

USER CAN BELONG TO MULTIPLE ORGANIZATIONS: YES / NO

ACTIVE ORGANIZATION IS AUTHORIZED SERVER-SIDE: YES / NO

ORGANIZATION SWITCHER WORKING: YES / NO

NEW ORGANIZATION CREATION GOVERNED: YES / NO

NEW ORGANIZATION STARTS WITH ZERO OPERATIONAL FACTS: YES / NO

CROSS-ENTERPRISE DATA LEAK POSSIBLE: NO / YES

CROSS-ORGANIZATION DATA LEAK POSSIBLE: NO / YES

CROSS-ORGANIZATION MUTATION POSSIBLE: NO / YES

SECURITY DEFINER TENANT AUDIT: PASS / FAIL

RLS TWO-TENANT TESTS: PASS / FAIL

STORAGE TENANT ISOLATION: PASS / FAIL

CACHE TENANT ISOLATION: PASS / FAIL

EVENT GRAPH ORG SCOPE: PASS / FAIL

APEX JOBS ORG SCOPE: PASS / FAIL

APPROVAL ENGINE ORG SCOPE: PASS / FAIL

FISCAL ORG SCOPE: PASS / FAIL

FINANCE ORG SCOPE: PASS / FAIL

DEMO FACTS COPIED TO NEW PRODUCTION ORG: NO / YES

FABRICATED AUTHORITY OR CONFIGURATION: NO / YES

PRODUCTION GREEN: YES / NO

SAFE TO CREATE INSIGHT ENERGY PRODUCTION ORG: YES / NO

SAFE TO ONBOARD REAL CONTRACTS: YES / NO

PHASE 8 STARTED: NO
```

---

# 53. Definition of Done

Phase 7.5 is considered complete when:

> A user who is legitimately authorized for multiple organizations can switch between them, and each switch produces a fully isolated application context enforced by the database/server boundary—not merely by UI filtering.

And:

> An authorized enterprise administrator can create a new organization that starts with zero operational/business facts, without copying demo data, financial facts, contracts, projects, risks, documents, approvals or authorities from another organization.

And:

> A user who is not a member of another organization cannot read, infer, mutate, download, approve, process or cause an asynchronous action against that organization's data—even if they know valid UUIDs.

---

# 54. Immediate Post-Phase Action

After merge/deploy:

```text
1. Keep existing tenant as Demo / Legacy Demo
2. Create Insight Energy — Production
3. Verify zero operational facts
4. Configure only real required organization settings
5. Ensure Anthropic/document intelligence is healthy
6. Upload first real contract PDF
7. Review extraction
8. Promote contract to LIVE only through explicit governance
9. Add 2–5 representative real contracts
10. Begin Phase 8
```

---

# 55. Strategic Outcome

This phase changes the product boundary from:

```text
Insight Apex for one company
```

to:

```text
Insight Apex
→ Enterprise Account
   → multiple isolated organizations
      → multiple business units / establishments / cost centers / projects
```

That is the foundation required for Insight Apex to become a credible enterprise SaaS platform rather than a system structurally tied to one operating company.

The architecture must optimize for:

```text
isolation
governance
auditability
truth
scalability
enterprise administration
```

without inventing business facts, authority or configuration.
