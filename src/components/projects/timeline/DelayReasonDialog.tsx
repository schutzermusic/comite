'use client';

/**
 * Mandatory delay report form (spec §6). Status changes to delayed/blocked
 * are intercepted by the drawer — they only persist after this form submits.
 */

import React, { useState } from 'react';
import { HudButton, HudModal } from '@/components/hud';
import {
  DELAY_REASON_LABELS,
  type DelayReasonCategory,
  type DelayReportInput,
} from '@/lib/types/project-timeline';

export interface DelayReasonDialogProps {
  open: boolean;
  newStatus: 'delayed' | 'blocked';
  defaultForecastFinish?: string | null;
  onCancel: () => void;
  onSubmit: (report: DelayReportInput) => Promise<void>;
}

const inputCls =
  'w-full rounded-lg border border-ig-border bg-transparent px-3 py-2 text-sm text-ig-fg outline-none focus:border-ig-border-focus';

export function DelayReasonDialog({
  open,
  newStatus,
  defaultForecastFinish,
  onCancel,
  onSubmit,
}: DelayReasonDialogProps) {
  const [category, setCategory] = useState<DelayReasonCategory | ''>('');
  const [reason, setReason] = useState('');
  const [impact, setImpact] = useState('');
  const [recovery, setRecovery] = useState('');
  const [forecast, setForecast] = useState(defaultForecastFinish ?? '');
  const [support, setSupport] = useState('');
  const [contractImpact, setContractImpact] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = category && reason.trim() && impact.trim() && recovery.trim() && forecast;

  const handleSubmit = async () => {
    if (!valid || !category) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        newStatus,
        reasonCategory: category,
        reasonText: reason.trim(),
        impactText: impact.trim(),
        recoveryPlanText: recovery.trim(),
        newForecastFinish: forecast,
        supportNeededText: support.trim() || undefined,
        contractImpact,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao registrar atraso.');
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
  };

  return (
    <HudModal
      isOpen={open}
      onClose={onCancel}
      title={newStatus === 'blocked' ? 'Reportar bloqueio' : 'Reportar atraso'}
      subtitle="Justificativa obrigatória — o status só é gravado após este formulário."
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <HudButton variant="ghost" onClick={onCancel} disabled={submitting}>
            Cancelar
          </HudButton>
          <HudButton variant="danger" onClick={handleSubmit} disabled={!valid} isLoading={submitting}>
            Registrar {newStatus === 'blocked' ? 'bloqueio' : 'atraso'}
          </HudButton>
        </div>
      }
    >
      <div className="space-y-3">
        {error && <p className="text-sm text-ig-danger">{error}</p>}
        <div>
          <label className="mb-1 block text-xs text-ig-fg-muted">Categoria do motivo *</label>
          <select
            className={inputCls}
            value={category}
            onChange={(e) => setCategory(e.target.value as DelayReasonCategory)}
          >
            <option value="">Selecione…</option>
            {Object.entries(DELAY_REASON_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-ig-fg-muted">Motivo do atraso *</label>
          <textarea className={inputCls} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-ig-fg-muted">Descrição do impacto *</label>
          <textarea className={inputCls} rows={2} value={impact} onChange={(e) => setImpact(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-ig-fg-muted">Plano de recuperação *</label>
          <textarea className={inputCls} rows={2} value={recovery} onChange={(e) => setRecovery(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-ig-fg-muted">Novo término previsto *</label>
            <input type="date" className={inputCls} value={forecast} onChange={(e) => setForecast(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-ig-fg-muted">Suporte necessário</label>
            <input className={inputCls} value={support} onChange={(e) => setSupport(e.target.value)} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-ig-fg">
          <input type="checkbox" checked={contractImpact} onChange={(e) => setContractImpact(e.target.checked)} />
          Há impacto contratual / para o cliente
        </label>
      </div>
    </HudModal>
  );
}
