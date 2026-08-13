/**
 * Conector eSocial — somente leitura.
 *
 * Consulta os eventos já transmitidos pelo empregador e os normaliza em
 * métricas que alimentam Pessoas & Custos. Nada aqui assina ou envia evento.
 *
 * Todos os módulos abaixo são server-only: importá-los no browser lança.
 */
export * from './connector/endpoints';
export * from './connector/parser';
