import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import {
  contractRiskLabel,
  contractStatusLabel,
  formatContractDate,
  formatContractMoney,
  formatDocumentaryField,
  likelyDuplicatePeople,
  likelyDuplicateProjects,
  suggestOperationalProjectName,
} from '@/lib/contracts/onboarding/production-polish';

const source = (path: string) => readFileSync(path, 'utf8');
const migration = source('supabase/migrations/167_contract_onboarding_production_polish.sql');
const wizard = source('src/components/contracts/contract-upload.tsx');

describe('migration 167 — canonical business responsibility', () => {
  it('owns responsibility alone and is additive without responsibility backfill', () => {
    /*
      This used to pin the global migration tip, which only expressed "167 is
      mine" while 167 happened to be the newest file. A later migration on an
      unrelated subject broke a test that says nothing about it. What actually
      matters is that no migration above 167 touches responsibility.
    */
    const later = readdirSync('supabase/migrations')
      .filter((file) => /^\d{3}_.*\.sql$/.test(file) && Number(file.slice(0, 3)) > 167);
    for (const file of later) {
      const sql = readFileSync(`supabase/migrations/${file}`, 'utf8');
      expect(sql).not.toContain('owner_person_id');
      expect(sql).not.toContain('responsible_person_id');
    }
    expect(migration).toContain('ALTER TABLE public.contracts\n  ADD COLUMN owner_person_id uuid');
    expect(migration).toContain('ALTER TABLE public.projects\n  ADD COLUMN responsible_person_id uuid');
    expect(migration).not.toMatch(/UPDATE\s+public\.(contracts|projects)\s+SET\s+(owner_person_id|responsible_person_id)/i);
  });

  it('uses tenant-safe composite People foreign keys', () => {
    expect(migration).toContain('UNIQUE (organization_id, id)');
    expect(migration).toContain('FOREIGN KEY (organization_id, owner_person_id)');
    expect(migration).toContain('FOREIGN KEY (organization_id, responsible_person_id)');
    expect(migration).toContain('REFERENCES public.people(organization_id, id)');
  });

  it('enforces active People at assignment and prevents later invalidation', () => {
    expect(migration).toContain("p.status = 'active'");
    expect(migration).toContain('contracts_active_owner_person');
    expect(migration).toContain('projects_active_responsible_person');
    expect(migration).toContain('people_keep_business_responsibility_active');
    expect(migration).toContain('Reassign active contract/project responsibility before inactivating this person.');
  });

  it('keeps owner_user_id compatible while allowing a Person without login', () => {
    const foundation = source('supabase/migrations/006_contracts_supabase.sql');
    expect(foundation).toMatch(/owner_user_id uuid REFERENCES auth\.users\(id\) NULL/);
    expect(migration).not.toMatch(/ALTER (?:TABLE )?public\.contracts[^;]*owner_user_id[^;]*NOT NULL/i);
    expect(migration).toContain('IF owner_person_id IS NULL AND owner_id IS NULL THEN');
    expect(migration).toContain("nullif(p_final->>'owner_person_id','')::uuid");
    expect(migration).toContain('risk,owner_id,owner_person_id,p_actor,p_actor');
  });

  it('updates the canonical finalizer rather than introducing another path', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.contract_onboarding_finalize(');
    expect(migration.match(/FUNCTION public\.contract_onboarding_finalize\(/g)).toHaveLength(3);
    expect(migration).not.toMatch(/contract_onboarding_finalize_v2|INSERT INTO public\.contracts[\s\S]*CREATE FUNCTION public\.(?!contract_onboarding_finalize)/);
    const route = source('src/app/api/contracts/onboarding/[id]/route.ts');
    expect(route).toContain("rpc('contract_onboarding_finalize'");
    expect(route).toContain('p_actor: auth.user.id');
  });

  it('directory RPCs are tenant and permission scoped and table grants remain RLS-limited', () => {
    expect(migration).toContain('contract_onboarding_responsible_people_directory');
    expect(migration).toContain('contract_onboarding_project_directory');
    expect(migration).toContain('org_id := public.current_user_organization_id()');
    expect(migration).toContain("current_user_has_permission('people.manage')");
    expect(migration).toContain("current_user_has_permission('projects.create')");
    expect(migration).toContain('GRANT SELECT, INSERT ON TABLE public.people, public.projects TO authenticated');
    expect(migration).not.toMatch(/GRANT\s+(?:ALL|UPDATE|DELETE|TRUNCATE).*ON\s+(?:TABLE\s+)?public\.people/i);
    expect(migration).toContain('REVOKE ALL ON TABLE public.people, public.projects FROM anon');
  });
});

describe('People inline creation', () => {
  it('detects normalized name and email duplicates and offers the existing Person', () => {
    const people = [
      { id: 'p1', fullName: 'José da Silva', email: 'JOSE@EXEMPLO.COM' },
      { id: 'p2', fullName: 'Maria Souza', email: null },
    ];
    expect(likelyDuplicatePeople(people, { fullName: '  jose  da silva ' })).toEqual([people[0]]);
    expect(likelyDuplicatePeople(people, { fullName: 'Outro Nome', email: 'jose@exemplo.com' })).toEqual([people[0]]);
    expect(wizard).toContain('Usar pessoa existente');
  });

  it('uses the canonical People service and explicitly creates no login profile', () => {
    expect(wizard).toContain('createPerson({');
    expect(wizard).toContain('profileId: null');
    expect(wizard).toContain('ownerPersonId');
    const service = source('src/lib/services/people.ts');
    const createBody = service.slice(service.indexOf('export async function createPerson'), service.indexOf('export async function updatePerson'));
    expect(createBody).toContain(".from(PEOPLE_TABLE)\n    .insert(row)");
    expect(createBody).not.toMatch(/signUp|auth\.admin|organization_memberships|user_roles|credentials/i);
  });

  it('shows permission-safe UX instead of bypassing People authorization', () => {
    expect(wizard).toContain("hasPermission('people.manage')");
    expect(wizard).toContain('Você não tem permissão para cadastrar uma nova pessoa.');
    expect(source('src/lib/services/people.ts')).toContain("source: 'manual'");
  });
});

describe('Project inline creation', () => {
  it('suggests an editable operational name from scope/site context', () => {
    expect(suggestOperationalProjectName({
      title: 'CONTRATO DE PRESTAÇÃO DE SERVIÇOS',
      scopeSummary: 'Reforma da UG5 na UHE Cachoeira Dourada.',
    })).toBe('Reforma da UG5 — UHE Cachoeira Dourada');
    expect(wizard).toContain('O nome abaixo é uma sugestão editável');
  });

  it('warns on likely duplicates but permits an explicit distinct creation', () => {
    const projects = [{ id: 'x', name: 'Reforma UG5', code: 'JA-10', counterparty: 'Enel', scopeSummary: 'Reforma turbina UG5' }];
    expect(likelyDuplicateProjects(projects, { name: ' reforma ug5 ', contractNumber: 'outro' })).toEqual(projects);
    expect(wizard).toContain('Encontramos um projeto parecido.');
    expect(wizard).toContain('Vincular projeto existente');
    expect(wizard).toContain('Criar novo mesmo assim');
  });

  it('persists a relational Person independently and fabricates no execution facts', () => {
    const service = source('src/lib/services/projects.ts');
    const body = service.slice(service.indexOf('export async function createOnboardingProject'), service.indexOf('// ─── Legacy CRUD'));
    expect(body).toContain('responsible_person_id: input.responsiblePersonId ?? null');
    expect(body).not.toMatch(/data_inicio|data_fim|progresso_percentual|valor_total|valor_executado|measurement|team|budget/i);
    expect(wizard).toContain('Não é herdada do responsável pelo contrato.');
    expect(wizard).not.toContain("responsiblePersonId: form.ownerPersonId");
  });

  it('uses existing Projects permission and keeps project optional', () => {
    expect(wizard).toContain("hasPermission('projects.create')");
    expect(wizard).toContain('Você não tem permissão para criar projetos.');
    expect(wizard).toContain('Sem projeto vinculado');
    expect(wizard).not.toContain("if (!form.projectId) out.push");
  });
});

describe('PT-BR presentation without canonical mutation', () => {
  it('localizes status, risk, money and ISO dates', () => {
    expect(contractStatusLabel('signed')).toBe('Assinado');
    expect(contractRiskLabel('medium')).toBe('Médio');
    expect(formatContractMoney(8032339.76)).toBe('R$ 8.032.339,76');
    expect(formatContractDate('2025-11-03')).toBe('03/11/2025');
    expect(formatContractDate('2026-11-02')).toBe('02/11/2026');
  });

  it('formats only the presentation value and leaves canonical inputs unchanged', () => {
    const status = 'signed';
    const risk = 'medium';
    const amount = 8032339.76;
    const date = '2025-11-03';
    expect(formatDocumentaryField('documentary_state', status)).toBe('Assinado');
    expect(formatDocumentaryField('risk', risk)).toBe('Médio');
    expect(formatDocumentaryField('total_value', amount)).toBe('R$ 8.032.339,76');
    expect(formatDocumentaryField('start_date', date)).toBe('03/11/2025');
    expect({ status, risk, amount, date }).toEqual({ status: 'signed', risk: 'medium', amount: 8032339.76, date: '2025-11-03' });
  });
});

describe('document-first review and human governance', () => {
  it('restores preserved filename and completed reading from existing intake state', () => {
    expect(wizard).toContain("file?.name || intake?.file_name");
    expect(wizard).toContain('Documento original recebido e preservado. Não é necessário enviar novamente.');
    expect(wizard).toContain('Concluída — ${intake.structured_result.identifiedCount} informações identificadas');
    expect(wizard).not.toContain("label: 'Documento', value: file ? file.name : ''");
  });

  it('does not auto-confirm ambiguous counterparty or low-confidence risk', () => {
    expect(wizard).toContain('Confirmar contraparte');
    expect(wizard).toContain('A recomendação não preenche o campo. A decisão é humana.');
    expect(wizard).toContain('<option value="">Selecione</option>');
    expect(wizard).not.toContain("setField('riskLevel', String(riskAttention.value");
  });

  it('has direct actions for responsible and project decisions', () => {
    for (const label of ['Selecionar responsável', 'Cadastrar nova pessoa', 'Selecionar projeto', 'Criar novo projeto']) {
      expect(wizard).toContain(label);
    }
    expect(wizard).toContain('Responsável pelo contrato');
    expect(wizard).toContain('Responsável pelo projeto');
  });

  it('does not fabricate review/approval authority or trigger extraction during resume', () => {
    const finalValues = source('src/lib/contracts/onboarding/finalize-values.ts');
    for (const fake of ['reviewed_by', 'approved_by', 'verified_by', 'assigned_by']) expect(finalValues).not.toContain(fake);
    const resumePage = source('src/app/(main)/contratos/onboarding/[intakeId]/page.tsx');
    expect(resumePage).not.toContain('retryContractIntake');
    expect(resumePage).not.toContain('sendContractDocument');
  });
});
