/**
 * Resolução da contraparte: entidade canônica × texto do contrato.
 *
 * A precedência que estes testes travam é estrita e tem exatamente três casos:
 *
 *   1. há vínculo `counterparty_party_id` E a party foi carregada  → nome canônico, `live(..., 'parties')`
 *   2. não há vínculo (ou a party não veio) e há texto             → `live(..., 'contracts')`
 *   3. nenhum dos dois                                             → `missing('null-in-source')`
 *
 * O que eles existem para IMPEDIR:
 *
 *  · que ligar um contrato a uma party promova ou rebaixe o ESTADO de
 *    confiança. Os dois primeiros casos são `live`; só a tabela de origem
 *    difere, e é isso que o rótulo `source` diz;
 *  · que um `missing` vire valor por causa do vínculo. Uma contraparte não
 *    apurada permanece não apurada;
 *  · que qualquer semelhança de nome participe da decisão. "ENEL" e "ENEL
 *    GREEN POWER" convivem sem se tocarem: só o id explícito liga.
 */

import { describe, it, expect } from 'vitest';
import { buildTrustedContract } from '@/lib/contracts/trust/read-model';
import { isLive, isMissing, hasOfficialValue } from '@/lib/contracts/trust/trusted';
import { contractRowToLegacyContract } from '@/lib/contracts/contract-service';
import type { ContractRelationsBatch, ContractRow } from '@/lib/contracts/contract-service';
import type { PartyRow } from '@/lib/parties/types';
import { PROJECT_CEMIG, FIXED_NOW } from './fixtures/contract-fixtures';

const noErrors = () => ({
  obligations: null, billing: null, documents: null,
  approvals: null, projectLinks: null, risks: null, ai: null,
  milestones: null, clauses: null, penalties: null, obligationDefinitions: null,
});

function batch(parties?: Map<string, PartyRow>): ContractRelationsBatch {
  return {
    obligations: new Map(), billingEvents: new Map(), documents: new Map(),
    approvals: new Map(), projectLinks: new Map(), riskLinks: new Map(),
    aiAnalyses: new Map(), milestones: new Map(), clauses: new Map(),
    penalties: new Map(), obligationDefinitions: new Map(), riskDetails: new Map(),
    parties,
    sectionsWithData: {
      obligations: false, billing: false, documents: false,
      approvals: false, projectLinks: false, risks: false, ai: false,
    },
    sectionErrors: noErrors(),
  } as ContractRelationsBatch;
}

const row = (over: Partial<ContractRow> = {}): ContractRow => ({
  id: 'ctr-1', organization_id: 'org-1', project_id: null,
  client_id: null, supplier_id: null,
  title: 'Manutenção de subestações', contract_number: 'CT-2026-014',
  counterparty_name: 'ENEL', counterparty_party_id: null,
  contract_type: 'Ordem de serviço',
  status: 'active', lifecycle_stage: null,
  start_date: '2026-05-13', end_date: '2027-05-13',
  signed_date: '2026-05-13', renewal_date: null,
  currency: 'BRL', total_value: 1_000, monthly_value: null,
  payment_terms: null, scope_summary: null, risk_level: 'medium',
  health_score: null, owner_user_id: 'u-1',
  created_by: 'u-1', updated_by: 'u-1',
  created_at: '2026-05-14T09:00:00Z', updated_at: '2026-05-14T09:00:00Z',
  deleted_at: null, data_class: 'live',
  ...over,
} as ContractRow);

const party = (over: Partial<PartyRow> = {}): PartyRow => ({
  id: 'party-1', organization_id: 'org-1', kind: 'organization',
  legal_name: 'ENEL DISTRIBUIÇÃO SÃO PAULO S.A.', trade_name: null,
  document_type: 'cnpj', document_number: '61.695.227/0001-93',
  document_normalized: '61695227000193', country_code: 'BR',
  active: true, notes: null, source_system: null, external_key: null,
  created_by: 'u-1', updated_by: 'u-1',
  created_at: '2026-05-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z',
  ...over,
} as PartyRow);

const counterpartyOf = (r: ContractRow, b: ContractRelationsBatch) =>
  buildTrustedContract(r, b, [PROJECT_CEMIG], FIXED_NOW).counterparty;

// ═══════════════════════════════════════════════════════════════════
// Precedência
// ═══════════════════════════════════════════════════════════════════

describe('precedência da contraparte', () => {
  it('com vínculo resolvido, usa o nome canônico e diz que veio de `parties`', () => {
    const p = party();
    const t = counterpartyOf(
      row({ counterparty_party_id: p.id }),
      batch(new Map([[p.id, p]])),
    );

    expect(isLive(t)).toBe(true);
    if (isLive(t)) {
      expect(t.value).toBe('ENEL DISTRIBUIÇÃO SÃO PAULO S.A.');
      expect(t.source).toBe('parties');
    }
  });

  it('sem vínculo, usa o texto do contrato e diz que veio de `contracts`', () => {
    const t = counterpartyOf(row(), batch());

    expect(isLive(t)).toBe(true);
    if (isLive(t)) {
      expect(t.value).toBe('ENEL');
      expect(t.source).toBe('contracts');
    }
  });

  it('sem vínculo e sem texto, permanece não apurada', () => {
    const t = counterpartyOf(row({ counterparty_name: null }), batch());

    expect(isMissing(t)).toBe(true);
    if (isMissing(t)) expect(t.reason).toBe('null-in-source');
  });
});

