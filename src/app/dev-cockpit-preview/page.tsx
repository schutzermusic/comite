'use client';

/**
 * Harness visual do cockpit de contrato — DEV ONLY.
 *
 * Renderiza as seções do Quick Dossier com o contrato [QA] em memória, sem
 * Supabase e sem autenticação, para inspeção de hierarquia, espaçamento,
 * contraste e estados vazios/erro nos dois temas.
 *
 * Existe pelo mesmo motivo que `scripts/preview-reports.ts` existe para os PDFs:
 * validar composição sem depender de uma base semeada. Não é rota de produto e
 * não aparece na navegação.
 */

import { useState } from 'react';
import { notFound } from 'next/navigation';
import { HudPageLayout, HudPanel, HudButton } from '@/components/hud';
import {
  ContractIdentity, ProjectRelation, FinancialPulse, RequiresAttention,
  ConnectedOperations, ContractHealthDrivers, RecommendedActionPanel, RecentActivity,
} from '@/components/contracts/cockpit';
import { buildTrustedContract, relationsBatchFromDetail } from '@/lib/contracts/trust/read-model';
import { attentionItems, recommendedAction } from '@/lib/contracts/trust/attention';
import { contractHealth } from '@/lib/contracts/trust/signals';
import { computeTrustedPortfolioStats } from '@/lib/contracts/trust/portfolio';
import {
  portfolioAttention, portfolioConnections, portfolioHorizon,
} from '@/lib/contracts/trust/command-center';
import {
  PortfolioHero, ModuleConnections, PortfolioHorizon, PortfolioAttention, PortfolioScopeBar,
} from '@/components/contracts/cockpit';
import type { ContractDetail, ContractRow, ContractAuditEventRow } from '@/lib/contracts/contract-service';
import type { Project, User } from '@/lib/types';

const NOW = new Date('2026-08-18T12:00:00.000Z');
const QA_ID = 'qa-contract-0001';

const project: Project = {
  id: 'proj-cemig-01', nome: 'Modernização UHE Salto Grande', codigo: 'CEMIG - 2450.07/2024',
  cliente: 'CEMIG', status: 'em_andamento',
  responsavel: { id: 'u-1', nome: 'João Silva' } as unknown as User,
  impacto_financeiro: 'alto', valor_total: 1_200_000, valor_executado: 300_000,
  progresso_percentual: 25, codigoInterno: 'CEMIG - 2450.07/2024', comiteResponsavel: 'Comitê',
};

const row: ContractRow = {
  id: QA_ID, organization_id: 'org-1', project_id: null, client_id: null, supplier_id: null,
  title: '[QA] Contrato de Serviços', contract_number: 'QA-0001',
  counterparty_name: 'Fornecedor QA Ltda.', contract_type: 'Prestação de serviços',
  status: 'active', lifecycle_stage: null,
  start_date: '2026-05-13', end_date: '2027-05-13', signed_date: '2026-05-13',
  renewal_date: null, currency: 'BRL', total_value: 1_200_000, monthly_value: null,
  payment_terms: null, scope_summary: null, risk_level: 'high', health_score: null,
  owner_user_id: 'u-owner', created_by: 'u-owner', updated_by: 'u-owner',
  created_at: '2026-05-14T09:00:00Z', updated_at: '2026-05-14T09:00:00Z', deleted_at: null,
} as ContractRow;

