'use client';

import { useEffect, useState } from 'react';
import { HudButton, HudModal } from '@/components/hud';
import type { EligiblePackage, PackageRevisionRef } from '@/lib/operations/service-orders/types';
import { brl, day } from '../ui';

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
    <HudModal
      isOpen onClose={onClose} size="lg"
      title="Gerar OS a partir de proposta"
      subtitle="A OS herda escopo, entregáveis, requisitos e valor do pacote PT + PC que o cliente aceitou — nada é redigitado."
      footer={
        <div className="flex justify-end gap-2">
          <HudButton variant="ghost" onClick={onClose}>Cancelar</HudButton>
          <HudButton variant="primary" disabled={!chosen || !!chosen.blocker || saving} onClick={submit}>
            {chosen?.serviceOrderId ? 'Abrir OS existente' : saving ? 'Gerando…' : 'Gerar OS'}
          </HudButton>
        </div>
      }
    >
      <div className="ops-form" data-testid="generate-os-modal">
        {packages === null ? <p className="crm-muted">Carregando pacotes aceitos…</p>
          : packages.length === 0 ? (
            <p className="crm-muted">
              Nenhum pacote PT + PC aceito pelo cliente. O aceite é registrado no Comercial, na proposta — a OS nasce dele.
            </p>
          ) : (
            <div className="ops-choice-list" role="radiogroup" aria-label="Pacotes aceitos">
              {packages.map((p) => {
                const disabled = !!p.blocker;
                return (
                  <button
                    key={p.acceptanceId} type="button" className="ops-choice" role="radio"
                    aria-checked={selected === p.acceptanceId}
                    aria-disabled={disabled} onClick={() => setSelected(p.acceptanceId)}
                  >
                    <input type="radio" readOnly checked={selected === p.acceptanceId} tabIndex={-1} aria-hidden />
                    <div className="min-w-0">
                      <strong className="text-ig-body-sm">{p.customer ?? 'Cliente não informado'}</strong>
                      <p className="crm-muted">{p.title}</p>
                      <p className="ops-provenance">
                        {[rev(p.technical), rev(p.commercial), rev(p.combined)].filter(Boolean).map((label) => (
                          <span key={label} className="ops-chip">{label}</span>
                        ))}
                        <span>Aceito em {day(p.acceptedAt)}</span>
                      </p>
                      {p.blocker === 'NO_ENGAGEMENT' && (
                        <p className="crm-tone-warning text-ig-caption">
                          Sem trabalho autorizado: registre o pacote como fonte de autorização no Comercial antes de gerar.
                        </p>
                      )}
                      {p.blocker === 'STALE' && (
                        <p className="crm-tone-warning text-ig-caption">Uma das revisões deixou de estar aceita — o pacote não rege mais.</p>
                      )}
                      {p.serviceOrderNumber && (
                        <p className="crm-tone-success text-ig-caption">Já gerou a OS {p.serviceOrderNumber}.</p>
                      )}
                    </div>
                    <span className="tabular-nums text-ig-body-sm">{brl(p.totalValue, p.currency ?? 'BRL')}</span>
                  </button>
                );
              })}
            </div>
          )}

        {chosen && !chosen.blocker && !chosen.serviceOrderId && (
          <div className="ops-form-row">
            <label>Número da OS
              <input value={osNumber} onChange={(e) => setOsNumber(e.target.value)} placeholder="Automático (OS-AAAA-nnnn)" />
            </label>
            <label>Local da obra
              <input value={siteLabel} onChange={(e) => setSiteLabel(e.target.value)} placeholder="Ex.: Subestação Norte" />
            </label>
            <label>Início planejado
              <input type="date" value={plannedStart} onChange={(e) => setPlannedStart(e.target.value)} />
            </label>
            <label>Término planejado
              <input type="date" value={plannedFinish} onChange={(e) => setPlannedFinish(e.target.value)} />
            </label>
          </div>
        )}
        {error && <p className="ops-form-error" role="alert">{error}</p>}
      </div>
    </HudModal>
  );
}
