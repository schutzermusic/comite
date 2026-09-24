'use client';

import { useState } from 'react';
import { HudButton } from '@/components/hud';
import type { ServiceOrderItem, ServiceOrderItemKind } from '@/lib/operations/service-orders/types';
import {
  ITEM_SECTIONS, itemConfirmationLabels, itemKindLabels, itemOriginLabels,
} from '@/lib/operations/service-orders/labels';
import { EmptyNote, Panel, StatePill, day } from '../ui';

type Decision = 'CONFIRMED' | 'REJECTED' | 'UNCONFIRMED';

const sourceLabel = (i: ServiceOrderItem) =>
  i.source_document_kind === 'TECHNICAL_PROPOSAL' ? 'PT'
    : i.source_document_kind === 'COMMERCIAL_PROPOSAL' ? 'PC'
      : i.source_document_kind === 'INTERNAL_SERVICE_ORDER' ? 'OS carregada' : null;

/**
 * O CONTEÚDO da OS, agrupado pela pergunta que cada linha responde.
 *
 * O dado estruturado vem primeiro; a proveniência (documento, página, trecho,
 * modelo, confiança) vem logo abaixo, menor — está lá para quem quer conferir,
 * sem transformar a tela num despejo de texto extraído. Linha lida pela IA
 * carrega o estado "Pendente de revisão" até alguém confirmar ou retirar.
 */
