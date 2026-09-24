'use client';

import { useState } from 'react';
import type { ServiceOrderPackage } from '@/lib/operations/service-orders/types';
import { proposalKindShort } from '@/lib/operations/service-orders/labels';
import { Busy, KV, Section, SidePanel, dateShort, money } from '@/components/ax';

interface OrderFacts {
  id: string; os_number: string; title: string; scope_summary: string | null; planned_start: string | null; planned_finish: string | null;
  site_label: string | null; authorized_value: string | null; currency: string | null;
}

/**
 * OS EMITIDA → PROJETO, com revisão antes de criar.
 *
 * A pessoa VÊ o que o projeto herda — a OS, o pacote PT + PC regente, a
 * autorização, o período e o local — antes de confirmar: criar direto
 * produziria projeto com dado que ninguém conferiu. O cronograma NÃO nasce
 * daqui: nenhuma etapa é inventada a partir do texto da OS; quem planeja
 * planeja. Divergência em aberto aparece antes do botão.
 */
export function ServiceOrderProjectPanel({ order, pkg, customer, openDivergences, blocking, onClose, onDone }: {
  order: OrderFacts; pkg: ServiceOrderPackage; customer: string | null; openDivergences: number; blocking: number;
  onClose: () => void; onDone: () => void | Promise<void>;
}) {
  const [mode, setMode] = useState<'create' | 'link'>('create');
  const [nome, setNome] = useState(order.title);
  const [cliente, setCliente] = useState(customer ?? '');
  const [existingId, setExistingId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = mode === 'create' ? nome.trim().length > 2 : existingId.trim().length > 0;
  const refs = [pkg.technical, pkg.commercial, pkg.combined].filter(Boolean);

  const submit = async () => {
    setSaving(true); setError(null);
    try {
      const response = await fetch(`/api/commercial/service-orders/${order.id}/project`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(mode === 'link'
          ? { mode: 'link', projectId: existingId.trim() }
          : { mode: 'create', nome: nome.trim(), cliente: cliente.trim(), codigo: order.os_number,
            descricao: order.scope_summary ?? undefined, dataInicio: order.planned_start ?? undefined,
            dataFimPrevista: order.planned_finish ?? undefined }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? 'Não foi possível vincular.');
      await onDone();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SidePanel open onClose={onClose} testId="os-project-form" eyebrow="OS emitida → projeto" title={`Projeto para a ${order.os_number}`}
      meta={<span>O projeto herda o que já foi lido e aceito — sem redigitação. O cronograma é planejado por quem planeja.</span>}
      footer={<>
        <button type="button" className="ax-btn ghost" onClick={onClose}>Voltar</button>
        <button type="button" className="ax-btn primary" disabled={!valid || saving} onClick={submit}>
          <Busy on={saving}>{mode === 'create' ? 'Criar projeto' : 'Vincular projeto'}</Busy></button>
      </>}>
      <Section title="O que o projeto herda">
        <KV items={[
          ['OS interna', order.os_number],
          ...refs.map((r) => [`${proposalKindShort[r!.kind]} regente`, `${r!.proposalNumber} R${String(r!.revision).padStart(2, '0')}`] as [string, string]),
          ['Autorização', order.authorized_value ? money(Number(order.authorized_value), order.currency ?? 'BRL') : 'sem valor'],
          ['Período', order.planned_start || order.planned_finish ? `${dateShort(order.planned_start)} → ${dateShort(order.planned_finish)}` : 'a planejar'],
          ['Local', order.site_label ?? 'não informado'],
        ]} />
      </Section>
      {openDivergences > 0 && (
        <p className={blocking ? 'ax-error-text' : 'ax-note'} role="status">
          {openDivergences} divergência(s) em aberto entre a OS e a fonte regente{blocking ? ', com bloqueante' : ''} — o projeto nasceria sob duas verdades.
        </p>
      )}
      <div className="ax-form" style={{ marginTop: 14 }}>
        <div className="ax-form" role="radiogroup" aria-label="Como o projeto nasce">
          <label className="ax-choice" data-selected={mode === 'create' || undefined}>
            <input type="radio" name="project-mode" checked={mode === 'create'} onChange={() => setMode('create')} />
            <span className="ax-cellstack"><strong>Criar novo projeto</strong><small>código, escopo e datas vêm da OS</small></span>
          </label>
          <label className="ax-choice" data-selected={mode === 'link' || undefined}>
            <input type="radio" name="project-mode" checked={mode === 'link'} onChange={() => setMode('link')} />
            <span className="ax-cellstack"><strong>Vincular projeto existente</strong><small>a obra já existe no portfólio</small></span>
          </label>
        </div>
        {mode === 'create' ? (
          <>
            <label className="ax-field"><span>Nome do projeto</span><input value={nome} onChange={(e) => setNome(e.target.value)} /></label>
            <label className="ax-field"><span>Cliente</span><input value={cliente} onChange={(e) => setCliente(e.target.value)} /></label>
          </>
        ) : (
          <label className="ax-field"><span>Identificador do projeto existente</span>
            <input value={existingId} onChange={(e) => setExistingId(e.target.value)} placeholder="proj-…" /></label>
        )}
        {error && <p className="ax-error-text" role="alert">{error}</p>}
      </div>
    </SidePanel>
  );
}
