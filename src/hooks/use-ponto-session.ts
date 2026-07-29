'use client';

/**
 * Orquestrador da jornada no Portal de Ponto: carrega o estado do dia,
 * registra marcações (online ou em fila local), sincroniza pendências e
 * desfaz a última marcação.
 *
 * Regras de negócio preservadas integralmente:
 *  - idempotência por `clientEventId` (o mesmo id é reenviado na fila);
 *  - o veredito de geofence/revisão é sempre do servidor (ADR-008);
 *  - a evidência de selfie vale 3 min, então é enviada no momento do
 *    envio da marcação — nunca antecipada;
 *  - sessão expirada NUNCA vira registro local (evita marcação órfã de
 *    outra pessoa no aparelho compartilhado).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  pontoApi,
  PontoApiError,
  uuid,
  type GeoPoint,
  type PontoBootstrap,
  type PunchRecord,
  type PunchType,
} from '@/lib/ponto/client';
import { PENDING_SYNC_STATUS } from '@/lib/ponto/attendance-types';
import {
  browserQueueStorage,
  enqueuePunch,
  markQueueFailure,
  queueForPerson,
  removeFromQueue,
  type QueuedPunch,
} from '@/lib/ponto/offline-queue';
import { useOnlineStatus } from './use-ponto-device';

/** Depois disso paramos de tentar sozinhos e pedimos ação manual. */
const MAX_AUTO_ATTEMPTS = 5;

export interface ActivitySelection {
  projectId: string;
  stageId: string | null;
}

export interface PunchSubmission {
  type: PunchType;
  /** Selfie recém-capturada; obrigatória no fluxo padrão do portal. */
  selfieDataUrl: string | null;
  location: GeoPoint | null;
  activity: ActivitySelection | null;
}

export interface RegisteredOutcome {
  kind: 'registered';
  type: PunchType;
  occurredAt: string;
  needsReview: boolean;
  duplicate: boolean;
  hasLocation: boolean;
  geofence: { inside: boolean; distanceMeters: number | null; geofenceName: string | null } | null;
}

export type SubmitOutcome =
  | RegisteredOutcome
  | { kind: 'queued'; type: PunchType; occurredAt: string }
  | { kind: 'error'; message: string; canRetry: boolean; step: 'selfie' | 'punch' }
  | { kind: 'queue_full'; message: string }
  | { kind: 'session_expired' };

export interface SyncReport {
  synced: number;
  failed: number;
  remaining: number;
  message: string | null;
}

export interface PontoSession {
  loading: boolean;
  refreshing: boolean;
  loadError: string | null;
  bootstrap: PontoBootstrap | null;
  /** Marcações do dia: as do servidor + as pendentes, em ordem. */
  todayPunches: PunchRecord[];
  pending: QueuedPunch[];
  online: boolean;
  syncing: boolean;
  busy: boolean;
  reload: () => Promise<void>;
  submitPunch: (submission: PunchSubmission) => Promise<SubmitOutcome>;
  syncNow: () => Promise<SyncReport>;
  undoLastPunch: (punchId: string) => Promise<{ ok: boolean; message: string }>;
  stopActivity: () => Promise<{ ok: boolean; message: string }>;
  discardPending: (clientEventId: string) => void;
}

/** Marcação pendente exibida na linha do dia sem se passar por confirmada. */
function toPendingRecord(item: QueuedPunch): PunchRecord {
  return {
    id: `pending:${item.clientEventId}`,
    type: item.type,
    occurred_at: item.occurredAt,
    received_at: item.occurredAt,
    status: PENDING_SYNC_STATUS,
    can_undo: false,
  };
}

function isToday(iso: string, today: string): boolean {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return local === today;
}

