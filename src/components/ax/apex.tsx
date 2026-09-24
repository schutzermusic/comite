'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Radar, RefreshCw } from 'lucide-react';
import { SIGNAL_KIND_LABEL, type SignalKind } from '@/lib/supply/intelligence';
import type { SupplySignalsModel } from '@/lib/supply/intelligence-read';
import { dateShort, dateTime, parseDecimalBR } from './format';
import { useGovernedAction, useResource } from './hooks';
import { SidePanel, Section } from './panel';
import { Busy, Chip, EmptyState, type Tone } from './primitives';

type Signal = SupplySignalsModel['signals'][number];
type Caps = { RESERVE: boolean; TRANSFER: boolean; REQUISITION: boolean; FOLLOW_UP: boolean; dismiss: boolean };
type Payload = SupplySignalsModel & { ok: true; capabilities: Caps };

const TONE: Record<string, Tone> = { critical: 'danger', high: 'warning', medium: 'info', low: 'neutral' };
const LEAD: Record<string, string> = {
  SHORTAGE: 'Apex identificou uma falta sem cobertura',
  ALTERNATE_STOCK: 'Apex identificou estoque que evita compra',
  ETA_RISK: 'Apex identificou chegada depois da necessidade',
  LATE_INBOUND: 'Apex identificou entrega atrasada',
  SUPPLIER_RELIABILITY: 'Apex identificou risco de pontualidade',
  DECISION_STALLED: 'Apex identificou decisão de compra parada',
  INSPECTION_BACKLOG: 'Apex identificou inspeção esquecida',
};

/**
 * A INTELIGÊNCIA DA APEX dentro da operação: cada achado diz o que foi visto,
 * a evidência (com a origem de cada número), o impacto e UM ato governado.
 * Aceitar executa o ato com a SUA identidade — alçada, disponibilidade e
 * cobertura reconferidas no banco. A Apex não recebe, não consome, não aprova.
 */
