/**
 * Expansão do pacote do eSocial Download.
 *
 * O insumo real é um ZIP do portal com dezenas de XMLs misturados — eventos
 * que alimentam indicadores, eventos fora de escopo e, às vezes, arquivos que
 * não são XML. Estes testes cobrem a triagem, que é onde um pacote real difere
 * de um XML avulso.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { effectiveCompetence, normalizeEvents } from '@/lib/esocial/connector/normalizer';
import { triagePackage } from '@/lib/esocial/connector/import';

beforeAll(() => {
  process.env.ESOCIAL_CERT_KEY = 'chave-de-teste-com-mais-de-32-caracteres!!';
});

const remun = (id: string, cpf: string, valor: string) => `<?xml version="1.0"?>
<eSocial><evtRemun Id="${id}">
  <ideEvento><perApur>2026-05</perApur></ideEvento>
  <ideTrabalhador><cpfTrab>${cpf}</cpfTrab></ideTrabalhador>
  <dmDev><infoPerApur><ideEstabLot><codLotacao>ADM</codLotacao>
    <remunPerApur><matricula>M-${cpf.slice(0, 4)}</matricula>
      <itensRemun><codRubr>1001</codRubr><ideTabRubr>0001</ideTabRubr><vrRubr>${valor}</vrRubr></itensRemun>
    </remunPerApur>
  </ideEstabLot></infoPerApur></dmDev>
</evtRemun></eSocial>`;

/**
 * A tabela de rubricas. Sem ela nenhuma verba do S-1200 é classificável, então
 * ela entra em todo cenário que verifica valor de folha.
 */
const tabelaRubricas = `<?xml version="1.0"?>
<eSocial><evtTabRubrica Id="ID-TAB-1"><infoRubrica><inclusao>
  <ideRubrica><codRubr>1001</codRubr><ideTabRubr>0001</ideTabRubr><iniValid>2019-01</iniValid></ideRubrica>
  <dadosRubrica><dscRubr>SALARIO BASE</dscRubr><natRubr>1000</natRubr><tpRubr>1</tpRubr></dadosRubrica>
</inclusao></infoRubrica></evtTabRubrica></eSocial>`;

/** CAT — desde a migration 084 vira indicador na seção SST. */
const comunicadoAcidente = `<?xml version="1.0"?>
<eSocial><evtCAT Id="ID-CAT-1">
  <ideVinculo><cpfTrab>12345678901</cpfTrab></ideVinculo>
  <cat><dtAcid>2026-05-14</dtAcid></cat>
</evtCAT></eSocial>`;

/**
 * Válido e ainda sem indicador — deve ser GUARDADO, não descartado.
 *
 * O aviso prévio é o caso do momento; o teste existe para garantir que a
 * triagem continue guardando o que não sabe usar, que é o que permite extrair
 * um indicador novo relendo o banco em vez de repedir o pacote ao escritório.
 */
const avisoPrevio = `<?xml version="1.0"?>
<eSocial><evtAvPrevio Id="ID-AVP-1">
  <ideVinculo><cpfTrab>12345678901</cpfTrab></ideVinculo>
  <detAvPrevio><dtAvPrv>2026-05-20</dtAvPrv></detAvPrevio>
</evtAvPrevio></eSocial>`;

/** Embrulha o ZIP no formato que a rota de importação entrega. */
function triage(zip: Uint8Array) {
  return triagePackage([{ name: 'eSocial-download.zip', content: Buffer.from(zip) }]);
}

