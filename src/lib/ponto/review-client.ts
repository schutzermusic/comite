'use client';

/** Cliente do painel de revisão de marcações (/api/ponto/review). */

export interface ReviewItem {
  punchId: string;
  type: string;
  occurredAt: string;
  personId: string;
  personName: string;
  selfieUrl: string | null;
  selfiePurged: boolean;
  location: {
    latitude: number | null;
    longitude: number | null;
    accuracyMeters: number | null;
    distanceMeters: number | null;
    geofenceName: string | null;
  } | null;
  authMethod: string | null;
}

async function parse<T>(res: Response): Promise<T> {
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string } & Record<string, unknown>;
  if (!res.ok || json.ok === false) throw new Error(json.error || `Falha ${res.status}`);
  return json as T;
}

export async function listReviewItems(): Promise<ReviewItem[]> {
  const res = await fetch('/api/ponto/review', { method: 'GET' });
  const { items } = await parse<{ items: ReviewItem[] }>(res);
  return items;
}

export async function resolvePunch(punchId: string, decision: 'accept' | 'reject', note?: string): Promise<void> {
  const res = await fetch('/api/ponto/review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ punchId, decision, note }),
  });
  await parse<{ ok: true }>(res);
}
