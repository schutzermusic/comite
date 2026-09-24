'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import type { ServiceOrderItem, ServiceOrderItemKind } from '@/lib/operations/service-orders/types';
import { ITEM_SECTIONS, itemConfirmationLabels, itemKindLabels, itemOriginLabels } from '@/lib/operations/service-orders/labels';
import { Busy, Chip, EmptyState, Plane, dateShort, pct, type Tone } from '@/components/ax';

type Decision = 'CONFIRMED' | 'REJECTED' | 'UNCONFIRMED';
const STATE_TONE: Record<string, Tone> = { CONFIRMED: 'success', REJECTED: 'neutral', UNCONFIRMED: 'warning' };

const itemSourceLabel = (i: ServiceOrderItem) =>
  i.source_document_kind === 'TECHNICAL_PROPOSAL' ? 'PT'
    : i.source_document_kind === 'COMMERCIAL_PROPOSAL' ? 'PC'
      : i.source_document_kind === 'INTERNAL_SERVICE_ORDER' ? 'OS importada' : null;

/**
 * O CONTEÚDO da OS, agrupado pela pergunta que cada linha responde. O dado
 * estruturado vem primeiro; a proveniência (documento, página, confiança) fica
 * numa linha discreta, e o trecho literal só abre quando alguém pede — o texto
 * extraído nunca domina a tela. Linha lida pela IA fica "Pendente de revisão"
 * até uma pessoa confirmar ou retirar.
 */
