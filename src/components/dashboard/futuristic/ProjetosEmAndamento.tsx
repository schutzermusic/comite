'use client';

import React from 'react';
import { Briefcase, TrendingUp, AlertCircle, User } from 'lucide-react';
import { GlassCard } from '@/components/ui/glass-card';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { projects } from '@/lib/mock-data';

const statusConfig = {
  em_andamento: {
    label: 'Em Andamento',
    color: 'text-blue-400',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/30',
  },
  pausado: {
    label: 'Pausado',
    color: 'text-orange-400',
    bg: 'bg-orange-500/10',
    border: 'border-orange-500/30',
  },
  planejamento: {
    label: 'Planejamento',
    color: 'text-violet-400',
    bg: 'bg-violet-500/10',
    border: 'border-violet-500/30',
  },
  concluido: {
    label: 'Concluído',
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
  },
  cancelado: {
    label: 'Cancelado',
    color: 'text-red-400',
    bg: 'bg-red-500/10',
    border: 'border-red-500/30',
  },
};

export function ProjetosEmAndamento() {
  const projetosAtivos = projects.filter(p => 
    p.status === 'em_andamento' || p.status === 'pausado' || p.status === 'planejamento'
  );

  return (
    <GlassCard variant="medium" className="overflow-hidden">
      {/* Header */}
      <div className="p-6 border-b border-slate-200">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-slate-900 mb-1 flex items-center gap-3">
              <Briefcase className="w-6 h-6 text-emerald-500" />
              Projetos em Andamento
            </h2>
            <p className="text-sm text-slate-600">
              Execução e progresso em tempo real
            </p>
          </div>
          <div className="px-4 py-2 rounded-full bg-emerald-100 border border-emerald-300 backdrop-blur-md">
            <span className="text-emerald-700 font-semibold text-sm">
              {projetosAtivos.length} ativos
            </span>
          </div>
        </div>
      </div>

      {/* Projects Grid */}
      <div className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
        {projetosAtivos.map((projeto, index) => {
          const config = statusConfig[projeto.status];
          const isRisk = projeto.comite_status === 'atencao_necessaria';

          return (
            <Link key={projeto.id} href={`/projetos/${projeto.id}`}>
              <div
                className="group relative p-5 rounded-xl bg-gradient-to-br from-slate-50 to-transparent border border-slate-200 hover:border-emerald-400 hover:shadow-[0_0_20px_rgba(16,185,129,0.2)] transition-all duration-300 cursor-pointer"
                style={{
                  animationDelay: `${index * 100}ms`,
                }}
              >
                {/* Risk Indicator */}
                {isRisk && (
                  <div className="absolute -top-2 -right-2 p-2 rounded-full bg-red-500/20 border border-red-500/50 backdrop-blur-md animate-pulse">
                    <AlertCircle className="w-4 h-4 text-red-400" />
                  </div>
                )}

                {/* Project Header */}
                <div className="mb-4">
                  <div className="flex items-start justify-between mb-2">
                    <h3 className="text-slate-900 font-bold text-base group-hover:text-emerald-600 transition-colors flex-1 line-clamp-1">
                      {projeto.nome}
                    </h3>
                  </div>
                  
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-slate-600 font-mono bg-slate-100 px-2 py-1 rounded border border-slate-200">
                      {projeto.codigo}
                    </span>
                    <span className={cn(
                      "text-xs font-medium px-2 py-1 rounded border",
                      config.bg,
                      config.border,
                      config.color
                    )}>
                      {config.label}
                    </span>
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-slate-400">Progresso</span>
                    <span className="text-sm font-bold text-slate-900">
                      {projeto.progresso_percentual}%
                    </span>
                  </div>
                  <div className="relative h-2 bg-slate-200 rounded-full overflow-hidden">
                    <div
                      className="absolute inset-y-0 left-0 rounded-full transition-all duration-1000 ease-out"
                      style={{
                        width: `${projeto.progresso_percentual}%`,
                        background: projeto.progresso_percentual >= 80 
                          ? 'linear-gradient(to right, #10B981, #059669)'
                          : projeto.progresso_percentual >= 50
                          ? 'linear-gradient(to right, #06B6D4, #0891B2)'
                          : 'linear-gradient(to right, #F59E0B, #D97706)',
                      }}
                    />
                    {/* Animated Shine */}
                    <div 
                      className="absolute inset-0 animate-shimmer"
                      style={{
                        background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent)',
                        backgroundSize: '200% 100%',
                      }}
                    />
                  </div>
                </div>

                {/* Project Details */}
                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600 flex items-center gap-1">
                      <User className="w-3 h-3" />
                      {projeto.responsavel.nome}
                    </span>
                    <span className="text-slate-600 flex items-center gap-1">
                      <TrendingUp className="w-3 h-3" />
                      ROI: {projeto.roi_estimado || 'N/A'}%
                    </span>
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">{projeto.comite_nome}</span>
                    <span className="text-slate-400 font-semibold">
                      R$ {(projeto.valor_executado / 1000).toFixed(0)}k / {(projeto.valor_total / 1000).toFixed(0)}k
                    </span>
                  </div>
                </div>

                {/* Bottom Gradient Line */}
                <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-emerald-400/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
              </div>
            </Link>
          );
        })}
      </div>

      {/* Summary Footer */}
      <div className="p-6 pt-0">
        <div className="grid grid-cols-3 gap-4">
          <div className="p-4 rounded-xl bg-gradient-to-br from-emerald-500/10 to-transparent border border-emerald-500/20">
            <div className="text-emerald-400 text-2xl font-bold">
              {projetosAtivos.filter(p => p.progresso_percentual >= 70).length}
            </div>
            <div className="text-slate-600 text-xs mt-1">No Prazo</div>
          </div>
          <div className="p-4 rounded-xl bg-gradient-to-br from-orange-100 to-transparent border border-orange-300">
            <div className="text-orange-600 text-2xl font-bold">
              {projetosAtivos.filter(p => p.comite_status === 'atencao_necessaria').length}
            </div>
            <div className="text-slate-600 text-xs mt-1">Em Risco</div>
          </div>
          <div className="p-4 rounded-xl bg-gradient-to-br from-blue-100 to-transparent border border-blue-300">
            <div className="text-blue-600 text-2xl font-bold">
              R$ {(projetosAtivos.reduce((sum, p) => sum + p.valor_total, 0) / 1000000).toFixed(1)}M
            </div>
            <div className="text-slate-600 text-xs mt-1">Investimento</div>
          </div>
        </div>
      </div>
    </GlassCard>
  );
}

