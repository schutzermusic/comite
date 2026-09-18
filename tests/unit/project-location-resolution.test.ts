/**
 * LOCALIZAÇÃO DE EXECUÇÃO: a extração e o portão.
 *
 * Os testes aqui são quase todos de RECUSA, porque o risco desta feature não
 * é deixar de localizar um projeto — é localizar o projeto errado, no lugar
 * errado, com a mesma aparência de certeza.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveContractLocationEvidence, type LocationEvidenceSource,
} from '@/lib/projects/location/contract-location-evidence';
import {
  decideGeocode, distanceKm, type GeocodeResult,
} from '@/lib/projects/location/geocode-gate';

const scope = (text: string): LocationEvidenceSource =>
  ({ text, kind: 'contract_scope', documentId: 'doc-1', page: 1 });
const clause = (text: string, page: number | null = 7): LocationEvidenceSource =>
  ({ text, kind: 'contract_clause', documentId: 'doc-1', page });

/** O escopo real de JA10182283/2025, palavra por palavra. */
const JA_SCOPE = 'Prestação de serviços de manutenção elétrica corretiva e/ou melhoria no '
  + 'gerador elétrico da Unidade Geradora 05 da UHE Cachoeira Dourada, conforme Anexo II Escopo 1.';

describe('extração do local de execução', () => {
  it('JA10182283/2025: o escopo sustenta UHE Cachoeira Dourada', () => {
    const r = resolveContractLocationEvidence([scope(JA_SCOPE)]);
    expect(r.candidate?.siteLabel).toBe('UHE Cachoeira Dourada');
    expect(r.candidate?.evidenceKind).toBe('contract_scope');
    expect(r.candidate?.sourceDocumentId).toBe('doc-1');
    expect(r.candidate?.sourcePage).toBe(1);
    // A proveniência é o TRECHO, não um resumo reescrito.
    expect(r.candidate?.sourceExcerpt).toContain('UHE Cachoeira Dourada');
    expect(r.rejection).toBeNull();
  });

  it('SEDE da contratante nunca vira local de execução', () => {
    const r = resolveContractLocationEvidence([
      clause('A Contratante, com sede na Av. Paulista, 1000, São Paulo/SP, inscrita no CNPJ…'),
    ]);
    expect(r.candidate).toBeNull();
    expect(r.rejection).toBe('NO_FACILITY_NAMED');
  });

  it('endereço de COBRANÇA e de CORRESPONDÊNCIA são descartados', () => {
    for (const t of [
      'As faturas serão enviadas ao endereço de cobrança indicado na Parte A.',
      'Toda correspondência será dirigida ao endereço legal das partes.',
      'Fica eleito o foro da comarca de São Paulo para dirimir controvérsias.',
    ]) {
      expect(resolveContractLocationEvidence([clause(t)]).candidate).toBeNull();
    }
  });

  it('trecho AMBÍGUO — sede e usina no mesmo parágrafo — é recusado inteiro', () => {
    // Não se "extrai a parte boa": a ambiguidade É o defeito, e escolher a
    // usina aqui seria o extrator decidindo o que o documento não decidiu.
    const r = resolveContractLocationEvidence([
      clause('A Contratada, com sede em Belo Horizonte/MG, executará os serviços na UHE Furnas.'),
    ]);
    expect(r.candidate).toBeNull();
  });

  it('DOIS locais diferentes no contrato → MULTIPLE_CONFLICTING_SITES', () => {
    const r = resolveContractLocationEvidence([
      scope('Serviços na UHE Cachoeira Dourada.'),
      clause('Serviços complementares na UHE Emborcação.'),
    ]);
    expect(r.candidate).toBeNull();
    expect(r.rejection).toBe('MULTIPLE_CONFLICTING_SITES');
    expect(r.seen).toHaveLength(2);   // o conflito fica auditável
  });

  it('o MESMO local citado duas vezes não é conflito', () => {
    const r = resolveContractLocationEvidence([
      scope('Serviços na UHE Cachoeira Dourada.'),
      clause('Acesso à UHE Cachoeira Dourada mediante liberação.', 32),
    ]);
    expect(r.candidate?.siteLabel).toBe('UHE Cachoeira Dourada');
    // Entre menções iguais, prefere a de proveniência mais precisa.
    expect(r.candidate?.sourcePage).toBe(32);
  });

  it('texto vago, sem instalação nomeada, não produz candidato', () => {
    expect(resolveContractLocationEvidence([
      clause('Os serviços serão executados no local indicado pela Contratante.'),
    ]).rejection).toBe('NO_FACILITY_NAMED');
    expect(resolveContractLocationEvidence([]).rejection).toBe('TOO_VAGUE');
  });
});

