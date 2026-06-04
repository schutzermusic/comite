'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ClipboardList, ListTodo, Plus, UserCheck } from 'lucide-react';
import { HudButton, HudHeader, HudPageLayout, HudTabs, type HudTab } from '@/components/hud';
import { useCurrentUser } from '@/hooks/use-current-user';
import type { CalendarItem, OrgMember } from '@/lib/types/agenda';
import { listOrgMembers } from '@/lib/services/agenda';
import {
  CalendarView,
  MeetingsList,
  MeetingDetailDrawer,
  MyPendingsList,
  NewMeetingModal,
  NewTaskModal,
  TaskDetailDrawer,
  TasksList,
} from '@/components/agenda/calendar';

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

  useEffect(() => {
    listOrgMembers()
      .then(setMembers)
      .catch(() => setMembers([]));
  }, []);

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

  const tabs: HudTab[] = [
    {
      id: 'calendar',
      label: 'Calendário',
      icon: <CalendarDays className="h-4 w-4" />,
      content: <CalendarView members={members} currentUserId={currentUserId} reloadToken={reloadToken} onSelectItem={handleSelectItem} />,
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

      <HudTabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} variant="pills" />

      <NewMeetingModal
        isOpen={meetingModalOpen}
        onClose={() => setMeetingModalOpen(false)}
        members={members}
        onCreated={bump}
      />
      <NewTaskModal isOpen={taskModalOpen} onClose={() => setTaskModalOpen(false)} members={members} onCreated={bump} />

      <MeetingDetailDrawer
        isOpen={selectedEventId != null}
        eventId={selectedEventId}
        onClose={() => setSelectedEventId(null)}
        onChanged={bump}
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
