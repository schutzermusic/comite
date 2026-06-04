/**
 * Agenda & Tarefas — domain types for the calendar module.
 *
 * Backed by migration 026_agenda_calendar.sql:
 *   calendar_events, calendar_event_attendees, tasks,
 *   task_checklist_items, notifications, email_dispatches.
 *
 * The calendar UI merges meetings (calendar_events) and tasks (tasks)
 * into a single `CalendarItem` model — see `CalendarItem` below.
 */

/* ───────────── Enums / literal unions ───────────── */

export type CalendarEventType = 'meeting' | 'task';
export type CalendarEventStatus = 'scheduled' | 'confirmed' | 'cancelled' | 'completed';
export type EventVisibility = 'personal' | 'group' | 'organization';

export type AttendeeRole = 'organizer' | 'attendee' | 'optional';
export type AttendeeResponse = 'pending' | 'accepted' | 'declined' | 'tentative';

export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';
export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'cancelled';

export type EmailDispatchStatus = 'sent' | 'failed' | 'simulated';

/* ───────────── Core domain models ───────────── */

export interface CalendarEventAttendee {
  id: string;
  eventId: string;
  organizationId: string;
  userId: string | null;
  email: string;
  name: string | null;
  role: AttendeeRole;
  responseStatus: AttendeeResponse;
  isExternal: boolean;
  createdAt: Date;
}

export interface CalendarEvent {
  id: string;
  organizationId: string;
  ownerUserId: string;
  type: CalendarEventType;
  title: string;
  description: string | null;
  startsAt: Date;
  endsAt: Date | null;
  allDay: boolean;
  status: CalendarEventStatus;
  visibility: EventVisibility;
  location: string | null;
  meetingLink: string | null;
  relatedProjectId: string | null;
  relatedContractId: string | null;
  relatedCommitteeId: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  /** Hydrated on demand (detail view). */
  attendees?: CalendarEventAttendee[];
}

export interface TaskChecklistItem {
  id: string;
  taskId: string;
  organizationId: string;
  title: string;
  completed: boolean;
  position: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Task {
  id: string;
  organizationId: string;
  creatorUserId: string;
  assigneeUserId: string | null;
  title: string;
  description: string | null;
  dueAt: Date | null;
  dueAllDay: boolean;
  priority: TaskPriority;
  status: TaskStatus;
  relatedEventId: string | null;
  relatedProjectId: string | null;
  relatedContractId: string | null;
  /** Optional "notify also" recipients — never the responsible assignee. */
  notifyEmails: string[];
  completedAt: Date | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  /** Hydrated on demand (detail view). */
  checklist?: TaskChecklistItem[];
}

export interface AppNotification {
  id: string;
  organizationId: string;
  recipientUserId: string;
  type: string;
  title: string;
  body: string | null;
  linkUrl: string | null;
  readAt: Date | null;
  createdAt: Date;
}

export interface EmailDispatch {
  id: string;
  organizationId: string;
  targetEmail: string;
  subject: string;
  status: EmailDispatchStatus;
  provider: string | null;
  providerMessageId: string | null;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  errorMessage: string | null;
  createdAt: Date;
}

/** Org member directory entry (from list_organization_members RPC). */
export interface OrgMember {
  userId: string;
  fullName: string | null;
  jobTitle: string | null;
  avatarUrl: string | null;
  email: string | null;
}

/* ───────────── Unified calendar item (UI) ───────────── */

/**
 * A single thing rendered on the calendar — either a meeting (from
 * calendar_events) or a task (from tasks, placed at its due date).
 */
export interface CalendarItem {
  id: string;
  kind: 'meeting' | 'task';
  title: string;
  /** Meeting start, or task due date. */
  start: Date;
  /** Meeting end (optional). */
  end: Date | null;
  allDay: boolean;
  /** Normalized status string for display/filtering. */
  status: CalendarEventStatus | TaskStatus;
  ownerUserId: string;
  /** Tasks only. */
  priority?: TaskPriority;
  assigneeUserId?: string | null;
  /** Meetings only. */
  location?: string | null;
  meetingLink?: string | null;
  visibility?: EventVisibility;
  /** Back-reference to the source row. */
  source: CalendarEvent | Task;
}

/* ───────────── Form / input shapes ───────────── */

/** One invitee typed/selected in the meeting form. */
export interface MeetingGuestInput {
  email: string;
  name?: string | null;
  /** Resolved internal user_id when the email matches an org member. */
  userId?: string | null;
  isExternal: boolean;
  role?: AttendeeRole;
}

export interface CreateMeetingInput {
  title: string;
  description?: string;
  startsAt: string; // ISO / datetime-local
  endsAt?: string;
  allDay?: boolean;
  visibility: EventVisibility;
  location?: string;
  meetingLink?: string;
  relatedProjectId?: string | null;
  relatedContractId?: string | null;
  relatedCommitteeId?: string | null;
  guests: MeetingGuestInput[];
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  dueAt?: string; // ISO / datetime-local
  dueAllDay?: boolean;
  priority: TaskPriority;
  status?: TaskStatus;
  /** Internal user only — validated against list_organization_members. */
  assigneeUserId: string | null;
  relatedEventId?: string | null;
  relatedProjectId?: string | null;
  relatedContractId?: string | null;
  /** Optional "notificar também" free emails (notify-only). */
  notifyEmails?: string[];
  checklist?: string[];
}

/* ───────────── Calendar filters (UI) ───────────── */

export type CalendarFilterKey =
  | 'mine'
  | 'group'
  | 'meetings'
  | 'tasks'
  | 'pending'
  | 'done'
  | 'overdue';

export type CalendarViewMode = 'month' | 'week' | 'day' | 'agenda';

/* ───────────── Labels (pt-BR) ───────────── */

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: 'Baixa',
  medium: 'Média',
  high: 'Alta',
  critical: 'Crítica',
};

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'A fazer',
  in_progress: 'Em andamento',
  done: 'Concluída',
  cancelled: 'Cancelada',
};

export const EVENT_STATUS_LABELS: Record<CalendarEventStatus, string> = {
  scheduled: 'Agendada',
  confirmed: 'Confirmada',
  cancelled: 'Cancelada',
  completed: 'Concluída',
};

export const VISIBILITY_LABELS: Record<EventVisibility, string> = {
  personal: 'Pessoal',
  group: 'Grupo',
  organization: 'Organização',
};
