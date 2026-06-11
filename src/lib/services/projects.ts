import { Project } from '@/lib/types';
import type { ProjectV2, ProjectAuditEvent } from '@/lib/types/project-v2';
import { projects as defaultProjects, users } from '@/lib/mock-data';
import { loadV2Projects, STORAGE_KEY_V2 } from '@/lib/services/project-migration';
import { computeHealthScore } from '@/lib/utils/project-utils';
import { createClient } from '@/utils/supabase/client';

const STORAGE_KEY = 'insight_projects';
const PROJECTS_TABLE = 'projects';
const PROJECT_FILES_TABLE = 'project_files';
const PROJECT_FILES_BUCKET = 'project-files';

type ProjectRow = {
  id: string;
  project: Project;
  project_v2: ProjectV2 | null;
  client_logo_url: string | null;
};

function isSupabaseConfigured(): boolean {
  return Boolean(
    typeof window !== 'undefined' &&
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

function normalizeProject(p: any): Project {
  const project = { ...p };
  if (!project.responsavel || typeof project.responsavel !== 'object' || !project.responsavel.id) {
    project.responsavel = users[0];
  }
  if (!project.codigoInterno) {
    project.codigoInterno = project.codigo || '';
  }
  if (!project.comiteResponsavel) {
    project.comiteResponsavel = project.comite_nome || '';
  }
  if (typeof project.valor_total !== 'number') project.valor_total = 0;
  if (typeof project.valor_executado !== 'number') project.valor_executado = 0;
  if (typeof project.progresso_percentual !== 'number') project.progresso_percentual = 0;
  return project;
}

function saveLocalProjects(projects: Project[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
}

function saveLocalV2Projects(projects: ProjectV2[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(projects));
}

function rowToProject(row: ProjectRow): Project {
  return normalizeProject({
    ...row.project,
    id: row.id,
    clientLogoUrl: row.client_logo_url || row.project.clientLogoUrl,
  });
}

function rowToProjectV2(row: ProjectRow): ProjectV2 | null {
  if (!row.project_v2) return null;
  return {
    ...row.project_v2,
    id: row.id,
    clientLogoUrl: row.client_logo_url || row.project_v2.clientLogoUrl,
  };
}

async function upsertProjectsToSupabase(projects: Project[], projectsV2?: ProjectV2[]): Promise<void> {
  if (!isSupabaseConfigured()) {
    saveLocalProjects(projects);
    if (projectsV2) saveLocalV2Projects(projectsV2);
    return;
  }

  const supabase = createClient();
  const { userId, orgId } = await getCurrentOrgAndUser(supabase);

  const v2ById = new Map((projectsV2 || []).map((p) => [p.id, p]));
  const ids = projects.map((p) => p.id);

  // Determine which projects already exist so we don't overwrite organization_id / created_by on update.
  const existingIds = new Set<string>();
  if (ids.length > 0) {
    const { data: existing, error: existingError } = await supabase
      .from(PROJECTS_TABLE)
      .select('id')
      .in('id', ids);
    if (existingError && !isMissingProjectsTable(existingError)) {
      throw new Error(rlsFriendlyMessage('Erro ao verificar projetos existentes', existingError));
    }
    (existing || []).forEach((r: { id: string }) => existingIds.add(r.id));
  }

  const baseRow = (project: Project) => {
    const projectV2 = v2ById.get(project.id) || null;
    const clientLogoUrl = project.clientLogoUrl || projectV2?.clientLogoUrl || null;
    return {
      id: project.id,
      project: { ...project, clientLogoUrl: clientLogoUrl || undefined },
      project_v2: projectV2 ? { ...projectV2, clientLogoUrl: clientLogoUrl || undefined } : null,
      client_logo_url: clientLogoUrl,
    };
  };

  const toInsert = projects
    .filter((p) => !existingIds.has(p.id))
    .map((p) => ({ ...baseRow(p), organization_id: orgId, created_by: userId }));

  const toUpdate = projects.filter((p) => existingIds.has(p.id)).map(baseRow);

  if (toInsert.length > 0) {
    const { error } = await supabase.from(PROJECTS_TABLE).insert(toInsert);
    if (error) throw new Error(rlsFriendlyMessage('Erro ao salvar projetos no Supabase', error));
  }

  // Update existing rows individually so we never touch organization_id / created_by.
  for (const row of toUpdate) {
    const { error } = await supabase
      .from(PROJECTS_TABLE)
      .update({
        project: row.project,
        project_v2: row.project_v2,
        client_logo_url: row.client_logo_url,
      })
      .eq('id', row.id);
    if (error) throw new Error(rlsFriendlyMessage('Erro ao atualizar projeto no Supabase', error));
  }

  saveLocalProjects(projects);
  if (projectsV2) saveLocalV2Projects(projectsV2);
}

function sanitizeFileName(fileName: string): string {
  return fileName
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'arquivo';
}

function isMissingProjectsTable(error: { code?: string; message?: string } | null | undefined): boolean {
  return error?.code === 'PGRST205' || /public\.projects|schema cache|projects/i.test(error?.message || '');
}

function isRlsError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  // PostgREST returns 42501 for insufficient_privilege and PGRST301 for RLS denied rows.
  return (
    error.code === '42501' ||
    error.code === 'PGRST301' ||
    /row[- ]level security|permission denied|policy/i.test(error.message || '')
  );
}

function rlsFriendlyMessage(prefix: string, error: { code?: string; message?: string }): string {
  if (isRlsError(error)) {
    return `${prefix}: Acesso negado pela política de segurança.`;
  }
  return `${prefix}: ${error.message || 'erro desconhecido'}`;
}

type SupabaseLike = ReturnType<typeof createClient>;

/**
 * Resolves the current authenticated user's organization_id via the profiles table.
 * Throws PT-BR errors when unauthenticated or without an active org.
 */
async function getCurrentOrgAndUser(
  supabase: SupabaseLike,
): Promise<{ userId: string; orgId: string }> {
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) throw new Error('Não autenticado');

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('user_id', user.id)
    .single();

  if (error || !profile?.organization_id) {
    throw new Error('Usuário sem organização ativa');
  }
  return { userId: user.id, orgId: profile.organization_id as string };
}

// ─── V1 API (backward compatible) ────────────────────────────────

/**
 * Obtém todos os projetos (do localStorage ou mock-data) — V1 shape
 */
export function getProjects(): Project[] {
  if (typeof window === 'undefined') {
    return defaultProjects;
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed.length > 0) {
        return parsed.map(normalizeProject);
      }
    }
  } catch (error) {
    console.error('Erro ao ler projetos do localStorage:', error);
  }

  return defaultProjects;
}

