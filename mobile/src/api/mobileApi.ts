import { CONFIG } from '../config';
import { getAccessToken } from '../lib/supabase';

/** Typed client for the /api/mobile/* backend (Fase 4a). */

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getAccessToken();
  if (!token) throw new Error('Sessão expirada — faça login novamente.');

  const res = await fetch(`${CONFIG.apiBaseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string } & Record<string, unknown>;
  if (!res.ok || json.ok === false) {
    throw new Error(json.error || `Falha ${res.status}`);
  }
  return json as T;
}

export type PunchType = 'clock_in' | 'break_start' | 'break_end' | 'clock_out';

export interface BootstrapState {
  person: { id: string; full_name: string; job_title: string | null } | null;
  today: string;
  punches: Array<{ id: string; type: PunchType; occurred_at: string; status: string }>;
  runningSession: { id: string; project_id: string; started_at: string } | null;
  allocations: Array<{ project_id: string; role_title: string | null; planned_percentage: number }>;
  geofences: Array<{ id: string; project_id: string; name: string }>;
  devices: Array<{ id: string; device_public_id: string; status: string }>;
}

export interface PunchInput {
  type: PunchType;
  clientEventId: string;
  deviceId?: string;
  occurredAt?: string;
  offline?: boolean;
  location?: { lat: number; lng: number; accuracy?: number };
  auth?: { method: 'device_biometric' | 'manager_override'; result: 'success' | 'failure' };
}

export const mobileApi = {
  enroll: (body: { devicePublicId: string; platform: 'ios' | 'android'; deviceName?: string }) =>
    request<{ ok: true; device: { id: string; status: string } }>('/api/mobile/enroll', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  bootstrap: () => request<BootstrapState & { ok: true }>('/api/mobile/bootstrap'),

  punch: (body: PunchInput) =>
    request<{ ok: true; punch: unknown; geofence?: unknown; needsReview?: boolean; idempotent?: boolean }>(
      '/api/mobile/punch',
      { method: 'POST', body: JSON.stringify(body) },
    ),

  activity: (body: { action: 'start' | 'stop'; projectId?: string; deviceId?: string; description?: string }) =>
    request<{ ok: true; running: unknown; stoppedSessionId?: string | null }>('/api/mobile/activity', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};
