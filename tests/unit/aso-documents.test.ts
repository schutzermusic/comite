import { describe, expect, it } from 'vitest';
import {
  extractAso,
  isWeakExtraction,
  parsePtBrDate,
  reconcileWithEsocial,
} from '@/lib/workforce/aso-extractor';
import {
  buildAsoAlerts,
  buildAsoDigest,
  summarizeAsoAlerts,
  type AsoAlertDocument,
  type AsoAlertEsocialExam,
  type AsoAlertWorker,
} from '@/lib/workforce/aso-alerts';

const HOJE = new Date('2026-08-13T00:00:00Z');

/** ASO periódico completo, com validade DECLARADA — o caso feliz. */
const asoPeriodico = `
ATESTADO DE SAÚDE OCUPACIONAL - ASO
Empresa: INSIGHT ENERGIA LTDA
Nome: JOSE DA SILVA
CPF: 123.456.789-01
Função: Eletricista
Tipo de Exame: Periódico
Data do Exame Clínico: 10/03/2026
Resultado: APTO para a função
Válido até: 10/03/2027
Dr. Maria Fernanda Souza
CRM: 123456
`;

/** Admissional sem validade escrita — não dá para inferir. */
const asoAdmissional = `
ATESTADO DE SAÚDE OCUPACIONAL
Nome: MARIA APARECIDA
CPF: 987.654.321-00
Exame Admissional
Data do exame: 05/01/2026
Considerado APTO
Dr. Carlos Andrade CRM: 45678
`;

/** Demissional com resultado negativo. */
const asoInapto = `
ASO - Exame Demissional
Funcionário: PEDRO LIMA
Data da avaliação: 20/07/2026
Conclusão: INAPTO
CRM 99887
`;

describe('parsePtBrDate', () => {
  it('lê dd/mm/aaaa e variações', () => {
    expect(parsePtBrDate('10/03/2027')).toBe('2027-03-10');
    expect(parsePtBrDate('5-1-26')).toBe('2026-01-05');
    expect(parsePtBrDate('01.12.2026')).toBe('2026-12-01');
  });

  it('recusa data impossível em vez de corrigir em silêncio', () => {
    // 31/02 vira 03/03 se deixado para o Date; aqui é dado ruim e some.
    expect(parsePtBrDate('31/02/2026')).toBeUndefined();
    expect(parsePtBrDate('sem data')).toBeUndefined();
  });
});

describe('extractAso', () => {
  it('lê o ASO periódico e usa a validade DECLARADA no documento', () => {
    const r = extractAso(asoPeriodico, HOJE);
    expect(r.examDate).toBe('2026-03-10');
    expect(r.examKind).toBe('1');
    expect(r.result).toBe('1');
    expect(r.validUntil).toBe('2027-03-10');
    // O documento declarou: não é inferência nossa.
    expect(r.validityBasis).toBe('declared_document');
    expect(r.cpf).toBe('12345678901');
    expect(r.doctorCrm).toBe('123456');
    expect(r.confidence).toBeGreaterThanOrEqual(0.9);
    expect(isWeakExtraction(r)).toBe(false);
  });

  it('não inventa validade para admissional, e diz por quê', () => {
    const r = extractAso(asoAdmissional, HOJE);
    expect(r.examDate).toBe('2026-01-05');
    expect(r.examKind).toBe('0');
    expect(r.validUntil).toBeUndefined();
    expect(r.validityBasis).toBe('undetermined');
    expect(r.issues.some((i) => i.field === 'validUntil')).toBe(true);
  });

  it('não confunde INAPTO com APTO', () => {
    const r = extractAso(asoInapto, HOJE);
    // "apto" é substring de "inapto"; a ordem errada classificaria todo laudo
    // negativo como positivo.
    expect(r.result).toBe('2');
    expect(r.examKind).toBe('9');
  });

  it('infere validade anual apenas para o exame periódico sem data escrita', () => {
    const semValidade = asoPeriodico.replace('Válido até: 10/03/2027', '');
    const r = extractAso(semValidade, HOJE);
    expect(r.validUntil).toBe('2027-03-10');
    expect(r.validityBasis).toBe('inferred_periodicity');
    expect(r.issues.some((i) => /NR-7/.test(i.reason))).toBe(true);
  });

  it('descarta validade anterior ao exame — é leitura errada de campo', () => {
    const invertido = asoPeriodico.replace('Válido até: 10/03/2027', 'Válido até: 10/03/2025');
    const r = extractAso(invertido, HOJE);
    // Cai para a inferência do periódico, e registra o descarte.
    expect(r.validUntil).toBe('2027-03-10');
    expect(r.issues.some((i) => /anterior à data do exame/.test(i.reason))).toBe(true);
  });

  it('avisa quando a data do exame está no futuro', () => {
    const futuro = asoPeriodico.replace('10/03/2026', '10/03/2036');
    const r = extractAso(futuro, HOJE);
    expect(r.issues.some((i) => /futuro/.test(i.reason))).toBe(true);
  });

  it('marca como fraca a extração sem data de exame', () => {
    const r = extractAso('documento ilegível sem campos', HOJE);
    expect(r.examDate).toBeUndefined();
    expect(isWeakExtraction(r)).toBe(true);
    expect(r.issues.length).toBeGreaterThan(0);
  });
});

