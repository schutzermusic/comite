'use client';

import { useState } from 'react';
import { HudButton } from '@/components/hud';
import { DataTable, EmptyNote, GovernanceNote, Panel, StatePill, day, useOperationsResource } from '@/components/operations/ui';
import { ActModal, useInventoryAct } from '../inventory/shared';
import { OrdersTab } from './OrdersTab';
import { brlOf, parseDecimal, type ProcurementModel } from './shared';

const SOURCE_LABEL: Record<string, string> = {
  BOARD_RESOLUTION: 'Ata de diretoria/conselho', POWER_OF_ATTORNEY: 'Procuração', DELEGATION_LETTER: 'Carta de delegação',
  CONTRACT_CLAUSE: 'Cláusula contratual', INTERNAL_POLICY_DOCUMENT: 'Política interna', BYLAWS: 'Estatuto/contrato social',
};

/**
 * APROVAÇÕES — o que espera decisão e SOB QUE REGRA. Sem política no motor,
 * a regra é a alçada declarada com evidência; sem alçada, não há aprovação.
 */
export function ApprovalsTab({ data, onChanged }: { data: ProcurementModel; onChanged: () => void }) {
  const [declaring, setDeclaring] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const active = data.authorities.filter((a) => a.active);
  return (
    <>
      <OrdersTab data={data} onChanged={onChanged} onlyAwaitingApproval />
      <Panel title="Alçadas de compra declaradas" note={`${active.length} vigente(s)`}
        aside={data.capabilities.authorities ? <HudButton size="sm" variant="primary" onClick={() => setDeclaring(true)}>Declarar alçada</HudButton> : undefined}>
        <DataTable label="Alçadas de compra" columns={['A quem', 'Teto', 'Escopo', 'Evidência', 'Vigência', 'Situação', '']} count={data.authorities.length}
          footer="Sem política no motor e sem alçada declarada, nenhum pedido é aprovável"
          empty={<EmptyNote title="Nenhuma alçada declarada" description={data.capabilities.authorities
            ? 'Declare quem pode aprovar compras, até quanto e com base em qual documento.'
            : 'Sem alçada declarada nem política no motor de aprovação, pedidos de compra não são aprováveis. Peça ao administrador.'} />}>
          {data.authorities.map((a) => (
            <tr key={a.id} data-testid="authority-row">
              <td>{a.grantee}</td>
              <td className="tabular-nums">{a.maxAmount === null ? 'Sem teto declarado' : brlOf(a.maxAmount, a.currency)}</td>
              <td>{[a.projectId ? 'projeto específico' : 'toda a organização', a.category].filter(Boolean).join(' · ')}</td>
              <td>{SOURCE_LABEL[a.sourceKind] ?? a.sourceKind}<p className="crm-muted">{a.sourceReference}</p></td>
              <td>{day(a.effectiveFrom)}{a.effectiveUntil ? ` até ${day(a.effectiveUntil)}` : ''}</td>
              <td><StatePill tone={a.active ? 'success' : 'neutral'}>{a.active ? 'Vigente' : 'Revogada'}</StatePill>
                {a.revocationReason && <p className="crm-muted">{a.revocationReason}</p>}</td>
              <td>{a.active && data.capabilities.authorities && <HudButton size="sm" variant="ghost" onClick={() => setRevoking(a.id)}>Revogar</HudButton>}</td>
            </tr>
          ))}
        </DataTable>
        <GovernanceNote>Ninguém declara alçada para si mesmo. Aprovar grava a alçada usada e a impressão digital do pedido.</GovernanceNote>
      </Panel>
      {declaring && <DeclareModal onClose={() => setDeclaring(false)} onDone={() => { setDeclaring(false); onChanged(); }} />}
      {revoking && <RevokeModal id={revoking} onClose={() => setRevoking(null)} onDone={() => { setRevoking(null); onChanged(); }} />}
    </>
  );
}

const ROLE_OPTIONS = [
  { key: 'ceo_diretoria', label: 'CEO / Diretoria' }, { key: 'financeiro', label: 'Financeiro' },
  { key: 'engenharia_pcp', label: 'Engenharia / PCP' }, { key: 'gestor_projetos', label: 'Gestor de projetos' },
];

function DeclareModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { act, busy } = useInventoryAct(onDone);
  const [roleId, setRoleId] = useState('');
  const rolesResource = useOperationsResource<{ ok: true; roles: Array<{ id: string; key: string; name: string }> }>('/api/supply/procurement/roles');
  const roles = rolesResource.data?.roles ?? [];
  const [maxAmount, setMaxAmount] = useState('');
  const [sourceKind, setSourceKind] = useState('BOARD_RESOLUTION');
  const [reference, setReference] = useState('');
  const [justification, setJustification] = useState('');
  const max = maxAmount ? parseDecimal(maxAmount) : null;
  return (
    <ActModal title="Declarar alçada de compra" subtitle="Quem pode aprovar, até quanto, com base em qual documento." onClose={onClose}
      busy={busy} disabled={!roleId || reference.trim().length < 2 || justification.trim().length < 3 || (max !== null && !(max > 0))}
      confirmLabel="Declarar" testId="authority-form"
      onConfirm={() => act('/api/supply/procurement/authorities', { granteeKind: 'ROLE', granteeRoleId: roleId, maxAmount: max,
        currency: 'BRL', sourceKind, sourceReference: reference.trim(), justification: justification.trim() }, 'Alçada declarada')}>
      <label>Papel<select value={roleId} onChange={(e) => setRoleId(e.target.value)}><option value="">Selecione…</option>
        {roles.map((r) => <option key={r.id} value={r.id}>{ROLE_OPTIONS.find((o) => o.key === r.key)?.label ?? r.name}</option>)}</select></label>
      <label>Teto (R$) — vazio = sem teto declarado<input inputMode="decimal" value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} /></label>
      <div className="ops-form-row">
        <label>Evidência<select value={sourceKind} onChange={(e) => setSourceKind(e.target.value)}>
          {Object.entries(SOURCE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Referência<input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Ata 12/2026" /></label>
      </div>
      <label>Justificativa<textarea value={justification} onChange={(e) => setJustification(e.target.value)} /></label>
    </ActModal>
  );
}

function RevokeModal({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const { act, busy } = useInventoryAct(onDone);
  const [reason, setReason] = useState('');
  return (
    <ActModal title="Revogar alçada" onClose={onClose} busy={busy} disabled={reason.trim().length < 3} confirmLabel="Revogar"
      onConfirm={() => act(`/api/supply/procurement/authorities/${id}`, { action: 'revoke', reason: reason.trim() }, 'Alçada revogada')}>
      <label>Motivo<input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
    </ActModal>
  );
}
