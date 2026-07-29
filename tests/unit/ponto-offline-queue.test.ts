import { beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_QUEUE_SIZE,
  QUEUE_STORAGE_KEY,
  clearQueue,
  enqueuePunch,
  markQueueFailure,
  queueForPerson,
  readQueue,
  removeFromQueue,
  type QueueStorage,
  type QueuedPunch,
} from '@/lib/ponto/offline-queue';
import type { PunchType } from '@/lib/ponto/attendance-types';

class MemoryStorage implements QueueStorage {
  private data = new Map<string, string>();
  /** Simula o navegador sem espaço. */
  full = false;

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.full) throw new Error('QuotaExceededError');
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  seed(raw: string): void {
    this.data.set(QUEUE_STORAGE_KEY, raw);
  }
}

let storage: MemoryStorage;

function item(overrides: Partial<QueuedPunch> = {}): QueuedPunch {
  return {
    clientEventId: 'evt-1',
    personId: 'pessoa-1',
    type: 'clock_in' as PunchType,
    occurredAt: '2026-07-29T08:00:00.000Z',
    location: { lat: -23.31, lng: -51.16, accuracy: 12 },
    selfieDataUrl: 'data:image/jpeg;base64,AAAA',
    activity: null,
    queuedAt: 1_000,
    attempts: 0,
    lastError: null,
    ...overrides,
  };
}

beforeEach(() => {
  storage = new MemoryStorage();
});

describe('fila local de marcações (Fluxo 5)', () => {
  it('guarda e devolve a marcação preservando o horário do evento', () => {
    const result = enqueuePunch(storage, item());
    expect(result.ok).toBe(true);
    const [stored] = readQueue(storage);
    expect(stored.occurredAt).toBe('2026-07-29T08:00:00.000Z');
    expect(stored.selfieDataUrl).toBe('data:image/jpeg;base64,AAAA');
  });

  it('mantém a ordem cronológica mesmo se chegar fora de ordem', () => {
    enqueuePunch(storage, item({ clientEventId: 'b', queuedAt: 2_000 }));
    enqueuePunch(storage, item({ clientEventId: 'a', queuedAt: 1_000 }));
    expect(readQueue(storage).map((p) => p.clientEventId)).toEqual(['a', 'b']);
  });

  it('não duplica o mesmo evento — a idempotência começa no aparelho (Fluxo 6)', () => {
    enqueuePunch(storage, item({ clientEventId: 'evt-x' }));
    const second = enqueuePunch(storage, item({ clientEventId: 'evt-x' }));
    expect(second.ok).toBe(true);
    expect(readQueue(storage)).toHaveLength(1);
  });

  it('recusa novas marcações depois do limite, sem perder as guardadas', () => {
    for (let i = 0; i < MAX_QUEUE_SIZE; i += 1) {
      enqueuePunch(storage, item({ clientEventId: `evt-${i}`, queuedAt: i }));
    }
    const overflow = enqueuePunch(storage, item({ clientEventId: 'excedente' }));
    expect(overflow.ok).toBe(false);
    expect(overflow.ok === false && overflow.reason).toBe('full');
    expect(readQueue(storage)).toHaveLength(MAX_QUEUE_SIZE);
  });

  it('avisa quando o armazenamento do navegador falha', () => {
    storage.full = true;
    const result = enqueuePunch(storage, item());
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('storage');
  });

  it('remove após a sincronização', () => {
    enqueuePunch(storage, item({ clientEventId: 'evt-1' }));
    enqueuePunch(storage, item({ clientEventId: 'evt-2', queuedAt: 2_000 }));
    const remaining = removeFromQueue(storage, 'evt-1');
    expect(remaining.map((p) => p.clientEventId)).toEqual(['evt-2']);
  });

  it('registra a falha sem descartar a marcação', () => {
    enqueuePunch(storage, item({ clientEventId: 'evt-1' }));
    const after = markQueueFailure(storage, 'evt-1', 'Servidor indisponível');
    expect(after[0].attempts).toBe(1);
    expect(after[0].lastError).toBe('Servidor indisponível');
  });

  it('isola a fila por pessoa — aparelho compartilhado não reenvia ponto alheio', () => {
    enqueuePunch(storage, item({ clientEventId: 'evt-1', personId: 'pessoa-1' }));
    enqueuePunch(storage, item({ clientEventId: 'evt-2', personId: 'pessoa-2', queuedAt: 2_000 }));
    expect(queueForPerson(storage, 'pessoa-1').map((p) => p.clientEventId)).toEqual(['evt-1']);
    expect(queueForPerson(storage, 'pessoa-2').map((p) => p.clientEventId)).toEqual(['evt-2']);
  });

  it('sobrevive a conteúdo corrompido no navegador', () => {
    storage.seed('{isso não é json');
    expect(readQueue(storage)).toEqual([]);
    expect(enqueuePunch(storage, item()).ok).toBe(true);
  });

  it('descarta entradas malformadas em vez de quebrar a tela', () => {
    storage.seed(JSON.stringify([{ foo: 'bar' }, item({ clientEventId: 'valido' })]));
    expect(readQueue(storage).map((p) => p.clientEventId)).toEqual(['valido']);
  });

  it('limpa a fila por inteiro', () => {
    enqueuePunch(storage, item());
    clearQueue(storage);
    expect(readQueue(storage)).toEqual([]);
  });
});
