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
  workersFromUnmatchedDocuments,
  type AsoAlertDocument,
  type AsoAlertWorker,
} from '@/lib/workforce/aso-alerts';
import {
  applyAsoEdits,
  assessApprovalReadiness,
  buildApprovalSnapshot,
  confirmedFields,
  documentStatusFor,
  fieldOrigin,
  fieldsFromExtraction,
  nextReviewState,
  suggestedStatusFor,
} from '@/lib/workforce/aso-review';

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
    expect(r.validityDate).toBe('2027-03-10');
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
    expect(r.validityDate).toBeUndefined();
    expect(r.validityBasis).toBe('undetermined');
    expect(r.issues.some((i) => i.field === 'validityDate')).toBe(true);
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
    expect(r.validityDate).toBe('2027-03-10');
    expect(r.validityBasis).toBe('inferred_periodicity');
    expect(r.issues.some((i) => /NR-7/.test(i.reason))).toBe(true);
  });

  it('descarta validade anterior ao exame — é leitura errada de campo', () => {
    const invertido = asoPeriodico.replace('Válido até: 10/03/2027', 'Válido até: 10/03/2025');
    const r = extractAso(invertido, HOJE);
    // Cai para a inferência do periódico, e registra o descarte.
    expect(r.validityDate).toBe('2027-03-10');
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

  it('sem evento, a conferência é NEUTRA — não é pendência do documento', () => {
    const r = reconcileWithEsocial(doc, []);
    // `not_imported` é o estado normal de quem nunca importou pacote nenhum.
    expect(r.matchStatus).toBe('not_imported');
    expect(r.eventId).toBeNull();
    expect(r.summary).toBeNull();
  });

  it('com evento mas sem data no papel, declara "não aplicável" em vez de divergência', () => {
    const r = reconcileWithEsocial(
      { examDate: undefined, examKind: '1', result: '1' },
      [{ eventId: 'E-1', examDate: '2026-03-10', examKind: '1', result: '1' }],
    );
    // Escolher um evento arbitrário aqui produziria uma divergência inventada.
    expect(r.matchStatus).toBe('not_applicable');
    expect(r.divergences).toHaveLength(0);
  });

  it('tolera convenção de nome diferente e só acusa pessoa realmente distinta', () => {
    const igual = reconcileWithEsocial(
      { ...doc, workerName: 'SILVA, José da' },
      [{ eventId: 'E-1', examDate: '2026-03-10', examKind: '1', result: '1', workerName: 'Jose da Silva' }],
    );
    expect(igual.matchStatus).toBe('matched');

    const outro = reconcileWithEsocial(
      { ...doc, workerName: 'José da Silva' },
      [{ eventId: 'E-1', examDate: '2026-03-10', examKind: '1', result: '1', workerName: 'Pedro Lima' }],
    );
    expect(outro.matchStatus).toBe('divergent');
    expect(outro.divergences.map((d) => d.field)).toContain('worker');
    expect(outro.summary).toMatch(/não perde validade/);
  });
});

describe('extractAso — campos do documento além das datas', () => {
  const completo = `
ATESTADO DE SAÚDE OCUPACIONAL - ASO
Empresa: INSIGHT ENERGIA LTDA
CNPJ: 12.345.678/0001-99
Clínica: CENTRO MEDICO OCUPACIONAL SAO PAULO
Nome: JOSE DA SILVA
CPF: 123.456.789-01
Matrícula: 004512
Tipo de Exame: Periódico
Riscos ocupacionais: ruído; poeira mineral; eletricidade
Data do Exame Clínico: 10/03/2026
Resultado: APTO para a função
Válido até: 10/03/2027
Dr. Maria Fernanda Souza CRM: 123456
`;

  it('lê clínica, CNPJ, matrícula e riscos ocupacionais', () => {
    const r = extractAso(completo, HOJE);
    expect(r.clinicName).toBe('CENTRO MEDICO OCUPACIONAL SAO PAULO');
    expect(r.companyCnpj).toBe('12345678000199');
    expect(r.workerRegistration).toBe('004512');
    expect(r.occupationalRisks).toEqual(['ruído', 'poeira mineral', 'eletricidade']);
  });

  it('não confunde a clínica com o empregador', () => {
    const r = extractAso(completo, HOJE);
    // São dois rótulos distintos no papel; trocá-los faria o ASO parecer
    // emitido pela própria empresa que ele fiscaliza.
    expect(r.companyName).toBe('INSIGHT ENERGIA LTDA');
    expect(r.clinicName).not.toBe(r.companyName);
  });

  it('deixa riscos ausentes como ausentes, sem deduzir da função', () => {
    const r = extractAso(asoAdmissional, HOJE);
    expect(r.occupationalRisks).toBeUndefined();
  });
});

