import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const m114 = readFileSync('supabase/migrations/114_contract_obligation_definitions.sql', 'utf8');
const m115 = readFileSync('supabase/migrations/115_contract_obligation_instances.sql', 'utf8');
const m116 = readFileSync('supabase/migrations/116_contract_obligation_evidence_and_boundaries.sql', 'utf8');
const m117 = readFileSync('supabase/migrations/117_contract_obligation_activation.sql', 'utf8');
const store = readFileSync('src/lib/contracts/obligations/server/store.ts', 'utf8');
const resolve = readFileSync('src/lib/contracts/obligations/resolve.ts', 'utf8');
const actor = readFileSync('src/lib/contracts/obligations/server/actor.ts', 'utf8');

describe('isolamento de inquilino', () => {
  it('toda referência entre tabelas de inquilino é composta', () => {
    const all = m114 + m115 + m116;
    const references = all.match(/REFERENCES public\.\w+ \([^)]*\)/g) ?? [];
    const tenantTargets = references.filter((r) =>
      /public\.(contracts|contract_clauses|contract_documents|contract_amendments|parties|contract_obligation_\w+)/.test(r));
    expect(tenantTargets.length).toBeGreaterThan(10);
    for (const reference of tenantTargets) {
      expect(reference).toContain('organization_id');
    }
  });

  it('nenhuma escrita é concedida ao navegador, TRUNCATE incluído', () => {
    // TRUNCATE não é filtrado por RLS, e o padrão do schema o concede a todos.
    expect(m116).toContain('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.%I FROM authenticated, anon');
    expect(m116).toContain('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.contract_obligations FROM authenticated, anon');
  });

  it('a leitura é escopada pela organização do chamador', () => {
    expect(m116).toContain('organization_id = public.current_user_organization_id()');
  });

  it('a organização vem do PERFIL, nunca do corpo do pedido', () => {
    expect(actor).toContain("from('profiles')");
    expect(actor).not.toMatch(/body\.organizationId|input\.organizationId/);
  });

  it('a materialização não é executável pelo navegador', () => {
    expect(m115).toContain('REVOKE ALL ON FUNCTION public.contract_obligations_materialize(uuid, date, uuid) FROM PUBLIC, anon, authenticated');
    expect(m117).toContain('FROM PUBLIC, anon, authenticated');
  });
});

describe('verdade histórica', () => {
  it('a definição é somente-acréscimo e a remoção vira sucessão', () => {
    expect(m114).toContain('contract_obligations_reject_definition_rewrite');
    expect(m114).toContain('crie uma sucessora em vez de reescrever');
  });

  it('apagar é recusado à aplicação, mas o caminho privilegiado segue aberto', () => {
    // Recusar a todo mundo tornaria impossível apagar um inquilino inteiro.
    expect(m114).toContain('cod_no_erasure BEFORE DELETE');
    expect(m114).toContain('contracts_reject_history_erasure');
    expect(m115).toContain('coih_no_erasure BEFORE DELETE');
  });

  it('um antecessor tem no máximo um sucessor', () => {
    expect(m114).toContain('cod_one_successor');
  });

  it('a transição e o histórico são gravados na mesma transação', () => {
    expect(m115).toContain('contract_obligations_record_transition');
    expect(m115).toContain('INSERT INTO public.contract_obligation_instance_history');
  });
});

