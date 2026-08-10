import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Contrato da solicitação de ajuste do colaborador (Fluxo 9).
 *
 * O ponto central: o ajuste NÃO cria tabela nova nem sobrescreve
 * marcação. Ele grava um punch novo com `original_punch_id`,
 * `correction_reason` e `status='under_review'` — a cadeia imutável da
 * migration 045 — para cair na fila de revisão do gestor.
 */

interface JsonCall {
  body: Record<string, unknown>;
  status: number;
}

const authState: {
  ok: boolean;
  personId: string;
  orgId: string;
  userId: string;
  client: unknown;
} = {
  ok: true,
  personId: 'pessoa-1',
  orgId: 'org-1',
  userId: 'user-1',
  client: null,
};

vi.mock('@/lib/mobile/server', () => ({
  json: (body: unknown, status = 200): JsonCall => ({ body: body as Record<string, unknown>, status }),
  authenticateMobile: async () =>
    authState.ok
      ? {
          ok: true,
          auth: {
            supabase: authState.client,
            personId: authState.personId,
            orgId: authState.orgId,
            userId: authState.userId,
          },
        }
      : { ok: false, response: { body: { ok: false, error: 'Token ausente' }, status: 401 } },
}));

const { GET, POST } = await import('@/app/api/mobile/adjustment/route');
const { GET: HISTORY_GET } = await import('@/app/api/mobile/history/route');

type QueryResult = Record<string, unknown>;

interface Recorded {
  method: string;
  args: unknown[];
}

/**
 * Cliente Supabase encadeável de mentira: cada `await`, `single()` ou
 * `maybeSingle()` consome o próximo resultado da fila, e todas as
 * chamadas ficam registradas para inspeção.
 */
function makeSupabase(queue: QueryResult[]) {
  const calls: Recorded[] = [];
  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') {
          return (resolve: (value: QueryResult) => unknown) =>
            resolve(queue.shift() ?? { data: null, error: null });
        }
        return (...args: unknown[]) => {
          calls.push({ method: String(prop), args });
          if (prop === 'single' || prop === 'maybeSingle') {
            return Promise.resolve(queue.shift() ?? { data: null, error: null });
          }
          return proxy;
        };
      },
    },
  );
  return { client: proxy, calls };
}

function payloadOf(calls: Recorded[]): Record<string, unknown> | null {
  const insert = calls.find((call) => call.method === 'insert');
  return insert ? (insert.args[0] as Record<string, unknown>) : null;
}

