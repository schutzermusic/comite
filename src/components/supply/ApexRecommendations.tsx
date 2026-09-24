'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { HudButton, useHudToast } from '@/components/hud';
import {
  SIGNAL_KIND_LABEL, SIGNAL_SEVERITY_LABEL, type SignalKind, type SignalSeverity,
} from '@/lib/supply/intelligence';
import type { SupplySignalsModel } from '@/lib/supply/intelligence-read';
import { EmptyNote, Panel, Segments, StatePill, useOperationsResource, type Tone } from '@/components/operations/ui';
import { ActModal, useInventoryAct } from './inventory/shared';
import { parseDecimal } from './procurement/shared';
import './supply.css';

type Signal = SupplySignalsModel['signals'][number];
type Caps = { RESERVE: boolean; TRANSFER: boolean; REQUISITION: boolean; FOLLOW_UP: boolean; dismiss: boolean };
type Payload = SupplySignalsModel & { ok: true; capabilities: Caps };
const TONE: Record<SignalSeverity, Tone> = { critical: 'danger', high: 'warning', medium: 'info', low: 'neutral' };
const STALE_MS = 15 * 60_000;

const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  return m < 1 ? 'agora' : m < 60 ? `há ${m} min` : `há ${Math.round(m / 60)} h`;
};

/**
 * RECOMENDAÇÕES DA APEX — cada cartão diz o risco, a evidência (com a origem
 * de cada número), a justificativa e UM ato governado. Aceitar executa o ato
 * com a sua identidade e as checagens do banco; descartar pede motivo;
 * acompanhar entrega a cobrança ao acompanhamento do Apex. A leitura é
 * refeita quando está velha — o que deixou de ser verdade some sozinho.
 */
