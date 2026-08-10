'use client';

import type { JourneyManagementData, JourneyDaySummary } from '@/lib/types/journey-management';

export type JourneyManagementResponse = JourneyManagementData & {
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const json = await response.json().catch(() => ({})) as { ok?: boolean; error?: unknown; data?: T };
  if (!response.ok || json.ok === false) {
    const message = typeof json.error === 'string'
      ? json.error
      : json.error && typeof json.error === 'object' && 'message' in json.error
        ? String((json.error as { message: unknown }).message)
        : 'Falha ao processar a Jornada';
    throw new Error(message);
  }
  return (json.data ?? json) as T;
}

export const journeyManagementApi = {
  list: (month: string, page = 1, pageSize = 100) =>
    request<JourneyManagementResponse>(
      `/api/workforce/journey?month=${encodeURIComponent(month)}&page=${page}&pageSize=${pageSize}`,
    ),
  action: (body: Record<string, unknown>) =>
    request<{ ok: true; id?: string; count?: number }>('/api/workforce/journey', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  approve: (days: JourneyDaySummary[], decision: 'approved' | 'rejected', reason?: string) =>
    journeyManagementApi.action({
      action: 'decide_balance',
      decision,
      reason,
      items: days.map((day) => ({
        personId: day.personId,
        workDate: day.date,
        minutes: day.provisionalBalanceMinutes,
      })),
    }),
};