describe('buildAsoAlerts — o documento manda, o eSocial é opcional', () => {
  const workers: AsoAlertWorker[] = [
    { workerKey: 'person:p1', personId: 'p1', name: 'José da Silva', areaLabel: 'Obra Norte' },
    { workerKey: 'person:p2', personId: 'p2', name: 'Maria Aparecida', areaLabel: 'Obra Norte' },
    { workerKey: 'person:p3', personId: 'p3', name: 'Pedro Lima', areaLabel: 'Escritório' },
    { workerKey: 'person:p4', personId: 'p4', name: 'Ana Costa', areaLabel: 'Escritório' },
  ];

  function doc(
    over: Partial<AsoAlertDocument> & { id: string; personId: string },
  ): AsoAlertDocument {
    return {
      workerKey: null,
      examDate: '2025-09-01',
      examKind: '1',
      validityDate: null,
      validityBasis: 'declared_document',
      documentStatus: 'approved',
      ...over,
    };
  }

  it('apura vencimento SEM nenhum evento do eSocial no acervo', () => {
    const documents = [doc({ id: 'd1', personId: 'p1', validityDate: '2026-12-01' })];
    // Sem `esocialExams`: é o caso de quem nunca importou pacote nenhum.
    const [alerta] = buildAsoAlerts({ workers: [workers[0]], documents, reference: HOJE });

    expect(alerta.level).toBe('ok');
    expect(alerta.source).toBe('document');
    expect(alerta.validityDate).toBe('2026-12-01');
    expect(alerta.esocial.status).toBe('not_imported');
    expect(alerta.reason).toMatch(/declarada no documento/);
  });

  it('classifica vencido, 30d, 60d e em dia pelas janelas', () => {
    const documents = [
      doc({ id: 'd1', personId: 'p1', validityDate: '2026-07-01' }), // vencido
      doc({ id: 'd2', personId: 'p2', validityDate: '2026-09-01' }), // 19d
      doc({ id: 'd3', personId: 'p3', validityDate: '2026-10-05' }), // 53d
      doc({ id: 'd4', personId: 'p4', validityDate: '2027-01-01' }), // ok
    ];
    const alerts = buildAsoAlerts({ workers, documents, reference: HOJE });
    const by = Object.fromEntries(alerts.map((a) => [a.personId, a.level]));

    expect(by.p1).toBe('expired');
    expect(by.p2).toBe('expiring_30');
    expect(by.p3).toBe('expiring_60');
    expect(by.p4).toBe('ok');
    // Fila de trabalho: o vencido vem primeiro.
    expect(alerts[0].personId).toBe('p1');
  });

  it('documento pendente de revisão NÃO sustenta vencimento', () => {
    const documents = [
      doc({ id: 'd1', personId: 'p1', validityDate: '2027-01-01', documentStatus: 'pending_review' }),
    ];
    const [alerta] = buildAsoAlerts({ workers: [workers[0]], documents, reference: HOJE });

    // Tem data lida e ela está no futuro — mas ninguém conferiu ainda, e "em
    // dia" é uma afirmação que só a revisão humana pode produzir.
    expect(alerta.level).toBe('pending_review');
    expect(alerta.validityDate).toBeNull();
    expect(alerta.documentStatus).toBe('pending_review');
  });

  it('separa rejeitado, a corrigir e documento não enviado', () => {
    const documents = [
      doc({ id: 'd1', personId: 'p1', validityDate: '2027-01-01', documentStatus: 'rejected' }),
      doc({ id: 'd2', personId: 'p2', validityDate: '2027-01-01', documentStatus: 'needs_correction' }),
    ];
    const alerts = buildAsoAlerts({ workers: workers.slice(0, 3), documents, reference: HOJE });
    const by = Object.fromEntries(alerts.map((a) => [a.personId, a.level]));

    expect(by.p1).toBe('needs_correction');
    expect(by.p2).toBe('needs_correction');
    expect(by.p3).toBe('no_document');
    // Nenhum deles é "vencido": afirmar isso seria inventar irregularidade.
    expect(alerts.every((a) => a.level !== 'expired')).toBe(true);
  });

  it('"documento não enviado" continua sendo isso mesmo quando há S-2220', () => {
    const alerts = buildAsoAlerts({
      workers: [workers[0]],
      documents: [],
      esocialExams: [
        { workerKey: 'person:p1', examDate: '2026-01-10', examKind: '1', validityDate: '2027-01-10', eventId: 'E-1' },
      ],
      reference: HOJE,
    });
    // O evento existe e até permite deduzir uma data — mas o controle é do
    // papel, e sem papel a linha é pendência de acervo, não "em dia".
    expect(alerts[0].level).toBe('no_document');
    expect(alerts[0].documentStatus).toBe('missing');
    expect(alerts[0].reason).toMatch(/Documento não enviado/);
    expect(alerts[0].reason).toMatch(/S-2220/);
  });

  it('aprovado sem validade apurável não é irregularidade', () => {
    const documents = [
      doc({ id: 'd1', personId: 'p1', examKind: '0', validityDate: null, validityBasis: 'undetermined' }),
    ];
    const [alerta] = buildAsoAlerts({ workers: [workers[0]], documents, reference: HOJE });
    expect(alerta.level).toBe('no_validity');
    expect(alerta.reason).toMatch(/Não é irregularidade/);
  });

  it('um aprovado vence um pendente mais novo do mesmo colaborador', () => {
    const documents = [
      doc({ id: 'd-aprovado', personId: 'p1', examDate: '2026-01-10', validityDate: '2027-01-10' }),
      doc({
        id: 'd-pendente', personId: 'p1', examDate: '2026-06-10',
        validityDate: '2027-06-10', documentStatus: 'pending_review',
      }),
    ];
    const [alerta] = buildAsoAlerts({ workers: [workers[0]], documents, reference: HOJE });
    // O que sustenta indicador é o que passou por revisão, não o mais recente.
    expect(alerta.documentId).toBe('d-aprovado');
    expect(alerta.level).toBe('ok');
  });

  it('divergência com o S-2220 é aviso paralelo, e não muda o nível', () => {
    const documents = [
      doc({
        id: 'd1', personId: 'p1', validityDate: '2027-01-01',
        esocialMatchStatus: 'divergent', esocialEventId: 'E-1',
        divergenceSummary: 'diverge no resultado',
      }),
    ];
    const [alerta] = buildAsoAlerts({ workers: [workers[0]], documents, reference: HOJE });

    expect(alerta.level).toBe('ok');
    expect(alerta.esocial.status).toBe('divergent');
    expect(alerta.esocial.summary).toBe('diverge no resultado');
    expect(summarizeAsoAlerts([alerta]).esocialDivergent).toBe(1);
  });

  it('resume e monta o digest sem afirmar irregularidade onde há lacuna', () => {
    const documents = [
      doc({ id: 'd1', personId: 'p1', validityDate: '2026-07-01' }),
      doc({ id: 'd2', personId: 'p2', validityDate: '2026-09-01' }),
    ];
    const alerts = buildAsoAlerts({ workers, documents, reference: HOJE });
    const summary = summarizeAsoAlerts(alerts);

    expect(summary.expired).toBe(1);
    expect(summary.expiring30).toBe(1);
    expect(summary.noDocument).toBe(2);
    expect(summary.actionable).toBe(4);

    const digest = buildAsoDigest(alerts);
    expect(digest.subject).toMatch(/1 ASO\(s\) vencido/);
    expect(digest.html).toContain('José da Silva');
    expect(digest.html).toMatch(/documento não enviado/);
    expect(digest.text).toMatch(/Conferência com o eSocial é opcional/);
  });
});

