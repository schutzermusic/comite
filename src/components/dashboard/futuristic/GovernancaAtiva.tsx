'use client';

import React from 'react';
import { Activity, Building2, Calendar, Users, ArrowUpRight } from 'lucide-react';
import { GlassCard } from '@/components/ui/glass-card';
import Link from 'next/link';
import { meetings, votes as pautas, users } from '@/lib/mock-data';

export function GovernancaAtiva() {
  const stats = {
    comitesAtivos: 4,
    reunioesAgendadas: meetings.filter((r) => r.status === 'agendada').length,
    totalVotos: pautas.length,
    membrosAtivos: users.filter((m) => m.ativo !== false).length,
  };

  return (
    <GlassCard 
      variant="medium" 
      className="relative overflow-hidden"
      hover={false}
    >
      {/* Animated Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-orange-200/40 via-emerald-200/30 to-yellow-200/40" />
      
      {/* Grid Pattern Overlay */}
      <div 
        className="absolute inset-0 opacity-10"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M0 0h60v60H0z' fill='none'/%3E%3Cpath d='M0 0h60v60H0z' fill='none' stroke='%23000' stroke-width='1' opacity='0.1'/%3E%3C/svg%3E")`,
          backgroundSize: '60px 60px',
        }}
      />

      {/* Content */}
      <div className="relative p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-3 bg-orange-100 rounded-2xl backdrop-blur-sm border border-orange-300">
            <Activity className="w-6 h-6 text-orange-600" />
          </div>
          <div>
            <p className="text-orange-600 text-sm font-medium">Resumo Geral</p>
            <p className="text-xl font-bold text-slate-900">Governança Ativa</p>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="space-y-4 mb-6">
          <div className="flex items-center justify-between p-3 rounded-lg bg-white/80 backdrop-blur-md border border-slate-200 hover:bg-white transition-all">
            <div className="flex items-center gap-3">
              <Building2 className="w-5 h-5 text-orange-600" />
              <span className="text-sm text-slate-700">Comitês Ativos</span>
            </div>
            <span className="text-2xl font-bold text-slate-900">
              {stats.comitesAtivos}
            </span>
          </div>

          <div className="flex items-center justify-between p-3 rounded-lg bg-white/80 backdrop-blur-md border border-slate-200 hover:bg-white transition-all">
            <div className="flex items-center gap-3">
              <Calendar className="w-5 h-5 text-orange-600" />
              <span className="text-sm text-slate-700">Reuniões Agendadas</span>
            </div>
            <span className="text-2xl font-bold text-slate-900">
              {stats.reunioesAgendadas}
            </span>
          </div>

          <div className="flex items-center justify-between p-3 rounded-lg bg-white/80 backdrop-blur-md border border-slate-200 hover:bg-white transition-all">
            <div className="flex items-center gap-3">
              <Activity className="w-5 h-5 text-orange-600" />
              <span className="text-sm text-slate-700">Total de Votos</span>
            </div>
            <span className="text-2xl font-bold text-slate-900">
              {stats.totalVotos}
            </span>
          </div>

          <div className="flex items-center justify-between p-3 rounded-lg bg-white/80 backdrop-blur-md border border-slate-200 hover:bg-white transition-all">
            <div className="flex items-center gap-3">
              <Users className="w-5 h-5 text-orange-600" />
              <span className="text-sm text-slate-700">Membros Ativos</span>
            </div>
            <span className="text-2xl font-bold text-slate-900">
              {stats.membrosAtivos}
            </span>
          </div>
        </div>

        {/* CTA Button */}
        <Link href="/comites">
          <button className="w-full p-4 bg-gradient-to-r from-orange-500 to-emerald-500 hover:from-orange-600 hover:to-emerald-600 backdrop-blur-md border border-orange-400 rounded-xl text-white font-semibold transition-all duration-300 hover:shadow-lg hover:scale-[1.02] flex items-center justify-center gap-2 group">
            Ver Comitês
            <ArrowUpRight className="w-4 h-4 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
          </button>
        </Link>
      </div>

      {/* Bottom Glow */}
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-orange-400/50 to-transparent" />
    </GlassCard>
  );
}

