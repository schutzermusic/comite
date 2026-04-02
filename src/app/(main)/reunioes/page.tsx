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
  PlayCircle,
} from "lucide-react";
import { format, isPast, isFuture, isToday } from "date-fns";
import { ptBR } from "date-fns/locale";
import { meetings, users } from "@/lib/mock-data";

import {
  HudPageLayout,
  HudHeader,
  HudKpiStrip,
  HudPanel,
  HudButton,
  HudStatusPill,
  HudEmptyState,
  type KpiItem,
} from "@/components/hud";

export default function ReunioesPage() {
  const [isAdmin] = React.useState(true);

  const reunioesProximas = meetings.filter(
    (r) => (isFuture(new Date(r.dataHoraInicio)) || isToday(new Date(r.dataHoraInicio))) && r.status !== 'cancelada'
  );

  const reunioesPassadas = meetings.filter(
    (r) => isPast(new Date(r.dataHoraInicio)) && !isToday(new Date(r.dataHoraInicio))
  );

  type StatusVariant = 'active' | 'completed' | 'error' | 'neutral';

  const getStatusVariant = (status: string): StatusVariant => {
    if (status === 'em_andamento') return 'active';
    if (status === 'concluida' || status === 'encerrada') return 'completed';
    if (status === 'cancelada') return 'error';
    return 'neutral';
  };

  const getTipoIcon = (tipo: 'presencial' | 'virtual' | 'hibrida') => {
    const icons = { presencial: MapPin, virtual: Video, hibrida: Users };
    return icons[tipo] || MapPin;
  };

  const stats = {
    total: meetings.length,
    proximas: reunioesProximas.length,
    hoje: meetings.filter((r) => isToday(new Date(r.dataHoraInicio)) && r.status !== 'cancelada').length,
    concluidas: meetings.filter((r) => r.status === 'encerrada').length,
  };

  const kpiItems: KpiItem[] = [
    { id: 'total', value: stats.total, label: 'Total de Reuniões', variant: 'info', icon: <Calendar className="w-5 h-5" /> },
    { id: 'hoje', value: stats.hoje, label: 'Hoje', variant: 'warning', icon: <Clock className="w-5 h-5" /> },
    { id: 'proximas', value: stats.proximas, label: 'Próximas', variant: 'success', icon: <PlayCircle className="w-5 h-5" /> },
    { id: 'concluidas', value: stats.concluidas, label: 'Concluídas', variant: 'info', icon: <CheckCircle2 className="w-5 h-5" /> },
  ];

  return (
    <HudPageLayout>
      <HudHeader
        title="Reuniões do Comitê"
        subtitle="Agende e gerencie reuniões do comitê"
        icon={<Calendar className="w-5 h-5" />}
        breadcrumbs={[{ label: 'Reuniões' }]}
        actions={
          isAdmin ? (
            <Link href="/reunioes/nova">
              <HudButton variant="primary" size="md" leftIcon={<Plus className="w-4 h-4" />}>
                Nova Reunião
              </HudButton>
            </Link>
          ) : undefined
        }
      />

      <HudKpiStrip kpis={kpiItems} columns={4} />

      {reunioesProximas.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-white/60 mb-4">
            Próximas Reuniões
          </h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {reunioesProximas.map((reuniao, idx) => {
              const TipoIcon = getTipoIcon(reuniao.tipoReuniao as any);
              return (
                <Link key={reuniao.id} href={`/reunioes/${reuniao.id}`}>
                  <HudPanel delay={idx * 0.05} className="h-full cursor-pointer">
                    <div className="space-y-4">
                      <div>
                        <h3 className="text-base font-semibold text-white mb-2">{reuniao.titulo}</h3>
                        <div className="flex gap-2 flex-wrap">
                          <HudStatusPill variant={getStatusVariant(reuniao.status)}>
                            {reuniao.status}
                          </HudStatusPill>
                          {reuniao.comite && (
                            <HudStatusPill variant="info">{reuniao.comite}</HudStatusPill>
                          )}
                        </div>
                      </div>

                      <p className="text-sm text-white/50 line-clamp-2">
                        Discussão sobre o andamento e próximos passos da iniciativa.
                      </p>

                      <div className="space-y-2 text-sm">
                        <div className="flex items-center gap-2 text-white/80">
                          <Calendar className="w-4 h-4 text-emerald-400" />
                          <span className="font-medium">
                            {format(new Date(reuniao.dataHoraInicio), "dd 'de' MMMM, yyyy", { locale: ptBR })}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-white/50">
                          <Clock className="w-4 h-4 text-cyan-400" />
                          <span>{format(new Date(reuniao.dataHoraInicio), "HH:mm")} - 90 min</span>
                        </div>
                        <div className="flex items-center gap-2 text-white/50">
                          <TipoIcon className="w-4 h-4 text-cyan-400" />
                          <span className="truncate">Sala de Conferência A</span>
                        </div>
                      </div>

                      <div className="pt-3 border-t border-white/[0.06] flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm text-white/50">
                          <Users className="w-4 h-4" />
                          <span>{users.length} participantes</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-white/50">
                          <FileText className="w-4 h-4" />
                          <span>3 pautas</span>
                        </div>
                      </div>
                    </div>
                  </HudPanel>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {reunioesPassadas.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-white/60 mb-4">
            Reuniões Anteriores
          </h2>
          <div className="space-y-3">
            {reunioesPassadas.slice(0, 5).map((reuniao, idx) => {
              const TipoIcon = getTipoIcon(reuniao.tipoReuniao as any);
              return (
                <Link key={reuniao.id} href={`/reunioes/${reuniao.id}`}>
                  <HudPanel delay={idx * 0.05} className="cursor-pointer">
                    <div className="flex flex-col md:flex-row gap-6">
                      <div className="flex items-center justify-center w-14 h-14 rounded-xl bg-gradient-to-br from-cyan-500/10 to-emerald-500/10 border border-cyan-500/20 flex-shrink-0">
                        {reuniao.status === 'encerrada' ? (
                          <CheckCircle2 className="w-7 h-7 text-emerald-400" />
                        ) : reuniao.status === 'cancelada' ? (
                          <XCircle className="w-7 h-7 text-red-400" />
                        ) : (
                          <Calendar className="w-7 h-7 text-white/40" />
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-start justify-between gap-4 mb-2">
                          <div className="flex-1 min-w-0">
                            <h3 className="text-base font-semibold text-white mb-1">{reuniao.titulo}</h3>
                            <p className="text-sm text-white/50 line-clamp-1">
                              Discussão sobre o andamento e próximos passos da iniciativa.
                            </p>
                          </div>
                          <HudStatusPill variant={getStatusVariant(reuniao.status)}>
                            {reuniao.status}
                          </HudStatusPill>
                        </div>

                        <div className="flex flex-wrap gap-4 text-sm text-white/50">
                          <div className="flex items-center gap-2">
                            <Calendar className="w-4 h-4 text-emerald-400" />
                            <span>{format(new Date(reuniao.dataHoraInicio), "dd/MM/yyyy 'às' HH:mm")}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <TipoIcon className="w-4 h-4 text-cyan-400" />
                            <span>{reuniao.tipoReuniao}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Users className="w-4 h-4 text-emerald-400" />
                            <span>{users.length} participantes</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </HudPanel>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {meetings.length === 0 && (
        <HudPanel>
          <HudEmptyState
            icon="inbox"
            title="Nenhuma reunião agendada"
            description="Comece agendando sua primeira reunião do comitê"
            action={
              isAdmin
                ? { label: 'Agendar Primeira Reunião', onClick: () => {}, variant: 'primary' }
                : undefined
            }
          />
        </HudPanel>
      )}
    </HudPageLayout>
  );
}
