import { describe, expect, it } from 'vitest';
import { parseEsocialEvents } from '@/lib/esocial/connector/parser';
import { asoPeriodMonths, asoValidUntil, buildSstEvents } from '@/lib/esocial/connector/sst';
import { normalizeEvents } from '@/lib/esocial/connector/normalizer';
import {
  asoStatusByWorker,
  summarizeSst,
  type SstEvent,
  type SstWorker,
} from '@/lib/workforce/sst';

const cat = `<?xml version="1.0"?>
<eSocial><evtCAT Id="ID-CAT-1">
  <ideEvento><indRetif>1</indRetif><tpAmb>1</tpAmb><procEmi>1</procEmi><verProc>SGP-8.2</verProc></ideEvento>
  <ideVinculo><cpfTrab>12345678901</cpfTrab><matricula>M-100</matricula></ideVinculo>
  <cat>
    <dtAcid>2026-05-14</dtAcid><hrAcid>0930</hrAcid><tpAcid>1</tpAcid><tpCat>1</tpCat>
    <codSitGeradora>200000500</codSitGeradora><iniciatCAT>1</iniciatCAT>
  </cat>
  <localAcidente><tpLocal>1</tpLocal></localAcidente>
  <parteAtingida><codParteAting>753000000</codParteAting></parteAtingida>
  <agenteCausador><codAgntCausador>301010100</codAgntCausador></agenteCausador>
  <atestado><dtAtendimento>2026-05-14</dtAtendimento><indAfast>S</indAfast><durTrat>15</durTrat></atestado>
</evtCAT></eSocial>`;

/** CAT que NÃO declarou afastamento — não é o mesmo que declarar que não houve. */
const catSemDeclaracao = `<?xml version="1.0"?>
<eSocial><evtCAT Id="ID-CAT-2">
  <ideVinculo><cpfTrab>98765432100</cpfTrab></ideVinculo>
  <cat><dtAcid>2026-05-20</dtAcid><tpCat>1</tpCat></cat>
</evtCAT></eSocial>`;

const asoPeriodico = `<?xml version="1.0"?>
<eSocial><evtMonit Id="ID-ASO-1">
  <ideVinculo><cpfTrab>12345678901</cpfTrab><matricula>M-100</matricula></ideVinculo>
  <exMedOcup>
    <tpExameOcup>1</tpExameOcup>
    <aso>
      <dtAso>2026-03-10</dtAso><resAso>1</resAso>
      <exame><dtExm>2026-03-10</dtExm><procRealizado>0101</procRealizado><indResult>1</indResult></exame>
      <exame><dtExm>2026-03-10</dtExm><procRealizado>0203</procRealizado><indResult>2</indResult></exame>
    </aso>
    <medico><nmMed>Dra. Fulana</nmMed><nrCRM>12345</nrCRM></medico>
  </exMedOcup>
</evtMonit></eSocial>`;

const asoAdmissional = `<?xml version="1.0"?>
<eSocial><evtMonit Id="ID-ASO-2">
  <ideVinculo><cpfTrab>98765432100</cpfTrab><matricula>M-200</matricula></ideVinculo>
  <exMedOcup>
    <tpExameOcup>0</tpExameOcup>
    <aso><dtAso>2026-01-05</dtAso><resAso>1</resAso></aso>
  </exMedOcup>
</evtMonit></eSocial>`;

const expRisco = `<?xml version="1.0"?>
<eSocial><evtExpRisco Id="ID-RISCO-1">
  <ideVinculo><cpfTrab>12345678901</cpfTrab><matricula>M-100</matricula></ideVinculo>
  <infoExpRisco>
    <dtIniCondicao>2025-08-01</dtIniCondicao>
    <infoAmb><codAmb>AMB-01</codAmb></infoAmb>
    <agNoc>
      <codAgNoc>02.01.001</codAgNoc><dscAgNoc>Ruído contínuo</dscAgNoc>
      <tpAval>1</tpAval><intConc>88</intConc><limTol>85</limTol><unMed>18</unMed>
      <epcEpi><utilizEPC>1</utilizEPC><eficEpc>N</eficEpc><utilizEPI>2</utilizEPI><eficEpi>S</eficEpi></epcEpi>
    </agNoc>
    <agNoc>
      <codAgNoc>02.01.014</codAgNoc><dscAgNoc>Calor</dscAgNoc>
      <tpAval>2</tpAval>
      <epcEpi><eficEpc>N</eficEpc><eficEpi>N</eficEpi></epcEpi>
    </agNoc>
  </infoExpRisco>
</evtExpRisco></eSocial>`;

