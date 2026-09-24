'use client';

import { useState } from 'react';
import { ShieldPlus } from 'lucide-react';
import {
  Busy, Chip, EmptyState, Plane, SidePanel, date, money, parseDecimalBR, plural, useGovernedAction, useResource,
} from '@/components/ax';
import { OrderList } from './OrdersStage';
import type { ProcurementModel } from './shared';

const SOURCE_LABEL: Record<string, string> = {
  BOARD_RESOLUTION: 'Ata de diretoria/conselho', POWER_OF_ATTORNEY: 'Procuração', DELEGATION_LETTER: 'Carta de delegação',
  CONTRACT_CLAUSE: 'Cláusula contratual', INTERNAL_POLICY_DOCUMENT: 'Política interna', BYLAWS: 'Estatuto/contrato social',
};
const ROLE_LABEL: Record<string, string> = {
  ceo_diretoria: 'CEO / Diretoria', financeiro: 'Financeiro', engenharia_pcp: 'Engenharia / PCP', gestor_projetos: 'Gestor de projetos',
};

/**
 * APROVAÇÕES — o que espera decisão e SOB QUE REGRA. Com política no motor,
 * decide a política (etapas, elegibilidade); sem ela, a alçada declarada com
 * evidência — e sem alçada, não há aprovação. Quem criou ou submeteu não aprova.
 */
