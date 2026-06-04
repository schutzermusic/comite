/**
 * Server-safe iCalendar (.ics) builder for the Agenda module.
 *
 * Standalone (no React / no 'use client') so it can be used from the
 * email API route and the client service alike. The existing
 * src/components/calendar/calendarUtils.ts is coupled to the legacy mock
 * Meeting type and marked 'use client', so it is not reused here.
 */

export interface IcsEventInput {
  uid: string;
  title: string;
  description?: string | null;
  start: Date;
  end?: Date | null;
  location?: string | null;
  url?: string | null;
  organizerName?: string | null;
  organizerEmail?: string | null;
  attendees?: string[];
}

function formatIcsDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

/** Escapes text per RFC 5545 (commas, semicolons, backslashes, newlines). */
function escapeIcs(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Builds an ICS string for a single event. Defaults the end to +1h when
 * no end is provided.
 */
export function buildIcs(input: IcsEventInput): string {
  const end = input.end ?? new Date(input.start.getTime() + 60 * 60 * 1000);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//INSIGHT APEX//Agenda//PT-BR',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${input.uid}`,
    `DTSTAMP:${formatIcsDate(new Date())}`,
    `DTSTART:${formatIcsDate(input.start)}`,
    `DTEND:${formatIcsDate(end)}`,
    `SUMMARY:${escapeIcs(input.title)}`,
  ];

  if (input.description) lines.push(`DESCRIPTION:${escapeIcs(input.description)}`);
  if (input.location) lines.push(`LOCATION:${escapeIcs(input.location)}`);
  if (input.url) lines.push(`URL;VALUE=URI:${input.url}`);
  if (input.organizerEmail) {
    lines.push(
      `ORGANIZER;CN=${escapeIcs(input.organizerName || 'INSIGHT APEX')}:mailto:${input.organizerEmail}`,
    );
  }
  for (const email of input.attendees ?? []) {
    lines.push(`ATTENDEE;ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:${email}`);
  }

  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n');
}
