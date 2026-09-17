/**
 * Lógica pura do formulário de edição do contrato.
 *
 * Mora fora do componente porque é a parte que PRECISA de teste: é aqui que se
 * decide o que vai para o banco. `updateContract` grava exatamente as chaves
 * que recebe, então um diff frouxo aqui vira sobrescrita silenciosa lá.
 */

import type { ContractDetail, UpdateContractInput } from './contract-service';

/** Estado do formulário: tudo string, porque tudo vem de `<input>`. */
export interface EditForm {
  title: string;
  contractNumber: string;
  /**
   * Número interno da Ordem de Serviço — CAMPO INDEPENDENTE de
   * `contractNumber` (migration 169). O número do contrato costuma vir
   * extraído do PDF assinado; a OS é atribuída depois, pela operação, e as
   * duas numerações não têm por que coincidir.
   */
  osNumber: string;
  counterpartyName: string;
  contractType: string;
  status: string;
  riskLevel: string;
  startDate: string;
  endDate: string;
  signedDate: string;
  renewalDate: string;
  totalValue: string;
  monthlyValue: string;
  paymentTerms: string;
  scopeSummary: string;
}

/** `YYYY-MM-DD` para o `<input type="date">`; o banco guarda date ou timestamp. */
const toDateInput = (value: string | null | undefined) => (value ? value.slice(0, 10) : '');
const toText = (value: string | null | undefined) => value ?? '';
const toAmount = (value: number | string | null | undefined) =>
  value === null || value === undefined || value === '' ? '' : String(value);

const EMPTY_FORM: EditForm = {
  title: '', contractNumber: '', osNumber: '', counterpartyName: '', contractType: '',
  status: 'active', riskLevel: 'medium', startDate: '', endDate: '',
  signedDate: '', renewalDate: '', totalValue: '', monthlyValue: '',
  paymentTerms: '', scopeSummary: '',
};

export function formFrom(contract: ContractDetail['contract'] | null): EditForm {
  if (!contract) return EMPTY_FORM;
  return {
    title: toText(contract.title),
    contractNumber: toText(contract.contract_number),
    osNumber: toText(contract.os_number),
    counterpartyName: toText(contract.counterparty_name),
    contractType: toText(contract.contract_type),
    status: toText(contract.status) || 'active',
    riskLevel: toText(contract.risk_level) || 'medium',
    startDate: toDateInput(contract.start_date),
    endDate: toDateInput(contract.end_date),
    signedDate: toDateInput(contract.signed_date),
    renewalDate: toDateInput(contract.renewal_date),
    totalValue: toAmount(contract.total_value),
    monthlyValue: toAmount(contract.monthly_value),
    paymentTerms: toText(contract.payment_terms),
    scopeSummary: toText(contract.scope_summary),
  };
}

/** Texto vazio grava NULL, não string vazia — a coluna é nullable por desenho. */
const textOut = (value: string) => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

/**
 * Número do formulário, aceitando `1.234,56` e `1234.56`.
 *
 * A VÍRGULA é quem decide o formato. Com vírgula, o texto é pt-BR: o ponto é
 * separador de milhar e sai, a vírgula é decimal e vira ponto. Sem vírgula, o
 * texto vai como está para `Number`.
 *
 * Tirar o ponto sempre — que é o atalho óbvio — lê `1234.56` como `123456`:
 * multiplica o valor contratado por cem, grava sem erro nenhum e só aparece
 * no relatório da diretoria.
 *
 * Devolve `undefined` quando o texto não é um número: um campo digitado errado
 * não pode virar `null` e apagar o valor contratado em silêncio. O guarda de
 * validação da tela impede o envio antes que isso importe.
 */
const amountOut = (value: string): number | null | undefined => {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const normalized = trimmed.includes(',')
    ? trimmed.replace(/\./g, '').replace(',', '.')
    : trimmed;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const isBadAmount = (value: string) => value.trim().length > 0 && amountOut(value) === undefined;

/** Só o que MUDOU entra no PATCH. */
export function diffContractEdit(before: EditForm, after: EditForm): UpdateContractInput {
  const patch: UpdateContractInput = {};
  if (after.title !== before.title) patch.title = after.title.trim();
  if (after.contractNumber !== before.contractNumber) patch.contractNumber = textOut(after.contractNumber);
  if (after.osNumber !== before.osNumber) patch.osNumber = textOut(after.osNumber);
  if (after.counterpartyName !== before.counterpartyName) patch.counterpartyName = textOut(after.counterpartyName);
  if (after.contractType !== before.contractType) patch.contractType = textOut(after.contractType);
  if (after.status !== before.status) patch.status = after.status;
  if (after.riskLevel !== before.riskLevel) patch.riskLevel = after.riskLevel as UpdateContractInput['riskLevel'];
  if (after.startDate !== before.startDate) patch.startDate = textOut(after.startDate);
  if (after.endDate !== before.endDate) patch.endDate = textOut(after.endDate);
  if (after.signedDate !== before.signedDate) patch.signedDate = textOut(after.signedDate);
  if (after.renewalDate !== before.renewalDate) patch.renewalDate = textOut(after.renewalDate);
  if (after.totalValue !== before.totalValue) patch.totalValue = amountOut(after.totalValue);
  if (after.monthlyValue !== before.monthlyValue) patch.monthlyValue = amountOut(after.monthlyValue);
  if (after.paymentTerms !== before.paymentTerms) patch.paymentTerms = textOut(after.paymentTerms);
  if (after.scopeSummary !== before.scopeSummary) patch.scopeSummary = textOut(after.scopeSummary);
  return patch;
}