const fechamento = `<?xml version="1.0"?>
<eSocial><evtFechaEvPer Id="ID-FECHA-1">
  <ideEvento><indApuracao>1</indApuracao><perApur>2026-05</perApur><procEmi>1</procEmi><verProc>SGP-8.2</verProc></ideEvento>
  <infoFech><evtRemun>S</evtRemun><evtPgtos>S</evtPgtos><evtAqProd>N</evtAqProd></infoFech>
</evtFechaEvPer></eSocial>`;

const exclusao = `<?xml version="1.0"?>
<eSocial><evtExclusao Id="ID-EXC-1">
  <ideEvento><tpAmb>1</tpAmb><procEmi>2</procEmi><verProc>PORTAL</verProc></ideEvento>
  <infoExclusao>
    <tpEvento>S-1200</tpEvento><nrRecEvt>1.2.0000000000123</nrRecEvt>
    <ideTrabalhador><cpfTrab>12345678901</cpfTrab></ideTrabalhador>
    <ideFolhaPagto><indApuracao>1</indApuracao><perApur>2026-04</perApur></ideFolhaPagto>
  </infoExclusao>
</evtExclusao></eSocial>`;

describe('parser — eventos de SST', () => {
  it('lê a CAT e distingue "afastou" de "não declarou"', () => {
    const [comAfast] = parseEsocialEvents(cat);
    expect(comAfast.eventType).toBe('S-2210');
    expect(comAfast.payload.kind).toBe('cat');
    if (comAfast.payload.kind !== 'cat') throw new Error('payload errado');
    expect(comAfast.payload.accidentDate).toBe('2026-05-14');
    expect(comAfast.payload.catType).toBe('1');
    expect(comAfast.payload.localKind).toBe('1');
    expect(comAfast.payload.bodyPartCode).toBe('753000000');
    expect(comAfast.payload.causingAgentCode).toBe('301010100');
    // O afastamento vem do atestado, não do corpo da CAT.
    expect(comAfast.payload.causedLeave).toBe(true);

    const [semDeclaracao] = parseEsocialEvents(catSemDeclaracao);
    if (semDeclaracao.payload.kind !== 'cat') throw new Error('payload errado');
    // undefined, NUNCA false: não declarar não é declarar que não houve.
    expect(semDeclaracao.payload.causedLeave).toBeUndefined();
  });

  it('lê o ASO usando procRealizado como código do exame e indResult como achado', () => {
    const [ev] = parseEsocialEvents(asoPeriodico);
    if (ev.payload.kind !== 'aso') throw new Error('payload errado');
    expect(ev.payload.examKind).toBe('1');
    expect(ev.payload.result).toBe('1');
    expect(ev.payload.exams).toEqual([
      { code: '0101', date: '2026-03-10', result: '1' },
      { code: '0203', date: '2026-03-10', result: '2' },
    ]);
  });

  it('lê os agentes nocivos com EPC/EPI POR AGENTE', () => {
    const [ev] = parseEsocialEvents(expRisco);
    if (ev.payload.kind !== 'risk-exposure') throw new Error('payload errado');
    expect(ev.payload.startDate).toBe('2025-08-01');
    expect(ev.payload.environmentCode).toBe('AMB-01');
    expect(ev.payload.agents).toHaveLength(2);

    // Ruído: EPI eficiente. Calor: não. Achatar num veredicto só do evento
    // diria que o trabalhador está protegido quando metade não está.
    expect(ev.payload.agents[0]).toMatchObject({
      code: '02.01.001',
      assessment: '1',
      intensity: '88',
      toleranceLimit: '85',
      epcEfficient: false,
      epiEfficient: true,
    });
    expect(ev.payload.agents[1]).toMatchObject({
      code: '02.01.014',
      epcEfficient: false,
      epiEfficient: false,
    });
  });

  it('lê procedência, fechamento e exclusão', () => {
    const [fecha] = parseEsocialEvents(fechamento);
    expect(fecha.origin).toMatchObject({ procEmi: '1', verProc: 'SGP-8.2' });
    if (fecha.payload.kind !== 'period-close') throw new Error('payload errado');
    expect(fecha.payload.hasRemuneration).toBe(true);
    expect(fecha.payload.hasPayments).toBe(true);
    expect(fecha.competence).toBe('2026-05');

    const [exc] = parseEsocialEvents(exclusao);
    // A procedência é a de QUEM EXCLUIU, lida do ideEvento próprio.
    expect(exc.origin).toMatchObject({ procEmi: '2', verProc: 'PORTAL' });
    if (exc.payload.kind !== 'exclusion') throw new Error('payload errado');
    expect(exc.payload.targetEventType).toBe('S-1200');
    expect(exc.payload.targetReceipt).toBe('1.2.0000000000123');
  });
});

