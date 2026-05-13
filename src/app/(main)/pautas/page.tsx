'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, ArrowRight, FileCheck2, Filter, Layers3, Network, Plus, Search, ShieldCheck } from 'lucide-react';
import { AuditTrailTimeline, BoardHealthKPI, DecisionInspector, DecisionList, EvidencePack, NewDeliberationModal, QueueTabs } from '@/components/deliberacoes';
import { HudPanel, HudButton, HudBadge } from '@/components/hud';
import { AuditTrailEntry, DeliberationItem, DeliberationStageStatus, DeliberationStatus, VoteOption, VoteRecord } from '@/lib/types';
import { COMMITTEES, buildStagePlan, resolveTemplate } from '@/lib/deliberations-policy';
import { deliberationSerial } from '@/lib/utils/serial';
import type { NewDeliberationPayload } from '@/components/deliberacoes/NewDeliberationModal';
import { usePermissions } from '@/hooks/use-permissions';

const CURRENT_USER_ID = 'user-current';
const CURRENT_USER_NAME = 'Membro Corporativo';

const generateAuditEntry = (
  itemId: string,
  action: AuditTrailEntry['action'],
  description: string,
  previousValue?: string,
  newValue?: string,
  timestamp: Date = new Date()
): AuditTrailEntry => ({
  id: `audit-${Date.now()}-${Math.random()}`,
  itemId,
  action,
  description,
  userId: CURRENT_USER_ID,
  userName: CURRENT_USER_NAME,
  previousValue,
  newValue,
  timestamp,
});

