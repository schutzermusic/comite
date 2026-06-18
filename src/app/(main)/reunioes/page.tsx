'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { addDays, endOfWeek, startOfWeek } from 'date-fns';
import { CalendarDays, ClipboardList, ListTodo, Plus, UserCheck } from 'lucide-react';
import { HudButton, HudHeader, HudModal, HudPageLayout, HudTabs, type HudTab } from '@/components/hud';
import { useCurrentUser } from '@/hooks/use-current-user';
import type {
  CalendarEvent,
  CalendarFilterKey,
  CalendarItem,
  CreateTaskInput,
  OrgMember,
  Task,
} from '@/lib/types/agenda';
import { listCalendarEvents, listOrgMembers, listTasks } from '@/lib/services/agenda';
import { ExportReportButton } from '@/components/reports/ExportReportButton';
import { openAgendaReport } from '@/lib/reports/modules/agenda-report';
import {
  AgendaSummaryStrip,
  type AgendaSummary,
  CalendarView,
  MeetingsList,
  MeetingDetailDrawer,
  MyPendingsList,
  NewMeetingModal,
  NewTaskModal,
  TaskDetailDrawer,
  TasksList,
} from '@/components/agenda/calendar';

/** Summary card → tab + calendar filter activation. */
const CARD_ACTIONS: Record<keyof AgendaSummary, { tab: string; filters: CalendarFilterKey[] }> = {
  myOpen: { tab: 'pendings', filters: [] },
  overdue: { tab: 'calendar', filters: ['tasks', 'overdue'] },
  meetingsThisWeek: { tab: 'calendar', filters: ['meetings', 'this_week'] },
  criticalDeadlines: { tab: 'calendar', filters: ['tasks', 'high_priority', 'pending'] },
  waiting: { tab: 'tasks', filters: [] },
  doneThisMonth: { tab: 'calendar', filters: ['done'] },
};

