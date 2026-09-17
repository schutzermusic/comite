'use client';

/**
 * Card de contrato — painel de instrumentos, não retângulo de SaaS (MD §15).
 *
 * Três dobras, não cinco:
 *
 *   IDENTIDADE   contraparte, código e os sinais (status, risco, projeto)
 *   EXPOSIÇÃO    valor, execução, faturado/backlog
 *   RODAPÉ       módulos conectados, saúde, atenção e a saída
 *
 * ─── O que encolheu, e por quê ────────────────────────────────────────────
 *
 * O card tinha cinco blocos empilhados, e dois deles gastavam uma faixa
 * horizontal inteira para dizer uma coisa curta: o vínculo de projeto ocupava
 * uma caixa da largura do card para imprimir um código, e a atenção ocupava
 * outra para imprimir uma frase. Na carteira de UM contrato — a largura do
 * conteúdo — isso virava meio metro de vazio à direita de cada linha.
 *
 * Os dois viraram peças de linha: o projeto é um Signal Chip ao lado de status
 * e risco (continua primeira classe, e agora é lido no mesmo golpe de vista
 * que os outros sinais), e a atenção divide o rodapé com os contadores.
 *
 * A superfície passou a ser o material de vidro do sistema (`.ig-glass`), com
 * elevação, ruído, specular e o realce de borda por severidade — em vez de um
 * degradê local que imitava vidro sem nenhuma de suas camadas.
 */

import { motion, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/utils';
import { HudSignal, type HudSignalTone } from '@/components/hud';
import {
  ArrowRight, Workflow, AlertTriangle, Link2, Receipt,
  ClipboardCheck, Archive, ShieldCheck, X,
} from 'lucide-react';
import { hasOfficialValue, isError, ratioTrusted, type Official } from '@/lib/contracts/trust/trusted';
import type { TrustedContract } from '@/lib/contracts/trust/read-model';
import { obligationBreakdown, missingDocuments, renewalState, contractHealth } from '@/lib/contracts/trust/signals';
import { attentionItems } from '@/lib/contracts/trust/attention';
import { DataClassBadge } from './PortfolioScope';
import { ClientLogoBanner } from '@/components/portfolio/ClientLogoBanner';

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL', notation: 'compact',
  minimumFractionDigits: 0, maximumFractionDigits: 1,
});

const STATUS_LABEL: Record<string, string> = {
  draft: 'Rascunho', negotiation: 'Em negociação', legal_review: 'Revisão jurídica',
  commercial_review: 'Revisão comercial', signed: 'Assinado', active: 'Ativo',
  expiring_soon: 'Expirando', expired: 'Expirado', closed: 'Encerrado',
  cancelled: 'Cancelado', archived: 'Arquivado',
};
const RISK_LABEL = { high: 'Alto', medium: 'Médio', low: 'Baixo' } as const;

/** O chip diz o assunto e o prazo; a urgência é o trilho, não o adjetivo. */
const RENEWAL_CHIP = { expired: 'Vigência vencida', critical: 'Vigência ≤30d' } as const;

const text = (t: Official<string>, fallback: string) => (hasOfficialValue(t) ? t.value : fallback);

export interface ContractInstrumentCardProps {
  contract: TrustedContract;
  active?: boolean;
  onSelect: () => void;
  onOpen?: () => void;
  onDelete?: () => void;
  className?: string;
  now?: Date;
  /**
   * Composição LARGA, para quando o card é o único da carteira.
   *
   * Com um contrato, a grade de três colunas deixava dois terços da superfície
   * vazios ao lado de um card estreito — e uma carteira de um contrato é o
   * estado normal de quem começou agora, não uma exceção a tolerar.
   */
  wide?: boolean;
}

