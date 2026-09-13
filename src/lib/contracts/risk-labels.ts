/**
 * Rótulo PT-BR do nível de risco.
 *
 * Canônico e único. `low`/`medium`/`high` são valores persistidos — o
 * vocabulário do banco, do CHECK e da API — e continuam sendo. O que nunca
 * pode acontecer é uma tela de negócio imprimir "risco high": a carteira não
 * fala inglês, e um enum cru na interface é detalhe de implementação vazando
 * para quem decide sobre o contrato.
 *
 * Sem React, sem Intl: puro, testável em Node, importável de qualquer camada.
 */

export type ContractRiskLevel = 'low' | 'medium' | 'high';

export const CONTRACT_RISK_LABELS: Readonly<Record<ContractRiskLevel, string>> = {
  low: 'Baixo',
  medium: 'Médio',
  high: 'Alto',
};

/**
 * Traduz um nível de risco.
 *
 * Valor desconhecido volta como veio, e não como "Médio": inventar um nível
 * para um valor que não reconhecemos seria afirmar classificação que ninguém
 * fez. Esta função NÃO classifica risco — só nomeia o que já está persistido.
 */
export function contractRiskLabel(value: unknown): string {
  if (typeof value !== 'string') return String(value ?? '');
  return CONTRACT_RISK_LABELS[value as ContractRiskLevel] ?? value;
}
