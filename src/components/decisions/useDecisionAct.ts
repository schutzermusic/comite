'use client';

import { useRef, useState, type RefObject } from 'react';
import { useHudToast } from '@/components/hud';
import { notifyChanged } from '@/components/ax';
import { normalizeReason } from '@/lib/decisions/model';
import type { DecisionAction, DecisionActRequest, DecisionDetail } from '@/lib/decisions/types';
import { ACTION_DONE, NETWORK_MESSAGE, interpretActResponse, newIntentId, type ActVerdict } from './view';

export type ActNotice = { tone: 'success' | 'warning' | 'danger'; title: string; text: string };

/**
 * O ATO GOVERNADO de uma decisão fora do painel de Decisões (o Dashboard
 * aprova a compra no Supply Chain) — o MESMO ato do `DecisionPanel`:
 *
 *   • a intenção (`intentId`) nasce ao ABRIR a confirmação e é reusada na
 *     repetição (rede/5xx), nunca no clique de confirmar;
 *   • o corpo é o mesmo: ação, justificativa normalizada, a impressão digital
 *     que a tela ACHA que está decidindo (divergiu → STALE) e a intenção;
 *   • a resposta é lida pelo mesmo `interpretActResponse`: registrado → toast
 *     e aviso; tela velha / sem alçada → aviso sem erro; recusado → fica no
 *     diálogo; incerto → a repetição é a mesma intenção, com a justificativa
 *     travada;
 *   • depois de qualquer desfecho, `notifyChanged()` — toda leitura aberta se
 *     refaz a partir do servidor.
 *
 * O `DecisionPanel` mantém a sua cópia em linha: `tests/unit/decisions-view`
 * fixa o código-fonte dele. Ligar o painel a este hook é um passo seguinte,
 * junto com aquele teste.
 */
export function decisionActBody(
  d: Pick<DecisionDetail, 'item' | 'resolved'>, action: DecisionAction, reason: string, intentId: string,
): DecisionActRequest {
  return {
    action,
    reason: normalizeReason(reason),
    expectedFingerprint: d.item?.fingerprint ?? d.resolved.fingerprint ?? null,
    intentId,
  };
}

/** POST /api/decisions/[chave]/act — a resposta já interpretada; rede caída é "incerto", nunca "feito". */
export async function postDecisionAct(key: string, body: DecisionActRequest, fetcher: typeof fetch = fetch): Promise<ActVerdict> {
  try {
    const response = await fetcher(`/api/decisions/${encodeURIComponent(key)}/act`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    return interpretActResponse(response.status, await response.json().catch(() => null));
  } catch {
    return { kind: 'error', message: NETWORK_MESSAGE };
  }
}

/**
 * `noticeRef`: o aviso do resultado (região viva) da tela que usa o hook — o
 * foco vai para ele quando o diálogo fecha depois de um desfecho. A ref fica
 * com a tela (o hook devolve só valores e funções).
 */
export function useDecisionAct({ onSettled, noticeRef }: {
  onSettled?: (notice: ActNotice) => void; noticeRef?: RefObject<HTMLElement>;
} = {}) {
  const { success } = useHudToast();
  const [confirm, setConfirm] = useState<{ action: DecisionAction; intentId: string } | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [notice, setNotice] = useState<ActNotice | null>(null);
  const focusNotice = useRef(false);
  // O botão que abriu a confirmação: o foco volta a ele quando se desiste ("Voltar", Esc).
  const opener = useRef<HTMLElement | null>(null);

  const open = (action: DecisionAction) => {
    // Uma intenção por abertura: a repetição DESTA confirmação reusa o mesmo intentId.
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setConfirm({ action, intentId: newIntentId() });
    setReason('');
    setError(null);
    setUncertain(false);
  };

  const settle = (next: ActNotice) => {
    focusNotice.current = true;
    setConfirm(null);
    setNotice(next);
    onSettled?.(next);
    notifyChanged();
  };

  const submit = async (d: Pick<DecisionDetail, 'key' | 'item' | 'resolved'>) => {
    if (!confirm || busy) return;
    setBusy(true);
    setError(null);
    const verdict = await postDecisionAct(d.key, decisionActBody(d, confirm.action, reason, confirm.intentId));
    setBusy(false);
    switch (verdict.kind) {
      case 'done': {
        const title = verdict.replay ? 'Já estava registrado' : ACTION_DONE[confirm.action];
        const text = verdict.downstreamPending ? `${verdict.message} O reflexo no módulo de origem é aplicado em instantes.` : verdict.message;
        success(title, text);
        settle({ tone: 'success', title, text });
        break;
      }
      case 'stale': settle({ tone: 'warning', title: 'A decisão mudou', text: verdict.message }); break;
      case 'forbidden': settle({ tone: 'danger', title: 'Ato não permitido', text: verdict.message }); break;
      case 'invalid': setError(verdict.message); break;
      default:
        // Incerto: pode ter gravado. A repetição é a mesma intenção — e a mesma justificativa.
        setError(verdict.message);
        setUncertain(true);
    }
  };

  const cancel = () => setConfirm(null);

  /** Ao fechar o diálogo: foco no aviso do resultado, senão de volta ao botão que abriu. */
  const closedFocus = (): boolean => {
    const target = noticeRef?.current;
    if (focusNotice.current && target) {
      focusNotice.current = false;
      target.focus();
      return true;
    }
    const back = opener.current;
    if (back && back.isConnected) { back.focus(); return true; }
    return false;
  };

  return { confirm, reason, setReason, busy, error, uncertain, notice, open, submit, cancel, closedFocus };
}