export function ApexRecommendations({ projectId, compact = false }: { projectId?: string; compact?: boolean }) {
  const url = `/api/supply/intelligence${projectId ? `?project=${encodeURIComponent(projectId)}` : ''}`;
  const { data, state, message, refresh } = useOperationsResource<Payload>(url);
  const [filter, setFilter] = useState<'open' | 'decided'>('open');
  const [sweeping, setSweeping] = useState(false);
  const [modal, setModal] = useState<{ kind: 'execute' | 'dismiss' | 'follow'; signal: Signal } | null>(null);
  const { error: notifyError, success } = useHudToast();
  const autoSwept = useRef(false);

  const sweep = async (force: boolean) => {
    setSweeping(true);
    try {
      const r = await fetch(`/api/supply/intelligence/sweep${force ? '?force=1' : ''}`, { method: 'POST' });
      const p = await r.json().catch(() => ({}));
      if (!r.ok || !p.ok) { notifyError('Leitura da Apex falhou', p?.error); return; }
      if (force && !p.skipped) success('Leitura atualizada', `${p.opened} nova(s) · ${p.resolved} resolvida(s)`);
      refresh();
    } finally { setSweeping(false); }
  };

  // Leitura velha (ou inexistente) é refeita uma vez ao abrir — sem ação de negócio nenhuma.
  useEffect(() => {
    if (!data || autoSwept.current) return;
    const stale = !data.lastRun || Date.now() - Date.parse(data.lastRun.ranAt) > STALE_MS;
    if (stale) { autoSwept.current = true; void sweep(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (state !== 'ready' || !data) {
    return <Panel title="Recomendações da Apex"><p className="crm-muted" style={{ padding: 14 }}>{state === 'error' ? message : 'Lendo o supply…'}</p></Panel>;
  }
  const open = data.signals.filter((s) => s.status === 'OPEN');
  const decided = data.signals.filter((s) => s.status !== 'OPEN');
  const rows = filter === 'open' ? open : decided;
  const shown = compact ? rows.slice(0, 6) : rows;

  return (
    <Panel title="Recomendações da Apex"
      note={data.lastRun ? `Leitura ${ago(data.lastRun.ranAt)} · ${open.length} aberta(s)` : 'Ainda sem leitura'}
      aside={<HudButton size="sm" variant="ghost" disabled={sweeping} onClick={() => sweep(true)}>{sweeping ? 'Lendo…' : 'Atualizar leitura'}</HudButton>}>
      <div data-testid="apex-recommendations">
        <div style={{ padding: '8px 14px 0' }}>
          <Segments label="Recorte das recomendações" value={filter} onChange={(v) => setFilter(v as typeof filter)} options={[
            { value: 'open', label: 'Abertas', count: open.length },
            { value: 'decided', label: 'Decididas e resolvidas (30 dias)', count: decided.length },
          ]} />
        </div>
        {shown.length === 0 ? (
          <EmptyNote title={filter === 'open' ? 'Nada pedindo decisão' : 'Nenhuma decisão recente'}
            description={filter === 'open' ? 'A Apex não encontrou falta, atraso ou decisão parada na última leitura.' : 'Recomendações aceitas, descartadas ou resolvidas aparecem aqui.'} />
        ) : (
          <ul className="sup-signals">
            {shown.map((s) => <SignalCard key={s.id} s={s} caps={data.capabilities} onAct={(kind) => setModal({ kind, signal: s })} />)}
          </ul>
        )}
        {compact && rows.length > shown.length && (
          <p style={{ padding: '0 14px 12px' }} className="crm-muted">+{rows.length - shown.length} recomendação(ões) — veja a lista completa na Visão Geral de Supply.</p>
        )}
      </div>
      {modal?.kind === 'execute' && <ExecuteModal s={modal.signal} onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} />}
      {modal?.kind === 'dismiss' && <DismissModal s={modal.signal} onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} />}
      {modal?.kind === 'follow' && <FollowModal s={modal.signal} onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} />}
    </Panel>
  );
}

function SignalCard({ s, caps, onAct }: { s: Signal; caps: Caps; onAct: (k: 'execute' | 'dismiss' | 'follow') => void }) {
  const kind = s.action?.kind;
  const executable = kind === 'RESERVE' || kind === 'TRANSFER' || kind === 'REQUISITION';
  const canExecute = executable && caps[kind as 'RESERVE' | 'TRANSFER' | 'REQUISITION'];
  return (
    <li className="sup-signal" data-testid="apex-signal" data-kind={s.kind}>
      <div className="sup-signal-head">
        <StatePill tone={TONE[s.severity as SignalSeverity] ?? 'neutral'}>{SIGNAL_SEVERITY_LABEL[s.severity as SignalSeverity] ?? s.severity}</StatePill>
        <span className="crm-muted">{SIGNAL_KIND_LABEL[s.kind as SignalKind] ?? s.kind}{s.project ? ` · ${s.project}` : ''}</span>
      </div>
      <b>{s.title}</b>
      <p>{s.rationale}</p>
      {s.evidence.length > 0 && (
        <dl className="sup-evidence">
          {s.evidence.map((e, i) => (
            <div key={`${e.label}:${i}`}><dt>{e.label}</dt><dd>{e.value}{e.source && <span className="crm-muted"> · {e.source}</span>}</dd></div>
          ))}
        </dl>
      )}
      {s.status === 'OPEN' ? (
        <div className="ops-row-actions">
          {executable && (canExecute
            ? <HudButton size="sm" variant="primary" onClick={() => onAct('execute')}>{s.action.label}</HudButton>
            : <span className="crm-muted">Sua alçada não executa este ato.</span>)}
          {kind === 'OPEN' && typeof s.action.payload?.href === 'string' && (
            <Link href={String(s.action.payload.href)}><HudButton size="sm" variant="primary">{s.action.label}</HudButton></Link>)}
          {caps.FOLLOW_UP && !s.followupId && (kind === 'FOLLOW_UP' || s.purchaseOrderId || s.requirementId) && (
            <HudButton size="sm" variant={kind === 'FOLLOW_UP' ? 'primary' : 'ghost'} onClick={() => onAct('follow')}>
              {kind === 'FOLLOW_UP' ? s.action.label : 'Acompanhar'}</HudButton>)}
          {s.followupId && <span className="crm-muted">Em acompanhamento</span>}
          {caps.dismiss && <HudButton size="sm" variant="ghost" onClick={() => onAct('dismiss')}>Descartar</HudButton>}
        </div>
      ) : (
        <p className="crm-muted">{s.status === 'EXECUTED' ? `Executada por ${s.decidedBy ?? '—'}`
          : s.status === 'DISMISSED' ? `Descartada por ${s.decidedBy ?? '—'}: ${s.decisionNote ?? ''}`
            : 'Resolvida — a condição deixou de ser verdade'}</p>
      )}
    </li>
  );
}

function ExecuteModal({ s, onClose, onDone }: { s: Signal; onClose: () => void; onDone: () => void }) {
  const { act, busy } = useInventoryAct(onDone);
  const suggested = Number(s.action.payload?.quantity ?? 0);
  const [quantity, setQuantity] = useState(suggested ? String(suggested) : '');
  const [note, setNote] = useState('');
  const n = quantity ? parseDecimal(quantity) : Number.NaN;
  const needsQty = s.action.kind === 'RESERVE' || s.action.kind === 'TRANSFER';
  return (
    <ActModal title={s.action.label} subtitle="O ato é seu: o banco confere alçada, disponibilidade e se o requisito já está coberto."
      onClose={onClose} busy={busy} disabled={needsQty && !(n > 0)} confirmLabel="Executar" testId="signal-execute-form"
      onConfirm={() => act(`/api/supply/intelligence/signals/${s.id}`, { action: 'execute', quantity: needsQty ? n : undefined,
        note: note.trim() || undefined }, 'Recomendação executada')}>
      <p>{s.rationale}</p>
      {needsQty && <label>Quantidade<input inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></label>}
      <label>Observação (opcional)<input value={note} onChange={(e) => setNote(e.target.value)} /></label>
    </ActModal>
  );
}

function DismissModal({ s, onClose, onDone }: { s: Signal; onClose: () => void; onDone: () => void }) {
  const { act, busy } = useInventoryAct(onDone);
  const [note, setNote] = useState('');
  return (
    <ActModal title="Descartar recomendação" subtitle={s.title} onClose={onClose} busy={busy} disabled={note.trim().length < 3}
      confirmLabel="Descartar" testId="signal-dismiss-form"
      onConfirm={() => act(`/api/supply/intelligence/signals/${s.id}`, { action: 'dismiss', note: note.trim() }, 'Recomendação descartada')}>
      <p className="crm-muted">Enquanto a condição for a mesma, a Apex não volta a sugerir. O motivo fica registrado.</p>
      <label>Motivo<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: material será fornecido pelo cliente" /></label>
    </ActModal>
  );
}

function FollowModal({ s, onClose, onDone }: { s: Signal; onClose: () => void; onDone: () => void }) {
  const { act, busy } = useInventoryAct(onDone);
  const [who, setWho] = useState('');
  const [due, setDue] = useState(String(s.action.payload?.due_date ?? ''));
  const [goal, setGoal] = useState(String(s.action.payload?.goal ?? s.title));
  return (
    <ActModal title="Acompanhar" subtitle="O acompanhamento do Apex cobra o responsável, escala se passar do prazo e fecha com a confirmação."
      onClose={onClose} busy={busy} disabled={who.trim().length < 2 || goal.trim().length < 3} confirmLabel="Abrir acompanhamento" testId="signal-follow-form"
      onConfirm={() => act(`/api/supply/intelligence/signals/${s.id}`, { action: 'follow_up', responsibleText: who.trim(),
        dueDate: due || null, goal: goal.trim() }, 'Acompanhamento aberto')}>
      <label>Objetivo<input value={goal} onChange={(e) => setGoal(e.target.value)} /></label>
      <div className="ops-form-row">
        <label>Responsável<input value={who} onChange={(e) => setWho(e.target.value)} placeholder="Comprador, fornecedor…" /></label>
        <label>Prazo<input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
      </div>
    </ActModal>
  );
}
