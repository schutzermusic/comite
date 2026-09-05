import type { ContractFact } from './resolve-contract-as-of';

export type ContractFactRow = ContractFact & { title: string; source_page: number | null };
export type ContractGuaranteeRow = ContractFactRow & {
  guarantee_type: string | null; required_amount: number | string | null;
  required_percentage: number | string | null; percentage_basis: string | null; currency: string | null;
  issuer_party_id: string | null; beneficiary_party_id: string | null;
  validity_start: string | null; validity_end: string | null; renewal_required: boolean | null;
  evidence_document_id: string | null;
};
/** A recorded requirement never asserts policy verification or compliance. */
export type ContractInsuranceRequirementRow = ContractFactRow & {
  insurance_type: string | null; required_coverage: number | string | null; currency: string | null;
  insured_party_id: string | null; insurer_party_id: string | null;
  policy_required: boolean | null; validity_requirement: string | null;
};
export type ContractIndexationRuleRow = ContractFactRow & {
  indexer: string | null; base_date: string | null; periodicity_months: number | null;
  anniversary_rule: string | null; formula: string | null; lag_months: number | null;
  floor_percentage: number | string | null; cap_percentage: number | string | null;
};
export type ContractBillingConditionRow = ContractFactRow & {
  condition_type: 'milestone_reached' | 'measurement_accepted' | 'service_report_required' |
    'evidence_required' | 'technical_acceptance_required' | 'customer_approval_required' |
    'specific_document_required' | 'elapsed_contractual_period' | 'contractual_event' | null;
  requirement_text: string | null; milestone_id: string | null; responsible_party_id: string | null;
  required_document_type: string | null; elapsed_period_days: number | null;
};
export type ContractMeasurementRequirementRow = ContractFactRow & {
  report_required: boolean | null; report_type: string | null; required_document_type: string | null;
  technical_report_required: boolean | null; tests_inspection_required: boolean | null;
  evidence_required: boolean | null; customer_acceptance_required: boolean | null;
  responsible_party_id: string | null; annex_reference: string | null; applicability: string | null;
  billing_condition_id: string | null; milestone_id: string | null;
};
export type ContractStructuredTableRows = {
  contract_guarantees: ContractGuaranteeRow;
  contract_insurance_requirements: ContractInsuranceRequirementRow;
  contract_indexation_rules: ContractIndexationRuleRow;
  contract_billing_conditions: ContractBillingConditionRow;
  contract_measurement_requirements: ContractMeasurementRequirementRow;
};
