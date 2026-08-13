/**
 * Parser e normalizador do conector eSocial.
 *
 * Estes testes são a rede de segurança do módulo: não há ambiente do eSocial
 * disponível em CI, então a garantia de que um XML vira o número certo mora
 * aqui. Os XMLs abaixo seguem a estrutura dos leiautes S-1.x, reduzidos aos
 * nós que a ingestão consome.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { parseEsocialEventXml, parseEventList } from '@/lib/esocial/connector/parser';
import {
  absenceDaysByCompetence,
  buildAbsencePeriods,
  normalizeEvents,
} from '@/lib/esocial/connector/normalizer';

// hashCpf/maskCpf leem a chave do ambiente; o normalizador depende deles.
beforeAll(() => {
  process.env.ESOCIAL_CERT_KEY = 'chave-de-teste-com-mais-de-32-caracteres!!';
});

const ORG = '00000000-0000-0000-0000-000000000001';

const S1200 = `<?xml version="1.0" encoding="UTF-8"?>
<eSocial xmlns="http://www.esocial.gov.br/schema/evt/evtRemun/v_S_01_02_00">
  <evtRemun Id="ID1123456780000002024030100000100001">
    <ideEvento><indRetif>1</indRetif><perApur>2026-03</perApur></ideEvento>
    <ideEmpregador><tpInsc>1</tpInsc><nrInsc>12345678000199</nrInsc></ideEmpregador>
    <ideTrabalhador><cpfTrab>12345678901</cpfTrab></ideTrabalhador>
    <dmDev>
      <ideDmDev>DEM001</ideDmDev>
      <infoPerApur>
        <ideEstabLot>
          <tpInsc>1</tpInsc><nrInsc>12345678000199</nrInsc>
          <codLotacao>OPERACOES</codLotacao>
          <remunPerApur>
            <matricula>M-0001</matricula>
            <!-- Como no arquivo real: sem natRubr e com TODO valor positivo.
                 O sinal e a natureza moram na tabela de rubricas (S-1010). -->
            <itensRemun><codRubr>1001</codRubr><ideTabRubr>0001</ideTabRubr><vrRubr>5000.00</vrRubr></itensRemun>
            <itensRemun><codRubr>1210</codRubr><ideTabRubr>0001</ideTabRubr><qtdRubr>10.00</qtdRubr><vrRubr>750.50</vrRubr></itensRemun>
            <itensRemun><codRubr>9001</codRubr><ideTabRubr>0001</ideTabRubr><vrRubr>320.25</vrRubr></itensRemun>
            <itensRemun><codRubr>9500</codRubr><ideTabRubr>0001</ideTabRubr><vrRubr>4250.00</vrRubr></itensRemun>
          </remunPerApur>
        </ideEstabLot>
      </infoPerApur>
    </dmDev>
  </evtRemun>
</eSocial>`;

/**
 * Tabela de rubricas — o dicionário sem o qual nada no S-1200 é classificável.
 * Um S-1010 descreve UMA rubrica; a tabela é o conjunto deles.
 */
function s1010(
  id: string,
  codRubr: string,
  { natRubr, tpRubr, dscRubr }: { natRubr: string; tpRubr: string; dscRubr: string },
) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<eSocial xmlns="http://www.esocial.gov.br/schema/evt/evtTabRubrica/v_S_01_03_00">
  <evtTabRubrica Id="${id}">
    <ideEmpregador><tpInsc>1</tpInsc><nrInsc>12345678000199</nrInsc></ideEmpregador>
    <infoRubrica><inclusao>
      <ideRubrica><codRubr>${codRubr}</codRubr><ideTabRubr>0001</ideTabRubr><iniValid>2019-01</iniValid></ideRubrica>
      <dadosRubrica><dscRubr>${dscRubr}</dscRubr><natRubr>${natRubr}</natRubr><tpRubr>${tpRubr}</tpRubr></dadosRubrica>
    </inclusao></infoRubrica>
  </evtTabRubrica>
