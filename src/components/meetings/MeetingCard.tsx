"use client";

import { Calendar, Clock, ExternalLink, FileText, MapPin, Users, Video } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { HudPanel, HudStatusPill } from "@/components/hud";
import type { HudMaterialState } from "@/components/hud/HudPanel";
import type { HudStatusPillVariant } from "@/components/hud";
import type { Meeting } from "@/lib/types";

const STATUS_LABELS: Record<Meeting["status"], string> = {
  agendada: "Agendada",
  em_andamento: "Em andamento",
  encerrada: "Encerrada",
  cancelada: "Cancelada",
};

const PANEL_STATES: Record<Meeting["status"], HudMaterialState> = {
  agendada: "default",
  em_andamento: "success",
  encerrada: "default",
  cancelada: "critical",
};

const STATUS_VARIANTS: Record<Meeting["status"], HudStatusPillVariant> = {
  agendada: "neutral",
  em_andamento: "active",
  encerrada: "completed",
  cancelada: "error",
};

const ROLE_LABELS: Record<NonNullable<Meeting["meuPapel"]>, string> = {
  presidente: "Presidente",
  secretario: "Secretário",
  votante: "Votante",
  observador: "Observador",
};

const TYPE_LABELS: Record<Meeting["tipoReuniao"], string> = {
  presencial: "Presencial",
  virtual: "Virtual",
  hibrida: "Híbrida",
};

function TypeIcon({ type }: { type: Meeting["tipoReuniao"] }) {
  if (type === "virtual") return <Video size={12} />;
  if (type === "hibrida") return <Users size={12} />;
  return <MapPin size={12} />;
}

export function MeetingCard({ meeting, delay = 0 }: { meeting: Meeting; delay?: number }) {
  const start = new Date(meeting.dataHoraInicio);
  const timeLabel =
    meeting.status === "encerrada"
      ? `Encerrada ${formatDistanceToNow(start, { locale: ptBR, addSuffix: true })}`
      : formatDistanceToNow(start, { locale: ptBR, addSuffix: true });

  return (
    <HudPanel
      elevation={2}
      interactive
      delay={delay}
      state={PANEL_STATES[meeting.status]}
      title={meeting.titulo}
      subtitle={`${meeting.comite} · ${meeting.comiteId}`}
      headerActions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {meeting.meuPapel && (
            <span className="rounded-full bg-ig-accent-weak px-2 py-0.5 text-[11px] font-medium text-ig-accent">
              {ROLE_LABELS[meeting.meuPapel]}
            </span>
          )}
          <HudStatusPill variant={STATUS_VARIANTS[meeting.status]} size="sm">
            {STATUS_LABELS[meeting.status]}
          </HudStatusPill>
        </div>
      }
    >
      <div className="flex flex-col gap-3 text-ig-body-sm text-ig-fg-muted">
        <p className="line-clamp-2 text-ig-fg-muted">{meeting.descricao}</p>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="flex items-center gap-1.5">
            <Calendar size={12} />
            {format(start, "dd 'de' MMM, HH:mm", { locale: ptBR })}
          </span>
          <span className="flex items-center gap-1.5">
            <Clock size={12} />
            {meeting.duracaoMinutos} min
          </span>
          <span className="text-ig-fg-subtle">{timeLabel}</span>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="flex min-w-0 items-center gap-1.5">
            <TypeIcon type={meeting.tipoReuniao} />
            <span className="truncate">{meeting.local}</span>
          </span>
          <span className="text-ig-fg-subtle">{TYPE_LABELS[meeting.tipoReuniao]}</span>
          {meeting.linkVirtual && (
            <a
              href={meeting.linkVirtual}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-ig-accent transition-colors hover:text-ig-accent-strong"
            >
              <ExternalLink size={12} />
              Link virtual
            </a>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="flex items-center gap-1.5">
            <FileText size={12} />
            {meeting.pautasIds.length} pauta{meeting.pautasIds.length !== 1 ? "s" : ""}
          </span>
          <span className="flex items-center gap-1.5">
            <Users size={12} />
            {meeting.participantesIds.length} participante{meeting.participantesIds.length !== 1 ? "s" : ""}
          </span>
          {meeting.ataPublicada && (
            <span className="text-[11px] font-medium text-ig-success">Ata publicada</span>
          )}
        </div>
      </div>
    </HudPanel>
  );
}
