'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { DeliberationItem, VoteOption } from '@/lib/types';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { HudPanel, HudBadge, HudButton } from '@/components/hud';
import { AuditTrailTimeline } from './AuditTrailTimeline';
import { VotingConsole } from './VotingConsole';
import { EvidencePack } from './EvidencePack';
import {
    AlertTriangle,
    Archive,
    Building2,
    CheckCircle,
    Clock,
    DollarSign,
    FileText,
    Gavel,
    Link2,
    PlayCircle,
    Search,
    ShieldCheck,
    ThumbsUp,
    Vote,
    Workflow,
    XCircle,
} from 'lucide-react';
import { differenceInHours } from 'date-fns';

interface DecisionInspectorProps {
  item: DeliberationItem | null;
  currentUserId: string;
  currentUserName: string;
  onStartVoting: (itemId: string) => void;
  onCastVote: (itemId: string, vote: VoteOption, justification?: string, hasConflict?: boolean) => void;
  onCloseVoting: (itemId: string) => void;
  onGenerateMinutes: (itemId: string) => void;
  onPublishMinutes: (itemId: string) => void;
  onCreateExecutionTask: (itemId: string) => void;
  onApprove?: (itemId: string, justification?: string) => void;
  onReject?: (itemId: string, justification?: string) => void;
  onClose?: (itemId: string, justification?: string) => void;
  canVote?: boolean;
  canApprove?: boolean;
  canReject?: boolean;
  canClose?: boolean;
}

const STATUS_MAP: Record<string, string> = {
  draft: 'Rascunho',
  submitted: 'Submetida',
  in_review: 'Em Revisão',
  in_voting: 'Em Votação',
  awaiting_minutes: 'Aguardando Ata',
  resolved: 'Resolvida',
  in_execution: 'Em Execução',
  closed: 'Encerrada',
  returned_for_revision: 'Devolvida para Revisão',
  withdrawn: 'Retirada',
};

const STATUS_BADGE_VARIANT: Record<string, 'neutral' | 'info' | 'warning' | 'success' | 'danger' | 'default' | 'primary' | 'outline' | 'subtle'> = {
  draft: 'neutral',
  submitted: 'info',
  in_review: 'warning',
  in_voting: 'info',
  awaiting_minutes: 'warning',
  resolved: 'success',
  in_execution: 'warning',
  closed: 'neutral',
  returned_for_revision: 'danger',
  withdrawn: 'neutral',
};

const STAGE_TYPE_LABELS: Record<string, string> = {
  owner_review: 'Revisão do Responsável',
  dependent_review: 'Revisão Dependente',
  final_approval: 'Aprovação Final',
  publish_minutes: 'Publicação de Ata',
  execution: 'Execução',
};

const RISK_BADGE_VARIANT: Record<string, 'danger' | 'warning' | 'success'> = {
  critical: 'danger',
  high: 'danger',
  medium: 'warning',
  low: 'success',
};

const TASK_STATUS_LABELS: Record<string, string> = {
  pending: 'Pendente',
  in_progress: 'Em andamento',
  completed: 'Concluída',
};

/** Returns the context-aware primary CTA for the inspector */
function getPrimaryAction(item: DeliberationItem): {
  label: string;
  variant: 'primary' | 'secondary' | 'ghost' | 'danger' | 'glass';
  icon: React.ReactNode;
  disabled: boolean;
} {
  switch (item.deliberationStatus) {
    case 'in_review':
      return { label: 'Revisar decisão', variant: 'primary', icon: <Search className="w-4 h-4" />, disabled: false };
    case 'in_voting':
      return { label: 'Ir para Votação', variant: 'primary', icon: <Vote className="w-4 h-4" />, disabled: false };
    case 'awaiting_minutes':
      return { label: 'Gerar Ata', variant: 'primary', icon: <FileText className="w-4 h-4" />, disabled: false };
    case 'in_execution':
      return { label: 'Registrar Execução', variant: 'primary', icon: <PlayCircle className="w-4 h-4" />, disabled: false };
    case 'resolved':
    case 'closed':
      return { label: 'Concluída', variant: 'secondary', icon: <CheckCircle className="w-4 h-4" />, disabled: true };
    default:
      return { label: 'Aguardando', variant: 'ghost', icon: <Clock className="w-4 h-4" />, disabled: true };
  }
}