export function ServiceOrderContent({
  items, editable, kinds, people, onDecide, onAdd, title, subtitle, onlyPending, testId,
}: {
  items: ServiceOrderItem[]; editable: boolean; kinds?: ServiceOrderItemKind[]; people: Record<string, string>;
  onDecide: (decisions: Array<{ itemId: string; decision: Decision }>) => Promise<void>;
  onAdd?: (kind: ServiceOrderItemKind, title: string, detail: string) => Promise<void>;
  title?: string; subtitle?: string; onlyPending?: boolean; testId?: string;
}) {
  const [adding, setAdding] = useState<{ kind: ServiceOrderItemKind; title: string; detail: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const scoped = (kinds ? items.filter((i) => kinds.includes(i.kind)) : items)
    .filter((i) => !onlyPending || i.confirmation_state === 'UNCONFIRMED');
  const sections = ITEM_SECTIONS.map((s) => ({ ...s, rows: scoped.filter((i) => s.kinds.includes(i.kind)) }))
    .filter((s) => s.rows.length > 0 || (!onlyPending && editable && onAdd && (!kinds || s.kinds.some((k) => kinds.includes(k)))));
  const pending = scoped.filter((i) => i.confirmation_state === 'UNCONFIRMED');
  const decide = async (decisions: Array<{ itemId: string; decision: Decision }>) => {
    setBusy(true);
    try { await onDecide(decisions); } finally { setBusy(false); }
  };

  return (
    <Plane flush testId={testId} title={title ?? 'Conteúdo da OS'} count={pending.length || undefined} countTone={pending.length ? 'warning' : undefined}
      subtitle={subtitle ?? (pending.length ? `${pending.length} linha(s) lida(s) aguardando revisão humana — a emissão espera por elas`
        : `${scoped.filter((i) => i.confirmation_state === 'CONFIRMED').length} linha(s) confirmada(s)`)}
      action={editable && pending.length > 0 ? (
        <button type="button" className="ax-btn primary sm" disabled={busy}
          onClick={() => decide(pending.map((i) => ({ itemId: i.id, decision: 'CONFIRMED' })))}>
          <Busy on={busy}>Confirmar {pending.length} pendente(s)</Busy></button>
      ) : undefined}>
      {scoped.length === 0 && sections.length === 0 ? (
        <EmptyState compact title={onlyPending ? 'Nada aguardando revisão' : 'Sem linhas'}>
          {onlyPending ? 'Todo o conteúdo lido já foi confirmado ou retirado por uma pessoa.' : 'Esta OS não tem conteúdo estruturado nesta seção.'}
        </EmptyState>
      ) : sections.map((section) => (
        <section key={section.id} className="ax-oslines" aria-label={section.label}>
          <header><span>{section.label}</span><span className="ax-count">{section.rows.length}</span></header>
          {section.rows.map((i) => (
            <div key={i.id} className="ax-osline" data-state={i.confirmation_state} data-testid="os-line">
              <div className="ax-osline-main">
                <span className="ax-osline-title"><span className="ax-kind">{itemKindLabels[i.kind]}</span>{i.title}</span>
                {(i.detail || i.quantity || i.planned_date) && (
                  <span className="ax-osline-detail">
                    {[i.detail && i.detail !== i.title ? i.detail : null,
                      i.quantity ? `${Number(i.quantity).toLocaleString('pt-BR')} ${i.unit ?? ''}`.trim() : null,
                      i.planned_date ? `data ${dateShort(i.planned_date)}` : null].filter(Boolean).join(' · ')}
                  </span>
                )}
                <span className="ax-prov">
                  <span>{itemOriginLabels[i.origin]}</span>
                  {itemSourceLabel(i) && <span>{itemSourceLabel(i)}{i.source_page ? ` · p. ${i.source_page}` : ''}</span>}
                  {i.ai_model && i.origin !== 'manual' && <span>leitura {i.confidence ? pct(Number(i.confidence)) : ''}</span>}
                  {i.confirmed_by && i.confirmation_state !== 'UNCONFIRMED' && (
                    <span>{i.confirmation_state === 'CONFIRMED' ? 'confirmado' : 'retirado'} por {people[i.confirmed_by] ?? 'usuário'}</span>)}
                  {i.source_quote && (
                    <details><summary>trecho</summary><q>{i.source_quote}</q>{i.ai_model && <small> · {i.ai_model}</small>}</details>
                  )}
                </span>
              </div>
              <div className="ax-osline-actions">
                <Chip tone={STATE_TONE[i.confirmation_state] ?? 'neutral'}>{itemConfirmationLabels[i.confirmation_state]}</Chip>
                {editable && i.confirmation_state !== 'CONFIRMED' && (
                  <button type="button" className="ax-btn sm" disabled={busy} onClick={() => decide([{ itemId: i.id, decision: 'CONFIRMED' }])}>Confirmar</button>)}
                {editable && i.confirmation_state !== 'REJECTED' && (
                  <button type="button" className="ax-btn ghost sm" disabled={busy} onClick={() => decide([{ itemId: i.id, decision: 'REJECTED' }])}>Retirar</button>)}
              </div>
            </div>
          ))}
          {editable && onAdd && !onlyPending && (
            adding && section.kinds.includes(adding.kind) ? (
              <div className="ax-osline">
                <div className="ax-form" style={{ flex: 1 }}>
                  <div className="ax-field-row">
                    <label className="ax-field"><span>Tipo</span>
                      <select value={adding.kind} onChange={(e) => setAdding({ ...adding, kind: e.target.value as ServiceOrderItemKind })}>
                        {section.kinds.map((k) => <option key={k} value={k}>{itemKindLabels[k]}</option>)}</select></label>
                    <label className="ax-field"><span>Título</span><input value={adding.title} onChange={(e) => setAdding({ ...adding, title: e.target.value })} /></label>
                  </div>
                  <label className="ax-field"><span>Detalhe</span><input value={adding.detail} onChange={(e) => setAdding({ ...adding, detail: e.target.value })} /></label>
                </div>
                <div className="ax-osline-actions">
                  <button type="button" className="ax-btn ghost sm" onClick={() => setAdding(null)}>Cancelar</button>
                  <button type="button" className="ax-btn primary sm" disabled={busy || !adding.title.trim()}
                    onClick={async () => { setBusy(true); try { await onAdd(adding.kind, adding.title, adding.detail); setAdding(null); } finally { setBusy(false); } }}>
                    Adicionar</button>
                </div>
              </div>
            ) : (
              <div className="ax-osline add">
                <button type="button" className="ax-btn ghost sm" onClick={() => setAdding({ kind: section.kinds[0], title: '', detail: '' })}>
                  <Plus size={13} aria-hidden />Linha em {section.label.toLowerCase()}</button>
              </div>
            )
          )}
        </section>
      ))}
    </Plane>
  );
}
