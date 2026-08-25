'use client';

/**
 * Criação de atividade em formulário.
 *
 * Substitui o `window.prompt('Nome da nova atividade:')` anterior, que só
 * capturava o título — e como duração é a fonte das horas planejadas, toda
 * atividade criada manualmente nascia sem planejado e caía no "—" para sempre.
 * Aqui a duração é pedida em HORAS (a unidade em que o gestor pensa) e
 * convertida para os minutos que a coluna espera.
 */

import React, { useMemo, useState } from 'react';
import { HudButton, HudInput, HudModal, HudSelect } from '@/components/hud';
import { TIMELINE_TYPE_LABELS, type NewTimelineItemInput, type TimelineItem, type TimelineItemType } from '@/lib/types/project-timeline';

const TYPE_OPTIONS = (Object.keys(TIMELINE_TYPE_LABELS) as TimelineItemType[]).map((value) => ({
  value,
  label: TIMELINE_TYPE_LABELS[value],
}));

export interface NewActivityModalProps {
  open: boolean;
  projectId: string;
  /** Fases candidatas a pai (apenas summary ativas). */
  items: TimelineItem[];
  onClose: () => void;
  onCreate: (input: NewTimelineItemInput) => Promise<void>;
}

export function NewActivityModal({ open, projectId, items, onClose, onCreate }: NewActivityModalProps) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState<TimelineItemType>('task');
  const [parentId, setParentId] = useState('');
  const [plannedStart, setPlannedStart] = useState('');
  const [plannedFinish, setPlannedFinish] = useState('');
  const [hours, setHours] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parentOptions = useMemo(
    () => [
      { value: '', label: 'Sem fase (raiz)' },
      ...items
        .filter((i) => i.isSummary && i.isActive && !i.deletedAt)
        .map((i) => ({ value: i.id, label: `${i.wbsCode ? `${i.wbsCode} · ` : ''}${i.title}` })),
    ],
    [items],
  );

  const reset = () => {
    setTitle(''); setType('task'); setParentId('');
    setPlannedStart(''); setPlannedFinish(''); setHours('');
    setError(null);
  };

  const close = () => {
    if (saving) return;
    reset();
    onClose();
  };

  const datesInvalid = Boolean(plannedStart && plannedFinish && plannedFinish < plannedStart);

  const submit = async () => {
    if (!title.trim()) {
      setError('Informe o nome da atividade.');
      return;
    }
    if (datesInvalid) {
      setError('O término não pode ser anterior ao início.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const parsedHours = hours.trim() ? Number(hours.replace(',', '.')) : null;
      await onCreate({
        projectId,
        title: title.trim(),
        type,
        parentId: parentId || null,
        plannedStart: plannedStart || null,
        plannedFinish: plannedFinish || null,
        // Sem duração informada o campo fica NULL — nunca 0, para que a coluna
        // de horas planejadas mostre "—" (ausente) em vez de zero apurado.
        durationMinutes: parsedHours != null && Number.isFinite(parsedHours) && parsedHours > 0
          ? Math.round(parsedHours * 60)
          : null,
        isMilestone: type === 'milestone',
      });
      reset();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao criar atividade.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <HudModal
      isOpen={open}
      onClose={close}
      title="Nova atividade"
      subtitle="Adiciona um item ao cronograma do projeto"
      size="md"
      footer={
        <div className="flex items-center justify-end gap-2">
          <HudButton variant="ghost" size="sm" onClick={close} disabled={saving}>Cancelar</HudButton>
          <HudButton variant="primary" size="sm" onClick={() => void submit()} isLoading={saving}>
            Criar atividade
          </HudButton>
        </div>
      }
    >
      <div className="space-y-3">
        <HudInput
          label="Nome da atividade"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Ex.: Montagem do painel elétrico"
          autoFocus
        />

        <div className="grid grid-cols-2 gap-3">
          <HudSelect label="Tipo" value={type} options={TYPE_OPTIONS} onChange={(v) => setType(v as TimelineItemType)} />
          <HudSelect label="Fase" value={parentId} options={parentOptions} onChange={setParentId} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <HudInput label="Início planejado" type="date" value={plannedStart} onChange={(e) => setPlannedStart(e.target.value)} />
          <HudInput label="Término planejado" type="date" value={plannedFinish} onChange={(e) => setPlannedFinish(e.target.value)} />
        </div>

        <HudInput
          label="Horas planejadas (opcional)"
          type="number"
          min={0}
          step="0.5"
          value={hours}
          onChange={(e) => setHours(e.target.value)}
          placeholder="Ex.: 16"
        />
        <p className="text-[11px] text-ig-fg-subtle">
          Sem horas planejadas, a atividade aparece com “—” na coluna Plan. — o indicador fica ausente
          em vez de ser exibido como zero.
        </p>

        {error && <p className="text-xs text-ig-danger">{error}</p>}
      </div>
    </HudModal>
  );
}