const fullDetail: ContractDetail = {
  contract: row, clauses: [], obligationDefinitions: [], penalties: [], milestones: [], risks: [], files: [], aiAnalyses: [],
  amendments: [], amendmentClauses: [], amendmentsError: null,
  billingEvents: [
    { id: 'b1', contract_id: QA_ID, milestone_id: null, title: '[QA] Parcela 1 — mobilização', amount: 120_000, due_date: '2026-06-01', paid_at: '2026-06-02', status: 'pago' },
    { id: 'b2', contract_id: QA_ID, milestone_id: null, title: '[QA] Parcela 2 — medição', amount: 480_000, due_date: '2026-12-01', paid_at: null, status: 'pendente' },
    { id: 'b3', contract_id: QA_ID, milestone_id: null, title: '[QA] Parcela 3 — encerramento', amount: 600_000, due_date: '2026-07-01', paid_at: null, status: 'pendente' },
  ] as never,
  obligations: [
    { id: 'o1', contract_id: QA_ID, title: '[QA] Validar evidências de entrega', status: 'open', due_date: '2026-10-01', owner_user_id: 'u-owner', evidence: 'Aceite técnico' },
    { id: 'o2', contract_id: QA_ID, title: '[QA] Enviar medição física', status: 'overdue', due_date: '2026-07-01', owner_user_id: null, evidence: 'Medição' },
    { id: 'o3', contract_id: QA_ID, title: '[QA] Registrar apólice', status: 'done', due_date: '2026-06-01', owner_user_id: 'u-owner', evidence: 'Relatório' },
  ] as never,
  approvals: [
    { id: 'a1', contract_id: QA_ID, step_name: 'juridico', status: 'approved', started_at: '2026-05-15T09:00:00Z', completed_at: '2026-05-16T13:00:00Z', created_at: '2026-05-15T09:00:00Z', updated_at: '2026-05-16T13:00:00Z' },
    { id: 'a2', contract_id: QA_ID, step_name: 'financeiro', status: 'under_review', started_at: '2026-05-16T13:00:00Z', completed_at: null, created_at: '2026-05-16T13:00:00Z', updated_at: '2026-05-16T13:00:00Z' },
    { id: 'a3', contract_id: QA_ID, step_name: 'comite', status: 'pending', started_at: null, completed_at: null, created_at: '2026-05-16T13:00:00Z', updated_at: '2026-05-16T13:00:00Z' },
  ] as never,
  projectLinks: [{ id: 'pl1', contract_id: QA_ID, project_id: project.id }] as never,
  riskLinks: [{ id: 'rl1', contract_id: QA_ID, risk_id: 'risk-1' }] as never,
  documents: [
    { id: 'd1', contract_id: QA_ID, title: '[QA] Contrato assinado', document_type: 'contract', status: 'approved', approved_at: '2026-05-20T10:00:00Z', rejection_reason: null },
    { id: 'd2', contract_id: QA_ID, title: '[QA] Apólice de seguro', document_type: 'insurance', status: 'pending_approval', approved_at: null, rejection_reason: null },
    { id: 'd3', contract_id: QA_ID, title: '[QA] Garantia contratual', document_type: 'guarantee', status: 'rejected', approved_at: null, rejection_reason: 'Valor insuficiente' },
  ] as never,
};

/** Contrato sem nenhuma relação — exercita os estados MISSING. */
const emptyDetail: ContractDetail = {
  ...fullDetail,
  billingEvents: [] as never, obligations: [] as never, approvals: [] as never,
  projectLinks: [] as never, riskLinks: [] as never, documents: [] as never, amendments: [], amendmentClauses: [], amendmentsError: null
};

const audit: ContractAuditEventRow[] = [
  { id: 'e1', action: 'contract.document_approved', actor_user_id: 'u-1', metadata: {}, created_at: '2026-08-18T10:42:00Z' },
  { id: 'e2', action: 'contract.obligation_completed', actor_user_id: 'u-1', metadata: {}, created_at: '2026-08-17T14:18:00Z' },
  { id: 'e3', action: 'contract.billing_event_realized', actor_user_id: null, metadata: {}, created_at: '2026-08-15T09:31:00Z' },
  { id: 'e4', action: 'contract.linked_project', actor_user_id: 'u-1', metadata: {}, created_at: '2026-08-12T16:02:00Z' },
  { id: 'e5', action: 'contract.created', actor_user_id: 'u-1', metadata: {}, created_at: '2026-05-14T09:00:00Z' },
];

type Scenario = 'full' | 'empty' | 'error';
type Surface = 'cockpit' | 'command';