describe('workersFromUnmatchedDocuments', () => {
  it('põe na fila o ASO de quem ainda não está no cadastro', () => {
    const documents: AsoAlertDocument[] = [
      {
        id: 'd1', workerKey: 'hash-x', personId: null, examDate: '2026-03-10',
        examKind: '1', validityDate: '2027-03-10', validityBasis: 'declared_document',
        documentStatus: 'approved',
      },
    ];
    const extra = workersFromUnmatchedDocuments(documents, [], () => 'JOSE DA SILVA');
    expect(extra).toHaveLength(1);
    expect(extra[0].workerKey).toBe('hash-x');

    // E a fila resultante controla o vencimento, sem cadastro e sem eSocial.
    const [alerta] = buildAsoAlerts({ workers: extra, documents, reference: HOJE });
    expect(alerta.level).toBe('ok');
    expect(alerta.name).toBe('JOSE DA SILVA');
  });

  it('não duplica quem já está coberto por uma pessoa do cadastro', () => {
    const documents: AsoAlertDocument[] = [
      {
        id: 'd1', workerKey: null, personId: 'p1', examDate: '2026-03-10',
        examKind: '1', validityDate: '2027-03-10', validityBasis: 'declared_document',
        documentStatus: 'approved',
      },
    ];
    const known: AsoAlertWorker[] = [
      { workerKey: 'person:p1', personId: 'p1', name: 'José', areaLabel: null },
    ];
    expect(workersFromUnmatchedDocuments(documents, known)).toHaveLength(0);
  });
});

