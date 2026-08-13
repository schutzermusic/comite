/**
 * Formatos reais em que o XML do eSocial chega.
 *
 * Regressão de uma importação em que 738 de 738 arquivos falharam: o pacote do
 * portal não vem no formato "evento cru em UTF-8" que os testes sintéticos
 * usavam. Cada caso abaixo é uma forma que precisa ser aceita — envelope de
 * retorno, assinatura XMLDSig, ISO-8859-1, BOM e ZIP aninhado.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import {
  parseEsocialEventXml,
  parseEsocialEvents,
  parseEsocialReturn,
} from '@/lib/esocial/connector/parser';
import { decodeXml, expandToXml, triagePackage } from '@/lib/esocial/connector/import';
import { effectiveCompetence, normalizeEvents } from '@/lib/esocial/connector/normalizer';

beforeAll(() => {
  process.env.ESOCIAL_CERT_KEY = 'chave-de-teste-com-mais-de-32-caracteres!!';
});

const EVENTO = `<evtRemun Id="ID-ENV-1">
  <ideEvento><perApur>2026-04</perApur></ideEvento>
  <ideTrabalhador><cpfTrab>12345678901</cpfTrab></ideTrabalhador>
  <dmDev><infoPerApur><ideEstabLot><codLotacao>MANUTENÇÃO</codLotacao>
    <remunPerApur><matricula>M-1</matricula>
      <itensRemun><codRubr>1001</codRubr><natRubr>1000</natRubr><vrRubr>4500.00</vrRubr></itensRemun>
    </remunPerApur></ideEstabLot></infoPerApur></dmDev>
</evtRemun>`;

const ASSINATURA = `<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">
  <SignedInfo><Reference URI=""><DigestValue>abc</DigestValue></Reference></SignedInfo>
  <SignatureValue>xyz</SignatureValue>
</Signature>`;

describe('formatos de entrega do XML', () => {
  it('aceita o evento cru assinado (forma transmitida)', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<eSocial xmlns="http://www.esocial.gov.br/schema/evt/evtRemun/v_S_01_02_00">${EVENTO}${ASSINATURA}</eSocial>`;
    const ev = parseEsocialEventXml(xml);
    expect(ev.eventType).toBe('S-1200');
    expect(ev.eventId).toBe('ID-ENV-1');
    expect(ev.competence).toBe('2026-04');
  });

  it('aceita o evento dentro de envelope de retorno com recibo', () => {
    // O eSocial Download entrega o evento acompanhado dos dados do recibo,
    // embrulhado — a raiz não é o evento.
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<retornoEventos>
  <retornoEvento>
    <eSocial>${EVENTO}${ASSINATURA}</eSocial>
    <recibo><nrRecibo>1.2.0000000123</nrRecibo><dhProcessamento>2026-05-02T10:00:00</dhProcessamento></recibo>
  </retornoEvento>
</retornoEventos>`;
    const ev = parseEsocialEventXml(xml);
    expect(ev.eventType).toBe('S-1200');
    expect(ev.eventId).toBe('ID-ENV-1');
    expect(ev.receiptNumber).toBe('1.2.0000000123');
  });

  it('aceita evento de tipo fora do mapa, desde que tenha Id', () => {
    // Leiaute novo ou evento raro: guardar é melhor que descartar.
    const xml = `<eSocial><evtNovoTipoQualquer Id="ID-FUTURO-1">
      <ideEvento><perApur>2026-04</perApur></ideEvento>
    </evtNovoTipoQualquer></eSocial>`;
    const ev = parseEsocialEventXml(xml);
    expect(ev.eventId).toBe('ID-FUTURO-1');
    expect(ev.payload.kind).toBe('unknown');
  });

  it('recusa arquivo que não é evento, dizendo o que encontrou', () => {
    const xml = `<?xml version="1.0"?><relatorio><linha>nada aqui</linha></relatorio>`;
    expect(() => parseEsocialEventXml(xml)).toThrow(/relatorio/);
  });
});

describe('decodificação', () => {
  it('lê ISO-8859-1 sem corromper acentuação', () => {
    const xml = `<?xml version="1.0" encoding="ISO-8859-1"?>\n<eSocial>${EVENTO}</eSocial>`;
    const bytes = new Uint8Array(Buffer.from(xml, 'latin1'));

    // Lido como UTF-8, o acento vira caractere de substituição.
    expect(Buffer.from(bytes).toString('utf8')).not.toContain('MANUTENÇÃO');
    // Respeitando a declaração, o conteúdo se preserva.
    expect(decodeXml(bytes)).toContain('MANUTENÇÃO');

    const ev = parseEsocialEventXml(decodeXml(bytes));
    expect(ev.areaCode).toBe('MANUTENÇÃO');
  });

  it('remove o BOM, que faz o parser recusar o documento inteiro', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><eSocial>${EVENTO}</eSocial>`;
    const comBom = new Uint8Array(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(xml, 'utf8')]));

    expect(decodeXml(comBom).startsWith('<?xml')).toBe(true);
    expect(() => parseEsocialEventXml(decodeXml(comBom))).not.toThrow();
  });
});

describe('estrutura do pacote', () => {
  it('entra em ZIP dentro de ZIP', () => {
    const xml = `<eSocial>${EVENTO}</eSocial>`;
    const interno = zipSync({ '2026-04/evento.xml': strToU8(xml) });
    const externo = zipSync({ 'competencias/2026-04.zip': interno });

    const docs = expandToXml([{ name: 'eSocial-download.zip', content: Buffer.from(externo) }]);
    expect(docs).toHaveLength(1);

    const { parsed, failed } = triagePackage([
      { name: 'eSocial-download.zip', content: Buffer.from(externo) },
    ]);
    expect(failed).toBe(0);
    expect(parsed[0].eventType).toBe('S-1200');
  });

  it('ignora o que não é XML dentro do pacote, sem contar como falha', () => {
    const zip = zipSync({
      'evento.xml': strToU8(`<eSocial>${EVENTO}</eSocial>`),
      'leia-me.txt': strToU8('instruções'),
      'protocolo.pdf': strToU8('%PDF-1.4'),
    });
    const { parsed, failed } = triagePackage([{ name: 'p.zip', content: Buffer.from(zip) }]);
    expect(parsed).toHaveLength(1);
    expect(failed).toBe(0);
  });
});

/**
 * O arquivo entregue é um LOTE, não um evento.
 *
 * Regressão de uma importação real: 3385 eventos entraram, mas cada arquivo
 * tinha dezenas — só o primeiro era lido, e os valores eram varridos do
 * documento inteiro, o que fazia todos os eventos herdarem os dados do primeiro.
 */
