'use client';

import React from 'react';
import { AlertTriangle, Clock, Flame, TrendingUp } from 'lucide-react';
import { GlassCard } from '@/components/ui/glass-card';
import { cn } from '@/lib/utils';
import Link from 'next/link';

interface AcaoPrioritaria {
  id: string;
  titulo: string;
  status: 'critico' | 'urgente' | 'alto' | 'medio';
  prioridade: number; // 0-100
  categoria: string;
  prazo?: string;
  link: string;
}

const MOCK_ACOES: AcaoPrioritaria[] = [
  {
    id: '1',
    titulo: 'Aprovação CAPEX Projeto Solar - Pendente há 15 dias',
    status: 'critico',
    prioridade: 98,
    categoria: 'Financeiro',
    prazo: '2 dias',
    link: '/votacoes/vote-01',
  },
  {
    id: '2',
    titulo: 'Revisão de Risco - Projeto Híbrido em atraso',
    status: 'urgente',
    prioridade: 87,
    categoria: 'Operacional',
    prazo: '5 dias',
    link: '/projetos/proj-005',
  },
  {
    id: '3',
    titulo: 'Eleição Presidente Comitê Técnico - Votação aberta',
    status: 'urgente',
    prioridade: 85,
    categoria: 'Governança',
    prazo: '3 dias',
    link: '/votacoes/vote-02',
  },
  {
    id: '4',
    titulo: 'Priorização de projetos P&D - Aguardando decisão',
    status: 'alto',
    prioridade: 72,
    categoria: 'Estratégico',
    prazo: '7 dias',
    link: '/votacoes/vote-03',
  },
  {
    id: '5',
    titulo: 'Revisão orçamentária Q4 - Documentação incompleta',
    status: 'alto',
    prioridade: 68,
    categoria: 'Financeiro',
    prazo: '10 dias',
    link: '/comites',
  },
];

const statusConfig = {
  critico: {
    icon: Flame,
    color: 'text-red-400',
    bg: 'bg-red-500/10',
    border: 'border-red-500/30',
    label: 'Crítico',
  },
  urgente: {
    icon: AlertTriangle,
    color: 'text-orange-400',
    bg: 'bg-orange-500/10',
    border: 'border-orange-500/30',
    label: 'Urgente',
  },
  alto: {
    icon: TrendingUp,
    color: 'text-yellow-400',
    bg: 'bg-yellow-500/10',
    border: 'border-yellow-500/30',
    label: 'Alto',
  },
  medio: {
    icon: Clock,
    color: 'text-blue-400',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/30',
    label: 'Médio',
  },
};

export function AcoesPrioritarias() {
  return (
    <GlassCard variant="medium" className="overflow-hidden">
      {/* Header */}
      <div className="p-6 border-b border-slate-200">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-slate-900 mb-1 flex items-center gap-3">
              <Flame className="w-6 h-6 text-orange-500" />
              Ações Prioritárias
            </h2>
            <p className="text-sm text-slate-600">
              Itens que requerem atenção imediata
            </p>
          </div>
          <div className="px-4 py-2 rounded-full bg-red-100 border border-red-300 backdrop-blur-md">
            <span className="text-red-700 font-semibold text-sm">
              {MOCK_ACOES.filter(item => item.status === 'critico' || item.status === 'urgente').length} críticos
            </span>
          </div>
        </div>
      </div>

      {/* Ações Items */}
      <div className="p-6 space-y-3">
        {MOCK_ACOES.map((item, index) => {
          const config = statusConfig[item.status];
          const StatusIcon = config.icon;

          return (
            <Link key={item.id} href={item.link}>
              <div
                className="group relative p-4 rounded-xl bg-gradient-to-r from-slate-50 to-transparent border border-slate-200 hover:border-slate-300 hover:bg-slate-100 transition-all duration-300 cursor-pointer"
                style={{
                  animationDelay: `${index * 100}ms`,
                }}
              >
                {/* Priority Bar (Left) */}
                <div
                  className="absolute left-0 top-0 bottom-0 w-1 rounded-l-xl transition-all duration-500"
                  style={{
                    background: `linear-gradient(to bottom, 
                      ${item.prioridade > 90 ? '#EF4444' : 
                        item.prioridade > 75 ? '#F97316' : 
                        item.prioridade > 60 ? '#F59E0B' : '#3B82F6'
                      }, 
                      transparent)`,
                    height: `${item.prioridade}%`,
                  }}
                />

                <div className="flex items-start gap-4 ml-3">
                  {/* Icon */}
                  <div className={cn(
                    "p-2 rounded-lg border backdrop-blur-sm",
                    config.bg,
                    config.border
                  )}>
                    <StatusIcon className={cn("w-4 h-4", config.color)} />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-4 mb-2">
                      <h3 className="text-slate-900 font-semibold text-sm group-hover:text-orange-600 transition-colors">
                        {item.titulo}
                      </h3>
                      {item.prazo && (
                        <span className="text-xs text-slate-400 flex items-center gap-1 whitespace-nowrap">
                          <Clock className="w-3 h-3" />
                          {item.prazo}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-3">
                      <span className={cn(
                        "text-xs font-medium px-2 py-1 rounded-md border",
                        config.bg,
                        config.border,
                        config.color
                      )}>
                        {config.label}
                      </span>
                      <span className="text-xs text-slate-600 px-2 py-1 rounded-md bg-slate-100 border border-slate-200">
                        {item.categoria}
                      </span>
                      <span className="text-xs text-slate-600 ml-auto">
                        Prioridade: {item.prioridade}%
                      </span>
                    </div>
                  </div>
                </div>

                {/* Hover Glow */}
                <div className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
                  style={{
                    background: 'radial-gradient(circle at center, rgba(249, 115, 22, 0.1), transparent 70%)',
                  }}
                />
              </div>
            </Link>
          );
        })}
      </div>

      {/* Heatmap de Prioridades */}
      <div className="p-6 pt-0">
        <div className="p-4 rounded-xl bg-gradient-to-br from-slate-50 to-slate-100 border border-slate-200">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Distribuição de Prioridades</h3>
          <div className="space-y-2">
            {['Crítico', 'Urgente', 'Alto', 'Médio'].map((label, idx) => {
              const counts = [1, 2, 2, 0];
              const colors = ['#EF4444', '#F97316', '#F59E0B', '#3B82F6'];
              
              return (
                <div key={label} className="flex items-center gap-3">
                  <span className="text-xs text-slate-600 w-16">{label}</span>
                  <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-1000 ease-out"
                      style={{
                        width: `${(counts[idx] / MOCK_ACOES.length) * 100}%`,
                        background: `linear-gradient(to right, ${colors[idx]}, ${colors[idx]}99)`,
                        animationDelay: `${idx * 150}ms`,
                      }}
                    />
                  </div>
                  <span className="text-xs text-slate-600 w-8 text-right">{counts[idx]}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </GlassCard>
  );
}