describe('curadoria humana — as duas camadas de campos', () => {
  const extracted = fieldsFromExtraction(extractAso(asoPeriodico, HOJE));

  it('a correção não apaga a leitura original', () => {
    const r = applyAsoEdits(extracted, {}, { examDate: '11/03/2026' });

    expect(r.errors).toHaveLength(0);
    expect(r.reviewed.examDate).toBe('2026-03-11');
    // A leitura da máquina continua intacta e recuperável.
    expect(extracted.examDate).toBe('2026-03-10');
    expect(fieldOrigin('examDate', extracted, r.reviewed)).toBe('corrected');
    expect(fieldOrigin('doctorName', extracted, r.reviewed)).toBe('extracted');
  });

  it('data de validade digitada por uma pessoa é DECLARADA, não inferida', () => {
    const semValidade = fieldsFromExtraction(
      extractAso(asoPeriodico.replace('Válido até: 10/03/2027', ''), HOJE),
    );
    expect(semValidade.validityBasis).toBe('inferred_periodicity');

    const r = applyAsoEdits(semValidade, {}, { validityDate: '30/04/2027' });
    // Quem digitou está lendo o papel que o extrator não leu: é a mesma
    // natureza da data impressa.
    expect(r.effective.validityDate).toBe('2027-04-30');
    expect(r.effective.validityBasis).toBe('declared_document');
  });

  it('apagar a validade devolve à regra determinística, nunca ao valor anterior', () => {
    const r = applyAsoEdits(extracted, {}, { validityDate: null });
    // Periódico → 12 meses da NR-7, e marcado como premissa nossa.
    expect(r.effective.validityDate).toBe('2027-03-10');
    expect(r.effective.validityBasis).toBe('inferred_periodicity');
  });

  it('apagar a validade de um exame sem periodicidade deixa "não apurável"', () => {
    const admissional = fieldsFromExtraction(extractAso(asoAdmissional, HOJE));
    const r = applyAsoEdits(admissional, {}, { validityDate: null });
    expect(r.effective.validityDate).toBeNull();
    expect(r.effective.validityBasis).toBe('undetermined');
  });

  it('recusa a correção inteira quando um campo é inválido', () => {
    const r = applyAsoEdits(extracted, {}, {
      examDate: '10/03/2026',
      validityDate: '01/01/2020',
    });
    expect(r.errors).toHaveLength(1);
    // Tudo ou nada: aplicar só a parte válida deixaria o documento num estado
    // que ninguém pediu.
    expect(r.changed).toHaveLength(0);
    expect(r.reviewed).toEqual({});
  });

  it('recusa data impossível em vez de deslizar para outra', () => {
    const r = applyAsoEdits(extracted, {}, { examDate: '31/02/2026' });
    expect(r.errors[0].field).toBe('examDate');
  });
});

