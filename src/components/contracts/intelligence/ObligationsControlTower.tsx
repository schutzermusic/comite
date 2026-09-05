'use client';

/**
 * Obligations Control Tower — as obrigações da carteira em cinco faixas.
 *
 * O painel é filtrável pelas faixas, no mesmo padrão single-select da Executive
 * Band: clicar numa faixa recorta a lista, clicar de novo desfaz. Nenhuma faixa
 * some quando está zerada — uma torre que esconde "em atraso: 0" obriga o
 * usuário a lembrar que a faixa existe.
 *
 * Cada linha carrega responsável, prazo, evidência e contrato. Uma obrigação
 * sem responsável diz "sem responsável"; sem evidência, diz o que falta. É a
 * ausência que o operador precisa ver — ela é o trabalho.
 */

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { pt } from 'date-fns/locale';
import { ClipboardCheck, AlertTriangle, UserX, FileWarning } from 'lucide-react';
import { HudPanel, HudEmptyState } from '@/components/hud';
import {
  OBLIGATION_BUCKET_LABEL, type ObligationBucket, type ObligationsTower,
} from '@/lib/contracts/trust/obligations-tower';

const BUCKET_TONE: Record<ObligationBucket, { text: string; rail: string; chip: string }> = {
  overdue: { text: 'text-ig-danger', rail: 'bg-ig-danger', chip: 'border-ig-danger/45 text-ig-danger' },
  dueSoon: { text: 'text-ig-warning', rail: 'bg-ig-warning', chip: 'border-ig-warning/45 text-ig-warning' },
  atRisk: { text: 'text-ig-warning', rail: 'bg-ig-warning/70', chip: 'border-ig-warning/35 text-ig-warning' },
  onTrack: { text: 'text-ig-success', rail: 'bg-ig-success', chip: 'border-ig-success/45 text-ig-success' },
  completed: { text: 'text-ig-fg-muted', rail: 'bg-ig-border-strong', chip: 'border-ig-border-strong text-ig-fg-muted' },
};

const ORDER: ObligationBucket[] = ['overdue', 'dueSoon', 'atRisk', 'onTrack', 'completed'];

/** O que cada faixa significa — a definição fica visível, não no código. */
const BUCKET_HINT: Record<ObligationBucket, string> = {
  overdue: 'Prazo vencido sem conclusão registrada.',
  dueSoon: 'Vence nos próximos 15 dias.',
  atRisk: 'Prazo folgado, mas sem a evidência que o aceite vai exigir.',
  onTrack: 'Prazo folgado e evidência registrada.',
  completed: 'Concluídas, dentro ou fora do prazo.',
};

export interface ObligationsControlTowerProps {
  tower: ObligationsTower;
  canEdit?: boolean;
  busyId?: string | null;
  onComplete?: (entry: { id: string; title: string; contract_id: string; owner_user_id: string | null; due_date: string | null }) => void;
  onCreateTask?: (contractId: string, title: string, dueAt: string, ownerUserId: string | null, key: string) => void;
  className?: string;
}

