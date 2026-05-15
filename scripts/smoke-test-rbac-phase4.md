# RBAC Smoke-Test Runbook — Phase 4 Validation

> Manual smoke test to run **before** the database reset / real-data load.
> Companion to [docs/auth/RBAC_ACCESS_MATRIX.md](../docs/auth/RBAC_ACCESS_MATRIX.md) §19.
> Date: 2026-05-14

## Pre-requisites

Two test accounts in the same organization, both with active profiles:

| Alias | Required role(s) | Notes |
|---|---|---|
| **ADMIN** | `owner_admin` | Has every permission. |
| **GP** | `gestor_projetos` | Restricted role. NO `admin.*`, NO `finance.*`, NO `contracts.create`. |

If you don't have a `gestor_projetos` account yet, create one in `/admin/users` from the ADMIN session before starting — Phase 4 is the UI you're testing.

Capture each account's session cookie pair (`sb-<project>-auth-token`) for the curl tests, e.g. by copying from DevTools → Application → Cookies.

---

## A. Sidebar visibility

### A.1 ADMIN session
Open `/dashboard`. In the sidebar, verify these items render:
- [ ] Dashboard, Financeiro (with 13 sub-items), Projetos (Overview + Operations 3D), Reuniões, Deliberações, Riscos, Contratos, Workforce, Organograma
- [ ] Admin section: Comitês, Manage Members (`/admin/users`), Global Roles (`/admin/roles`), Workflows, Atas, Notificações, Relatórios, Histórico/Audit

### A.2 GP session
Open `/dashboard`. Verify these items **DO NOT** render:
- [ ] Financeiro · Manage Members · Global Roles · Histórico/Audit · Notificações (admin-side) · Relatórios

These should still render:
- [ ] Dashboard, Projetos (Overview + Operations 3D), Reuniões, Deliberações, Riscos, Contratos (read-only), Comitês

---

## B. Route protection (direct URL navigation)

### B.1 GP session — type each URL, expect redirect to `/access-restricted`
- [ ] `/financeiro`
- [ ] `/financeiro/dre`
- [ ] `/admin/users`
- [ ] `/admin/roles`
- [ ] `/admin/audit`
- [ ] `/historico`
- [ ] `/workflows`
- [ ] `/relatorios` (only redirects if GP lacks every export perm — gestor_projetos lacks all four)

### B.2 ADMIN session — every URL above renders the page

### B.3 Unauthenticated — clear cookies, hit each protected URL → redirected to `/login?next=<path>`

---

## C. Action-button gating

### C.1 ADMIN on `/contratos`
- [ ] "Excluir contrato" button visible (because `contracts.delete` is held)
- [ ] "Excluir projeto vinculado" button visible (because `projects.delete` is held)

### C.2 GP on `/contratos`
- [ ] Page renders (read-only, `contracts.view` granted to gestor_projetos)
- [ ] "Excluir contrato" button is **NOT** visible (gestor_projetos lacks `contracts.delete` and `admin.manage_organization`)
- [ ] "Excluir projeto vinculado" — visible because gestor_projetos holds neither `projects.delete` (false) nor `admin.manage_organization` (false) → expect **NOT** visible

### C.3 GP on `/projetos`
- [ ] "Novo Projeto" visible (gestor_projetos holds `projects.create`)
- [ ] AI scan button on `/projetos/[id]` visible (gestor_projetos holds `risks.ai_scan` per migration 011)

### C.4 ADMIN on `/admin/roles`
- [ ] Permission pills are clickable for non-`owner_admin` roles.
- [ ] Selecting `owner_admin` shows the 🔒 Protegida badge AND every pill is disabled AND the Save/Discard bar is hidden.

---

## D. API rejection (curl) — replace placeholders with real values

```bash
PROJECT_REF="<your-supabase-project-ref>"
COOKIE_GP='sb-'"$PROJECT_REF"'-auth-token=...'
COOKIE_ADMIN='sb-'"$PROJECT_REF"'-auth-token=...'
ROLE_ID_FINANCEIRO='<uuid-of-financeiro-role>'   # SELECT id FROM roles WHERE key='financeiro'
ROLE_ID_OWNER='<uuid-of-owner_admin-role>'
USER_ID_TARGET='<auth.users.id-of-some-other-user>'
USER_ID_ADMIN='<auth.users.id-of-the-ADMIN-account>'
ORIGIN="http://localhost:3000"
```

### D.1 Unauthenticated request → expect HTTP 401
```bash
curl -i -X POST "$ORIGIN/api/integrations/esocial/sync-now"
# expect: 401 {"ok":false,"error":"Não autenticado"}

curl -i -X PATCH "$ORIGIN/api/admin/roles/$ROLE_ID_FINANCEIRO/permissions" \
  -H "Content-Type: application/json" -d '{"grant":["finance.export"]}'
# expect: 401
```

