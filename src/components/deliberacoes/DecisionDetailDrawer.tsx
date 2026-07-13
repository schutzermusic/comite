'use client';

import React from 'react';
import {
  FileText,
  Link2,
  CheckCircle,
  Circle,
  Clock,
  Gavel,
  Briefcase,
  AlertOctagon,
  Calendar,
  Download,
  Vote,
  ScrollText,
  MessageSquarePlus,
  Paperclip,
} from 'lucide-react';
import {
  HudDrawer,
  HudBadge,
  HudStatusPill,
  HudButton,
  HudProgressBar,
  type HudStatusPillVariant,
} from '@/components/hud';
import { cn } from '@/lib/utils';
import type {
  Deliberacao,
  DeliberacaoStatus,
  DeliberacaoPrioridade,
  AcaoExecucaoStatus,
  ParecerStatus,
  ItemRelacionadoTipo,
} from './types';
import { DecisionSlaBadge } from './DecisionSlaBadge';
import { DecisionRiskBadge } from './DecisionRiskBadge';
import { CommitteeBadge } from './CommitteeBadge';

type UiVoteChoice = 'favor' | 'contra' | 'abstencao';
type ExecStatus = 'pendente' | 'em_andamento' | 'concluida';

interface DecisionDetailDrawerProps {
  deliberacao: Deliberacao | null;
  isOpen: boolean;
  onClose: () => void;
  canVote?: boolean;
  canRequestOpinion?: boolean;
  canAttachEvidence?: boolean;
  canExecute?: boolean;
  canMinutes?: boolean;
  /** A mutation is in flight — disables action buttons. */
  busy?: boolean;
  /** Demo/mock mode — hides real operational actions. */
  readOnly?: boolean;
  onVote?: (choice: UiVoteChoice, justification?: string) => void;
  onRequestOpinion?: () => void;
  onAttachEvidence?: () => void;
  onGenerateMinutes?: () => void;
  onCreateTask?: () => void;
  onExecutionToggle?: (
    itemId: string,
    next: 'pending' | 'in_progress' | 'completed',
    title: string,
    ownerName: string,
    dueDate: string,
  ) => void;
  /** Exports the single-decision report (wired by the page). */
  onExport?: () => void;
}

// Execution status cycle: pendente → em_andamento → concluída → pendente.
const EXEC_NEXT: Record<ExecStatus, { next: 'pending' | 'in_progress' | 'completed'; label: string }> = {
  pendente: { next: 'in_progress', label: 'Iniciar' },
  em_andamento: { next: 'completed', label: 'Concluir' },
  concluida: { next: 'pending', label: 'Reabrir' },
};

const PRIORIDADE_LABEL: Record<DeliberacaoPrioridade, string> = {
  critica: 'Crítica',
  alta: 'Alta',
  media: 'Média',
  baixa: 'Baixa',
};

const PRIORIDADE_VARIANT: Record<DeliberacaoPrioridade, 'danger' | 'warning' | 'info' | 'subtle'> = {
  critica: 'danger',
  alta: 'warning',
  media: 'info',
  baixa: 'subtle',
};

const STATUS_PILL: Record<DeliberacaoStatus, { variant: HudStatusPillVariant; label: string }> = {
  rascunho: { variant: 'neutral', label: 'Rascunho' },
  em_revisao: { variant: 'warning', label: 'Em Revisão' },
  em_votacao: { variant: 'info', label: 'Em Votação' },
  aguardando_ata: { variant: 'pending', label: 'Aguardando Ata' },
  em_execucao: { variant: 'active', label: 'Em Execução' },
  concluida: { variant: 'completed', label: 'Concluída' },
};

const PARECER_STATUS_VARIANT: Record<ParecerStatus, HudStatusPillVariant> = {
  favoravel: 'active',
  contrario: 'error',
  com_ressalvas: 'warning',
};

const PARECER_STATUS_LABEL: Record<ParecerStatus, string> = {
  favoravel: 'Favorável',
  contrario: 'Contrário',
  com_ressalvas: 'Com ressalvas',
};