function request(body: unknown): Request {
  return new Request('http://localhost/api/mobile/adjustment', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

const VALID = {
  type: 'clock_in',
  occurredAt: '2026-07-28T11:00:00.000Z',
  reason: 'forgot_punch',
  note: 'Cheguei às 8h, mas o celular estava sem bateria.',
};

beforeEach(() => {
  authState.ok = true;
  authState.personId = 'pessoa-1';
});

describe('POST /api/mobile/adjustment', () => {
  it('grava a solicitação como correção em revisão, sem tocar no registro original', async () => {
    const { client, calls } = makeSupabase([
      { data: null, error: null }, // duplicidade
      { count: 0, error: null }, // solicitações abertas
      {
        data: {
          id: 'ajuste-1',
          type: 'clock_in',
          occurred_at: VALID.occurredAt,
          created_at: '2026-07-29T10:00:00.000Z',
          status: 'under_review',
          correction_reason: 'forgot_punch',
          notes: VALID.note,
          review_note: null,
          original_punch_id: null,
        },
        error: null,
      },
    ]);
    authState.client = client;

    const res = (await POST(request(VALID))) as unknown as JsonCall;

    expect(res.status).toBe(201);
    const payload = payloadOf(calls);
    expect(payload).toMatchObject({
      organization_id: 'org-1',
      person_id: 'pessoa-1',
      type: 'clock_in',
      status: 'under_review',
      source: 'web',
      correction_reason: 'forgot_punch',
      created_by: 'user-1',
    });
    // Nenhum UPDATE/DELETE em marcação existente.
    expect(calls.some((call) => call.method === 'update' || call.method === 'delete')).toBe(false);
    expect(res.body.request).toMatchObject({ status: 'under_review', reason: 'forgot_punch' });
  });

  it('liga a solicitação à marcação original quando informada', async () => {
    const { client, calls } = makeSupabase([
      { data: { id: 'punch-original' }, error: null }, // dono da marcação
      { data: null, error: null }, // duplicidade
      { count: 0, error: null },
      {
        data: {
          id: 'ajuste-2',
          type: 'clock_out',
          occurred_at: VALID.occurredAt,
          created_at: '2026-07-29T10:00:00.000Z',
          status: 'under_review',
          correction_reason: 'wrong_time',
          notes: null,
          review_note: null,
          original_punch_id: 'punch-original',
        },
        error: null,
      },
    ]);
    authState.client = client;

    const res = (await POST(
      request({ ...VALID, type: 'clock_out', reason: 'wrong_time', originalPunchId: 'punch-original' }),
    )) as unknown as JsonCall;

    expect(res.status).toBe(201);
    expect(payloadOf(calls)).toMatchObject({ original_punch_id: 'punch-original' });
    // A checagem de posse filtra pela pessoa autenticada.
    expect(calls.some((c) => c.method === 'eq' && c.args[0] === 'person_id' && c.args[1] === 'pessoa-1')).toBe(true);
  });

  it('recusa a marcação original de outra pessoa', async () => {
    const { client } = makeSupabase([{ data: null, error: null }]);
    authState.client = client;

    const res = (await POST(
      request({ ...VALID, originalPunchId: 'punch-de-outro' }),
    )) as unknown as JsonCall;

    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
  });

  it('bloqueia a solicitação duplicada com explicação (Fluxo 6)', async () => {
    const { client } = makeSupabase([{ data: { id: 'ajuste-existente' }, error: null }]);
    authState.client = client;

    const res = (await POST(request(VALID))) as unknown as JsonCall;

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('duplicate');
    expect(String(res.body.error)).toMatch(/já enviou/i);
  });

  it('rejeita motivo fora da lista fechada', async () => {
    authState.client = makeSupabase([]).client;
    const res = (await POST(request({ ...VALID, reason: 'qualquer-coisa' }))) as unknown as JsonCall;
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/motivo/i);
  });

  it('rejeita tipo de marcação inválido', async () => {
    authState.client = makeSupabase([]).client;
    const res = (await POST(request({ ...VALID, type: 'almoço' }))) as unknown as JsonCall;
    expect(res.status).toBe(400);
  });

  it('rejeita horário no futuro', async () => {
    authState.client = makeSupabase([]).client;
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const res = (await POST(request({ ...VALID, occurredAt: future }))) as unknown as JsonCall;
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/futuro/i);
  });

  it('rejeita ajuste com mais de 90 dias', async () => {
    authState.client = makeSupabase([]).client;
    const old = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
    const res = (await POST(request({ ...VALID, occurredAt: old }))) as unknown as JsonCall;
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/90 dias/i);
  });

  it('trava o excesso de solicitações abertas', async () => {
    const { client } = makeSupabase([
      { data: null, error: null },
      { count: 20, error: null },
    ]);
    authState.client = client;
    const res = (await POST(request(VALID))) as unknown as JsonCall;
    expect(res.status).toBe(429);
  });

  it('não deixa passar sem autenticação', async () => {
    authState.ok = false;
    const res = (await POST(request(VALID))) as unknown as JsonCall;
    expect(res.status).toBe(401);
  });
});

