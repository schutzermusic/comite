'use client';

import { useEffect, useState } from 'react';
import type { EligiblePackage, PackageRevisionRef } from '@/lib/operations/service-orders/types';
import { Busy, Chip, SidePanel, dateShort, money } from '@/components/ax';

const rev = (r: PackageRevisionRef | null) => (r ? `${r.proposalNumber} R${String(r.revision).padStart(2, '0')}` : null);

/**
 * "Gerar a partir de proposta".
 *
 * A lista é de PACOTES ACEITOS — a linha de aceite que prova qual PT e qual PC
 * o cliente aceitou. Pacote sem trabalho autorizado aparece, mas travado, com
 * o motivo: um botão que o banco recusaria ensina a pessoa a desconfiar da tela.
 * Pacote que já gerou OS leva para ela (idempotência visível).
 */
export function GenerateFromPackageModal({
  onClose, onGenerated,
}: { onClose: () => void; onGenerated: (serviceOrderId: string) => void }) {
  const [packages, setPackages] = useState<EligiblePackage[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [osNumber, setOsNumber] = useState('');
  const [siteLabel, setSiteLabel] = useState('');
  const [plannedStart, setPlannedStart] = useState('');
  const [plannedFinish, setPlannedFinish] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const response = await fetch('/api/operations/service-orders/packages');
      const payload = await response.json().catch(() => null);
      if (!cancelled) setPackages(response.ok && payload?.ok ? payload.packages : []);
    })();
    return () => { cancelled = true; };
  }, []);

  const chosen = packages?.find((p) => p.acceptanceId === selected) ?? null;

  const submit = async () => {
    if (!chosen) return;
    if (chosen.serviceOrderId) { onGenerated(chosen.serviceOrderId); return; }
    setSaving(true); setError(null);
    try {
      const response = await fetch('/api/operations/service-orders/generate', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          acceptanceId: chosen.acceptanceId, engagementId: chosen.engagementId ?? undefined,
          osNumber: osNumber.trim() || undefined, siteLabel: siteLabel.trim() || undefined,
          plannedStart: plannedStart || undefined, plannedFinish: plannedFinish || undefined,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) { setError(payload?.error ?? 'Não foi possível gerar a OS.'); return; }
      onGenerated(payload.serviceOrderId);
    } finally { setSaving(false); }
  };

  return (
    <SidePanel open onClose={onClose} wide testId="generate-os-modal" eyebrow="Ordens de Serviço · a partir do aceite" title="Gerar OS a partir de proposta"
      meta={<span>A OS herda escopo, entregáveis, requisitos e valor do pacote PT + PC que o cliente aceitou — nada é redigitado.</span>}
      footer={<>
        <button type="button" className="ax-btn ghost" onClick={onClose}>Cancelar</button>
        <button type="button" className="ax-btn primary" disabled={!chosen || !!chosen.blocker || saving} onClick={submit}>
          <Busy on={saving}>{chosen?.serviceOrderId ? 'Abrir OS existente' : saving ? 'Gerando…' : 'Gerar OS'}</Busy></button>
      </>}>
      <div className="ax-form">
        {packages === null ? <p className="ax-muted">Carregando pacotes aceitos…</p>
          : packages.length === 0 ? (
            <p className="ax-muted">Nenhum pacote PT + PC aceito pelo cliente. O aceite é registrado no Comercial, na proposta — a OS nasce dele.</p>
          ) : (
            <div className="ax-form" role="radiogroup" aria-label="Pacotes aceitos">
              {packages.map((p) => (
                <button key={p.acceptanceId} type="button" role="radio" aria-checked={selected === p.acceptanceId} aria-disabled={!!p.blocker}
                  className="ax-choice ax-package" data-selected={selected === p.acceptanceId || undefined} onClick={() => setSelected(p.acceptanceId)}>
                  <input type="radio" readOnly checked={selected === p.acceptanceId} tabIndex={-1} aria-hidden />
                  <span className="ax-cellstack" style={{ flex: 1 }}>
                    <strong>{p.customer ?? 'Cliente não informado'}</strong>
                    <small>{p.title}</small>
                    <span className="ax-inline" style={{ flexWrap: 'wrap', marginTop: 4 }}>
                      {[rev(p.technical), rev(p.commercial), rev(p.combined)].filter(Boolean).map((label) => <Chip key={label} tone="accent" quiet>{label}</Chip>)}
                      <small>aceito em {dateShort(p.acceptedAt)}</small>
                    </span>
                    {p.blocker === 'NO_ENGAGEMENT' && <small className="ax-warn-text">Sem trabalho autorizado: registre o pacote como fonte de autorização no Comercial antes de gerar.</small>}
                    {p.blocker === 'STALE' && <small className="ax-warn-text">Uma das revisões deixou de estar aceita — o pacote não rege mais.</small>}
                    {p.serviceOrderNumber && <small className="ax-ok-text">Já gerou a OS {p.serviceOrderNumber}.</small>}
                  </span>
                  <strong className="ax-num">{p.totalValue ? money(Number(p.totalValue), p.currency ?? 'BRL') : '—'}</strong>
                </button>
              ))}
            </div>
          )}

        {chosen && !chosen.blocker && !chosen.serviceOrderId && (
          <>
            <div className="ax-field-row">
              <label className="ax-field"><span>Número da OS</span>
                <input value={osNumber} onChange={(e) => setOsNumber(e.target.value)} placeholder="Automático (OS-AAAA-nnnn)" /></label>
              <label className="ax-field"><span>Local da obra</span>
                <input value={siteLabel} onChange={(e) => setSiteLabel(e.target.value)} placeholder="Ex.: Subestação Norte" /></label>
            </div>
            <div className="ax-field-row">
              <label className="ax-field"><span>Início planejado</span><input type="date" value={plannedStart} onChange={(e) => setPlannedStart(e.target.value)} /></label>
              <label className="ax-field"><span>Término planejado</span><input type="date" value={plannedFinish} onChange={(e) => setPlannedFinish(e.target.value)} /></label>
            </div>
          </>
        )}
        {error && <p className="ax-error-text" role="alert">{error}</p>}
      </div>
    </SidePanel>
  );
}