describe('portão do geocodificador', () => {
  const at = (
    latitude: number, longitude: number,
    precision: GeocodeResult['precision'] = 'site',
    displayName = 'X',
  ): GeocodeResult => ({ latitude, longitude, precision, displayName, importance: 0.3, raw: {} });

  it('resultado único e preciso é aceito', () => {
    const d = decideGeocode([at(-18.5023, -49.4913, 'site', 'Barragem UHE Cachoeira Dourada')]);
    expect(d.accepted?.latitude).toBeCloseTo(-18.5023, 4);
    expect(d.rejection).toBeNull();
  });

  it('lista vazia → NO_RESULT, e nenhuma coordenada', () => {
    const d = decideGeocode([]);
    expect(d.accepted).toBeNull();
    expect(d.rejection).toBe('NO_RESULT');
  });

  it('precisão de estado ou país NÃO localiza um gerador', () => {
    expect(decideGeocode([at(-16, -49, 'region')]).rejection).toBe('INSUFFICIENT_PRECISION');
    expect(decideGeocode([at(-14, -51, 'country')]).rejection).toBe('INSUFFICIENT_PRECISION');
    expect(decideGeocode([at(-18.5, -49.5, 'unknown')]).rejection).toBe('INSUFFICIENT_PRECISION');
  });

  it('lugares DISTANTES entre si → AMBIGUOUS_RESULTS, e não "o primeiro"', () => {
    const d = decideGeocode([
      at(-18.5023, -49.4913, 'site'),
      at(-22.9068, -43.1729, 'site'),   // Rio: outro lugar, não outra grafia
    ]);
    expect(d.accepted).toBeNull();
    expect(d.rejection).toBe('AMBIGUOUS_RESULTS');
    expect(d.spreadKm).toBeGreaterThan(500);
  });

  it('as duas margens do mesmo reservatório são o MESMO lugar', () => {
    // A UHE Cachoeira Dourada fica no Paranaíba, entre GO e MG: o gazeteer
    // costuma devolver a casa de força e o município de cada lado.
    const d = decideGeocode([
      at(-18.5023, -49.4913, 'site'),
      at(-18.4886, -49.4836, 'municipality'),
    ]);
    expect(d.rejection).toBeNull();
    // Entre eles, prefere a INSTALAÇÃO à cidade.
    expect(d.accepted?.precision).toBe('site');
  });

  it('coordenada fora do envelope, e o clássico 0,0, são recusados', () => {
    expect(decideGeocode([at(48.85, 2.35, 'site')]).rejection).toBe('IMPLAUSIBLE_COORDINATE');
    expect(decideGeocode([at(0, 0, 'site')]).rejection).toBe('IMPLAUSIBLE_COORDINATE');
    expect(decideGeocode([at(Number.NaN, -49, 'site')]).rejection).toBe('IMPLAUSIBLE_COORDINATE');
  });

  it('TODA recusa devolve coordenada nula — nunca um palpite', () => {
    for (const results of [
      [], [at(-16, -49, 'region')], [at(0, 0, 'site')],
      [at(-18.5, -49.5, 'site'), at(-3.1, -60.0, 'site')],
    ]) {
      const d = decideGeocode(results);
      if (d.rejection) expect(d.accepted).toBeNull();
    }
  });

  it('distanceKm confere com uma distância conhecida', () => {
    // São Paulo → Rio de Janeiro, ~360 km em linha reta.
    const km = distanceKm(
      { latitude: -23.5505, longitude: -46.6333 },
      { latitude: -22.9068, longitude: -43.1729 },
    );
    expect(km).toBeGreaterThan(340);
    expect(km).toBeLessThan(380);
  });
});

describe('o caminho inteiro, de ponta a ponta, sem rede', () => {
  it('JA10182283/2025: escopo → candidato → coordenada aceita', () => {
    const evidence = resolveContractLocationEvidence([scope(JA_SCOPE)]);
    expect(evidence.candidate).not.toBeNull();

    const decision = decideGeocode([{
      latitude: -18.5022993, longitude: -49.4912546, precision: 'site',
      displayName: 'Barragem UHE Cachoeira Dourada, Cachoeira Dourada, Minas Gerais, Brasil',
      importance: 0.133, raw: { category: 'waterway', type: 'dam' },
    }]);
    expect(decision.accepted).not.toBeNull();
    expect(decision.accepted!.latitude).toBeCloseTo(-18.5023, 4);
    expect(decision.accepted!.longitude).toBeCloseTo(-49.4913, 4);
  });

  it('contrato sem local de execução não chega a geocodificar', () => {
    const evidence = resolveContractLocationEvidence([
      clause('A Contratante, com sede na Avenida Brasil, 500, pagará em 30 dias.'),
    ]);
    expect(evidence.candidate).toBeNull();
    // Sem candidato não há consulta, e sem consulta não há coordenada.
    expect(decideGeocode([]).accepted).toBeNull();
  });
});