export function ObligationsControlTower({
  tower, canEdit = false, busyId = null, onComplete, onCreateTask, className,
}: ObligationsControlTowerProps) {
  const [selected, setSelected] = useState<ObligationBucket | null>(null);
  const shown = selected ? tower.entries.filter((e) => e.bucket === selected) : tower.entries;

  return (
    <div className={cn('space-y-4', className)}>
      {/* Faixas — todas visíveis, inclusive as zeradas. */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        {ORDER.map((bucket) => {
          const active = selected === bucket;
          const tone = BUCKET_TONE[bucket];
          return (
            <button
              key={bucket}
              type="button"
              aria-pressed={active}
              title={BUCKET_HINT[bucket]}
              onClick={() => setSelected(active ? null : bucket)}
              className={cn(
                'relative overflow-hidden rounded-[14px] border px-3 py-2.5 text-left transition-all',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--ig-accent)_45%,transparent)]',
                active
                  ? 'border-ig-accent/55 bg-[color-mix(in_oklab,var(--ig-accent)_9%,transparent)]'
                  : 'border-ig-border-subtle bg-ig-panel/45 hover:border-ig-border-focus',
              )}
            >
              <span className={cn('absolute inset-y-0 left-0 w-[2px]', tone.rail)} aria-hidden />
              <span className="block truncate text-ig-label font-semibold text-ig-fg-muted">
                {OBLIGATION_BUCKET_LABEL[bucket]}
              </span>
              <span className={cn('mt-0.5 block text-ig-kpi-md leading-none ig-tabular', tone.text)}>
                {tower.counts[bucket]}
              </span>
            </button>
          );
        })}
      </div>

      {/* Lacunas de cobertura antes da lista: elas explicam a lista curta. */}
      <CoverageNotes tower={tower} />

      <HudPanel
        title="Obrigações contratuais"
        subtitle={selected
          ? `${OBLIGATION_BUCKET_LABEL[selected]} · ${BUCKET_HINT[selected]}`
          : 'Responsável, prazo e evidência de cada obrigação registrada'}
        icon={<ClipboardCheck className="h-4 w-4" />}
        interactive={false}
      >
        {shown.length === 0 ? (
          <HudEmptyState
            title={selected ? `Nenhuma obrigação em "${OBLIGATION_BUCKET_LABEL[selected]}"` : 'Nenhuma obrigação registrada'}
            description={selected
              ? 'As demais faixas seguem com itens — remova o recorte para vê-las.'
              : 'Sem obrigação registrada não há o que acompanhar; a ausência de atraso aqui não significa cumprimento.'}
          />
        ) : (
          <div className="divide-y divide-ig-border-subtle border-y border-ig-border-subtle">
            {shown.slice(0, 60).map((entry) => {
              const tone = BUCKET_TONE[entry.bucket];
              return (
                /*
                  Linha, não cartão. Numa lista de dezenas de itens, a moldura
                  por item multiplica a contagem de contêineres visíveis pelo
                  número de linhas e desalinha as colunas entre si: comparar o
                  prazo de oito obrigações exigia ler oito caixas. O trilho
                  tonal à esquerda continua marcando a severidade; o separador
                  inferior faz o resto.
                */
                <div
                  key={entry.id}
                  className="relative grid gap-3 py-2.5 pl-3 pr-1 md:grid-cols-[1fr_140px_150px_auto] md:items-center"
                >
                  <span className={cn('absolute inset-y-0 left-0 w-[2px]', tone.rail)} aria-hidden />

                  <div className="min-w-0 pl-1.5">
                    <p className="truncate text-ig-body-sm font-semibold text-ig-fg-strong">{entry.title}</p>
                    <p className="truncate text-ig-caption text-ig-fg-muted">
                      {entry.contractCode}
                      {entry.counterparty ? ` · ${entry.counterparty}` : ''}
                    </p>
                  </div>

                  {/* Prazo */}
                  <div className="min-w-0">
                    <p className={cn('truncate text-ig-body-sm font-semibold', tone.text)}>
                      {entry.dueDate ? format(entry.dueDate, 'dd/MM/yyyy', { locale: pt }) : 'Sem prazo'}
                    </p>
                    {entry.daysToDue !== null && entry.bucket !== 'completed' && (
                      <p className="truncate text-ig-caption text-ig-fg-muted">
                        {entry.daysToDue < 0
                          ? `${Math.abs(entry.daysToDue)} dia(s) em atraso`
                          : `em ${entry.daysToDue} dia(s)`}
                      </p>
                    )}
                  </div>

                  {/* Responsável e evidência — as duas ausências que importam. */}
                  <div className="min-w-0 space-y-0.5">
                    {entry.ownerUserId ? (
                      <p className="truncate text-ig-caption text-ig-fg-muted">Responsável designado</p>
                    ) : (
                      <p className="flex items-center gap-1 truncate text-ig-caption text-ig-warning">
                        <UserX className="h-3 w-3 shrink-0" aria-hidden /> Sem responsável
                      </p>
                    )}
                    {entry.hasEvidence ? (
                      <p className="truncate text-ig-caption text-ig-fg-subtle" title={entry.evidence ?? undefined}>
                        {entry.evidence}
                      </p>
                    ) : (
                      <p className="flex items-center gap-1 truncate text-ig-caption text-ig-fg-subtle">
                        <FileWarning className="h-3 w-3 shrink-0" aria-hidden /> Sem evidência
                      </p>
                    )}
                  </div>

                  <div className="flex items-center justify-end gap-1.5">
                    {canEdit && entry.bucket !== 'completed' && onComplete && (
                      <button
                        type="button"
                        title="Concluir obrigação"
                        disabled={busyId === `tower-done-${entry.id}`}
                        onClick={() => onComplete({
                          id: entry.id, title: entry.title, contract_id: entry.contractId,
                          owner_user_id: entry.ownerUserId,
                          due_date: entry.dueDate ? entry.dueDate.toISOString() : null,
                        })}
                        className="inline-flex h-9 items-center gap-1 rounded-md border border-ig-border-subtle px-2 text-ig-label font-semibold text-ig-fg-muted transition-colors sm:h-7 hover:border-ig-border-focus hover:text-ig-success disabled:opacity-50"
                      >
                        Concluir
                      </button>
                    )}
                    {canEdit && entry.bucket !== 'completed' && onCreateTask && (
                      <button
                        type="button"
                        title="Criar tarefa na agenda"
                        disabled={busyId === `tower-task-${entry.id}`}
                        onClick={() => onCreateTask(
                          entry.contractId,
                          entry.title,
                          (entry.dueDate ?? new Date()).toISOString(),
                          entry.ownerUserId,
                          `tower-task-${entry.id}`,
                        )}
                        className="inline-flex h-9 items-center gap-1 rounded-md border border-ig-border-subtle px-2 text-ig-label font-semibold text-ig-fg-muted transition-colors sm:h-7 hover:border-ig-border-focus hover:text-ig-fg-strong disabled:opacity-50"
                      >
                        Tarefa
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </HudPanel>
    </div>
  );
}

/**
 * O que NÃO entrou na torre.
 *
 * Sem isto, um contrato cuja leitura falhou e um contrato sem obrigação
 * nenhuma produzem exatamente a mesma tela: uma lista mais curta, sem
 * explicação.
 */
function CoverageNotes({ tower }: { tower: ObligationsTower }) {
  const hasErrors = tower.erroredContracts.length > 0;
  const hasUnmapped = tower.unmappedContracts.length > 0;
  if (!hasErrors && !hasUnmapped) return null;

  return (
    <div className="space-y-1.5">
      {hasErrors && (
        <p className="flex items-start gap-2 rounded-[12px] border border-ig-danger/30 bg-ig-danger/5 px-3 py-2 text-ig-caption text-ig-danger">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            Não foi possível ler as obrigações de {tower.erroredContracts.length} contrato(s):{' '}
            {tower.erroredContracts.join(', ')}. A torre está incompleta.
          </span>
        </p>
      )}
      {hasUnmapped && (
        <p className="rounded-[12px] border border-ig-border-subtle px-3 py-2 text-ig-caption text-ig-fg-muted">
          <span className="font-semibold text-ig-fg-strong">{tower.unmappedContracts.length} contrato(s)</span>{' '}
          sem nenhuma obrigação mapeada ({tower.unmappedContracts.join(', ')}) — lacuna de controle, não conformidade.
        </p>
      )}
    </div>
  );
}
