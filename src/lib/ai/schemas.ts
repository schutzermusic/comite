/**
 * Shared JSON schema for Anthropic structured output across AI risk scanners
 * (contracts, finance, projects). `sourceEntityId` is optional so that scanners
 * which analyze a single entity can leave it blank, while batch scanners
 * (finance) can anchor each finding to a specific ledger_entry id.
 */
export const RISK_FINDING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    findings: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          category: {
            type: 'string',
            enum: ['Operational', 'Financial', 'Legal', 'Contractual', 'Compliance', 'Schedule'],
          },
          sourceEntityId: { type: ['string', 'null'] },
          probability: { type: 'integer', enum: [1, 2, 3, 4, 5] },
          impact: { type: 'integer', enum: [1, 2, 3, 4, 5] },
          severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
          rationale: { type: 'string' },
          confidence: { type: 'number' },
          mitigation: { type: 'string' },
        },
        required: [
          'title',
          'description',
          'category',
          'probability',
          'impact',
          'severity',
          'rationale',
          'confidence',
          'mitigation',
        ],
      },
    },
  },
  required: ['findings'],
} as const;
