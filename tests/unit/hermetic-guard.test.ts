/**
 * Regressão: um teste de unidade NÃO pode ler credenciais de produção nem
 * abrir conexão (defeito real: clause-review-impersonation-guard carregava
 * `.env.local` e conectava no pooler de produção, onde tentava UPDATE).
 */
import { describe, expect, it } from 'vitest';
import dotenv from 'dotenv';
import net from 'node:net';
import pg from 'pg';

describe('teste de unidade é hermético por construção', () => {
  it('o ambiente não carrega URL de banco nem chave de serviço', () => {
    expect(process.env.SUPABASE_DB_URL).toBeUndefined();
    expect(process.env.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
    expect(process.env.NEXT_PUBLIC_SUPABASE_URL).toBeUndefined();
    expect(Object.keys(process.env).filter((k) => /^PG[A-Z]+$/.test(k))).toEqual([]);
  });

  it('dotenv não repovoa o ambiente a partir de .env/.env.local', () => {
    const out = dotenv.config({ path: '.env.local' });
    expect(out.parsed).toEqual({});
    dotenv.config({ path: '.env' });
    expect(process.env.SUPABASE_DB_URL).toBeUndefined();
  });

  it('pg não conecta — nem com URL explícita de produção', async () => {
    const client = new pg.Client({ connectionString: 'postgresql://u:p@aws-0-us-east-1.pooler.supabase.com:6543/postgres' });
    await expect(client.connect()).rejects.toThrow(/HERMETIC_UNIT_TEST/);
  });

  it('nenhum socket, nem para a própria máquina (QA local também é banco de verdade)', () => {
    expect(() => net.connect(55422, '127.0.0.1')).toThrow(/HERMETIC_UNIT_TEST/);
  });

  it('fetch de rede recusa; simular continua possível', async () => {
    await expect(fetch('https://xicrkxgalqqpysyynjqi.supabase.co/rest/v1/')).rejects.toThrow(/HERMETIC_UNIT_TEST/);
  });
});
