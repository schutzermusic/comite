'use client';

import { useEffect, useState } from 'react';
import { HudButton, HudInput, HudModal, HudPanel } from '@/components/hud';
import type { ServiceOrderRow } from './ServiceOrdersWorkbench';

type SourceChain = {
  engagement_title: string | null;
  counterparty_name: string | null;
  governing_source_kind: string | null;
  contract_number: string | null;
  technical_proposal_number: string | null;
  commercial_proposal_number: string | null;
  open_divergence_count: number;
  blocking_divergence_count: number;
};

/**
 * OS emitida → PROJETO, com revisão antes de criar.
 *
 * ─── Por que existe uma revisão, e não um botão ───────────────────────────
 *
 * O §8 pede que o projeto herde cliente, título, escopo, datas e regras do
 * que já foi lido — sem redigitação — e que a pessoa VEJA isso antes de
 * confirmar. Criar direto seria mais rápido e produziria projetos com dados
 * que ninguém conferiu, vindos de uma leitura automática de PDF.
 *
 * ─── O que esta tela deliberadamente não faz ──────────────────────────────
 *
 * Não monta cronograma. Nenhuma etapa, nenhuma dependência, nenhum marco é
 * inventado a partir de "comissionamento em 4 meses". Um Gantt fabricado tem
 * a aparência exata de um Gantt planejado, e a diferença só aparece quando
 * alguém cobra a data.
 *
 * ─── Divergência aberta aparece antes do botão ────────────────────────────
 *
 * Se a OS e a fonte regente discordam, a contagem vem aqui. Criar projeto sob
 * duas verdades é o começo de uma medição que ninguém consegue aceitar.
 */
export function ServiceOrderProjectModal({
  order, onClose, onDone,
}: { order: ServiceOrderRow; onClose: () => void; onDone: () => void | Promise<void> }) {
  const [mode, setMode] = useState<'create' | 'link'>('create');
  const [chain, setChain] = useState<SourceChain | null>(null);
  const [nome, setNome] = useState(order.title);
  const [cliente, setCliente] = useState('');
  const [existingId, setExistingId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(
          `/api/commercial/engagements/${order.engagement_id}/source-chain`);
        const payload = await response.json();
        if (cancelled || !response.ok || !payload.ok) return;
        setChain(payload.chain ?? null);
        if (payload.chain?.counterparty_name) setCliente(payload.chain.counterparty_name);
      } catch { /* a revisão funciona sem a cadeia; ela só fica mais pobre */ }
    })();
    return () => { cancelled = true; };
  }, [order.engagement_id]);

  const submit = async () => {
    setSaving(true); setError(null);
    try {
      const response = await fetch(`/api/commercial/service-orders/${order.id}/project`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(mode === 'link'
          ? { mode: 'link', projectId: existingId.trim() }
          : {
              mode: 'create', nome: nome.trim(), cliente: cliente.trim(),
              codigo: order.os_number,
              descricao: order.scope_summary ?? undefined,
              dataInicio: order.planned_start ?? undefined,
              dataFimPrevista: order.planned_finish ?? undefined,
            }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? 'Não foi possível vincular.');
      await onDone();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <HudModal isOpen onClose={onClose} size="lg"
      title={`Projeto para a OS ${order.os_number}`}
      subtitle="Revise o que será herdado antes de criar.">
      <div className="space-y-4">
        <HudPanel elevation={1} interactive={false}>
          <p className="text-ig-caption uppercase tracking-wide text-ig-fg-subtle">
            Cadeia comercial de origem
          </p>
          <ul className="mt-2 space-y-1 text-ig-body-sm text-ig-fg-muted">
            <li>OS interna: <strong className="text-ig-fg-strong">{order.os_number}</strong></li>
            <li>Proposta técnica: {chain?.technical_proposal_number ?? '—'}</li>
            <li>Proposta comercial: {chain?.commercial_proposal_number ?? '—'}</li>
            <li>Contrato formal: {chain?.contract_number ?? 'não há'}</li>
            <li>Fonte regente: {chain?.governing_source_kind ?? '—'}</li>
          </ul>
          <p className="mt-3 text-ig-caption text-ig-fg-subtle">
            O cronograma NÃO é gerado a partir daqui: o projeto nasce com o que está escrito
            nos documentos, e o planejamento é feito por quem planeja.
          </p>
        </HudPanel>

        {chain && chain.open_divergence_count > 0 && (
          <HudPanel elevation={1} state={chain.blocking_divergence_count > 0 ? 'critical' : 'default'}
            interactive={false}>
            <p className="text-ig-body-sm text-ig-fg-strong">
              {chain.open_divergence_count} divergência(s) em aberto entre a OS e a fonte regente
              {chain.blocking_divergence_count > 0 ? ', sendo bloqueantes.' : '.'}
            </p>
          </HudPanel>
        )}

        <div className="flex gap-2">
          <HudButton variant={mode === 'create' ? 'primary' : 'secondary'} size="sm"
            onClick={() => setMode('create')}>Criar novo projeto</HudButton>
          <HudButton variant={mode === 'link' ? 'primary' : 'secondary'} size="sm"
            onClick={() => setMode('link')}>Vincular projeto existente</HudButton>
        </div>

        {mode === 'create' ? (
          <>
            <HudInput label="Nome do projeto" value={nome}
              onChange={(event) => setNome(event.target.value)} />
            <HudInput label="Cliente" value={cliente}
              onChange={(event) => setCliente(event.target.value)} />
            <p className="text-ig-caption text-ig-fg-subtle">
              Código, escopo e datas vêm da OS e da proposta — sem redigitação.
            </p>
          </>
        ) : (
          <HudInput label="Identificador do projeto existente" value={existingId}
            onChange={(event) => setExistingId(event.target.value)}
            placeholder="proj-…" />
        )}

        {error && (
          <HudPanel elevation={1} state="critical" interactive={false}>
            <p className="text-ig-body-sm text-ig-fg-strong">{error}</p>
          </HudPanel>
        )}

        <div className="flex justify-end gap-2">
          <HudButton variant="secondary" size="md" onClick={onClose}>Cancelar</HudButton>
          <HudButton variant="primary" size="md" disabled={saving} onClick={submit}>
            {saving ? 'Processando…' : mode === 'create' ? 'Criar projeto' : 'Vincular projeto'}
          </HudButton>
        </div>
      </div>
    </HudModal>
  );
}
