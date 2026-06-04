'use client';

import React from 'react';
import type { OrgMember } from '@/lib/types/agenda';
import { TasksList } from './TasksList';

interface Props {
  members: OrgMember[];
  reloadToken?: number;
  onSelect: (taskId: string) => void;
  onChanged: () => void;
}

/** "Minhas Pendências" — open tasks assigned to or created by the user. */
export function MyPendingsList({ members, reloadToken, onSelect, onChanged }: Props) {
  return <TasksList members={members} reloadToken={reloadToken} scope="mine" onSelect={onSelect} onChanged={onChanged} />;
}
