/**
 * Rótulos da OS em Operações. Vocabulário canônico em inglês no banco; a tela
 * fala português, num lugar só.
 */
import type { ItemConfirmation, ServiceOrderItemKind, ServiceOrderItemOrigin } from './types';
export { serviceOrderStatusLabels, divergenceScopeLabels, divergenceSeverityLabels } from '@/lib/commercial/labels';

export const itemKindLabels: Record<ServiceOrderItemKind, string> = {
  SCOPE: 'Escopo',
  ACTIVITY: 'Atividade',
  DELIVERABLE: 'Entregável',
  TECHNICAL_REQUIREMENT: 'Requisito técnico',
  MATERIAL: 'Material',
  EQUIPMENT: 'Equipamento',
  WORKFORCE: 'Mão de obra',
  RESOURCE: 'Recurso',
  CUSTOMER_DEPENDENCY: 'Dependência do cliente',
  ASSUMPTION: 'Premissa',
  EXCLUSION: 'Exclusão',
  TEST: 'Ensaio / teste',
  MEASUREMENT_CONDITION: 'Condição de medição',
  COMMERCIAL_REFERENCE: 'Referência comercial',
  DOCUMENT: 'Documento',
  MILESTONE: 'Marco',
  RISK: 'Risco',
};

/**
 * As seções do workspace agrupam as linhas pela PERGUNTA que respondem —
 * "o que fazemos", "o que precisamos", "o que o cliente deve", "como medimos".
 */
export const ITEM_SECTIONS: Array<{ id: string; label: string; kinds: ServiceOrderItemKind[] }> = [
  { id: 'scope', label: 'Escopo e entregáveis', kinds: ['SCOPE', 'DELIVERABLE', 'MILESTONE'] },
  { id: 'activities', label: 'Atividades e ensaios', kinds: ['ACTIVITY', 'TEST'] },
  { id: 'resources', label: 'Materiais e recursos',
    kinds: ['MATERIAL', 'EQUIPMENT', 'WORKFORCE', 'RESOURCE', 'TECHNICAL_REQUIREMENT'] },
  { id: 'customer', label: 'Dependências do cliente', kinds: ['CUSTOMER_DEPENDENCY'] },
  { id: 'boundaries', label: 'Premissas, exclusões e riscos', kinds: ['ASSUMPTION', 'EXCLUSION', 'RISK'] },
  { id: 'commercial', label: 'Medição e referências comerciais',
    kinds: ['MEASUREMENT_CONDITION', 'COMMERCIAL_REFERENCE', 'DOCUMENT'] },
];

export const itemOriginLabels: Record<ServiceOrderItemOrigin, string> = {
  proposal_package: 'Pacote aceito',
  document_extraction: 'Leitura da OS carregada',
  manual: 'Registrado manualmente',
};

export const itemConfirmationLabels: Record<ItemConfirmation, string> = {
  UNCONFIRMED: 'Pendente de revisão',
  CONFIRMED: 'Confirmado',
  REJECTED: 'Retirado',
};

export const originLabels = {
  from_accepted_proposal: 'Gerada do pacote aceito',
  manual: 'Criada manualmente',
  uploaded_document: 'OS importada',
} as const;

export const proposalKindShort = { TECHNICAL: 'PT', COMMERCIAL: 'PC', COMBINED: 'PT+PC' } as const;
