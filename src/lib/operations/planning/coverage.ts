/**
 * O ponto em que o Planejamento lê a cobertura do Supply.
 *
 * Wave D: ainda não existe alocação de suprimento (reserva, transferência,
 * compra) — então nenhum requisito tem cobertura, e isso é a verdade, não um
 * atalho. A wave F troca este carregador pela leitura da visão de cobertura.
 */
if (typeof window !== 'undefined') {
  throw new Error('operations/planning/coverage.ts não pode ser importado no navegador');
}

import { noCoverage, type CoverageLoader } from './read-model';

export const supplyCoverageLoader: CoverageLoader = noCoverage;
