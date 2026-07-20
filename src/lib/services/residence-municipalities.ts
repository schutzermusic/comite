import { createClient } from '@/utils/supabase/client';
import { logAuditEvent } from '@/lib/audit/log-audit-event';
import type {
  PersonResidenceMunicipality,
  ResidenceMunicipalitySource,
  ResidenceMunicipalityStatus,
} from '@/lib/types/people';
import { getCurrentOrgAndUser, rlsFriendlyMessage } from './people';

export const RESIDENCE_MUNICIPALITIES_TABLE = 'person_residence_municipalities';

type ResidenceRow = {
  id: string;
  organization_id: string;
  person_id: string;
  municipality_code: string;
  municipality_name: string;
  state_code: string;
  valid_from: string;
  valid_until: string | null;
  source: ResidenceMunicipalitySource;
  status: ResidenceMunicipalityStatus;
  validation_metadata: Record<string, unknown> | null;
  verified_by: string | null;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
};

function mapResidence(row: ResidenceRow): PersonResidenceMunicipality {
  return {
    id: row.id,
    organizationId: row.organization_id,
    personId: row.person_id,
    municipalityCode: row.municipality_code,
    municipalityName: row.municipality_name,
    stateCode: row.state_code,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    source: row.source,
    status: row.status,
    validationMetadata: row.validation_metadata ?? {},
    verifiedBy: row.verified_by,
    verifiedAt: row.verified_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listResidenceMunicipalities(personId?: string): Promise<PersonResidenceMunicipality[]> {
  const supabase = createClient();
  let query = supabase.from(RESIDENCE_MUNICIPALITIES_TABLE).select('*').order('valid_from', { ascending: false });
  if (personId) query = query.eq('person_id', personId);
  const { data, error } = await query;
  if (error) throw new Error(rlsFriendlyMessage('Erro ao carregar municípios residenciais', error));
  return (data ?? []).map((row) => mapResidence(row as ResidenceRow));
}

export interface ResidenceMunicipalityInput {
  personId: string;
  municipalityCode: string;
  municipalityName: string;
  stateCode: string;
  validFrom: string;
  validUntil?: string | null;
  source: ResidenceMunicipalitySource;
  status?: ResidenceMunicipalityStatus;
  validationMetadata?: Record<string, unknown>;
}

export async function createResidenceMunicipality(
  input: ResidenceMunicipalityInput,
): Promise<PersonResidenceMunicipality> {
  const supabase = createClient();
  const { orgId, userId } = await getCurrentOrgAndUser(supabase);
  const validated = (input.status ?? 'validated') === 'validated';
  const { data, error } = await supabase.from(RESIDENCE_MUNICIPALITIES_TABLE).insert({
    organization_id: orgId,
    person_id: input.personId,
    municipality_code: input.municipalityCode.trim(),
    municipality_name: input.municipalityName.trim(),
    state_code: input.stateCode.trim().toUpperCase(),
    valid_from: input.validFrom,
    valid_until: input.validUntil ?? null,
    source: input.source,
    status: input.status ?? 'validated',
    validation_metadata: input.validationMetadata ?? {},
    verified_by: validated ? userId : null,
    verified_at: validated ? new Date().toISOString() : null,
    created_by: userId,
  }).select('*').single();
  if (error) throw new Error(rlsFriendlyMessage('Erro ao salvar município residencial', error));
  const residence = mapResidence(data as ResidenceRow);
  await logAuditEvent({
    organizationId: orgId,
    action: 'allowance_residence_municipality.created',
    entityType: 'person_residence_municipality',
    entityId: residence.id,
    metadata: {
      person_id: input.personId,
      municipality_code: residence.municipalityCode,
      status: residence.status,
      valid_from: residence.validFrom,
      valid_until: residence.validUntil,
    },
  });
  return residence;
}
