'use client';

/**
 * Cliente do Portal de Ponto Web — reusa os endpoints /api/mobile/*
 * (mesma lógica do app nativo: geofence, evidências, NSR fiscal),
 * autenticando com o access token da sessão web (bearer) em vez do
 * fluxo de cookies. Assim o portal web e o app compartilham o backend.
 */
import { createClient } from '@/utils/supabase/client';

export type PunchType = 'clock_in' | 'break_start' | 'break_end' | 'clock_out';

export interface PontoBootstrap {
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
  occurredAt?: string;
  location?: { lat: number; lng: number; accuracy?: number };
}

async function authFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error('Sessão expirada — entre novamente.');

  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string } & Record<string, unknown>;
  if (!res.ok || json.ok === false) throw new Error(json.error || `Falha ${res.status}`);
  return json as T;
}

/** RFC4122-ish UUID para clientEventId (idempotência). */
export function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Captura a localização só no evento (não rastreamento contínuo). */
export function captureLocation(): Promise<{ lat: number; lng: number; accuracy?: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy ?? undefined }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  });
}

export const pontoApi = {
  bootstrap: () => authFetch<PontoBootstrap & { ok: true }>('/api/mobile/bootstrap'),
  punch: (body: PunchInput) =>
    authFetch<{ ok: true; needsReview?: boolean; geofence?: { inside: boolean; distanceMeters: number | null; geofenceName: string | null } | null }>(
      '/api/mobile/punch',
      { method: 'POST', body: JSON.stringify(body) },
    ),
  activity: (body: { action: 'start' | 'stop'; projectId?: string }) =>
    authFetch<{ ok: true; running: unknown; stoppedSessionId?: string | null }>('/api/mobile/activity', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};

export const PUNCH_LABEL: Record<PunchType, string> = {
  clock_in: 'Registrar entrada',
  break_start: 'Iniciar intervalo',
  break_end: 'Retornar do intervalo',
  clock_out: 'Registrar saída',
};

export function nextPunchOptions(last: PunchType | null): PunchType[] {
  switch (last) {
    case null:
    case 'clock_out':
      return ['clock_in'];
    case 'clock_in':
    case 'break_end':
      return ['break_start', 'clock_out'];
    case 'break_start':
      return ['break_end'];
    default:
      return ['clock_in'];
  }
}
