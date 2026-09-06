/**
 * Autorização do entrypoint de execução.
 *
 * Uma rota que drena a fila do Apex inteiro não pode ser alcançável por sessão
 * de navegador, por mais permissões que o humano tenha: RBAC responde "o que
 * este usuário pode fazer no produto", e isto não é uma ação de produto.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { authorizePlatformCron } from '@/lib/platform/cron-auth';

const req = (headers: Record<string, string> = {}) =>
  new Request('https://exemplo.test/api/platform/jobs/drain', { method: 'POST', headers });

afterEach(() => {
  delete process.env.APEX_JOBS_SECRET;
  delete process.env.CRON_SECRET;
  vi.restoreAllMocks();
});

describe('o portão', () => {
  it('sem Bearer, recusa', async () => {
    process.env.APEX_JOBS_SECRET = 'segredo-correto';
    const result = authorizePlatformCron(req(), 'test');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });

  it('Bearer errado recusa, e do mesmo tamanho também', async () => {
    process.env.APEX_JOBS_SECRET = 'segredo-correto';
    for (const wrong of ['outro', 'segredo-corretx', 'segredo-correto-mais']) {
      const result = authorizePlatformCron(req({ authorization: `Bearer ${wrong}` }), 'test');
      expect(result.ok).toBe(false);
    }
  });

  it('Bearer correto passa', () => {
    process.env.APEX_JOBS_SECRET = 'segredo-correto';
    expect(authorizePlatformCron(req({ authorization: 'Bearer segredo-correto' }), 'test').ok).toBe(true);
  });

  it('sessão de navegador sozinha não basta', () => {
    process.env.APEX_JOBS_SECRET = 'segredo-correto';
    // Cookie de sessão é exatamente o que um usuário logado tem, e é
    // exatamente o que esta rota ignora.
    const result = authorizePlatformCron(
      req({ cookie: 'sb-access-token=eyJhbGciOi...; sb-refresh-token=abc' }), 'test');
    expect(result.ok).toBe(false);
  });

  it('sem segredo configurado a rota se recusa a rodar', () => {
    const result = authorizePlatformCron(req({ authorization: 'Bearer qualquer' }), 'test');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(503);
  });

  it('a recusa não devolve nem registra o segredo', async () => {
    process.env.APEX_JOBS_SECRET = 'segredo-ultra-secreto';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const result = authorizePlatformCron(req({ authorization: 'Bearer chute-errado' }), 'tag');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const body = await result.response.json();
      expect(JSON.stringify(body)).not.toContain('segredo-ultra-secreto');
      expect(JSON.stringify(body)).not.toContain('chute-errado');
    }
    const logged = warn.mock.calls.flat().join(' ');
    expect(logged).not.toContain('segredo-ultra-secreto');
    expect(logged).not.toContain('chute-errado');
    expect(logged).not.toContain('Bearer');
  });

  it('a Plataforma tem segredo PRÓPRIO; o do Ponto é só o resgate', () => {
    /*
      Compartilhar o segredo do Ponto significaria que quem pode acordar o cron
      do Ponto pode drenar a fila do Apex — alargamento de privilégio
      disfarçado de reuso.
    */
    process.env.APEX_JOBS_SECRET = 'apex';
    process.env.CRON_SECRET = 'ponto';
    expect(authorizePlatformCron(req({ authorization: 'Bearer ponto' }), 't').ok).toBe(false);
    const good = authorizePlatformCron(req({ authorization: 'Bearer apex' }), 't');
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.secretSource).toBe('APEX_JOBS_SECRET');
  });
});
