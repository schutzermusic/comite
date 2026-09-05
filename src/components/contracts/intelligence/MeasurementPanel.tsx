'use client';

/**
 * Marcos de medição — a superfície do domínio instrumentado em P2B.
 *
 * O painel responde três perguntas na ordem em que a operação as faz: o que
 * está previsto, o que já foi medido, e o que falta para o medido virar
 * faturamento.
 *
 * Duas ausências são desenhadas em vez de escondidas, porque são o trabalho:
 * marco sem responsável e marco sem evidência. O aceite vai cobrar as duas.
 */

import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { pt } from 'date-fns/locale';
import { Ruler, UserX, FileWarning, Plus, Pencil, Receipt, FileCheck2 } from 'lucide-react';
import { HudPanel, HudButton } from '@/components/hud';
import {
  MILESTONE_STATUS_LABEL, MEASURED_STATUSES,
  type ContractMilestoneRow, type ContractMilestoneStatus,
} from '@/lib/contracts/contract-service';
import { hasOfficialValue, isError, type Official } from '@/lib/contracts/trust/trusted';
import { InlineEmpty } from '../shell';

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL', maximumFractionDigits: 0,
});

const STATUS_TONE: Record<ContractMilestoneStatus, { text: string; rail: string }> = {
  pending: { text: 'text-ig-fg-muted', rail: 'bg-ig-border-strong' },
  in_progress: { text: 'text-ig-warning', rail: 'bg-ig-warning' },
  measured: { text: 'text-ig-accent', rail: 'bg-ig-accent' },
  approved: { text: 'text-ig-success', rail: 'bg-ig-success' },
  cancelled: { text: 'text-ig-fg-subtle', rail: 'bg-ig-border-subtle' },
};

const num = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
};

export interface MeasurementPanelProps {
  milestones: Official<readonly ContractMilestoneRow[]>;
  /** Ids de marcos que já geraram evento de faturamento. */
  billedMilestoneIds?: ReadonlySet<string>;
  canEdit?: boolean;
  onCreate?: () => void;
  onEdit?: (milestone: ContractMilestoneRow) => void;
  onGenerateBilling?: (milestone: ContractMilestoneRow) => void;
  busyId?: string | null;
  className?: string;
}