export function ApprovalsStage({ data, onChanged }: { data: ProcurementModel; onChanged: () => void }) {
  const [declaring, setDeclaring] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const waiting = data.purchaseOrders.filter((o) => o.status === 'APPROVAL_REQUIRED');
  const active = data.authorities.filter((a) => a.active);
  return (
    <>
      <Plane flush title="Esperando aprovação" count={waiting.length}
        subtitle="Sem aprovação o pedido não é emitido e não conta como entrada na cobertura do projeto">
        <OrderList data={data} orders={waiting} onChanged={onChanged} emptyTitle="Nada aguardando aprovação"
          emptyText="Pedidos submetidos aparecem aqui até a decisão." />
      </Plane>

      <Plane flush title="Alçadas de compra declaradas" count={active.length}
        subtitle="Quem pode aprovar compras, até quanto, e com base em qual documento — ninguém declara alçada para si mesmo"
        action={data.capabilities.authorities ? <button type="button" className="ax-btn sm" onClick={() => setDeclaring(true)}>
          <ShieldPlus size={13} aria-hidden />Declarar alçada</button> : undefined}>
        {data.authorities.length === 0 ? (
          <EmptyState compact title="Nenhuma alçada declarada">
            {data.capabilities.authorities ? 'Declare quem pode aprovar compras, até quanto e com base em qual documento.'
              : 'Sem alçada declarada nem política no motor, pedidos de compra não são aprováveis. Peça ao administrador.'}
          </EmptyState>
        ) : (
          <div className="ax-table-wrap">
            <table className="ax-table cards">
              <caption className="sr-only-ax">Alçadas de compra</caption>
              <thead><tr><th>A quem</th><th className="num">Teto</th><th>Escopo</th><th>Evidência</th><th>Vigência</th><th>Situação</th><th /></tr></thead>
              <tbody>
                {data.authorities.map((a) => (
                  <tr key={a.id} data-testid="authority-row">
                    <td className="lead" data-label="">{a.grantee}</td>
                    <td className="num" data-label="Teto">{a.maxAmount === null ? 'sem teto declarado' : money(a.maxAmount, a.currency)}</td>
                    <td data-label="Escopo">{[a.projectId ? 'projeto específico' : 'toda a organização', a.category].filter(Boolean).join(' · ')}</td>
                    <td data-label="Evidência"><div className="ax-cellstack"><span>{SOURCE_LABEL[a.sourceKind] ?? a.sourceKind}</span><small>{a.sourceReference}</small></div></td>
                    <td data-label="Vigência">{date(a.effectiveFrom)}{a.effectiveUntil ? ` até ${date(a.effectiveUntil)}` : ''}</td>
                    <td data-label="Situação"><Chip tone={a.active ? 'success' : 'neutral'}>{a.active ? 'Vigente' : 'Revogada'}</Chip></td>
                    <td className="num" data-label="">{a.active && data.capabilities.authorities && (
                      <button type="button" className="ax-btn ghost sm" onClick={() => setRevoking(a.id)}>Revogar</button>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Plane>
      <p className="ax-note">Aprovar grava a alçada usada e a impressão digital do pedido. Cancelar um pedido com aprovação pendente cancela também o
        pedido no motor de aprovação — nenhuma decisão fica órfã. {plural(active.length, 'alçada vigente', 'alçadas vigentes')}.</p>
      {declaring && <DeclarePanel onClose={() => setDeclaring(false)} onDone={() => { setDeclaring(false); onChanged(); }} />}
      {revoking && <RevokePanel id={revoking} onClose={() => setRevoking(null)} onDone={() => { setRevoking(null); onChanged(); }} />}
    </>
  );
}

function DeclarePanel({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { run, busy } = useGovernedAction(onDone);
  const rolesResource = useResource<{ ok: true; roles: Array<{ id: string; key: string; name: string }> }>('/api/supply/procurement/roles');
  const roles = rolesResource.data?.roles ?? [];
  const [roleId, setRoleId] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [sourceKind, setSourceKind] = useState('BOARD_RESOLUTION');
  const [reference, setReference] = useState('');
  const [justification, setJustification] = useState('');
  const max = maxAmount ? parseDecimalBR(maxAmount) : null;
  const invalid = !roleId || reference.trim().length < 2 || justification.trim().length < 3 || (maxAmount !== '' && !(max && max > 0));
  return (
    <SidePanel open onClose={onClose} testId="authority-form" eyebrow="Compras · governança" title="Declarar alçada de compra"
      meta={<span>Quem pode aprovar, até quanto, com base em qual documento.</span>}
      footer={<>
        <button type="button" className="ax-btn ghost" onClick={onClose}>Voltar</button>
        <button type="button" className="ax-btn primary" disabled={invalid || busy !== null}
          onClick={() => run('authority', '/api/supply/procurement/authorities', { granteeKind: 'ROLE', granteeRoleId: roleId, maxAmount: max,
            currency: 'BRL', sourceKind, sourceReference: reference.trim(), justification: justification.trim() }, { title: 'Alçada declarada' }, { idempotent: false })}>
          <Busy on={busy !== null}>Declarar</Busy></button>
      </>}>
      <div className="ax-form">
        <label className="ax-field"><span>Papel</span><select value={roleId} onChange={(e) => setRoleId(e.target.value)}><option value="">Selecione…</option>
          {roles.map((r) => <option key={r.id} value={r.id}>{ROLE_LABEL[r.key] ?? r.name}</option>)}</select></label>
        <label className="ax-field"><span>Teto (R$) — vazio = sem teto declarado</span><input inputMode="decimal" value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} /></label>
        <div className="ax-field-row">
          <label className="ax-field"><span>Evidência</span><select value={sourceKind} onChange={(e) => setSourceKind(e.target.value)}>
            {Object.entries(SOURCE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="ax-field"><span>Referência</span><input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Ata 12/2026" /></label>
        </div>
        <label className="ax-field"><span>Justificativa</span><textarea value={justification} onChange={(e) => setJustification(e.target.value)} /></label>
      </div>
    </SidePanel>
  );
}

function RevokePanel({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const { run, busy } = useGovernedAction(onDone);
  const [reason, setReason] = useState('');
  return (
    <SidePanel open onClose={onClose} testId="authority-revoke-form" eyebrow="Compras · governança" title="Revogar alçada"
      footer={<>
        <button type="button" className="ax-btn ghost" onClick={onClose}>Voltar</button>
        <button type="button" className="ax-btn primary" disabled={reason.trim().length < 3 || busy !== null}
          onClick={() => run(`revoke:${id}`, `/api/supply/procurement/authorities/${id}`, { action: 'revoke', reason: reason.trim() },
            { title: 'Alçada revogada' }, { idempotent: false })}>
          <Busy on={busy !== null}>Revogar</Busy></button>
      </>}>
      <label className="ax-field"><span>Motivo</span><input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
    </SidePanel>
  );
}