</eSocial>`;
}

const TABELA_RUBRICAS = [
  s1010('ID-RUB-1', '1001', { natRubr: '1000', tpRubr: '1', dscRubr: 'SALARIO BASE' }),
  s1010('ID-RUB-2', '1210', { natRubr: '1003', tpRubr: '1', dscRubr: 'HORAS EXTRAS 100 VALOR' }),
  s1010('ID-RUB-3', '9001', { natRubr: '9213', tpRubr: '2', dscRubr: 'PENSAO ALIMENTICIA' }),
  s1010('ID-RUB-4', '9500', { natRubr: '9908', tpRubr: '3', dscRubr: 'BASE FGTS' }),
];

const S2299 = `<?xml version="1.0" encoding="UTF-8"?>
<eSocial xmlns="http://www.esocial.gov.br/schema/evt/evtDeslig/v_S_01_02_00">
  <evtDeslig Id="ID1123456780000002024030100000100002">
    <ideEvento><perApur>2026-03</perApur></ideEvento>
    <ideVinculo><cpfTrab>98765432100</cpfTrab><matricula>M-0002</matricula></ideVinculo>
    <infoDeslig><mtvDeslig>02</mtvDeslig><dtDeslig>2026-03-18</dtDeslig></infoDeslig>
  </evtDeslig>
</eSocial>`;

const S2230 = `<?xml version="1.0" encoding="UTF-8"?>
<eSocial xmlns="http://www.esocial.gov.br/schema/evt/evtAfastTemp/v_S_01_02_00">
  <evtAfastTemp Id="ID1123456780000002024030100000100003">
    <ideEvento><perApur>2026-03</perApur></ideEvento>
    <ideVinculo><cpfTrab>11122233344</cpfTrab><matricula>M-0003</matricula></ideVinculo>
    <infoAfastamento>
      <iniAfastamento>
        <dtIniAfast>2026-03-02</dtIniAfast>
        <codMotAfast>01</codMotAfast>
        <dtTermAfast>2026-03-06</dtTermAfast>
      </iniAfastamento>
    </infoAfastamento>
  </evtAfastTemp>
</eSocial>`;

const S5011 = `<?xml version="1.0" encoding="UTF-8"?>
<eSocial xmlns="http://www.esocial.gov.br/schema/evt/evtCS/v_S_01_02_00">
  <evtCS Id="ID5123456780000002024030100000100004">
    <ideEvento><perApur>2026-03</perApur></ideEvento>
    <infoCS>
      <infoCPSeg><vrCpApur>124500.75</vrCpApur></infoCPSeg>
      <infoContrib><aliqRat>2.0</aliqRat></infoContrib>
    </infoCS>
  </evtCS>
</eSocial>`;

const S5013 = `<?xml version="1.0" encoding="UTF-8"?>
<eSocial xmlns="http://www.esocial.gov.br/schema/evt/evtFGTS/v_S_01_02_00">
  <evtFGTS Id="ID5123456780000002024030100000100005">
    <ideEvento><perApur>2026-03</perApur></ideEvento>
    <infoFGTS><ideEstabLot><infoTrabFGTS><vrFGTS>38200.40</vrFGTS></infoTrabFGTS></ideEstabLot></infoFGTS>
  </evtFGTS>
