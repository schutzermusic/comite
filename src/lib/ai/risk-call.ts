if (typeof window !== 'undefined') {
  throw new Error('src/lib/ai/risk-call.ts must not be imported in the browser');
}

import { getApexAIGateway, type ApexAIProvenance, type ApexAITask } from './gateway';
import { RISK_FINDING_SCHEMA } from './schemas';
import {
  type AiRiskCategory,
  type AiRiskFinding,
  type AiRiskSeverity,
  clampFloat,
  clampInt,
  computeSeverity,
} from './types';

export interface RiskCallOptions {
  organizationId: string;
  task: Extract<ApexAITask, 'CONTRACT_RISK_ANALYSIS' | 'FINANCE_RISK_ANALYSIS' | 'PROJECT_RISK_ANALYSIS'>;
  systemPrompt: string;
  userPrompt: string;
}

export async function callForRiskFindings(
  opts: RiskCallOptions,
): Promise<{ findings: AiRiskFinding[]; provenance: ApexAIProvenance }> {
  const response = await getApexAIGateway().generate<{
    findings?: Array<Partial<AiRiskFinding> & { sourceEntityId?: string | null }>;
  }>({
    organizationId: opts.organizationId,
    task: opts.task,
    systemPrompt: opts.systemPrompt,
    userPrompt: opts.userPrompt,
    structuredOutput: { name: 'risk_findings', schema: RISK_FINDING_SCHEMA },
  });

  const findings = Array.isArray(response.output.findings) ? response.output.findings : [];
  return {
    provenance: response.provenance,
    findings: findings.map((finding) => {
      const probability = clampInt(finding.probability, 1, 5, 3);
      const impact = clampInt(finding.impact, 1, 5, 3);
      const declared = finding.severity as AiRiskSeverity | undefined;
      return {
        title: String(finding.title ?? '').slice(0, 200) || 'Risco identificado',
        description: String(finding.description ?? ''),
        category: (finding.category ?? 'Operational') as AiRiskCategory,
        sourceEntityId: finding.sourceEntityId ?? null,
        probability,
        impact,
        severity: declared ?? computeSeverity(probability * impact),
        rationale: String(finding.rationale ?? ''),
        confidence: clampFloat(finding.confidence, 0, 1, 0.5),
        mitigation: String(finding.mitigation ?? ''),
      } satisfies AiRiskFinding;
    }),
  };
}
