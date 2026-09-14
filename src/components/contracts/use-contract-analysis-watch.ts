'use client';

/**
 * Observação de uma análise em curso — LER, e nunca criar.
 *
 * ─── Por que ele existe ────────────────────────────────────────────────────
 *
 * O dossiê lia `contract_ai_analyses` uma vez, na montagem. Uma análise que
 * terminasse depois disso não aparecia até alguém recarregar a página à mão —
 * então o estado "Analisando" ficava em tela indefinidamente, inclusive muito
 * depois de o trabalho ter concluído ou falhado. O giro não descrevia mais o
 * backend; descrevia apenas a idade da aba.
 *
 * ─── O limite que este hook impõe a si mesmo ───────────────────────────────
 *
 * Ele RELÊ. Não enfileira, não repete chamada de provedor, não cancela nada, e
 * não tem nenhum caminho que escreva. Montar a página, remontá-la, abri-la em
 * dez abas — nada disso cria trabalho, porque observar não é agir.
 *
 * E ele PARA: quando nenhuma análise está viva, e quando o teto de observação
 * se esgota. Uma aba esquecida aberta durante o fim de semana não deve seguir
 * batendo no banco para sempre por causa de um trabalho que já terminou — nem
 * de um que nunca terminou.
 */

import { useEffect, useRef } from 'react';

/** Espaço entre releituras. Curto o bastante para a tela virar sozinha. */
export const ANALYSIS_POLL_INTERVAL_MS = 5_000;

/**
 * Teto de observação, por análise viva.
 *
 * Bem acima dos 600s de tempo de vida da função: se depois disso ainda houver
 * algo marcado como vivo, o que existe é um órfão, e a ceifa da fila é quem
 * responde por ele — não um `setInterval` no navegador de quem por acaso
 * deixou a aba aberta.
 */
export const ANALYSIS_WATCH_CEILING_MS = 900_000;

export interface ContractAnalysisWatchOptions {
  /** Há análise viva, segundo o estado PERSISTIDO já carregado. */
  readonly active: boolean;
  /**
   * Identidade da execução observada. Mudou de análise, o teto recomeça —
   * senão uma segunda leitura herdaria o relógio esgotado da primeira.
   */
  readonly analysisId: string | null;
  /** Releitura do estado persistido. Nunca uma mutação. */
  readonly onPoll: () => void;
}

export function useContractAnalysisWatch({
  active, analysisId, onPoll,
}: ContractAnalysisWatchOptions): void {
  /*
    A callback vive numa ref para que uma nova identidade de função — que muda
    a cada render do dossiê — não reinicie o intervalo e, com ele, o teto.
  */
  const poll = useRef(onPoll);
  useEffect(() => { poll.current = onPoll; }, [onPoll]);

  useEffect(() => {
    if (!active) return;

    const startedWatchingAt = Date.now();
    const id = setInterval(() => {
      if (Date.now() - startedWatchingAt >= ANALYSIS_WATCH_CEILING_MS) {
        clearInterval(id);
        return;
      }
      poll.current();
    }, ANALYSIS_POLL_INTERVAL_MS);

    return () => clearInterval(id);
    /*
      `active` cai para falso assim que o estado persistido vira terminal —
      concluído OU falho — e a limpeza do efeito encerra a observação. É o
      backend que decide quando isto para, e não um contador de tentativas
      daqui.
    */
  }, [active, analysisId]);
}