describe('curadoria humana — ações de revisão', () => {
  const pendente = { reviewStatus: 'pending' as const, reviewedBy: null, reviewedAt: null };
  const actor = { userId: 'user-1', at: '2026-08-13T12:00:00.000Z' };

  it('editar campos NÃO aprova o documento', () => {
    const r = nextReviewState('edit', pendente, actor, { fields: ['examDate'] });
    // A separação impede que uma correção de digitação vire, sem querer, um
    // atestado de aptidão validado.
    expect(r.reviewStatus).toBe('pending');
    expect(r.documentStatus).toBe('pending_review');
    expect(r.reviewedBy).toBeNull();
  });

  it('aprovar carimba o revisor e o instante', () => {
    const r = nextReviewState('approve', pendente, actor);
    expect(r.reviewStatus).toBe('approved');
    expect(r.documentStatus).toBe('approved');
    expect(r.reviewedBy).toBe('user-1');
    expect(r.reviewedAt).toBe(actor.at);
    expect(r.entry).toMatchObject({ action: 'approve', by: 'user-1' });
  });

  it('pedir correção e rejeitar são estados distintos', () => {
    expect(nextReviewState('request_correction', pendente, actor).documentStatus)
      .toBe('needs_correction');
    expect(nextReviewState('reject', pendente, actor).documentStatus).toBe('rejected');
  });

  it('corrigir um documento devolvido o reabre para revisão', () => {
    const devolvido = {
      reviewStatus: 'correction_requested' as const,
      reviewedBy: 'user-9',
      reviewedAt: '2026-08-01T00:00:00.000Z',
    };
    const r = nextReviewState('edit', devolvido, actor, { fields: ['validityDate'] });
    expect(r.reviewStatus).toBe('pending');
    expect(r.reviewedBy).toBeNull();
  });

  it('reabrir um aprovado tira o carimbo do revisor', () => {
    const aprovado = {
      reviewStatus: 'approved' as const,
      reviewedBy: 'user-9',
      reviewedAt: '2026-08-01T00:00:00.000Z',
    };
    const r = nextReviewState('reopen', aprovado, actor);
    expect(r.reviewStatus).toBe('pending');
    expect(r.reviewedBy).toBeNull();
    expect(r.reviewedAt).toBeNull();
  });

  it('documentStatusFor espelha a projeção do trigger da migration 089', () => {
    expect(documentStatusFor('pending')).toBe('pending_review');
    expect(documentStatusFor('approved')).toBe('approved');
    expect(documentStatusFor('rejected')).toBe('rejected');
    expect(documentStatusFor('correction_requested')).toBe('needs_correction');
  });
});

describe('portão de aprovação — confirmar no envio sem virar autoaprovação', () => {
  const bomFields = fieldsFromExtraction(extractAso(asoPeriodico, HOJE));

  function gate(over: Partial<Parameters<typeof assessApprovalReadiness>[0]> = {}) {
    return assessApprovalReadiness({
      fields: bomFields,
      personId: 'p1',
      extractionConfidence: 1,
      extractionMethod: 'text_layer',
      documentId: 'd1',
      today: HOJE,
      ...over,
    });
  }

  it('documento completo e bem lido é confirmável e entra em lote', () => {
    const r = gate();
    expect(r.issues).toHaveLength(0);
    expect(r.eligibleForConfirmation).toBe(true);
    expect(r.eligibleForBulk).toBe(true);
    expect(r.requiresAcknowledgement).toBe(false);
  });

  it('colaborador não vinculado é IMPEDITIVO', () => {
    const r = gate({ personId: null });
    expect(r.eligibleForConfirmation).toBe(false);
    expect(r.blockers.map((b) => b.code)).toContain('unmatched_employee');
  });

  it('leitura abaixo do piso de confiança é impeditivo', () => {
    const r = gate({ extractionConfidence: 0.3 });
    expect(r.eligibleForConfirmation).toBe(false);
    expect(r.blockers.map((b) => b.code)).toContain('low_confidence');
  });

  it('não cobra confiança de documento já corrigido à mão', () => {
    // A confiança descreve a leitura ORIGINAL; cobrá-la depois da correção
    // puniria exatamente quem fez o trabalho de conferir.
    const r = gate({ extractionConfidence: 0.3, extractionMethod: 'manual' });
    expect(r.blockers.map((b) => b.code)).not.toContain('low_confidence');
    expect(r.eligibleForConfirmation).toBe(true);
  });

  it('resultado, tipo e data ausentes são impeditivos, cada um com seu campo', () => {
    const r = gate({ fields: { ...bomFields, result: null, examKind: null, examDate: null } });
    const codes = r.blockers.map((b) => b.code);
    expect(codes).toContain('missing_result');
    expect(codes).toContain('unclear_exam_kind');
    expect(codes).toContain('missing_exam_date');
    // Cada impeditivo aponta o campo que o dissolve: nenhum documento fica preso.
    expect(r.blockers.filter((b) => b.field).length).toBeGreaterThan(0);
  });

  it('data de exame no futuro é impeditivo', () => {
    const r = gate({ fields: { ...bomFields, examDate: '2027-01-01' } });
    expect(r.blockers.map((b) => b.code)).toContain('inconsistent_dates');
  });

  it('outro ASO do mesmo exame é impeditivo', () => {
    const r = gate({
      siblings: [{ id: 'd2', examDate: '2026-03-11', documentStatus: 'approved' }],
    });
    expect(r.blockers.map((b) => b.code)).toContain('conflicting_document');
  });

  it('irmão REJEITADO não conflita — ele já foi descartado por uma pessoa', () => {
    const r = gate({
      siblings: [{ id: 'd2', examDate: '2026-03-10', documentStatus: 'rejected' }],
    });
    expect(r.blockers.map((b) => b.code)).not.toContain('conflicting_document');
  });

  it('ASO sem validade é RESSALVA, não impeditivo — admissional é caso legítimo', () => {
    const admissional = fieldsFromExtraction(extractAso(asoAdmissional, HOJE));
    const r = gate({ fields: admissional });

    // Se isto bloqueasse, todo admissional ficaria eternamente pendente.
    expect(r.eligibleForConfirmation).toBe(true);
    expect(r.requiresAcknowledgement).toBe(true);
    expect(r.eligibleForBulk).toBe(false);
    expect(r.cautions.map((c) => c.code)).toEqual(['missing_validity']);
  });

  it('impeditivo com campo vira pedido de correção; sem campo, fica pendente', () => {
    expect(suggestedStatusFor(gate({ fields: { ...bomFields, result: null } })))
      .toBe('correction_requested');
    expect(suggestedStatusFor(gate({ extractionConfidence: 0.2 }))).toBe('pending');
    expect(suggestedStatusFor(gate())).toBe('pending');
  });

  it('o portão não tem caminho que APROVE — ele só diz se o clique é permitido', () => {
    const r = gate();
    // Nenhuma chave do resultado carrega decisão ou revisor: quem aprova é a
    // rota, com o usuário autenticado da requisição.
    expect(Object.keys(r).sort()).toEqual(
      ['blockers', 'cautions', 'eligibleForBulk', 'eligibleForConfirmation', 'issues', 'requiresAcknowledgement'],
    );
  });
});

