# TASK-AUTH-RBAC-FOUNDATION

## Summary

Criar a fundacao enterprise de autenticacao, organizacao, perfis, RBAC, permissoes, comites, protecao de rotas, sidebar permission-aware, auditoria e telas administrativas sem redesenhar o produto e sem quebrar o modulo atual de Projetos.

Estado atual verificado:

- App usa Next App Router em `src/app`, com shell principal em `src/app/(main)/layout.tsx`.
- Supabase SSR ja existe em `src/utils/supabase/client.ts`, `server.ts` e `middleware.ts`.
- `src/middleware.ts` hoje apenas renova sessao, sem bloquear rotas.
- Sidebar em `src/components/layout/app-sidebar.tsx` usa usuario mockado `Admin User` e nao aplica permissoes.
- Projetos ja usa Supabase em `src/lib/services/projects.ts`, tabela `projects` com `id text`, `project_files` e bucket `project-files`.
- `supabase/migrations/004_projects_supabase_storage.sql` mantem policies abertas para `anon` e `authenticated`; nao apertar essas policies nesta tarefa para evitar regressao.
- Rotas antigas de admin existem como `/membros`, `/roles` e `/configuracoes/auditoria`, mas a tarefa criara as rotas canonicas `/admin/users`, `/admin/roles`, `/admin/audit`.

## Key Changes

- Criar migracao idempotente `supabase/migrations/005_auth_rbac_foundation.sql` com tabelas de organizacao, perfis, roles, permissoes, comites e auditoria.
- Criar camada auth em `src/lib/auth/*` e hooks em `src/hooks/*` usando os clientes Supabase existentes.
- Criar `/login`, `/forgot-password`, `/reset-password`, `/onboarding`, `/admin/users`, `/admin/roles` e `/admin/audit`.
- Atualizar middleware para rotas publicas/protegidas e permissoes por modulo.
- Atualizar sidebar para ocultar itens sem permissao mantendo o visual HUD atual.
- Nao alterar `projects`, `project_files` nem as policies abertas de Projetos nesta tarefa.

## Database, Roles And Permissions

- Criar `organizations`, `profiles`, `roles`, `permissions`, `role_permissions`, `user_roles`, `departments`, `committees`, `committee_members`, `audit_logs`.
- Habilitar RLS nas novas tabelas.
- Criar helpers SQL `current_user_organization_id()`, `current_user_has_permission(text)`, `current_user_is_admin()` e `setup_first_organization(...)`.
- Seed idempotente de permissoes, system roles e matriz role-permission.
- Comites padrao serao criados por organizacao durante onboarding via helper SQL.

## Auth, Route Protection And Sidebar

- Publicas: `/login`, `/forgot-password`, `/reset-password`.
- Protegidas: rotas do app principal.
- Admin: `/admin/users`, `/admin/roles`, `/admin/audit`.
- Usuarios autenticados sem profile/organization vao para `/onboarding`.
- Deliberacoes fica visivel para autenticados com `deliberations.view`.
- Sidebar usa profile real, roles reais e permissoes reais.

## Admin UI

- `/admin/users`: tabela de perfis, busca, filtros, status, roles, organizacao, edicao de perfil, ativar/desativar e atribuicao/remocao de roles.
- `/admin/roles`: roles, system role indicator, permissoes agrupadas por modulo e matriz role-permission.
- `/admin/audit`: logs com filtros e metadata expansivel.

Limitacao deliberada: convite/listagem de emails de todos os usuarios via Supabase Admin API requer service role no servidor. Esta tarefa cria o placeholder de convite e usa `profiles` como fonte de usuarios do app.

## Validation

- `npm run typecheck`
- `npm run lint`
- `npm run build`

Acceptance:

- Auth foundation existe.
- Tabelas, seeds e RLS existem.
- Helpers/hooks de permissao existem.
- Rotas auth/admin existem.
- Sidebar respeita permissoes.
- Deliberacoes aparece para todos os autenticados.
- Financeiro recebe visibilidade executiva sem permissoes admin/sensiveis indevidas.
- Projetos continua sem mudanca de schema/RLS nesta tarefa.
