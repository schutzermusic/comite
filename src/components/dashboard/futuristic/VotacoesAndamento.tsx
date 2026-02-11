'use client';

import React from 'react';
import { ThumbsUp, ThumbsDown, MinusCircle, Zap, Clock } from 'lucide-react';
import { GlassCard } from '@/components/ui/glass-card';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { votes as pautas } from '@/lib/mock-data';

export function VotacoesAndamento() {
  const votosAtivos = pautas.map(p => ({
    ...p,
    total_votos: Math.floor(Math.random() * 20) + 5,
    votos_favor: Math.floor(Math.random() * 15),
    votos_contra: Math.floor(Math.random() * 5),
    abstencoes: Math.floor(Math.random() * 3),
  })).filter(v => v.status === 'em_andamento');

  const calcularPercentual = (votacao: any) => {
    const total = votacao.total_votos || 0;
    if (total === 0) return 0;
    return Math.round((votacao.votos_favor / total) * 100);
  };

  return (
    <GlassCard variant="medium" className="overflow-hidden">
      {/* Header */}
      <div className="p-6 border-b border-slate-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-orange-500 to-amber-500 rounded-xl">
              <Zap className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-slate-900">
                Votações em Andamento
              </h3>
              <p className="text-sm text-slate-600 mt-1">
                Requerem sua atenção imediata
              </p>
            </div>
          </div>
          <div className="px-4 py-2 rounded-full bg-orange-100 border border-orange-300 backdrop-blur-md animate-pulse">
            <span className="text-orange-700 font-semibold text-sm">
              {votosAtivos.length} ativas
            </span>
          </div>
        </div>
      </div>

      {/* Votações List */}
      <div className="p-6">
        {votosAtivos.length > 0 ? (
          <div className="space-y-4">
            {votosAtivos.map((pauta: any, index) => {
              const percentual = calcularPercentual(pauta);
              
              return (
                <Link
                  key={pauta.id}
                  href={`/votacoes/${pauta.id}`}
                  className="block group"
                >
                  <div className="p-5 bg-slate-50 backdrop-blur-sm border border-orange-200 rounded-2xl hover:shadow-[0_0_30px_rgba(249,115,22,0.2)] hover:border-orange-400 transition-all duration-300 transform hover:scale-[1.02]">
                    <div className="flex justify-between items-start mb-4">
                      <div className="flex-1">
                        <h3 className="font-bold text-slate-900 mb-2 group-hover:text-orange-600 transition-colors">
                          {pauta.titulo}
                        </h3>
                        {pauta.descricao && (
                          <p className="text-sm text-slate-600 line-clamp-2">
                            {pauta.descricao}
                          </p>
                        )}
                      </div>
                      <div className="ml-4">
                        <span className="px-3 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-700 border border-amber-300 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          Urgente
                        </span>
                      </div>
                    </div>

                    {/* Progress Bar with Labels */}
                    <div className="space-y-3">
                      <div className="flex justify-between items-center text-xs font-medium text-slate-600">
                        <span>Progresso da votação</span>
                        <span className="text-orange-600 font-bold">
                          {percentual}% a favor
                        </span>
                      </div>
                      
                      {/* Animated Progress Bar */}
                      <div className="relative h-3 bg-slate-200 rounded-full overflow-hidden border border-slate-300">
                        <div
                          className="absolute inset-y-0 left-0 bg-gradient-to-r from-orange-400 to-orange-500 rounded-full transition-all duration-1000 ease-out"
                          style={{
                            width: `${percentual}%`,
                          }}
                        >
                          <div className="absolute inset-0 bg-white/20 animate-pulse"></div>
                        </div>
                      </div>

                      {/* Vote Counts */}
                      <div className="flex gap-6 pt-2">
                        <div className="flex items-center gap-2">
                          <div className="flex items-center justify-center w-8 h-8 bg-green-500/20 rounded-lg border border-green-500/30">
                            <ThumbsUp className="w-4 h-4 text-green-400" />
                          </div>
                          <div>
                            <div className="text-xs text-slate-600">A favor</div>
                            <div className="text-sm font-bold text-slate-900">
                              {pauta.votos_favor || 0}
                            </div>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-2">
                          <div className="flex items-center justify-center w-8 h-8 bg-red-100 rounded-lg border border-red-300">
                            <ThumbsDown className="w-4 h-4 text-red-600" />
                          </div>
                          <div>
                            <div className="text-xs text-slate-600">Contra</div>
                            <div className="text-sm font-bold text-slate-900">
                              {pauta.votos_contra || 0}
                            </div>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-2">
                          <div className="flex items-center justify-center w-8 h-8 bg-slate-100 rounded-lg border border-slate-300">
                            <MinusCircle className="w-4 h-4 text-slate-600" />
                          </div>
                          <div>
                            <div className="text-xs text-slate-600">Abstenções</div>
                            <div className="text-sm font-bold text-slate-900">
                              {pauta.abstencoes || 0}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Bottom Glow on Hover */}
                    <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-orange-500/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-12">
            <div className="w-20 h-20 bg-gradient-to-br from-slate-800 to-slate-900 rounded-full flex items-center justify-center mx-auto mb-4 border border-white/10">
              <Zap className="w-10 h-10 text-slate-600" />
            </div>
            <p className="text-slate-500 mb-4">
              Nenhuma votação em andamento
            </p>
            <Link href="/pautas/nova">
              <button className="px-4 py-2 bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-400 hover:to-amber-500 text-white rounded-lg transition-all">
                <Zap className="w-4 h-4 inline mr-2" />
                Criar Nova Pauta
              </button>
            </Link>
          </div>
        )}
      </div>
    </GlassCard>
  );
}