const ACAO_STATUS_ICON: Record<AcaoExecucaoStatus, React.ReactNode> = {
  pendente: <Circle className="w-3.5 h-3.5 text-ig-fg-muted" />,
  em_andamento: <Clock className="w-3.5 h-3.5 text-ig-warning" />,
  concluida: <CheckCircle className="w-3.5 h-3.5 text-ig-success" />,
};

const ACAO_STATUS_LABEL: Record<AcaoExecucaoStatus, string> = {
  pendente: 'Pendente',
  em_andamento: 'Em andamento',
  concluida: 'Concluída',
};

const ITEM_RELACIONADO_ICON: Record<ItemRelacionadoTipo, React.ReactNode> = {
  projeto: <Briefcase className="w-3.5 h-3.5" />,
  contrato: <FileText className="w-3.5 h-3.5" />,
  risco: <AlertOctagon className="w-3.5 h-3.5" />,
  reuniao: <Calendar className="w-3.5 h-3.5" />,
};

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

function DrawerSection({
  title,
  icon,
  children,
  action,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-ig-border-subtle bg-ig-panel/40">
      <header className="flex items-center justify-between px-4 py-2.5 border-b border-ig-border-subtle">
        <div className="flex items-center gap-2">
          {icon && <span className="text-ig-accent">{icon}</span>}
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ig-fg-strong">
            {title}
          </h3>
        </div>
        {action}
      </header>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

function DrawerKV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ig-fg-muted mb-1">
        {label}
      </p>
      <div className="text-sm text-ig-fg-strong">{value}</div>
    </div>
  );
}

