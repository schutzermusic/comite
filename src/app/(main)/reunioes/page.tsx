'use client';

import React from "react";
import Link from "next/link";
import { 
  Calendar, 
  Plus, 
  Clock, 
  MapPin, 
  Video,
  Users,
  FileText,
  CheckCircle2,
  XCircle,
  PlayCircle
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PrimaryCTA } from "@/components/ui/primary-cta";
import { Badge } from "@/components/ui/badge";
import { HUDCard } from "@/components/ui/hud-card";
import { StatusPill } from "@/components/ui/status-pill";
import { OrionGreenBackground } from "@/components/system/OrionGreenBackground";
import { format, isPast, isFuture, isToday } from "date-fns";
import { ptBR } from "date-fns/locale";
import { meetings, users } from "@/lib/mock-data";

export default function ReunioesPage() {
  const [isAdmin, setIsAdmin] = React.useState(true); // Mocking admin user

  const reunioesProximas = meetings.filter(r => 
    (isFuture(new Date(r.dataHoraInicio)) || isToday(new Date(r.dataHoraInicio))) && r.status !== 'cancelada'
  );

  const reunioesPassadas = meetings.filter(r => 
    isPast(new Date(r.dataHoraInicio)) && !isToday(new Date(r.dataHoraInicio))
  );

  const getStatusVariant = (status: string): "active" | "completed" | "error" | "neutral" => {
    if (status === 'em_andamento') return 'active';
    if (status === 'concluida' || status === 'encerrada') return 'completed';
    if (status === 'cancelada') return 'error';
    return 'neutral';
  };

  const getTipoIcon = (tipo: 'presencial' | 'virtual' | 'hibrida') => {
    const icons = {
      presencial: MapPin,
      virtual: Video,
      hibrida: Users
    };
    return icons[tipo] || MapPin;
  };

  const stats = {
    total: meetings.length,
    proximas: reunioesProximas.length,
    hoje: meetings.filter(r => isToday(new Date(r.dataHoraInicio)) && r.status !== 'cancelada').length,
    concluidas: meetings.filter(r => r.status === 'encerrada').length,
  };

  return (
    <OrionGreenBackground className="orion-page">
      <div className="orion-page-content max-w-[1800px] mx-auto space-y-6">
        <header className="mb-8">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <h1 className="text-2xl font-semibold text-white mb-1 tracking-wide">Reuniões do Comitê</h1>
              <p className="text-sm text-[rgba(255,255,255,0.65)]">Agende e gerencie reuniões do comitê</p>
            </div>
            {isAdmin && (
              <Link href="/reunioes/nova">
                <PrimaryCTA>
                  <Plus className="w-4 h-4 mr-2" />
                  Nova Reunião
                </PrimaryCTA>
              </Link>
            )}
          </div>
        </header>

        <section className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <HUDCard glow glowColor="cyan">
            <div className="flex items-center justify-between mb-2">
              <Calendar className="w-6 h-6 text-[#00C8FF]" />
            </div>
            <p className="text-xs text-[rgba(255,255,255,0.65)] mb-1 uppercase tracking-wide">Total de Reuniões</p>
            <p className="text-3xl font-semibold text-white">{stats.total}</p>
          </HUDCard>

          <HUDCard glow glowColor="amber">
            <div className="flex items-center justify-between mb-2">
              <Clock className="w-6 h-6 text-[#FFB04D]" />
            </div>
            <p className="text-xs text-[rgba(255,255,255,0.65)] mb-1 uppercase tracking-wide">Hoje</p>
            <p className="text-3xl font-semibold text-white">{stats.hoje}</p>
          </HUDCard>

          <HUDCard glow glowColor="green">
            <div className="flex items-center justify-between mb-2">
              <PlayCircle className="w-6 h-6 text-[#00FFB4]" />
            </div>
            <p className="text-xs text-[rgba(255,255,255,0.65)] mb-1 uppercase tracking-wide">Próximas</p>
            <p className="text-3xl font-semibold text-white">{stats.proximas}</p>
          </HUDCard>

          <HUDCard glow glowColor="cyan">
            <div className="flex items-center justify-between mb-2">
              <CheckCircle2 className="w-6 h-6 text-[#00C8FF]" />
            </div>
            <p className="text-xs text-[rgba(255,255,255,0.65)] mb-1 uppercase tracking-wide">Concluídas</p>
            <p className="text-3xl font-semibold text-white">{stats.concluidas}</p>
          </HUDCard>
        </section>

        {reunioesProximas.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold text-white mb-4 tracking-wide">Próximas Reuniões</h2>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {reunioesProximas.map((reuniao) => {
                const TipoIcon = getTipoIcon(reuniao.tipoReuniao as any);
                return (
                  <Link key={reuniao.id} href={`/reunioes/${reuniao.id}`}>
                    <HUDCard className="h-full hover:border-[rgba(0,255,180,0.12)] transition-all cursor-pointer">
                      <div className="space-y-4">
                        <div>
                          <h3 className="text-base font-semibold text-white mb-2">{reuniao.titulo}</h3>
                          <div className="flex gap-2 flex-wrap">
                            <StatusPill variant={getStatusVariant(reuniao.status)}>
                              {reuniao.status}
                            </StatusPill>
                            {reuniao.comite && (
                              <StatusPill variant="info">
                                {reuniao.comite}
                              </StatusPill>
                            )}
                          </div>
                        </div>

                        <p className="text-sm text-[rgba(255,255,255,0.65)] line-clamp-2">
                          Discussão sobre o andamento e próximos passos da iniciativa.
                        </p>

                        <div className="space-y-2 text-sm">
                          <div className="flex items-center gap-2 text-[rgba(255,255,255,0.92)]">
                            <Calendar className="w-4 h-4 text-[#00FFB4]" />
                            <span className="font-medium">
                              {format(new Date(reuniao.dataHoraInicio), "dd 'de' MMMM, yyyy", { locale: ptBR })}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-[rgba(255,255,255,0.65)]">
                            <Clock className="w-4 h-4 text-[#00C8FF]" />
                            <span>
                              {format(new Date(reuniao.dataHoraInicio), "HH:mm")} - {90} min
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-[rgba(255,255,255,0.65)]">
                            <TipoIcon className="w-4 h-4 text-[#00C8FF]" />
                            <span className="truncate">Sala de Conferência A</span>
                          </div>
                        </div>

                        <div className="pt-4 border-t border-[rgba(255,255,255,0.05)] flex items-center justify-between">
                          <div className="flex items-center gap-2 text-sm text-[rgba(255,255,255,0.65)]">
                            <Users className="w-4 h-4" />
                            <span>{users.length} participantes</span>
                          </div>
                          <div className="flex items-center gap-2 text-sm text-[rgba(255,255,255,0.65)]">
                            <FileText className="w-4 h-4" />
                            <span>{3} pautas</span>
                          </div>
                        </div>
                      </div>
                    </HUDCard>
                  </Link>
                );
              })}
            </div>
          </section>
        )}

        {reunioesPassadas.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold text-white mb-4 tracking-wide">Reuniões Anteriores</h2>
            <div className="space-y-4">
              {reunioesPassadas.slice(0, 5).map((reuniao) => {
                const TipoIcon = getTipoIcon(reuniao.tipoReuniao as any);
                return (
                  <Link key={reuniao.id} href={`/reunioes/${reuniao.id}`}>
                    <HUDCard className="hover:border-[rgba(0,255,180,0.12)] transition-all cursor-pointer">
                      <div className="flex flex-col md:flex-row gap-6">
                        <div className="flex items-center justify-center w-16 h-16 rounded-xl bg-[rgba(255,255,255,0.05)] flex-shrink-0 border border-[rgba(255,255,255,0.08)]">
                          {reuniao.status === 'encerrada' ? (
                            <CheckCircle2 className="w-8 h-8 text-[#00FFB4]" />
                          ) : reuniao.status === 'cancelada' ? (
                            <XCircle className="w-8 h-8 text-[#FF5860]" />
                          ) : (
                            <Calendar className="w-8 h-8 text-[rgba(255,255,255,0.40)]" />
                          )}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-start justify-between gap-4 mb-3">
                            <div className="flex-1 min-w-0">
                              <h3 className="text-base font-semibold text-white mb-1">{reuniao.titulo}</h3>
                              <p className="text-sm text-[rgba(255,255,255,0.65)] line-clamp-1">Discussão sobre o andamento e próximos passos da iniciativa.</p>
                            </div>
                            <StatusPill variant={getStatusVariant(reuniao.status)}>
                              {reuniao.status}
                            </StatusPill>
                          </div>

                          <div className="flex flex-wrap gap-4 text-sm text-[rgba(255,255,255,0.65)]">
                            <div className="flex items-center gap-2">
                              <Calendar className="w-4 h-4 text-[#00FFB4]" />
                              <span>{format(new Date(reuniao.dataHoraInicio), "dd/MM/yyyy 'às' HH:mm")}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <TipoIcon className="w-4 h-4 text-[#00C8FF]" />
                              <span>{reuniao.tipoReuniao}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Users className="w-4 h-4 text-[#00FFB4]" />
                              <span>{users.length} participantes</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </HUDCard>
                  </Link>
                );
              })}
            </div>
          </section>
        )}

        {meetings.length === 0 && (
          <HUDCard>
            <div className="p-12 text-center">
              <Calendar className="w-16 h-16 text-[rgba(255,255,255,0.20)] mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-white mb-2">
                Nenhuma reunião agendada
              </h3>
              <p className="text-[rgba(255,255,255,0.65)] mb-6">
                Comece agendando sua primeira reunião do comitê
              </p>
              {isAdmin && (
                <Link href="/reunioes/nova">
                  <Button className="bg-[#00FFB4] text-[#050D0A] hover:bg-[#00E6A0] font-medium shadow-[0_0_18px_rgba(0,255,180,0.18)]">
                    <Plus className="w-4 h-4 mr-2" />
                    Agendar Primeira Reunião
                  </Button>
                </Link>
              )}
            </div>
          </HUDCard>
        )}
      </div>
    </OrionGreenBackground>
  );
}