### D.2 GP (lacks admin.*) → expect HTTP 403
```bash
curl -i -X POST "$ORIGIN/api/integrations/esocial/sync-now" -H "Cookie: $COOKIE_GP"
# expect: 403 "Sem permissão admin.manage_integrations"

curl -i -X PATCH "$ORIGIN/api/admin/roles/$ROLE_ID_FINANCEIRO/permissions" \
  -H "Cookie: $COOKIE_GP" -H "Content-Type: application/json" \
  -d '{"grant":["finance.export"]}'
# expect: 403 "Sem permissão admin.manage_roles"

curl -i -X POST "$ORIGIN/api/admin/users/$USER_ID_TARGET/roles" \
  -H "Cookie: $COOKIE_GP" -H "Content-Type: application/json" \
  -d "{\"role_id\":\"$ROLE_ID_FINANCEIRO\"}"
# expect: 403 "Sem permissão admin.manage_users"
```

### D.3 Last-admin protection (D.3 is destructive — only run in dev/demo!)
Only ADMIN holds `owner_admin`. Try to remove it from yourself (the *only* owner):

```bash
curl -i -X DELETE "$ORIGIN/api/admin/users/$USER_ID_ADMIN/roles?role_id=$ROLE_ID_OWNER" \
  -H "Cookie: $COOKIE_ADMIN"
# expect: 409 {"code":"self_owner_lockout", ...}
# (the friendlier guard fires first; if you assign owner_admin to a 2nd user
#  and try removing your own, the count check still fires and returns
#  code: last_admin_protection — try both flows.)
```

### D.4 Owner_admin role lock
```bash
curl -i -X PATCH "$ORIGIN/api/admin/roles/$ROLE_ID_OWNER/permissions" \
  -H "Cookie: $COOKIE_ADMIN" -H "Content-Type: application/json" \
  -d '{"revoke":["admin.manage_users"]}'
# expect: 409 "A role owner_admin é protegida e não pode ser modificada."
```

### D.5 Successful permission grant + audit (ADMIN, non-owner role)
```bash
curl -i -X PATCH "$ORIGIN/api/admin/roles/$ROLE_ID_FINANCEIRO/permissions" \
  -H "Cookie: $COOKIE_ADMIN" -H "Content-Type: application/json" \
  -d '{"grant":["projects.export"]}'
# expect: 200 {"ok":true,"applied":1,"granted":1,"revoked":0}
```

Then revoke it back to leave demo data unchanged:
```bash
curl -i -X PATCH "$ORIGIN/api/admin/roles/$ROLE_ID_FINANCEIRO/permissions" \
  -H "Cookie: $COOKIE_ADMIN" -H "Content-Type: application/json" \
  -d '{"revoke":["projects.export"]}'
# expect: 200
```

---

## E. Audit-log verification (run as ADMIN in Supabase SQL editor)

After D.5 (and any drawer-driven assignments you do in the UI):

```sql
SELECT created_at, actor_user_id, action, entity_type, entity_id, metadata
FROM audit_logs
WHERE action LIKE 'access.%'
ORDER BY created_at DESC
LIMIT 20;
```

Expect rows like:
- [ ] `access.role.permission_grant` / `access.role.permission_revoke` (one per key changed) with `metadata.permission_key` and `metadata.role_key`
- [ ] `access.user.role_assign` / `access.user.role_revoke` with `metadata.role_key`, `metadata.target_user_id`, optional `metadata.self`

---

## F. Live propagation after permission change

### F.1 In ADMIN browser, on `/admin/roles`:
1. Select `gestor_projetos`.
2. Toggle ON `finance.view` (currently off for that role).
3. Click "Salvar alterações". Expect green notice "Aplicado: 1 grant…".

### F.2 In GP browser, **without reloading**:
- [ ] Sidebar should NOT yet update for GP (their `useCurrentUser` ran before the change). After the next `auth` event (e.g. they refresh / re-focus tab) the new perm propagates. Acceptable behavior.

### F.3 In GP browser, after a hard reload of any page:
- [ ] Sidebar now shows "Financeiro" group.
- [ ] Navigating to `/financeiro` no longer redirects to `/access-restricted`.

### F.4 Cleanup — back in ADMIN, revoke `finance.view` from `gestor_projetos` to restore baseline.

---

## G. Self-permission lockout (do this only with two test admins)

Pre-req: assign `owner_admin` to a SECOND user; confirm the count check now allows ADMIN to remove their own role.

1. As ADMIN, open `/admin/users`, click own row → drawer.
2. Try clicking the `owner_admin` chip × → `self_owner_lockout` error inline.
3. Now create a custom test role with **only** `admin.manage_users` and assign it as your second role. Try to remove `owner_admin` from yourself again — should pass. Try to remove the custom role — should fail with `self_perm_lockout` if removing it would drop your `admin.manage_users` (it won't if you still hold owner_admin; that's the point — owner_admin is comprehensive).

---

## H. UI / UX checklist

- [ ] `/admin/roles`: pill states are visually distinct (active / inactive / modified-ring)
- [ ] `/admin/roles`: Save/Discard bar appears only when dirty, hides for owner_admin
- [ ] `/admin/users`: drawer scrolls when content overflows the viewport
- [ ] `/admin/users`: "Você" badge appears on the calling admin's own row
- [ ] `/admin/users`: "Owner/Admin" critical badge appears for users holding that role
- [ ] No console errors during any of the above

---

## Sign-off

- [ ] All checks pass
- [ ] Audit log entries verified in SQL
- [ ] No demo data destroyed (cleanup steps in F.4 / D.5 reverted)

If everything passes, RBAC is ready for the production data load.
