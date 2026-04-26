'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FileText, Filter, Plus, Search } from 'lucide-react';
import { BoardHealthKPI, DecisionInspector, DecisionList, NewDeliberationModal, QueueTabs } from '@/components/deliberacoes';
import { HudPanel, HudButton } from '@/components/hud';
import { AuditTrailEntry, DeliberationItem, DeliberationStageStatus, DeliberationStatus, VoteOption, VoteRecord } from '@/lib/types';
import { COMMITTEES, buildStagePlan, resolveTemplate } from '@/lib/deliberations-policy';
import { deliberationSerial } from '@/lib/utils/serial';
import { formatDistanceToNowStrict } from 'date-fns';
import type { NewDeliberationPayload } from '@/components/deliberacoes/NewDeliberationModal';

const CURRENT_USER_ID = 'user-current';
const CURRENT_USER_NAME = 'Membro Corporativo';

const generateAuditEntry = (
  itemId: string,
  action: AuditTrailEntry['action'],
  description: string,
  previousValue?: string,
  newValue?: string
): AuditTrailEntry => ({
  id: `audit-${Date.now()}-${Math.random()}`,
  itemId,
  action,
  description,
  userId: CURRENT_USER_ID,
  userName: CURRENT_USER_NAME,
  previousValue,
  newValue,
  timestamp: new Date(),
});