/** Reproduz a carteira REAL de produção: 1 live, 1 demo, 2 não classificados. */
const cemigRow = {
  ...row, id: 'cemig', title: 'CEMIG', contract_number: null, counterparty_name: 'CEMIG',
  contract_type: 'Ordem de serviço', status: 'negotiation', risk_level: 'low',
  total_value: 40_000, start_date: null, signed_date: null, data_class: 'live',
} as ContractRow;
const qaDemoRow = { ...row, id: 'qa', data_class: 'demo' } as ContractRow;
const enelRow = (n: string) => ({
  ...row, id: `enel-${n}`, title: 'ENEL', contract_number: null, counterparty_name: 'ENEL',
  total_value: 130_000, data_class: 'unclassified',
} as ContractRow);

const bare = (r: ContractRow): ContractDetail => ({
  contract: r, clauses: [], obligationDefinitions: [], penalties: [], milestones: [], risks: [], files: [], aiAnalyses: [],
  billingEvents: [] as never, obligations: [] as never, approvals: [] as never,
  projectLinks: [] as never, riskLinks: [] as never, documents: [] as never, amendments: [], amendmentClauses: [], amendmentsError: null
});

const realPortfolio = [
  buildTrustedContract(cemigRow, relationsBatchFromDetail(bare(cemigRow)), [project], NOW),
  buildTrustedContract(qaDemoRow, relationsBatchFromDetail(fullDetail), [project], NOW),
  buildTrustedContract(enelRow('a'), relationsBatchFromDetail(bare(enelRow('a'))), [project], NOW),
  buildTrustedContract(enelRow('b'), relationsBatchFromDetail(bare(enelRow('b'))), [project], NOW),
];

