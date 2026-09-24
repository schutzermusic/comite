/**
 * Escritas governadas do Planejamento (231). Nenhuma escrita direta: cada
 * chamada é uma função `SECURITY DEFINER` negada ao navegador, com ator.
 */
if (typeof window !== 'undefined') {
  throw new Error('operations/planning/service.ts não pode ser importado no navegador');
}

import { governedRpc as rpc } from '@/lib/platform/governed-rpc';

export function upsertRequirement(organizationId: string, actorId: string, payload: Record<string, unknown>) {
  return rpc<{ requirement_id: string; status: string; created: boolean }>('project_requirement_upsert', {
    p_organization_id: organizationId, p_actor: actorId, p_payload: payload });
}

export function transitionRequirement(
  organizationId: string, actorId: string, requirementId: string, to: string, reason: string | null, supersededBy: string | null,
) {
  return rpc<{ requirement_id: string; status: string; from?: string }>('project_requirement_transition', {
    p_organization_id: organizationId, p_actor: actorId, p_requirement_id: requirementId, p_to: to,
    p_reason: reason, p_superseded_by: supersededBy });
}

export function markRequirementSatisfied(
  organizationId: string, actorId: string, requirementId: string, note: string, documentId: string | null, undo: boolean,
) {
  return rpc<{ requirement_id: string; satisfied: boolean }>('project_requirement_mark_satisfied', {
    p_organization_id: organizationId, p_actor: actorId, p_requirement_id: requirementId,
    p_note: note, p_document_id: documentId, p_undo: undo });
}

export function importRequirementsFromServiceOrder(
  organizationId: string, actorId: string, projectId: string, serviceOrderId: string,
) {
  return rpc<{ requirements_added: number }>('project_requirements_import_from_service_order', {
    p_organization_id: organizationId, p_actor: actorId, p_project_id: projectId, p_service_order_id: serviceOrderId });
}