describe('ausência não vira afirmação', () => {
  it('blocks_billing é NULLABLE — nunca um false por omissão', () => {
    expect(m114).toContain('blocks_billing          boolean,');
    expect(m114).not.toMatch(/blocks_billing\s+boolean\s+NOT NULL DEFAULT false/);
    expect(store).toContain('blocks_billing: input.blocksBilling ?? null');
  });

  it('o resolvedor devolve UNKNOWN, e UNKNOWN não degrada para FALSE', () => {
    expect(resolve).toContain("if (definitionBlocks === null) return 'UNKNOWN'");
    expect(resolve).toContain("if (instance.dueConfidence !== 'known'");
  });

  it('dia útil sem calendário não vira dia corrido', () => {
    expect(m117).toContain("d.calendar_basis = 'business_days'");
    expect(m117).toContain("due := NULL; confidence := 'unknown'");
  });

  it('evento externo não observado não ativa nada', () => {
    expect(m117).toContain("-- 'manual' e 'external_event': o fato ainda não foi observado.");
    expect(m117).toContain("act_state := 'unknown'");
  });

  it('presença de evidência não é aprovação', () => {
    expect(m116).toContain('requires_formal_acceptance');
    expect(m116).toContain('contract_obligations_evidence_acceptance_default');
    expect(resolve).toContain('PRESENÇA NÃO É APROVAÇÃO');
  });

  it('dispensa sem autoridade ou com aprovação pendente não produz efeito', () => {
    expect(m116).toContain('contract_obligation_exception_is_effective');
    expect(m116).toContain("p_exception.approval_state IN ('not_required', 'approved')");
    expect(resolve).toContain('if (!hasAuthority) return false');
  });
});

describe('proveniência obrigatória', () => {
  it('nenhuma obrigação existe sem origem contratual', () => {
    expect(m114).toContain('cod_has_provenance');
    expect(m114).toContain('source_clause_id IS NOT NULL OR source_amendment_id IS NOT NULL OR source_document_id IS NOT NULL');
  });

  it('Party não provada preserva o texto e deixa o vínculo ausente', () => {
    expect(m114).toContain('cop_identified');
    expect(store).toContain('party_id: p.partyId ?? null');
  });
});

describe('fronteiras de fase', () => {
  it('não implementa Event Graph, fila de plataforma nem aprovação da Fase 5', () => {
    const all = m114 + m115 + m116 + m117;
    expect(all).not.toContain('domain_events');
    expect(all).not.toContain('apex_jobs');
    expect(all).not.toContain('SKIP LOCKED');
    expect(all).not.toMatch(/CREATE TABLE public\.approval_(policies|requests|steps|decisions)/);
  });

  it('não implementa medição de projeto nem a cadeia financeira', () => {
    const all = m114 + m115 + m116 + m117;
    expect(all).not.toMatch(/CREATE TABLE public\.project_measurements/);
    expect(all).not.toContain('REFERENCES public.ledger_entry');
    expect(all).not.toContain('REFERENCES public.apar_title');
    expect(store).not.toContain("from('ledger_entry')");
    expect(store).not.toContain("from('apar_title')");
  });

  it('a lista legada é preservada, não migrada', () => {
    expect(m116).toContain('NÃO é migrada nem apagada');
    const all = m114 + m115 + m116 + m117;
    expect(all).not.toMatch(/INSERT INTO public\.contract_obligation_definitions[\s\S]{0,200}FROM public\.contract_obligations/);
    expect(all).not.toMatch(/DELETE FROM public\.contract_obligations/);
  });
});

describe('registro de migrations', () => {
  it('a fase ocupa 114–117, sem colisão e sem buraco novo', () => {
    const versions = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).map((f) => f.slice(0, 3)).sort();
    expect(versions.filter((v) => ['114', '115', '116', '117'].includes(v))).toEqual(['114', '115', '116', '117']);
    expect(new Set(versions).size).toBe(versions.length);
    // A ponta CRESCE com as fases seguintes; prendê-la a um número faria toda
    // migration nova quebrar um teste da fase anterior.
    expect(Number(versions.at(-1))).toBeGreaterThanOrEqual(117);
    expect(versions).not.toContain('090');
  });

  it('a 115 não foi editada depois de aplicada — a correção veio na 117', () => {
    expect(m117).toContain('CREATE OR REPLACE FUNCTION public.contract_obligations_materialize');
    expect(m117).toContain('A 115 não é editada');
  });
});
