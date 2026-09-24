'use client';

import { useState, type ReactNode } from 'react';
import { HudButton, HudModal, useHudToast } from '@/components/hud';
import type { InventoryWorkspaceModel } from '@/lib/supply/inventory-read';

export type InventoryModel = InventoryWorkspaceModel & { capabilities: { manage: boolean; reserve: boolean; receive: boolean } };

/** Ato de estoque pela rota governada: toast com a recusa do banco, traduzida. */
export function useInventoryAct(onDone: () => void) {
  const { success, error } = useHudToast();
  const [busy, setBusy] = useState(false);
  const act = async (url: string, body: Record<string, unknown>, title: string, detail?: string) => {
    setBusy(true);
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) { error(`${title}: recusado`, payload?.error ?? 'Não foi possível concluir.'); return false; }
      success(title, detail);
      onDone();
      return true;
    } finally { setBusy(false); }
  };
  return { act, busy };
}

export function ActModal({
  title, subtitle, onClose, onConfirm, confirmLabel, disabled, busy, children, testId,
}: {
  title: string; subtitle?: string; onClose: () => void; onConfirm: () => void; confirmLabel: string;
  disabled?: boolean; busy?: boolean; children: ReactNode; testId?: string;
}) {
  return (
    <HudModal isOpen onClose={onClose} size="md" title={title} subtitle={subtitle}
      footer={<div className="flex justify-end gap-2"><HudButton variant="ghost" onClick={onClose}>Voltar</HudButton>
        <HudButton variant="primary" disabled={disabled || busy} onClick={onConfirm}>{confirmLabel}</HudButton></div>}>
      <div className="ops-form" data-testid={testId}>{children}</div>
    </HudModal>
  );
}

export const qty = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
export const newKey = () => crypto.randomUUID();
