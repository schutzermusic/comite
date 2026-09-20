'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { hasOfficialValue } from '@/lib/contracts/trust/trusted';
import type { TrustedContract } from '@/lib/contracts/trust/read-model';
import {
  buildPortfolioApprovalRequirements,
  type PortfolioApprovalRequirements,
} from '@/lib/contracts/trust/approval-requirements';
import {
  listPortfolioBillingApprovalConditions,
  listPortfolioMeasurementAcceptanceRequirements,
  listSharedApprovalRequestsForContracts,
} from '@/lib/contracts/trust/approval-requirements-service';
import { listMilestoneWorkbenchForContracts } from '@/lib/contracts/measurement/milestone-workbench-service';
import type { MilestoneWorkbenchRow } from '@/lib/contracts/measurement/milestone-workbench-types';
import type { ContractApprovalRow } from '@/lib/contracts/contract-service';

const EMPTY: PortfolioApprovalRequirements = {
  requirements: [],
  pendingConfigurationCount: 0,
  awaitingDecisionCount: 0,
  coverage: { contractsWithRequirements: 0, totalContracts: 0 },
};

/**
 * Requisitos de aprovação governados do recorte visível.
 *
 * Relê automaticamente quando o conjunto de contratos muda (operationalização,
 * aceite de interpretação, etc. → refresh da carteira → novo idsKey).
 */
export function usePortfolioApprovalRequirements(
  contracts: readonly TrustedContract[],
  refreshKey: string | number = 0,
) {
  const [requirements, setRequirements] = useState<PortfolioApprovalRequirements>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const idsKey = useMemo(() => contracts.map((c) => c.id).sort().join(','), [contracts]);

  const refresh = useCallback(async () => {
    const ids = idsKey ? idsKey.split(',') : [];
    if (ids.length === 0) {
      setRequirements({ ...EMPTY, coverage: { contractsWithRequirements: 0, totalContracts: 0 } });
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [billingConditions, measurementRequirements, sharedByContract, milestones] =
        await Promise.all([
          listPortfolioBillingApprovalConditions(ids),
          listPortfolioMeasurementAcceptanceRequirements(ids),
          listSharedApprovalRequestsForContracts(ids),
          listMilestoneWorkbenchForContracts(ids),
        ]);

      const milestonesByContract = new Map<string, MilestoneWorkbenchRow[]>();
      for (const row of milestones) {
        const list = milestonesByContract.get(row.contractId) ?? [];
        list.push(row);
        milestonesByContract.set(row.contractId, list);
      }

      const legacyApprovalsByContract = new Map<string, readonly ContractApprovalRow[]>();
      for (const contract of contracts) {
        if (hasOfficialValue(contract.approvals)) {
          legacyApprovalsByContract.set(contract.id, contract.approvals.value);
        }
      }

      setRequirements(buildPortfolioApprovalRequirements({
        contracts: contracts.map((c) => ({ id: c.id, code: c.code, title: c.title })),
        billingConditions,
        measurementRequirements,
        legacyApprovalsByContract,
        sharedRequestsByContract: sharedByContract,
        milestonesByContract,
      }));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar requisitos de aprovação.');
      setRequirements(EMPTY);
    } finally {
      setLoading(false);
    }
  }, [contracts, idsKey, refreshKey]);

  useEffect(() => { void refresh(); }, [refresh]);

  return { requirements, loading, error, refresh };
}