export function ServiceOrderContent({
  items, editable, kinds, people, onDecide, onAdd, title,
}: {
  items: ServiceOrderItem[];
  editable: boolean;
  kinds?: ServiceOrderItemKind[];
  people: Record<string, string>;
  onDecide: (decisions: Array<{ itemId: string; decision: Decision }>) => Promise<void>;
  onAdd?: (kind: ServiceOrderItemKind, title: string, detail: string) => Promise<void>;
  title?: string;
}) {
  const [adding, setAdding] = useState<{ kind: ServiceOrderItemKind; title: string; detail: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const scoped = kinds ? items.filter((i) => kinds.includes(i.kind)) : items;
  const sections = ITEM_SECTIONS
    .map((s) => ({ ...s, rows: scoped.filter((i) => s.kinds.includes(i.kind)) }))
    .filter((s) => s.rows.length > 0 || (kinds && s.kinds.some((k) => kinds.includes(k))));
  const pending = scoped.filter((i) => i.confirmation_state === 'UNCONFIRMED');

  const decide = async (decisions: Array<{ itemId: string; decision: Decision }>) => {
    setBusy(true);
    try { await onDecide(decisions); } finally { setBusy(false); }
  };

  return (
    <Panel
      title={title ?? 'Conteúdo da OS'}
      note={pending.length ? `${pending.length} linha(s) lida(s) aguardando revisão humana — a emissão espera por elas`
        : `${scoped.filter((i) => i.confirmation_state === 'CONFIRMED').length} linha(s) confirmada(s)`}
      aside={editable && pending.length > 0 ? (
        <HudButton variant="primary" size="sm" disabled={busy}
          onClick={() => decide(pending.map((i) => ({ itemId: i.id, decision: 'CONFIRMED' })))}>
          Confirmar {pending.length} pendente(s)
        </HudButton>
      ) : undefined}
    >
      {scoped.length === 0 && !editable ? (
        <EmptyNote title="Sem linhas" description="Esta OS não tem conteúdo estruturado nesta seção." />
      ) : sections.map((section) => (
        <div key={section.id}>
          <div className="ops-section-title">
            <span>{section.label}</span>
            <span>{section.rows.length}</span>
          </div>
          <div className="ops-lines">
            {section.rows.map((i) => (
              <div key={i.id} className="ops-line" data-state={i.confirmation_state} data-testid="os-line">
                <div className="min-w-0">
                  <p className="ops-line-title">
                    <span className="ops-chip" style={{ marginRight: 8 }}>{itemKindLabels[i.kind]}</span>
                    {i.title}
                  </p>
                  {(i.detail || i.quantity || i.planned_date) && (
                    <p className="ops-line-detail">
                      {[i.detail && i.detail !== i.title ? i.detail : null,
                        i.quantity ? `${Number(i.quantity).toLocaleString('pt-BR')} ${i.unit ?? ''}` : null,
                        i.planned_date ? `Data: ${day(i.planned_date)}` : null].filter(Boolean).join(' · ')}
                    </p>
                  )}
                  <p className="ops-line-source">
                    <span>{itemOriginLabels[i.origin]}</span>
                    {sourceLabel(i) && <span>{sourceLabel(i)}{i.source_page ? ` · p. ${i.source_page}` : ''}</span>}
                    {i.source_quote && <q>{i.source_quote.slice(0, 180)}</q>}
                    {i.ai_model && i.origin !== 'manual' && (
                      <span>Leitura: {i.ai_model}{i.confidence ? ` · ${Math.round(Number(i.confidence) * 100)}%` : ''}</span>
                    )}
                    {i.confirmed_by && i.confirmation_state !== 'UNCONFIRMED' && (
                      <span>{i.confirmation_state === 'CONFIRMED' ? 'Confirmado' : 'Retirado'} por {people[i.confirmed_by] ?? 'usuário'}</span>
                    )}
                  </p>
                </div>
                <div className="ops-line-actions">
                  <StatePill tone={i.confirmation_state === 'CONFIRMED' ? 'success'
                    : i.confirmation_state === 'REJECTED' ? 'neutral' : 'warning'}>
                    {itemConfirmationLabels[i.confirmation_state]}
                  </StatePill>
                  {editable && i.confirmation_state !== 'CONFIRMED' && (
                    <HudButton variant="ghost" size="sm" disabled={busy}
                      onClick={() => decide([{ itemId: i.id, decision: 'CONFIRMED' }])}>Confirmar</HudButton>
                  )}
                  {editable && i.confirmation_state !== 'REJECTED' && (
                    <HudButton variant="ghost" size="sm" disabled={busy}
                      onClick={() => decide([{ itemId: i.id, decision: 'REJECTED' }])}>Retirar</HudButton>
                  )}
                </div>
              </div>
            ))}
            {editable && onAdd && (
              adding && section.kinds.includes(adding.kind) ? (
                <div className="ops-line">
                  <div className="ops-form">
                    <div className="ops-form-row">
                      <label>Tipo
                        <select value={adding.kind} onChange={(e) => setAdding({ ...adding, kind: e.target.value as ServiceOrderItemKind })}>
                          {section.kinds.map((k) => <option key={k} value={k}>{itemKindLabels[k]}</option>)}
                        </select>
                      </label>
                      <label>Título
                        <input value={adding.title} onChange={(e) => setAdding({ ...adding, title: e.target.value })} />
                      </label>
                    </div>
                    <label>Detalhe
                      <input value={adding.detail} onChange={(e) => setAdding({ ...adding, detail: e.target.value })} />
                    </label>
                  </div>
                  <div className="ops-line-actions">
                    <HudButton variant="ghost" size="sm" onClick={() => setAdding(null)}>Cancelar</HudButton>
                    <HudButton variant="primary" size="sm" disabled={busy || !adding.title.trim()}
                      onClick={async () => { setBusy(true); try { await onAdd(adding.kind, adding.title, adding.detail); setAdding(null); } finally { setBusy(false); } }}>
                      Adicionar
                    </HudButton>
                  </div>
                </div>
              ) : (
                <div className="ops-line">
                  <HudButton variant="ghost" size="sm" onClick={() => setAdding({ kind: section.kinds[0], title: '', detail: '' })}>
                    + Linha em {section.label.toLowerCase()}
                  </HudButton>
                </div>
              )
            )}
          </div>
        </div>
      ))}
    </Panel>
  );
}