/**
 * Obtém todos os projetos do Supabase. Se a tabela estiver vazia, faz seed dos
 * mocks atuais para manter a experiência existente e passa a persistir remoto.
 */
export async function getProjectsAsync(): Promise<Project[]> {
  if (!isSupabaseConfigured()) return getProjects();

  const supabase = createClient();
  const { data, error } = await supabase
    .from(PROJECTS_TABLE)
    .select('id, project, project_v2, client_logo_url')
    .order('updated_at', { ascending: false });

  if (error) {
    if (isMissingProjectsTable(error)) return getProjects();
    throw new Error(`Erro ao carregar projetos do Supabase: ${error.message}`);
  }

  if (!data || data.length === 0) {
    const seededProjects = getProjects().map(normalizeProject);
    const seededV2 = loadV2Projects(seededProjects);
    await upsertProjectsToSupabase(seededProjects, seededV2);
    return seededProjects;
  }

  const projects = (data as ProjectRow[]).map(rowToProject);
  saveLocalProjects(projects);
  return projects;
}

/**
 * Obtém um projeto por ID — V1 shape
 */
export function getProjectById(projectId: string): Project | undefined {
  const projects = getProjects();
  const projeto = projects.find(p => p.id === projectId);

  if (projeto) {
    if (!projeto.responsavel || typeof projeto.responsavel !== 'object' || !projeto.responsavel.id) {
      projeto.responsavel = users[0];
    }
    if (!projeto.codigoInterno) {
      projeto.codigoInterno = projeto.codigo || '';
    }
    if (!projeto.comiteResponsavel) {
      projeto.comiteResponsavel = projeto.comite_nome || '';
    }
    if (typeof projeto.valor_total !== 'number') projeto.valor_total = 0;
    if (typeof projeto.valor_executado !== 'number') projeto.valor_executado = 0;
    if (typeof projeto.progresso_percentual !== 'number') projeto.progresso_percentual = 0;
  }

  return projeto;
}

export async function getProjectByIdAsync(projectId: string): Promise<Project | undefined> {
  const projects = await getProjectsAsync();
  return projects.find((p) => p.id === projectId);
}

