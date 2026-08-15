import { z } from 'zod';

const digits = (value: string) => value.replace(/\D/g, '');

export function isValidCnpj(value: string): boolean {
  const cnpj = digits(value);
  if (cnpj.length !== 14 || /^(\d)\1+$/.test(cnpj)) return false;
  const calculate = (length: number) => {
    let sum = 0;
    let weight = length - 7;
    for (let i = 0; i < length; i += 1) {
      sum += Number(cnpj[i]) * weight--;
      if (weight < 2) weight = 9;
    }
    const result = 11 - (sum % 11);
    return result >= 10 ? 0 : result;
  };
  return calculate(12) === Number(cnpj[12]) && calculate(13) === Number(cnpj[13]);
}

const optionalUuid = z.string().uuid().optional();

export const createFiscalDocumentSchema = z.object({
  establishmentId: z.string().uuid(),
  partyId: z.string().uuid(),
  serviceCatalogId: z.string().uuid(),
  competenceDate: z.iso.date(),
  dueDate: z.iso.date().optional(),
  serviceLocationIbge: z.string().regex(/^\d{7}$/, 'Código IBGE deve ter 7 dígitos.'),
  description: z.string().trim().min(5).max(2000),
  amountCents: z.number().int().positive(),
  quantity: z.number().positive().max(1_000_000).default(1),
  deductionsCents: z.number().int().min(0).default(0),
  unconditionalDiscountCents: z.number().int().min(0).default(0),
  conditionalDiscountCents: z.number().int().min(0).default(0),
  issWithheld: z.boolean().optional(),
  projectId: optionalUuid,
  contractId: optionalUuid,
  businessUnitId: optionalUuid,
  costCenterId: optionalUuid,
  revenueCategoryId: optionalUuid,
  additionalInformation: z.string().trim().max(2000).optional(),
  idempotencyKey: z.string().trim().min(8).max(120),
}).superRefine((value, ctx) => {
  const reductions = value.deductionsCents + value.unconditionalDiscountCents;
  if (reductions >= value.amountCents) {
    ctx.addIssue({ code: 'custom', path: ['deductionsCents'], message: 'Deduções e desconto devem ser menores que o serviço.' });
  }
  if (value.dueDate && value.dueDate < value.competenceDate) {
    ctx.addIssue({ code: 'custom', path: ['dueDate'], message: 'Vencimento não pode ser anterior à competência.' });
  }
});

export const fiscalDocumentActionSchema = z.object({
  reason: z.string().trim().min(3).max(500).optional(),
  idempotencyKey: z.string().trim().min(8).max(120),
});

export const fiscalEstablishmentSchema = z.object({
  legalName: z.string().trim().min(3).max(300),
  tradeName: z.string().trim().max(300).optional(),
  cnpj: z.string().transform(digits).refine(isValidCnpj, 'CNPJ inválido.'),
  municipalRegistration: z.string().trim().min(1).max(50),
  stateRegistration: z.string().trim().max(50).optional(),
  taxRegime: z.enum(['mei','simples_nacional','lucro_presumido','lucro_real','other']),
  specialTaxRegime: z.string().trim().max(100).optional(),
  municipalityIbge: z.string().regex(/^\d{7}$/),
  municipalityName: z.string().trim().min(2).max(150),
  uf: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/),
  postalCode: z.string().transform(digits).refine((v) => v.length === 8, 'CEP inválido.'),
  street: z.string().trim().min(2).max(200),
  streetNumber: z.string().trim().min(1).max(30),
  complement: z.string().trim().max(100).optional(),
  district: z.string().trim().min(2).max(100),
  environment: z.enum(['homologation','production']).default('homologation'),
  nfseSeries: z.string().trim().min(1).max(20).default('1'),
});

export const fiscalPartySchema = z.object({
  legalName: z.string().trim().min(3).max(300),
  tradeName: z.string().trim().max(300).optional(),
  documentType: z.enum(['cpf','cnpj','foreign']),
  documentNumber: z.string().trim().min(3).max(30),
  municipalRegistration: z.string().trim().max(50).optional(),
  stateRegistration: z.string().trim().max(50).optional(),
  email: z.email().optional().or(z.literal('')),
  phone: z.string().trim().max(30).optional(),
  municipalityIbge: z.string().regex(/^\d{7}$/).optional(),
  municipalityName: z.string().trim().max(150).optional(),
  uf: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).optional(),
  countryCode: z.string().trim().toUpperCase().length(2).default('BR'),
  postalCode: z.string().trim().max(20).optional(),
  street: z.string().trim().max(200).optional(),
  streetNumber: z.string().trim().max(30).optional(),
  complement: z.string().trim().max(100).optional(),
  district: z.string().trim().max(100).optional(),
  clientId: optionalUuid,
});

export const fiscalServiceSchema = z.object({
  establishmentId: z.string().uuid(),
  code: z.string().trim().min(1).max(50),
  description: z.string().trim().min(3).max(500),
  lc116Code: z.string().trim().min(1).max(20),
  nbsCode: z.string().trim().max(20).optional(),
  municipalServiceCode: z.string().trim().min(1).max(50),
  cnaeCode: z.string().trim().max(20).optional(),
  issRate: z.number().min(0).max(100),
  pisRate: z.number().min(0).max(100).default(0),
  cofinsRate: z.number().min(0).max(100).default(0),
  inssRate: z.number().min(0).max(100).default(0),
  irRate: z.number().min(0).max(100).default(0),
  csllRate: z.number().min(0).max(100).default(0),
  ibsRate: z.number().min(0).max(100).default(0),
  cbsRate: z.number().min(0).max(100).default(0),
  issWithheldDefault: z.boolean().default(false),
  effectiveFrom: z.iso.date(),
  effectiveTo: z.iso.date().optional(),
  version: z.number().int().positive().default(1),
  approvedByAccountant: z.boolean().default(false),
});

export type CreateFiscalDocumentPayload = z.infer<typeof createFiscalDocumentSchema>;

