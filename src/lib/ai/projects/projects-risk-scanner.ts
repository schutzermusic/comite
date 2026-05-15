/**
 * Projects AI Risk Scanner — Phase 1 of the Finance AI Copilot plan.
 *
 * Scans a single project at a time. The `projects` table stores most of the
 * project's structured data inside JSONB columns (`project`, `project_v2`),
 * so we forward the complete payload to Claude with a project-domain system
 * prompt focused on margin, schedule and execution risk.
 *
 * If milestones live inside `project_v2` (or referenced data structures),
 * they ride along as supporting evidence — but the scanner is project-level
 * by design, not milestone-by-milestone.
 */
if (typeof window !== 'undefined') {
  throw new Error('src/lib/ai/projects/projects-risk-scanner.ts must not be imported in the browser');
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { callAnthropicForRiskFindings } from '../anthropic-call';
import { persistAiRiskFindings, type PersistFindingsResult } from '../risk-persistence';
import { getServiceClient } from '../server-clients';
import type { AiRiskFinding } from '../types';

const PROJECTS_SYSTEM_PROMPT = `Você é um analista sênior de riscos de projetos para uma plataforma de governança corporativa.
Recebe os dados estruturados de um único projeto e deve identificar riscos materiais nas dimensões abaixo.

DIMENSÕES DE RISCO:
- Margem / financeiro: risco de derrapagem orçamentária, custos mobilizados acima do previsto, receita ainda não faturada,
  margem prevista vs. realizada divergente.
- Cronograma: marcos atrasados, dependências travadas, datas inconsistentes, slip esperado.
- Operational: capacidade de equipe, alocação incompleta, riscos contratuais herdados.
- Compliance / Contratual: ausência de contrato vinculado, cláusulas pendentes, obrigações em aberto.
- Schedule: marcos críticos vencidos, encadeamento frágil de fases.

Use milestones (se presentes) como **evidência de apoio**, mas mantenha a avaliação no nível do projeto inteiro.

CATEGORIAS DE RISCO (use uma):
- Financial, Schedule, Operational, Contractual, Compliance, Legal.

ESCALAS (inteiras 1 a 5):
- probability: 1 (muito improvável) ... 5 (quase certo).
- impact: 1 (negligível) ... 5 (severo / material).

SEVERIDADE: low 1–6 / medium 7–11 / high 12–15 / critical 16–25.

REGRAS:
- Entre 0 e 8 riscos. Qualidade > quantidade. Se o projeto está saudável, retorne lista vazia.
- Cada risco deve apontar evidência específica (campo, valor, data, marco) extraída do JSON.
- "sourceEntityId" pode permanecer nulo (estamos no nível do projeto; o id do projeto é o âncora padrão).
- "rationale" cita a evidência. "mitigation" deve ser ação executável.
- Retorne exclusivamente o JSON solicitado.`;

interface ProjectContext {
  orgId: string;
  projectId: string;
  projectName: string;
  promptText: string;
}

async function loadProjectContext(
  supabase: SupabaseClient,
  projectId: string,
): Promise<ProjectContext> {
  const { data, error } = await supabase
    .from('projects')
    .select('id,organization_id,project,project_v2,updated_at,created_at')
    .eq('id', projectId)
    .maybeSingle();
  if (error) throw new Error(`Erro ao carregar projeto: ${error.message}`);
  if (!data) throw new Error(`Projeto ${projectId} não encontrado`);

  const orgId: string | null = data.organization_id;
  if (!orgId) {
    throw new Error('Projeto sem organization_id — execute a migração 008 antes de rodar a análise IA.');
  }

  const projectJson = data.project ?? {};
  const projectV2 = data.project_v2 ?? null;
  const name =
    (typeof projectJson === 'object' && projectJson !== null && 'nome' in projectJson
      ? String((projectJson as Record<string, unknown>).nome ?? '')
      : '') || projectId;

  const lines: string[] = [];
  lines.push(`=== PROJETO id=${projectId} ===`);
  lines.push(`atualizado_em: ${data.updated_at}`);
  lines.push('', '=== DADOS BASE (project) ===');
  lines.push(JSON.stringify(projectJson, null, 2).slice(0, 8000));
  if (projectV2) {
    lines.push('', '=== DADOS ESTENDIDOS (project_v2) ===');
    lines.push(JSON.stringify(projectV2, null, 2).slice(0, 8000));
  }

  return {
    orgId,
    projectId,
    projectName: name,
    promptText: lines.join('\n'),
  };
}

export interface ProjectScanResult {
  findings: AiRiskFinding[];
  persistence: PersistFindingsResult;
}

export async function scanProjectForRisks(
  projectId: string,
  userId: string,
): Promise<ProjectScanResult> {
  if (!projectId) throw new Error('projectId é obrigatório');
  if (!userId) throw new Error('userId é obrigatório');

  const supabase = getServiceClient();
  const ctx = await loadProjectContext(supabase, projectId);

  const findings = await callAnthropicForRiskFindings({
    systemPrompt: PROJECTS_SYSTEM_PROMPT,
    userPrompt:
      'Analise o projeto abaixo e identifique riscos materiais conforme as regras do sistema.\n\n' +
      ctx.promptText,
  });

  const persistence = await persistAiRiskFindings(findings, {
    supabase,
    orgId: ctx.orgId,
    userId,
    sourceModule: 'projects',
    defaultEntityId: projectId,
    referenceName: ctx.projectName,
    area: 'Projetos',
  });

  console.info(
    `[ai/projects-risk-scanner] project=${projectId} findings=${findings.length} inserted=${persistence.inserted.length} dup=${persistence.skippedDuplicates}`,
  );

  return { findings, persistence };
}