export function ApexFindings({ projectId, limit, title = 'Apex — o que precisa de você', testId }: {
  projectId?: string; limit?: number; title?: string; testId?: string;
}) {
  const url = `/api/supply/intelligence${projectId ? `?project=${encodeURIComponent(projectId)}` : ''}`;
  const { data, state, refresh } = useResource<Payload>(url);
  const [open, setOpen] = useState<{ mode: 'execute' | 'dismiss' | 'follow'; signal: Signal } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const signals = useMemo(() => (data?.signals ?? []).filter((s) => s.status === 'OPEN'), [data]);
  const shown = limit ? signals.slice(0, limit) : signals;

  const reread = async () => {
    setRefreshing(true);
    try { await fetch('/api/supply/intelligence/sweep', { method: 'POST' }); refresh(); } finally { setRefreshing(false); }
  };

  return (
    <section className="ax-plane" data-testid={testId} aria-label={title}>
      <div className="ax-plane-head">
        <div>
          <h3><Radar size={15} aria-hidden style={{ color: 'var(--ax-accent)' }} />{title}
            {signals.length > 0 && <span className={`ax-count ${signals.some((s) => s.severity === 'critical') ? 'danger' : ''}`}>{signals.length}</span>}</h3>
          <p>{data?.lastRun ? `Leitura determinística de ${dateTime(data.lastRun.ranAt)} · motor ${data.lastRun.engineVersion}` : 'Ainda sem leitura neste inquilino'}</p>
        </div>
        <button type="button" className="ax-btn ghost sm" onClick={reread} disabled={refreshing} aria-label="Reler os fatos agora">
          <RefreshCw size={13} className={refreshing ? 'spin' : undefined} aria-hidden />Reler
        </button>
      </div>
      <div className="ax-plane-body flush">
        {state === 'loading' && !data ? <div className="ax-skel" style={{ padding: 16 }}><i /><i style={{ width: '60%' }} /></div>
          : shown.length === 0 ? (
            <EmptyState compact title="Nada pedindo decisão" icon={<Radar size={18} />}>
              A última leitura não encontrou falta, atraso, estoque parado nem decisão esquecida{projectId ? ' neste projeto' : ''}.
            </EmptyState>
          ) : shown.map((s) => (
            <article key={s.id} className="ax-apex" data-tone={TONE[s.severity] ?? 'neutral'} data-testid="apex-finding">
              <span className="ax-apex-mark" aria-hidden><Radar size={15} /></span>
              <div className="ax-apex-body">
                <span className="ax-apex-lead">{LEAD[s.kind] ?? SIGNAL_KIND_LABEL[s.kind as SignalKind] ?? 'Apex identificou'}</span>
                <span className="ax-apex-title">{s.title}</span>
                <span className="ax-apex-impact">
                  {s.project && <>Impacto: <b>{s.project}</b>{' · '}</>}{s.rationale}
                </span>
                {s.evidence.length > 0 && (
                  <div className="ax-evidence" aria-label="Evidência">
                    {s.evidence.slice(0, 4).map((e, i) => (
                      <span key={i}><em>{e.label}</em><strong>{e.value}</strong>{e.source && <em>· {e.source}</em>}</span>
                    ))}
                  </div>
                )}
              </div>
              <div className="ax-apex-actions">
                <Chip tone={TONE[s.severity] ?? 'neutral'}>{severityLabel(s.severity)}</Chip>
                <div className="ax-inline">
                  {actionable(s, data?.capabilities) && (
                    <button type="button" className="ax-btn primary sm" onClick={() => setOpen({ mode: 'execute', signal: s })}>{s.action.label}</button>
                  )}
                  {s.action.kind === 'OPEN' && typeof s.action.payload?.href === 'string' && (
                    <Link className="ax-btn sm" href={deepLink(s)}>{s.action.label}</Link>
                  )}
                  {data?.capabilities.FOLLOW_UP && !s.followupId && (
                    <button type="button" className="ax-btn ghost sm" onClick={() => setOpen({ mode: 'follow', signal: s })}>Acompanhar</button>
                  )}
                  {data?.capabilities.dismiss && (
                    <button type="button" className="ax-btn ghost sm" onClick={() => setOpen({ mode: 'dismiss', signal: s })}>Descartar</button>
                  )}
                </div>
              </div>
            </article>
          ))}
        {limit && signals.length > limit && (
          <div style={{ padding: '10px 16px', borderTop: '1px solid var(--ax-line-soft)' }}>
            <Link className="ax-link" href="/supply?focus=apex">Ver os {signals.length} achados</Link>
          </div>
        )}
      </div>
      {open && <SignalPanel mode={open.mode} signal={open.signal} onClose={() => setOpen(null)} onDone={() => { setOpen(null); refresh(); }} />}
    </section>
  );
}

const severityLabel = (s: string) => ({ critical: 'Crítico', high: 'Alto', medium: 'Médio', low: 'Baixo' } as Record<string, string>)[s] ?? s;

function actionable(s: Signal, caps?: Caps) {
  if (!caps) return false;
  return (s.action.kind === 'RESERVE' && caps.RESERVE) || (s.action.kind === 'TRANSFER' && caps.TRANSFER)
    || (s.action.kind === 'REQUISITION' && caps.REQUISITION);
}

function deepLink(s: Signal): string {
  const base = String(s.action.payload?.href ?? '/supply');
  if (s.kind === 'INSPECTION_BACKLOG' && s.action.payload?.receipt_id) return `/supply/recebimentos?queue=inspection&receipt=${s.action.payload.receipt_id}`;
  if (s.purchaseOrderId) return `${base}?stage=${s.kind === 'DECISION_STALLED' ? 'aprovacao' : 'pedidos'}&po=${s.purchaseOrderId}`;
  return base;
}