describe('reconcileWithEsocial', () => {
  const doc = { examDate: '2026-03-10', examKind: '1' as const, result: '1' as const };

  it('casa com o evento de data mais próxima, não com o mais recente', () => {
    const r = reconcileWithEsocial(doc, [
      { eventId: 'E-ANTIGO', examDate: '2026-03-11', examKind: '1', result: '1' },
      { eventId: 'E-RECENTE', examDate: '2026-07-01', examKind: '1', result: '1' },
    ]);
    // O mais recente casaria todo PDF antigo com o último evento e faria todos
    // aparecerem como divergentes.
    expect(r.eventId).toBe('E-ANTIGO');
    expect(r.matchStatus).toBe('matched');
    expect(r.divergences).toHaveLength(0);
  });

  it('aponta divergência de resultado entre papel e evento', () => {
    const r = reconcileWithEsocial(doc, [
      { eventId: 'E-1', examDate: '2026-03-10', examKind: '1', result: '2' },
    ]);
    expect(r.matchStatus).toBe('divergent');
    expect(r.divergences).toEqual([
      { field: 'result', label: 'Resultado', document: '1', esocial: '2' },
    ]);
  });

  it('tolera diferença de até dois dias na data', () => {
    const r = reconcileWithEsocial(doc, [
      { eventId: 'E-1', examDate: '2026-03-12', examKind: '1', result: '1' },
    ]);
    expect(r.matchStatus).toBe('matched');
  });

  it('declara ausência de evento em vez de forçar um casamento', () => {
    const r = reconcileWithEsocial(doc, []);
    expect(r.matchStatus).toBe('no_esocial_event');
    expect(r.eventId).toBeNull();
  });
});