export default function CockpitPreviewPage() {
  /**
   * Indisponível em produção — e sem exceção de autenticação.
   *
   * A rota passa pelo gating normal do middleware como qualquer outra página:
   * quem não está autenticado é redirecionado para /login. A guarda abaixo
   * acrescenta a segunda condição: mesmo autenticado, em produção a rota não
   * existe. Um harness de QA não deve abrir superfície nova em produção nem
   * furar o fluxo de auth para existir.
   */
  if (process.env.NODE_ENV === 'production') notFound();

  const [scenario, setScenario] = useState<Scenario>('full');
  const [surface, setSurface] = useState<Surface>('command');

  const detail = scenario === 'full' ? fullDetail : emptyDetail;
  const errors = scenario === 'error'
    ? { billing: 'permission denied for table contract_billing_events', documents: 'timeout' }
    : {};
  const contract = buildTrustedContract(row, relationsBatchFromDetail(detail, errors), [project], NOW);
  const health = contractHealth(contract);
  const attention = attentionItems(contract, NOW);
  const recommendation = recommendedAction(contract, NOW);

  return (
    <HudPageLayout>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-ig-label uppercase tracking-[0.14em] text-ig-fg-muted">Superfície</span>
        {(['command', 'cockpit'] as Surface[]).map((sf) => (
          <HudButton key={sf} size="sm" variant={surface === sf ? 'primary' : 'secondary'} onClick={() => setSurface(sf)}>
            {sf === 'command' ? 'Command Center' : 'Quick Dossier'}
          </HudButton>
        ))}
      </div>

      {surface === 'command' && (() => {
        const stats = computeTrustedPortfolioStats(realPortfolio);
        const attention = portfolioAttention(realPortfolio, NOW);
        const connections = portfolioConnections({
          contracts: realPortfolio, linkedTaskCount: 1, auditEventCount: 3,
        });
        const horizonEvents = portfolioHorizon(realPortfolio, 90, NOW);
        const live = realPortfolio.filter((c) => c.dataClass === 'live');
        const cov = live.map((c) => contractHealth(c).coverage);
        const healthCoverage = {
          assessed: cov.reduce((s2, c) => s2 + c.assessed, 0),
          total: cov.reduce((s2, c) => s2 + c.total, 0) || 6,
        };
        return (
          <div className="space-y-6">
            <PortfolioScopeBar scope="live" onScopeChange={() => {}} counts={stats.scope} />
            <PortfolioHero stats={stats} healthCoverage={healthCoverage} />
            <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
              <section>
                <h3 className="mb-3 text-ig-h3 font-semibold text-ig-fg-strong">Requer atenção</h3>
                <PortfolioAttention items={attention} liveContractCount={stats.contractCount} max={4} onOpenContract={() => {}} />
              </section>
              <section>
                <h3 className="mb-3 text-ig-h3 font-semibold text-ig-fg-strong">Próximos 90 dias</h3>
                <PortfolioHorizon events={horizonEvents} liveContractCount={stats.contractCount} onOpenContract={() => {}} />
              </section>
            </div>
            <section>
              <h3 className="mb-3 text-ig-h3 font-semibold text-ig-fg-strong">Operações conectadas</h3>
              <ModuleConnections connections={connections} onNavigate={() => {}} />
            </section>
          </div>
        );
      })()}

      {surface === 'cockpit' && (<>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <span className="text-ig-label uppercase tracking-[0.14em] text-ig-fg-muted">Cenário</span>
        {(['full', 'empty', 'error'] as Scenario[]).map((s) => (
          <HudButton
            key={s}
            size="sm"
            variant={scenario === s ? 'primary' : 'secondary'}
            onClick={() => setScenario(s)}
          >
            {s === 'full' ? 'Com dado' : s === 'empty' ? 'Sem relações' : 'Falha de leitura'}
          </HudButton>
        ))}
      </div>

      {/* Reproduz a largura do drawer para inspecionar a composição real. */}
      <div className="grid gap-6 xl:grid-cols-[600px_1fr]">
        <HudPanel title="Quick Dossier · cockpit" elevation={3} interactive={false} noPadding>
          <div className="space-y-5 p-5" data-testid="cockpit-body">
            <ContractIdentity contract={contract} />
            <ProjectRelation project={contract.project} onLink={() => {}} />
            <div className="relative overflow-hidden rounded-[18px] border border-ig-border-focus/35 bg-[linear-gradient(160deg,color-mix(in_oklab,var(--ig-bg-panel)_94%,transparent),color-mix(in_oklab,var(--ig-bg-raised)_50%,transparent))] px-4 py-4 shadow-[var(--ig-shadow-e2)]">
              <span className="pointer-events-none absolute inset-y-4 left-0 w-px bg-ig-accent shadow-[0_0_14px_color-mix(in_oklab,var(--ig-accent)_70%,transparent)]" />
              <FinancialPulse contract={contract} now={NOW} />
            </div>
            <section>
              <h3 className="mb-2.5 text-ig-label uppercase tracking-[0.14em] text-ig-fg-muted">Requer atenção</h3>
              <RequiresAttention items={attention} max={3} onAction={() => {}} />
            </section>
            {recommendation && <RecommendedActionPanel action={recommendation} attentionCount={attention.length} onRun={() => {}} />}
            <section>
              <h3 className="mb-2.5 text-ig-label uppercase tracking-[0.14em] text-ig-fg-muted">Operações conectadas</h3>
              <ConnectedOperations contract={contract} onNavigate={() => {}} />
            </section>
            <div className="rounded-[16px] border border-ig-border-subtle bg-[color-mix(in_oklab,var(--ig-bg-raised)_45%,transparent)] px-4 py-4">
              <ContractHealthDrivers health={health} />
            </div>
            <section>
              <h3 className="mb-2.5 text-ig-label uppercase tracking-[0.14em] text-ig-fg-muted">Atividade recente</h3>
              <RecentActivity events={audit} max={4} onViewAll={() => {}} now={NOW} />
            </section>
          </div>
        </HudPanel>

        <div className="space-y-5">
          <HudPanel title="Atenção · lista completa" elevation={2} interactive={false}>
            <RequiresAttention items={attention} onAction={() => {}} />
          </HudPanel>
          <HudPanel title="Saúde · dimensões" elevation={2} interactive={false}>
            <ContractHealthDrivers health={health} />
          </HudPanel>
        </div>
      </div>
      </>)}
    </HudPageLayout>
  );
}
