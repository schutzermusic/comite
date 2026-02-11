'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { DeliberationItem } from '@/lib/types';
import { StatusPill } from '@/components/ui/status-pill';
import { AlertTriangle, CheckCircle2, Clock, DollarSign, FileCheck, FileX } from 'lucide-react';
import { differenceInDays, differenceInHours, format } from 'date-fns';
import { pt } from 'date-fns/locale';

interface DecisionListProps {
  items: DeliberationItem[];
  selectedId?: string;
  onSelectItem: (item: DeliberationItem) => void;
}

const translateStatus = (status: string): string => {
  const translations: Record<string, string> = {
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
  return translations[status] ?? status;
};

const getStatusVariant = (status: string): string => {
  const map: Record<string, string> = {
    draft: 'neutral',
    submitted: 'info',
    in_review: 'warning',
    in_voting: 'info',
    awaiting_minutes: 'warning',
    resolved: 'success',
    in_execution: 'warning',
    closed: 'neutral',
    returned_for_revision: 'error',
    withdrawn: 'neutral',
  };
  return map[status] ?? 'neutral';
};

const getRiskColor = (level?: string): string => {
  if (level === 'critical' || level === 'high') return '#FF5860';
  if (level === 'medium') return '#FFB04D';
  return '#00FFB4';
};

const getMyVoteLabel = (item: DeliberationItem): string => {
  const myVote = item.votes?.find((vote) => vote.voterId === 'user-current');
  if (!myVote && item.deliberationStatus === 'in_voting') return 'Pendente';
  if (!myVote) return 'Não elegível';
  if (myVote.vote === 'yes') return 'Votou: Sim';
  if (myVote.vote === 'no') return 'Votou: Não';
  return 'Votou: Abstenção';
};

const formatSLA = (dueDate?: Date) => {
  if (!dueDate) return null;
  const now = new Date();
  const hours = differenceInHours(dueDate, now);
  const days = differenceInDays(dueDate, now);

  if (hours < 0) return { text: 'Atrasado', variant: 'error' as const };
  if (hours <= 72) return { text: `${hours}h restantes`, variant: 'warning' as const };
  if (days <= 7) return { text: `${days}d restantes`, variant: 'neutral' as const };
  return { text: format(dueDate, 'dd MMM', { locale: pt }), variant: 'neutral' as const };
};

const formatCurrency = (value?: number) => {
  if (!value) return null;
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
};

export function DecisionList({ items, selectedId, onSelectItem }: DecisionListProps) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="w-12 h-12 rounded-full bg-[rgba(255,255,255,0.05)] flex items-center justify-center mb-3">
          <FileX className="w-6 h-6 text-[rgba(255,255,255,0.25)]" />
        </div>
        <p className="text-sm text-[rgba(255,255,255,0.45)]">Nenhuma deliberação encontrada para este filtro.</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-[rgba(255,255,255,0.06)]">
      {items.map((item) => {
        const isSelected = item.id === selectedId;
        const sla = formatSLA(item.dueDate);
        const financial = formatCurrency(item.financialImpact);
        const dependentCount = item.stages?.filter((stage) => stage.stageType === 'dependent_review').length ?? 0;

        return (
          <button
            key={item.id}
            onClick={() => onSelectItem(item)}
            className={cn(
              'w-full text-left p-3 transition-all',
              'hover:bg-[rgba(255,255,255,0.03)]',
              isSelected && 'bg-[rgba(0,255,180,0.06)] border-l-2 border-[#00FFB4]'
            )}
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <h4 className={cn('text-sm font-medium line-clamp-1', isSelected ? 'text-white' : 'text-[rgba(255,255,255,0.92)]')}>
                {item.title}
              </h4>
              <StatusPill variant={getStatusVariant(item.deliberationStatus)} className="shrink-0">
                {translateStatus(item.deliberationStatus)}
              </StatusPill>
            </div>

            <div className="flex items-center gap-2 mb-2 text-[10px]">
              <span className="text-[rgba(255,255,255,0.55)] uppercase tracking-wide">
                {item.ownerCommitteeName || item.committeeName}
              </span>
              <span className="px-1.5 py-0.5 rounded uppercase tracking-wide font-medium text-[#00C8FF] bg-[rgba(0,200,255,0.12)] border border-[rgba(0,200,255,0.3)]">
                {item.templateName || item.type}
              </span>
            </div>

            <div className="flex items-center gap-3 text-[10px] text-[rgba(255,255,255,0.55)] flex-wrap">
              <span className="flex items-center gap-1">
                {item.evidenceComplete ? (
                  <>
                    <FileCheck className="w-3 h-3 text-[#00FFB4]" />
                    <span className="text-[#00FFB4]">Evidências Completas</span>
                  </>
                ) : (
                  <>
                    <FileX className="w-3 h-3 text-[#FFB04D]" />
                    <span className="text-[#FFB04D]">Evidências Pendentes</span>
                  </>
                )}
              </span>

              {financial && (
                <span className="flex items-center gap-1">
                  <DollarSign className="w-3 h-3" />
                  {financial}
                </span>
              )}

              {item.riskLevel && (
                <span className="flex items-center gap-1" style={{ color: getRiskColor(item.riskLevel) }}>
                  <AlertTriangle className="w-3 h-3" />
                  {item.riskLevel.toUpperCase()}
                </span>
              )}

              {sla && (
                <span className={cn('flex items-center gap-1', sla.variant === 'error' && 'text-[#FF5860]', sla.variant === 'warning' && 'text-[#FFB04D]')}>
                  <Clock className="w-3 h-3" />
                  {sla.text}
                </span>
              )}

              <span className="flex items-center gap-1 text-[#00C8FF]">
                <CheckCircle2 className="w-3 h-3" />
                Meu Voto: {getMyVoteLabel(item)}
              </span>

              <span className="text-[rgba(255,255,255,0.48)]">{dependentCount} revisões obrigatórias</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