const initialItems: DeliberationItem[] = [
  {
    id: 'delib-1',
    title: 'Promoção executiva e ajuste de pacote C-Level',
    description: 'RH solicita aprovação de promoção estratégica com ajuste de remuneração, retenção e expansão de escopo executivo.',
    status: 'under_review',
    type: 'HR',
    priority: 'high',
    createdBy: 'user-hr',
    createdByName: 'Diretoria de RH',
    ownerName: 'Diretoria de RH',
    createdAt: new Date('2026-04-28T10:00:00'),
    updatedAt: new Date('2026-05-04T10:00:00'),
    submittedAt: new Date('2026-04-28T10:00:00'),
    deliberationStatus: 'in_review',
    ownerCommitteeId: 'hr',
    ownerCommitteeName: 'Comitê de RH',
    dependentCommitteeIds: ['finance', 'legal'],
    dependentCommitteeNames: ['Comitê Financeiro', 'Comitê Jurídico'],
    templateId: 'HR_HIRING_APPROVAL',
    templateName: 'Movimentação executiva',
    requestedDecision: 'Aprovar promoção, pacote de retenção e liberação orçamentária vinculada ao plano de sucessão.',
    financialImpact: 620000,
    riskLevel: 'high',
    evidenceComplete: true,
    dueDate: new Date(Date.now() + 36 * 60 * 60 * 1000),
    quorumRequired: 3,
    quorumPresent: 2,
    linkedEntities: [
      { id: 'PPL-2044', label: 'Pessoa: Diretora de Operações', type: 'person' },
      { id: 'CC-RH-EXEC', label: 'Centro de custo executivo', type: 'cost' },
      { id: 'RSK-118', label: 'Risco de retenção crítica', type: 'risk' },
    ],
    attachments: [
      { id: 'att-1', name: 'Parecer RH - plano de sucessão', url: '#', type: 'document' },
      { id: 'att-2', name: 'Simulação orçamentária 2026', url: '#', type: 'document' },
      { id: 'att-3', name: 'Mapa de elegibilidade e conflitos', url: '#', type: 'link' },
    ],
    reviews: [
      { type: 'Finance', status: 'approved', reviewerName: 'Controladoria', reviewedAt: new Date('2026-05-02T15:20:00'), notes: 'Impacto aderente ao orçamento revisado.' },
      { type: 'Legal', status: 'pending', reviewerName: 'Jurídico Trabalhista' },
    ],
    recommendation: 'adjust',
    recommendationNotes: ['Aprovar condicionado à formalização do plano de metas.', 'Registrar conflito de interesse dos membros vinculados à área demandante.'],
    stages: buildStagePlan({
      ownerCommitteeId: 'hr',
      financialImpact: 620000,
      riskLevel: 'high',
      strategicFlag: true,
      outsideBudget: true,
    }),
    currentStageId: 'stage-1-hr',
    votes: [],
    auditTrail: [
      generateAuditEntry('delib-1', 'status_changed', 'Solicitação criada por Diretoria de RH.', 'draft', 'submitted', new Date('2026-04-28T10:00:00')),
      generateAuditEntry('delib-1', 'evidence_added', 'Pacote de evidências anexado: sucessão, orçamento e elegibilidade.', undefined, undefined, new Date('2026-04-29T11:30:00')),
      generateAuditEntry('delib-1', 'review_requested', 'Parecer jurídico trabalhista solicitado.', undefined, undefined, new Date('2026-05-01T09:10:00')),
      generateAuditEntry('delib-1', 'stage_transitioned', 'Revisão do comitê responsável iniciada no Comitê de RH.', undefined, undefined, new Date('2026-05-04T10:00:00')),
    ],
    executionItems: [],
  },
  {
    id: 'delib-2',
    title: 'CAPEX para infraestrutura de IA operacional',
    description: 'Engenharia propõe investimento em infraestrutura de IA para otimização de rede, disponibilidade e automação operacional.',
    status: 'under_review',
    type: 'Financial',
    priority: 'critical',
    createdBy: 'user-rnd',
    createdByName: 'VP de Engenharia',
    ownerName: 'VP de Engenharia',
    createdAt: new Date('2026-04-30T08:30:00'),
    updatedAt: new Date('2026-05-04T09:30:00'),
    submittedAt: new Date('2026-04-30T08:30:00'),
    deliberationStatus: 'in_voting',
    ownerCommitteeId: 'finance',
    ownerCommitteeName: 'Comitê Financeiro',
    dependentCommitteeIds: ['risk', 'rnd'],
    dependentCommitteeNames: ['Comitê de Riscos', 'Comitê de Engenharia / P&D'],
    templateId: 'FINANCE_CAPEX_APPROVAL',
    templateName: 'Aprovação de CAPEX',
    requestedDecision: 'Aprovar alocação de CAPEX, fonte de financiamento e controles de execução do programa.',
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
      { id: 'vote-1', itemId: 'delib-2', voterId: 'user-1', voterName: 'CFO', vote: 'yes', justification: 'ROI e mitigadores estão aderentes.', hasConflictOfInterest: false, votedAt: new Date(Date.now() - 5 * 60 * 60 * 1000) },
      { id: 'vote-2', itemId: 'delib-2', voterId: CURRENT_USER_ID, voterName: CURRENT_USER_NAME, vote: 'abstain', hasConflictOfInterest: false, votedAt: new Date() },
      { id: 'vote-3', itemId: 'delib-2', voterId: 'user-3', voterName: 'Diretoria de Operações', vote: 'yes', hasConflictOfInterest: false, votedAt: new Date(Date.now() - 2 * 60 * 60 * 1000) },
    ],
    linkedEntities: [
      { id: 'PRJ-AI-014', label: 'Projeto IA Operacional', type: 'project', href: '/projetos' },
      { id: 'CAPEX-2026-08', label: 'Budget CAPEX 2026', type: 'cost' },
      { id: 'RSK-229', label: 'Risco tecnológico crítico', type: 'risk', href: '/riscos' },
    ],
    attachments: [
      { id: 'att-4', name: 'Business case CAPEX + ROI', url: '#', type: 'document' },
      { id: 'att-5', name: 'Parecer de segurança e risco', url: '#', type: 'document' },
      { id: 'att-6', name: 'Arquitetura alvo e fornecedores', url: '#', type: 'link' },
    ],
    reviews: [
      { type: 'Finance', status: 'approved', reviewerName: 'Controladoria', reviewedAt: new Date('2026-05-03T17:40:00'), notes: 'CAPEX reclassificado e aprovado para votação.' },
      { type: 'Compliance', status: 'approved', reviewerName: 'Comitê de Riscos', reviewedAt: new Date('2026-05-04T08:20:00'), notes: 'Risco residual aceito com controles.' },
    ],
    recommendation: 'approve',
    recommendationNotes: ['Quórum atingido.', 'Próxima ação: encerrar votação e publicar ata após validação da Diretoria.'],
    auditTrail: [
      generateAuditEntry('delib-2', 'status_changed', 'Solicitação submetida ao Comitê Financeiro.', 'draft', 'submitted', new Date('2026-04-30T08:30:00')),
      generateAuditEntry('delib-2', 'review_requested', 'Revisões de risco e engenharia adicionadas ao fluxo.', undefined, undefined, new Date('2026-05-02T10:00:00')),
      generateAuditEntry('delib-2', 'voting_started', 'Janela de votação aberta no Comitê Financeiro.', undefined, undefined, new Date(Date.now() - 6 * 60 * 60 * 1000)),
      generateAuditEntry('delib-2', 'vote_cast', 'Voto registrado por CFO: SIM.', undefined, undefined, new Date(Date.now() - 5 * 60 * 60 * 1000)),
      generateAuditEntry('delib-2', 'vote_cast', 'Voto registrado por Membro Corporativo: ABSTENÇÃO.', undefined, undefined, new Date()),
    ],
    executionItems: [],
  },
  {
    id: 'delib-3',
    title: 'Renovação de contrato estratégico com cláusula atípica',
    description: 'Jurídico e Comercial solicitam autorização para renovação contratual de alto valor com exceção de responsabilidade limitada.',
    status: 'approved',
    type: 'Legal',
    priority: 'high',
    createdBy: 'user-legal',
    createdByName: 'Operações Jurídicas',
    ownerName: 'Operações Jurídicas',
    createdAt: new Date('2026-04-22T09:00:00'),
    updatedAt: new Date('2026-05-03T17:00:00'),
    submittedAt: new Date('2026-04-22T09:00:00'),
    deliberationStatus: 'awaiting_minutes',
    ownerCommitteeId: 'legal',
    ownerCommitteeName: 'Comitê Jurídico',
    dependentCommitteeIds: ['finance'],
    dependentCommitteeNames: ['Comitê Financeiro'],
    templateId: 'LEGAL_MATERIAL_DECISION',
    templateName: 'Contrato material',
    requestedDecision: 'Aprovar renovação contratual, exceção de responsabilidade e plano de mitigação jurídico-financeiro.',
    financialImpact: 5400000,
    riskLevel: 'high',
    evidenceComplete: true,
    dueDate: new Date(Date.now() + 52 * 60 * 60 * 1000),
    quorumRequired: 4,
    quorumPresent: 4,
    stages: buildStagePlan({
      ownerCommitteeId: 'legal',
      financialImpact: 5400000,
      riskLevel: 'high',
      materialFinancialImpact: true,
      materialLegalSensitivity: true,
      highTicket: true,
    }).map((stage) => ({
      ...stage,
      status: stage.stageType === 'publish_minutes' ? 'active' : 'completed',
      closedAt: stage.stageType === 'publish_minutes' ? undefined : new Date('2026-05-03T17:00:00'),
    })),
    currentStageId: 'stage-4-legal',
    votingStartedAt: new Date('2026-05-02T09:00:00'),
    votingClosedAt: new Date('2026-05-03T17:00:00'),
    voteResult: 'approved',
    votes: [
      { id: 'vote-4', itemId: 'delib-3', voterId: 'user-4', voterName: 'Diretoria Jurídica', vote: 'yes', hasConflictOfInterest: false, votedAt: new Date('2026-05-03T11:00:00') },
      { id: 'vote-5', itemId: 'delib-3', voterId: 'user-5', voterName: 'CFO', vote: 'yes', hasConflictOfInterest: false, votedAt: new Date('2026-05-03T12:30:00') },
      { id: 'vote-6', itemId: 'delib-3', voterId: 'user-6', voterName: 'Diretoria Comercial', vote: 'yes', hasConflictOfInterest: true, votedAt: new Date('2026-05-03T15:20:00') },
      { id: 'vote-7', itemId: 'delib-3', voterId: 'user-7', voterName: 'Comitê de Riscos', vote: 'abstain', hasConflictOfInterest: false, votedAt: new Date('2026-05-03T16:10:00') },
    ],
    linkedEntities: [
      { id: 'CON-92811', label: 'Contrato CHESF 2026', type: 'contract', href: '/contratos' },
      { id: 'PRJ-COM-044', label: 'Conta estratégica Nordeste', type: 'project', href: '/projetos' },
      { id: 'RSK-187', label: 'Exposição contratual atípica', type: 'risk', href: '/riscos' },
    ],
    attachments: [
      { id: 'att-7', name: 'Minuta contratual redline', url: '#', type: 'document' },
      { id: 'att-8', name: 'Parecer jurídico de exceção', url: '#', type: 'document' },
      { id: 'att-9', name: 'Análise de margem e exposição', url: '#', type: 'document' },
    ],
    reviews: [
      { type: 'Legal', status: 'approved', reviewerName: 'Diretoria Jurídica', reviewedAt: new Date('2026-05-02T16:00:00'), notes: 'Exceção aceita com controles adicionais.' },
      { type: 'Finance', status: 'approved', reviewerName: 'CFO', reviewedAt: new Date('2026-05-02T17:10:00'), notes: 'Margem preservada no cenário base.' },
      { type: 'Compliance', status: 'approved', reviewerName: 'Compliance', reviewedAt: new Date('2026-05-03T09:30:00'), notes: 'Sem restrição regulatória impeditiva.' },
    ],
    recommendation: 'approve',
    recommendationNotes: ['Ata pendente de publicação.', 'Após publicação, criar tarefa para assinatura e controle de cláusulas.'],
    minutesSummary: 'Minuta de Ata:\nResolução aprovada pelos comitês necessários e pela etapa final do Conselho.\nAções criadas para contrato e controles de risco.',
    minutes: {
      status: 'draft',
      agendaSummary: 'Renovação contratual material com exceção jurídica.',
      evidenceList: ['Proposta Comercial', 'Avaliação de Risco', 'Memorando de Desvio Jurídico'],
      votingResult: 'Sim 3 / Não 0 / Abstenção 1',
      decisionText: 'Resolvido Aprovado',
      actionItems: ['Finalizar termos do contrato', 'Vincular controles de risco'],
    },
    auditTrail: [
      generateAuditEntry('delib-3', 'review_requested', 'Parecer jurídico e financeiro anexados.', undefined, undefined, new Date('2026-05-02T16:00:00')),
      generateAuditEntry('delib-3', 'voting_started', 'Janela de votação aberta para Comitê Jurídico.', undefined, undefined, new Date('2026-05-02T09:00:00')),
      generateAuditEntry('delib-3', 'voting_closed', 'Votação encerrada: aprovado com quórum qualificado.', undefined, undefined, new Date('2026-05-03T17:00:00')),
      generateAuditEntry('delib-3', 'decision_issued', 'Decisão final emitida: Resolvido Aprovado.', undefined, undefined, new Date('2026-05-03T17:05:00')),
      generateAuditEntry('delib-3', 'minutes_generated', 'Minuta de ata gerada pelo secretário do comitê.', undefined, undefined, new Date('2026-05-03T17:20:00')),
    ],
    executionItems: [],
  },
  {
    id: 'delib-4',
    title: 'Kickoff do projeto de integração Sankhya',
    description: 'Operações solicita liberação de kickoff, donos de execução, prazos e controles para implantação corporativa.',
    status: 'approved',
    type: 'Operational',
    priority: 'medium',
    createdBy: 'user-ops',
    createdByName: 'PMO Corporativo',
    ownerName: 'PMO Corporativo',
    createdAt: new Date('2026-04-12T14:00:00'),
    updatedAt: new Date('2026-05-01T13:00:00'),
    submittedAt: new Date('2026-04-12T14:00:00'),
    resolvedAt: new Date('2026-04-30T18:00:00'),
    deliberationStatus: 'in_execution',
    ownerCommitteeId: 'operations',
    ownerCommitteeName: 'Comitê de Operações',
    dependentCommitteeIds: ['finance'],
    dependentCommitteeNames: ['Comitê Financeiro'],
    templateId: 'OPS_KICKOFF_CLOSURE',
    templateName: 'Kickoff operacional',
    requestedDecision: 'Aprovar kickoff, RACI executivo, janela de implantação e pacote mínimo de controles.',
    financialImpact: 1450000,
    riskLevel: 'medium',
    evidenceComplete: true,
    dueDate: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000),
    quorumRequired: 3,
    quorumPresent: 3,
    stages: buildStagePlan({
      ownerCommitteeId: 'operations',
      financialImpact: 1450000,
      riskLevel: 'medium',
      strategicFlag: true,
    }).map((stage) => ({
      ...stage,
      status: stage.stageType === 'execution' ? 'active' : 'completed',
      closedAt: stage.stageType === 'execution' ? undefined : new Date('2026-04-30T18:00:00'),
    })),
    currentStageId: 'stage-5-operations',
    votingStartedAt: new Date('2026-04-28T09:00:00'),
    votingClosedAt: new Date('2026-04-30T18:00:00'),
    voteResult: 'approved',
    votes: [
      { id: 'vote-8', itemId: 'delib-4', voterId: 'user-8', voterName: 'COO', vote: 'yes', hasConflictOfInterest: false, votedAt: new Date('2026-04-29T10:00:00') },
      { id: 'vote-9', itemId: 'delib-4', voterId: 'user-9', voterName: 'PMO', vote: 'yes', hasConflictOfInterest: false, votedAt: new Date('2026-04-29T11:00:00') },
      { id: 'vote-10', itemId: 'delib-4', voterId: 'user-10', voterName: 'Controladoria', vote: 'yes', hasConflictOfInterest: false, votedAt: new Date('2026-04-29T13:00:00') },
    ],
    linkedEntities: [
      { id: 'PRJ-SNK-001', label: 'Projeto Integração Sankhya', type: 'project', href: '/projetos' },
      { id: 'MTG-083', label: 'Reunião de kickoff executivo', type: 'meeting', href: '/reunioes' },
      { id: 'RSK-162', label: 'Risco de migração financeira', type: 'risk', href: '/riscos' },
    ],
    attachments: [
      { id: 'att-10', name: 'Plano de implantação e RACI', url: '#', type: 'document' },
      { id: 'att-11', name: 'Plano de contingência operacional', url: '#', type: 'document' },
    ],
    reviews: [
      { type: 'Finance', status: 'approved', reviewerName: 'Controladoria', reviewedAt: new Date('2026-04-27T16:30:00'), notes: 'Budget liberado em duas tranches.' },
      { type: 'Compliance', status: 'approved', reviewerName: 'Riscos Operacionais', reviewedAt: new Date('2026-04-27T17:20:00'), notes: 'Controles mínimos aceitos.' },
    ],
    recommendation: 'approve',
    recommendationNotes: ['Executar kickoff até o fim da semana.', 'Reportar progresso no comitê operacional semanal.'],
    minutes: {
      status: 'published',
      agendaSummary: 'Kickoff operacional aprovado.',
      evidenceList: ['Plano de implantação e RACI', 'Plano de contingência operacional'],
      votingResult: 'Sim 3 / Não 0 / Abstenção 0',
      decisionText: 'Resolvido Aprovado',
      actionItems: ['Abrir projeto', 'Designar donos de frente', 'Publicar cronograma executivo'],
      publishedAt: new Date('2026-05-01T09:00:00'),
    },
    auditTrail: [
      generateAuditEntry('delib-4', 'decision_issued', 'Kickoff aprovado pelo Comitê de Operações.', undefined, undefined, new Date('2026-04-30T18:00:00')),
      generateAuditEntry('delib-4', 'minutes_published', 'Ata publicada e etapa de execução ativada.', undefined, undefined, new Date('2026-05-01T09:00:00')),
      generateAuditEntry('delib-4', 'execution_task_created', 'Ação criada: abrir projeto e publicar cronograma executivo.', undefined, undefined, new Date('2026-05-01T13:00:00')),
    ],
    executionItems: [
      { id: 'act-1', title: 'Abrir projeto e publicar cronograma executivo', ownerName: 'PMO Corporativo', dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), status: 'in_progress', linkedEntityType: 'project', linkedEntityId: 'PRJ-SNK-001' },
      { id: 'act-2', title: 'Vincular controle de migração financeira', ownerName: 'Riscos Operacionais', dueDate: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000), status: 'pending', linkedEntityType: 'risk', linkedEntityId: 'RSK-162' },
    ],
  },
  {
    id: 'delib-5',
    title: 'Encerramento de projeto comercial legado',
    description: 'Comercial solicita encerramento controlado de projeto com baixa margem, aceite final e arquivo auditável.',
    status: 'approved',
    type: 'Sales',
    priority: 'low',
    createdBy: 'user-sales',
    createdByName: 'Diretoria Comercial',
    ownerName: 'Diretoria Comercial',
    createdAt: new Date('2026-03-20T09:00:00'),
    updatedAt: new Date('2026-04-10T17:00:00'),
    submittedAt: new Date('2026-03-20T09:00:00'),
    resolvedAt: new Date('2026-04-10T17:00:00'),
    deliberationStatus: 'closed',
    ownerCommitteeId: 'sales',
    ownerCommitteeName: 'Comitê Comercial',
    templateId: 'SALES_PROJECT_APPROVAL',
    templateName: 'Encerramento comercial',
    requestedDecision: 'Aprovar encerramento do projeto, baixa de pendências e publicação do histórico decisório.',
    financialImpact: 980000,
    riskLevel: 'low',
    evidenceComplete: true,
    quorumRequired: 3,
    quorumPresent: 3,
    stages: buildStagePlan({
      ownerCommitteeId: 'sales',
      financialImpact: 980000,
      riskLevel: 'low',
      marginPercent: 17,
    }).map((stage) => ({ ...stage, status: 'completed', closedAt: new Date('2026-04-10T17:00:00') })),
    currentStageId: 'stage-4-sales',
    votingStartedAt: new Date('2026-04-08T09:00:00'),
    votingClosedAt: new Date('2026-04-10T17:00:00'),
    voteResult: 'approved',
    linkedEntities: [
      { id: 'PRJ-LEG-309', label: 'Projeto legado encerrado', type: 'project', href: '/projetos' },
      { id: 'CON-48120', label: 'Termo de encerramento', type: 'contract', href: '/contratos' },
    ],
    attachments: [
      { id: 'att-12', name: 'Termo de aceite final', url: '#', type: 'document' },
      { id: 'att-13', name: 'Relatório financeiro de encerramento', url: '#', type: 'document' },
    ],
    reviews: [
      { type: 'Finance', status: 'approved', reviewerName: 'Controladoria', reviewedAt: new Date('2026-04-09T14:40:00'), notes: 'Baixa financeira conciliada.' },
      { type: 'Legal', status: 'approved', reviewerName: 'Operações Jurídicas', reviewedAt: new Date('2026-04-09T16:20:00'), notes: 'Termo de encerramento válido.' },
    ],
    minutes: {
      status: 'published',
      agendaSummary: 'Encerramento controlado de projeto legado.',
      evidenceList: ['Termo de aceite final', 'Relatório financeiro de encerramento'],
      votingResult: 'Sim 3 / Não 0 / Abstenção 0',
      decisionText: 'Encerrado e arquivado',
      actionItems: ['Arquivar projeto', 'Vincular termo final'],
      publishedAt: new Date('2026-04-11T10:00:00'),
    },
    auditTrail: [
      generateAuditEntry('delib-5', 'voting_closed', 'Votação encerrada com aprovação unânime.', undefined, undefined, new Date('2026-04-10T17:00:00')),
      generateAuditEntry('delib-5', 'minutes_published', 'Ata publicada e arquivo auditável concluído.', undefined, undefined, new Date('2026-04-11T10:00:00')),
      generateAuditEntry('delib-5', 'status_changed', 'Decisão encerrada e arquivada.', 'in_execution', 'closed', new Date('2026-04-14T10:00:00')),
    ],
    executionItems: [
      { id: 'act-3', title: 'Arquivar documentação final do projeto', ownerName: 'PMO Comercial', dueDate: new Date('2026-04-14T10:00:00'), status: 'completed', linkedEntityType: 'project', linkedEntityId: 'PRJ-LEG-309' },
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

export default function CommitteesPage() {
  const { hasPermission, loading: permissionsLoading } = usePermissions();
  const [items, setItems] = useState<DeliberationItem[]>(initialItems);
  const [selectedId, setSelectedId] = useState<string | null>(initialItems[0]?.id ?? null);
  const [activeQueue, setActiveQueue] = useState<DeliberationStatus>('in_review');
  const [activeKpiFilter, setActiveKpiFilter] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [committeeFilter, setCommitteeFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [slaFilter, setSlaFilter] = useState('all');
  const [ownerFilter, setOwnerFilter] = useState('all');
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
    } else if (['in_review', 'awaiting_minutes', 'in_execution'].includes(activeKpiFilter ?? '')) {
      result = result.filter((item) => item.deliberationStatus === activeKpiFilter);
    } else if (activeKpiFilter === 'in_voting') {
      result = result.filter((item) => item.deliberationStatus === 'in_voting');
    } else if (activeKpiFilter === 'overdue') {
      result = result.filter((item) => item.dueDate && item.dueDate.getTime() < nowTs);
    } else if (activeKpiFilter === 'resolved_30d') {
      const windowMs = 30 * 24 * 60 * 60 * 1000;
      result = result.filter((item) => item.resolvedAt && nowTs - item.resolvedAt.getTime() <= windowMs);
    } else if (activeKpiFilter === 'avg_resolution') {
      result = result.filter((item) => item.resolvedAt);
    } else if (activeKpiFilter === 'avg_sla') {
      result = result.filter((item) => item.dueDate);
    } else {
      result = result.filter((item) => item.deliberationStatus === activeQueue);
    }

    if (committeeFilter !== 'all') result = result.filter((item) => item.ownerCommitteeId === committeeFilter);
    if (priorityFilter !== 'all') result = result.filter((item) => item.priority === priorityFilter);
    if (ownerFilter !== 'all') result = result.filter((item) => (item.ownerName || item.createdByName || item.createdBy) === ownerFilter);
    if (slaFilter === '24h') result = result.filter((item) => item.dueDate && item.dueDate.getTime() - nowTs <= 24 * 60 * 60 * 1000);
    if (slaFilter === 'overdue') result = result.filter((item) => item.dueDate && item.dueDate.getTime() < nowTs);
    if (slaFilter === 'week') result = result.filter((item) => item.dueDate && item.dueDate.getTime() - nowTs <= 7 * 24 * 60 * 60 * 1000);
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter((item) =>
        item.title.toLowerCase().includes(term) ||
        item.description.toLowerCase().includes(term) ||
        item.ownerCommitteeName?.toLowerCase().includes(term) ||
        item.linkedEntities?.some((entity) => entity.label.toLowerCase().includes(term))
      );
    }
    return result;
  }, [items, activeQueue, activeKpiFilter, committeeFilter, priorityFilter, ownerFilter, slaFilter, searchTerm, nowTs]);

  const nextSessionItems = useMemo(() => {
    return [...items]
      .filter((item) => item.deliberationStatus === 'in_review' || item.deliberationStatus === 'submitted')
      .sort((a, b) => (a.dueDate?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.dueDate?.getTime() ?? Number.MAX_SAFE_INTEGER))
      .slice(0, 3);
  }, [items]);

  const ownerOptions = useMemo(() => {
    return Array.from(new Set(items.map((item) => item.ownerName || item.createdByName || item.createdBy))).filter(Boolean);
  }, [items]);

  const auditEventsCount = useMemo(() => items.reduce((total, item) => total + (item.auditTrail?.length ?? 0), 0), [items]);

  const overdueCount = useMemo(() => {
    return items.filter((item) => item.dueDate && item.dueDate.getTime() < nowTs).length;
  }, [items, nowTs]);

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
        auditTrail: [generateAuditEntry(itemId, 'vote_cast', `Voto registrado: ${vote.toUpperCase()}`), ...(item.auditTrail || [])],
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
        `Resumo executivo: ${item.title}`,
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
    const newItemId = `delib-${Date.now()}`;
    const newItem: DeliberationItem = {
      id: newItemId,
      title: payload.title,
      description: payload.description,
      status: 'under_review',
      type: payload.businessArea,
      priority: payload.riskLevel === 'critical' ? 'critical' : payload.riskLevel === 'high' ? 'high' : 'medium',
      createdBy: CURRENT_USER_ID,
      createdByName: CURRENT_USER_NAME,
      ownerName: CURRENT_USER_NAME,
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
        generateAuditEntry(newItemId, 'status_changed', 'Decisão submetida e roteada pela política de comitês.', 'draft', 'submitted'),
        generateAuditEntry(newItemId, 'stage_transitioned', `Comitê responsável definido: ${payload.ownerCommitteeName}.`),
      ],
      executionItems: [],
    };
    setItems((previous) => [newItem, ...previous]);
    setSelectedId(newItem.id);
  }, []);

  const selectedCommittee = selectedItem?.ownerCommitteeName ?? 'Comitê não selecionado';
  const selectedQuorumRequired = selectedItem?.quorumRequired ?? 0;
  const selectedQuorumPresent = selectedItem?.quorumPresent ?? selectedItem?.votes?.length ?? 0;
  const selectedQuorumReached = selectedQuorumRequired > 0 && selectedQuorumPresent >= selectedQuorumRequired;
  const openCriticalCount = items.filter((item) => item.priority === 'critical' && !['closed', 'resolved'].includes(item.deliberationStatus)).length;
  const filterControlClass = 'h-9 rounded-lg border border-ig-border-subtle !bg-[color:var(--ig-bg-panel)] px-3 text-xs font-medium !text-[color:var(--ig-fg-strong)] outline-none transition-colors focus:border-ig-border-focus focus:shadow-[var(--ig-focus-ring-outer)]';

  return (
    <div className="min-h-full h-screen overflow-hidden p-4 md:p-6">
      <div className="mx-auto flex h-full max-w-[1920px] flex-col">
        <header className="shrink-0">
          <div className="relative overflow-hidden rounded-[var(--ig-radius-xl)] border border-ig-border-subtle bg-[linear-gradient(135deg,color-mix(in_oklab,var(--ig-bg-panel)_90%,transparent),color-mix(in_oklab,var(--ig-bg-raised)_52%,transparent))] p-4 shadow-[var(--ig-shadow-e2),inset_0_1px_0_color-mix(in_oklab,var(--ig-border-strong)_58%,transparent)]">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-ig-border-focus to-transparent opacity-70" />
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <div className="ig-icon-jewel flex h-11 w-11 shrink-0 items-center justify-center text-ig-accent">
                  <Network className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-ig-h1 font-semibold ig-text-metal">Comitês</h1>
                    <HudBadge variant="info" size="sm" dot>Decision Control Room</HudBadge>
                  </div>
                  <p className="mt-1 max-w-3xl text-ig-body-sm text-ig-fg-muted">
                    Central de decisões e aprovações corporativas: revisão, pareceres, votação, ata, execução e auditoria em um único fluxo.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                <div className="rounded-lg border border-ig-border-subtle bg-ig-panel/70 px-3 py-2">
                  <p className="text-[9px] uppercase tracking-[0.16em] text-ig-fg-subtle">Auditoria</p>
                  <p className="mt-0.5 text-sm font-semibold text-ig-fg-strong tabular-nums">{auditEventsCount} eventos</p>
                </div>
                <div className="rounded-lg border border-ig-border-subtle bg-ig-panel/70 px-3 py-2">
                  <p className="text-[9px] uppercase tracking-[0.16em] text-ig-fg-subtle">Críticas abertas</p>
                  <p className="mt-0.5 text-sm font-semibold text-ig-danger tabular-nums">{openCriticalCount}</p>
                </div>
                <HudButton variant="primary" size="md" leftIcon={<Plus className="w-4 h-4" />} onClick={() => setNewDeliberationOpen(true)}>
                  Nova decisão
                </HudButton>
              </div>
            </div>

            <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
              <div className="flex items-center gap-1 overflow-x-auto pb-1 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-ig-border">
                {[
                  { label: 'Rascunho', active: activeQueue === 'draft' },
                  { label: 'Submetidas', active: activeQueue === 'submitted' },
                  { label: 'Em Revisão', active: activeQueue === 'in_review' },
                  { label: 'Em Votação', active: activeQueue === 'in_voting' },
                  { label: 'Aguardando Ata', active: activeQueue === 'awaiting_minutes' },
                  { label: 'Em Execução', active: activeQueue === 'in_execution' },
                  { label: 'Encerradas', active: activeQueue === 'closed' },
                ].map((step, i, arr) => (
                  <div key={step.label} className="flex shrink-0 items-center gap-1">
                    <span className={[
                      'rounded-full border px-3 py-1 text-[11px] font-semibold transition-all',
                      step.active
                        ? 'border-ig-border-focus bg-ig-accent-weak text-ig-accent shadow-[0_0_18px_color-mix(in_oklab,var(--ig-accent)_10%,transparent)]'
                        : 'border-ig-border-subtle bg-ig-panel/45 text-ig-fg-subtle',
                    ].join(' ')}>
                      {step.label}
                    </span>
                    {i < arr.length - 1 && <ArrowRight className="h-3 w-3 shrink-0 text-ig-fg-subtle opacity-40" />}
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-2 rounded-lg border border-ig-border-subtle bg-ig-panel/60 px-3 py-2 text-xs text-ig-fg-muted">
                <ShieldCheck className="h-4 w-4 text-ig-success" />
                <span className="font-medium text-ig-fg-strong">100% rastreável</span>
                <span className="text-ig-fg-subtle">quórum, votos, pareceres e execução</span>
              </div>
            </div>
          </div>
        </header>

        <div className="mt-4 shrink-0">
          <BoardHealthKPI items={items} activeFilter={activeKpiFilter} onFilterClick={setActiveKpiFilter} />
        </div>

        <section className="mt-4 shrink-0 rounded-xl border border-ig-border-subtle bg-ig-panel/45 p-3 shadow-[inset_0_1px_0_color-mix(in_oklab,var(--ig-border-strong)_42%,transparent)]">
          <div className="flex flex-wrap items-center gap-2">
            <div className="mr-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-ig-fg-subtle">
              <Filter className="h-3.5 w-3.5" />
              Fila de Decisão
            </div>
            <div className="relative min-w-[16rem] flex-1 sm:max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ig-fg-subtle" />
              <input
                type="text"
                placeholder="Buscar decisões, pareceres ou entidades..."
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                className="h-9 w-full rounded-lg border border-ig-border-subtle !bg-[color:var(--ig-bg-panel)] px-3 pl-9 text-xs font-medium !text-[color:var(--ig-fg-strong)] placeholder:text-ig-fg-subtle focus:border-ig-border-focus focus:outline-none focus-visible:shadow-[var(--ig-focus-ring-outer)]"
              />
            </div>
            <select value={committeeFilter} onChange={(event) => setCommitteeFilter(event.target.value)} className={filterControlClass} aria-label="Filtrar por comitê">
              <option value="all">Todos os comitês</option>
              {COMMITTEES.map((committee) => (
                <option key={committee.id} value={committee.id}>{committee.name}</option>
              ))}
            </select>
            <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)} className={filterControlClass} aria-label="Filtrar por prioridade">
              <option value="all">Todas as prioridades</option>
              <option value="critical">Crítica</option>
              <option value="high">Alta</option>
              <option value="medium">Média</option>
              <option value="low">Baixa</option>
            </select>
            <select value={slaFilter} onChange={(event) => setSlaFilter(event.target.value)} className={filterControlClass} aria-label="Filtrar por SLA">
              <option value="all">SLA: todos</option>
              <option value="24h">SLA até 24h</option>
              <option value="week">SLA até 7 dias</option>
              <option value="overdue">Atrasadas</option>
            </select>
            <select value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)} className={filterControlClass} aria-label="Filtrar por responsável">
              <option value="all">Todos os responsáveis</option>
              {ownerOptions.map((owner) => (
                <option key={owner} value={owner}>{owner}</option>
              ))}
            </select>
          </div>
        </section>

        <div className="mt-4 min-h-0 flex-1 grid gap-4 xl:grid-cols-[minmax(330px,0.9fr)_minmax(520px,1.35fr)_minmax(300px,0.72fr)]">
          <HudPanel noPadding className="flex min-h-0 flex-col overflow-hidden" sweep>
            <div className="relative z-[2] border-b border-ig-border-subtle px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ig-fg-subtle">Committee Queue</p>
                  <p className="mt-0.5 text-sm font-semibold text-ig-fg-strong">Fila de Decisão</p>
                </div>
                <div className="flex items-center gap-2">
                  <HudBadge variant={overdueCount > 0 ? 'danger' : 'success'} size="sm" dot>{overdueCount} atrasadas</HudBadge>
                  {activeKpiFilter && (
                    <button
                      onClick={() => setActiveKpiFilter(null)}
                      className="rounded-md border border-ig-border-subtle px-2 py-1 text-[10px] font-semibold text-ig-accent transition-colors hover:bg-ig-accent-weak"
                    >
                      Limpar KPI
                    </button>
                  )}
                </div>
              </div>
              <div className="mt-3">
                <QueueTabs
                  activeQueue={activeQueue}
                  onQueueChange={(queue) => {
                    setActiveQueue(queue);
                    setActiveKpiFilter(null);
                  }}
                  counts={queueCounts}
                />
              </div>
            </div>
            <div className="relative z-[2] flex-1 overflow-y-auto">
              <DecisionList items={filteredItems} selectedId={selectedId || undefined} onSelectItem={(item) => setSelectedId(item.id)} />
            </div>
          </HudPanel>

          <HudPanel
            className="min-h-0 overflow-hidden"
            serial={selectedItem ? deliberationSerial(selectedItem.id) : undefined}
            watermark="COMMITTEE · DECISION ENGINE"
            metallic
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
              canVote={!permissionsLoading && hasPermission('deliberations.vote')}
              canApprove={!permissionsLoading && hasPermission('deliberations.approve')}
            />
          </HudPanel>

          <div className="hidden min-h-0 flex-col gap-4 xl:flex">
            <HudPanel title="Audit Core" subtitle={selectedCommittee} icon={<Activity className="h-4 w-4" />} className="min-h-0 flex-[1.15] overflow-hidden" noPadding>
              <div className="relative z-[2] flex h-full flex-col">
                <div className="grid grid-cols-3 border-b border-ig-border-subtle text-center">
                  <div className="px-2 py-3">
                    <p className="text-[9px] uppercase tracking-[0.14em] text-ig-fg-subtle">Quórum</p>
                    <p className={['mt-1 text-sm font-semibold tabular-nums', selectedQuorumReached ? 'text-ig-success' : 'text-ig-warning'].join(' ')}>
                      {selectedQuorumPresent}/{selectedQuorumRequired || '-'}
                    </p>
                  </div>
                  <div className="border-x border-ig-border-subtle px-2 py-3">
                    <p className="text-[9px] uppercase tracking-[0.14em] text-ig-fg-subtle">Pareceres</p>
                    <p className="mt-1 text-sm font-semibold text-ig-fg-strong tabular-nums">{selectedItem?.reviews?.length ?? 0}</p>
                  </div>
                  <div className="px-2 py-3">
                    <p className="text-[9px] uppercase tracking-[0.14em] text-ig-fg-subtle">Evidências</p>
                    <p className="mt-1 text-sm font-semibold text-ig-fg-strong tabular-nums">{selectedItem?.attachments?.length ?? 0}</p>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto px-4 py-4">
                  {selectedItem ? (
                    <AuditTrailTimeline entries={selectedItem.auditTrail || []} maxVisible={8} />
                  ) : (
                    <div className="flex h-full items-center justify-center text-center text-sm text-ig-fg-muted">Selecione uma decisão.</div>
                  )}
                </div>
              </div>
            </HudPanel>

            <HudPanel title="Evidências & Execução" subtitle="Documentos, vínculos e próximos atos" icon={<FileCheck2 className="h-4 w-4" />} className="min-h-0 flex-1 overflow-hidden" noPadding>
              <div className="relative z-[2] h-full overflow-y-auto px-4 py-4">
                {selectedItem ? (
                  <div className="space-y-4">
                    <EvidencePack attachments={selectedItem.attachments} evidenceComplete={selectedItem.evidenceComplete} />
                    <div className="space-y-2">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ig-fg-subtle">Entidades Vinculadas</p>
                      {(selectedItem.linkedEntities ?? []).map((entity) => (
                        <div key={entity.id} className="flex items-center justify-between rounded-lg border border-ig-border-subtle bg-ig-panel/55 px-3 py-2">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-semibold text-ig-fg-strong">{entity.label}</p>
                            <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ig-fg-subtle">{entity.id}</p>
                          </div>
                          <HudBadge variant="info" size="sm">{entity.type}</HudBadge>
                        </div>
                      ))}
                    </div>
                    <div className="rounded-lg border border-ig-border-subtle bg-ig-panel/55 p-3">
                      <div className="flex items-center gap-2">
                        <Layers3 className="h-4 w-4 text-ig-accent" />
                        <p className="text-xs font-semibold text-ig-fg-strong">Próxima sessão</p>
                      </div>
                      <div className="mt-3 space-y-2">
                        {nextSessionItems.length > 0 ? nextSessionItems.map((item) => (
                          <button key={item.id} onClick={() => setSelectedId(item.id)} className="block w-full rounded-md border border-ig-border-subtle bg-ig-panel/50 px-2 py-2 text-left transition-colors hover:border-ig-border-focus hover:bg-ig-panel-hover">
                            <p className="truncate text-xs font-medium text-ig-fg-strong">{item.title}</p>
                            <p className="mt-0.5 text-[10px] text-ig-fg-muted">{item.ownerCommitteeName}</p>
                          </button>
                        )) : (
                          <p className="text-xs text-ig-fg-muted">Sem itens em revisão para a próxima sessão.</p>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center text-center text-sm text-ig-fg-muted">Nenhuma decisão selecionada.</div>
                )}
              </div>
            </HudPanel>
          </div>
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
