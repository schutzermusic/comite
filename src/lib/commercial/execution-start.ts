/**
 * "FECHAR NEGÓCIO E INICIAR EXECUÇÃO" — o lado de leitura e de validação.
 *
 * O ato em si é UMA função governada (`commercial_close_and_start_execution`,
 * migration 213) que orquestra os objetos canônicos: aceite do cliente,
 * trabalho autorizado, OS interna, projeto. Este arquivo não orquestra nada;
 * ele monta o pedido e recusa cedo, com mensagem legível, o que o banco
 * recusaria depois.
 *
 * ⚠️ As regras de `validateExecutionStart` ESPELHAM o SQL. A fonte da verdade
 * continua sendo o banco — esta cópia existe para o formulário não deixar
 * alguém preencher tudo e só então descobrir que faltava a evidência.
 */

export type ExecutionStartMode = 'STANDARD' | 'EXCEPTIONAL';

export type AuthorizationBasis =
  | 'accepted_proposal' | 'customer_email' | 'customer_po' | 'customer_os'
  | 'formal_contract' | 'declared';

export const AUTHORIZATION_BASIS_LABEL: Record<AuthorizationBasis, string> = {
  accepted_proposal: 'Proposta aceita',
  customer_email: 'E-mail de autorização do cliente',
  customer_po: 'Pedido de compra (PO) do cliente',
  customer_os: 'OS do cliente',
  formal_contract: 'Contrato formal assinado',
  declared: 'Autorização declarada (sem documento)',
};

/** Bases que exigem documento ou referência verificável no caminho padrão. */
export const BASIS_REQUIRING_EVIDENCE: AuthorizationBasis[] = ['customer_email', 'customer_po', 'customer_os'];

export const ACCEPTANCE_SOURCE_LABEL: Record<string, string> = {
  signed_document: 'Documento assinado',
  customer_email: 'E-mail do cliente',
  customer_portal: 'Portal do cliente',
  purchase_order: 'Pedido de compra',
  meeting_minutes: 'Ata de reunião',
  integration: 'Integração',
};

/** Mapeamento que o banco faz sozinho; as demais bases pedem a fonte explícita. */
export const IMPLIED_ACCEPTANCE_SOURCE: Partial<Record<AuthorizationBasis, string>> = {
  customer_email: 'customer_email',
  customer_po: 'purchase_order',
  formal_contract: 'signed_document',
};

export const DOCUMENTATION_STATE_LABEL = {
  COMPLETE: 'Documentação completa',
  PENDING: 'Autorizado com documentação pendente',
  REGULARIZED: 'Documentação regularizada',
} as const;

export interface ExecutionStartForm {
  mode: ExecutionStartMode;
  opportunityId: string | null;
  technicalRevisionId: string | null;
  commercialRevisionId: string | null;
  /** Status atual das revisões, para saber se o aceite será registrado agora. */
  technicalStatus?: string | null;
  commercialStatus?: string | null;
  basis: AuthorizationBasis | null;
  authorizationDate: string;
  reference: string;
  documentId?: string | null;
  context: string;
  acceptanceSource: string | null;
  customerAuthorizerName: string;
  contractId?: string | null;
  exception: {
    reason: string;
    internalAuthorizerUserId: string | null;
    regularizationOwnerUserId: string | null;
    regularizationDueDate: string;
  };
  serviceOrder: {
    mode: 'generate' | 'link' | 'upload' | 'skip';
    serviceOrderId?: string | null;
    osNumber?: string;
    title?: string;
    plannedStart?: string;
    plannedFinish?: string;
    upload?: { filePath: string; contentSha256: string | null; fileTitle: string } | null;
    authorizedValue?: string;
  };
  project: {
    mode: 'create' | 'link' | 'skip';
    projectId?: string | null;
    name?: string;
    client?: string;
    startDate?: string;
    finishDate?: string;
    description?: string;
  };
}

export interface ValidationIssue { field: string; message: string }

const SENT_LIKE = ['SENT', 'NEGOTIATION'];
const DEAD = ['SUPERSEDED', 'REJECTED', 'WITHDRAWN', 'EXPIRED'];

