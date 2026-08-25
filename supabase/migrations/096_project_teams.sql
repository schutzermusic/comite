-- ============================================================
-- 096 — Equipes de projeto (P3A: intenção de atribuição)
--
-- POR QUE ESTA MIGRATION EXISTE
-- -----------------------------
-- Operação de campo atribui EQUIPE, não pessoa-por-tarefa. Hoje o schema não
-- consegue representar isso:
--
--   · `departments` é estrutura organizacional (Diretoria, RH, Financeiro),
--     não turma de obra; `people.department` é texto livre.
--   · `committees` é governança.
--   · `project_timeline_assignments.user_id` é NOT NULL e aponta para
--     auth.users — então "equipe numa etapa" só seria expressável duplicando
--     cada membro em cada linha do Gantt.
--
-- Além do incômodo, a duplicação carrega um problema de identidade: as
-- atribuições vivem em auth.users e TODA a evidência operacional (ponto,
-- apontamento, diárias) vive em people. Por isso `project_team_members`
-- referencia PEOPLE: com equipes, a intenção de planejamento passa a viver no
-- mesmo espaço de identidade da evidência, e o motor de casamento deixa de
-- depender da ponte frágil people↔auth.users por e-mail.
--
-- ADITIVA POR CONSTRUÇÃO
-- ----------------------
-- Nenhuma tabela, coluna, constraint ou policy existente é alterada. Só três
-- tabelas novas. `project_timeline_assignments` continua sendo a atribuição
-- individual explícita; a atribuição por equipe é um caminho paralelo.
-- ============================================================

-- ============================================================
-- 1) project_teams — a turma, por projeto.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.project_teams (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  project_id        text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name              text NOT NULL,
  description       text,
  active            boolean NOT NULL DEFAULT true,
  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Nome único por projeto entre as equipes vivas.
CREATE UNIQUE INDEX IF NOT EXISTS project_teams_name_unique_idx
  ON public.project_teams (project_id, lower(name))
  WHERE active;
CREATE INDEX IF NOT EXISTS project_teams_project_idx
  ON public.project_teams (organization_id, project_id);

-- ============================================================
-- 2) project_team_members — quem está na turma.
--    Chaveado por PEOPLE (não auth.users): é o espaço de identidade da
--    evidência operacional, e trabalhador de campo pode não ter login.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.project_team_members (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  team_id           uuid NOT NULL REFERENCES project_teams(id) ON DELETE CASCADE,
  person_id         uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  role_title        text,
  added_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  added_at          timestamptz NOT NULL DEFAULT now(),
  -- Remoção é lógica: o histórico de quem estava na turma quando a evidência
  -- foi produzida precisa sobreviver.
  removed_at        timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS project_team_members_active_unique_idx
  ON public.project_team_members (team_id, person_id)
  WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS project_team_members_person_idx
  ON public.project_team_members (organization_id, person_id);

-- ============================================================
-- 3) project_timeline_team_assignments — etapa → equipe.
--    Tabela própria em vez de coluna nova em project_timeline_assignments:
--    lá `user_id` é NOT NULL, e afrouxar isso mexeria numa constraint viva.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.project_timeline_team_assignments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  project_id        text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  timeline_item_id  uuid NOT NULL REFERENCES project_timeline_items(id) ON DELETE CASCADE,
  team_id           uuid NOT NULL REFERENCES project_teams(id) ON DELETE CASCADE,
  assigned_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_at       timestamptz NOT NULL DEFAULT now(),
  removed_at        timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS timeline_team_assignments_active_unique_idx
  ON public.project_timeline_team_assignments (timeline_item_id, team_id)
  WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS timeline_team_assignments_item_idx
  ON public.project_timeline_team_assignments (timeline_item_id);
CREATE INDEX IF NOT EXISTS timeline_team_assignments_team_idx
  ON public.project_timeline_team_assignments (organization_id, team_id);

-- ============================================================
-- RLS — espelha project_timeline_assignments (032): leitura para quem enxerga
-- o cronograma, escrita para quem pode atribuir. Nenhuma permissão nova é
-- criada e nenhuma existente é afrouxada.
-- ============================================================
ALTER TABLE public.project_teams                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_team_members              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_timeline_team_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_teams_select ON public.project_teams;
CREATE POLICY project_teams_select ON public.project_teams
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('projects.timeline.view')
    OR current_user_has_permission('projects.view')
    OR current_user_is_admin()
  )
);

DROP POLICY IF EXISTS project_teams_write ON public.project_teams;
CREATE POLICY project_teams_write ON public.project_teams
FOR ALL TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('projects.timeline.assign')
    OR current_user_has_permission('projects.timeline.edit')
    OR current_user_has_permission('projects.timeline.admin')
    OR current_user_is_admin()
  )
)
WITH CHECK (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('projects.timeline.assign')
    OR current_user_has_permission('projects.timeline.edit')
    OR current_user_has_permission('projects.timeline.admin')
    OR current_user_is_admin()
  )
);

DROP POLICY IF EXISTS project_team_members_select ON public.project_team_members;
CREATE POLICY project_team_members_select ON public.project_team_members
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('projects.timeline.view')
    OR current_user_has_permission('projects.view')
    OR current_user_is_admin()
  )
);

DROP POLICY IF EXISTS project_team_members_write ON public.project_team_members;
CREATE POLICY project_team_members_write ON public.project_team_members
FOR ALL TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('projects.timeline.assign')
    OR current_user_has_permission('projects.timeline.edit')
    OR current_user_has_permission('projects.timeline.admin')
    OR current_user_is_admin()
  )
)
WITH CHECK (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('projects.timeline.assign')
    OR current_user_has_permission('projects.timeline.edit')
    OR current_user_has_permission('projects.timeline.admin')
    OR current_user_is_admin()
  )
);

DROP POLICY IF EXISTS timeline_team_assignments_select ON public.project_timeline_team_assignments;
CREATE POLICY timeline_team_assignments_select ON public.project_timeline_team_assignments
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('projects.timeline.view')
    OR current_user_has_permission('projects.view')
    OR current_user_is_admin()
  )
);

DROP POLICY IF EXISTS timeline_team_assignments_write ON public.project_timeline_team_assignments;
CREATE POLICY timeline_team_assignments_write ON public.project_timeline_team_assignments
FOR ALL TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('projects.timeline.assign')
    OR current_user_has_permission('projects.timeline.edit')
    OR current_user_has_permission('projects.timeline.admin')
    OR current_user_is_admin()
  )
)
WITH CHECK (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('projects.timeline.assign')
    OR current_user_has_permission('projects.timeline.edit')
    OR current_user_has_permission('projects.timeline.admin')
    OR current_user_is_admin()
  )
);

-- updated_at automático, no padrão do repositório.
DROP TRIGGER IF EXISTS set_project_teams_updated_at ON public.project_teams;
CREATE TRIGGER set_project_teams_updated_at
  BEFORE UPDATE ON public.project_teams
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

NOTIFY pgrst, 'reload schema';