export function DecisionInspector({
  item,
  currentUserId,
  onStartVoting,
  onCastVote,
  onCloseVoting,
  onGenerateMinutes,
  onPublishMinutes,
  onCreateExecutionTask,
  onApprove,
  onReject,
  onClose,
  canVote = false,
  canApprove = false,
  canReject = false,
  canClose = false,
}: DecisionInspectorProps) {
  if (!item) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 py-12">
        <div className="w-14 h-14 rounded-2xl bg-ig-panel-hover flex items-center justify-center">
          <Gavel className="w-7 h-7 text-ig-fg-subtle" />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-ig-fg-muted">Nenhuma decisão selecionada</p>
          <p className="text-xs text-ig-fg-subtle mt-1">Selecione um item da fila para abrir o workspace do comitê.</p>
        </div>
      </div>
    );
  }

  const currentStage = item.stages?.find((s) => s.id === item.currentStageId);
  const voteSummary = item.votes ?? [];
  const yes = voteSummary.filter((v) => v.vote === 'yes').length;
  const no = voteSummary.filter((v) => v.vote === 'no').length;
  const abstain = voteSummary.filter((v) => v.vote === 'abstain').length;

  const primaryAction = getPrimaryAction(item);

  const slaHours = item.dueDate ? differenceInHours(new Date(item.dueDate), new Date()) : null;
  const slaUrgent = slaHours !== null && slaHours < 24;
  const quorumRequired = item.quorumRequired ?? 0;
  const quorumPresent = item.quorumPresent ?? voteSummary.length;
  const quorumReached = quorumRequired > 0 && quorumPresent >= quorumRequired;
  const completedStages = item.stages?.filter((stage) => stage.status === 'completed').length ?? 0;
  const totalStages = item.stages?.length ?? 0;

  const formatFinancial = (value?: number) => {
    if (!value) return null;
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 }).format(value);
  };

  return (
    <div className="h-full overflow-y-auto space-y-4 pr-1">
      <div className="relative overflow-hidden rounded-xl border border-ig-border-subtle bg-[linear-gradient(135deg,color-mix(in_oklab,var(--ig-bg-panel)_78%,transparent),color-mix(in_oklab,var(--ig-bg-raised)_38%,transparent))] p-4">
        <div className="pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-ig-border-focus to-transparent" />
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-ig-fg-subtle">
              <Building2 className="h-3 w-3" />
              {item.ownerCommitteeName}
            </p>
            <h2 className="text-lg font-semibold text-ig-fg-strong leading-snug">{item.title}</h2>
            <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-ig-fg-muted">{item.description}</p>
          </div>
          <HudBadge variant={STATUS_BADGE_VARIANT[item.deliberationStatus] ?? 'neutral'} dot>
            {STATUS_MAP[item.deliberationStatus] ?? item.deliberationStatus}
          </HudBadge>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
          <div className="rounded-lg border border-ig-border-subtle bg-ig-panel/60 p-2.5">
            <p className="text-[9px] uppercase tracking-[0.14em] text-ig-fg-subtle">Impacto</p>
            <p className="mt-1 flex items-center gap-1 text-sm font-semibold text-ig-fg-strong">
              <DollarSign className="h-3.5 w-3.5 text-ig-info" />
              {formatFinancial(item.financialImpact) ?? 'N/A'}
            </p>
          </div>
          <div className="rounded-lg border border-ig-border-subtle bg-ig-panel/60 p-2.5">
            <p className="text-[9px] uppercase tracking-[0.14em] text-ig-fg-subtle">Risco</p>
            <p className={cn('mt-1 flex items-center gap-1 text-sm font-semibold', item.riskLevel ? RISK_BADGE_VARIANT[item.riskLevel] === 'danger' ? 'text-ig-danger' : RISK_BADGE_VARIANT[item.riskLevel] === 'warning' ? 'text-ig-warning' : 'text-ig-success' : 'text-ig-fg-strong')}>
              <AlertTriangle className="h-3.5 w-3.5" />
              {item.riskLevel?.toUpperCase() ?? 'N/A'}
            </p>
          </div>
          <div className="rounded-lg border border-ig-border-subtle bg-ig-panel/60 p-2.5">
            <p className="text-[9px] uppercase tracking-[0.14em] text-ig-fg-subtle">SLA</p>
            <p className={cn('mt-1 flex items-center gap-1 text-sm font-semibold', slaUrgent ? 'text-ig-danger' : 'text-ig-fg-strong')}>
              <Clock className="h-3.5 w-3.5" />
              {slaHours === null ? 'N/A' : slaHours < 0 ? 'Atrasado' : `${slaHours}h`}
            </p>
          </div>
          <div className="rounded-lg border border-ig-border-subtle bg-ig-panel/60 p-2.5">
            <p className="text-[9px] uppercase tracking-[0.14em] text-ig-fg-subtle">Quórum</p>
            <p className={cn('mt-1 flex items-center gap-1 text-sm font-semibold tabular-nums', quorumReached ? 'text-ig-success' : 'text-ig-warning')}>
              <ShieldCheck className="h-3.5 w-3.5" />
              {quorumPresent}/{quorumRequired || '-'}
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
          <div className="text-xs text-ig-fg-muted">
            Fluxo de aprovação: <span className="font-semibold text-ig-fg-strong">{completedStages}/{totalStages}</span> etapas concluídas
          </div>
          <HudButton
            variant={primaryAction.variant}
            disabled={
              primaryAction.disabled ||
              (item.deliberationStatus === 'awaiting_minutes' && !canApprove) ||
              (item.deliberationStatus === 'in_execution' && !canApprove)
            }
            leftIcon={primaryAction.icon}
            title={!canApprove && (item.deliberationStatus === 'awaiting_minutes' || item.deliberationStatus === 'in_execution') ? 'Requer permissão deliberations.approve' : undefined}
            onClick={() => {
              if (item.deliberationStatus === 'awaiting_minutes') onGenerateMinutes(item.id);
              else if (item.deliberationStatus === 'in_execution') onCreateExecutionTask(item.id);
            }}
          >
            {primaryAction.label}
          </HudButton>
        </div>

        {(['in_voting', 'awaiting_minutes', 'resolved', 'in_review', 'in_execution'].includes(item.deliberationStatus)) && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {onApprove && ['in_voting', 'awaiting_minutes', 'resolved'].includes(item.deliberationStatus) && (
              <HudButton
                size="sm"
                variant="primary"
                leftIcon={<ThumbsUp className="w-3.5 h-3.5" />}
                disabled={!canApprove}
                title={canApprove ? 'Aprovar decisão' : 'Requer permissão deliberations.approve'}
                onClick={() => {
                  if (typeof window !== 'undefined' && !window.confirm('Confirmar APROVAÇÃO desta decisão?')) return;
                  onApprove(item.id);
                }}
              >
                Aprovar
              </HudButton>
            )}
            {onReject && ['in_voting', 'awaiting_minutes', 'in_review'].includes(item.deliberationStatus) && (
              <HudButton
                size="sm"
                variant="danger"
                leftIcon={<XCircle className="w-3.5 h-3.5" />}
                disabled={!canReject}
                title={canReject ? 'Rejeitar decisão' : 'Requer permissão deliberations.reject'}
                onClick={() => {
                  if (typeof window !== 'undefined' && !window.confirm('Confirmar REJEIÇÃO desta decisão?')) return;
                  onReject(item.id);
                }}
              >
                Rejeitar
              </HudButton>
            )}
            {onClose && ['resolved', 'in_execution', 'awaiting_minutes'].includes(item.deliberationStatus) && (
              <HudButton
                size="sm"
                variant="secondary"
                leftIcon={<Archive className="w-3.5 h-3.5" />}
                disabled={!canClose}
                title={canClose ? 'Encerrar decisão' : 'Requer permissão deliberations.close'}
                onClick={() => {
                  if (typeof window !== 'undefined' && !window.confirm('Confirmar ENCERRAMENTO desta decisão?')) return;
                  onClose(item.id);
                }}
              >
                Encerrar
              </HudButton>
            )}
          </div>
        )}
      </div>

      {/* ─── Tabs ─── */}
      <Tabs defaultValue="summary" className="w-full">
        <TabsList className="w-full bg-ig-panel border border-ig-border h-auto p-1 grid grid-cols-4">
          <TabsTrigger
            value="summary"
            className="text-xs text-ig-fg-muted data-[state=active]:bg-ig-accent-weak data-[state=active]:text-ig-accent"
          >
            Resumo Executivo
          </TabsTrigger>
          <TabsTrigger
            value="voting"
            className="text-xs text-ig-fg-muted data-[state=active]:bg-ig-accent-weak data-[state=active]:text-ig-accent"
          >
            Votação
          </TabsTrigger>
          <TabsTrigger
            value="minutes"
            className="text-xs text-ig-fg-muted data-[state=active]:bg-ig-accent-weak data-[state=active]:text-ig-accent"
          >
            Ata & Auditoria
          </TabsTrigger>
          <TabsTrigger
            value="execution"
            className="text-xs text-ig-fg-muted data-[state=active]:bg-ig-accent-weak data-[state=active]:text-ig-accent"
          >
            Execução
          </TabsTrigger>
        </TabsList>

        {/* ── Summary tab ── */}
        <TabsContent value="summary" className="space-y-3 mt-3">
          <section className="rounded-xl border border-ig-border-subtle bg-ig-panel/50 p-4">
            <p className="text-xs uppercase tracking-wide text-ig-fg-subtle font-medium">Decisão Solicitada</p>
            <p className="mt-2 text-sm text-ig-fg leading-relaxed">{item.requestedDecision || item.description}</p>
            {item.recommendationNotes && item.recommendationNotes.length > 0 && (
              <div className="mt-3 rounded-lg border border-ig-border-subtle bg-ig-panel/60 p-3">
                <p className="text-[10px] uppercase tracking-[0.14em] text-ig-fg-subtle">Recomendação executiva</p>
                <ul className="mt-2 space-y-1">
                  {item.recommendationNotes.map((note) => (
                    <li key={note} className="text-xs text-ig-fg-muted">• {note}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <section className="rounded-xl border border-ig-border-subtle bg-ig-panel/50 p-4">
            <p className="text-xs uppercase tracking-wide text-ig-fg-subtle font-medium">Fluxo de Aprovação</p>
            <div className="space-y-2">
              {(item.stages ?? []).map((stage, index) => {
                const isActive = stage.id === item.currentStageId;
                const isDone = stage.status === 'completed';
                return (
                  <div
                    key={stage.id}
                    className={cn(
                      'flex items-center gap-3 p-2 rounded-lg transition-all',
                      isActive && 'bg-ig-accent-weak border border-ig-border-focus',
                      isDone && 'opacity-60',
                    )}
                  >
                    <div className={cn(
                      'w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0',
                      isDone ? 'bg-ig-success text-[var(--ig-bg-canvas)]' : isActive ? 'bg-ig-accent text-[var(--ig-bg-canvas)]' : 'bg-ig-panel-hover text-ig-fg-muted',
                    )}>
                      {isDone ? '✓' : index + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={cn('text-xs font-medium', isActive ? 'text-ig-accent' : isDone ? 'text-ig-fg-muted' : 'text-ig-fg')}>
                        {stage.committeeName}
                      </p>
                      <p className="text-[10px] text-ig-fg-subtle">
                        {STAGE_TYPE_LABELS[stage.stageType] ?? stage.stageType} · Quórum {stage.votingRule.quorumPercent}% · {stage.votingRule.votingWindowHours}h
                      </p>
                    </div>
                    {isActive && <span className="text-[10px] text-ig-accent font-semibold">← Atual</span>}
                  </div>
                );
              })}
            </div>
          </section>

          {currentStage && (
            <section className="rounded-xl border border-ig-border-subtle bg-ig-panel/50 p-4">
              <p className="text-xs uppercase tracking-wide text-ig-fg-subtle font-medium">Etapa Atual</p>
              <p className="text-sm text-ig-fg-strong font-medium">{currentStage.committeeName}</p>
              <p className="text-xs text-ig-fg-muted">{STAGE_TYPE_LABELS[currentStage.stageType] ?? currentStage.stageType}</p>
            </section>
          )}

          <section className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-xl border border-ig-border-subtle bg-ig-panel/50 p-4">
              <EvidencePack attachments={item.attachments} evidenceComplete={item.evidenceComplete} />
            </div>
            <div className="rounded-xl border border-ig-border-subtle bg-ig-panel/50 p-4">
              <p className="text-xs uppercase tracking-wide text-ig-fg-subtle font-medium">Pareceres</p>
              <div className="mt-3 space-y-2">
                {(item.reviews ?? []).length > 0 ? item.reviews?.map((review) => (
                  <div key={`${review.type}-${review.reviewerName}`} className="rounded-lg border border-ig-border-subtle bg-ig-panel/60 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-ig-fg-strong">{review.type}</p>
                      <HudBadge
                        variant={review.status === 'approved' ? 'success' : review.status === 'rejected' ? 'danger' : review.status === 'pending' ? 'warning' : 'neutral'}
                        size="sm"
                        dot
                      >
                        {review.status === 'approved' ? 'Aprovado' : review.status === 'rejected' ? 'Rejeitado' : review.status === 'pending' ? 'Pendente' : 'N/A'}
                      </HudBadge>
                    </div>
                    <p className="mt-1 text-[10px] text-ig-fg-subtle">{review.reviewerName ?? 'Sem responsável'}</p>
                    {review.notes && <p className="mt-1 text-xs text-ig-fg-muted">{review.notes}</p>}
                  </div>
                )) : (
                  <p className="text-xs text-ig-fg-muted">Nenhum parecer registrado.</p>
                )}
              </div>
            </div>
          </section>

          {(item.linkedEntities ?? []).length > 0 && (
            <section className="rounded-xl border border-ig-border-subtle bg-ig-panel/50 p-4">
              <p className="text-xs uppercase tracking-wide text-ig-fg-subtle font-medium">Entidades Vinculadas</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {item.linkedEntities?.map((entity) => (
                  <div key={entity.id} className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-ig-border-subtle bg-ig-panel/60 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-ig-fg-strong">{entity.label}</p>
                      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-ig-fg-subtle">{entity.id}</p>
                    </div>
                    <HudBadge variant="info" size="sm">{entity.type}</HudBadge>
                  </div>
                ))}
              </div>
            </section>
          )}
        </TabsContent>

        {/* ── Voting tab ── */}
        <TabsContent value="voting" className="space-y-3 mt-3">
          <VotingConsole
            item={item}
            currentUserId={currentUserId}
            onCastVote={(vote, justification, hasConflict) => onCastVote(item.id, vote, justification, hasConflict)}
            onCloseVoting={() => onCloseVoting(item.id)}
            onOpenVoting={() => onStartVoting(item.id)}
            canVote={canVote}
            canManageVoting={canApprove}
          />

          <HudPanel className="space-y-1">
            <p className="text-xs uppercase tracking-wide text-ig-fg-subtle font-medium">Resultado Parcial</p>
            <div className="flex items-center gap-4 mt-2">
              <span className="text-sm text-ig-success font-semibold tabular-nums">Sim: {yes}</span>
              <span className="text-sm text-ig-danger font-semibold tabular-nums">Não: {no}</span>
              <span className="text-sm text-ig-fg-muted tabular-nums">Abstenção: {abstain}</span>
            </div>
          </HudPanel>
        </TabsContent>

        {/* ── Minutes / Audit tab ── */}
        <TabsContent value="minutes" className="space-y-3 mt-3">
          <HudPanel className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs uppercase tracking-wide text-ig-fg-subtle font-medium">Ata da Decisão</p>
              <div className="flex items-center gap-2">
                <HudButton
                  size="sm"
                  variant="secondary"
                  leftIcon={<FileText className="w-3.5 h-3.5" />}
                  onClick={() => onGenerateMinutes(item.id)}
                  disabled={!canApprove}
                  title={canApprove ? 'Gerar minuta' : 'Requer permissão deliberations.approve'}
                >
                  Gerar minuta
                </HudButton>
                <HudButton
                  size="sm"
                  variant="primary"
                  leftIcon={<CheckCircle className="w-3.5 h-3.5" />}
                  onClick={() => onPublishMinutes(item.id)}
                  disabled={!canApprove}
                  title={canApprove ? 'Publicar ata' : 'Requer permissão deliberations.approve'}
                >
                  Publicar ata
                </HudButton>
              </div>
            </div>
            <p className="text-sm text-ig-fg leading-relaxed whitespace-pre-wrap">
              {item.minutesSummary || <span className="text-ig-fg-subtle italic">Minuta ainda não gerada.</span>}
            </p>
          </HudPanel>

          <HudPanel>
            <AuditTrailTimeline entries={item.auditTrail || []} />
          </HudPanel>
        </TabsContent>

        {/* ── Execution tab ── */}
        <TabsContent value="execution" className="space-y-3 mt-3">
          <HudPanel className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs uppercase tracking-wide text-ig-fg-subtle font-medium">Ações de Execução</p>
              <HudButton
                size="sm"
                variant="primary"
                leftIcon={<Workflow className="w-3.5 h-3.5" />}
                onClick={() => onCreateExecutionTask(item.id)}
                disabled={!canApprove}
                title={canApprove ? 'Criar ação' : 'Requer permissão deliberations.approve'}
              >
                Criar Ação
              </HudButton>
            </div>

            {(item.executionItems ?? []).length === 0 ? (
              <div className="py-6 text-center rounded-lg border border-dashed border-ig-border">
                <PlayCircle className="w-8 h-8 mx-auto mb-2 text-ig-fg-subtle" />
                <p className="text-sm text-ig-fg-muted">Nenhuma ação de execução registrada.</p>
                <p className="text-xs text-ig-fg-subtle mt-1">Clique em &ldquo;Criar Ação&rdquo; para iniciar a execução.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {(item.executionItems ?? []).map((task) => (
                  <div key={task.id} className="rounded-lg border border-ig-border bg-ig-panel p-3 space-y-1.5">
                    <p className="text-sm font-medium text-ig-fg-strong">{task.title}</p>
                    <div className="flex items-center gap-3 text-xs text-ig-fg-muted">
                      <span>Responsável: {task.ownerName}</span>
                      <span>Prazo: {task.dueDate.toLocaleDateString('pt-BR')}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <HudBadge
                        variant={task.status === 'completed' ? 'success' : task.status === 'in_progress' ? 'warning' : 'neutral'}
                        size="sm"
                        dot
                      >
                        {TASK_STATUS_LABELS[task.status] ?? task.status}
                      </HudBadge>
                      {task.linkedEntityType && (
                        <span className="text-[10px] text-ig-accent flex items-center gap-1">
                          <Link2 className="w-3 h-3" />
                          {task.linkedEntityType}: {task.linkedEntityId}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </HudPanel>
        </TabsContent>
      </Tabs>
    </div>
  );
}
