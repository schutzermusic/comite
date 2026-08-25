'use client';

/**
 * Cliente do Portal de Ponto Web — reusa os endpoints /api/mobile/*
 * (mesma lógica do app nativo: geofence, evidências, NSR fiscal),
 * autenticando com o access token da sessão web (bearer) em vez do
 * fluxo de cookies. Assim o portal web e o app compartilham o backend.
 */
import { createClient } from '@/utils/supabase/client';
import {
  startRegistration,
  startAuthentication,
  browserSupportsWebAuthn,
} from '@simplewebauthn/browser';
import type {
  AdjustmentInput,
  AdjustmentRequest,
  GeoPoint,
  PontoBootstrap,
  PunchInput,
  PunchRecord,
  PunchResponse,
  TimelineStage,
} from './attendance-types';
import { type LocationStatusKind, mapGeolocationError } from './geolocation';

export type {
  AdjustmentInput,
  AdjustmentRequest,
  GeoPoint,
  PontoBootstrap,
  PunchInput,
  PunchRecord,
  PunchType,
  TimelineStage,
} from './attendance-types';
export { PUNCH_LABEL, nextPunchOptions } from './attendance-state';

/** Erro de API com o suficiente para a UI escolher a recuperação certa. */
export class PontoApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'PontoApiError';
  }

  /** Sem rede (fetch nem saiu) — a marcação pode ir para a fila local. */
  get isOffline(): boolean {
    return this.status === 0;
  }

  get isSessionExpired(): boolean {
    return this.status === 401 || /Sessão expirada|Token (ausente|inválido)/i.test(this.message);
  }
}

async function authFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new PontoApiError('Sessão expirada — entre novamente.', 401);

  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw new PontoApiError('Sem conexão com o servidor.', 0);
  }

  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    code?: string;
  } & Record<string, unknown>;
  if (!res.ok || json.ok === false) {
    throw new PontoApiError(json.error || `Falha ${res.status}`, res.status, json.code);
  }
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

export interface LocationCapture {
  kind: LocationStatusKind;
  point: GeoPoint | null;
}

/**
 * Captura a localização só no evento (não rastreamento contínuo).
 * Devolve o motivo da falha para a UI orientar a recuperação, em vez de
 * simplesmente `null`.
 */
export function captureLocation(timeoutMs = 10_000): Promise<LocationCapture> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      return resolve({ kind: 'unsupported', point: null });
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          kind: 'granted',
          point: {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy ?? undefined,
          },
        }),
      (err) => resolve({ kind: mapGeolocationError(err), point: null }),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    );
  });
}

/**
 * Estado da permissão de localização sem disparar o diálogo nativo —
 * permite pedir a permissão de forma progressiva (§13) e detectar o
 * bloqueio definitivo. Nem todo navegador implementa; nesse caso 'unknown'.
 */
export async function readLocationPermission(): Promise<PermissionState | 'unknown'> {
  if (typeof navigator === 'undefined' || !navigator.permissions?.query) return 'unknown';
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
    return status.state;
  } catch {
    return 'unknown';
  }
}

export const pontoApi = {
  bootstrap: () => authFetch<PontoBootstrap & { ok: true }>('/api/mobile/bootstrap'),
  punch: (body: PunchInput) => authFetch<PunchResponse>('/api/mobile/punch', {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  undoPunch: (punchId: string) =>
    authFetch<{ ok: true; warning?: string }>('/api/mobile/punch/undo', {
      method: 'POST',
      body: JSON.stringify({ punchId }),
    }),
  activity: (body: { action: 'start' | 'stop'; projectId?: string; timelineItemId?: string }) =>
    authFetch<{ ok: true; running: unknown; stoppedSessionId?: string | null }>('/api/mobile/activity', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  /**
   * P3A — "trabalho atual" resolvido pelo Apex a partir da evidência que já
   * existe. Serve para o colaborador NÃO ter de escolher a etapa do Gantt.
   * Pode responder AMBIGUOUS/UNMATCHED/NO_EVIDENCE: nesses casos o app não
   * deve afirmar nada.
   */
  context: () =>
    authFetch<{
      ok: true;
      status: 'MATCHED' | 'AMBIGUOUS' | 'UNMATCHED' | 'NO_EVIDENCE';
      project: string | null;
      phase: string | null;
      activity: string | null;
      activityId: string | null;
      team: string | null;
      confidence: number | null;
      reasonCodes: string[];
      candidates: { timelineItemId: string; title: string }[];
    }>('/api/mobile/context'),
  timeline: (projectId: string) =>
    authFetch<{ ok: true; items: TimelineStage[] }>(
      `/api/mobile/timeline?projectId=${encodeURIComponent(projectId)}`,
    ),
  /** Envia a selfie e devolve o id da evidência (facial_verification). */
  selfie: (imageDataUrl: string) =>
    authFetch<{ ok: true; authenticationEvidenceId: string; path: string }>(
      '/api/mobile/selfie',
      { method: 'POST', body: JSON.stringify({ imageDataUrl }) },
    ),
  history: (from: string, to: string) =>
    authFetch<{ ok: true; from: string; to: string; punches: PunchRecord[] }>(
      `/api/mobile/history?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    ),
  adjustments: () => authFetch<{ ok: true; requests: AdjustmentRequest[] }>('/api/mobile/adjustment'),
  createAdjustment: (body: AdjustmentInput) =>
    authFetch<{ ok: true; request: AdjustmentRequest }>('/api/mobile/adjustment', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};

/* ───────────────────── biometria (Face ID/Touch ID) ───────────────────── */

export function biometricsSupported(): boolean {
  return typeof window !== 'undefined' && browserSupportsWebAuthn();
}

/** Cadastra a biometria do aparelho (uma vez por dispositivo). */
export async function enrollBiometric(): Promise<void> {
  const { options } = await authFetch<{ ok: true; options: import('@simplewebauthn/browser').PublicKeyCredentialCreationOptionsJSON }>(
    '/api/mobile/webauthn/register-options',
    { method: 'POST', body: '{}' },
  );
  const attResp = await startRegistration({ optionsJSON: options });
  await authFetch('/api/mobile/webauthn/register-verify', {
    method: 'POST',
    body: JSON.stringify({ response: attResp, deviceLabel: navigator.userAgent.slice(0, 80) }),
  });
}

/**
 * Solicita o gesto biométrico e retorna o id da evidência verificada no
 * servidor (para anexar à marcação). Lança { needsEnroll:true } se não há
 * credencial cadastrada.
 */
export async function verifyBiometric(): Promise<string> {
  let opts;
  try {
    opts = await authFetch<{ ok: true; options: import('@simplewebauthn/browser').PublicKeyCredentialRequestOptionsJSON }>(
      '/api/mobile/webauthn/auth-options',
      { method: 'POST', body: '{}' },
    );
  } catch (e) {
    if (e instanceof Error && /credencial/i.test(e.message)) {
      const err = new Error('Cadastre o Face ID/Touch ID antes de bater o ponto.');
      (err as Error & { needsEnroll?: boolean }).needsEnroll = true;
      throw err;
    }
    throw e;
  }
  const asseResp = await startAuthentication({ optionsJSON: opts.options });
  const res = await authFetch<{ ok: true; authenticationEvidenceId: string }>(
    '/api/mobile/webauthn/auth-verify',
    { method: 'POST', body: JSON.stringify({ response: asseResp }) },
  );
  return res.authenticationEvidenceId;
}