// ─── V2 API (governance-grade) ───────────────────────────────────

/**
 * Get all projects in V2 shape. Runs migration if needed.
 */
export function getProjectsV2(): ProjectV2[] {
  const v1 = getProjects();
  return loadV2Projects(v1);
}

export async function getProjectsV2Async(): Promise<ProjectV2[]> {
  if (!isSupabaseConfigured()) return getProjectsV2();

  const supabase = createClient();
  const { data, error } = await supabase
    .from(PROJECTS_TABLE)
    .select('id, project, project_v2, client_logo_url')
    .order('updated_at', { ascending: false });

  if (error) {
    if (isMissingProjectsTable(error)) return getProjectsV2();
    throw new Error(`Erro ao carregar projetos v2 do Supabase: ${error.message}`);
  }

  if (!data || data.length === 0) {
    const projects = await getProjectsAsync();
    return loadV2Projects(projects);
  }

  const rows = data as ProjectRow[];
  const projects = rows.map(rowToProject);
  const fromRows = rows.map(rowToProjectV2).filter(Boolean) as ProjectV2[];
  const projectsV2 = fromRows.length === projects.length ? fromRows : loadV2Projects(projects);
  saveLocalProjects(projects);
  saveLocalV2Projects(projectsV2);
  return projectsV2;
}

/**
 * Get a single project in V2 shape by ID.
 */
export function getProjectV2ById(projectId: string): ProjectV2 | undefined {
  const all = getProjectsV2();
  return all.find(p => p.id === projectId);
}

export async function getProjectV2ByIdAsync(projectId: string): Promise<ProjectV2 | undefined> {
  const projects = await getProjectsV2Async();
  return projects.find((p) => p.id === projectId);
}

/**
 * Save V2 projects array to localStorage
 */
function saveV2Projects(projects: ProjectV2[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(projects));
  } catch (error) {
    console.error('Erro ao salvar projetos v2:', error);
  }
}

/**
 * Generate audit events for field-level changes between old and new values.
 */
function generateAuditEvents(
  projectId: string,
  updates: Partial<ProjectV2>,
  existing: ProjectV2,
  actor: string = 'current_user'
): ProjectAuditEvent[] {
  const events: ProjectAuditEvent[] = [];
  const now = new Date().toISOString();

  for (const [key, newValue] of Object.entries(updates)) {
    const oldValue = (existing as any)[key];
    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
      events.push({
        id: `audit-${projectId}-${Date.now()}-${key}`,
        path: key,
        before: oldValue !== undefined ? JSON.stringify(oldValue) : null,
        after: newValue !== undefined ? JSON.stringify(newValue) : null,
        timestamp: now,
        actor,
        action: 'updated',
      });
    }
  }

  return events;
}

/**
 * Update a project with audit logging (V2)
 */
export async function updateProjectV2(
  projectId: string,
  updates: Partial<ProjectV2>,
  actor: string = 'current_user'
): Promise<void> {
  const projects = await getProjectsV2Async();
  const existing = projects.find(p => p.id === projectId);

  if (!existing) {
    throw new Error(`Projeto ${projectId} não encontrado`);
  }

  // Generate audit events
  const auditEvents = generateAuditEvents(projectId, updates, existing, actor);

  const updatedProjects = projects.map(p => {
    if (p.id === projectId) {
      const updated = {
        ...p,
        ...updates,
        audit_log: [...(p.audit_log || []), ...auditEvents],
        last_activity_at: new Date().toISOString(),
      };

      // Recompute health score
      const { score, reasons } = computeHealthScore(updated);
      updated.health_score = score;
      updated.health_reasons = reasons;

      return updated;
    }
    return p;
  });

  saveV2Projects(updatedProjects);

  // Also update v1 storage for backward compat
  const v1Updates: Partial<Project> = {};
  if (updates.nome !== undefined) v1Updates.nome = updates.nome;
  if (updates.status !== undefined) v1Updates.status = updates.status;
  if (updates.valor_total !== undefined) v1Updates.valor_total = updates.valor_total;
  if (updates.valor_executado !== undefined) v1Updates.valor_executado = updates.valor_executado;
  if (updates.progresso_percentual !== undefined) v1Updates.progresso_percentual = updates.progresso_percentual;
  if (Object.prototype.hasOwnProperty.call(updates, 'clientLogoUrl')) {
    v1Updates.clientLogoUrl = updates.clientLogoUrl;
  }

  const v1Projects = (await getProjectsAsync()).map((p) =>
    p.id === projectId ? { ...p, ...v1Updates } : p,
  );
  await upsertProjectsToSupabase(v1Projects, updatedProjects);
}