describe('confirmação pelo RH — o que fica gravado', () => {
  const extracted = fieldsFromExtraction(extractAso(asoPeriodico, HOJE));
  const actor = { userId: 'rh-1', at: '2026-08-13T12:00:00.000Z' };

  it('confirmar no envio carimba revisor e instante', () => {
    const r = nextReviewState(
      'approve',
      { reviewStatus: 'pending', reviewedBy: null, reviewedAt: null },
      actor,
    );
    expect(r.reviewStatus).toBe('approved');
    expect(r.documentStatus).toBe('approved');
    expect(r.reviewedBy).toBe('rh-1');
    expect(r.reviewedAt).toBe(actor.at);
  });

  it('sem usuário não há aprovação possível — o estado nasce sem revisor', () => {
    // O sistema não tem um "usuário sistema": `nextReviewState` exige o actor,
    // e a constraint da 089 recusa `approved` com reviewed_by nulo. As duas
    // pontas fecham a mesma porta.
    const semDecisao = nextReviewState(
      'edit',
      { reviewStatus: 'pending', reviewedBy: null, reviewedAt: null },
      actor,
      { fields: ['examDate'] },
    );
    expect(semDecisao.reviewStatus).not.toBe('approved');
    expect(semDecisao.reviewedBy).toBeNull();
  });

  it('confirmar copia o conjunto inteiro para reviewed_fields_json', () => {
    const confirmado = confirmedFields(extracted, {});
    expect(confirmado.examDate).toBe('2026-03-10');
    expect(confirmado.result).toBe('1');
    expect(confirmado.validityDate).toBe('2027-03-10');
  });

  it('depois de confirmar ainda dá para separar o que foi corrigido do que foi só aceito', () => {
    const corrigido = applyAsoEdits(extracted, {}, { doctorName: 'Outro Médico' });
    const confirmado = confirmedFields(
      { ...extracted, doctorName: 'Outro Médico' },
      corrigido.reviewed,
    );

    // Sem esta distinção, confirmar um lote faria todo campo parecer digitado à
    // mão e apagaria a medida de acerto do extrator.
    expect(fieldOrigin('doctorName', extracted, confirmado)).toBe('corrected');
    expect(fieldOrigin('examDate', extracted, confirmado)).toBe('confirmed');
  });

  it('a leitura da máquina sobrevive à confirmação', () => {
    const confirmado = confirmedFields({ ...extracted, examDate: '2026-04-01' }, {});
    // `extracted` é a evidência e não é tocada por nada disto.
    expect(extracted.examDate).toBe('2026-03-10');
    expect(confirmado.examDate).toBe('2026-04-01');
  });
});

