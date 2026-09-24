'use client';

import { useState } from 'react';
import { HudButton } from '@/components/hud';
import type { ServiceOrderDivergence } from '@/lib/operations/service-orders/types';
import { divergenceScopeLabels, divergenceSeverityLabels } from '@/lib/operations/service-orders/labels';
import { EmptyNote, Panel, StatePill, day } from '../ui';

const SOURCE_LABEL: Record<string, string> = {
  accepted_proposal: 'Proposta aceita',
  internal_service_order: 'OS interna',
  formal_contract: 'Contrato',
  customer_po: 'Pedido do cliente',
  customer_authorization: 'Autorização do cliente',
};
const sourceName = (kind: string) => SOURCE_LABEL[kind] ?? kind;

/**
 * DIVERGÊNCIAS OS × PT × PC.
 *
 * Resolver é dizer QUAL fonte prevalece — não existe "ignorar". Candidata da
 * IA aparece como tal, com modelo e confiança: ela abre a pergunta, quem
 * responde é gente. Divergência do ENGAJAMENTO (sem OS) também segura a
 * emissão e aparece aqui, marcada.
 */
export function ServiceOrderDivergences({
  divergences, canResolve, canCompare, onResolve, onCompare,
}: {
  divergences: ServiceOrderDivergence[];
  canResolve: boolean;
  canCompare: boolean;
  onResolve: (id: string, prevailing: string, note: string) => Promise<string | null>;
  onCompare: (ai: boolean) => Promise<void>;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [prevailing, setPrevailing] = useState('accepted_proposal');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'rules' | 'ai' | 'resolve' | null>(null);

  const active = divergences.filter((d) => d.state === 'OPEN' || d.state === 'ACKNOWLEDGED');
  const closed = divergences.filter((d) => d.state === 'RESOLVED' || d.state === 'DISMISSED');

  const run = async (ai: boolean) => { setBusy(ai ? 'ai' : 'rules'); try { await onCompare(ai); } finally { setBusy(null); } };

  const render = (d: ServiceOrderDivergence) => (
    <div key={d.id} className="ops-divergence" data-testid="os-divergence">
      <div className="flex flex-wrap items-center gap-2">
        <StatePill tone={d.severity === 'BLOCKING' ? 'danger' : d.severity === 'WARNING' ? 'warning' : 'info'}>
          {divergenceSeverityLabels[d.severity]}
        </StatePill>
        <span className="ops-chip">{divergenceScopeLabels[d.scope] ?? d.scope}</span>
        <span className="crm-muted">
          {d.detected_by === 'ai' ? `Candidata da IA${d.ai_model ? ` · ${d.ai_model}` : ''}${d.confidence ? ` · ${Math.round(Number(d.confidence) * 100)}%` : ''}`
            : d.detected_by === 'rule' ? 'Regra verificável' : 'Registrada por pessoa'}
          {' · '}{day(d.created_at)}{d.service_order_id ? '' : ' · do trabalho autorizado'}
        </span>
      </div>
      <p className="text-ig-body-sm">{d.summary}</p>
      <div className="ops-sides">
        <div><span>{sourceName(d.left_source_kind)}</span>{d.left_value ?? '—'}</div>
        <div><span>{sourceName(d.right_source_kind)}</span>{d.right_value ?? 'Não declara'}</div>
      </div>
      {d.state === 'RESOLVED' && (
        <p className="crm-muted">Prevaleceu: <b>{sourceName(d.resolved_source_kind ?? '')}</b>{d.resolution_note ? ` — ${d.resolution_note}` : ''}</p>
      )}
      {canResolve && (d.state === 'OPEN' || d.state === 'ACKNOWLEDGED') && (
        open === d.id ? (
          <div className="ops-form">
            <div className="ops-form-row">
              <label>Qual fonte prevalece?
                <select value={prevailing} onChange={(e) => setPrevailing(e.target.value)}>
                  <option value="accepted_proposal">Proposta aceita (PT/PC)</option>
                  <option value="internal_service_order">OS interna</option>
                  {d.left_source_kind !== 'accepted_proposal' && (
                    <option value={d.left_source_kind}>{sourceName(d.left_source_kind)}</option>
                  )}
                </select>
              </label>
              <label>Justificativa
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Por que esta fonte vale" />
              </label>
            </div>
            {error && <p className="ops-form-error" role="alert">{error}</p>}
            <div className="flex gap-2">
              <HudButton variant="ghost" size="sm" onClick={() => { setOpen(null); setError(null); }}>Cancelar</HudButton>
              <HudButton variant="primary" size="sm" disabled={busy === 'resolve' || note.trim().length < 5}
                onClick={async () => {
                  setBusy('resolve');
                  const err = await onResolve(d.id, prevailing, note.trim());
                  setBusy(null);
                  if (err) setError(err); else { setOpen(null); setNote(''); }
                }}>Registrar decisão</HudButton>
            </div>
          </div>
        ) : (
          <div><HudButton variant="secondary" size="sm" onClick={() => { setOpen(d.id); setError(null); }}>Decidir</HudButton></div>
        )
      )}
    </div>
  );

  return (
    <>
      <Panel
        title="Divergências em aberto"
        note={active.length ? `${active.filter((d) => d.severity === 'BLOCKING').length} bloqueante(s) · ${active.length} no total` : undefined}
        aside={canCompare ? (
          <div className="flex gap-2">
            <HudButton variant="ghost" size="sm" disabled={!!busy} onClick={() => run(false)}>
              {busy === 'rules' ? 'Confrontando…' : 'Confrontar de novo'}
            </HudButton>
            <HudButton variant="secondary" size="sm" disabled={!!busy} onClick={() => run(true)}>
              {busy === 'ai' ? 'Lendo…' : 'Confronto assistido'}
            </HudButton>
          </div>
        ) : undefined}
      >
        {active.length ? active.map(render) : (
          <EmptyNote title="Nenhuma divergência em aberto"
            description="A OS foi confrontada com a fonte regente e não há pergunta pendente." />
        )}
      </Panel>
      {closed.length > 0 && <Panel title="Decididas">{closed.map(render)}</Panel>}
    </>
  );
}
