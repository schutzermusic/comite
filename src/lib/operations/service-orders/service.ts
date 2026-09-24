/**
 * Escritas governadas da OS em Operações. Nenhuma escrita direta em tabela:
 * cada função aqui é uma chamada a uma função `SECURITY DEFINER` da 200/230,
 * negada ao navegador, com ator humano nomeado. A rota já decidiu a
 * permissão; o banco decide as regras (e confere de novo a permissão dos
 * atos protegidos).
 */
if (typeof window !== 'undefined') {
  throw new Error('operations/service-orders/service.ts não pode ser importado no navegador');
}

import { governedRpc as rpc } from '@/lib/platform/governed-rpc';

export interface GenerateResult {
  service_order_id: string; status: string; reused: boolean; items_added: number;
  os_number?: string; engagement_id?: string;
}

export function generateFromPackage(
  organizationId: string, actorId: string, acceptanceId: string, payload: Record<string, unknown>,
): Promise<GenerateResult> {
  return rpc('internal_service_order_generate_from_package', {
    p_organization_id: organizationId, p_actor: actorId,
    p_acceptance_id: acceptanceId, p_payload: payload,
  });
}

export function registerUpload(
  organizationId: string, actorId: string, engagementId: string, payload: Record<string, unknown>,
): Promise<{ service_order_id: string; document_id: string; reused: boolean; os_number?: string }> {
  return rpc('internal_service_order_register_upload', {
    p_organization_id: organizationId, p_actor: actorId,
    p_engagement_id: engagementId, p_payload: payload,
  });
}

export function applyExtraction(
  organizationId: string, actorId: string, serviceOrderId: string,
): Promise<{ items_added: number }> {
  return rpc('internal_service_order_apply_extraction', {
    p_organization_id: organizationId, p_actor: actorId, p_service_order_id: serviceOrderId,
  });
}

export function seedFromPackage(
  organizationId: string, actorId: string, serviceOrderId: string,
): Promise<{ items_added: number }> {
  return rpc('internal_service_order_seed_from_package', {
    p_organization_id: organizationId, p_actor: actorId, p_service_order_id: serviceOrderId,
  });
}

export function updateDraft(
  organizationId: string, actorId: string, serviceOrderId: string, payload: Record<string, unknown>,
): Promise<{ updated: boolean }> {
  return rpc('internal_service_order_update_draft', {
    p_organization_id: organizationId, p_actor: actorId,
    p_service_order_id: serviceOrderId, p_payload: payload,
  });
}

export function upsertItem(
  organizationId: string, actorId: string, serviceOrderId: string, payload: Record<string, unknown>,
): Promise<{ item_id: string }> {
  return rpc('internal_service_order_item_upsert', {
    p_organization_id: organizationId, p_actor: actorId,
    p_service_order_id: serviceOrderId, p_payload: payload,
  });
}

export function decideItems(
  organizationId: string, actorId: string, serviceOrderId: string,
  decisions: Array<{ item_id: string; decision: 'CONFIRMED' | 'REJECTED' | 'UNCONFIRMED' }>,
): Promise<{ decided: number }> {
  return rpc('internal_service_order_items_decide', {
    p_organization_id: organizationId, p_actor: actorId,
    p_service_order_id: serviceOrderId, p_decisions: decisions,
  });
}

export function compareWithGoverning(
  organizationId: string, serviceOrderId: string,
): Promise<{ compared: boolean; divergences_opened?: number; reason?: string }> {
  return rpc('internal_service_order_compare_with_governing', {
    p_organization_id: organizationId, p_service_order_id: serviceOrderId,
  });
}

export function recordDivergence(
  organizationId: string, actorId: string | null, serviceOrderId: string, payload: Record<string, unknown>,
): Promise<{ recorded: boolean; divergence_id?: string; reason?: string }> {
  return rpc('internal_service_order_record_divergence', {
    p_organization_id: organizationId, p_actor: actorId,
    p_service_order_id: serviceOrderId, p_payload: payload,
  });
}

export function issue(
  organizationId: string, actorId: string, serviceOrderId: string,
): Promise<{ service_order_id: string; status: string }> {
  return rpc('internal_service_order_issue', {
    p_organization_id: organizationId, p_actor: actorId, p_service_order_id: serviceOrderId,
  });
}

export function issueWithException(
  organizationId: string, actorId: string, serviceOrderId: string, reason: string,
  evidenceDocumentId: string | null,
): Promise<{ service_order_id: string; status: string; exception_id: string; divergences_waived: number }> {
  return rpc('internal_service_order_issue_with_exception', {
    p_organization_id: organizationId, p_actor: actorId, p_service_order_id: serviceOrderId,
    p_reason: reason, p_evidence_document_id: evidenceDocumentId,
  });
}

export function amend(
  organizationId: string, actorId: string, serviceOrderId: string,
  payload: Record<string, unknown>, reason: string,
): Promise<{ revision: number; lines_changed: number }> {
  return rpc('internal_service_order_amend', {
    p_organization_id: organizationId, p_actor: actorId, p_service_order_id: serviceOrderId,
    p_payload: payload, p_reason: reason,
  });
}
