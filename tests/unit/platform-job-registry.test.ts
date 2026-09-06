/**
 * Registro tipado de fatos e trabalhos.
 *
 * Tipo ou versão desconhecidos NÃO podem ser interpretados como o vizinho mais
 * próximo: um payload da versão 2 lido com o schema da 1 produz um resultado
 * plausível e errado, que é a pior forma de errar.
 */
import { describe, expect, it } from 'vitest';
import {
  EVENT_TYPES, isEventType, parseEventPayload, UnknownEventVersionError,
} from '@/lib/platform/events/registry';
import {
  JOB_TYPES, isJobType, parseJobPayload, UnknownJobError,
} from '@/lib/platform/jobs/registry';
import { JOB_HANDLERS } from '@/lib/platform/jobs/handlers';
import { SCHEDULED_PRODUCERS } from '@/lib/platform/jobs/producers';

describe('vocabulário de fatos', () => {
  it('todo tipo é <domínio>.<entidade>.<fato_no_passado>', () => {
    for (const type of EVENT_TYPES) {
      expect(type).toMatch(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2,}$/);
    }
  });

  it('a versão NÃO é codificada no nome', () => {
    // `schema_version` é coluna. `..._v2` obrigaria todo consumidor a fazer
    // parsing de string para descobrir o que leu.
    for (const type of EVENT_TYPES) expect(type).not.toMatch(/_v\d+$/);
  });

  /*
    ATUALIZADO NA FASE 6.

    A regra nunca foi "nada de `projects.`": era "nenhum fato sem produtor".
    Quando este teste foi escrito, na Fase 4, `projects.measurement.*` não
    tinha produtor nenhum — declará-lo teria prometido um fato que ninguém
    podia emitir. A Fase 6 trouxe o produtor: as RPCs de transição da migration
    133, que emitem dentro da MESMA transação da mutação.

    `finance.` e `billing.` seguem proibidos, e pela razão original: a Fase 7
    não existe. No dia em que existir, é esta linha que muda — junto com o
    produtor, nunca antes dele.
  */
  it('nenhum fato de fase futura foi declarado antes do produtor existir', () => {
    for (const type of EVENT_TYPES) {
      expect(type.startsWith('finance.')).toBe(false);
      expect(type.startsWith('billing.')).toBe(false);
      expect(type.startsWith('fiscal.')).toBe(false);
      expect(type.startsWith('approvals.')).toBe(false);
    }
  });

  it('todo fato de medição da Fase 6 carrega a identidade da ocorrência', () => {
    /*
      A Fase 7 vai consumir `projects.measurement.accepted` para faturar. Sem
      ocorrência e sem a regra que a rege no payload, o consumidor teria de
      consultar o banco de Projetos para saber O QUE foi aceito — e um fato que
      não se sustenta sozinho não é um fato, é um ponteiro.
    */
    const measurementEvents = EVENT_TYPES.filter((t) => t.startsWith('projects.measurement.'));
    expect(measurementEvents.length).toBeGreaterThan(0);
    for (const type of measurementEvents) {
      const parsed = parseEventPayload(type, 1, {
        project_id: 'proj-1',
        contract_id: '11111111-1111-4111-8111-111111111111',
        contract_measurement_rule_id: '22222222-2222-4222-8222-222222222222',
        occurrence_key: '2026-03',
        occurrence_state: 'resolved',
        revision: 1,
        status: 'ACCEPTED',
        ...(type.endsWith('.accepted')
          ? { accepted_at: '2026-03-31T00:00:00Z', acceptance_source: 'signed_bulletin',
              measurement_basis: 'MONETARY', accumulation_mode: 'INCREMENTAL' }
          : {}),
      });
      expect(parsed).toBeTruthy();
    }
  });

  it('um fato de medição SEM a ocorrência é recusado', () => {
    expect(() => parseEventPayload('projects.measurement.accepted', 1, {
      project_id: 'proj-1', status: 'ACCEPTED',
    })).toThrow();
  });

  it('telemetria de interface não é fato de negócio', () => {
    for (const noise of ['button_clicked', 'screen.opened', 'ui.run_ai']) {
      expect(isEventType(noise)).toBe(false);
    }
  });

  it('versão desconhecida é recusada, nunca aproximada', () => {
    expect(() => parseEventPayload('contracts.amendment.created', 7, {}))
      .toThrow(UnknownEventVersionError);
    expect(() => parseEventPayload('inventado.qualquer.coisa', 1, {}))
      .toThrow(UnknownEventVersionError);
  });
});

describe('vocabulário de trabalho', () => {
  it('todo tipo declarado tem handler, e todo handler tem tipo', () => {
    expect(Object.keys(JOB_HANDLERS).sort()).toEqual([...JOB_TYPES].sort());
  });

  it('cada handler declara em que a repetição deixa de ter efeito', () => {
    // A entrega é at-least-once. Um handler sem base de idempotência escrita é
    // um handler que ninguém conferiu.
    for (const type of JOB_TYPES) {
      expect(JOB_HANDLERS[type].idempotencyBasis.length).toBeGreaterThan(40);
    }
  });

  it('tipo desconhecido não é tipo', () => {
    expect(isJobType('contracts.obligations.materialize')).toBe(true);
    expect(isJobType('qualquer.coisa.inventada')).toBe(false);
  });

  it('versão de payload desconhecida é terminal', () => {
    expect(() => parseJobPayload('contracts.obligations.materialize', 9, {}))
      .toThrow(UnknownJobError);
  });

  it('payload malformado é recusado antes de chegar ao handler', () => {
    expect(() => parseJobPayload('contracts.obligations.materialize', 1, { as_of: '2026-01-01' }))
      .toThrow();
    expect(() => parseJobPayload('contracts.obligation.external_activation.apply', 1,
      { event_id: 'não é uuid', event_type: 'x.y.z', schema_version: 1 })).toThrow();
  });

  it('o horizonte de materialização é limitado no schema', () => {
    // Materializar dez anos à frente encheria a base de ocorrências de
    // contratos que podem nem existir mais.
    expect(() => parseJobPayload('contracts.obligations.materialize', 1,
      { as_of: '2026-01-01', horizon_days: 5000 })).toThrow();
    expect(parseJobPayload('contracts.obligations.materialize', 1,
      { as_of: '2026-01-01', horizon_days: 180 }).horizon_days).toBe(180);
  });
});

describe('produtores agendados', () => {
  it('cada produtor declara por que rodar duas vezes não cria dois trabalhos', () => {
    expect(SCHEDULED_PRODUCERS.length).toBeGreaterThan(0);
    for (const producer of SCHEDULED_PRODUCERS) {
      expect(producer.idempotencyBasis).toMatch(/chave/i);
      // Chave de PERÍODO, nunca o relógio atual.
      expect(producer.idempotencyBasis).not.toMatch(/now\(\)|Date\.now/);
    }
  });
});