</eSocial>`;

describe('parseEsocialEventXml', () => {
  it('lê a remuneração sem classificar as verbas — isso depende do S-1010', () => {
    const ev = parseEsocialEventXml(S1200);

    expect(ev.eventType).toBe('S-1200');
    expect(ev.eventId).toBe('ID1123456780000002024030100000100001');
    expect(ev.competence).toBe('2026-03');
    expect(ev.cpf).toBe('12345678901');
    expect(ev.matricula).toBe('M-0001');
    expect(ev.areaCode).toBe('OPERACOES');

    expect(ev.payload.kind).toBe('remuneration');
    if (ev.payload.kind !== 'remuneration') throw new Error('payload inesperado');
    expect(ev.payload.rubricas).toHaveLength(4);
    // Código, tabela e quantidade: tudo o que o evento realmente declara.
    expect(ev.payload.rubricas[1]).toMatchObject({
      code: '1210',
      tableId: '0001',
      amountCents: 75_050,
      quantity: 10,
    });
  });

  it('lê a tabela de rubricas do S-1010', () => {
    const ev = parseEsocialEventXml(TABELA_RUBRICAS[1]);
    expect(ev.eventType).toBe('S-1010');
    if (ev.payload.kind !== 'rubric-table') throw new Error('payload inesperado');
    expect(ev.payload.rubricas[0]).toEqual({
      code: '1210',
      tableId: '0001',
      validFrom: '2019-01',
      nature: '1003',
      type: '1',
      description: 'HORAS EXTRAS 100 VALOR',
    });
  });

  it('lê desligamento com motivo e data', () => {
    const ev = parseEsocialEventXml(S2299);
    expect(ev.eventType).toBe('S-2299');
    expect(ev.matricula).toBe('M-0002');
    if (ev.payload.kind !== 'termination') throw new Error('payload inesperado');
    expect(ev.payload.terminationDate).toBe('2026-03-18');
    expect(ev.payload.reasonCode).toBe('02');
  });

  it('conta os dias de afastamento incluindo o dia inicial e o final', () => {
    const ev = parseEsocialEventXml(S2230);
    if (ev.payload.kind !== 'absence') throw new Error('payload inesperado');
    // 02/03 a 06/03 = 5 dias, não 4.
    expect(ev.payload.totalDays).toBe(5);
    expect(ev.payload.reasonCode).toBe('01');
  });

  it('lê os totalizadores que substituem as estimativas de guia', () => {
    const inss = parseEsocialEventXml(S5011);
    expect(inss.eventType).toBe('S-5011');
    if (inss.payload.kind !== 'totalizer') throw new Error('payload inesperado');
    expect(inss.payload.inssCents).toBe(12_450_075);
    expect(inss.payload.ratFapRate).toBe(2);

    const fgts = parseEsocialEventXml(S5013);
    expect(fgts.eventType).toBe('S-5013');
    if (fgts.payload.kind !== 'totalizer') throw new Error('payload inesperado');
    expect(fgts.payload.fgtsCents).toBe(3_820_040);
  });

  it('rejeita XML sem nó de evento', () => {
    expect(() => parseEsocialEventXml('<eSocial><nada/></eSocial>')).toThrow();
  });
});

describe('parseEventList', () => {
  it('extrai ids da resposta XML de consulta', () => {
    const body = `<retorno><eventos>
      <evento Id="ID001"><nrRecibo>1.1.000001</nrRecibo></evento>
      <evento Id="ID002"><nrRecibo>1.1.000002</nrRecibo></evento>
    </eventos></retorno>`;
    const items = parseEventList(body, 'application/xml');
    expect(items.map((i) => i.eventId)).toEqual(['ID001', 'ID002']);
    expect(items[0].receiptNumber).toBe('1.1.000001');
  });

  it('extrai ids da resposta JSON e não repete o mesmo evento', () => {
    const body = JSON.stringify({ eventos: [{ id: 'ID001' }, { id: 'ID001' }, { id: 'ID002' }] });
    const items = parseEventList(body, 'application/json');
    expect(items.map((i) => i.eventId)).toEqual(['ID001', 'ID002']);
  });

  it('devolve lista vazia em corpo ilegível, sem lançar', () => {
    expect(parseEventList('não é xml nem json <<<', 'application/xml')).toEqual([]);
  });
});

/**
 * Absenteísmo por competência.
 *
 * Regressão de dados reais: fevereiro/2026 apareceu com 6.536 dias de falta
 * para 268 pessoas — 24 dias por pessoa. A causa era dupla: afastamento em
 * aberto contado até hoje, e a duração inteira jogada num único mês.
 */
describe('absenceDaysByCompetence', () => {
  const hoje = new Date('2026-08-11T12:00:00Z');

  it('divide o afastamento pelos meses que ele atravessa', () => {
    const dias = absenceDaysByCompetence('2026-01-20', '2026-03-05', hoje);
    expect([...dias]).toEqual([
      ['2026-01', 12], // 20 a 31
      ['2026-02', 28],
      ['2026-03', 5],
    ]);
  });

  it('não deixa o mês receber mais dias do que tem', () => {
    const dias = absenceDaysByCompetence('2025-09-24', undefined, hoje);
    // O afastamento tem 322 dias corridos; nenhum mês pode ter mais que os seus.
    expect(dias.get('2025-09')).toBe(7);
    expect(dias.get('2025-10')).toBe(31);
    expect(dias.get('2026-02')).toBe(28);
    for (const [, d] of dias) expect(d).toBeLessThanOrEqual(31);
  });

  it('afastamento em aberto para em hoje, sem projetar para o futuro', () => {
    const dias = absenceDaysByCompetence('2026-08-01', undefined, hoje);
    expect(dias.get('2026-08')).toBe(11);
    expect(dias.get('2026-09')).toBeUndefined();
  });

  it('afastamento de um dia conta um dia', () => {
    expect([...absenceDaysByCompetence('2026-04-10', '2026-04-10', hoje)]).toEqual([['2026-04', 1]]);
  });

  it('ignora término anterior ao início e datas ausentes', () => {
    expect(absenceDaysByCompetence('2026-04-10', '2026-03-01', hoje).size).toBe(0);
    expect(absenceDaysByCompetence(undefined, '2026-03-01', hoje).size).toBe(0);
  });
});

/**
 * Início e fim de afastamento chegam em EVENTOS SEPARADOS.
 *
 * Nos dados reais são 249 eventos de fim para 243 de início — o retorno do
 * trabalhador tem `fimAfastamento` e nenhum `dtIniAfast`. Ler cada um sozinho
 * deixava todo afastamento aberto para sempre.
 */
describe('buildAbsencePeriods', () => {
  const inicio = (id: string, cpf: string, data: string, motivo = '03') => `<?xml version="1.0"?>
    <eSocial><evtAfastTemp Id="${id}">
      <ideVinculo><cpfTrab>${cpf}</cpfTrab><matricula>M-1</matricula></ideVinculo>
      <infoAfastamento><iniAfastamento>
        <dtIniAfast>${data}</dtIniAfast><codMotAfast>${motivo}</codMotAfast>
      </iniAfastamento></infoAfastamento>
    </evtAfastTemp></eSocial>`;

  const fim = (id: string, cpf: string, data: string) => `<?xml version="1.0"?>
    <eSocial><evtAfastTemp Id="${id}">
      <ideVinculo><cpfTrab>${cpf}</cpfTrab><matricula>M-1</matricula></ideVinculo>
      <infoAfastamento><fimAfastamento><dtTermAfast>${data}</dtTermAfast></fimAfastamento></infoAfastamento>
    </evtAfastTemp></eSocial>`;

  const chave = (ev: { cpf?: string; matricula?: string }) => ev.cpf ?? ev.matricula;

  it('fecha o afastamento com o evento de retorno do mesmo trabalhador', () => {
    const periodos = buildAbsencePeriods(
      [inicio('A', '11111111111', '2026-02-13'), fim('B', '11111111111', '2026-02-18')].map(
        parseEsocialEventXml,
      ),
      chave,
    );
    expect(periodos).toEqual([
      expect.objectContaining({ start: '2026-02-13', end: '2026-02-18', reasonCode: '03' }),
    ]);
  });

  it('emparelha em ordem cronológica quando há vários afastamentos', () => {
    const periodos = buildAbsencePeriods(
      [
        inicio('A', '11111111111', '2026-01-05'),
        fim('B', '11111111111', '2026-01-09'),
        inicio('C', '11111111111', '2026-03-10'),
        fim('D', '11111111111', '2026-03-14'),
      ].map(parseEsocialEventXml),
      chave,
    );
    expect(periodos.map((p) => [p.start, p.end])).toEqual([
      ['2026-01-05', '2026-01-09'],
      ['2026-03-10', '2026-03-14'],
    ]);
  });

  it('não fecha um afastamento com retorno de outro trabalhador', () => {
    const periodos = buildAbsencePeriods(
      [inicio('A', '11111111111', '2026-02-13'), fim('B', '22222222222', '2026-02-18')].map(
        parseEsocialEventXml,
      ),
      chave,
    );
    expect(periodos).toHaveLength(1);
    expect(periodos[0].end).toBeUndefined();
  });

  it('descarta retorno sem início conhecido, em vez de inventar a data', () => {
    // Afastamento iniciado antes da janela de retenção do eSocial Download.
    const periodos = buildAbsencePeriods([fim('B', '11111111111', '2026-02-18')].map(parseEsocialEventXml), chave);
    expect(periodos).toEqual([]);
  });

  it('retificação do mesmo início não vira um segundo afastamento', () => {
    const periodos = buildAbsencePeriods(
      [
        inicio('A', '11111111111', '2026-02-13'),
        inicio('A-RETIF', '11111111111', '2026-02-13', '15'),
        fim('B', '11111111111', '2026-02-18'),
      ].map(parseEsocialEventXml),
      chave,
    );
    expect(periodos).toHaveLength(1);
    // Vale a versão corrigida.
    expect(periodos[0].reasonCode).toBe('15');
  });

  it('afastamento sem retorno fica realmente aberto', () => {
    const periodos = buildAbsencePeriods([inicio('A', '11111111111', '2026-02-13')].map(parseEsocialEventXml), chave);
    expect(periodos[0].end).toBeUndefined();
  });
});

describe('normalizeEvents', () => {
  const events = [...TABELA_RUBRICAS, S1200, S2299, S2230, S5011, S5013].map(parseEsocialEventXml);

  it('agrega a competência somando massa, movimentação e afastamentos', () => {
    const { competences } = normalizeEvents(ORG, events);
    expect(competences).toHaveLength(1);

    const c = competences[0];
    expect(c.competence).toBe('2026-03');
    // Só os proventos (tpRubr=1): salário 5000,00 + hora extra 750,50.
    // A pensão (tpRubr=2) e a base do FGTS (tpRubr=3) ficam de fora — somá-las
    // era o que inflava a folha, já que no S-1200 todo valor vem positivo.
    expect(c.gross_payroll_cents).toBe(575_050);
    expect(c.deductions_cents).toBe(32_025);
    expect(c.overtime_cents).toBe(75_050);
    expect(c.overtime_hours).toBe(10);
    expect(c.terminations).toBe(1);
    expect(c.absence_days).toBe(5);
    expect(c.absence_events).toBe(1);
    // Headcount = trabalhadores distintos com remuneração no mês.
    expect(c.headcount).toBe(1);
  });

  it('mede a cobertura da tabela de rubricas', () => {
    const { competences } = normalizeEvents(ORG, events);
    // Aqui todas as quatro rubricas têm definição.
    expect(competences[0].rubric_total_cents).toBe(1_032_075);
    expect(competences[0].rubric_mapped_cents).toBe(1_032_075);
  });

  it('sem a tabela de rubricas, não classifica nada — e diz isso pela cobertura', () => {
    // É o caso real: o pacote do Download traz só as alterações recentes do
    // S-1010, não a tabela inteira. Chutar aqui produziria folha errada com
    // cara de folha certa.
    const semTabela = [S1200].map(parseEsocialEventXml);
    const { competences } = normalizeEvents(ORG, semTabela);

    expect(competences[0].gross_payroll_cents).toBe(0);
    expect(competences[0].overtime_cents).toBe(0);
    expect(competences[0].rubric_total_cents).toBe(1_032_075);
    expect(competences[0].rubric_mapped_cents).toBe(0);
  });

  it('grava os valores de guia apenas quando o totalizador chegou', () => {
    const { competences } = normalizeEvents(ORG, events);
    const c = competences[0];

    expect(c.inss_cents).toBe(12_450_075);
    expect(c.fgts_cents).toBe(3_820_040);
    expect(c.totalizers).toMatchObject({ 'S-5011': true, 'S-5013': true });

    // S-5012 não veio: IRRF fica NULO, nunca zero nem estimado.
    expect(c.irrf_cents).toBeNull();
    expect(c.totalizers['S-5012']).toBeUndefined();
  });

  it('não soma as versões antigas do totalizador quando a competência é retificada', () => {
    // O eSocial reemite o totalizador INTEIRO a cada reprocessamento e o pacote
    // do Download entrega todas as versões. Somá-las multiplicava a guia pelo
    // número de retificações — foi o que fez abril/2026 sair 3× maior.
    const versao = (id: string, recibo: string, valor: string) => `<?xml version="1.0"?>
      <eSocial><evtIrrf Id="${id}">
        <ideEvento><perApur>2026-03</perApur></ideEvento>
        <infoIRRF>
          <nrRecArqBase>${recibo}</nrRecArqBase>
          <infoCRMen><CRMen>056107</CRMen><vrCRMen>${valor}</vrCRMen></infoCRMen>
        </infoIRRF>
      </evtIrrf></eSocial>`;

    const { competences } = normalizeEvents(
      ORG,
      [
        versao('ID-IRRF-1', '1.1.0000000040871702543', '154446.97'),
        versao('ID-IRRF-2', '1.1.0000000040874119562', '155021.34'),
        versao('ID-IRRF-3', '1.1.0000000040999558072', '155900.00'),
      ].map(parseEsocialEventXml),
    );

    // Vale a versão de maior recibo, não a soma das três.
    expect(competences[0].irrf_cents).toBe(15_590_000);
  });

  it('compara recibos por valor numérico, não alfabeticamente', () => {
    const versao = (id: string, recibo: string, valor: string) => `<?xml version="1.0"?>
      <eSocial><evtIrrf Id="${id}">
        <ideEvento><perApur>2026-03</perApur></ideEvento>
        <infoIRRF><nrRecArqBase>${recibo}</nrRecArqBase>
        <infoCRMen><vrCRMen>${valor}</vrCRMen></infoCRMen></infoIRRF>
      </evtIrrf></eSocial>`;

    const { competences } = normalizeEvents(
      ORG,
      // "9" ordenaria depois de "10" numa comparação de texto.
      [versao('A', '1.1.9', '100.00'), versao('B', '1.1.10', '200.00')].map(parseEsocialEventXml),
    );
    expect(competences[0].irrf_cents).toBe(20_000);
  });

  it('abre a competência por lotação', () => {
    const { areas } = normalizeEvents(ORG, events);
    const operacoes = areas.find((a) => a.area_code === 'OPERACOES');
    expect(operacoes).toBeDefined();
    expect(operacoes!.gross_cents).toBe(575_050);
    expect(operacoes!.headcount).toBe(1);
  });

  it('marca o vínculo como desligado e não vaza o CPF', () => {
    const { employments } = normalizeEvents(ORG, events);
    const desligado = employments.find((e) => e.matricula === 'M-0002');

    expect(desligado?.status).toBe('terminated');
    expect(desligado?.termination_date).toBe('2026-03-18');
    // Só hash e máscara — o número nunca é persistido.
    expect(desligado?.worker_cpf_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(desligado?.worker_cpf_mask).toBe('***.654.321-**');
    expect(JSON.stringify(desligado)).not.toContain('98765432100');
  });

  it('é idempotente: reprocessar os mesmos eventos dá o mesmo agregado', () => {
    const a = normalizeEvents(ORG, events);
    const b = normalizeEvents(ORG, events);
    expect(b.competences).toEqual(a.competences);
    expect(b.areas).toEqual(a.areas);
  });
});
