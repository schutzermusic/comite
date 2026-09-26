'use client';

import { useId, type ReactNode } from 'react';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { ChevronDown, Loader2, Lock } from 'lucide-react';
import { HudSignal } from '@/components/hud';
import type { FlowState, SignalTone } from '../model';

/** Número da etapa do fluxo ("01" … "06"), como no trilho do filme. */
export const stepNo = (n: number) => String(n).padStart(2, '0');

export function Spin() {
  return <Loader2 size={15} className="dgs-spin" aria-hidden />;
}

/** Status inline do produto (`HudSignal`) — ponto + rótulo; nunca uma cápsula com trilho lateral. `lock` = Restrito (cadeado). */
export function Signal({ tone, label, value, title, lock }: { tone: SignalTone; label: string; value?: string | null; title?: string; lock?: boolean }) {
  return <HudSignal variant="inline" size="sm" tone={tone} label={label} value={value ?? undefined} title={title} icon={lock ? <Lock aria-hidden /> : undefined} />;
}

/** O rótulo de etapa do painel: número + ícone + título (o eyebrow do protótipo). */
export function StepEyebrow({ n, icon, children }: { n?: number; icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="dgm-eyebrow dgs-eyebrow">
      {n !== undefined && <span className="dgs-no num" aria-hidden>{stepNo(n)}</span>}
      {icon && <span className="dgm-ico" aria-hidden>{icon}</span>}
      <span>{children}</span>
    </div>
  );
}

/** Restrito é um cadeado neutro (o perfil não lê — não é falha nem "vazio"); só a leitura que falhou é perigo. */
export const FLOW_SIGNAL: Record<FlowState, { tone: SignalTone; label: string }> = {
  done: { tone: 'success', label: 'Feito' },
  current: { tone: 'warning', label: 'Agora' },
  pending: { tone: 'neutral', label: 'Depois' },
  waiting: { tone: 'info', label: 'Aguardando' },
  restricted: { tone: 'neutral', label: 'Restrito' },
  error: { tone: 'danger', label: 'Não carregou' },
  skip: { tone: 'neutral', label: 'Não precisa' },
};

/**
 * Uma etapa do fluxo guiado: cabeçalho-botão (número, título, resumo de uma
 * linha e o estado pelo DADO) e o corpo. Fechada, a etapa ainda diz onde está
 * (o resumo); o estado nunca vem do clique.
 */
export function FlowSection({ n, title, summary, state, signal, open, onToggle, testId, children }: {
  n?: number; title: string; summary?: string | null; state: FlowState; signal?: { tone: SignalTone; label: string };
  open: boolean; onToggle: () => void; testId?: string; children: ReactNode;
}) {
  const bodyId = useId();
  const sig = signal ?? FLOW_SIGNAL[state] ?? FLOW_SIGNAL.error;
  return (
    <section className="dgs-sec" data-state={state} data-open={open ? 'true' : undefined} data-testid={testId}>
      <h4 className="dgs-sec-h">
        <button type="button" className="dgs-sec-btn" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
          <span className="dgs-no num" aria-hidden>{n !== undefined ? stepNo(n) : '··'}</span>
          <span className="dgs-sec-t">
            <b>{title}</b>
            {summary && <small>{summary}</small>}
          </span>
          <span className="dgs-sec-sig"><Signal tone={sig.tone} label={sig.label} lock={!signal && state === 'restricted'} /></span>
          <ChevronDown size={16} className="dgs-chev" aria-hidden />
        </button>
      </h4>
      <div id={bodyId} className="dgs-sec-body" hidden={!open}>{open ? children : null}</div>
    </section>
  );
}

/** Aviso do resultado de um ato, na região viva da etapa. */
export function ActNotice({ tone, title, children }: { tone: 'success' | 'warning' | 'danger' | 'info'; title: string; children?: ReactNode }) {
  return (
    <div className="dgs-notice" data-tone={tone} role={tone === 'danger' ? 'alert' : 'status'}>
      <b>{title}</b>
      {children && <p>{children}</p>}
    </div>
  );
}

/**
 * A confirmação de um ato governado do Supply (o mesmo desenho da confirmação
 * de Decisões): o que é, quanto, e a CONSEQUÊNCIA dita pelo servidor antes de
 * gravar. Radix AlertDialog: foco preso, abre no "Voltar" (nunca no botão que
 * grava), Esc cancela — não enquanto grava.
 */
export function SupplyConfirm({ title, kind, amount, what, consequence, confirmLabel, busy, error, canConfirm = true, hint, onConfirm, onCancel, testId, children }: {
  title: string; kind: string; amount?: string | null; what: string; consequence: ReactNode; confirmLabel: string;
  busy: boolean; error: string | null; canConfirm?: boolean; hint?: string | null;
  onConfirm: () => void; onCancel: () => void; testId?: string; children?: ReactNode;
}) {
  const id = useId();
  const blocked = !canConfirm || busy;
  return (
    <AlertDialog.Root open onOpenChange={(o) => { if (!o && !busy) onCancel(); }}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="ax-overlay dec-confirm-overlay" />
        <AlertDialog.Content className="ax dec-confirm dgs-confirm" data-testid={testId ?? 'dg-supply-confirm'} aria-busy={busy || undefined}
          onEscapeKeyDown={(e) => { if (busy) e.preventDefault(); }}>
          <AlertDialog.Title className="dec-confirm-title">{title}</AlertDialog.Title>
          <div className="dec-confirm-subject">
            <span className="dec-kind">{kind}</span>
            {amount && <strong className="dec-confirm-amount">{amount}</strong>}
            <span className="dec-confirm-what">{what}</span>
          </div>
          <AlertDialog.Description className="dec-confirm-consequence">{consequence}</AlertDialog.Description>
          {children}
          {hint && <p id={`${id}-hint`} className="dgs-confirm-hint">{hint}</p>}
          {error && <p className="dec-confirm-error" role="alert">{error}</p>}
          <div className="dec-confirm-actions">
            <AlertDialog.Cancel className="ax-btn ghost" aria-disabled={busy || undefined} onClick={(e) => { if (busy) e.preventDefault(); }}>
              Voltar
            </AlertDialog.Cancel>
            <button type="button" className="ax-btn primary" data-testid="dg-supply-confirm-submit"
              aria-disabled={blocked || undefined} aria-describedby={hint ? `${id}-hint` : undefined}
              onClick={() => { if (!blocked) onConfirm(); }}>
              {busy && <Spin />}{busy ? 'Registrando…' : error ? `Tentar de novo: ${confirmLabel}` : confirmLabel}
            </button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