// ─── Legacy CRUD (unchanged) ─────────────────────────────────────

/**
 * Salva um novo projeto
 */
export async function createProject(projectData: Omit<Project, 'id'>): Promise<Project> {
  const newProject: Project = {
    ...projectData,
    id: `proj-${Date.now()}`,
    created_date: new Date().toISOString().split('T')[0],
    progresso_percentual: projectData.progresso_percentual || 0,
    valor_total: projectData.valor_total || 0,
    valor_executado: projectData.valor_executado || 0,
  };

  const currentProjects = await getProjectsAsync();
  const updatedProjects = [...currentProjects, newProject];

  try {
    const updatedProjectsV2 = loadV2Projects(updatedProjects);
    await upsertProjectsToSupabase(updatedProjects, updatedProjectsV2);
  } catch (error) {
    console.error('Erro ao salvar projeto:', error);
    throw error;
  }

  // Also clear v2 cache so migration runs again
  try {
    localStorage.removeItem(STORAGE_KEY_V2);
  } catch { /* ignore */ }

  return newProject;
}

/**
 * Atualiza um projeto existente
 */
export async function updateProject(projectId: string, updates: Partial<Project>): Promise<void> {
  const currentProjects = await getProjectsAsync();
  const updatedProjects = currentProjects.map(p =>
    p.id === projectId ? { ...p, ...updates } : p
  );

  try {
    const currentV2 = await getProjectsV2Async();
    const updatedV2 = currentV2.map((p) =>
      p.id === projectId ? { ...p, ...updates } : p,
    );
    await upsertProjectsToSupabase(updatedProjects, updatedV2);
  } catch (error) {
    console.error('Erro ao atualizar projeto:', error);
    throw error;
  }
}

/**
 * Remove um projeto
 */
export async function deleteProject(projectId: string): Promise<void> {
  const currentProjects = await getProjectsAsync();
  const currentProjectsV2 = await getProjectsV2Async();
  const updatedProjects = currentProjects.filter(p => p.id !== projectId);

  try {
    if (isSupabaseConfigured()) {
      const supabase = createClient();
      // Ensure we have an authenticated session; RLS will enforce delete permission.
      await getCurrentOrgAndUser(supabase);
      const { error } = await supabase.from(PROJECTS_TABLE).delete().eq('id', projectId);
      if (error) throw new Error(rlsFriendlyMessage('Erro ao remover projeto no Supabase', error));
    }
    saveLocalProjects(updatedProjects);
    saveV2Projects(currentProjectsV2.filter(p => p.id !== projectId));
  } catch (error) {
    console.error('Erro ao remover projeto:', error);
    throw error;
  }
}

export async function uploadProjectFile(
  projectId: string,
  file: File,
  category: 'logo' | 'document' | 'cronograma' = 'document',
): Promise<{ publicUrl: string; path: string }> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase não está configurado. Defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY.');
  }

  const supabase = createClient();
  const { userId, orgId } = await getCurrentOrgAndUser(supabase);
  const safeName = sanitizeFileName(file.name);
  // Path convention required by storage RLS: {organization_id}/{project_id}/{filename}
  const path = `${orgId}/${projectId}/${Date.now()}-${category}-${safeName}`;
  const { error: uploadError } = await supabase.storage
    .from(PROJECT_FILES_BUCKET)
    .upload(path, file, { cacheControl: '3600', upsert: true, contentType: file.type });

  if (uploadError) throw new Error(rlsFriendlyMessage('Erro ao enviar arquivo ao Supabase Storage', uploadError));

  const { data } = supabase.storage.from(PROJECT_FILES_BUCKET).getPublicUrl(path);
  const publicUrl = data.publicUrl;

  const { error: insertError } = await supabase.from(PROJECT_FILES_TABLE).insert({
    project_id: projectId,
    organization_id: orgId,
    created_by: userId,
    bucket_id: PROJECT_FILES_BUCKET,
    object_path: path,
    public_url: publicUrl,
    file_name: file.name,
    content_type: file.type || null,
    file_size: file.size,
    category,
  });

  if (insertError) throw new Error(rlsFriendlyMessage('Erro ao registrar arquivo do projeto', insertError));

  return { publicUrl, path };
}