describe('lote — só o que não tem ressalva nenhuma', () => {
  const bom = fieldsFromExtraction(extractAso(asoPeriodico, HOJE));
  const semValidade = fieldsFromExtraction(extractAso(asoAdmissional, HOJE));

  const candidatos = [
    { id: 'limpo', fields: bom, personId: 'p1', confidence: 1 },
    { id: 'com-ressalva', fields: semValidade, personId: 'p2', confidence: 1 },
    { id: 'sem-vinculo', fields: bom, personId: null, confidence: 1 },
    { id: 'ilegivel', fields: bom, personId: 'p4', confidence: 0.2 },
  ];

  it('exclui do lote qualquer documento com ressalva ou impeditivo', () => {
    const elegiveis = candidatos.filter(
      (c) =>
        assessApprovalReadiness({
          fields: c.fields,
          personId: c.personId,
          extractionConfidence: c.confidence,
          extractionMethod: 'text_layer',
          documentId: c.id,
          today: HOJE,
        }).eligibleForBulk,
    );
    expect(elegiveis.map((c) => c.id)).toEqual(['limpo']);
  });

  it('o de ressalva leve continua confirmável — individualmente, com ciência', () => {
    const r = assessApprovalReadiness({
      fields: semValidade,
      personId: 'p2',
      extractionConfidence: 1,
      extractionMethod: 'text_layer',
      today: HOJE,
    });
    expect(r.eligibleForBulk).toBe(false);
    expect(r.eligibleForConfirmation).toBe(true);
  });
});

describe('o S-2220 não participa da confirmação nem do vencimento', () => {
  const bom = fieldsFromExtraction(extractAso(asoPeriodico, HOJE));

  it('o portão não olha o eSocial — confirmar não depende de evento nenhum', () => {
    const r = assessApprovalReadiness({
      fields: bom,
      personId: 'p1',
      extractionConfidence: 1,
      extractionMethod: 'text_layer',
      today: HOJE,
    });
    // Nenhum código de ressalva menciona eSocial: divergência é alerta, e
    // ausência de evento é o estado normal de quem nunca importou.
    expect(r.issues.map((i) => i.code)).toHaveLength(0);
    expect(r.eligibleForConfirmation).toBe(true);
  });

  it('documento confirmado gera vencimento; pendente não, mesmo com S-2220', () => {
    const worker = { workerKey: 'person:p1', personId: 'p1', name: 'José', areaLabel: null };
    const base = {
      workerKey: null, personId: 'p1', examDate: '2026-03-10', examKind: '1',
      validityDate: '2027-03-10',
      validityBasis: 'declared_document' as const,
    };
    const esocialExams = [
      { workerKey: 'person:p1', examDate: '2026-03-10', examKind: '1', validityDate: '2027-03-10', eventId: 'E-1' },
    ];

    const [confirmado] = buildAsoAlerts({
      workers: [worker],
      documents: [{ ...base, id: 'd1', documentStatus: 'approved' }],
      esocialExams,
      reference: HOJE,
    });
    expect(confirmado.level).toBe('ok');
    expect(confirmado.validityDate).toBe('2027-03-10');

    const [pendente] = buildAsoAlerts({
      workers: [worker],
      documents: [{ ...base, id: 'd1', documentStatus: 'pending_review' }],
      esocialExams,
      reference: HOJE,
    });
    // O S-2220 está lá, com data e tudo — e mesmo assim não produz "em dia".
    expect(pendente.level).toBe('pending_review');
    expect(pendente.validityDate).toBeNull();
  });
});

