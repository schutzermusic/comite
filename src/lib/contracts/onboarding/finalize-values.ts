/**
 * A carga de finalização de um cadastro documento-primeiro.
 *
 * Uma única tradução `rascunho -> final_values`, usada pela carteira e pela
 * retomada. Duas cópias desta função seriam dois caminhos de criação de
 * contrato disfarçados de um só: bastaria uma divergir num campo para o mesmo
 * cadastro nascer diferente conforme a tela por onde foi concluído.
 *
 * Estes valores são o resultado HUMANO da revisão. A RPC
 * `contract_onboarding_finalize` os grava em `final_values` AO LADO da leitura
 * original (`extraction`, `structured_result`), que permanece intocada — é o
 * que permite, depois, distinguir o que o documento dizia do que a pessoa
 * decidiu. Nada aqui carimba autoria de revisão ou aprovação: a única autoria
 * registrada é a do usuário autenticado que chamou a finalização, afirmada
 * pelo servidor, nunca pelo formulário.
 */

import type { ContractOnboardingDraft } from '@/components/contracts/contract-upload';

export function buildIntakeFinalValues(draft: ContractOnboardingDraft): Record<string, unknown> {
  return {
    title: draft.title,
    contract_number: draft.contractNumber,
    counterparty_name: draft.counterpartyName,
    counterparty_party_id: draft.counterpartyPartyId,
    contract_type: draft.contractType,
    owner_user_id: draft.ownerUserId,
    status: draft.status,
    start_date: draft.startDate,
    end_date: draft.endDate,
    signed_date: draft.signedDate,
    renewal_date: draft.renewalDate,
    currency: draft.currency,
    total_value: draft.totalValue,
    monthly_value: draft.monthlyValue,
    payment_terms: draft.paymentTerms,
    scope_summary: draft.scopeSummary,
    risk_level: draft.riskLevel,
    project_id: draft.projectId,
  };
}