export function ContractInstrumentCard({
  contract: c, active = false, onSelect, onOpen, onDelete, className, now = new Date(), wide = false,
}: ContractInstrumentCardProps) {
  const reduced = useReducedMotion();

  const execution = ratioTrusted(c.billedValue, c.totalValue, 'faturado sobre total', ['contracts', 'contract_billing_events']);
  const pct = hasOfficialValue(execution) ? Math.round(execution.value * 100) : null;
  const obligations = obligationBreakdown(c);
  const docs = missingDocuments(c);
  const renewal = renewalState(c);
  const health = contractHealth(c);
  const attention = attentionItems(c, now);
  const critical = attention.filter((a) => a.severity === 'critical').length;

  const counterparty = text(c.counterparty, 'Contraparte não informada');
  const linked = hasOfficialValue(c.project);
  const logoUrl = linked ? c.project.value.clientLogoUrl : undefined;
  const logoClient = linked && c.project.value.cliente ? c.project.value.cliente : counterparty;

  return (
    <motion.article
      initial={reduced ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      whileHover={reduced ? undefined : { y: -2 }}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
      /*
        Material de vidro do sistema: `data-elev` escolhe tinta, blur e sombra;
        `data-state` acende o realce de borda quando há item crítico. O card
        selecionado sobe uma elevação em vez de ganhar uma borda de acento —
        profundidade, que é o vocabulário desta superfície.
      */
      data-elev={active ? '3' : '2'}
      data-state={critical > 0 ? 'critical' : undefined}
      className={cn(
        'ig-glass group cursor-pointer transition-shadow duration-200',
        active
          ? 'shadow-[0_12px_36px_-16px_color-mix(in_oklab,var(--ig-accent)_55%,transparent),var(--ig-shadow-e2)]'
          : 'hover:shadow-[var(--ig-shadow-e2)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--ig-accent)_45%,transparent)]',
        className,
      )}
    >
      <span data-ig-noise="" />
      <span data-ig-specular="" />

      <div data-ig-content="" className="flex flex-col px-4 py-3.5">
        {/* Rail de severidade: vermelho quando há crítico, accent quando selecionado. */}
        <span
          className={cn(
            'pointer-events-none absolute inset-y-0 left-0 w-[3px] transition-opacity',
            critical > 0 ? 'bg-ig-danger opacity-100'
              : active ? 'bg-ig-accent opacity-100'
                : 'bg-ig-accent opacity-0 group-hover:opacity-60',
          )}
          aria-hidden
        />

        <ClientLogoBanner client={logoClient} logoUrl={logoUrl} />

        {/*
          Em modo largo, identidade e exposição correm LADO A LADO: é a mesma
          informação, redistribuída pela largura disponível em vez de empilhada
          num sulco estreito com vazio à direita.
        */}
        <div
          className={cn(
            wide && [
              'lg:grid lg:items-start lg:gap-8',
              /*
                A coluna de exposição é LIMITADA, não proporcional.
                Com `0.85fr` de uma carteira de um contrato, "Valor contratado"
                e "Execução" acabavam a 700px um do outro, e "Faturado" e
                "Backlog" nas duas pontas da tela: quatro números da mesma
                leitura, longe demais para serem lidos como um instrumento só.
              */
              'lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]',
            ],
          )}
        >
          {/* ── Identidade ─────────────────────────────────────────────────── */}
          <header className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="ig-tabular truncate font-mono text-ig-caption font-semibold text-ig-fg-muted">
                {c.code}
              </span>
              <DataClassBadge dataClass={c.dataClass} />
              {onDelete && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onDelete(); }}
                  title="Excluir contrato"
                  className="ml-auto shrink-0 rounded p-1 text-ig-fg-subtle opacity-0 transition-opacity hover:text-ig-danger group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--ig-danger)_45%,transparent)]"
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              )}
            </div>

            <h3 className="mt-1 truncate text-ig-h2 leading-tight text-ig-fg-strong">
              {counterparty}
            </h3>
            <p className="mt-0.5 truncate text-ig-caption text-ig-fg-muted">{c.title}</p>

            {/*
              Status, risco, vigência e PROJETO na mesma régua de sinais, todos
              Signal Chips do sistema. O vínculo continua sendo relação de
              primeira classe — só deixou de gastar uma faixa inteira do card
              para imprimir um código de sete caracteres.
            */}
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              <HudSignal
                size="sm"
                label={STATUS_LABEL[c.status] ?? c.status}
                tone={c.status === 'active' || c.status === 'signed' ? 'success' : 'accent'}
              />
              <HudSignal
                size="sm"
                label={`Risco ${RISK_LABEL[c.riskLevel]}`}
                tone={c.riskLevel === 'high' ? 'danger' : c.riskLevel === 'medium' ? 'warning' : 'success'}
              />
              {hasOfficialValue(renewal) && (renewal.value === 'expired' || renewal.value === 'critical') && (
                <HudSignal size="sm" label={RENEWAL_CHIP[renewal.value]} tone="danger" />
              )}
              {linked ? (
                <HudSignal
                  size="sm"
                  tone="accent"
                  icon={<Workflow aria-hidden />}
                  label={c.project.value.codigo}
                  title={`Projeto vinculado: ${c.project.value.nome}`}
                />
              ) : (
                <HudSignal
                  size="sm"
                  tone="warning"
                  icon={<Link2 aria-hidden />}
                  label={isError(c.project) ? 'Vínculo indisponível' : 'Sem projeto'}
                />
              )}
            </div>
          </header>

          {/* ── Exposição ──────────────────────────────────────────────────── */}
          <div className={cn('mt-3.5', wide && 'lg:mt-0')}>
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0">
                <p className="text-ig-label text-ig-fg-muted">Valor contratado</p>
                <p className="ig-tabular mt-0.5 truncate text-[22px] font-semibold leading-none text-ig-fg-strong">
                  {hasOfficialValue(c.totalValue) ? BRL.format(c.totalValue.value) : (
                    <span className="text-[15px] font-medium text-ig-fg-subtle">Não apurado</span>
                  )}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-ig-label text-ig-fg-muted">Execução</p>
                <p className="ig-tabular mt-0.5 text-ig-h2 leading-none text-ig-fg-strong">
                  {pct === null ? <span className="text-[13px] font-medium text-ig-fg-subtle">—</span> : `${pct}%`}
                </p>
              </div>
            </div>

            {/* Sem apuração: trilho tracejado, nunca uma barra que pareça medição. */}
            <div className="mt-2">
              {pct === null ? (
                <div className="h-1.5 w-full rounded-full border border-dashed border-ig-border-strong" role="img" aria-label="Execução não apurada" />
              ) : (
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-ig-border-subtle">
                  <div className="h-full rounded-full bg-ig-success transition-[width] duration-500" style={{ width: `${pct}%` }} />
                </div>
              )}
            </div>

            <div className="mt-1.5 flex justify-between gap-3 text-ig-caption text-ig-fg-muted">
              <span className="truncate">
                Faturado {hasOfficialValue(c.billedValue) ? BRL.format(c.billedValue.value) : '—'}
              </span>
              <span className="shrink-0">
                Backlog {hasOfficialValue(c.remainingValue) ? BRL.format(c.remainingValue.value) : '—'}
              </span>
            </div>
          </div>
        </div>

        {/*
          ── Rodapé único ───────────────────────────────────────────────────
          Contadores, saúde, atenção e saída numa régua só. Eram duas faixas,
          cada uma com uma ponta ocupada e o resto vazio.
        */}
        <div className="mt-3 flex flex-wrap items-center gap-x-3.5 gap-y-2 border-t border-ig-border-subtle pt-2.5">
          <div className="flex shrink-0 items-center gap-x-3.5">
            <ModuleTick
              icon={<ClipboardCheck className="h-3.5 w-3.5" aria-hidden />}
              value={hasOfficialValue(obligations) ? obligations.value.total : null}
              alert={hasOfficialValue(obligations) && obligations.value.overdue > 0}
              title="Obrigações mapeadas"
            />
            <ModuleTick
              icon={<Receipt className="h-3.5 w-3.5" aria-hidden />}
              value={hasOfficialValue(c.billingEvents) ? c.billingEvents.value.length : null}
              title="Eventos de faturamento"
            />
            <ModuleTick
              icon={<Archive className="h-3.5 w-3.5" aria-hidden />}
              value={hasOfficialValue(c.documents) ? c.documents.value.length : null}
              alert={hasOfficialValue(docs) && docs.value.length > 0}
              title="Documentos registrados"
            />
            <ModuleTick
              icon={<ShieldCheck className="h-3.5 w-3.5" aria-hidden />}
              value={hasOfficialValue(c.approvals) ? c.approvals.value.length : null}
              title="Etapas de aprovação"
            />
            <span className="shrink-0 text-ig-caption text-ig-fg-subtle" title="Dimensões de saúde apuradas">
              saúde <span className="ig-tabular font-semibold text-ig-fg-muted">{health.coverage.assessed}/{health.coverage.total}</span>
            </span>
          </div>

          {/* A atenção é um chip com a contagem; a frase do item mais grave
              segue ao lado enquanto houver largura para ela. */}
          {attention.length > 0 ? (
            <span className="flex min-w-0 flex-1 items-center gap-2" title={attention[0].title}>
              <HudSignal
                size="sm"
                tone={critical > 0 ? 'critical' : 'warning'}
                icon={<AlertTriangle aria-hidden />}
                label="Atenção"
                value={attention.length}
                className="shrink-0"
              />
              <span className="truncate text-ig-caption text-ig-fg-muted">{attention[0].title}</span>
            </span>
          ) : (
            <span className="min-w-0 flex-1">
              <HudSignal size="sm" tone="success" label="Sem pendências" />
            </span>
          )}

          {onOpen && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onOpen(); }}
              className="ml-auto inline-flex shrink-0 items-center gap-1 rounded text-ig-caption font-semibold text-ig-accent transition-transform hover:translate-x-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--ig-accent)_45%,transparent)]"
            >
              Dossiê
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
        </div>
      </div>
    </motion.article>
  );
}

/** Contador de módulo. `null` vira travessão — ausência não é zero. */
function ModuleTick({
  icon, value, alert = false, title,
}: {
  icon: React.ReactNode; value: number | null; alert?: boolean; title: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        'flex shrink-0 items-center gap-1 text-ig-caption',
        alert ? 'font-semibold text-ig-warning' : 'text-ig-fg-muted',
      )}
    >
      <span className={alert ? 'text-ig-warning' : 'text-ig-fg-subtle'}>{icon}</span>
      <span className="ig-tabular">{value === null ? '—' : value}</span>
    </span>
  );
}