describe('validade do ASO', () => {
  it('só apura vencimento para o exame periódico', () => {
    expect(asoPeriodMonths('1')).toBe(12);
    expect(asoValidUntil('2026-03-10', '1')).toBe('2027-03-10');
  });

  it('devolve null quando a periodicidade não é apurável — nunca uma data de garantia', () => {
    for (const kind of ['0', '2', '3', '9', undefined, '']) {
      expect(asoPeriodMonths(kind)).toBeNull();
      expect(asoValidUntil('2026-03-10', kind)).toBeNull();
    }
  });

  it('não apura vencimento sem data de exame', () => {
    expect(asoValidUntil(undefined, '1')).toBeNull();
    expect(asoValidUntil('data-ruim', '1')).toBeNull();
  });
});

describe('normalizador — linhas de SST', () => {
  const remuneracao = `<?xml version="1.0"?>
<eSocial><evtRemun Id="ID-REM-1">
  <ideEvento><perApur>2026-05</perApur></ideEvento>
  <ideTrabalhador><cpfTrab>12345678901</cpfTrab></ideTrabalhador>
  <dmDev><infoPerApur><ideEstabLot><codLotacao>7</codLotacao>
    <remunPerApur><itensRemun><codRubr>1001</codRubr><ideTabRubr>0001</ideTabRubr><vrRubr>5000.00</vrRubr></itensRemun></remunPerApur>
  </ideEstabLot></infoPerApur></dmDev>
</evtRemun></eSocial>`;

  it('herda a lotação do S-1200 do trabalhador — a CAT não declara codLotacao', () => {
    const events = [...parseEsocialEvents(remuneracao), ...parseEsocialEvents(cat)];
    const { sstEvents } = normalizeEvents('org-1', events);

    expect(sstEvents).toHaveLength(1);
    expect(sstEvents[0].event_type).toBe('S-2210');
    expect(sstEvents[0].competence).toBe('2026-05');
    // Sem a herança, cairia em "sem-lotacao" e o recorte por área ficaria zerado.
    expect(sstEvents[0].area_code).toBe('7');
    expect(sstEvents[0].caused_leave).toBe(true);
  });

  it('não deixa SST contaminar folha nem headcount', () => {
    const events = [...parseEsocialEvents(remuneracao), ...parseEsocialEvents(cat)];
    const { competences } = normalizeEvents('org-1', events);
    const maio = competences.find((c) => c.competence === '2026-05');
    expect(maio?.headcount).toBe(1);
    expect(maio?.gross_payroll_cents).toBe(0); // rubrica sem tabela S-1010 não entra
  });

  it('congela o vencimento do ASO periódico e deixa o admissional sem vencimento', () => {
    const events = [...parseEsocialEvents(asoPeriodico), ...parseEsocialEvents(asoAdmissional)];
    const rows = buildSstEvents(
      'org-1',
      events,
      () => undefined,
      (ev) => ev.matricula,
      () => undefined,
      (ev) => ev.eventDate?.slice(0, 7),
    );

    const periodico = rows.find((r) => r.matricula === 'M-100');
    expect(periodico?.aso_valid_until).toBe('2027-03-10');
    expect(periodico?.aso_period_months).toBe(12);

    const admissional = rows.find((r) => r.matricula === 'M-200');
    expect(admissional?.aso_valid_until).toBeNull();
    expect(admissional?.aso_period_months).toBeNull();
  });
});