export function usePontoSession(onSessionExpired: () => void): PontoSession {
  const [bootstrap, setBootstrap] = useState<PontoBootstrap | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState<QueuedPunch[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [busy, setBusy] = useState(false);

  const online = useOnlineStatus();
  const storage = useMemo(() => browserQueueStorage(), []);
  const personId = bootstrap?.person?.id ?? null;
  const expiredRef = useRef(false);
  const syncingRef = useRef(false);

  const handleExpired = useCallback(() => {
    if (expiredRef.current) return;
    expiredRef.current = true;
    onSessionExpired();
  }, [onSessionExpired]);

  const refreshPending = useCallback(
    (owner: string | null) => {
      setPending(owner ? queueForPerson(storage, owner) : []);
    },
    [storage],
  );

  const reload = useCallback(async () => {
    setRefreshing(true);
    try {
      const data = await pontoApi.bootstrap();
      setBootstrap(data);
      setLoadError(null);
      refreshPending(data.person?.id ?? null);
    } catch (e) {
      if (e instanceof PontoApiError && e.isSessionExpired) return handleExpired();
      setLoadError(
        e instanceof PontoApiError && e.isOffline
          ? 'Sem conexão. Mostrando o que já estava no aparelho.'
          : e instanceof Error
            ? e.message
            : 'Não foi possível carregar sua jornada.',
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [handleExpired, refreshPending]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /* ───────────── envio de uma marcação ───────────── */

  const sendPunch = useCallback(
    async (item: QueuedPunch, offline: boolean): Promise<RegisteredOutcome> => {
      let authenticationEvidenceId: string | undefined;
      if (item.selfieDataUrl) {
        try {
          const evidence = await pontoApi.selfie(item.selfieDataUrl);
          authenticationEvidenceId = evidence.authenticationEvidenceId;
        } catch (e) {
          // Marca a etapa para a tela manter a foto na mão do colaborador
          // e oferecer o reenvio, em vez de recomeçar a captura.
          if (e instanceof PontoApiError && !e.isOffline && !e.isSessionExpired && e.status < 500) {
            throw new PontoApiError(e.message, e.status, 'selfie_failed');
          }
          throw e;
        }
      }
      const res = await pontoApi.punch({
        type: item.type,
        clientEventId: item.clientEventId,
        occurredAt: item.occurredAt,
        location: item.location ?? undefined,
        authenticationEvidenceId,
        offline,
      });
      if (item.activity) {
        // O apontamento por projeto é acessório: falhar aqui não pode
        // invalidar uma marcação de jornada que o servidor já aceitou.
        try {
          await pontoApi.activity({
            action: 'start',
            projectId: item.activity.projectId,
            timelineItemId: item.activity.stageId ?? undefined,
          });
        } catch {
          /* silencioso — a jornada está registrada */
        }
      }
      return {
        kind: 'registered',
        type: item.type,
        occurredAt: item.occurredAt,
        needsReview: res.needsReview === true,
        duplicate: res.idempotent === true,
        hasLocation: item.location != null,
        geofence: res.geofence ?? null,
      };
    },
    [],
  );

  const submitPunch = useCallback(
    async (submission: PunchSubmission): Promise<SubmitOutcome> => {
      if (!personId) return { kind: 'session_expired' };
      const item: QueuedPunch = {
        clientEventId: uuid(),
        personId,
        type: submission.type,
        occurredAt: new Date().toISOString(),
        location: submission.location,
        selfieDataUrl: submission.selfieDataUrl,
        activity: submission.activity,
        queuedAt: Date.now(),
        attempts: 0,
        lastError: null,
      };

      const queueIt = (): SubmitOutcome => {
        const result = enqueuePunch(storage, item);
        refreshPending(personId);
        if (!result.ok) {
          return {
            kind: 'queue_full',
            message:
              result.reason === 'full'
                ? 'Há marcações demais aguardando envio neste aparelho. Conecte-se à internet e sincronize antes de registrar de novo.'
                : 'Não foi possível guardar a marcação no aparelho. Libere espaço no navegador e tente de novo.',
          };
        }
        return { kind: 'queued', type: item.type, occurredAt: item.occurredAt };
      };

      if (!online) return queueIt();

      setBusy(true);
      try {
        const outcome = await sendPunch(item, false);
        await reload();
        return outcome;
      } catch (e) {
        if (e instanceof PontoApiError) {
          // Sessão expirada não vira registro local: nada é gravado e o
          // colaborador reautentica antes de tentar de novo (Fluxo 10).
          if (e.isSessionExpired) {
            handleExpired();
            return { kind: 'session_expired' };
          }
          if (e.isOffline) return queueIt();
          // 5xx = servidor indisponível; a marcação é preservada localmente.
          if (e.status >= 500) return queueIt();
          return {
            kind: 'error',
            message: e.message,
            canRetry: true,
            step: e.code === 'selfie_failed' ? 'selfie' : 'punch',
          };
        }
        return {
          kind: 'error',
          message: e instanceof Error ? e.message : 'Não foi possível registrar o ponto.',
          canRetry: true,
          step: 'punch',
        };
      } finally {
        setBusy(false);
      }
    },
    [handleExpired, online, personId, refreshPending, reload, sendPunch, storage],
  );

  /* ───────────── sincronização ───────────── */

  const runSync = useCallback(
    async (auto: boolean): Promise<SyncReport> => {
      if (!personId || syncingRef.current) {
        return { synced: 0, failed: 0, remaining: pending.length, message: null };
      }
      const items = queueForPerson(storage, personId).filter(
        (item) => !auto || item.attempts < MAX_AUTO_ATTEMPTS,
      );
      if (items.length === 0) {
        return { synced: 0, failed: 0, remaining: queueForPerson(storage, personId).length, message: null };
      }

      syncingRef.current = true;
      setSyncing(true);
      let synced = 0;
      let failed = 0;
      let message: string | null = null;

      try {
        for (const item of items) {
          try {
            await sendPunch(item, true);
            removeFromQueue(storage, item.clientEventId);
            synced += 1;
          } catch (e) {
            failed += 1;
            if (e instanceof PontoApiError) {
              if (e.isSessionExpired) {
                handleExpired();
                message = 'Sua sessão expirou. Entre novamente para enviar as marcações guardadas.';
                break;
              }
              markQueueFailure(storage, item.clientEventId, e.message);
              if (e.isOffline) {
                message = 'Ainda sem conexão. As marcações continuam guardadas no aparelho.';
                break;
              }
              message = e.message;
            } else {
              markQueueFailure(
                storage,
                item.clientEventId,
                e instanceof Error ? e.message : 'Falha desconhecida',
              );
            }
          }
        }
      } finally {
        syncingRef.current = false;
        setSyncing(false);
        refreshPending(personId);
      }

      if (synced > 0) await reload();
      return {
        synced,
        failed,
        remaining: queueForPerson(storage, personId).length,
        message:
          message
          ?? (synced > 0
            ? synced === 1
              ? 'Marcação sincronizada com o servidor.'
              : `${synced} marcações sincronizadas com o servidor.`
            : null),
      };
    },
    [handleExpired, pending.length, personId, refreshPending, reload, sendPunch, storage],
  );

  const syncNow = useCallback(() => runSync(false), [runSync]);

  // Voltou a conexão e há pendências → tenta sozinho, sem pedir nada.
  useEffect(() => {
    if (!online || !personId || pending.length === 0 || syncingRef.current) return;
    void runSync(true);
    // `pending.length` como gatilho: evita reentrar a cada re-render.
  }, [online, personId, pending.length, runSync]);

  /* ───────────── ações auxiliares ───────────── */

  const undoLastPunch = useCallback(
    async (punchId: string) => {
      setBusy(true);
      try {
        const result = await pontoApi.undoPunch(punchId);
        await reload();
        return {
          ok: true,
          message: result.warning ?? 'Marcação desfeita. Você já pode registrar novamente.',
        };
      } catch (e) {
        if (e instanceof PontoApiError && e.isSessionExpired) {
          handleExpired();
          return { ok: false, message: 'Sua sessão expirou. Entre novamente.' };
        }
        return {
          ok: false,
          message: e instanceof Error ? e.message : 'Não foi possível desfazer a marcação.',
        };
      } finally {
        setBusy(false);
      }
    },
    [handleExpired, reload],
  );

  const stopActivity = useCallback(async () => {
    setBusy(true);
    try {
      await pontoApi.activity({ action: 'stop' });
      await reload();
      return { ok: true, message: 'Atividade encerrada.' };
    } catch (e) {
      if (e instanceof PontoApiError && e.isSessionExpired) {
        handleExpired();
        return { ok: false, message: 'Sua sessão expirou. Entre novamente.' };
      }
      return {
        ok: false,
        message: e instanceof Error ? e.message : 'Não foi possível encerrar a atividade.',
      };
    } finally {
      setBusy(false);
    }
  }, [handleExpired, reload]);

  const discardPending = useCallback(
    (clientEventId: string) => {
      removeFromQueue(storage, clientEventId);
      refreshPending(personId);
    },
    [personId, refreshPending, storage],
  );

  const todayPunches = useMemo(() => {
    const today = bootstrap?.today ?? new Date().toISOString().slice(0, 10);
    const server = bootstrap?.punches ?? [];
    const queued = pending.filter((item) => isToday(item.occurredAt, today)).map(toPendingRecord);
    return [...server, ...queued].sort(
      (a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime(),
    );
  }, [bootstrap, pending]);

  return {
    loading,
    refreshing,
    loadError,
    bootstrap,
    todayPunches,
    pending,
    online,
    syncing,
    busy,
    reload,
    submitPunch,
    syncNow,
    undoLastPunch,
    stopActivity,
    discardPending,
  };
}