export function MeasurementPanel({
  milestones, billedMilestoneIds, canEdit = false,
  onCreate, onEdit, onGenerateBilling, busyId = null, className,
}: MeasurementPanelProps) {
  const rows = hasOfficialValue(milestones) ? milestones.value : [];
  const measured = rows.filter((m) => MEASURED_STATUSES.includes(m.status));
  const measuredTotal = measured.reduce(
    (sum, m) => sum + (num(m.measured_amount) ?? num(m.billing_amount) ?? 0), 0);
  const plannedTotal = rows.reduce((sum, m) => sum + (num(m.billing_amount) ?? 0), 0);

  return (
    <HudPanel
      title="Marcos de medição"
      subtitle={isError(milestones)
        ? 'Falha ao ler os marcos'
        : rows.length === 0
          ? 'Nenhum marco registrado'
          : `${measured.length} de ${rows.length} marco(s) medido(s) · ${BRL.format(measuredTotal)} de ${BRL.format(plannedTotal)}`}
      icon={<Ruler className="h-4 w-4" />}
      interactive={false}
      headerActions={canEdit && onCreate ? (
        <HudButton variant="secondary" size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={onCreate}>
          Novo marco
        </HudButton>
      ) : undefined}
      className={className}
    >
      {isError(milestones) ? (
        <p className="rounded-lg border border-ig-danger/30 bg-ig-danger/5 px-3 py-2 text-ig-caption text-ig-danger">
          Não foi possível ler os marcos deste contrato. A ausência de itens aqui não significa que não existam.
        </p>
      ) : rows.length === 0 ? (
        /*
          O vazio ocupava ~90px centralizados para ensinar o modelo de dados.
          A consequência continua dita — em `help`, disponível ao mouse e ao
          leitor de tela — mas não é mais o elemento mais alto do painel numa
          carteira recém-cadastrada.
        */
        <InlineEmpty
          message="Nenhum marco de medição registrado."
          help={'Sem marco, a etapa "Medido" da cadeia até o caixa não pode ser apurada, e o faturamento fica sem lastro de medição.'}
          action={canEdit && onCreate ? { label: '+ Novo marco', onClick: onCreate } : undefined}
        />
      ) : (
        <div className="space-y-2">
          {rows.map((milestone) => {
            const tone = STATUS_TONE[milestone.status];
            const isMeasured = MEASURED_STATUSES.includes(milestone.status);
            const value = num(milestone.measured_amount) ?? num(milestone.billing_amount);
            const alreadyBilled = billedMilestoneIds?.has(milestone.id) ?? false;

            return (
              <div
                key={milestone.id}
                className="relative grid gap-3 overflow-hidden rounded-lg border border-ig-border-subtle bg-ig-panel/45 p-3 md:grid-cols-[1fr_130px_140px_auto] md:items-center"
              >
                <span className={cn('absolute inset-y-0 left-0 w-[2px]', tone.rail)} aria-hidden />

                <div className="min-w-0 pl-1.5">
                  <p className="truncate text-ig-body-sm font-semibold text-ig-fg-strong">{milestone.title}</p>
                  <p className={cn('truncate text-ig-caption', tone.text)}>
                    {MILESTONE_STATUS_LABEL[milestone.status]}
                    {milestone.milestone_type ? ` · ${milestone.milestone_type}` : ''}
                  </p>
                </div>

                <div className="min-w-0">
                  <p className="truncate text-ig-caption text-ig-fg-muted">
                    {milestone.due_date
                      ? format(new Date(`${milestone.due_date}T00:00:00`), 'dd/MM/yyyy', { locale: pt })
                      : 'Sem prazo'}
                  </p>
                  {milestone.completed_at && (
                    <p className="truncate text-ig-label text-ig-fg-subtle">
                      medido em {format(new Date(milestone.completed_at), 'dd/MM/yyyy', { locale: pt })}
                    </p>
                  )}
                </div>

                <div className="min-w-0">
                  {/* Valor não apurado nunca vira R$ 0. */}
                  <p className="truncate text-ig-body-sm font-semibold ig-tabular text-ig-fg-strong">
                    {value === null ? 'Valor não informado' : BRL.format(value)}
                  </p>
                  <div className="space-y-0.5">
                    {!milestone.owner_user_id && (
                      <p className="flex items-center gap-1 truncate text-ig-label text-ig-warning">
                        <UserX className="h-3 w-3 shrink-0" aria-hidden /> Sem responsável
                      </p>
                    )}
                    {milestone.evidence_document_id ? (
                      <p className="flex items-center gap-1 truncate text-ig-label text-ig-success">
                        <FileCheck2 className="h-3 w-3 shrink-0" aria-hidden /> Evidência anexada
                      </p>
                    ) : !milestone.evidence ? (
                      <p className="flex items-center gap-1 truncate text-ig-label text-ig-fg-subtle">
                        <FileWarning className="h-3 w-3 shrink-0" aria-hidden /> Sem evidência
                      </p>
                    ) : (
                      <p className="truncate text-ig-label text-ig-fg-subtle" title={milestone.evidence}>
                        {milestone.evidence}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-end gap-1.5">
                  {canEdit && onEdit && (
                    <button
                      type="button"
                      title="Editar marco"
                      onClick={() => onEdit(milestone)}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-ig-border-subtle text-ig-fg-muted transition-colors sm:h-7 sm:w-7 hover:border-ig-border-focus hover:text-ig-fg-strong"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {canEdit && onGenerateBilling && isMeasured && !alreadyBilled && (
                    <button
                      type="button"
                      title="Gerar evento de faturamento a partir deste marco"
                      disabled={busyId === `ms-bill-${milestone.id}`}
                      onClick={() => onGenerateBilling(milestone)}
                      className="inline-flex h-9 items-center gap-1 rounded-md border border-ig-border-subtle px-2 text-ig-label font-semibold text-ig-fg-muted transition-colors sm:h-7 hover:border-ig-border-focus hover:text-ig-success disabled:opacity-50"
                    >
                      <Receipt className="h-3.5 w-3.5" /> Faturar
                    </button>
                  )}
                  {alreadyBilled && (
                    <span className="text-ig-label font-semibold text-ig-success">Faturamento gerado</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </HudPanel>
  );
}
