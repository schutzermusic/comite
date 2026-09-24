'use client';

import { useState } from 'react';
import { GitCompareArrows, Radar } from 'lucide-react';
import type { ServiceOrderDivergence } from '@/lib/operations/service-orders/types';
import { divergenceValueText } from '@/lib/operations/service-orders/comparison';
import { divergenceScopeLabels, divergenceSeverityLabels } from '@/lib/operations/service-orders/labels';
import { Busy, Chip, EmptyState, Plane, SidePanel, dateShort, pct, type Tone } from '@/components/ax';

const SOURCE_LABEL: Record<string, string> = {
  accepted_proposal: 'Proposta aceita (PT/PC)', internal_service_order: 'OS interna', formal_contract: 'Contrato',
  customer_po: 'Pedido do cliente', customer_authorization: 'Autorização do cliente',
};
const sourceName = (kind: string) => SOURCE_LABEL[kind] ?? kind;
const SEVERITY_TONE: Record<string, Tone> = { BLOCKING: 'danger', WARNING: 'warning', INFO: 'info' };

/**
 * DIVERGÊNCIAS OS × PT × PC. Resolver é dizer QUAL fonte prevalece — não
 * existe "ignorar". Candidata da IA aparece como tal, com modelo e confiança:
 * ela abre a pergunta, quem responde é gente. Divergência do TRABALHO (sem OS)
 * também segura a emissão e aparece aqui, marcada.
 */
export function ServiceOrderDivergences({
  divergences, canResolve, canCompare, onResolve, onCompare, focus, currency,
}: {
  divergences: ServiceOrderDivergence[]; canResolve: boolean; canCompare: boolean; currency: string | null;
  onResolve: (id: string, prevailing: string, note: string) => Promise<string | null>;
  onCompare: (ai: boolean) => Promise<void>; focus?: string | null;
}) {
  const [deciding, setDeciding] = useState<ServiceOrderDivergence | null>(() => (focus ? divergences.find((d) => d.id === focus) ?? null : null));
  const [busy, setBusy] = useState<'rules' | 'ai' | null>(null);
  const active = divergences.filter((d) => d.state === 'OPEN' || d.state === 'ACKNOWLEDGED');
  const closed = divergences.filter((d) => d.state === 'RESOLVED' || d.state === 'DISMISSED');
  const run = async (ai: boolean) => { setBusy(ai ? 'ai' : 'rules'); try { await onCompare(ai); } finally { setBusy(null); } };

  const render = (d: ServiceOrderDivergence) => (
    <article key={d.id} className="ax-divergence" data-severity={d.severity} data-testid="os-divergence">
      <header>
        <Chip tone={SEVERITY_TONE[d.severity] ?? 'neutral'}>{divergenceSeverityLabels[d.severity]}</Chip>
        <span className="ax-kind">{divergenceScopeLabels[d.scope] ?? d.scope}</span>
        <small className="ax-subtle">
          {d.detected_by === 'ai' ? <><Radar size={11} aria-hidden /> candidata da IA{d.ai_model ? ` · ${d.ai_model}` : ''}{d.confidence ? ` · ${pct(Number(d.confidence))}` : ''}</>
            : d.detected_by === 'rule' ? 'regra verificável' : 'registrada por pessoa'} · {dateShort(d.created_at)}{d.service_order_id ? '' : ' · do trabalho autorizado'}
        </small>
      </header>
      <p>{d.summary}</p>
      <div className="ax-sides">
        <div><span>{sourceName(d.left_source_kind)}</span><strong>{divergenceValueText(d, d.left_value, currency)}</strong></div>
        <GitCompareArrows size={16} aria-hidden />
        <div><span>{sourceName(d.right_source_kind)}</span><strong>{divergenceValueText(d, d.right_value, currency)}</strong></div>
      </div>
      {d.state === 'RESOLVED' && <p className="ax-note">Prevaleceu: <strong>{sourceName(d.resolved_source_kind ?? '')}</strong>{d.resolution_note ? ` — ${d.resolution_note}` : ''}</p>}
      {canResolve && (d.state === 'OPEN' || d.state === 'ACKNOWLEDGED') && (
        <div><button type="button" className="ax-btn sm" onClick={() => setDeciding(d)}>Decidir</button></div>
      )}
    </article>
  );

  return (
    <>
      <Plane title="Divergências em aberto" count={active.length} countTone={active.some((d) => d.severity === 'BLOCKING') ? 'danger' : active.length ? 'warning' : undefined}
        subtitle={active.length ? `${active.filter((d) => d.severity === 'BLOCKING').length} bloqueante(s) · ${active.length} no total` : 'Confrontada com a fonte regente'}
        action={canCompare ? (
          <div className="ax-inline">
            <button type="button" className="ax-btn ghost sm" disabled={!!busy} onClick={() => run(false)}><Busy on={busy === 'rules'}>Confrontar de novo</Busy></button>
            <button type="button" className="ax-btn sm" disabled={!!busy} onClick={() => run(true)}><Busy on={busy === 'ai'}>Confronto assistido</Busy></button>
          </div>
        ) : undefined}>
        {active.length ? <div className="ax-stack" style={{ gap: 10 }}>{active.map(render)}</div> : (
          <EmptyState compact title="Nenhuma divergência em aberto">A OS foi confrontada com a fonte regente e não há pergunta pendente.</EmptyState>
        )}
      </Plane>
      {closed.length > 0 && <Plane title="Decididas" count={closed.length}><div className="ax-stack" style={{ gap: 10 }}>{closed.map(render)}</div></Plane>}
      {deciding && <ResolvePanel d={deciding} currency={currency} onClose={() => setDeciding(null)} onResolve={onResolve} />}
    </>
  );
}

