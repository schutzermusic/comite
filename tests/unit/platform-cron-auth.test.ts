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

  it('as DUAS credenciais valem, e cada uma se identifica pela sua classe', () => {
    /*
      Este é o defeito que o módulo tinha: com `APEX_JOBS_SECRET` definido, um
      `CRON_SECRET` VÁLIDO era recusado com 401, porque a escolha era por
      PRECEDÊNCIA e não por acerto. O agendador nativo da hospedagem apresenta
      CRON_SECRET — a fila parava, e o log dizia apenas "não autorizado".

      Não há precedência: há duas classes de chamador, e uma requisição
      autentica se casar com qualquer uma delas.
    */
    process.env.APEX_JOBS_SECRET = 'apex';
    process.env.CRON_SECRET = 'cron';

    const apex = authorizePlatformCron(req({ authorization: 'Bearer apex' }), 't');
    expect(apex.ok).toBe(true);
    if (apex.ok) {
      expect(apex.caller).toBe('apex_jobs');
      expect(apex.secretSource).toBe('APEX_JOBS_SECRET');
    }

    const cron = authorizePlatformCron(req({ authorization: 'Bearer cron' }), 't');
    expect(cron.ok).toBe(true);
    if (cron.ok) {
      expect(cron.caller).toBe('vercel_cron');
      expect(cron.secretSource).toBe('CRON_SECRET');
    }
  });

  it('cada credencial vale sozinha, quando é a única configurada', () => {
    process.env.CRON_SECRET = 'so-cron';
    const cron = authorizePlatformCron(req({ authorization: 'Bearer so-cron' }), 't');
    expect(cron.ok).toBe(true);
    if (cron.ok) expect(cron.caller).toBe('vercel_cron');
    delete process.env.CRON_SECRET;

    process.env.APEX_JOBS_SECRET = 'so-apex';
    const apex = authorizePlatformCron(req({ authorization: 'Bearer so-apex' }), 't');
    expect(apex.ok).toBe(true);
    if (apex.ok) expect(apex.caller).toBe('apex_jobs');
  });

  it('as duas classes seguem SEPARADAS: o segredo de uma não vale pela outra', () => {
    /*
      Duas credenciais aceitas não são uma credencial compartilhada. Quando só
      o segredo do Apex está configurado, apresentar o do cron não passa — e o
      contrário também não. É isso que impede que quem pode acordar um
      agendador possa, por isso, drenar a fila do outro.
    */
    process.env.APEX_JOBS_SECRET = 'apex';
    expect(authorizePlatformCron(req({ authorization: 'Bearer cron' }), 't').ok).toBe(false);
    delete process.env.APEX_JOBS_SECRET;

    process.env.CRON_SECRET = 'cron';
    expect(authorizePlatformCron(req({ authorization: 'Bearer apex' }), 't').ok).toBe(false);
  });

  it('não existe autenticação por query string', () => {
    process.env.APEX_JOBS_SECRET = 'segredo-correto';
    const byQuery = new Request(
      'https://exemplo.test/api/platform/jobs/drain?secret=segredo-correto&token=segredo-correto',
      { method: 'POST' });
    expect(authorizePlatformCron(byQuery, 't').ok).toBe(false);
  });

  it('o cabeçalho x-vercel-cron é DICA de origem, não credencial', () => {
    // Trivialmente forjável por qualquer cliente. Sozinho, não autentica nada.
    process.env.CRON_SECRET = 'cron';
    expect(authorizePlatformCron(req({ 'x-vercel-cron': '1' }), 't').ok).toBe(false);
    expect(authorizePlatformCron(
      req({ 'x-vercel-cron': '1', authorization: 'Bearer errado' }), 't').ok).toBe(false);
  });

  it('nenhum dos dois segredos aparece em resposta ou log, venha qual vier', async () => {
    process.env.APEX_JOBS_SECRET = 'apex-ultra-secreto';
    process.env.CRON_SECRET = 'cron-ultra-secreto';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const result = authorizePlatformCron(req({ authorization: 'Bearer chute' }), 'tag');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const body = JSON.stringify(await result.response.json());
      expect(body).not.toContain('apex-ultra-secreto');
      expect(body).not.toContain('cron-ultra-secreto');
      expect(body).not.toContain('chute');
    }
    const logged = warn.mock.calls.flat().join(' ');
    for (const forbidden of ['apex-ultra-secreto', 'cron-ultra-secreto', 'chute', 'Bearer']) {
      expect(logged).not.toContain(forbidden);
    }
  });

  it('o sucesso devolve a CLASSE, e nunca o valor da credencial', () => {
    process.env.APEX_JOBS_SECRET = 'apex-ultra-secreto';
    const result = authorizePlatformCron(req({ authorization: 'Bearer apex-ultra-secreto' }), 't');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(JSON.stringify(result)).not.toContain('apex-ultra-secreto');
      expect(['vercel_cron', 'apex_jobs']).toContain(result.caller);
    }
  });
});
