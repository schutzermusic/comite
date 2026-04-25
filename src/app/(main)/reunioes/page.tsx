"use client";

import React from "react";
import Link from "next/link";
import { Calendar, CheckCircle2, Clock, PlayCircle, Plus } from "lucide-react";
import { isFuture, isPast, isToday } from "date-fns";
import { meetings } from "@/lib/mock-data";
import { HudButton, HudEmptyState, HudHeader, HudKpiStrip, HudPageLayout, HudPanel } from "@/components/hud";
import type { KpiItem } from "@/components/hud";
import { MeetingCard } from "@/components/meetings/MeetingCard";
import { MeetingTimelineToday } from "@/components/meetings/MeetingTimelineToday";

export default function ReunioesPage() {
  const [isAdmin] = React.useState(true);

  const reunioesProximas = meetings.filter((meeting) => {
    const start = new Date(meeting.dataHoraInicio);
    return (isFuture(start) || isToday(start)) && meeting.status !== "cancelada";
  });

  const reunioesPassadas = meetings.filter((meeting) => {
    const start = new Date(meeting.dataHoraInicio);
    return isPast(start) && !isToday(start);
  });

  const stats = {
    total: meetings.length,
    proximas: reunioesProximas.length,
    hoje: meetings.filter((meeting) => isToday(new Date(meeting.dataHoraInicio)) && meeting.status !== "cancelada").length,
    concluidas: meetings.filter((meeting) => meeting.status === "encerrada").length,
  };

  const kpiItems: KpiItem[] = [
    { id: "total", value: stats.total, label: "Total de Reuniões", variant: "info", icon: <Calendar className="h-5 w-5" /> },
    { id: "hoje", value: stats.hoje, label: "Hoje", variant: "warning", icon: <Clock className="h-5 w-5" /> },
    { id: "proximas", value: stats.proximas, label: "Próximas", variant: "success", icon: <PlayCircle className="h-5 w-5" /> },
    { id: "concluidas", value: stats.concluidas, label: "Concluídas", variant: "info", icon: <CheckCircle2 className="h-5 w-5" /> },
  ];

  return (
    <HudPageLayout>
      <HudHeader
        title="Reuniões do Comitê"
        subtitle="Agenda executiva, papéis e registros das reuniões corporativas"
        icon={<Calendar className="h-5 w-5" />}
        breadcrumbs={[{ label: "Reuniões" }]}
        actions={
          isAdmin ? (
            <Link href="/reunioes/nova">
              <HudButton variant="primary" size="md" leftIcon={<Plus className="h-4 w-4" />}>
                Nova Reunião
              </HudButton>
            </Link>
          ) : undefined
        }
      />

      <HudKpiStrip kpis={kpiItems} columns={4} />

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <h2 className="text-ig-label text-ig-fg-muted">Próximas Reuniões</h2>
          {reunioesProximas.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2">
              {reunioesProximas.map((reuniao, index) => (
                <Link key={reuniao.id} href={`/reunioes/${reuniao.id}`} className="block h-full">
                  <MeetingCard meeting={reuniao} delay={index * 0.05} />
                </Link>
              ))}
            </div>
          ) : (
            <HudPanel>
              <HudEmptyState
                icon="inbox"
                title="Nenhuma reunião futura"
                description="As próximas reuniões aparecerão aqui quando forem agendadas."
              />
            </HudPanel>
          )}
        </div>

        <HudPanel elevation={3} title="Timeline de Hoje" subtitle="Janela operacional 08:00-20:00">
          <MeetingTimelineToday meetings={meetings} />
        </HudPanel>
      </section>

      {reunioesPassadas.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-ig-label text-ig-fg-muted">Reuniões Anteriores</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {reunioesPassadas.slice(0, 5).map((reuniao, index) => (
              <Link key={reuniao.id} href={`/reunioes/${reuniao.id}`} className="block h-full">
                <MeetingCard meeting={reuniao} delay={index * 0.05} />
              </Link>
            ))}
          </div>
        </section>
      )}

      {meetings.length === 0 && (
        <HudPanel>
          <HudEmptyState
            icon="inbox"
            title="Nenhuma reunião agendada"
            description="Comece agendando sua primeira reunião do comitê."
            action={
              isAdmin
                ? { label: "Agendar Primeira Reunião", onClick: () => {}, variant: "primary" }
                : undefined
            }
          />
        </HudPanel>
      )}
    </HudPageLayout>
  );
}
