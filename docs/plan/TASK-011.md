# TASK-011 · Reuniões — dados reais + timeline hoje

**Fase:** F3 — Módulos vitrine
**PR:** PR-11
**Dependências:** TASK-006
**Pode rodar em paralelo com:** TASK-010, TASK-012
**Owner-profile:** Full-stack Engineer
**Estimativa:** 6–8h

---

## Contexto

`/reunioes/page.tsx` exibe strings hardcoded visíveis no UI ("Sala de Conferência A", "90 min", "3 pautas", "Discussão sobre o andamento..."). O tipo `Meeting` não tem campos suficientes para renderizar informações reais. Esta tarefa corrige o modelo de dados, atualiza o mock e cria uma `MeetingTimelineToday` component.

---

## Escopo de arquivos

| Ação | Arquivo |
|---|---|
| **Modificar** | `src/lib/types/index.ts` ou equivalente |
| **Modificar** | `src/lib/mock-data.ts` (ou equivalente) |
| **Modificar** | `src/app/(main)/reunioes/page.tsx` |
| **Criar** | `src/components/meetings/MeetingCard.tsx` |
| **Criar** | `src/components/meetings/MeetingTimelineToday.tsx` |

---

## Tipo `Meeting` atualizado

```ts
// src/lib/types/index.ts (adicionar/substituir interface Meeting)

export type MeetingRole = 'presidente' | 'secretario' | 'votante' | 'observador';
export type MeetingType = 'presencial' | 'virtual' | 'hibrida';
export type MeetingStatus = 'agendada' | 'em_andamento' | 'encerrada' | 'cancelada';

export interface Meeting {
  id: string;
  titulo: string;
  descricao: string;
  dataHoraInicio: string;       // ISO 8601
  duracaoMinutos: number;
  tipoReuniao: MeetingType;
  local: string;
  linkVirtual?: string;
  comite: string;
  comiteId: string;
  status: MeetingStatus;
  participantesIds: string[];
  pautasIds: string[];
  ataPublicada: boolean;
  meuPapel?: MeetingRole;
}
```

## Mock atualizado (mínimo 4 reuniões)

```ts
// src/lib/mock-data.ts (substituir array meetings)
export const mockMeetings: Meeting[] = [
  {
    id: "mtg-001",
    titulo: "Reunião Ordinária — Conselho de Administração",
    descricao: "Análise do desempenho do Q1 2026 e aprovação do orçamento revisado para o semestre.",
    dataHoraInicio: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // hoje + 30min
    duracaoMinutos: 120,
    tipoReuniao: "presencial",
    local: "Sala Executiva 3 — Torre Sul, Andar 18",
    comite: "Conselho de Administração",
    comiteId: "cmt-ca",
    status: "agendada",
    participantesIds: ["usr-001", "usr-002", "usr-003"],
    pautasIds: ["pau-001", "pau-002", "pau-003"],
    ataPublicada: false,
    meuPapel: "presidente",
  },
  {
    id: "mtg-002",
    titulo: "Comitê de Riscos — Revisão Trimestral",
    descricao: "Análise da matriz de riscos operacionais e apresentação dos mitigadores aprovados.",
    dataHoraInicio: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(), // +3 dias
    duracaoMinutos: 90,
    tipoReuniao: "virtual",
    local: "Microsoft Teams",
    linkVirtual: "https://teams.microsoft.com/meet/example",
    comite: "Comitê de Riscos",
    comiteId: "cmt-riscos",
    status: "agendada",
    participantesIds: ["usr-001", "usr-004"],
    pautasIds: ["pau-004", "pau-005"],
    ataPublicada: false,
    meuPapel: "votante",
  },
  {
    id: "mtg-003",
    titulo: "Assembleia Geral Extraordinária",
    descricao: "Deliberação sobre fusão com subsidiária e emissão de novos títulos.",
    dataHoraInicio: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), // -7 dias
    duracaoMinutos: 180,
    tipoReuniao: "hibrida",
    local: "Auditório Principal — HQ + transmissão ao vivo",
    comite: "Assembleia Geral",
    comiteId: "cmt-ag",
    status: "encerrada",
    participantesIds: ["usr-001", "usr-002", "usr-003", "usr-004", "usr-005"],
    pautasIds: ["pau-006", "pau-007"],
    ataPublicada: true,
    meuPapel: "secretario",
  },
  {
    id: "mtg-004",
    titulo: "Comitê de Auditoria — Revisão de Controles Internos",
    descricao: "Apresentação dos resultados da auditoria interna semestral.",
    dataHoraInicio: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(), // +10 dias
    duracaoMinutos: 60,
    tipoReuniao: "presencial",
    local: "Sala de Reuniões 5 — Torre Norte",
    comite: "Comitê de Auditoria",
    comiteId: "cmt-audit",
    status: "agendada",
    participantesIds: ["usr-002", "usr-005"],
    pautasIds: ["pau-008"],
    ataPublicada: false,
    meuPapel: "observador",
  },
];
```

## MeetingCard

