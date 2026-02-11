'use client';

import React from 'react';
import { Target, TrendingUp, CheckCircle2, AlertCircle, Clock } from 'lucide-react';
import { GlassCard } from '@/components/ui/glass-card';
import { Progress } from '@/components/ui/progress';
import { votes as pautas, users } from '@/lib/mock-data';

export function MetricasDesempenho() {
  const votos = pautas.map(p => ({
    ...p,
    total_votos: Math.floor(Math.random() * 20),
    votos_favor: Math.floor(Math.random() * 15)
  }));

  const stats = {
    aprovadas: pautas.filter((p) => p.resultado === 'aprovado').length,
    reprovadas: pautas.filter((p) => p.resultado === 'reprovado').length,
    emVotacao: pautas.filter((p) => p.status === 'em_andamento').length,
    taxaAprovacao:
      pautas.filter((p) => p.status === 'encerrada').length > 0
        ? Math.round(
            (pautas.filter((p) => p.resultado === 'aprovado').length /
              pautas.filter((p) => p.status === 'encerrada').length) *
              100
          )
        : 0,
    participacaoMedia:
      votos.filter((v) => (v as any).total_votos && (v as any).total_votos > 0).length > 0
        ? Math.round(
            votos.reduce((sum, v) => sum + ((v as any).total_votos || 0), 0) /
              votos.filter((v) => (v as any).total_votos && (v as any).total_votos > 0).length
          )
        : 0,
    membrosAtivos: users.filter((m) => m.ativo !== false).length,
  };

  return (
    <GlassCard variant="medium" className="overflow-hidden">
      {/* Header */}
      <div className="p-6 border-b border-slate-200">
        <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
          <Target className="w-5 h-5 text-violet-600" />
          Métricas de Desempenho
        </h3>
      </div>

      {/* Metrics Content */}
      <div className="p-6 space-y-6">
        {/* Taxa de Aprovação */}
        <div>
          <div className="flex justify-between items-center mb-3">
            <span className="text-sm font-medium text-slate-600">
              Taxa de Aprovação
            </span>
            <span className="text-2xl font-bold text-green-600">
              {stats.taxaAprovacao}%
            </span>
          </div>
          <div className="relative h-2.5 bg-slate-200 rounded-full overflow-hidden border border-slate-300">
            <div 
              className="absolute inset-y-0 left-0 bg-gradient-to-r from-green-500 to-emerald-400 rounded-full transition-all duration-1000"
              style={{ width: `${stats.taxaAprovacao}%` }}
            >
              <div className="absolute inset-0 bg-white/20 animate-pulse" />
            </div>
          </div>
          <p className="text-xs text-slate-600 mt-2 flex items-center gap-1">
            <TrendingUp className="w-3 h-3" />
            Meta: 70% de aprovação
          </p>
        </div>

        {/* Participação Média */}
        <div>
          <div className="flex justify-between items-center mb-3">
            <span className="text-sm font-medium text-slate-600">
              Participação Média
            </span>
            <span className="text-2xl font-bold text-orange-600">
              {stats.participacaoMedia}
            </span>
          </div>
          <div className="relative h-2.5 bg-slate-200 rounded-full overflow-hidden border border-slate-300">
            <div 
              className="absolute inset-y-0 left-0 bg-gradient-to-r from-orange-500 to-amber-400 rounded-full transition-all duration-1000"
              style={{ width: `${(stats.participacaoMedia / stats.membrosAtivos) * 100}%` }}
            >
              <div className="absolute inset-0 bg-white/20 animate-pulse" />
            </div>
          </div>
          <p className="text-xs text-slate-600 mt-2">
            Votos por pauta em média
          </p>
        </div>

        {/* Status Cards Grid */}
        <div className="pt-4 border-t border-slate-200 space-y-3">
          <div className="flex items-center justify-between p-4 rounded-xl bg-gradient-to-r from-green-100 to-emerald-100 border border-green-300 hover:border-green-400 transition-all">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-200 rounded-lg">
                <CheckCircle2 className="w-5 h-5 text-green-700" />
              </div>
              <div>
                <p className="text-xs text-slate-600">Aprovadas</p>
                <p className="text-xl font-bold text-green-700">
                  {stats.aprovadas}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between p-4 rounded-xl bg-gradient-to-r from-red-100 to-pink-100 border border-red-300 hover:border-red-400 transition-all">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-red-200 rounded-lg">
                <AlertCircle className="w-5 h-5 text-red-700" />
              </div>
              <div>
                <p className="text-xs text-slate-600">Reprovadas</p>
                <p className="text-xl font-bold text-red-700">
                  {stats.reprovadas}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between p-4 rounded-xl bg-gradient-to-r from-amber-100 to-orange-100 border border-amber-300 hover:border-amber-400 transition-all">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-200 rounded-lg">
                <Clock className="w-5 h-5 text-amber-700" />
              </div>
              <div>
                <p className="text-xs text-slate-600">Em Andamento</p>
                <p className="text-xl font-bold text-amber-700">
                  {stats.emVotacao}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </GlassCard>
  );
}

