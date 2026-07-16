import AsyncStorage from '@react-native-async-storage/async-storage';
import { mobileApi, type PunchInput } from '../api/mobileApi';

/**
 * Offline-first punch queue (spec §14.4, §20.6). Punches captured without
 * connectivity are stored locally with a stable clientEventId and flushed
 * when online. The backend deduplicates by clientEventId, so re-flushing is
 * always safe (idempotent).
 */
const KEY = 'insight.punch.queue.v1';

async function readQueue(): Promise<PunchInput[]> {
  const raw = await AsyncStorage.getItem(KEY);
  return raw ? (JSON.parse(raw) as PunchInput[]) : [];
}

async function writeQueue(items: PunchInput[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(items));
}

export async function enqueuePunch(punch: PunchInput): Promise<void> {
  const q = await readQueue();
  q.push(punch);
  await writeQueue(q);
}

/** Flushes queued punches; keeps the ones that still fail. Returns count sent. */
export async function flushQueue(): Promise<{ sent: number; remaining: number }> {
  const q = await readQueue();
  if (q.length === 0) return { sent: 0, remaining: 0 };

  const stillQueued: PunchInput[] = [];
  let sent = 0;
  for (const punch of q) {
    try {
      await mobileApi.punch({ ...punch, offline: true });
      sent += 1;
    } catch {
      stillQueued.push(punch); // network/server still down — retry later
    }
  }
  await writeQueue(stillQueued);
  return { sent, remaining: stillQueued.length };
}

export async function pendingCount(): Promise<number> {
  return (await readQueue()).length;
}
