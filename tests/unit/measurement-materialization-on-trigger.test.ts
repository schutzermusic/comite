/**
 * A MEDIÇÃO NASCE DO GATILHO — o contrato da migration 190.
 *
 * Estes testes leem o SQL e o cliente, e não o banco: o que eles protegem é a
 * fronteira que uma linha nova quebra sem ninguém notar — uma materialização
 * que nasça medida, uma escrita aberta ao navegador, uma segunda tabela, um
 * `status` virando parâmetro.
 *
 * A prova de que a materialização REALMENTE acontece é de outro tipo e roda
 * contra o banco: `scripts/apply-measurement-materialization-on-trigger.mjs`.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const SQL = fs.readFileSync(
  'supabase/migrations/190_measurement_materialization_on_trigger.sql', 'utf8',
);
const SERVICE = fs.readFileSync(
  'src/lib/projects/measurements/measurement-service.ts', 'utf8',
);
const TAB = fs.readFileSync(
  'src/components/projects/measurements/ProjectMeasurementsTab.tsx', 'utf8',
);

// ───────────────────────────────────────────────────────────────────────────
// NENHUMA SEGUNDA TABELA, NENHUM SEGUNDO DONO
// ───────────────────────────────────────────────────────────────────────────

describe('a materialização reusa o ciclo de vida canônico', () => {
  it('não cria tabela de medição nova', () => {
    expect(SQL).not.toMatch(/CREATE TABLE/i);
  });

  it('escreve em project_measurements — a tabela da 130', () => {
    expect(SQL).toContain('INSERT INTO public.project_measurements');
    expect((SQL.match(/INSERT INTO public\./g) ?? [])).toHaveLength(1);
  });

  it('não substitui a materialização por cadência da 134', () => {
    expect(SQL).not.toContain('CREATE OR REPLACE FUNCTION public.project_measurements_materialize');
    expect(SQL).not.toMatch(/DROP FUNCTION[^;]*project_measurements_materialize\b/);
  });

  it('reaproveita exigências, prontidão e emissão de evento da 132/133', () => {
    expect(SQL).toContain('project_measurement_resolve_requirements');
    expect(SQL).toContain('project_measurement_recompute_readiness');
    expect(SQL).toContain('project_measurement_emit');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// NASCE PLANEJADA — NUNCA MEDIDA, ACEITA OU FATURÁVEL
// ───────────────────────────────────────────────────────────────────────────

describe('a instância nasce como trabalho a fazer', () => {
  it('o status é literal PLANNED no INSERT', () => {
    expect(SQL).toMatch(/'PLANNED', p_origin/);
  });

  it('status não é parâmetro de nenhuma função', () => {
    expect(SQL).not.toMatch(/p_status/);
  });

  it('não grava medição, aceite nem valor apurado', () => {
    for (const forbidden of [
      'measured_value', 'accepted_value', 'accepted_at', 'acceptance_source',
      'submitted_at', 'quantity',
    ]) {
      expect(SQL).not.toContain(forbidden);
    }
  });

  it('não cria evidência, faturamento nem recebível', () => {
    for (const table of [
      'project_measurement_evidence', 'contract_billing_events',
      'finance_receivables', 'contract_billing_eligibility',
    ]) {
      expect(SQL).not.toMatch(new RegExp(`INSERT INTO[^;]*${table}`, 'i'));
    }
  });

  it('não escreve no cronograma — o gatilho LÊ a etapa, não a altera', () => {
    expect(SQL).not.toMatch(/UPDATE public\.project_timeline_items/i);
  });

  it('não promove percentual de avanço a conclusão', () => {
    expect(SQL).not.toContain('percent_complete');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// IDEMPOTÊNCIA E IDENTIDADE CANÔNICA
// ───────────────────────────────────────────────────────────────────────────

describe('a mesma ocorrência nunca vira duas linhas', () => {
  it('a idempotência mora no índice único da 130', () => {
    expect(SQL).toContain('ON CONFLICT DO NOTHING');
  });

  it('a chave delega à função de cadência antes de responder', () => {
    expect(SQL).toContain('public.project_measurement_occurrence_key(p_cadence, p_period_start, p_milestone_id)');
  });

  it('a âncora é identidade — marco, depois etapa — e nunca uma data inventada', () => {
    expect(SQL).toContain("'milestone:' || p_milestone_id::text");
    expect(SQL).toContain("'timeline:'  || p_timeline_item_id::text");
  });

  it('sem marco e sem etapa a chave é NULL, e nada é criado', () => {
    expect(SQL).toContain('ELSE NULL');
    expect(SQL).toContain('CONTINUE WHEN okey IS NULL');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// O GATILHO É A CONCLUSÃO DA ETAPA GOVERNADA
// ───────────────────────────────────────────────────────────────────────────

describe('o gatilho é o fato de cronograma, não o relógio', () => {
  it('só etapa CONCLUÍDA materializa', () => {
    expect(SQL).toContain("IF item.actual_finish IS NULL AND item.status IS DISTINCT FROM 'completed'");
  });

  it('só ponte ACEITA entra — proposta não materializa nada', () => {
    expect(SQL).toContain('contract_measurement_rule_timeline_governed');
    expect(SQL).not.toContain("review_state = 'proposed'");
  });

  it('regra removida ou fora de vigência não materializa', () => {
    expect(SQL).toContain("r.effect <> 'removed'");
    expect(SQL).toContain('r.effective_until IS NULL OR r.effective_until >  trigger_date');
  });

  it('os dois gatilhos existem, e o de UPDATE só dispara na virada', () => {
    expect(SQL).toContain('AFTER INSERT ON public.project_timeline_items');
    expect(SQL).toContain('AFTER UPDATE OF status, actual_finish ON public.project_timeline_items');
    expect(SQL).toContain("OLD.actual_finish IS NULL AND OLD.status IS DISTINCT FROM 'completed'");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// INQUILINO E PERMISSÃO
// ───────────────────────────────────────────────────────────────────────────

describe('a fronteira de inquilino não vem por parâmetro', () => {
  it('a organização é lida da própria etapa de cronograma', () => {
    expect(SQL).toContain('g.organization_id = item.organization_id');
    expect(SQL).toContain('r.organization_id = g.organization_id');
  });

  it('a materialização não é chamável do navegador', () => {
    expect(SQL).toContain(
      'REVOKE ALL ON FUNCTION public.project_measurement_materialize_for_timeline_item(uuid, text)\n'
      + '  FROM PUBLIC, anon, authenticated;',
    );
  });

  it('o backfill não é chamável do navegador', () => {
    expect(SQL).toContain(
      'REVOKE ALL ON FUNCTION public.project_measurements_backfill_from_schedule(uuid)\n'
      + '  FROM PUBLIC, anon, authenticated;',
    );
  });

  it('a válvula humana exige pessoa E permissão', () => {
    expect(SQL).toContain('actor uuid := auth.uid()');
    expect(SQL).toContain("public.current_user_has_permission('projects.measurements.edit')");
    expect(SQL).toContain(
      'GRANT EXECUTE ON FUNCTION public.project_measurement_ensure_for_milestone(uuid) TO authenticated;',
    );
  });

  it('a válvula humana exige ponte aceita — não inventa cronograma', () => {
    expect(SQL).toContain('MAPPING_NOT_GOVERNED');
  });

  it('o backfill não roda sozinho ao aplicar a migration', () => {
    expect(SQL).not.toMatch(/SELECT\s+public\.project_measurements_backfill_from_schedule/);
    expect(SQL).not.toMatch(/PERFORM\s+public\.project_measurements_backfill_from_schedule/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// O CLIENTE: ATO HUMANO, NUNCA EFEITO DE TELA
// ───────────────────────────────────────────────────────────────────────────

describe('nada materializa porque uma página foi aberta', () => {
  it('a RPC é exposta uma vez, na borda de medição', () => {
    expect(SERVICE).toContain("rpc<string | null>('project_measurement_ensure_for_milestone'");
  });

  it('o código de erro do mapeamento ausente é traduzido', () => {
    expect(SERVICE).toContain('MAPPING_NOT_GOVERNED');
  });

  it('a aba chama a RPC por clique, e nunca dentro de um efeito', () => {
    expect(TAB).toContain('ensureMeasurementForMilestone');
    // A chamada mora num callback de clique; nenhum useEffect a dispara.
    const effects = TAB.split('useEffect(').slice(1);
    for (const body of effects) {
      expect(body.slice(0, 800)).not.toContain('ensureMeasurementForMilestone');
    }
  });

  it('o botão só aparece para quem pode editar medição', () => {
    expect(TAB).toContain("hasPermission('projects.measurements.edit')");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// A PORTA ESTREITA DO ANEXO (migration 191)
// ───────────────────────────────────────────────────────────────────────────

describe('anexar documento não reabre o que a 131 fechou', () => {
  const ATTACH = fs.readFileSync(
    'supabase/migrations/191_measurement_attach_document.sql', 'utf8',
  );
  const WORKSPACE = fs.readFileSync(
    'src/lib/projects/measurements/evidence-workspace.ts', 'utf8',
  );

  it('a porta tem portão de permissão — a função de 131 não tinha', () => {
    expect(ATTACH).toContain("public.current_user_has_permission('projects.measurements.edit')");
    expect(ATTACH).toContain('actor uuid := auth.uid()');
  });

  it('tipo, classe e procedência são literais, não parâmetros', () => {
    expect(ATTACH).toContain("'project_file'");
    expect(ATTACH).toContain("'RAW_EVIDENCE'");
    expect(ATTACH).toContain("'manual'");
    for (const param of ['p_source_type', 'p_evidence_class', 'p_link_source', 'p_confidence']) {
      expect(ATTACH).not.toContain(param);
    }
  });

  it('a fronteira de inquilino é escrita à mão, porque SECURITY DEFINER suspende a RLS', () => {
    expect(ATTACH).toContain('SECURITY DEFINER');
    expect(ATTACH).toContain('public.current_user_organization_id()');
    expect(ATTACH).toContain('d_org IS DISTINCT FROM m_org');
  });

  it('a 191 não concede EXECUTE na função de 131', () => {
    expect(ATTACH).not.toMatch(/GRANT[^;]*project_measurement_link_evidence/i);
  });

  it('só a porta estreita é concedida ao navegador', () => {
    expect(ATTACH).toContain(
      'GRANT EXECUTE ON FUNCTION public.project_measurement_attach_document(uuid, uuid, text)\n'
      + '  TO authenticated;',
    );
  });

  it('a bancada de evidência usa a porta, e não a função revogada', () => {
    expect(WORKSPACE).toContain('attachDocumentToMeasurement');
    expect(WORKSPACE).not.toContain('linkMeasurementEvidence');
  });

  it('a 191 não mede, não aceita e não fatura', () => {
    for (const forbidden of [
      'measured_value', 'accepted_at', 'contract_billing_events',
      'UPDATE public.project_measurements',
    ]) {
      expect(ATTACH).not.toContain(forbidden);
    }
  });
});