describe('trilha de auditoria da aprovação', () => {
  const semValidade = fieldsFromExtraction(extractAso(asoAdmissional, HOJE));
  const bom = fieldsFromExtraction(extractAso(asoPeriodico, HOJE));
  const AT = '2026-08-13T12:00:00.000Z';

  const readinessComRessalva = assessApprovalReadiness({
    fields: semValidade, personId: 'p2', extractionConfidence: 1,
    extractionMethod: 'text_layer', today: HOJE,
  });
  const readinessLimpo = assessApprovalReadiness({
    fields: bom, personId: 'p1', extractionConfidence: 1,
    extractionMethod: 'text_layer', today: HOJE,
  });

  it('carimba cada ressalva reconhecida com quem aceitou e quando', () => {
    const snap = buildApprovalSnapshot(readinessComRessalva, {
      mode: 'individual', userId: 'rh-1', at: AT,
    });

    expect(snap.cautions).toHaveLength(1);
    const [c] = snap.cautions;
    expect(c.code).toBe('missing_validity');
    expect(c.field).toBe('validityDate');
    expect(c.acknowledged_by).toBe('rh-1');
    expect(c.acknowledged_at).toBe(AT);
    // A prova é o texto que a pessoa viu, não a chave: a redação muda entre
    // versões e o código sozinho não descreve o que foi aceito.
    expect(c.message).toMatch(/sem controle de vencimento/i);
  });

  it('registra o modo — lote e individual não são a mesma evidência', () => {
    expect(buildApprovalSnapshot(readinessLimpo, { mode: 'bulk', userId: 'rh-1', at: AT }))
      .toMatchObject({ mode: 'bulk', eligibleForBulk: true, blockers: [], cautions: [] });
    expect(buildApprovalSnapshot(readinessComRessalva, { mode: 'individual', userId: 'rh-1', at: AT }))
      .toMatchObject({ mode: 'individual', eligibleForBulk: false });
  });

  it('numa aprovação os blockers são sempre vazios — o portão não deixa passar', () => {
    const snap = buildApprovalSnapshot(readinessComRessalva, {
      mode: 'individual', userId: 'rh-1', at: AT,
    });
    expect(snap.blockers).toEqual([]);
  });

  it('o retrato entra na trilha da aprovação', () => {
    const snap = buildApprovalSnapshot(readinessComRessalva, {
      mode: 'individual', userId: 'rh-1', at: AT,
    });
    const r = nextReviewState(
      'approve',
      { reviewStatus: 'pending', reviewedBy: null, reviewedAt: null },
      { userId: 'rh-1', at: AT },
      { approval: snap },
    );

    expect(r.entry.approval).toEqual(snap);
    expect(r.entry.by).toBe('rh-1');
    expect(r.entry.at).toBe(AT);
    // O carimbo da entrada e o da ressalva descrevem o mesmo instante e a mesma
    // pessoa: se divergissem, a trilha contaria duas histórias.
    expect(r.entry.approval?.cautions[0].acknowledged_by).toBe(r.entry.by);
    expect(r.entry.approval?.cautions[0].acknowledged_at).toBe(r.entry.at);
  });

  it('nenhuma outra ação carrega retrato de aprovação', () => {
    const snap = buildApprovalSnapshot(readinessLimpo, { mode: 'individual', userId: 'rh-1', at: AT });
    for (const acao of ['reject', 'request_correction', 'edit', 'reopen'] as const) {
      const r = nextReviewState(
        acao,
        { reviewStatus: 'pending', reviewedBy: null, reviewedAt: null },
        { userId: 'rh-1', at: AT },
        { approval: snap },
      );
      // Um retrato de aprovação numa entrada de rejeição é evidência falsa
      // esperando para ser lida errada.
      expect(r.entry.approval).toBeUndefined();
    }
  });

  it('a trilha é append-only: a aprovação não apaga o que veio antes', () => {
    const anterior = nextReviewState(
      'request_correction',
      { reviewStatus: 'pending', reviewedBy: null, reviewedAt: null },
      { userId: 'rh-9', at: '2026-08-01T00:00:00.000Z' },
    );
    const aprovacao = nextReviewState(
      'approve',
      { reviewStatus: 'pending', reviewedBy: null, reviewedAt: null },
      { userId: 'rh-1', at: AT },
      { approval: buildApprovalSnapshot(readinessLimpo, { mode: 'individual', userId: 'rh-1', at: AT }) },
    );

    const trilha = [anterior.entry, aprovacao.entry];
    expect(trilha).toHaveLength(2);
    expect(trilha[0].action).toBe('request_correction');
    expect(trilha[0].approval).toBeUndefined();
    expect(trilha[1].approval?.mode).toBe('individual');
  });
});
