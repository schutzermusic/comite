'use client';

import React from 'react';
import { FileText, Calendar, ArrowUpRight } from 'lucide-react';
import { GlassCard } from '@/components/ui/glass-card';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { votes as pautas } from '@/lib/mock-data';
import { format } from 'date-fns';

const getStatusConfig = (status: string) => {
  const configs: Record<string, any> = {
    rascunho: { 
      label: 'Rascunho',
      color: 'text-slate-400',
      bg: 'bg-slate-500/10',
      border: 'border-slate-500/30'
    },
    aberta: { 
      label: 'Aberta',
      color: 'text-orange-400',
      bg: 'bg-orange-500/10',
      border: 'border-orange-500/30'
    },
    em_andamento: { 
      label: 'Em Andamento',
      color: 'text-amber-400',
      bg: 'bg-amber-500/10',
      border: 'border-amber-500/30'
    },
    encerrada: { 
      label: 'Encerrada',
      color: 'text-green-400',
      bg: 'bg-green-500/10',
      border: 'border-green-500/30'
    },
    nao_iniciada: { 
      label: 'Não Iniciada',
      color: 'text-blue-400',
      bg: 'bg-blue-500/10',
      border: 'border-blue-500/30'
    },
    cancelada: { 
      label: 'Cancelada',
      color: 'text-red-400',
      bg: 'bg-red-500/10',
      border: 'border-red-500/30'
    },
  };
  return configs[status] || configs.rascunho;
};

export function AtividadeRecente() {
  const pautasRecentes = pautas.slice(0, 5);

  return (
    <GlassCard variant="medium" className="overflow-hidden">
      {/* Header */}
      <div className="p-6 border-b border-slate-200">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-green-500 to-emerald-500 rounded-xl">
              <FileText className="w-5 h-5 text-white" />
            </div>
            <h3 className="text-xl font-bold text-slate-900">
              Atividade Recente
            </h3>
          </div>
          <Link href="/pautas">
            <button className="text-sm text-green-400 hover:text-green-300 transition-colors flex items-center gap-1 group">
              Ver Todas
              <ArrowUpRight className="w-4 h-4 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
            </button>
          </Link>
        </div>
      </div>

      {/* Activity List */}
      <div className="p-6">
        {pautasRecentes.length > 0 ? (
          <div className="space-y-3">
            {pautasRecentes.map((pauta, index) => {
              const config = getStatusConfig(pauta.status);
              
              return (
                <Link
                  key={pauta.id}
                  href={`/votacoes/${pauta.id}`}
                  className="block group"
                >
                  <div 
                    className="p-4 bg-slate-50 backdrop-blur-sm border border-green-200 rounded-xl hover:shadow-md hover:border-green-400 hover:bg-slate-100 transition-all duration-300"
                    style={{
                      animationDelay: `${index * 100}ms`,
                    }}
                  >
                    <div className="flex items-start gap-4">
                      {/* Index Badge */}
                      <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-green-500/20 to-emerald-500/20 flex-shrink-0 border border-green-500/20">
                        <span className="text-lg font-bold text-green-400">
                          {index + 1}
                        </span>
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-start mb-2">
                          <h4 className="font-semibold text-slate-900 group-hover:text-green-600 transition-colors line-clamp-1">
                            {pauta.titulo}
                          </h4>
                          <span className={cn(
                            "text-xs font-medium px-2 py-1 rounded-md border ml-2 whitespace-nowrap",
                            config.bg,
                            config.border,
                            config.color
                          )}>
                            {config.label}
                          </span>
                        </div>
                        
                        <div className="flex items-center gap-3 text-xs text-slate-600">
                          <div className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {pauta.created_date ? format(
                              new Date(pauta.created_date),
                              'dd/MM/yyyy'
                            ) : 'N/A'}
                          </div>
                          <span>•</span>
                          <span className="text-slate-700">{pauta.comite}</span>
                          {pauta.categoria && (
                            <>
                              <span>•</span>
                              <span className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-600">
                                {pauta.categoria}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-12">
            <div className="w-20 h-20 bg-gradient-to-br from-slate-800 to-slate-900 rounded-full flex items-center justify-center mx-auto mb-4 border border-white/10">
              <FileText className="w-10 h-10 text-slate-600" />
            </div>
            <p className="text-slate-500 mb-4">
              Nenhuma atividade registrada
            </p>
          </div>
        )}
      </div>
    </GlassCard>
  );
}