const initialItems: DeliberationItem[] = [
  {
    id: 'delib-1',
    title: 'Aprovação de Mudança de Cargo Estratégico',
    description: 'RH solicita aprovação de mudança de cargo com ajuste de remuneração e expansão de escopo estratégico.',
    status: 'under_review',
    type: 'HR',
    priority: 'high',
    createdBy: 'user-hr',
    createdByName: 'Diretoria de RH',
    createdAt: new Date('2026-02-01T10:00:00'),
    updatedAt: new Date('2026-02-01T10:00:00'),
    submittedAt: new Date('2026-02-01T10:00:00'),
    deliberationStatus: 'in_review',
    ownerCommitteeId: 'hr',
    ownerCommitteeName: 'Comitê de RH',
    dependentCommitteeIds: ['finance', 'legal'],
    dependentCommitteeNames: ['Comitê Financeiro', 'Comitê Jurídico'],
    templateId: 'HR_HIRING_APPROVAL',
    templateName: 'Aprovação de Contratação (RH)',
    requestedDecision: 'Aprovar mudança estratégica de cargo e pacote de remuneração.',
    financialImpact: 620000,
    riskLevel: 'high',
    evidenceComplete: true,
    dueDate: new Date(Date.now() + 36 * 60 * 60 * 1000),
    quorumRequired: 3,
    quorumPresent: 2,
    stages: buildStagePlan({
      ownerCommitteeId: 'hr',
      financialImpact: 620000,
      riskLevel: 'high',
      strategicFlag: true,
      outsideBudget: true,
    }),
    currentStageId: 'stage-1-hr',
    votes: [],
    auditTrail: [generateAuditEntry('delib-1', 'stage_transitioned', 'Revisão do comitê responsável iniciada no Comitê de RH')],
    executionItems: [],
  },
  {
    id: 'delib-2',
    title: 'CAPEX para Infraestrutura de IA na Rede',
    description: 'Engenharia propõe CAPEX para infraestrutura de otimização de rede com IA.',
    status: 'under_review',
    type: 'Financial',
    priority: 'critical',
    createdBy: 'user-rnd',
    createdByName: 'VP de Engenharia',
    createdAt: new Date('2026-02-02T08:30:00'),
    updatedAt: new Date('2026-02-03T09:30:00'),
    submittedAt: new Date('2026-02-02T08:30:00'),
    deliberationStatus: 'in_voting',
    ownerCommitteeId: 'finance',
    ownerCommitteeName: 'Comitê Financeiro',
    dependentCommitteeIds: ['risk', 'rnd'],
    dependentCommitteeNames: ['Comitê de Riscos', 'Comitê de P&D'],
    templateId: 'FINANCE_CAPEX_APPROVAL',
    templateName: 'Aprovação de CAPEX (Financeiro)',
    requestedDecision: 'Aprovar alocação de CAPEX e termos de financiamento.',
    financialImpact: 8200000,
    riskLevel: 'critical',
    evidenceComplete: true,
    dueDate: new Date(Date.now() + 18 * 60 * 60 * 1000),
    quorumRequired: 4,
    quorumPresent: 4,
    stages: buildStagePlan({
      ownerCommitteeId: 'finance',
      financialImpact: 8200000,
      riskLevel: 'critical',
      technicalInvestment: true,
      strategicFlag: true,
    }),
    currentStageId: 'stage-1-finance',
    votingStartedAt: new Date(Date.now() - 6 * 60 * 60 * 1000),
    votes: [
      { id: 'vote-1', itemId: 'delib-2', voterId: 'user-1', voterName: 'Membro do Comitê A', vote: 'yes', hasConflictOfInterest: false, votedAt: new Date() },
      { id: 'vote-2', itemId: 'delib-2', voterId: CURRENT_USER_ID, voterName: CURRENT_USER_NAME, vote: 'abstain', hasConflictOfInterest: false, votedAt: new Date() },
    ],
    auditTrail: [
      generateAuditEntry('delib-2', 'voting_started', 'Janela de votação aberta no Comitê Financeiro'),
      generateAuditEntry('delib-2', 'vote_cast', 'Voto registrado por Membro Corporativo'),
    ],
    executionItems: [],
  },
  {
    id: 'delib-3',
    title: 'Proposta de Vendas para Cliente Estratégico',
    description: 'Vendas solicita autorização para prosseguir com contrato de alto valor com cliente estratégico.',
    status: 'approved',
    type: 'Sales',
    priority: 'high',
    createdBy: 'user-sales',
    createdByName: 'Diretor de Vendas',
    createdAt: new Date('2026-01-20T09:00:00'),
    updatedAt: new Date('2026-01-30T17:00:00'),
    submittedAt: new Date('2026-01-20T09:00:00'),
    resolvedAt: new Date('2026-01-30T17:00:00'),
    deliberationStatus: 'resolved',
    ownerCommitteeId: 'sales',
    ownerCommitteeName: 'Comitê de Vendas',
    templateId: 'SALES_PROJECT_APPROVAL',
    templateName: 'Aprovação de Projeto (Vendas)',
    requestedDecision: 'Aprovar assinatura de contrato com cliente estratégico.',
    financialImpact: 5400000,
    riskLevel: 'medium',
    evidenceComplete: true,
    stages: buildStagePlan({
      ownerCommitteeId: 'sales',
      financialImpact: 5400000,
      riskLevel: 'medium',
      strategicClient: true,
      highTicket: true,
    }),
    currentStageId: 'stage-4-sales',
    minutesSummary: 'Minuta de Ata:\nResolução aprovada pelos comitês necessários e pela etapa final do Conselho.\nAções criadas para contrato e controles de risco.',
    minutes: {
      status: 'published',
      agendaSummary: 'Revisão de oportunidade estratégica de vendas.',
      evidenceList: ['Proposta Comercial', 'Avaliação de Risco', 'Memorando de Desvio Jurídico'],
      votingResult: 'Sim 5 / Não 1 / Abstenção 0',
      decisionText: 'Resolvido Aprovado',
      actionItems: ['Finalizar termos do contrato', 'Abrir projeto de entrega'],
      publishedAt: new Date('2026-01-31T10:00:00'),
    },
    auditTrail: [
      generateAuditEntry('delib-3', 'decision_issued', 'Decisão final emitida: Resolvido Aprovado'),
      generateAuditEntry('delib-3', 'minutes_published', 'Ata publicada pelo Secretário'),
    ],
    executionItems: [
      { id: 'act-1', title: 'Vincular registro do contrato', ownerName: 'Operações Jurídicas', dueDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), status: 'in_progress', linkedEntityType: 'contract', linkedEntityId: 'CON-92811' },
    ],
  },
];