export function DecisionDetailDrawer({
  deliberacao,
  isOpen,
  onClose,
  canVote = false,
  canRequestOpinion = false,
  canAttachEvidence = false,
  canExecute = false,
  canMinutes = false,
  busy = false,
  readOnly = false,
  onVote,
  onRequestOpinion,
  onAttachEvidence,
  onGenerateMinutes,
  onCreateTask,
  onExecutionToggle,
  onExport,
}: DecisionDetailDrawerProps) {
  const canOperate = !readOnly && !busy;
  const footer = deliberacao ? (
    <div className="flex flex-wrap items-center gap-2">
      {(deliberacao.status === 'em_revisao' || deliberacao.status === 'em_votacao') &&
        onRequestOpinion && (
          <HudButton
            variant="secondary"
            size="sm"
            leftIcon={<MessageSquarePlus className="w-3.5 h-3.5" />}
            disabled={!canOperate || !canRequestOpinion}
            title={canRequestOpinion ? 'Solicitar parecer' : 'Requer permissão deliberations.request_opinion'}
            onClick={onRequestOpinion}
          >
            Solicitar parecer
          </HudButton>
        )}
      {deliberacao.status !== 'concluida' && onAttachEvidence && (
        <HudButton
          variant="secondary"
          size="sm"
          leftIcon={<Paperclip className="w-3.5 h-3.5" />}
          disabled={!canOperate || !canAttachEvidence}
          title={canAttachEvidence ? 'Anexar evidência' : 'Requer permissão deliberations.attach_evidence'}
          onClick={onAttachEvidence}
        >
          Anexar evidência
        </HudButton>
      )}
      {deliberacao.status === 'aguardando_ata' && onGenerateMinutes && (
        <HudButton
          variant="primary"
          size="sm"
          leftIcon={<FileText className="w-3.5 h-3.5" />}
          disabled={!canOperate || !canMinutes}
          title={canMinutes ? 'Gerar e publicar ata' : 'Requer permissão deliberations.minutes'}
          onClick={onGenerateMinutes}
        >
          Gerar ata
        </HudButton>
      )}
      {deliberacao.status === 'em_execucao' && onCreateTask && (
        <HudButton
          variant="secondary"
          size="sm"
          leftIcon={<Briefcase className="w-3.5 h-3.5" />}
          disabled={!canOperate || !canExecute}
          title={canExecute ? 'Criar tarefa de execução' : 'Requer permissão deliberations.execute'}
          onClick={onCreateTask}
        >
          Criar tarefa
        </HudButton>
      )}
      {onExport && (
        <HudButton
          variant="ghost"
          size="sm"
          leftIcon={<Download className="w-3.5 h-3.5" />}
          onClick={onExport}
          className="ml-auto"
        >
          Exportar
        </HudButton>
      )}
    </div>
  ) : undefined;

  return (
    <HudDrawer
      isOpen={isOpen}
      onClose={onClose}
      title={deliberacao?.titulo}
      subtitle={deliberacao?.comite_nome}
      width="580px"
      footer={footer}
    >
      {!deliberacao ? (
        <div className="flex h-full items-center justify-center">
          <p className="text-sm text-ig-fg-muted">Selecione uma deliberação</p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Status strip */}
          <div className="flex flex-wrap items-center gap-2">
            <CommitteeBadge nome={deliberacao.comite_nome} cor={deliberacao.comite_cor} size="md" />
            <HudStatusPill variant={STATUS_PILL[deliberacao.status].variant} size="md">
              {STATUS_PILL[deliberacao.status].label}
            </HudStatusPill>
            <HudBadge variant={PRIORIDADE_VARIANT[deliberacao.prioridade]} size="md">
              {PRIORIDADE_LABEL[deliberacao.prioridade]}
            </HudBadge>
            <DecisionRiskBadge risco={deliberacao.risco} size="md" />
            <DecisionSlaBadge status={deliberacao.sla_status} size="md" />
            <HudBadge variant="neutral" size="md">
              Prazo: {formatDate(deliberacao.sla_deadline)}
            </HudBadge>
          </div>

          {/* Executive summary */}
          <DrawerSection title="Resumo Executivo" icon={<ScrollText className="w-3.5 h-3.5" />}>
            <p className="text-sm text-ig-fg leading-relaxed">{deliberacao.descricao}</p>
          </DrawerSection>

          {/* Context + decision requested */}
          <DrawerSection title="Contexto & Decisão Solicitada">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <DrawerKV
                label="Contexto"
                value={
                  <p className="text-sm text-ig-fg leading-relaxed font-normal">
                    {deliberacao.contexto}
                  </p>
                }
              />
              <DrawerKV
                label="Decisão Solicitada"
                value={
                  <p className="text-sm text-ig-fg leading-relaxed font-normal">
                    {deliberacao.decisao_solicitada}
                  </p>
                }
              />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-4 pt-3 border-t border-ig-border-subtle">
              <DrawerKV
                label="Responsável"
                value={<span className="text-sm">{deliberacao.responsavel_nome}</span>}
              />
              <DrawerKV
                label="Próxima Ação"
                value={<span className="text-sm">{deliberacao.proxima_acao}</span>}
              />
              <DrawerKV
                label="Criada em"
                value={<span className="text-sm tabular-nums">{formatDate(deliberacao.created_at)}</span>}
              />
              <DrawerKV
                label="Prazo (SLA)"
                value={<span className="text-sm tabular-nums">{formatDate(deliberacao.sla_deadline)}</span>}
              />
            </div>
          </DrawerSection>

          {/* Voting / Quorum */}
          <DrawerSection title="Votação & Quórum" icon={<Vote className="w-3.5 h-3.5" />}>
            <div className="space-y-3">
              <div>
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="text-ig-fg-muted">
                    Quórum {deliberacao.quorum_atual}/{deliberacao.quorum_necessario}
                  </span>
                  <span className="text-ig-fg-strong tabular-nums">
                    {deliberacao.quorum_necessario > 0
                      ? Math.round((deliberacao.quorum_atual / deliberacao.quorum_necessario) * 100)
                      : 0}
                    %
                  </span>
                </div>
                <HudProgressBar
                  value={deliberacao.quorum_atual}
                  max={Math.max(1, deliberacao.quorum_necessario)}
                  size="sm"
                  showLabel={false}
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-md border border-ig-border-subtle bg-ig-panel/60 px-3 py-2 text-center">
                  <p className="text-[10px] uppercase tracking-wider text-ig-fg-muted">A favor</p>
                  <p className="text-lg font-semibold text-ig-success tabular-nums">
                    {deliberacao.votos_favor}
                  </p>
                </div>
                <div className="rounded-md border border-ig-border-subtle bg-ig-panel/60 px-3 py-2 text-center">
                  <p className="text-[10px] uppercase tracking-wider text-ig-fg-muted">Contra</p>
                  <p className="text-lg font-semibold text-ig-danger tabular-nums">
                    {deliberacao.votos_contra}
                  </p>
                </div>
                <div className="rounded-md border border-ig-border-subtle bg-ig-panel/60 px-3 py-2 text-center">
                  <p className="text-[10px] uppercase tracking-wider text-ig-fg-muted">Abstenção</p>
                  <p className="text-lg font-semibold text-ig-fg-muted tabular-nums">
                    {deliberacao.votos_abstencao}
                  </p>
                </div>
              </div>

              {/* Cast vote — live action, gated by RBAC + voting stage */}
              {deliberacao.status === 'em_votacao' && onVote && (
                <div className="flex items-center gap-2 pt-1">
                  <HudButton
                    variant="primary"
                    size="sm"
                    disabled={!canVote || readOnly || busy}
                    title={canVote ? 'Votar a favor' : 'Requer permissão deliberations.vote'}
                    onClick={() => onVote('favor')}
                  >
                    A favor
                  </HudButton>
                  <HudButton
                    variant="secondary"
                    size="sm"
                    disabled={!canVote || readOnly || busy}
                    onClick={() => onVote('contra')}
                  >
                    Contra
                  </HudButton>
                  <HudButton
                    variant="ghost"
                    size="sm"
                    disabled={!canVote || readOnly || busy}
                    onClick={() => onVote('abstencao')}
                  >
                    Abster
                  </HudButton>
                </div>
              )}
            </div>
          </DrawerSection>

          {/* Pareceres */}
          {deliberacao.pareceres.length > 0 && (
            <DrawerSection title={`Pareceres (${deliberacao.pareceres.length})`}>
              <ul className="space-y-2.5">
                {deliberacao.pareceres.map((p) => (
                  <li
                    key={p.id}
                    className="rounded-md border border-ig-border-subtle bg-ig-panel/60 p-3"
                  >
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm font-medium text-ig-fg-strong truncate">
                          {p.autor_nome}
                        </span>
                        <HudBadge variant="outline" size="sm" className="capitalize">
                          {p.tipo}
                        </HudBadge>
                      </div>
                      <HudStatusPill variant={PARECER_STATUS_VARIANT[p.status]} size="sm">
                        {PARECER_STATUS_LABEL[p.status]}
                      </HudStatusPill>
                    </div>
                    <p className="text-xs text-ig-fg-muted leading-relaxed">{p.conteudo}</p>
                    <p className="text-[10px] text-ig-fg-subtle mt-1.5">
                      {formatDateTime(p.created_at)}
                    </p>
                  </li>
                ))}
              </ul>
            </DrawerSection>
          )}

          {/* Evidence */}
          {deliberacao.evidencias.length > 0 && (
            <DrawerSection
              title={`Evidências (${deliberacao.evidencias.length})`}
              icon={<FileText className="w-3.5 h-3.5" />}
            >
              <ul className="space-y-1.5">
                {deliberacao.evidencias.map((e) => (
                  <li
                    key={e.id}
                    className="flex items-center gap-2.5 rounded-md border border-ig-border-subtle bg-ig-panel/60 px-3 py-2"
                  >
                    <FileText className="w-3.5 h-3.5 text-ig-fg-muted shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-ig-fg-strong truncate">{e.nome}</p>
                      <p className="text-[10px] text-ig-fg-muted">
                        {e.uploaded_by} · {formatDate(e.created_at)}
                      </p>
                    </div>
                    <HudButton variant="ghost" size="sm" leftIcon={<Download className="w-3 h-3" />}>
                      Baixar
                    </HudButton>
                  </li>
                ))}
              </ul>
            </DrawerSection>
          )}

          {/* Linked items */}
          {deliberacao.itens_relacionados.length > 0 && (
            <DrawerSection title="Itens Relacionados" icon={<Link2 className="w-3.5 h-3.5" />}>
              <ul className="flex flex-wrap gap-2">
                {deliberacao.itens_relacionados.map((it) => (
                  <li key={it.id}>
                    <HudBadge variant="outline" size="md">
                      <span className="inline-flex items-center gap-1.5">
                        {ITEM_RELACIONADO_ICON[it.tipo]}
                        <span>{it.label}</span>
                      </span>
                    </HudBadge>
                  </li>
                ))}
              </ul>
            </DrawerSection>
          )}

          {/* Ata section */}
          {(deliberacao.status === 'aguardando_ata' || deliberacao.status === 'concluida') && (
            <DrawerSection
              title="Ata"
              icon={<Gavel className="w-3.5 h-3.5" />}
              action={
                deliberacao.status === 'aguardando_ata' ? (
                  <HudButton
                    variant="primary"
                    size="sm"
                    leftIcon={<FileText className="w-3.5 h-3.5" />}
                    disabled={!onGenerateMinutes || !canMinutes || readOnly || busy}
                    title={canMinutes ? 'Gerar e publicar ata' : 'Requer permissão deliberations.minutes'}
                    onClick={onGenerateMinutes}
                  >
                    Lavrar ata
                  </HudButton>
                ) : (
                  <HudButton
                    variant="secondary"
                    size="sm"
                    leftIcon={<Download className="w-3.5 h-3.5" />}
                    onClick={onExport}
                  >
                    Baixar ata
                  </HudButton>
                )
              }
            >
              <p className="text-xs text-ig-fg-muted">
                {deliberacao.status === 'aguardando_ata'
                  ? 'Votação concluída. Ata aguardando lavratura pelo secretário.'
                  : 'Ata publicada e disponível para download.'}
              </p>
            </DrawerSection>
          )}

          {/* Execution actions */}
          {deliberacao.acoes_execucao.length > 0 && (
            <DrawerSection title={`Execução (${deliberacao.acoes_execucao.length} ações)`}>
              <ul className="space-y-1.5">
                {deliberacao.acoes_execucao.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-start gap-2.5 rounded-md border border-ig-border-subtle bg-ig-panel/60 px-3 py-2"
                  >
                    <span className="mt-0.5">{ACAO_STATUS_ICON[a.status]}</span>
                    <div className="flex-1 min-w-0">
                      <p
                        className={cn(
                          'text-xs font-medium',
                          a.status === 'concluida'
                            ? 'text-ig-fg-muted line-through'
                            : 'text-ig-fg-strong',
                        )}
                      >
                        {a.titulo}
                      </p>
                      <p className="text-[10px] text-ig-fg-muted mt-0.5">
                        {a.responsavel_nome} · prazo {formatDate(a.prazo)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <HudBadge
                        variant={
                          a.status === 'concluida'
                            ? 'success'
                            : a.status === 'em_andamento'
                              ? 'warning'
                              : 'neutral'
                        }
                        size="sm"
                      >
                        {ACAO_STATUS_LABEL[a.status]}
                      </HudBadge>
                      {onExecutionToggle && canExecute && !readOnly && (
                        <HudButton
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            onExecutionToggle(
                              a.id,
                              EXEC_NEXT[a.status].next,
                              a.titulo,
                              a.responsavel_nome,
                              a.prazo,
                            )
                          }
                        >
                          {EXEC_NEXT[a.status].label}
                        </HudButton>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </DrawerSection>
          )}

          {/* Audit trail */}
          <DrawerSection
            title={`Trilha de Auditoria (${deliberacao.audit_trail.length})`}
            icon={<Clock className="w-3.5 h-3.5" />}
          >
            <ol className="relative border-l border-ig-border-subtle pl-4 space-y-3">
              {deliberacao.audit_trail
                .slice()
                .reverse()
                .map((ev) => (
                  <li key={ev.id} className="relative">
                    <span className="absolute -left-[1.32rem] top-1 h-2 w-2 rounded-full bg-ig-accent border border-ig-bg-canvas" />
                    <p className="text-[11px] text-ig-fg-subtle tabular-nums">
                      {formatDateTime(ev.timestamp)}
                    </p>
                    <p className="text-xs font-medium text-ig-fg-strong mt-0.5">{ev.acao}</p>
                    <p className="text-[11px] text-ig-fg-muted leading-snug">
                      {ev.descricao} · <span className="italic">{ev.usuario_nome}</span>
                    </p>
                  </li>
                ))}
            </ol>
          </DrawerSection>
        </div>
      )}
    </HudDrawer>
  );
}