function SignalPanel({ mode, signal, onClose, onDone }: { mode: 'execute' | 'dismiss' | 'follow'; signal: Signal; onClose: () => void; onDone: () => void }) {
  const { run, busy } = useGovernedAction(onDone);
  const suggested = Number(signal.action.payload?.quantity ?? 0);
  const [quantity, setQuantity] = useState(suggested ? String(suggested).replace('.', ',') : '');
  const [note, setNote] = useState('');
  const [responsible, setResponsible] = useState('');
  const [due, setDue] = useState('');
  const url = `/api/supply/intelligence/signals/${signal.id}`;
  const q = parseDecimalBR(quantity);
  const submit = () => {
    if (mode === 'execute') {
      void run(`signal-exec:${signal.id}`, url, { action: 'execute', ...(q ? { quantity: q } : {}), ...(note ? { note } : {}) },
        { title: signal.action.label, detail: 'Executado pelo ato governado, com a sua identidade.' }, { idempotent: false });
    } else if (mode === 'dismiss') {
      void run(`signal-dismiss:${signal.id}`, url, { action: 'dismiss', note }, { title: 'Recomendação descartada', detail: 'Fica descartada enquanto a condição for a mesma.' }, { idempotent: false });
    } else {
      void run(`signal-follow:${signal.id}`, url, { action: 'follow_up', responsibleText: responsible, dueDate: due || null },
        { title: 'Acompanhamento aberto', detail: 'O Apex cobra o responsável até a condição mudar.' }, { idempotent: false });
    }
  };
  const valid = mode === 'dismiss' ? note.trim().length >= 3 : mode === 'follow' ? responsible.trim().length > 1 : (!suggested || (q !== null && q > 0));
  const title = mode === 'execute' ? signal.action.label : mode === 'dismiss' ? 'Descartar recomendação' : 'Acompanhar com um responsável';
  return (
    <SidePanel open onClose={onClose} eyebrow="Apex · ato governado" title={title}
      meta={<><span>{signal.title}</span>{signal.project && <span>· {signal.project}</span>}</>}
      footer={<>
        <button type="button" className="ax-btn ghost" onClick={onClose}>Voltar</button>
        <button type="button" className="ax-btn primary" disabled={!valid || busy !== null} onClick={submit}>
          <Busy on={busy !== null}>{mode === 'execute' ? 'Confirmar ato' : mode === 'dismiss' ? 'Descartar' : 'Abrir acompanhamento'}</Busy>
        </button>
      </>}>
      <Section title="Por que a Apex recomenda">
        <p className="ax-muted" style={{ margin: 0 }}>{signal.rationale}</p>
        <div className="ax-evidence" style={{ marginTop: 10 }}>
          {signal.evidence.map((e, i) => <span key={i}><em>{e.label}</em><strong>{e.value}</strong>{e.source && <em>· {e.source}</em>}</span>)}
        </div>
      </Section>
      {mode === 'execute' && (
        <Section title="O que será executado">
          <div className="ax-form">
            {suggested > 0 && (
              <label className="ax-field"><span>Quantidade</span>
                <input inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} aria-describedby="qhint" />
                <small id="qhint">{q === null ? 'Número no padrão brasileiro (ex.: 1.000,5).' : `Será enviado: ${q.toLocaleString('pt-BR')}`}</small>
              </label>
            )}
            <label className="ax-field"><span>Observação (opcional)</span><textarea value={note} onChange={(e) => setNote(e.target.value)} /></label>
            <p className="ax-note">O banco reconfere a sua alçada, o disponível e a cobertura do requisito antes de gravar. Visto em {dateShort(signal.firstSeenAt)}.</p>
          </div>
        </Section>
      )}
      {mode === 'dismiss' && (
        <label className="ax-field"><span>Motivo (obrigatório)</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: material já negociado com o cliente" /></label>
      )}
      {mode === 'follow' && (
        <div className="ax-form">
          <label className="ax-field"><span>Quem responde</span><input value={responsible} onChange={(e) => setResponsible(e.target.value)} /></label>
          <label className="ax-field"><span>Até quando (opcional)</span><input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
        </div>
      )}
    </SidePanel>
  );
}
