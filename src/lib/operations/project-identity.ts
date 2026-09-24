/**
 * Nome e código de projeto a partir do registro canônico (`projects.project`,
 * JSONB). O cadastro tem duas gerações de chave (`nome`/`name`), e as telas de
 * Operações não podem escolher uma e mostrar vazio para a outra.
 */
export interface ProjectIdentity {
  id: string;
  name: string;
  code: string | null;
  client: string | null;
  status: string | null;
}

type ProjectJson = Record<string, unknown> | null | undefined;

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

export function projectIdentity(id: string, project: ProjectJson, projectV2?: ProjectJson): ProjectIdentity {
  const p = project ?? {};
  const v2 = projectV2 ?? {};
  return {
    id,
    name: text(p.nome) ?? text(p.name) ?? text(v2.name) ?? text(p.codigo) ?? id,
    code: text(p.codigo) ?? text(p.codigoInterno) ?? text(v2.code),
    client: text(p.cliente) ?? text(p.client) ?? text(v2.client),
    status: text(p.status) ?? text(v2.status),
  };
}

/** Projeto ATIVO para Operações: em andamento ou em planejamento. */
export function isActiveProjectStatus(status: string | null): boolean {
  if (!status) return false;
  return ['em_andamento', 'planejamento', 'in_progress', 'active', 'planning'].includes(status.toLowerCase());
}
