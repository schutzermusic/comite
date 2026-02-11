'use client';

import React from 'react';
import { DeliberationItem, VoteOption } from '@/lib/types';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { HUDCard } from '@/components/ui/hud-card';
import { StatusPill } from '@/components/ui/status-pill';
import { AuditTrailTimeline } from './AuditTrailTimeline';
import { VotingConsole } from './VotingConsole';
import { Button } from '@/components/ui/button';
import { CheckCircle, FileText, Link2, Workflow } from 'lucide-react';

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
}

const statusMap: Record<string, string> = {
  draft: 'Rascunho',
  submitted: 'Submetida',
  in_review: 'Em Revisão',
  in_voting: 'Em Votação',
  awaiting_minutes: 'Aguardando Atas',
  resolved: 'Resolvida',
  in_execution: 'Em Execução',
  closed: 'Encerrada',
  returned_for_revision: 'Devolvida para Revisão',
  withdrawn: 'Retirada',
};

export function DecisionInspector({
  item,
  currentUserId,
  onStartVoting,
  onCastVote,
  onCloseVoting,
  onGenerateMinutes,
  onPublishMinutes,
  onCreateExecutionTask,
}: DecisionInspectorProps) {
  const stageTypeLabel: Record<string, string> = {
    owner_review: 'Revisão do Comitê Responsável',
    dependent_review: 'Revisão Dependente',
    final_approval: 'Aprovação Final',
    publish_minutes: 'Publicação de Ata',
    execution: 'Execução',
  };
  if (!item) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-sm text-[rgba(255,255,255,0.55)]">Selecione uma deliberação para ver os detalhes.</p>
      </div>
    );
  }

  const currentStage = item.stages?.find((stage) => stage.id === item.currentStageId);
  const voteSummary = item.votes ?? [];
  const yes = voteSummary.filter((vote) => vote.vote === 'yes').length;
  const no = voteSummary.filter((vote) => vote.vote === 'no').length;
  const abstain = voteSummary.filter((vote) => vote.vote === 'abstain').length;
  const taskStatusLabel: Record<string, string> = {
    pending: 'Pendente',
    in_progress: 'Em andamento',
    completed: 'Concluída',
  };

  return (
    <div className="h-full overflow-y-auto space-y-3 pr-1">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">{item.title}</h2>
          <p className="text-sm text-[rgba(255,255,255,0.6)]">{item.ownerCommitteeName}</p>
        </div>
        <StatusPill variant={item.deliberationStatus === 'resolved' || item.deliberationStatus === 'closed' ? 'success' : 'info'}>
          {statusMap[item.deliberationStatus] ?? item.deliberationStatus}
        </StatusPill>
      </div>

      <Tabs defaultValue="summary" className="w-full">
        <TabsList className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.08)] h-auto p-1 grid grid-cols-4">
          <TabsTrigger value="summary" className="text-xs text-[rgba(255,255,255,0.75)] data-[state=active]:bg-[rgba(0,255,180,0.14)] data-[state=active]:text-[#00FFB4]">
            Resumo Executivo
          </TabsTrigger>
          <TabsTrigger value="voting" className="text-xs text-[rgba(255,255,255,0.75)] data-[state=active]:bg-[rgba(0,200,255,0.14)] data-[state=active]:text-[#00C8FF]">
            Votação
          </TabsTrigger>
          <TabsTrigger value="minutes" className="text-xs text-[rgba(255,255,255,0.75)] data-[state=active]:bg-[rgba(245,158,11,0.14)] data-[state=active]:text-[#F59E0B]">
            Atas & Auditoria
          </TabsTrigger>
          <TabsTrigger value="execution" className="text-xs text-[rgba(255,255,255,0.75)] data-[state=active]:bg-[rgba(168,85,247,0.14)] data-[state=active]:text-[#C084FC]">
            Execução
          </TabsTrigger>
        </TabsList>

        <TabsContent value="summary" className="space-y-3">
          <HUDCard className="space-y-2">
            <p className="text-xs uppercase tracking-wide text-[rgba(255,255,255,0.5)]">Decisão Solicitada</p>
            <p className="text-sm text-[rgba(255,255,255,0.82)]">{item.requestedDecision || item.description}</p>
          </HUDCard>

          <HUDCard className="space-y-2">
            <p className="text-xs uppercase tracking-wide text-[rgba(255,255,255,0.5)]">Fluxo de Governança</p>
            {(item.stages ?? []).map((stage) => (
              <div key={stage.id} className="flex items-center justify-between text-sm">
                <span className="text-[rgba(255,255,255,0.8)]">{stage.sequence}. {stage.committeeName}</span>
                <span className="text-[rgba(255,255,255,0.55)]">{stageTypeLabel[stage.stageType] ?? stage.stageType}</span>
              </div>
            ))}
          </HUDCard>

          <HUDCard className="space-y-1">
            <p className="text-xs uppercase tracking-wide text-[rgba(255,255,255,0.5)]">Etapa Atual</p>
            <p className="text-sm text-white">{currentStage?.committeeName} - {stageTypeLabel[currentStage?.stageType ?? ''] ?? currentStage?.stageType}</p>
          </HUDCard>
        </TabsContent>

        <TabsContent value="voting" className="space-y-3">
          <VotingConsole
            item={item}
            currentUserId={currentUserId}
            onCastVote={(vote, justification, hasConflict) => onCastVote(item.id, vote, justification, hasConflict)}
            onCloseVoting={() => onCloseVoting(item.id)}
            onOpenVoting={() => onStartVoting(item.id)}
          />

          <HUDCard className="space-y-1">
            <p className="text-xs uppercase tracking-wide text-[rgba(255,255,255,0.5)]">Resumo da Votação</p>
            <p className="text-sm text-[rgba(255,255,255,0.8)]">Sim {yes} | Não {no} | Abstenção {abstain}</p>
          </HUDCard>
        </TabsContent>

        <TabsContent value="minutes" className="space-y-3">
          <HUDCard className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs uppercase tracking-wide text-[rgba(255,255,255,0.5)]">Atas</p>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" className="border-[rgba(255,255,255,0.15)]" onClick={() => onGenerateMinutes(item.id)}>
                  <FileText className="w-3.5 h-3.5 mr-1" />
                  Gerar Minuta
                </Button>
                <Button size="sm" className="bg-[#00FFB4] hover:bg-[#00D89A] text-[#05100B]" onClick={() => onPublishMinutes(item.id)}>
                  <CheckCircle className="w-3.5 h-3.5 mr-1" />
                  Publicar Ata
                </Button>
              </div>
            </div>
            <p className="text-sm text-[rgba(255,255,255,0.8)] whitespace-pre-wrap">{item.minutesSummary || 'Minuta ainda não gerada.'}</p>
          </HUDCard>

          <HUDCard>
            <AuditTrailTimeline entries={item.auditTrail || []} />
          </HUDCard>
        </TabsContent>

        <TabsContent value="execution" className="space-y-3">
          <HUDCard className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs uppercase tracking-wide text-[rgba(255,255,255,0.5)]">Ações Pós-Decisão</p>
              <Button size="sm" onClick={() => onCreateExecutionTask(item.id)} className="bg-[#A855F7] hover:bg-[#9333EA] text-white">
                <Workflow className="w-3.5 h-3.5 mr-1" />
                Criar Ação
              </Button>
            </div>

            {(item.executionItems ?? []).length === 0 ? (
              <p className="text-sm text-[rgba(255,255,255,0.6)]">Nenhuma ação de execução registrada.</p>
            ) : (
              (item.executionItems ?? []).map((task) => (
                <div key={task.id} className="rounded-lg border border-[rgba(255,255,255,0.1)] p-3 text-sm">
                  <p className="text-white">{task.title}</p>
                  <p className="text-[rgba(255,255,255,0.6)]">Responsável: {task.ownerName} | Prazo: {task.dueDate.toLocaleDateString()}</p>
                  <p className="text-[rgba(255,255,255,0.6)]">Status: {taskStatusLabel[task.status] ?? task.status}</p>
                  {task.linkedEntityType && (
                    <p className="text-[#00C8FF] flex items-center gap-1">
                      <Link2 className="w-3 h-3" />
                      Vinculado a {task.linkedEntityType}: {task.linkedEntityId}
                    </p>
                  )}
                </div>
              ))
            )}
          </HUDCard>
        </TabsContent>
      </Tabs>
    </div>
  );
}