function ResolvePanel({ d, currency, onClose, onResolve }: {
  d: ServiceOrderDivergence; currency: string | null; onClose: () => void; onResolve: (id: string, prevailing: string, note: string) => Promise<string | null>;
}) {
  const [prevailing, setPrevailing] = useState(d.left_source_kind === 'internal_service_order' ? d.right_source_kind : d.left_source_kind);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const options = Array.from(new Set([d.left_source_kind, d.right_source_kind, 'accepted_proposal', 'internal_service_order']));
  return (
    <SidePanel open onClose={onClose} testId="divergence-resolve-form" eyebrow={`${divergenceSeverityLabels[d.severity]} · ${divergenceScopeLabels[d.scope] ?? d.scope}`}
      title="Qual fonte prevalece?" meta={<span>{d.summary}</span>}
      footer={<>
        <button type="button" className="ax-btn ghost" onClick={onClose}>Voltar</button>
        <button type="button" className="ax-btn primary" disabled={busy || note.trim().length < 5}
          onClick={async () => { setBusy(true); const err = await onResolve(d.id, prevailing, note.trim()); setBusy(false); if (err) setError(err); else onClose(); }}>
          <Busy on={busy}>Registrar decisão</Busy></button>
      </>}>
      <div className="ax-form" role="radiogroup" aria-label="Fonte que prevalece">
        {options.map((o) => (
          <label key={o} className="ax-choice" data-selected={prevailing === o || undefined}>
            <input type="radio" name="prevailing" checked={prevailing === o} onChange={() => setPrevailing(o)} />
            <span className="ax-cellstack"><strong>{sourceName(o)}</strong>
              <small>{o === d.left_source_kind ? divergenceValueText(d, d.left_value, currency)
                : o === d.right_source_kind ? divergenceValueText(d, d.right_value, currency) : 'fonte regente do trabalho'}</small></span>
          </label>
        ))}
        <label className="ax-field"><span>Justificativa</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Por que esta fonte vale — ata, e-mail, aditivo…" /></label>
        {error && <p className="ax-error-text" role="alert">{error}</p>}
      </div>
    </SidePanel>
  );
}
