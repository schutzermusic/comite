'use client';

/**
 * O QUADRO DE MARCOS — o centro de gravidade da aba.
 *
 * ─── Por que agrupar por BLOQUEIO, e não por status ────────────────────────
 *
 * Agrupar por status produz os nomes do banco na tela ("pending", "measured") e
 * não responde à única pergunta que alguém faz aqui: o que me impede de
 * faturar? Os grupos são etapas do funil de desbloqueio, e por isso os VAZIOS
 * também aparecem — ver quatro baldes vazios e um cheio É o diagnóstico.
 *
 * ─── O que o quadro não faz ────────────────────────────────────────────────
 *
 * Não edita medição (é de Projetos), não libera faturamento (é ato governado) e
 * não cria evento nenhum sozinho. `onAction` devolve a intenção ao dossiê, que
 * decide — o quadro nunca chama serviço de escrita.
 */

import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { ChevronDown, LayoutGrid, Rows3, Ruler, Plus } from 'lucide-react';
import { HudButton } from '@/components/hud';
import { formatContractCurrency } from '@/lib/contracts/trust/format';
import {
  assessMilestone, groupMilestones, deriveAction, deriveChain,
  OVERLAY_LABEL, OVERLAY_TONE,
  type MilestoneAssessment, type MilestoneGroup,
} from '@/lib/contracts/measurement/milestone-stage';
import type { MilestoneWorkbenchRow } from '@/lib/contracts/measurement/milestone-workbench-types';
import { MilestoneCard } from './MilestoneCard';
import { SignalChip } from './SignalChip';
import { ChainRail } from './ChainRail';
import { GuidedEmpty } from '../shell/GuidedEmpty';

export type MilestoneViewMode = 'board' | 'compact';

/** Chave de persistência da preferência de visualização, por usuário/navegador. */
const VIEW_KEY = 'ig.contracts.milestones.view';

function readStoredView(): MilestoneViewMode {
  if (typeof window === 'undefined') return 'board';
  try {
    return window.localStorage.getItem(VIEW_KEY) === 'compact' ? 'compact' : 'board';
  } catch {
    // Navegador com armazenamento bloqueado continua tendo quadro.
    return 'board';
  }
}

export interface MilestoneBoardProps {
  readonly rows: readonly MilestoneWorkbenchRow[];
  readonly contractTotal: number | null;
  readonly projectId: string | null;
  readonly error?: string | null;
  readonly loading?: boolean;
  readonly canEdit?: boolean;
  readonly busyId?: string | null;
  readonly asOf?: Date;
  readonly onCreate?: () => void;
  readonly onSelect?: (id: string) => void;
  readonly onAction?: (assessment: MilestoneAssessment) => void;
  readonly onEdit?: (assessment: MilestoneAssessment) => void;
  readonly className?: string;
}