const getQueueCounts = (items: DeliberationItem[]): Record<DeliberationStatus, number> => ({
  draft: items.filter((item) => item.deliberationStatus === 'draft').length,
  submitted: items.filter((item) => item.deliberationStatus === 'submitted').length,
  in_review: items.filter((item) => item.deliberationStatus === 'in_review').length,
  in_voting: items.filter((item) => item.deliberationStatus === 'in_voting').length,
  awaiting_minutes: items.filter((item) => item.deliberationStatus === 'awaiting_minutes').length,
  resolved: items.filter((item) => item.deliberationStatus === 'resolved').length,
  in_execution: items.filter((item) => item.deliberationStatus === 'in_execution').length,
  closed: items.filter((item) => item.deliberationStatus === 'closed').length,
  returned_for_revision: items.filter((item) => item.deliberationStatus === 'returned_for_revision').length,
  withdrawn: items.filter((item) => item.deliberationStatus === 'withdrawn').length,
});

const evaluateVoteResult = (item: DeliberationItem) => {
  const currentStage = item.stages?.find((stage) => stage.id === item.currentStageId);
  const votes = item.votes ?? [];
  const yes = votes.filter((vote) => vote.vote === 'yes').length;
  const no = votes.filter((vote) => vote.vote === 'no').length;
  const countedVotes = yes + no;
  const quorumReached = (item.quorumPresent ?? votes.length) >= (item.quorumRequired ?? 3);

  if (!quorumReached) return { approved: false, result: 'no_quorum' as const };
  if (!currentStage) return { approved: yes > no, result: yes > no ? 'approved' as const : 'rejected' as const };

  if (currentStage.votingRule.majorityType === 'qualified_two_thirds') {
    if (countedVotes === 0) return { approved: false, result: 'rejected' as const };
    return { approved: yes / countedVotes >= 2 / 3, result: yes / countedVotes >= 2 / 3 ? 'approved' as const : 'rejected' as const };
  }

  if (currentStage.votingRule.majorityType === 'unanimity') {
    return { approved: no === 0 && yes > 0, result: no === 0 && yes > 0 ? 'approved' as const : 'rejected' as const };
  }

  if (yes === no) {
    return { approved: currentStage.votingRule.tieBreakRule === 'chair_yes', result: currentStage.votingRule.tieBreakRule === 'chair_yes' ? 'approved' as const : 'rejected' as const };
  }

  return { approved: yes > no, result: yes > no ? 'approved' as const : 'rejected' as const };
};

