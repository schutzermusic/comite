import type { FiscalServiceCatalogEntry, FiscalTaxLine, FiscalTaxCode } from './types';

export interface TaxPreviewInput {
  amountCents: number;
  deductionsCents?: number;
  unconditionalDiscountCents?: number;
  issWithheld?: boolean;
  service: Pick<FiscalServiceCatalogEntry,
    'iss_rate' | 'pis_rate' | 'cofins_rate' | 'inss_rate' | 'ir_rate' | 'csll_rate' |
    'ibs_rate' | 'cbs_rate' | 'iss_withheld_default'>;
}

export interface TaxPreviewResult {
  taxBaseCents: number;
  withheldTotalCents: number;
  issuerTaxTotalCents: number;
  netAmountCents: number;
  lines: FiscalTaxLine[];
}

const amountForRate = (baseCents: number, rate: number) => Math.round((baseCents * rate) / 100);

export function calculateTaxPreview(input: TaxPreviewInput): TaxPreviewResult {
  const deductions = input.deductionsCents ?? 0;
  const discount = input.unconditionalDiscountCents ?? 0;
  const taxBaseCents = Math.max(0, input.amountCents - deductions - discount);
  const issWithheld = input.issWithheld ?? input.service.iss_withheld_default;

  const definitions: Array<{ code: FiscalTaxCode; rate: number; withheld: boolean }> = [
    { code: 'ISS', rate: input.service.iss_rate, withheld: issWithheld },
    { code: 'PIS', rate: input.service.pis_rate, withheld: input.service.pis_rate > 0 },
    { code: 'COFINS', rate: input.service.cofins_rate, withheld: input.service.cofins_rate > 0 },
    { code: 'INSS', rate: input.service.inss_rate, withheld: input.service.inss_rate > 0 },
    { code: 'IRRF', rate: input.service.ir_rate, withheld: input.service.ir_rate > 0 },
    { code: 'CSLL', rate: input.service.csll_rate, withheld: input.service.csll_rate > 0 },
    { code: 'IBS', rate: input.service.ibs_rate, withheld: false },
    { code: 'CBS', rate: input.service.cbs_rate, withheld: false },
  ];

  const lines = definitions
    .filter(({ rate }) => rate > 0)
    .map(({ code, rate, withheld }): FiscalTaxLine => ({
      tax_code: code,
      tax_base_cents: taxBaseCents,
      rate,
      amount_cents: amountForRate(taxBaseCents, rate),
      responsibility: withheld ? 'recipient' : 'issuer',
      withheld,
    }));

  const withheldTotalCents = lines.filter((line) => line.withheld).reduce((sum, line) => sum + line.amount_cents, 0);
  const issuerTaxTotalCents = lines.filter((line) => line.responsibility === 'issuer').reduce((sum, line) => sum + line.amount_cents, 0);
  const netAmountCents = Math.max(0, taxBaseCents - withheldTotalCents);

  return { taxBaseCents, withheldTotalCents, issuerTaxTotalCents, netAmountCents, lines };
}

