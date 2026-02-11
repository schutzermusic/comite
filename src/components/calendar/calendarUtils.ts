'use client';
import { Meeting } from "@/lib/types";

// Defines the structure for a calendar event
interface CalendarEvent {
  title: string;
  description: string;
  startTime: Date;
  endTime: Date;
  location: string;
  url?: string;
  organizerName?: string;
}

/**
 * Formats a meeting object into a standardized calendar event object.
 * @param reuniao - The meeting object.
 * @param appUrl - The base URL for links back to the app.
 * @returns A formatted calendar event object.
 */
export function formatMeetingForCalendar(reuniao: Meeting, appUrl: string): Omit<CalendarEvent, 'organizerName'> {
  const startTime = new Date(reuniao.dataHoraInicio);
  const duracao = 90; // Default duration
  const endTime = new Date(startTime.getTime() + duracao * 60000);

  const description = `Detalhes da Reunião:
${reuniao.titulo}
Comitê: ${reuniao.comite}
Link da Reunião: ${appUrl}/reunioes/${reuniao.id}
---
Esta é uma notificação do Comitê Insight.`;

  return {
    title: `Reunião: ${reuniao.titulo}`,
    description: description,
    startTime: startTime,
    endTime: endTime,
    location: "Virtual",
    url: `${appUrl}/reunioes/${reuniao.id}`
  };
}

/**
 * Generates an ICS (iCalendar) file content string.
 * @param event - The calendar event data.
 * @returns A string containing the ICS file content.
 */
export function generateICSContent(event: CalendarEvent): string {
  const formatDate = (date: Date) => {
    return date.toISOString().replace(/[-:]/g, "").split('.')[0] + 'Z';
  };

  const icsContent = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//InsightEnergy//ComiteInsight//EN',
    'BEGIN:VEVENT',
    `UID:${new Date().toISOString()}@insightenergy.com`,
    `DTSTAMP:${formatDate(new Date())}`,
    `DTSTART:${formatDate(event.startTime)}`,
    `DTEND:${formatDate(event.endTime)}`,
    `SUMMARY:${event.title}`,
    `DESCRIPTION:${event.description.replace(/\n/g, '\\n')}`,
    `LOCATION:${event.location}`,
    `URL;VALUE=URI:${event.url || ''}`,
    `ORGANIZER;CN=${event.organizerName || 'Comitê Insight'}:mailto:noreply@insightenergy.com`,
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');

  return icsContent;
}

/**
 * Triggers a browser download for the generated ICS file.
 * @param icsContent - The content of the ICS file.
 * @param filename - The desired filename for the download.
 */
export function downloadICSFile(icsContent: string, filename: string): void {
  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Generates a URL for adding an event to Google Calendar.
 * @param event - The calendar event data.
 * @returns A URL string for Google Calendar.
 */
export function generateGoogleCalendarURL(event: Omit<CalendarEvent, 'organizerName'>): string {
  const formatDate = (date: Date) => {
    return date.toISOString().replace(/[-:]/g, "").split('.')[0] + 'Z';
  };
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    details: event.description,
    dates: `${formatDate(event.startTime)}/${formatDate(event.endTime)}`,
    location: event.location,
  });
  return `https://www.google.com/calendar/render?${params.toString()}`;
}

/**
 * Generates a URL for adding an event to Outlook.com Calendar.
 * @param event - The calendar event data.
 * @returns A URL string for Outlook.com Calendar.
 */
export function generateOutlookCalendarURL(event: Omit<CalendarEvent, 'organizerName'>): string {
  const params = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: event.title,
    body: event.description,
    startdt: event.startTime.toISOString(),
    enddt: event.endTime.toISOString(),
    location: event.location,
  });
  return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`;
}

/**
 * Generates a URL for adding an event to Office 365 (Outlook) Calendar.
 * @param event - The calendar event data.
 * @returns A URL string for Office 365 Calendar.
 */
export function generateOffice365CalendarURL(event: Omit<CalendarEvent, 'organizerName'>): string {
    const params = new URLSearchParams({
        path: '/calendar/action/compose',
        rru: 'addevent',
        subject: event.title,
        body: event.description,
        startdt: event.startTime.toISOString(),
        enddt: event.endTime.toISOString(),
        location: event.location,
    });
    return `https://outlook.office.com/calendar/0/deeplink/compose?${params.toString()}`;
}