describe('indicadores de SST', () => {
  const workers: SstWorker[] = [
    { workerKey: 'w1', name: null, matricula: null, areaLabel: 'Obra Norte' },
    { workerKey: 'w2', name: null, matricula: null, areaLabel: 'Obra Norte' },
    { workerKey: 'w3', name: null, matricula: null, areaLabel: 'Escritório' },
  ];

  function aso(workerKey: string, date: string, validUntil: string | null): SstEvent {
    return {
      eventId: `aso-${workerKey}`,
      eventType: 'S-2220',
      competence: date.slice(0, 7),
      eventDate: date,
      workerKey,
      workerName: null,
      workerMask: null,
      matricula: null,
      areaCode: null,
      areaLabel: null,
      aso: { examKind: validUntil ? '1' : '0', result: '1', validUntil, periodMonths: validUntil ? 12 : null, exams: [] },
    };
  }

  const hoje = new Date('2026-06-15T00:00:00Z');

  it('separa os quatro estados do ASO — e nunca funde "não sei" com "em dia"', () => {
    const events = [
      aso('w1', '2025-06-01', '2026-06-01'), // vencido
      aso('w2', '2026-01-05', null), // admissional: não apurável
      // w3 não tem exame nenhum
    ];
    const statuses = asoStatusByWorker(events, workers, hoje);

    expect(statuses.find((s) => s.worker.workerKey === 'w1')?.status).toBe('expired');
    expect(statuses.find((s) => s.worker.workerKey === 'w2')?.status).toBe('undetermined');
    expect(statuses.find((s) => s.worker.workerKey === 'w3')?.status).toBe('absent');
  });

  it('classifica como "a vencer" dentro da janela e "válido" fora dela', () => {
    const events = [aso('w1', '2025-07-20', '2026-07-20'), aso('w2', '2026-05-01', '2027-05-01')];
    const statuses = asoStatusByWorker(events, workers, hoje);
    expect(statuses.find((s) => s.worker.workerKey === 'w1')?.status).toBe('expiring');
    expect(statuses.find((s) => s.worker.workerKey === 'w2')?.status).toBe('valid');
  });

  it('devolve indicadores AUSENTES quando o acervo de SST está vazio', () => {
    const summary = summarizeSst([], [], workers, hoje);
    expect(summary.catsInPeriod).toBeNull();
    expect(summary.asoExpired).toBeNull();
    expect(summary.workersWithoutAso).toBeNull();
    // O denominador continua sendo um fato — ele não depende do acervo de SST.
    expect(summary.activeWorkers).toBe(3);
  });

  it('conta separadamente as CATs que não declararam afastamento', () => {
    const [comAfast] = parseEsocialEvents(cat);
    const [semDeclaracao] = parseEsocialEvents(catSemDeclaracao);
    const rows = buildSstEvents(
      'org-1',
      [comAfast, semDeclaracao],
      () => undefined,
      (ev) => ev.cpf,
      () => undefined,
      (ev) => ev.eventDate?.slice(0, 7),
    );

    const events: SstEvent[] = rows.map((r) => ({
      eventId: r.esocial_event_id,
      eventType: r.event_type,
      competence: r.competence,
      eventDate: r.event_date,
      workerKey: r.worker_cpf_hash,
      workerName: null,
      workerMask: null,
      matricula: null,
      areaCode: r.area_code,
      areaLabel: r.area_label,
      cat: {
        catType: r.cat_type,
        accidentKind: r.accident_kind,
        localKind: r.local_kind,
        situationCode: r.situation_code,
        initiator: r.initiator,
        causedLeave: r.caused_leave,
        deathDate: r.death_date,
        bodyPartCode: r.body_part_code,
        causingAgentCode: r.causing_agent_code,
      },
    }));

    const summary = summarizeSst(events, events, workers, hoje);
    expect(summary.catsInPeriod).toBe(2);
    expect(summary.catsWithLeave).toBe(1);
    // O segundo não vira "sem afastamento": vira "não declarado".
    expect(summary.catsWithLeaveUndeclared).toBe(1);
  });
});