// ═══════════════════════════════════════════════════════════════════
// Degradação — nunca erro, nunca invenção
// ═══════════════════════════════════════════════════════════════════

describe('leitura que não resolveu parties', () => {
  it('mapa ausente (ninguém resolveu) cai no texto — comportamento histórico', () => {
    const t = counterpartyOf(row({ counterparty_party_id: 'party-1' }), batch(undefined));

    expect(isLive(t)).toBe(true);
    if (isLive(t)) {
      expect(t.value).toBe('ENEL');
      expect(t.source).toBe('contracts');
    }
  });

  it('mapa vazio (a leitura de parties falhou) também cai no texto, sem erro', () => {
    // A falha de `parties` é tolerada de propósito: perder o nome canônico
    // degrada precisão; derrubar a leitura do contrato degrada acesso.
    const t = counterpartyOf(row({ counterparty_party_id: 'party-1' }), batch(new Map()));

    expect(isLive(t)).toBe(true);
    if (isLive(t)) expect(t.source).toBe('contracts');
  });

  it('vínculo apontando para party ausente NÃO inventa valor quando não há texto', () => {
    const t = counterpartyOf(
      row({ counterparty_name: null, counterparty_party_id: 'party-1' }),
      batch(new Map()),
    );

    expect(isMissing(t)).toBe(true);
    if (isMissing(t)) expect(t.reason).toBe('null-in-source');
  });
});

// ═══════════════════════════════════════════════════════════════════
// O vínculo não mexe na confiança
// ═══════════════════════════════════════════════════════════════════

describe('o vínculo canônico não altera o estado de confiança', () => {
  it('party e texto produzem o MESMO estado `live` — só a origem difere', () => {
    const p = party();
    const canonical = counterpartyOf(row({ counterparty_party_id: p.id }), batch(new Map([[p.id, p]])));
    const free = counterpartyOf(row(), batch());

    expect(canonical.trust).toBe(free.trust);
    expect(canonical.trust).toBe('live');
    expect(isLive(canonical) && isLive(free) && canonical.source !== free.source).toBe(true);
  });

  it('a canonicidade é legível sem campo extra no modelo', () => {
    // O selo `counterpartyIsCanonical` foi recusado por redundância: o par
    // (trust, source) já responde a pergunta.
    const p = party();
    const t = counterpartyOf(row({ counterparty_party_id: p.id }), batch(new Map([[p.id, p]])));
    expect(t.trust === 'live' && t.source === 'parties').toBe(true);
    expect('counterpartyIsCanonical' in
      buildTrustedContract(row(), batch(), [PROJECT_CEMIG], FIXED_NOW)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Nada de aproximação
// ═══════════════════════════════════════════════════════════════════

describe('nenhuma aproximação de nome participa da resolução', () => {
  it('ENEL e ENEL GREEN POWER não se atraem: só o id explícito liga', () => {
    const green = party({ id: 'party-green', legal_name: 'ENEL GREEN POWER BRASIL S.A.' });

    // O contrato diz "ENEL" e o mapa contém apenas a Green Power. Sem vínculo,
    // nada acontece — que é a única resposta honesta.
    const t = counterpartyOf(row(), batch(new Map([[green.id, green]])));

    expect(isLive(t)).toBe(true);
    if (isLive(t)) {
      expect(t.value).toBe('ENEL');
      expect(t.source).toBe('contracts');
    }
  });

  it('o vínculo vence o texto mesmo quando os dois discordam', () => {
    // Se alguém ligou o contrato explicitamente, essa decisão humana é a
    // fonte — e o texto do papel continua gravado na coluna, intacto.
    const p = party({ legal_name: 'ENEL GREEN POWER BRASIL S.A.' });
    const r = row({ counterparty_name: 'Enel (nome antigo)', counterparty_party_id: p.id });
    const t = counterpartyOf(r, batch(new Map([[p.id, p]])));

    if (hasOfficialValue(t)) expect(t.value).toBe('ENEL GREEN POWER BRASIL S.A.');
    expect(r.counterparty_name).toBe('Enel (nome antigo)');
  });
});

// ═══════════════════════════════════════════════════════════════════
// Projeção legada
// ═══════════════════════════════════════════════════════════════════

describe('contractRowToLegacyContract', () => {
  it('sem party, mantém exatamente o comportamento anterior', () => {
    expect(contractRowToLegacyContract(row()).vendorOrParty).toBe('ENEL');
  });

  it('sem party e sem texto, mantém o rótulo de ausência de sempre', () => {
    expect(contractRowToLegacyContract(row({ counterparty_name: null })).vendorOrParty)
      .toBe('Contraparte nao informada');
  });

  it('com party, exibe o nome canônico', () => {
    const p = party();
    expect(contractRowToLegacyContract(row({ counterparty_party_id: p.id }), [], p).vendorOrParty)
      .toBe('ENEL DISTRIBUIÇÃO SÃO PAULO S.A.');
  });
});
