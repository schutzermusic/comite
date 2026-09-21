/**
 * A DECISÃO FINANCEIRA DO MÓDULO DE PROJETOS — lado do cliente.
 *
 * ─── Por que ela existe ────────────────────────────────────────────────────
 *
 * Antes disto, "pode ver dinheiro deste projeto?" era respondida em lugar
 * nenhum: o cabeçalho mostrava "Contrato Total (Receita)" para qualquer um que
 * abrisse o projeto, a aba Financeiro abria para qualquer um, e só o evento de
 * medição tinha portão — e o portão dele era de outro módulo
 * (`contracts.view_values`). O mesmo usuário recebia três respostas
 * diferentes em três telas do mesmo projeto.
 *
 * ─── O espelho de SQL, e por que ele é espelho ─────────────────────────────
 *
 * A autoridade é `public.current_user_can_view_project_financials()`
 * (migration 183): é ela que decide quais COLUNAS de
 * `project_schedule_contract_events` têm conteúdo, e é ela que um usuário não
 * consegue contornar chamando a API direto. Esta função existe para que o
 * DESENHO concorde com o dado — esconder a aba, não pintar o KPI — e não para
 * proteger nada sozinha.
 *
 * As duas listas precisam continuar idênticas. `PROJECT_FINANCIAL_PERMISSIONS`
 * é exportada justamente para que um teste possa compará-la com o corpo da
 * função no banco, em vez de confiar em que alguém lembre das duas.
 *
 * ─── O que ela NÃO é ───────────────────────────────────────────────────────
 *
 * Não é permissão nova. Todas as chaves abaixo existem desde a 005 e já estão
 * distribuídas entre os papéis; o que faltava era alguém perguntar.
 *
 * Não é `contracts.view_values`. Aquela responde pelo valor dentro do módulo
 * de CONTRATOS. Esta responde pelo dinheiro deste PROJETO. Um advogado de
 * contratos tem a primeira e não a segunda, e isso é coerente.
 */

import type { PermissionKey } from './types';

/**
 * As chaves que concedem leitura financeira de projeto, em ordem de
 * especificidade — da mais próxima do projeto para a mais ampla.
 *
 * `finance.view` entra porque quem lê o Financeiro da organização inteira já
 * lê o custo deste projeto por outro caminho; excluí-la criaria a situação
 * absurda de esconder em Projetos um número que a mesma pessoa abre no menu
 * ao lado.
 */
export const PROJECT_FINANCIAL_PERMISSIONS: readonly PermissionKey[] = [
  'finance.view_project_costs',
  'projects.view_costs',
  'projects.view_margin',
  'finance.view',
] as const;

/**
 * Pode ver dinheiro deste projeto?
 *
 * Uma pergunta, uma resposta — usada pelo cabeçalho, pela aba Financeiro e
 * pela previsão contratual. O evento de medição não a usa para MASCARAR (isso
 * o banco já fez), apenas para escolher entre "Restrito" e o valor.
 *
 * `owner_admin` recebe todas as chaves na 005, então administrador passa aqui
 * sem um ramo especial — e um ramo especial seria justamente o lugar onde o
 * TypeScript e o SQL poderiam discordar.
 */
export function canViewProjectFinancials(
  hasPermission: (key: PermissionKey) => boolean,
): boolean {
  return PROJECT_FINANCIAL_PERMISSIONS.some((key) => hasPermission(key));
}
