/**
 * Classificação de falha e higiene de mensagem.
 *
 * Duas perguntas, e as duas custam caro quando respondidas errado: repetir o
 * que nunca vai dar certo desperdiça cinco tentativas antes de alguém olhar;
 * persistir a exceção crua vaza, numa coluna permanente, o cabeçalho que
 * causou a falha.
 */
import { describe, expect, it } from 'vitest';
import {
  classifyJobError, sanitizeErrorMessage, RetryableJobError, TerminalJobError,
} from '@/lib/platform/jobs/errors';

describe('o que se repete', () => {
  it('tempo esgotado, 429 e 5xx temporário voltam para a fila', () => {
    for (const status of [408, 429, 500, 502, 503, 504]) {
      expect(classifyJobError(Object.assign(new Error('provedor'), { status })).retryable).toBe(true);
    }
    expect(classifyJobError(new Error('socket hang up')).retryable).toBe(true);
    expect(classifyJobError(new Error('connect ETIMEDOUT 10.0.0.1:443')).retryable).toBe(true);
    expect(classifyJobError(Object.assign(new Error('x'), { code: '40P01' })).retryable).toBe(true);
  });

  it('payload inválido, permissão e 4xx determinístico NÃO se repetem', () => {
    for (const status of [400, 401, 403, 404, 409, 422]) {
      expect(classifyJobError(Object.assign(new Error('pedido'), { status })).retryable).toBe(false);
    }
    // Violação de CHECK é invariante de negócio: repetir produz o mesmo erro.
    expect(classifyJobError(Object.assign(new Error('x'), { code: '23514' })).retryable).toBe(false);
    expect(classifyJobError(new TerminalJobError('unknown_job_type', 'tipo desconhecido')).retryable).toBe(false);
  });

  it('o padrão é NÃO repetir', () => {
    /*
      Repetir por omissão transformaria todo defeito novo e desconhecido em
      cinco execuções silenciosas antes de aparecer. Não repetir o mostra na
      primeira, que é quando ele ainda é barato.
    */
    const classified = classifyJobError(new Error('coisa que ninguém previu'));
    expect(classified.retryable).toBe(false);
    expect(classified.code).toBe('unclassified');
  });

  it('a intenção explícita do handler vence a heurística', () => {
    expect(classifyJobError(new RetryableJobError('provider_busy', 'volte depois')).retryable).toBe(true);
    expect(classifyJobError(new TerminalJobError('bad_input', 'timeout na validação')).retryable).toBe(false);
  });
});

describe('o que NÃO é persistido', () => {
  it('token, chave, JWT e URL de banco somem da mensagem', () => {
    const dirty = [
      'falhou com Authorization: Bearer sk-ant-api03-XYZ0123456789abcdef',
      'chave sk_live_0123456789abcdef rejeitada',
      'token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abcdefghijklm',
      'conexão postgresql://user:senha@db.exemplo.com:5432/postgres recusada',
      '{"password": "hunter2", "api_key": "abc123def456"}',
    ].join(' | ');
    const clean = sanitizeErrorMessage(dirty);

    expect(clean).not.toContain('sk-ant-api03');
    expect(clean).not.toContain('sk_live_');
    expect(clean).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
    expect(clean).not.toContain('senha@db.exemplo.com');
    expect(clean).not.toContain('hunter2');
    expect(clean).not.toContain('abc123def456');
    // A frase continua legível — redigir não é apagar o diagnóstico.
    expect(clean).toContain('recusada');
  });

  it('a mensagem é truncada: coluna permanente não é depósito de despejo', () => {
    expect(sanitizeErrorMessage('x'.repeat(5000)).length).toBeLessThanOrEqual(1000);
  });

  it('a classificação já devolve a mensagem limpa', () => {
    const classified = classifyJobError(new Error('erro com Bearer abcdefghijklmnop'));
    expect(classified.safe).not.toContain('abcdefghijklmnop');
  });
});
