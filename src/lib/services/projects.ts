import { Project } from '@/lib/types';
import type { ProjectV2, ProjectAuditEvent } from '@/lib/types/project-v2';
import { projects as defaultProjects, users } from '@/lib/mock-data';
import { loadV2Projects, STORAGE_KEY_V2 } from '@/lib/services/project-migration';
import { computeHealthScore } from '@/lib/utils/project-utils';
import { db } from '@/lib/firebase';
import { collection, addDoc, getDocs, query, orderBy, doc, updateDoc, deleteDoc } from 'firebase/firestore';

const STORAGE_KEY = 'insight_projects';

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
        return parsed.map((p: any) => {
          if (!p.responsavel || typeof p.responsavel !== 'object' || !p.responsavel.id) {
            p.responsavel = users[0];
          }
          if (!p.codigoInterno) {
            p.codigoInterno = p.codigo || '';
          }
          if (!p.comiteResponsavel) {
            p.comiteResponsavel = p.comite_nome || '';
          }
          if (typeof p.valor_total !== 'number') p.valor_total = 0;
          if (typeof p.valor_executado !== 'number') p.valor_executado = 0;
          if (typeof p.progresso_percentual !== 'number') p.progresso_percentual = 0;
          return p;
        });
      }
    }
  } catch (error) {
    console.error('Erro ao ler projetos do localStorage:', error);
  }

  return defaultProjects;
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

// ─── V2 API (governance-grade) ───────────────────────────────────

/**
 * Get all projects in V2 shape. Runs migration if needed.
 */
export function getProjectsV2(): ProjectV2[] {
  const v1 = getProjects();
  return loadV2Projects(v1);
}

/**
 * Get a single project in V2 shape by ID.
 */
export function getProjectV2ById(projectId: string): ProjectV2 | undefined {
  const all = getProjectsV2();
  return all.find(p => p.id === projectId);
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
  const projects = getProjectsV2();
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

  if (Object.keys(v1Updates).length > 0) {
    await updateProject(projectId, v1Updates);
  }
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

  const currentProjects = getProjects();
  const updatedProjects = [...currentProjects, newProject];

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedProjects));
  } catch (error) {
    console.error('Erro ao salvar projeto no localStorage:', error);
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
  const currentProjects = getProjects();
  const updatedProjects = currentProjects.map(p =>
    p.id === projectId ? { ...p, ...updates } : p
  );

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedProjects));
  } catch (error) {
    console.error('Erro ao atualizar projeto:', error);
    throw error;
  }
}

/**
 * Remove um projeto
 */
export async function deleteProject(projectId: string): Promise<void> {
  const currentProjects = getProjects();
  const updatedProjects = currentProjects.filter(p => p.id !== projectId);

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedProjects));
    // Also remove from v2
    const v2Projects = getProjectsV2().filter(p => p.id !== projectId);
    saveV2Projects(v2Projects);
  } catch (error) {
    console.error('Erro ao remover projeto:', error);
    throw error;
  }
}
