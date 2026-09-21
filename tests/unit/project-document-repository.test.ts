/**
 * O ACERVO DOCUMENTAL DO PROJETO — um arquivo, um registro, três procedências.
 *
 * O que estes testes protegem:
 *
 *   · documento contratual é REFERÊNCIA e nunca ganha caminho de objeto em
 *     Projetos — é assim que "referenciar" se distingue de "copiar";
 *   · evidência de medição é a MESMA linha de `project_files`, classificada
 *     pelo vínculo de marco, e não uma segunda cópia;
 *   · a lista de classes documentais do TypeScript continua idêntica ao CHECK
 *     da migration 189.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import {
  groupByShelf, shelfOf, toProjectDocument, typeLabel, ORIGIN_LABEL,
  type ProjectDocument,
} from '@/lib/projects/documents/project-documents';
import {
  EVIDENCE_CATEGORIES, MEASUREMENT_EVIDENCE_DOCUMENT_TYPE,
} from '@/lib/projects/measurements/evidence-categories';

function doc(over: Partial<ProjectDocument> = {}): ProjectDocument {
  return {
    documentId: 'doc-1', organizationId: 'org', projectId: 'proj-1',
    origin: 'PROJECT', title: 'Relatório de montagem.pdf',
    documentType: null, evidenceCategory: null, category: 'document',
    bucketId: 'project-documents', objectPath: 'org/proj-1/1-document-x.pdf',
    publicUrl: null, contentType: 'application/pdf', fileSize: 120_000,
    contractId: null, contractMilestoneId: null, measurementId: null,
    timelineItemId: null, uploadedBy: 'user-1',
    uploadedAt: '2025-11-20T12:00:00Z', contractDocumentStatus: null,
    ...over,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// PROCEDÊNCIA
// ───────────────────────────────────────────────────────────────────────────

describe('a procedência é dita, e cada uma tem um dono', () => {
  it('as três procedências têm texto próprio', () => {
    expect(ORIGIN_LABEL.PROJECT).toBe('Origem: Projeto');
    expect(ORIGIN_LABEL.MEASUREMENT_EVIDENCE).toBe('Origem: Evidência de medição');
    expect(ORIGIN_LABEL.CONTRACT).toBe('Origem: Contrato');
  });

  it('documento contratual não carrega caminho de objeto — é referência', () => {
    const contractual = toProjectDocument({
      document_id: 'cd-1', organization_id: 'org', project_id: 'proj-1',
      origin: 'CONTRACT', title: 'Contrato JA10182283/2025.pdf',
      document_type: 'contract', evidence_category: null, category: null,
      bucket_id: null, object_path: null, public_url: null,
      content_type: null, file_size: null, contract_id: 'c1',
      contract_milestone_id: null, measurement_id: null, timeline_item_id: null,
      uploaded_by: null, uploaded_at: '2025-01-10T00:00:00Z',
      contract_document_status: 'uploaded',
    });
    expect(contractual.objectPath).toBeNull();
    expect(contractual.bucketId).toBeNull();
    expect(contractual.contractId).toBe('c1');
  });

  it('a visão não devolve caminho de objeto para documento contratual', () => {
    const sql = fs.readFileSync(
      'supabase/migrations/189_project_document_canonical_identity.sql', 'utf8',
    );
    const contractArm = sql.slice(sql.indexOf("'CONTRACT'"));
    expect(contractArm).toContain('NULL::text                                  AS object_path');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// AS GAVETAS
// ───────────────────────────────────────────────────────────────────────────

describe('a arrumação segue a classe, e a procedência manda primeiro', () => {
  it.each([
    ['relatorio_tecnico', 'TECHNICAL_REPORTS'],
    ['relatorio_ensaio', 'TESTS'],
    ['relatorio_inspecao', 'TESTS'],
    ['relatorio_fotografico', 'FIELD_PHOTOS'],
    ['databook', 'DATABOOK'],
    ['desenho', 'DRAWINGS'],
    ['procedimento', 'PROCEDURES'],
    ['relatorio_medicao', 'MEASUREMENT_EVIDENCE'],
  ] as const)('%s vai para %s', (category, shelf) => {
    expect(shelfOf(doc({ origin: 'MEASUREMENT_EVIDENCE', evidenceCategory: category })))
      .toBe(shelf);
  });

  it('documento contratual vai para a prateleira de referência, custe o que custar', () => {
    // Mesmo carregando uma classe que iria para "Relatórios técnicos".
    expect(shelfOf(doc({ origin: 'CONTRACT', evidenceCategory: 'relatorio_tecnico' })))
      .toBe('CONTRACTUAL');
  });

  it('PDF de cronograma importado continua achável, na gaveta dele', () => {
    expect(shelfOf(doc({ category: 'cronograma' }))).toBe('SCHEDULE');
  });

  it('documento de projeto sem classe não vira evidência de medição', () => {
    expect(shelfOf(doc())).toBe('EXECUTION');
  });

  it('não devolve gaveta vazia', () => {
    const groups = groupByShelf([doc(), doc({ origin: 'CONTRACT', documentId: 'cd-1' })]);
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.documents.length > 0)).toBe(true);
  });
});

describe('o rótulo do tipo não inventa classificação', () => {
  it('usa a classe documental quando ela existe', () => {
    expect(typeLabel(doc({ evidenceCategory: 'relatorio_ensaio' }))).toBe('Relatório de ensaio');
  });

  it('documento sem tipo é "Documento", e não um palpite', () => {
    expect(typeLabel(doc())).toBe('Documento');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// UM ARQUIVO, UM REGISTRO
// ───────────────────────────────────────────────────────────────────────────

describe('não existe segundo repositório nem segunda cópia', () => {
  const sql = fs.readFileSync(
    'supabase/migrations/189_project_document_canonical_identity.sql', 'utf8',
  );

  it('a migration não cria tabela de documento nova', () => {
    expect(sql).not.toMatch(/CREATE TABLE[^;]*project_documents/i);
    expect(sql).not.toMatch(/CREATE TABLE[^;]*measurement_documents/i);
  });

  it('a migration não copia linha de contract_documents para project_files', () => {
    expect(sql).not.toMatch(/INSERT INTO public\.project_files/i);
  });

  it('a evidência reutiliza `project_files` — a tabela que já existia', () => {
    expect(sql).toContain('ALTER TABLE public.project_files');
    expect(sql).toContain('contract_milestone_id');
  });

  it('o vínculo não atravessa o inquilino', () => {
    const policy = sql.slice(sql.indexOf('CREATE POLICY project_files_insert'));
    expect(policy).toContain('current_user_organization_id()');
    // Contrato, marco e medição apontados precisam ser da mesma organização.
    expect(policy.match(/current_user_organization_id\(\)/g)!.length).toBeGreaterThanOrEqual(5);
  });

  it('o acervo é lido por uma visão security_invoker — a RLS não é afrouxada', () => {
    expect(sql).toContain('CREATE OR REPLACE VIEW public.project_document_read_model');
    expect(sql).toContain('WITH (security_invoker = true)');
    expect(sql).toContain('REVOKE ALL ON public.project_document_read_model FROM anon');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// O VOCABULÁRIO, dos dois lados
// ───────────────────────────────────────────────────────────────────────────

describe('a lista de classes documentais é a mesma no TypeScript e no banco', () => {
  const sql = fs.readFileSync(
    'supabase/migrations/189_project_document_canonical_identity.sql', 'utf8',
  );

  it('toda classe do TypeScript existe no CHECK da 189', () => {
    const check = sql.slice(sql.indexOf('project_files_evidence_category_check'));
    for (const category of EVIDENCE_CATEGORIES) {
      expect(check).toContain(`'${category}'`);
    }
  });

  it('o tipo documental da evidência é um só', () => {
    expect(MEASUREMENT_EVIDENCE_DOCUMENT_TYPE).toBe('measurement_evidence');
    expect(sql).toContain("f.document_type = 'measurement_evidence'");
  });
});