export function validateExecutionStart(form: ExecutionStartForm, today = new Date()): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const todayIso = today.toISOString().slice(0, 10);

  if (!form.basis) issues.push({ field: 'basis', message: 'Informe a base comercial da autorização.' });
  if (form.basis === 'declared' && form.mode !== 'EXCEPTIONAL') {
    issues.push({ field: 'basis', message: 'Autorização sem documento só é possível como início excepcional.' });
  }
  if (!form.technicalRevisionId && !form.commercialRevisionId && form.basis !== 'formal_contract') {
    issues.push({ field: 'revisions', message: 'Informe a proposta técnica ou comercial que rege.' });
  }
  for (const [label, status] of [['técnica', form.technicalStatus], ['comercial', form.commercialStatus]] as const) {
    if (status && DEAD.includes(status)) {
      issues.push({ field: 'revisions', message: `A revisão ${label} está encerrada e não pode reger execução.` });
    }
  }
  if (!form.authorizationDate) {
    issues.push({ field: 'authorizationDate', message: 'Informe a data da autorização.' });
  } else if (form.authorizationDate > todayIso) {
    issues.push({ field: 'authorizationDate', message: 'A data da autorização não pode estar no futuro.' });
  }
  const hasEvidence = Boolean(form.reference.trim() || form.documentId);
  if (form.mode === 'STANDARD' && form.basis && BASIS_REQUIRING_EVIDENCE.includes(form.basis) && !hasEvidence) {
    issues.push({ field: 'reference', message: 'Esta base exige documento ou referência verificável (nº do PO, data e remetente do e-mail…).' });
  }
  if (form.basis === 'formal_contract' && !form.contractId) {
    issues.push({ field: 'contractId', message: 'Informe o contrato formal.' });
  }

  if (form.mode === 'STANDARD') {
    const needsAcceptance = [form.technicalStatus, form.commercialStatus]
      .some((status) => status && SENT_LIKE.includes(status));
    const notSent = [form.technicalStatus, form.commercialStatus]
      .some((status) => status && !SENT_LIKE.includes(status) && status !== 'ACCEPTED' && !DEAD.includes(status));
    if (notSent) {
      issues.push({ field: 'revisions', message: 'Uma revisão ainda não foi enviada ao cliente — só revisão enviada recebe aceite. Use o início excepcional se o trabalho precisa começar agora.' });
    }
    const implied = form.basis ? IMPLIED_ACCEPTANCE_SOURCE[form.basis] : undefined;
    if (needsAcceptance && !implied && !form.acceptanceSource) {
      issues.push({ field: 'acceptanceSource', message: 'Informe como o cliente manifestou o aceite.' });
    }
  } else {
    if (!form.exception.reason.trim()) issues.push({ field: 'exception.reason', message: 'Informe o motivo do início excepcional.' });
    if (!form.exception.internalAuthorizerUserId) issues.push({ field: 'exception.internalAuthorizerUserId', message: 'Informe quem autorizou internamente a exceção.' });
    if (!form.exception.regularizationOwnerUserId) issues.push({ field: 'exception.regularizationOwnerUserId', message: 'Informe o responsável pela regularização.' });
    if (!form.exception.regularizationDueDate) {
      issues.push({ field: 'exception.regularizationDueDate', message: 'Informe o prazo de regularização.' });
    } else if (form.exception.regularizationDueDate < todayIso) {
      issues.push({ field: 'exception.regularizationDueDate', message: 'O prazo de regularização não pode estar no passado.' });
    }
    if (!hasEvidence) issues.push({ field: 'reference', message: 'Descreva a evidência disponível (quem autorizou, por qual meio, quando).' });
  }

  if (form.serviceOrder.mode === 'link' && !form.serviceOrder.serviceOrderId) {
    issues.push({ field: 'serviceOrder', message: 'Escolha a OS interna a vincular.' });
  }
  if (form.serviceOrder.mode === 'upload' && (!form.serviceOrder.upload || !form.serviceOrder.osNumber?.trim())) {
    issues.push({ field: 'serviceOrder', message: 'Envie o PDF da OS interna e informe o número dela.' });
  }
  if (form.project.mode === 'link' && !form.project.projectId) {
    issues.push({ field: 'project', message: 'Escolha o projeto a vincular.' });
  }
  if (form.project.mode === 'create' && (!form.project.name?.trim() || !form.project.client?.trim())) {
    issues.push({ field: 'project', message: 'Projeto novo precisa de nome e cliente — ambos vêm da proposta.' });
  }
  return issues;
}

/** O corpo que a função governada entende. Chaves em snake_case, nada a mais. */
export function buildExecutionStartPayload(form: ExecutionStartForm, projectId: string | null) {
  const nullIfBlank = (value?: string | null) => (value && value.trim() ? value.trim() : null);
  return {
    mode: form.mode,
    opportunity_id: form.opportunityId,
    technical_revision_id: form.technicalRevisionId,
    commercial_revision_id: form.commercialRevisionId,
    authorization: {
      type: form.basis,
      date: form.authorizationDate,
      reference: nullIfBlank(form.reference),
      document_id: form.documentId ?? null,
      context: nullIfBlank(form.context),
      acceptance_source: form.acceptanceSource,
      customer_authorizer_name: nullIfBlank(form.customerAuthorizerName),
      contract_id: form.contractId ?? null,
    },
    exception: form.mode === 'EXCEPTIONAL' ? {
      reason: form.exception.reason.trim(),
      internal_authorizer_user_id: form.exception.internalAuthorizerUserId,
      regularization_owner_user_id: form.exception.regularizationOwnerUserId,
      regularization_due_date: form.exception.regularizationDueDate,
    } : undefined,
    service_order: {
      mode: form.serviceOrder.mode,
      service_order_id: form.serviceOrder.serviceOrderId ?? null,
      os_number: nullIfBlank(form.serviceOrder.osNumber),
      title: nullIfBlank(form.serviceOrder.title),
      planned_start: nullIfBlank(form.serviceOrder.plannedStart),
      planned_finish: nullIfBlank(form.serviceOrder.plannedFinish),
      authorized_value: nullIfBlank(form.serviceOrder.authorizedValue),
      file_path: form.serviceOrder.upload?.filePath ?? null,
      content_sha256: form.serviceOrder.upload?.contentSha256 ?? null,
      file_title: form.serviceOrder.upload?.fileTitle ?? null,
    },
    project: {
      mode: form.project.mode,
      project_id: form.project.mode === 'link' ? form.project.projectId : projectId,
      payload: form.project.mode === 'create' ? {
        nome: form.project.name?.trim(),
        cliente: form.project.client?.trim(),
        descricao: nullIfBlank(form.project.description) ?? undefined,
        status: 'em_andamento',
        data_inicio: nullIfBlank(form.project.startDate) ?? undefined,
        data_fim_prevista: nullIfBlank(form.project.finishDate) ?? undefined,
      } : undefined,
    },
  };
}

/** Rótulos para os bloqueios que a função devolve sem abortar. */
export const EXECUTION_BLOCK_LABEL: Record<string, string> = {
  BLOCKING_DIVERGENCE: 'Divergência bloqueante em aberto',
  SERVICE_ORDER_NOT_ISSUED: 'OS interna não emitida',
  SERVICE_ORDER_MISSING: 'Sem OS interna',
};
