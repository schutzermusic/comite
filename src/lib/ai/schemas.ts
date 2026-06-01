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

/**
 * Structured-output schema for the payroll closing narrative. The model returns
 * ONLY narrative text fields — every monetary number is supplied by the parser
 * and must never be invented. Causes not present in the data must be phrased as
 * validation points, not asserted as fact.
 */
export const PAYROLL_NARRATIVE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    executive_summary: { type: 'string' },
    closing_email: { type: 'string' },
    board_summary: { type: 'string' },
    finance_email: { type: 'string' },
    hr_validation: { type: 'string' },
    top_increases: { type: 'array', maxItems: 8, items: { type: 'string' } },
    top_decreases: { type: 'array', maxItems: 8, items: { type: 'string' } },
    cost_center_highlights: { type: 'array', maxItems: 8, items: { type: 'string' } },
    anomalies: { type: 'array', maxItems: 8, items: { type: 'string' } },
    attention_points: { type: 'array', maxItems: 8, items: { type: 'string' } },
    recommendations: { type: 'array', maxItems: 8, items: { type: 'string' } },
    conclusion: { type: 'string' },
  },
  required: [
    'executive_summary',
    'closing_email',
    'board_summary',
    'finance_email',
    'hr_validation',
    'top_increases',
    'top_decreases',
    'cost_center_highlights',
    'anomalies',
    'attention_points',
    'recommendations',
    'conclusion',
  ],
} as const;