describe('triagem do pacote do eSocial Download', () => {
  it('lê os XMLs do ZIP, descarta o que não é XML e guarda o que não vira indicador', () => {
    const zip = zipSync({
      'eventos/ID-A.xml': strToU8(remun('ID-A', '12345678901', '5000.00')),
      'eventos/ID-B.xml': strToU8(remun('ID-B', '98765432100', '3000.00')),
      'eventos/tabela.xml': strToU8(tabelaRubricas),
      'eventos/cat.xml': strToU8(comunicadoAcidente),
      'eventos/aviso.xml': strToU8(avisoPrevio),
      'recibos/relatorio.txt': strToU8('não é xml'),
      'eventos/quebrado.xml': strToU8('<eSocial><semEvento/></eSocial>'),
    });

    const { parsed, storedOnly, failed } = triage(zip);

    // Tudo entra: o que vira indicador e o que ainda não vira. Guardar hoje é o
    // que permite extrair um indicador amanhã, depois que o eSocial já tiver
    // apagado o arquivo.
    expect(parsed).toHaveLength(5);
    expect(parsed.map((e) => e.eventType).sort()).toEqual([
      'S-1010',
      'S-1200',
      'S-1200',
      'S-2210',
      'S-2250',
    ]);
    // Só o aviso prévio: o CAT passou a alimentar a seção SST.
    expect(storedOnly).toBe(1);
    expect(failed).toBe(1); // XML sem nó de evento

    // Guardar não significa contaminar indicador: a competência ignora o que
    // não sabe interpretar.
    const { competences } = normalizeEvents('org-1', parsed);
    expect(competences.find((c) => c.competence === '2026-05')?.gross_payroll_cents).toBe(800_000);
  });

  it('descarta o mesmo evento repetido dentro do pacote', () => {
    const xml = strToU8(remun('ID-REPETIDO', '12345678901', '5000.00'));
    const { parsed, duplicatedInPackage } = triage(
      zipSync({ 'a/ID.xml': xml, 'b/ID.xml': xml }),
    );
    expect(parsed).toHaveLength(1);
    expect(duplicatedInPackage).toBe(1);
  });

  it('agrega a competência a partir do pacote inteiro', () => {
    const zip = zipSync({
      'tabela.xml': strToU8(tabelaRubricas),
      'a.xml': strToU8(remun('ID-A', '12345678901', '5000.00')),
      'b.xml': strToU8(remun('ID-B', '98765432100', '3000.00')),
    });
    const { parsed } = triage(zip);
    const { competences, areas } = normalizeEvents('org-1', parsed);

    expect(competences).toHaveLength(1);
    expect(competences[0].competence).toBe('2026-05');
    expect(competences[0].gross_payroll_cents).toBe(800_000);
    // Dois trabalhadores distintos remunerados no mês.
    expect(competences[0].headcount).toBe(2);
    expect(areas.find((a) => a.area_code === 'ADM')?.gross_cents).toBe(800_000);
  });

  it('reprocessar o pacote produz exatamente o mesmo agregado', () => {
    const zip = zipSync({ 'a.xml': strToU8(remun('ID-A', '12345678901', '5000.00')) });
    const primeira = normalizeEvents('org-1', triage(zip).parsed);
    const segunda = normalizeEvents('org-1', triage(zip).parsed);
    expect(segunda.competences).toEqual(primeira.competences);
  });
});

/**
 * A reapuração relê os eventos do banco pela coluna `competence`. Eventos
 * cadastrais não trazem `perApur`, então a competência gravada precisa ser a
 * derivada da data do fato — senão eles nunca seriam relidos e a admissão
 * sumiria do agregado na importação seguinte.
 */
describe('competência efetiva dos eventos cadastrais', () => {
  const admissao = `<?xml version="1.0"?>
<eSocial><evtAdmissao Id="ADM-1">
  <ideEvento><indRetif>1</indRetif></ideEvento>
  <trabalhador><cpfTrab>12345678901</cpfTrab></trabalhador>
  <vinculo><matricula>M-0001</matricula></vinculo>
  <infoRegimeTrab><infoCeletista><dtAdm>2026-02-10</dtAdm></infoCeletista></infoRegimeTrab>
</evtAdmissao></eSocial>`;

  const desligamento = `<?xml version="1.0"?>
<eSocial><evtDeslig Id="DES-1">
  <ideVinculo><cpfTrab>98765432100</cpfTrab><matricula>M-0002</matricula></ideVinculo>
  <infoDeslig><mtvDeslig>02</mtvDeslig><dtDeslig>2026-02-25</dtDeslig></infoDeslig>
</evtDeslig></eSocial>`;

  it('deriva a competência da data do fato quando não há perApur', () => {
    const { parsed } = triage(
      zipSync({ 'adm.xml': strToU8(admissao), 'des.xml': strToU8(desligamento) }),
    );
    // O evento em si não declara competência…
    expect(parsed.map((e) => e.competence)).toEqual([undefined, undefined]);
    // …mas a efetiva vem da data, e é ela que vai para o banco.
    expect(parsed.map(effectiveCompetence)).toEqual(['2026-02', '2026-02']);
  });

  it('a competência gravada é a mesma que o agregado usa', () => {
    const { parsed } = triage(
      zipSync({ 'adm.xml': strToU8(admissao), 'des.xml': strToU8(desligamento) }),
    );
    const { competences } = normalizeEvents('org-1', parsed);

    expect(competences).toHaveLength(1);
    expect(competences[0].competence).toBe('2026-02');
    expect(competences[0].admissions).toBe(1);
    expect(competences[0].terminations).toBe(1);
    // Se divergisse da coluna gravada, a reapuração perderia estes eventos.
    expect(new Set(parsed.map(effectiveCompetence))).toEqual(
      new Set(competences.map((c) => c.competence)),
    );
  });
});