export function MilestoneBoard({
  rows, contractTotal, projectId, error = null, loading = false,
  canEdit = false, busyId = null, asOf,
  onCreate, onSelect, onAction, onEdit, className,
}: MilestoneBoardProps) {
  const [view, setView] = useState<MilestoneViewMode>(readStoredView);
  const [collapsed, setCollapsed] = useState<ReadonlySet<MilestoneGroup>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const buckets = useMemo(
    () => groupMilestones(rows.map((row) => assessMilestone(row, asOf ?? new Date()))),
    [rows, asOf],
  );

  const setViewMode = (next: MilestoneViewMode) => {
    setView(next);
    try { window.localStorage.setItem(VIEW_KEY, next); } catch { /* sem persistência, tudo bem */ }
  };

  const toggle = (group: MilestoneGroup) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(group)) next.delete(group); else next.add(group);
    return next;
  });

  const select = (id: string) => {
    setSelectedId(id);
    onSelect?.(id);
  };

  const total = rows.length;

  return (
    <section className={cn('dossier-surface dossier-board', className)}>
      <header className="dossier-section-head">
        <div>
          <h3>
            <Ruler className="mr-1.5 inline h-4 w-4 align-[-2px] text-ig-fg-muted" aria-hidden />
            Marcos contratuais
          </h3>
          <p>
            {error
              ? 'Falha ao ler os marcos'
              : loading
                ? 'Carregando…'
                : total === 0
                  ? 'Nenhum marco registrado'
                  : `${total} evento(s) contratuais · o contrato define O QUE; o projeto define QUANDO`}
          </p>
        </div>

        <div className="dossier-board-tools">
          <div className="dossier-viewtoggle" role="group" aria-label="Modo de visualização">
            <button
              type="button" data-active={view === 'board' || undefined}
              aria-pressed={view === 'board'} onClick={() => setViewMode('board')}
            >
              <LayoutGrid className="h-3.5 w-3.5" aria-hidden /> Quadro
            </button>
            <button
              type="button" data-active={view === 'compact' || undefined}
              aria-pressed={view === 'compact'} onClick={() => setViewMode('compact')}
            >
              <Rows3 className="h-3.5 w-3.5" aria-hidden /> Compacto
            </button>
          </div>
          {canEdit && onCreate && (
            <HudButton variant="secondary" size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={onCreate}>
              Novo marco
            </HudButton>
          )}
        </div>
      </header>

      <div className="dossier-section-body">
        {error ? (
          <p className="rounded-lg border border-ig-danger/30 bg-ig-danger/5 px-3 py-2 text-ig-caption text-ig-danger">
            {error} A ausência de itens aqui não significa que não existam.
          </p>
        ) : total === 0 ? (
          <GuidedEmpty
            title="Nenhum marco contratual registrado"
            cause="Este contrato ainda não teve seus eventos de medição e faturamento extraídos do instrumento assinado."
            consequence='Sem marco, a etapa "Medido" da cadeia até o caixa não pode ser apurada e o faturamento fica sem lastro contratual.'
            chain={['Contratual ✗', 'Execução —', 'Aceite —', 'Faturamento —']}
            primary={canEdit && onCreate ? { label: 'Registrar marco', onClick: onCreate } : undefined}
          />
        ) : (
          <div className="dossier-board-groups">
            {buckets.map((bucket) => {
              const isCollapsed = collapsed.has(bucket.group) || bucket.items.length === 0;
              return (
                <section key={bucket.group} className="dossier-board-group" data-empty={bucket.items.length === 0 || undefined}>
                  <button
                    type="button"
                    className="dossier-board-group-head"
                    aria-expanded={!isCollapsed}
                    disabled={bucket.items.length === 0}
                    onClick={() => toggle(bucket.group)}
                  >
                    <ChevronDown
                      className={cn('h-3.5 w-3.5 shrink-0 transition-transform', isCollapsed && '-rotate-90')}
                      aria-hidden
                    />
                    <span className="dossier-board-group-label">{bucket.label}</span>
                    <span className="dossier-board-group-count ig-tabular">
                      {bucket.items.length === 0 ? 'nenhum' : `${bucket.items.length} marco(s)`}
                    </span>
                    {/* Soma do DIREITO do grupo. `null` quando nenhum item tem
                        direito registrado — nunca substituída pelo previsto. */}
                    {bucket.entitlementTotal !== null && (
                      <span className="dossier-board-group-total ig-tabular">
                        {formatContractCurrency(bucket.entitlementTotal)}
                      </span>
                    )}
                  </button>

                  {!isCollapsed && (
                    view === 'board' ? (
                      <div className="dossier-board-cards">
                        {bucket.items.map((assessment) => (
                          <MilestoneCard
                            key={assessment.row.id}
                            assessment={assessment}
                            contractTotal={contractTotal}
                            selected={selectedId === assessment.row.id}
                            canEdit={canEdit}
                            busy={busyId === assessment.row.id}
                            onSelect={select}
                            onAction={onAction}
                            onEdit={onEdit}
                          />
                        ))}
                      </div>
                    ) : (
                      <CompactRows
                        items={bucket.items}
                        contractTotal={contractTotal}
                        selectedId={selectedId}
                        onSelect={select}
                        onAction={onAction}
                      />
                    )
                  )}
                </section>
              );
            })}
          </div>
        )}

        {/*
          A fronteira, dita uma vez ao pé do quadro em vez de repetida em cada
          card: Contratos mostra a regra; a instância operacional mora em
          Projetos, e é de lá que o estado destes marcos muda.
        */}
        {projectId && total > 0 && (
          <p className="dossier-board-boundary">
            O estado destes marcos muda em <strong>Projetos</strong>, quando o cronograma é mapeado e a
            medição é aceita. Contratos registra a regra e a consequência — não edita medição.
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * A VISÃO COMPACTA — a mesma verdade, para quem concilia 40 marcos.
 *
 * Tabela real, 1 linha por marco, navegável por teclado. O trilho da cadeia
 * continua presente em versão reduzida: tirá-lo faria a visão compacta perder
 * exatamente a informação que distingue esta tela de uma planilha.
 */
function CompactRows({
  items, contractTotal, selectedId, onSelect, onAction,
}: {
  items: readonly MilestoneAssessment[];
  contractTotal: number | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAction?: (a: MilestoneAssessment) => void;
}) {
  return (
    <table className="dossier-compact-table">
      <caption className="sr-only">Marcos contratuais em visão compacta</caption>
      <thead>
        <tr>
          <th scope="col">Evento</th>
          <th scope="col" className="text-right">Direito</th>
          <th scope="col" className="text-right">%</th>
          <th scope="col">Estágio</th>
          <th scope="col">Cadeia</th>
          <th scope="col"><span className="sr-only">Ação</span></th>
        </tr>
      </thead>
      <tbody>
        {items.map((assessment) => {
          const { row, stage, overlays } = assessment;
          const action = deriveAction(assessment);
          const percent = row.entitlementAmount !== null && contractTotal !== null && contractTotal > 0
            ? (row.entitlementAmount / contractTotal) * 100
            : null;
          return (
            <tr
              key={row.id}
              data-selected={selectedId === row.id || undefined}
              data-overdue={overlays.includes('OVERDUE') || undefined}
              onClick={() => onSelect(row.id)}
            >
              <th scope="row">
                <span className="dossier-compact-title">{row.title}</span>
                {overlays.length > 0 && (
                  <span className="dossier-compact-overlays">
                    {overlays.map((o) => (
                      <SignalChip key={o} tone={OVERLAY_TONE[o]}>{OVERLAY_LABEL[o]}</SignalChip>
                    ))}
                  </span>
                )}
              </th>
              <td className="ig-tabular text-right">
                {row.entitlementAmount !== null
                  ? formatContractCurrency(row.entitlementAmount)
                  : <span className="text-ig-fg-subtle">sem registro</span>}
              </td>
              <td className="ig-tabular text-right">
                {percent !== null ? `${percent.toFixed(percent % 1 === 0 ? 0 : 2)}%` : '—'}
              </td>
              <td>
                <SignalChip tone={stage.tone} dashed={stage.dashed}>{stage.label}</SignalChip>
              </td>
              <td><ChainRail links={deriveChain(row)} compact /></td>
              <td className="text-right">
                {action.kind !== 'none' && onAction && (
                  <button
                    type="button"
                    className={cn('dossier-milestone-action', action.primary && 'is-primary')}
                    onClick={(event) => { event.stopPropagation(); onAction(assessment); }}
                  >
                    {action.label}
                  </button>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