export default function DeliberationsPage() {
  const [items, setItems] = useState<DeliberationItem[]>(initialItems);
  const [selectedId, setSelectedId] = useState<string | null>(initialItems[0]?.id ?? null);
  const [activeQueue, setActiveQueue] = useState<DeliberationStatus>('in_review');
  const [activeKpiFilter, setActiveKpiFilter] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [committeeFilter, setCommitteeFilter] = useState('all');
  const [showFilters, setShowFilters] = useState(false);
  const [newDeliberationOpen, setNewDeliberationOpen] = useState(false);
  const [nowTs, setNowTs] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNowTs(Date.now()), 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  const selectedItem = useMemo(() => items.find((item) => item.id === selectedId) ?? null, [items, selectedId]);
  const queueCounts = useMemo(() => getQueueCounts(items), [items]);

  const filteredItems = useMemo(() => {
    let result = [...items];
    if (activeKpiFilter === 'open') {
      result = result.filter((item) => ['draft', 'submitted', 'in_review', 'in_voting', 'awaiting_minutes', 'in_execution'].includes(item.deliberationStatus));
    } else if (activeKpiFilter === 'in_voting') {
      result = result.filter((item) => item.deliberationStatus === 'in_voting');
    } else if (activeKpiFilter === 'overdue') {
      result = result.filter((item) => item.dueDate && item.dueDate.getTime() < nowTs);
    } else if (activeKpiFilter === 'resolved_30d') {
      const windowMs = 30 * 24 * 60 * 60 * 1000;
      result = result.filter((item) => item.resolvedAt && nowTs - item.resolvedAt.getTime() <= windowMs);
    } else if (activeKpiFilter === 'avg_resolution') {
      result = result.filter((item) => item.resolvedAt);
    } else {
      result = result.filter((item) => item.deliberationStatus === activeQueue);
    }

    if (committeeFilter !== 'all') result = result.filter((item) => item.ownerCommitteeId === committeeFilter);
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter((item) => item.title.toLowerCase().includes(term) || item.description.toLowerCase().includes(term));
    }
    return result;
  }, [items, activeQueue, activeKpiFilter, committeeFilter, searchTerm, nowTs]);

  const nextSessionItems = useMemo(() => {
    return [...items]
      .filter((item) => item.deliberationStatus === 'in_review' || item.deliberationStatus === 'submitted')
      .sort((a, b) => (a.dueDate?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.dueDate?.getTime() ?? Number.MAX_SAFE_INTEGER))
      .slice(0, 3);
  }, [items]);

  const handleStartVoting = useCallback((itemId: string) => {
    setItems((previous) => previous.map((item) => {
      if (item.id !== itemId) return item;
      const currentStage = item.stages?.find((stage) => stage.id === item.currentStageId);
      const quorumRequired = Math.max(1, Math.ceil(((currentStage?.votingRule.quorumPercent ?? 60) / 100) * 5));
      const now = new Date();
      return {
        ...item,
        deliberationStatus: 'in_voting',
        votingStartedAt: now,
        dueDate: new Date(now.getTime() + (currentStage?.votingRule.votingWindowHours ?? 48) * 60 * 60 * 1000),
        quorumRequired,
        quorumPresent: item.votes?.length ?? 0,
        auditTrail: [generateAuditEntry(itemId, 'voting_started', 'Janela de votação aberta.'), ...(item.auditTrail || [])],
      };
    }));
  }, []);

  const handleCastVote = useCallback((itemId: string, vote: VoteOption, justification?: string, hasConflict?: boolean) => {
    setItems((previous) => previous.map((item) => {
      if (item.id !== itemId) return item;
      const newVote: VoteRecord = {
        id: `vote-${Date.now()}`,
        itemId,
        voterId: CURRENT_USER_ID,
        voterName: CURRENT_USER_NAME,
        vote,
        justification,
        hasConflictOfInterest: Boolean(hasConflict),
        stageId: item.currentStageId,
        votedAt: new Date(),
      };
      return {
        ...item,
        votes: [...(item.votes || []).filter((entry) => entry.voterId !== CURRENT_USER_ID), newVote],
        quorumPresent: (item.votes || []).filter((entry) => entry.voterId !== CURRENT_USER_ID).length + 1,
        auditTrail: [generateAuditEntry(itemId, 'vote_cast', `Vote cast: ${vote.toUpperCase()}`), ...(item.auditTrail || [])],
      };
    }));
  }, []);

  const handleCloseVoting = useCallback((itemId: string) => {
    setItems((previous) => previous.map((item) => {
      if (item.id !== itemId) return item;
      const outcome = evaluateVoteResult(item);
      const stages = [...(item.stages || [])];
      const currentStageIndex = stages.findIndex((stage) => stage.id === item.currentStageId);

      if (currentStageIndex >= 0) {
        const nextStatus: DeliberationStageStatus = outcome.approved ? 'completed' : 'rejected';
        stages[currentStageIndex] = { ...stages[currentStageIndex], status: nextStatus, closedAt: new Date() };
      }

      if (!outcome.approved) {
        return {
          ...item,
          deliberationStatus: outcome.result === 'no_quorum' ? 'in_review' : 'resolved',
          voteResult: outcome.result,
          resolvedAt: outcome.result === 'no_quorum' ? undefined : new Date(),
          votingClosedAt: new Date(),
          stages,
        auditTrail: [generateAuditEntry(itemId, 'voting_closed', `Janela de votação encerrada com resultado: ${outcome.result}`), ...(item.auditTrail || [])],
        };
      }

      const nextStage = stages.find((stage) => stage.status === 'pending');
      if (!nextStage) {
        return {
          ...item,
          deliberationStatus: 'awaiting_minutes',
          voteResult: 'approved',
          votingClosedAt: new Date(),
          stages,
          auditTrail: [generateAuditEntry(itemId, 'voting_closed', 'Janela de votação encerrada: aprovado e pronto para ata.'), ...(item.auditTrail || [])],
        };
      }

      const updatedStages = stages.map((stage) => stage.id === nextStage.id ? { ...stage, status: 'active' as DeliberationStageStatus, openedAt: new Date() } : stage);
      const nextStatus: DeliberationStatus = nextStage.stageType === 'publish_minutes' ? 'awaiting_minutes' : nextStage.stageType === 'execution' ? 'in_execution' : 'in_review';

      return {
        ...item,
        deliberationStatus: nextStatus,
        voteResult: 'approved',
        votingClosedAt: new Date(),
        currentStageId: nextStage.id,
        votingStartedAt: undefined,
        votes: [],
        stages: updatedStages,
        auditTrail: [generateAuditEntry(itemId, 'stage_transitioned', `Transição de etapa para ${nextStage.committeeName} (${nextStage.stageType}).`), ...(item.auditTrail || [])],
      };
    }));
  }, []);

  const handleGenerateMinutes = useCallback((itemId: string) => {
    setItems((previous) => previous.map((item) => {
      if (item.id !== itemId) return item;
      const votes = item.votes || [];
      const yes = votes.filter((vote) => vote.vote === 'yes').length;
      const no = votes.filter((vote) => vote.vote === 'no').length;
      const abstain = votes.filter((vote) => vote.vote === 'abstain').length;
      const actionTexts = (item.executionItems || []).map((task) => `${task.title} (${task.ownerName})`);
      const summary = [
        `Resumo da pauta: ${item.title}`,
        `Lista de evidências: ${(item.attachments || []).map((file) => file.name).join(', ') || 'Não informado'}`,
        `Resultado da votação: Sim ${yes} | Não ${no} | Abstenção ${abstain}`,
        `Texto da decisão: ${item.voteResult === 'approved' ? 'Resolvido Aprovado' : 'Resolvido Rejeitado'}`,
        `Ações: ${actionTexts.length ? actionTexts.join('; ') : 'Sem ações no momento'}`,
      ].join('\n');

      return {
        ...item,
        minutesSummary: summary,
        minutes: {
          status: 'draft',
          agendaSummary: item.title,
          evidenceList: (item.attachments || []).map((file) => file.name),
          votingResult: `Sim ${yes} | Não ${no} | Abstenção ${abstain}`,
          decisionText: item.voteResult === 'approved' ? 'Resolvido Aprovado' : 'Resolvido Rejeitado',
          actionItems: actionTexts,
        },
        auditTrail: [generateAuditEntry(itemId, 'minutes_generated', 'Minuta de ata gerada.'), ...(item.auditTrail || [])],
      };
    }));
  }, []);

  const handlePublishMinutes = useCallback((itemId: string) => {
    setItems((previous) => previous.map((item) => {
      if (item.id !== itemId) return item;
      const stages = [...(item.stages || [])];
      const publishStage = stages.find((stage) => stage.stageType === 'publish_minutes');
      if (publishStage) {
        const publishIndex = stages.findIndex((stage) => stage.id === publishStage.id);
        stages[publishIndex] = { ...publishStage, status: 'completed', closedAt: new Date() };
        const executionStage = stages.find((stage) => stage.stageType === 'execution');
        if (executionStage) {
          const executionIndex = stages.findIndex((stage) => stage.id === executionStage.id);
          stages[executionIndex] = { ...executionStage, status: 'active', openedAt: new Date() };
        }
      }

      return {
        ...item,
        deliberationStatus: 'in_execution',
        currentStageId: stages.find((stage) => stage.stageType === 'execution')?.id || item.currentStageId,
        minutes: item.minutes ? { ...item.minutes, status: 'published', publishedAt: new Date() } : undefined,
        resolvedAt: item.resolvedAt || new Date(),
        stages,
        auditTrail: [generateAuditEntry(itemId, 'minutes_published', 'Ata publicada e etapa de execução ativada.'), ...(item.auditTrail || [])],
      };
    }));
  }, []);

  const handleCreateExecutionTask = useCallback((itemId: string) => {
    setItems((previous) => previous.map((item) => {
      if (item.id !== itemId) return item;
      const newTask = {
        id: `task-${Date.now()}`,
        title: 'Ação de execução de follow-up',
        ownerName: 'Escritório de Projetos',
        dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        status: 'pending' as const,
        linkedEntityType: (['project', 'contract', 'risk'] as const)[Math.floor(Math.random() * 3)],
        linkedEntityId: `REF-${Math.floor(Math.random() * 10000)}`,
      };
      return {
        ...item,
        deliberationStatus: item.deliberationStatus === 'resolved' ? 'in_execution' : item.deliberationStatus,
        executionItems: [...(item.executionItems || []), newTask],
        auditTrail: [generateAuditEntry(itemId, 'execution_task_created', `Ação de execução criada: ${newTask.title}`), ...(item.auditTrail || [])],
      };
    }));
  }, []);

  const handleCreateDeliberation = useCallback((payload: NewDeliberationPayload) => {
    const template = resolveTemplate(payload.templateId);
    const newItem: DeliberationItem = {
      id: `delib-${Date.now()}`,
      title: payload.title,
      description: payload.description,
      status: 'under_review',
      type: payload.businessArea,
      priority: payload.riskLevel === 'critical' ? 'critical' : payload.riskLevel === 'high' ? 'high' : 'medium',
      createdBy: CURRENT_USER_ID,
      createdByName: CURRENT_USER_NAME,
      createdAt: new Date(),
      updatedAt: new Date(),
      submittedAt: new Date(),
      deliberationStatus: 'submitted',
      ownerCommitteeId: payload.ownerCommitteeId,
      ownerCommitteeName: payload.ownerCommitteeName,
      dependentCommitteeIds: payload.dependentCommitteeIds,
      dependentCommitteeNames: payload.dependentCommitteeNames,
      templateId: payload.templateId,
      templateName: template?.name || payload.templateId,
      requestedDecision: payload.description,
      strategicFlag: payload.strategicFlag,
      financialImpact: payload.financialImpact,
      riskLevel: payload.riskLevel,
      marginPercent: payload.marginPercent,
      evidenceComplete: false,
      stages: payload.stages,
      currentStageId: payload.stages[0]?.id,
      quorumRequired: Math.max(1, Math.ceil((payload.stages[0]?.votingRule.quorumPercent ?? 60) * 5 / 100)),
      votes: [],
      auditTrail: [
        generateAuditEntry('new', 'status_changed', 'Deliberação submetida e roteada pela política.', 'draft', 'submitted'),
        generateAuditEntry('new', 'stage_transitioned', `Comitê responsável definido: ${payload.ownerCommitteeName}.`),
      ],
      executionItems: [],
    };
    setItems((previous) => [newItem, ...previous]);
    setSelectedId(newItem.id);
  }, []);

  return (
    <div className="min-h-full h-screen overflow-hidden p-4 md:p-6">
      <div className="max-w-[1920px] mx-auto h-full flex flex-col">
        <header className="shrink-0 mb-4">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <div className="ig-icon-jewel flex h-9 w-9 items-center justify-center">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <h1 className="text-ig-h1 font-semibold ig-text-metal">Deliberações</h1>
                  <p className="mt-0.5 max-w-3xl text-ig-body-sm text-ig-fg-muted">
                    Encaminhe solicitações para comitês, conduza votações auditáveis, emita resoluções e execute ações.
                  </p>
                </div>
              </div>
            </div>
            <HudButton variant="primary" size="md" leftIcon={<Plus className="w-4 h-4" />} onClick={() => setNewDeliberationOpen(true)}>
              Nova Deliberação
            </HudButton>
          </div>
        </header>

        <div className="shrink-0 mb-4">
          <BoardHealthKPI items={items} activeFilter={activeKpiFilter} onFilterClick={setActiveKpiFilter} />
        </div>

        <div className="shrink-0 mb-4 grid grid-cols-[1fr_320px] gap-4">
          <div className="flex items-center gap-3">
            <QueueTabs
              activeQueue={activeQueue}
              onQueueChange={(queue) => {
                setActiveQueue(queue);
                setActiveKpiFilter(null);
              }}
              counts={queueCounts}
            />
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ig-fg-subtle" />
              <input
                type="text"
                placeholder="Buscar deliberações..."
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                className="h-9 w-64 rounded-lg border border-ig-border bg-ig-panel px-3 pl-9 text-ig-body-sm text-ig-fg placeholder:text-ig-fg-subtle focus:border-ig-border-focus focus:outline-none focus-visible:shadow-[var(--ig-focus-ring-outer)]"
              />
            </div>
            <HudButton variant="secondary" size="sm" leftIcon={<Filter className="w-4 h-4" />} onClick={() => setShowFilters((value) => !value)}>
              Filtros
            </HudButton>
          </div>

          <HudPanel title="Próxima Sessão" accentColor="amber" noPadding={false}>
            {nextSessionItems.length === 0 ? (
              <p className="text-ig-body-sm text-ig-fg-muted">Sem deliberações para a próxima sessão.</p>
            ) : (
              <div className="space-y-2">
                {nextSessionItems.map((item) => (
                  <div key={item.id} className="text-xs">
                    <p className="line-clamp-1 text-ig-body-sm font-medium text-ig-fg-strong">{item.title}</p>
                    <p className="text-ig-caption text-ig-fg-muted">{item.dueDate ? `${formatDistanceToNowStrict(item.dueDate)} restantes` : 'Sem SLA'} - {item.ownerCommitteeName}</p>
                  </div>
                ))}
              </div>
            )}
          </HudPanel>
        </div>

        {showFilters && (
          <div className="mb-4 flex shrink-0 flex-wrap items-center gap-4 rounded-lg border border-ig-border-subtle bg-ig-panel p-3">
            <div className="flex items-center gap-2">
              <label className="text-ig-caption text-ig-fg-muted">Comitê:</label>
              <select
                value={committeeFilter}
                onChange={(event) => setCommitteeFilter(event.target.value)}
                className="rounded border border-ig-border bg-ig-panel px-2 py-1 text-ig-body-sm text-ig-fg focus:border-ig-border-focus focus:outline-none"
              >
                <option value="all">Todos</option>
                {COMMITTEES.map((committee) => (
                  <option key={committee.id} value={committee.id}>{committee.name}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        <div className="flex-1 min-h-0 grid grid-cols-[minmax(420px,1fr)_minmax(520px,1.4fr)] gap-4">
          <HudPanel noPadding className="h-full overflow-hidden flex flex-col">
            <div className="relative z-[2] border-b border-ig-border-subtle p-3 text-ig-caption text-ig-fg-muted">
              {filteredItems.length} resultados
            </div>
            <div className="flex-1 overflow-y-auto relative z-[2]">
              <DecisionList items={filteredItems} selectedId={selectedId || undefined} onSelectItem={(item) => setSelectedId(item.id)} />
            </div>
          </HudPanel>

          <HudPanel
            className="h-full overflow-hidden"
            serial={selectedItem ? deliberationSerial(selectedItem.id) : undefined}
            watermark="DELIBERATION · INSPECTOR"
          >
            <DecisionInspector
              item={selectedItem}
              currentUserId={CURRENT_USER_ID}
              currentUserName={CURRENT_USER_NAME}
              onStartVoting={handleStartVoting}
              onCastVote={handleCastVote}
              onCloseVoting={handleCloseVoting}
              onGenerateMinutes={handleGenerateMinutes}
              onPublishMinutes={handlePublishMinutes}
              onCreateExecutionTask={handleCreateExecutionTask}
            />
          </HudPanel>
        </div>

        <NewDeliberationModal
          open={newDeliberationOpen}
          onOpenChange={setNewDeliberationOpen}
          onCreateDeliberation={handleCreateDeliberation}
        />
      </div>
    </div>
  );
}
