/**
 * Fila local de marcações feitas sem rede.
 *
 * O contrato de idempotência do servidor não muda: cada item carrega o
 * mesmo `clientEventId` desde a captura, então reenviar é seguro — a rota
 * `/api/mobile/punch` devolve a marcação existente em vez de duplicar.
 *
 * A fila guarda a selfie junto porque a evidência só vale por 3 min no
 * servidor: ela precisa ser reenviada (e recriada) na hora da sincronização,
 * não na hora da captura.
 *
 * Módulo puro sobre uma `QueueStorage` injetável — testável em Node.
 */

import type { GeoPoint, PunchType } from './attendance-types';

export const QUEUE_STORAGE_KEY = 'insight-ponto-fila-v1';

/** Além disso o aparelho vira um risco de perda de dado, não uma conveniência. */
export const MAX_QUEUE_SIZE = 15;

export interface QueuedPunch {
  clientEventId: string;
  /**
   * Dono da marcação. O aparelho de campo é compartilhado: sem esse
   * vínculo, uma marcação pendente seria reenviada sob a sessão de quem
   * logasse depois.
   */
  personId: string;
  type: PunchType;
  /** Horário REAL do evento — preservado, nunca o horário da sincronização. */
  occurredAt: string;
  location: GeoPoint | null;
  /** Selfie em data URL; reenviada ao sincronizar para gerar a evidência. */
  selfieDataUrl: string | null;
  activity: { projectId: string; stageId: string | null } | null;
  queuedAt: number;
  attempts: number;
  lastError: string | null;
}

export interface QueueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type EnqueueResult =
  | { ok: true; queue: QueuedPunch[] }
  | { ok: false; reason: 'full' | 'storage'; queue: QueuedPunch[] };

function isQueuedPunch(value: unknown): value is QueuedPunch {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Partial<QueuedPunch>;
  return (
    typeof item.clientEventId === 'string'
    && typeof item.personId === 'string'
    && typeof item.type === 'string'
    && typeof item.occurredAt === 'string'
    && typeof item.queuedAt === 'number'
  );
}

export function readQueue(storage: QueueStorage): QueuedPunch[] {
  let raw: string | null = null;
  try {
    raw = storage.getItem(QUEUE_STORAGE_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isQueuedPunch).sort((a, b) => a.queuedAt - b.queuedAt);
  } catch {
    // Conteúdo corrompido não pode travar o app de campo.
    return [];
  }
}

function persist(storage: QueueStorage, queue: QueuedPunch[]): boolean {
  try {
    if (queue.length === 0) storage.removeItem(QUEUE_STORAGE_KEY);
    else storage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue));
    return true;
  } catch {
    return false;
  }
}

/** Enfileira preservando a ordem cronológica e a idempotência por evento. */
export function enqueuePunch(storage: QueueStorage, punch: QueuedPunch): EnqueueResult {
  const queue = readQueue(storage);
  if (queue.some((item) => item.clientEventId === punch.clientEventId)) {
    return { ok: true, queue };
  }
  if (queue.length >= MAX_QUEUE_SIZE) {
    return { ok: false, reason: 'full', queue };
  }
  const next = [...queue, punch];
  if (!persist(storage, next)) {
    return { ok: false, reason: 'storage', queue };
  }
  return { ok: true, queue: next };
}

export function removeFromQueue(storage: QueueStorage, clientEventId: string): QueuedPunch[] {
  const next = readQueue(storage).filter((item) => item.clientEventId !== clientEventId);
  persist(storage, next);
  return next;
}

/** Registra a falha para exibir o motivo sem perder a marcação. */
export function markQueueFailure(
  storage: QueueStorage,
  clientEventId: string,
  error: string,
): QueuedPunch[] {
  const next = readQueue(storage).map((item) =>
    item.clientEventId === clientEventId
      ? { ...item, attempts: item.attempts + 1, lastError: error }
      : item,
  );
  persist(storage, next);
  return next;
}

export function clearQueue(storage: QueueStorage): void {
  persist(storage, []);
}

/** Só o que pertence a quem está logado agora. */
export function queueForPerson(storage: QueueStorage, personId: string): QueuedPunch[] {
  return readQueue(storage).filter((item) => item.personId === personId);
}

/** `localStorage` quando existe; no SSR devolve um armazenamento inerte. */
export function browserQueueStorage(): QueueStorage {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  }
  return window.localStorage;
}