describe('lote com múltiplos eventos', () => {
  const evento = (id: string, cpf: string, valor: string, lotacao: string) => `
    <evento><eSocial><evtRemun Id="${id}">
      <ideEvento><indApuracao>1</indApuracao><perApur>2026-04</perApur></ideEvento>
      <ideTrabalhador><cpfTrab>${cpf}</cpfTrab></ideTrabalhador>
      <dmDev><infoPerApur><ideEstabLot><codLotacao>${lotacao}</codLotacao>
        <remunPerApur><matricula>M-${cpf.slice(0, 3)}</matricula>
          <itensRemun><codRubr>1001</codRubr><ideTabRubr>0001</ideTabRubr><vrRubr>${valor}</vrRubr></itensRemun>
        </remunPerApur></ideEstabLot></infoPerApur></dmDev>
    </evtRemun></eSocial></evento>`;

  const lote = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body><v1:EnviarLoteEventos><v1:loteEventos>
    <eSocial><envioLoteEventos>
      <ideEmpregador><tpInsc>1</tpInsc><nrInsc>12345678000199</nrInsc></ideEmpregador>
      <eventos>
        ${evento('LOTE-1', '11111111111', '5000.00', 'ADM')}
        ${evento('LOTE-2', '22222222222', '3000.00', 'OPER')}
        ${evento('LOTE-3', '33333333333', '2000.00', 'OPER')}
      </eventos>
    </envioLoteEventos></eSocial>
  </v1:loteEventos></v1:EnviarLoteEventos></soapenv:Body>
</soapenv:Envelope>`;

  it('extrai TODOS os eventos do lote, não apenas o primeiro', () => {
    const eventos = parseEsocialEvents(lote);
    expect(eventos).toHaveLength(3);
    expect(eventos.map((e) => e.eventId)).toEqual(['LOTE-1', 'LOTE-2', 'LOTE-3']);
  });

  it('cada evento carrega os PRÓPRIOS dados, sem herdar os do primeiro', () => {
    const eventos = parseEsocialEvents(lote);

    // Varrer o documento inteiro faria os três terem o CPF e a lotação do primeiro.
    expect(eventos.map((e) => e.cpf)).toEqual(['11111111111', '22222222222', '33333333333']);
    expect(eventos.map((e) => e.areaCode)).toEqual(['ADM', 'OPER', 'OPER']);
    expect(
      eventos.map((e) =>
        e.payload.kind === 'remuneration' ? e.payload.rubricas[0].amountCents : 0,
      ),
    ).toEqual([500_000, 300_000, 200_000]);
  });

  it('agrega o lote corretamente: 3 trabalhadores, soma das verbas', () => {
    const tabela = `<?xml version="1.0"?>
      <eSocial><evtTabRubrica Id="RUB-1"><infoRubrica><inclusao>
        <ideRubrica><codRubr>1001</codRubr><ideTabRubr>0001</ideTabRubr><iniValid>2019-01</iniValid></ideRubrica>
        <dadosRubrica><dscRubr>SALARIO</dscRubr><natRubr>1000</natRubr><tpRubr>1</tpRubr></dadosRubrica>
      </inclusao></infoRubrica></evtTabRubrica></eSocial>`;

    const { competences, areas } = normalizeEvents('org-1', [
      ...parseEsocialEvents(tabela),
      ...parseEsocialEvents(lote),
    ]);
    expect(competences[0].competence).toBe('2026-04');
    expect(competences[0].gross_payroll_cents).toBe(1_000_000);
    expect(competences[0].headcount).toBe(3);
    expect(areas.find((a) => a.area_code === 'OPER')?.headcount).toBe(2);
  });

  it('acha os totalizadores que vêm depois do primeiro evento no retorno', () => {
    // Era exatamente isto que fazia S-5011 parecer inexistente no pacote real.
    const retorno = `<?xml version="1.0"?>
<retornoProcessamento>
  <recibo><nrRecibo>1.1.0000000040137289216</nrRecibo></recibo>
  <tot><eSocial><evtIrrf Id="TOT-IRRF">
    <ideEvento><perApur>2025-01</perApur></ideEvento>
    <infoIRRF><infoCRMen><CRMen>056107</CRMen><vrCRMen>69979.95</vrCRMen></infoCRMen></infoIRRF>
  </evtIrrf></eSocial></tot>
  <tot><eSocial><evtCS Id="TOT-CS">
    <ideEvento><indApuracao>1</indApuracao><perApur>2025-01</perApur></ideEvento>
    <infoCS><infoCPSeg><vrCpApur>124500.75</vrCpApur></infoCPSeg></infoCS>
  </evtCS></eSocial></tot>
</retornoProcessamento>`;

    const eventos = parseEsocialEvents(retorno);
    expect(eventos.map((e) => e.eventType).sort()).toEqual(['S-5011', 'S-5012']);

    const { competences } = normalizeEvents('org-1', eventos);
    expect(competences[0].irrf_cents).toBe(6_997_995);
    expect(competences[0].inss_cents).toBe(12_450_075);
    expect(competences[0].totalizers).toMatchObject({ 'S-5011': true, 'S-5012': true });
  });

  it('13º salário não vira um mês: apuração anual fica marcada como AAAA-13', () => {
    const decimo = `<eSocial><evtRemun Id="13-2025">
      <ideEvento><indApuracao>2</indApuracao><perApur>2025</perApur></ideEvento>
      <ideTrabalhador><cpfTrab>11111111111</cpfTrab></ideTrabalhador>
      <dmDev><infoPerApur><ideEstabLot><codLotacao>ADM</codLotacao>
        <remunPerApur><itensRemun><codRubr>5001</codRubr><natRubr>1000</natRubr><vrRubr>4000.00</vrRubr></itensRemun></remunPerApur>
      </ideEstabLot></infoPerApur></dmDev>
    </evtRemun></eSocial>`;

    const [ev] = parseEsocialEvents(decimo);
    expect(ev.annualApuracao).toBe(true);
    expect(effectiveCompetence(ev)).toBe('2025-13');

    const { competences } = normalizeEvents('org-1', [ev]);
    expect(competences[0].competence).toBe('2025-13');
  });
});

/**
 * Retornos de lote: recibo e ocorrências, sem evento.
 *
 * Boa parte do pacote é `ConsultarLoteEventosResponse`. Contá-los como falha
 * escondia erro de verdade — e descartá-los jogaria fora as ocorrências, que
 * são o próprio eSocial apontando problema no dado transmitido.
 */
describe('retorno de processamento de lote', () => {
  const retorno = `<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>
  <ConsultarLoteEventosResponse><ConsultarLoteEventosResult>
    <eSocial><retornoProcessamentoLoteEventos>
      <status><cdResposta>202</cdResposta><descResposta>Sucesso com advertência.</descResposta></status>
      <retornoEventos><evento>
        <retornoEvento><eSocial><retornoEvento>
          <processamento>
            <cdResposta>201</cdResposta>
            <ocorrencias>
              <ocorrencia><tipo>2</tipo><codigo>162</codigo><descricao>O Trabalhador com CPF 000</descricao></ocorrencia>
              <ocorrencia><tipo>2</tipo><codigo>162</codigo><descricao>O Trabalhador com CPF 111</descricao></ocorrencia>
            </ocorrencias>
          </processamento>
          <recibo><nrRecibo>1.1.0000000040137289216</nrRecibo></recibo>
        </retornoEvento></eSocial></retornoEvento>
      </evento></retornoEventos>
      <protocoloEnvioLote>1.1.202604.0000000013055495350</protocoloEnvioLote>
    </retornoProcessamentoLoteEventos></eSocial>
  </ConsultarLoteEventosResult></ConsultarLoteEventosResponse>
</s:Body></s:Envelope>`;

  it('reconhece o retorno e extrai protocolo, recibo e ocorrências', () => {
    const doc = parseEsocialReturn(retorno);
    expect(doc).not.toBeNull();
    expect(doc!.protocol).toBe('1.1.202604.0000000013055495350');
    expect(doc!.receiptNumbers).toContain('1.1.0000000040137289216');
    expect(doc!.occurrences).toHaveLength(2);
    expect(doc!.occurrences[0]).toMatchObject({ tipo: '2', codigo: '162' });
  });

  it('não conta retorno como falha na triagem', () => {
    const { parsed, failed, returns } = triagePackage([
      { name: 'Retorno-290720261135130000.xml', content: Buffer.from(retorno, 'utf8') },
    ]);
    expect(failed).toBe(0);
    expect(parsed).toHaveLength(0);
    expect(returns).toHaveLength(1);
    expect(returns[0].doc.occurrences).toHaveLength(2);
  });

  it('arquivo que não é evento nem retorno continua sendo falha', () => {
    const { failed, returns } = triagePackage([
      { name: 'planilha.xml', content: Buffer.from('<relatorio><linha>x</linha></relatorio>', 'utf8') },
    ]);
    expect(failed).toBe(1);
    expect(returns).toHaveLength(0);
  });
});
