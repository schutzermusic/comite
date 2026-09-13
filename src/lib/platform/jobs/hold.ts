/**
 * A TRAVA OPERACIONAL da fila do Apex.
 *
 * ─── Por que ela existe ────────────────────────────────────────────────────
 *
 * Há momentos em que a coisa certa a fazer com a fila é NÃO tocá-la. Um
 * trabalho vencido esperando uma correção que ainda não foi publicada não
 * precisa de mais uma tentativa: precisa de ninguém.
 *
 * A alternativa — mexer no trabalho para "segurá-lo" — troca um estado
 * verdadeiro ("vencido, esperando") por um forjado ("agendado para o ano que
 * vem"), e depois exige lembrar de desfazer a mentira. A trava não mexe em
 * linha nenhuma: ela faz o TRABALHADOR não começar. O que está na fila
 * permanece exatamente como está, e a fila volta a andar quando a variável
 * sair do ambiente.
 *
 * ─── Onde ela mora, e por que aí ───────────────────────────────────────────
 *
 * No trabalhador, e não nas rotas. Existem seis caminhos de produto que
 * acordam a fila por `after()`, mais o cron, mais o operador. Seis guardas
 * independentes seriam seis lugares para esquecer um — e o sétimo caminho,
 * criado no mês que vem, nasceria desprotegido.
 *
 * `drainOnce` é o único lugar por onde TODOS passam. Uma guarda lá é a fila
 * inteira, e é por isso que ela é a autoritativa. O curto-circuito no caminho
 * rápido e a resposta da rota existem por economia e clareza; a garantia é
 * esta função.
 *
 * ─── Interpretação ESTRITA ─────────────────────────────────────────────────
 *
 * Só a string exata `'true'` (sem espaços, sem maiúsculas) pausa. Uma trava que
 * ligasse com `'1'`, `'yes'` ou qualquer coisa não-vazia acabaria ligada por um
 * valor colado sem querer — e uma fila parada em silêncio é um incidente que
 * ninguém vê. Ausente, vazio ou qualquer outro valor: a fila roda como sempre.
 */

/** A variável de ambiente que segura a fila. Operacional, nunca segredo. */
export const DRAIN_PAUSE_ENV = 'APEX_JOBS_DRAIN_PAUSED';

/**
 * A fila está sob trava operacional?
 *
 * Lida a CADA chamada, e nunca memorizada em módulo: a trava tem de poder ser
 * solta mudando a variável e reimplantando, sem depender de qual instância
 * serverless quente sobreviveu à mudança.
 */
export function isDrainPaused(): boolean {
  return process.env[DRAIN_PAUSE_ENV]?.trim() === 'true';
}