describe('buildAsoAlerts', () => {
  const workers: AsoAlertWorker[] = [
    { workerKey: 'w1', personId: 'p1', name: 'José da Silva', areaLabel: 'Obra Norte' },
    { workerKey: 'w2', personId: 'p2', name: 'Maria Aparecida', areaLabel: 'Obra Norte' },
    { workerKey: 'w3', personId: 'p3', name: 'Pedro Lima', areaLabel: 'Escritório' },
    { workerKey: 'w4', personId: 'p4', name: 'Ana Costa', areaLabel: 'Escritório' },
  ];

  function doc(over: Partial<AsoAlertDocument> & { id: string; workerKey: string }): AsoAlertDocument {
    return {
      personId: null,
      examDate: '2025-09-01',
      examKind: '1',
      validUntil: null,
      validityBasis: 'declared_document',
      status: 'confirmed',
      ...over,
    };
  }

  it('o documento tem precedência sobre o eSocial — ele declara, o eSocial infere', () => {
    const documents = [doc({ id: 'd1', workerKey: 'w1', validUntil: '2026-12-01' })];
    const esocialExams: AsoAlertEsocialExam[] = [
      // O eSocial deduziria 2026-09-01; o papel diz 2026-12-01.
      { workerKey: 'w1', examDate: '2025-09-01', examKind: '1', validUntil: '2026-09-01' },
    ];
    const [alerta] = buildAsoAlerts({ workers: [workers[0]], documents, esocialExams, reference: HOJE });

    expect(alerta.source).toBe('document');
    expect(alerta.validUntil).toBe('2026-12-01');
    expect(alerta.level).toBe('ok');
    expect(alerta.reason).toMatch(/declarada no documento/);
  });

  it('classifica vencido, crítico, a vencer e em dia pelas janelas', () => {
    const documents = [
      doc({ id: 'd1', workerKey: 'w1', validUntil: '2026-07-01' }), // vencido
      doc({ id: 'd2', workerKey: 'w2', validUntil: '2026-09-01' }), // 19d → crítico
      doc({ id: 'd3', workerKey: 'w3', validUntil: '2026-10-05' }), // 53d → warning
      doc({ id: 'd4', workerKey: 'w4', validUntil: '2027-01-01' }), // ok
    ];
    const alerts = buildAsoAlerts({ workers, documents, esocialExams: [], reference: HOJE });
    const by = Object.fromEntries(alerts.map((a) => [a.workerKey, a.level]));

    expect(by.w1).toBe('expired');
    expect(by.w2).toBe('critical');
    expect(by.w3).toBe('warning');
    expect(by.w4).toBe('ok');
    // Fila de trabalho: o vencido vem primeiro.
    expect(alerts[0].workerKey).toBe('w1');
  });

  it('separa "sem ASO no acervo" de "sem vencimento apurável"', () => {
    const documents = [
      // Admissional sem validade: tem exame, não tem vencimento.
      doc({ id: 'd1', workerKey: 'w1', examKind: '0', validUntil: null, validityBasis: 'undetermined' }),
    ];
    // w2 não tem nada.
    const alerts = buildAsoAlerts({ workers: workers.slice(0, 2), documents, esocialExams: [], reference: HOJE });
    const by = Object.fromEntries(alerts.map((a) => [a.workerKey, a.level]));

    expect(by.w1).toBe('undetermined');
    expect(by.w2).toBe('absent');
    // Nenhum dos dois é "vencido": afirmar isso seria inventar irregularidade.
    expect(alerts.every((a) => a.level !== 'expired')).toBe(true);
  });

  it('ignora documento rejeitado na curadoria', () => {
    const documents = [
      doc({ id: 'd1', workerKey: 'w1', validUntil: '2027-01-01', status: 'rejected' }),
    ];
    const [alerta] = buildAsoAlerts({ workers: [workers[0]], documents, esocialExams: [], reference: HOJE });
    // Foi olhado por uma pessoa e recusado; continuar contando com ele
    // ignoraria a revisão.
    expect(alerta.level).toBe('absent');
  });

  it('usa o exame mais recente quando há vários do mesmo trabalhador', () => {
    const documents = [
      doc({ id: 'd1', workerKey: 'w1', examDate: '2024-01-10', validUntil: '2025-01-10' }),
      doc({ id: 'd2', workerKey: 'w1', examDate: '2026-05-10', validUntil: '2027-05-10' }),
    ];
    const [alerta] = buildAsoAlerts({ workers: [workers[0]], documents, esocialExams: [], reference: HOJE });
    expect(alerta.documentId).toBe('d2');
    expect(alerta.level).toBe('ok');
  });

  it('resume e monta o digest sem afirmar irregularidade onde há lacuna', () => {
    const documents = [
      doc({ id: 'd1', workerKey: 'w1', validUntil: '2026-07-01' }),
      doc({ id: 'd2', workerKey: 'w2', validUntil: '2026-09-01' }),
    ];
    const alerts = buildAsoAlerts({ workers, documents, esocialExams: [], reference: HOJE });
    const summary = summarizeAsoAlerts(alerts);

    expect(summary.expired).toBe(1);
    expect(summary.critical).toBe(1);
    expect(summary.absent).toBe(2);
    expect(summary.actionable).toBe(4);

    const digest = buildAsoDigest(alerts);
    expect(digest.subject).toMatch(/1 ASO\(s\) vencido/);
    expect(digest.html).toContain('José da Silva');
    expect(digest.text).toMatch(/vencido/);
  });
});
