"use client";

import { getHours, getMinutes, isSameDay } from "date-fns";
import type { Meeting } from "@/lib/types";

const HOUR_HEIGHT_PX = 56;
const START_HOUR = 8;
const END_HOUR = 20;

interface MeetingTimelineTodayProps {
  meetings: Meeting[];
}

export function MeetingTimelineToday({ meetings }: MeetingTimelineTodayProps) {
  const today = new Date();
  const todayMeetings = meetings.filter((meeting) =>
    isSameDay(new Date(meeting.dataHoraInicio), today),
  );

  const topOffset = (dateStr: string) => {
    const date = new Date(dateStr);
    return (getHours(date) - START_HOUR + getMinutes(date) / 60) * HOUR_HEIGHT_PX;
  };

  const height = (minutes: number) => Math.max((minutes / 60) * HOUR_HEIGHT_PX, 32);
  const totalHeight = (END_HOUR - START_HOUR) * HOUR_HEIGHT_PX;

  return (
    <div className="relative" style={{ height: totalHeight }}>
      {Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, index) => (
        <div
          key={index}
          className="absolute left-0 tabular-nums text-[10px] text-ig-fg-subtle"
          style={{ top: index * HOUR_HEIGHT_PX - 6 }}
        >
          {String(START_HOUR + index).padStart(2, "0")}:00
        </div>
      ))}

      <div className="absolute bottom-0 left-12 right-0 top-0 border-l border-ig-border-subtle">
        {todayMeetings.length === 0 && (
          <p className="ml-4 mt-4 text-ig-body-sm text-ig-fg-subtle">Nenhuma reunião hoje.</p>
        )}

        {todayMeetings.map((meeting) => (
          <div
            key={meeting.id}
            className="ig-glass absolute left-4 right-0 overflow-hidden rounded-[var(--ig-radius-md)] px-3 py-2"
            data-elev="2"
            style={{
              top: topOffset(meeting.dataHoraInicio),
              height: height(meeting.duracaoMinutos),
            }}
          >
            <span data-ig-noise="" />
            <div data-ig-content="" className="h-full">
              <p className="truncate text-[11px] font-semibold text-ig-fg-strong">{meeting.titulo}</p>
              <p className="text-[10px] text-ig-fg-muted">{meeting.duracaoMinutos} min</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