export default function AgendaPage() {
  const { user, permissions, roles } = useCurrentUser();
  const currentUserId = user?.id ?? null;

  const isAdmin = useMemo(
    () => roles.some((r) => r.key === 'owner_admin') || permissions.includes('admin.manage_users'),
    [roles, permissions],
  );
  const canCreateMeeting = isAdmin || permissions.includes('meetings.create');
  const canCreateTask = isAdmin || permissions.includes('tasks.create');

  const [members, setMembers] = useState<OrgMember[]>([]);
  const [reloadToken, setReloadToken] = useState(0);
  const bump = () => setReloadToken((t) => t + 1);

  const [meetingModalOpen, setMeetingModalOpen] = useState(false);
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('calendar');

  // Prefills: criar a partir de reunião / clicar num dia vazio.
  const [taskPrefill, setTaskPrefill] = useState<Partial<CreateTaskInput> | null>(null);
  const [createDate, setCreateDate] = useState<Date | null>(null);
  const [dayChooserOpen, setDayChooserOpen] = useState(false);

  // Summary strip data + filtros disparados pelos cards.
  const [summaryTasks, setSummaryTasks] = useState<Task[]>([]);
  const [summaryEvents, setSummaryEvents] = useState<CalendarEvent[]>([]);
  // Wider event window (−30d … +60d) so the exported PDF can show the upcoming agenda.
  const [reportEvents, setReportEvents] = useState<CalendarEvent[]>([]);
  const [filterSeed, setFilterSeed] = useState<{ token: number; filters: CalendarFilterKey[] } | null>(null);

  useEffect(() => {
    listOrgMembers()
      .then(setMembers)
      .catch(() => setMembers([]));
  }, []);

  useEffect(() => {
    const now = new Date();
    listTasks()
      .then(setSummaryTasks)
      .catch(() => setSummaryTasks([]));
    listCalendarEvents(startOfWeek(now, { weekStartsOn: 1 }), endOfWeek(now, { weekStartsOn: 1 }))
      .then(setSummaryEvents)
      .catch(() => setSummaryEvents([]));
    listCalendarEvents(addDays(now, -30), addDays(now, 60))
      .then(setReportEvents)
      .catch(() => setReportEvents([]));
  }, [reloadToken]);

  // Deep links from notifications / e-mails / legacy routes:
  // ?event=<id>, ?task=<id>, ?new=meeting|task.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const ev = params.get('event');
    const tk = params.get('task');
    const create = params.get('new');
    if (ev) setSelectedEventId(ev);
    if (tk) setSelectedTaskId(tk);
    if (create === 'meeting') setMeetingModalOpen(true);
    if (create === 'task') setTaskModalOpen(true);
  }, []);

  const handleSelectItem = (item: CalendarItem) => {
    if (item.kind === 'meeting') setSelectedEventId(item.id);
    else setSelectedTaskId(item.id);
  };

  const handleCreateAt = (day: Date) => {
    setCreateDate(day);
    if (canCreateMeeting && canCreateTask) {
      setDayChooserOpen(true);
    } else if (canCreateMeeting) {
      setMeetingModalOpen(true);
    } else if (canCreateTask) {
      setTaskModalOpen(true);
    }
  };

  const handleCreateTaskFromMeeting = (prefill: Partial<CreateTaskInput>) => {
    setTaskPrefill(prefill);
    setTaskModalOpen(true);
  };

  const handleCardClick = (card: keyof AgendaSummary) => {
    const action = CARD_ACTIONS[card];
    setActiveTab(action.tab);
    if (action.filters.length > 0) {
      setFilterSeed({ token: Date.now(), filters: action.filters });
    }
  };

  const closeTaskModal = () => {
    setTaskModalOpen(false);
    setTaskPrefill(null);
    setCreateDate(null);
  };
  const closeMeetingModal = () => {
    setMeetingModalOpen(false);
    setCreateDate(null);
  };

  const tabs: HudTab[] = [
    {
      id: 'calendar',
      label: 'Calendário',
      icon: <CalendarDays className="h-4 w-4" />,
      content: (
        <CalendarView
          members={members}
          currentUserId={currentUserId}
          reloadToken={reloadToken}
          onSelectItem={handleSelectItem}
          onCreateAt={canCreateMeeting || canCreateTask ? handleCreateAt : undefined}
          filterSeed={filterSeed}
        />
      ),
    },
    {
      id: 'meetings',
      label: 'Reuniões',
      icon: <ListTodo className="h-4 w-4" />,
      content: <MeetingsList members={members} reloadToken={reloadToken} onSelect={setSelectedEventId} />,
    },
    {
      id: 'tasks',
      label: 'Tarefas',
      icon: <ClipboardList className="h-4 w-4" />,
      content: <TasksList members={members} reloadToken={reloadToken} scope="all" onSelect={setSelectedTaskId} onChanged={bump} />,
    },
    {
      id: 'pendings',
      label: 'Minhas Pendências',
      icon: <UserCheck className="h-4 w-4" />,
      content: <MyPendingsList members={members} reloadToken={reloadToken} onSelect={setSelectedTaskId} onChanged={bump} />,
    },
  ];

  return (
    <HudPageLayout>
      <HudHeader
        title="Agenda & Tarefas"
        subtitle="Calendário corporativo, reuniões e tarefas da organização"
        icon={<CalendarDays className="h-5 w-5" />}
        iconTint="#17C3B2"
        breadcrumbs={[{ label: 'Agenda' }]}
        actions={
          <div className="flex flex-wrap gap-2">
            <ExportReportButton
              size="md"
              variant="glass"
              permission="meetings.view"
              build={() => openAgendaReport({
                meetings: reportEvents.length ? reportEvents : summaryEvents,
                tasks: summaryTasks,
                resolveUserName: (id) => members.find((m) => m.userId === id)?.fullName ?? 'Não atribuído',
                periodLabel: 'Próximos 30 dias',
                source: 'Supabase',
              })}
            />
            {canCreateTask && (
              <HudButton variant="secondary" size="md" leftIcon={<Plus className="h-4 w-4" />} onClick={() => setTaskModalOpen(true)}>
                Nova tarefa
              </HudButton>
            )}
            {canCreateMeeting && (
              <HudButton variant="primary" size="md" leftIcon={<Plus className="h-4 w-4" />} onClick={() => setMeetingModalOpen(true)}>
                Nova reunião
              </HudButton>
            )}
          </div>
        }
      />

      <AgendaSummaryStrip
        tasks={summaryTasks}
        events={summaryEvents}
        currentUserId={currentUserId}
        onCardClick={handleCardClick}
      />

      <HudTabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} variant="pills" />

      {/* Escolha rápida ao clicar "+" num dia do calendário */}
      <HudModal
        isOpen={dayChooserOpen}
        onClose={() => {
          setDayChooserOpen(false);
          setCreateDate(null);
        }}
        title="Criar neste dia"
        subtitle={createDate ? createDate.toLocaleDateString('pt-BR') : undefined}
        size="sm"
      >
        <div className="flex flex-col gap-2">
          <HudButton
            variant="primary"
            fullWidth
            leftIcon={<CalendarDays className="h-4 w-4" />}
            onClick={() => {
              setDayChooserOpen(false);
              setMeetingModalOpen(true);
            }}
          >
            Nova reunião
          </HudButton>
          <HudButton
            variant="secondary"
            fullWidth
            leftIcon={<ClipboardList className="h-4 w-4" />}
            onClick={() => {
              setDayChooserOpen(false);
              setTaskModalOpen(true);
            }}
          >
            Nova tarefa
          </HudButton>
        </div>
      </HudModal>

      <NewMeetingModal
        isOpen={meetingModalOpen}
        onClose={closeMeetingModal}
        members={members}
        onCreated={bump}
        defaultDate={createDate}
      />
      <NewTaskModal
        isOpen={taskModalOpen}
        onClose={closeTaskModal}
        members={members}
        onCreated={bump}
        defaultDueDate={createDate}
        prefill={taskPrefill}
      />

      <MeetingDetailDrawer
        isOpen={selectedEventId != null}
        eventId={selectedEventId}
        onClose={() => setSelectedEventId(null)}
        onChanged={bump}
        onCreateTask={canCreateTask ? handleCreateTaskFromMeeting : undefined}
      />
      <TaskDetailDrawer
        isOpen={selectedTaskId != null}
        taskId={selectedTaskId}
        members={members}
        onClose={() => setSelectedTaskId(null)}
        onChanged={bump}
      />
    </HudPageLayout>
  );
}