describe('GET /api/mobile/adjustment', () => {
  it('lista apenas as solicitações do colaborador e traduz o status fiscal', async () => {
    const { client, calls } = makeSupabase([
      {
        data: [
          {
            id: 'a1',
            type: 'clock_in',
            occurred_at: '2026-07-28T11:00:00.000Z',
            created_at: '2026-07-28T12:00:00.000Z',
            status: 'accepted',
            correction_reason: 'forgot_punch',
            notes: 'Esqueci',
            review_note: 'Confirmado com o encarregado.',
            original_punch_id: null,
          },
          {
            id: 'a2',
            type: 'clock_out',
            occurred_at: '2026-07-27T21:00:00.000Z',
            created_at: '2026-07-27T22:00:00.000Z',
            status: 'cancelled',
            correction_reason: 'no_signal',
            notes: null,
            review_note: 'Sem comprovação de presença.',
            original_punch_id: 'p1',
          },
          {
            id: 'a3',
            type: 'break_end',
            occurred_at: '2026-07-26T14:00:00.000Z',
            created_at: '2026-07-26T15:00:00.000Z',
            status: 'under_review',
            correction_reason: 'inexistente',
            notes: null,
            review_note: null,
            original_punch_id: null,
          },
        ],
        error: null,
      },
    ]);
    authState.client = client;

    const res = (await GET(
      new Request('http://localhost/api/mobile/adjustment'),
    )) as unknown as JsonCall;

    expect(res.status).toBe(200);
    const requests = res.body.requests as Array<Record<string, unknown>>;
    expect(requests.map((r) => r.status)).toEqual(['approved', 'rejected', 'under_review']);
    expect(requests[1].managerNote).toBe('Sem comprovação de presença.');
    // Motivo desconhecido não vaza texto cru para a interface.
    expect(requests[2].reason).toBeNull();
    // Filtro pela pessoa autenticada e pela origem da solicitação.
    expect(calls.some((c) => c.method === 'eq' && c.args[0] === 'person_id' && c.args[1] === 'pessoa-1')).toBe(true);
    expect(calls.some((c) => c.method === 'eq' && c.args[0] === 'source' && c.args[1] === 'web')).toBe(true);
    expect(calls.some((c) => c.method === 'not' && c.args[0] === 'correction_reason')).toBe(true);
  });
});

describe('GET /api/mobile/history', () => {
  function historyRequest(query = ''): Request {
    return new Request(`http://localhost/api/mobile/history${query}`);
  }

  it('lê apenas as marcações do próprio colaborador no período', async () => {
    const { client, calls } = makeSupabase([{ data: [], error: null }]);
    authState.client = client;

    const res = (await HISTORY_GET(
      historyRequest('?from=2026-07-01&to=2026-07-29'),
    )) as unknown as JsonCall;

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ from: '2026-07-01', to: '2026-07-29' });
    expect(calls.some((c) => c.method === 'eq' && c.args[0] === 'person_id' && c.args[1] === 'pessoa-1')).toBe(true);
    expect(calls.some((c) => c.method === 'gte' && c.args[1] === '2026-07-01T00:00:00')).toBe(true);
    expect(calls.some((c) => c.method === 'lte' && c.args[1] === '2026-07-29T23:59:59.999')).toBe(true);
  });

  it('recusa período invertido e janelas longas demais', async () => {
    authState.client = makeSupabase([]).client;
    const inverted = (await HISTORY_GET(
      historyRequest('?from=2026-07-29&to=2026-07-01'),
    )) as unknown as JsonCall;
    expect(inverted.status).toBe(400);

    authState.client = makeSupabase([]).client;
    const tooLong = (await HISTORY_GET(
      historyRequest('?from=2025-01-01&to=2026-07-29'),
    )) as unknown as JsonCall;
    expect(tooLong.status).toBe(400);
    expect(String(tooLong.body.error)).toMatch(/3 meses/i);
  });

  it('só libera desfazer na última marcação viva e dentro de 5 minutos', async () => {
    const recent = new Date(Date.now() - 60_000).toISOString();
    const { client } = makeSupabase([
      {
        data: [
          { id: 'p1', type: 'clock_in', occurred_at: recent, received_at: recent, status: 'accepted' },
          { id: 'p2', type: 'break_start', occurred_at: recent, received_at: recent, status: 'accepted' },
          { id: 'p3', type: 'break_end', occurred_at: recent, received_at: recent, status: 'cancelled' },
        ],
        error: null,
      },
    ]);
    authState.client = client;

    const res = (await HISTORY_GET(historyRequest())) as unknown as JsonCall;
    const punches = res.body.punches as Array<Record<string, unknown>>;
    expect(punches.map((p) => p.can_undo)).toEqual([false, true, false]);
  });

  it('fecha a janela de desfazer depois de 5 minutos', async () => {
    const old = new Date(Date.now() - 10 * 60_000).toISOString();
    const { client } = makeSupabase([
      {
        data: [{ id: 'p1', type: 'clock_in', occurred_at: old, received_at: old, status: 'accepted' }],
        error: null,
      },
    ]);
    authState.client = client;

    const res = (await HISTORY_GET(historyRequest())) as unknown as JsonCall;
    const punches = res.body.punches as Array<Record<string, unknown>>;
    expect(punches[0].can_undo).toBe(false);
  });
});