```tsx
// src/components/meetings/MeetingCard.tsx
"use client";
import { HudPanel } from "@/components/hud/HudPanel";
import { HudStatusPill } from "@/components/hud/HudStatusPill";
import { Calendar, Clock, MapPin, Video, Users, FileText } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { Meeting } from "@/lib/types";

const STATUS_LABELS: Record<Meeting['status'], string> = {
  agendada: 'Agendada',
  em_andamento: 'Em andamento',
  encerrada: 'Encerrada',
  cancelada: 'Cancelada',
};

const STATUS_VARIANTS: Record<Meeting['status'], 'default'|'success'|'warning'|'critical'> = {
  agendada: 'default',
  em_andamento: 'success',
  encerrada: 'default',
  cancelada: 'critical',
};

const ROLE_LABELS: Record<NonNullable<Meeting['meuPapel']>, string> = {
  presidente: 'Presidente',
  secretario: 'Secretário',
  votante: 'Votante',
  observador: 'Observador',
};

const TIPO_ICON: Record<Meeting['tipoReuniao'], React.ReactNode> = {
  presencial: <MapPin size={12} />,
  virtual: <Video size={12} />,
  hibrida: <Users size={12} />,
};

export function MeetingCard({ meeting, delay = 0 }: { meeting: Meeting; delay?: number }) {
  const start = new Date(meeting.dataHoraInicio);
  const timeLabel =
    meeting.status === 'encerrada'
      ? `Encerrada ${formatDistanceToNow(start, { locale: ptBR, addSuffix: true })}`
      : formatDistanceToNow(start, { locale: ptBR, addSuffix: true });

  return (
    <HudPanel
      elevation={2}
      interactive
      delay={delay}
      state={STATUS_VARIANTS[meeting.status]}
      title={meeting.titulo}
      subtitle={meeting.comite}
      headerActions={
        <div className="flex items-center gap-2">
          {meeting.meuPapel && (
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-ig-accent-weak text-ig-accent">
              {ROLE_LABELS[meeting.meuPapel]}
            </span>
          )}
          <HudStatusPill variant={STATUS_VARIANTS[meeting.status]}>
            {STATUS_LABELS[meeting.status]}
          </HudStatusPill>
        </div>
      }
    >
      <div className="flex flex-col gap-2 text-ig-body-sm text-ig-fg-muted">
        <div className="flex items-center gap-4">
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
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            {TIPO_ICON[meeting.tipoReuniao]}
            {meeting.local}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <FileText size={12} />
            {meeting.pautasIds.length} pauta{meeting.pautasIds.length !== 1 ? 's' : ''}
          </span>
          <span className="flex items-center gap-1.5">
            <Users size={12} />
            {meeting.participantesIds.length} participante{meeting.participantesIds.length !== 1 ? 's' : ''}
          </span>
          {meeting.ataPublicada && (
            <span className="text-ig-success font-medium text-[11px]">Ata publicada</span>
          )}
        </div>
      </div>
    </HudPanel>
  );
}
```

## MeetingTimelineToday

```tsx
// src/components/meetings/MeetingTimelineToday.tsx
"use client";
import { isSameDay, getHours, getMinutes } from "date-fns";
import type { Meeting } from "@/lib/types";

const HOUR_HEIGHT_PX = 56;
const START_HOUR = 8;
const END_HOUR = 20;

interface Props { meetings: Meeting[] }

export function MeetingTimelineToday({ meetings }: Props) {
  const today = new Date();
  const todayMeetings = meetings.filter((m) =>
    isSameDay(new Date(m.dataHoraInicio), today)
  );

  const topOffset = (dateStr: string) => {
    const d = new Date(dateStr);
    return (getHours(d) - START_HOUR + getMinutes(d) / 60) * HOUR_HEIGHT_PX;
  };

  const height = (minutes: number) => Math.max(minutes / 60 * HOUR_HEIGHT_PX, 32);

  const totalHeight = (END_HOUR - START_HOUR) * HOUR_HEIGHT_PX;

  return (
    <div className="relative" style={{ height: totalHeight }}>
      {/* hora labels */}
      {Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => (
        <div
          key={i}
          className="absolute left-0 text-[10px] text-ig-fg-subtle font-mono"
          style={{ top: i * HOUR_HEIGHT_PX - 6 }}
        >
          {String(START_HOUR + i).padStart(2, '0')}:00
        </div>
      ))}

      {/* blocos de reunião */}
      <div className="absolute left-12 right-0 top-0 bottom-0">
        {todayMeetings.length === 0 && (
          <p className="text-ig-body-sm text-ig-fg-subtle mt-4">
            Nenhuma reunião hoje.
          </p>
        )}
        {todayMeetings.map((m) => (
          <div
            key={m.id}
            className="absolute left-0 right-0 ig-glass rounded-[var(--ig-radius-md)] px-3 py-2 overflow-hidden"
            data-elev="2"
            style={{
              top: topOffset(m.dataHoraInicio),
              height: height(m.duracaoMinutos),
            }}
          >
            <span data-ig-noise="" />
            <div data-ig-content="" className="h-full">
              <p className="text-[11px] font-semibold text-ig-fg-strong truncate">{m.titulo}</p>
              <p className="text-[10px] text-ig-fg-muted">{m.duracaoMinutos} min</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

## Acceptance criteria

- [ ] `grep -E "Sala de Conferência A|90 min|3 pautas|Discussão sobre o andamento" src/app/(main)/reunioes/` → 0.
- [ ] `MeetingCard` lê todos os campos do tipo `Meeting` atualizado.
- [ ] `MeetingTimelineToday` exibe reuniões de hoje na escala temporal.
- [ ] Chip `meuPapel` aparece no card.
- [ ] `npm install date-fns` verificado (já deve estar presente).
- [ ] `npm run build` passa.
