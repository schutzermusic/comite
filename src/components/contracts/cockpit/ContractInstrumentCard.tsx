'use client';

/**
 * Card de contrato — painel de instrumentos, não retângulo de SaaS (MD §15).
 *
 * Três dobras, não cinco:
 *
 *   IDENTIDADE   título, tipo, código e os sinais (status, risco, projeto)
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
 *
 * ─── Quatro zonas declaradas ──────────────────────────────────────────────
 *
 * O card lia como uma pilha contínua: identidade, sinais, números, contadores,
 * atenção e saída sem nenhuma pausa entre eles, e o olho não sabia onde uma
 * leitura terminava e a outra começava. As quatro perguntas do card ganharam
 * separação explícita — e só UM fio entre elas, o do rodapé:
 *
 *   IDENTIDADE  quem é o contrato        (código, título, tipo, logo)
 *   SAÚDE       como ele está            (régua de Signals: status, risco,
 *                                         vigência, vínculo)
 *   FINANCEIRO  quanto vale e quanto andou (valor, execução, faturado/backlog)
 *   AÇÃO        o que fazer com ele      (atenção + botão de dossiê)
 *
 * A saída deixou de ser um link de texto perdido no meio de nove contadores e
 * virou um botão de verdade, sozinho na ponta direita do rodapé.
 */

import { motion, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/utils';
import { HudSignal } from '@/components/hud';
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

  const linked = hasOfficialValue(c.project);
  const logoUrl = linked ? c.project.value.clientLogoUrl : undefined;
  // Logo ainda usa a contraparte (ou cliente do projeto) só como âncora visual —
  // o nome não é impresso no card para não competir com o título.
  const logoClient = linked && c.project.value.cliente
    ? c.project.value.cliente
    : text(c.counterparty, c.title);
  // Mesma linha de descrição do card de projeto: objeto contratado, com
  // fallback ao texto do projeto vinculado e, por último, ao tipo.
  const serviceSummary = hasOfficialValue(c.scopeSummary)
    ? c.scopeSummary.value
    : linked && c.project.value.descricao?.trim()
      ? c.project.value.descricao.trim()
      : text(c.contractType, '');

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
      data-elev={active ? '4' : '3'}
      data-state={critical > 0 ? 'critical' : undefined}
      className={cn(
        /*
          `h-full`: numa grade de dois ou três cards, o mais alto define a
          linha e os vizinhos acompanham. Sem isso, dois contratos lado a lado
          terminavam em alturas diferentes só porque um tinha um chip de
          vigência a mais — e a "Carteira em destaque" lia como uma pilha
          desalinhada em vez de um conjunto.
        */
        'ig-glass group h-full cursor-pointer transition-shadow duration-200',
        active
          ? 'shadow-[0_12px_36px_-16px_color-mix(in_oklab,var(--ig-accent)_55%,transparent),var(--ig-shadow-e2)]'
          : 'hover:shadow-[var(--ig-shadow-e2)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--ig-accent)_45%,transparent)]',
        className,
      )}
    >
      <span data-ig-noise="" />
      <span data-ig-specular="" />

      {/*
        Elevação 3 como base: o card em destaque é um OBJETO de carteira, não
        uma linha de tabela. Em elevação 2 ele empatava com os blocos de apoio
        ao redor, e a última passada ainda o comprimiu a ponto de a identidade,
        o dinheiro e a ação ocuparem a mesma faixa de peso.
      */}
      <div data-ig-content="" className="flex h-full flex-col px-4 py-4">
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

        {/*
          Em modo largo, identidade e exposição correm LADO A LADO: é a mesma
          informação, redistribuída pela largura disponível em vez de empilhada
          num sulco estreito com vazio à direita.
        */}
        <div
          className={cn(
            'pb-3.5',
            wide && ['lg:grid lg:items-stretch lg:gap-7', 'lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]'],
          )}
        >
          {/* ══ CAMADA 1 — IDENTIDADE ═══════════════════════════════════════
              Quem é este contrato: marca, código, nome e serviço. Nada de
              estado e nada de dinheiro; essas são as outras duas camadas. */}
          <header className="relative min-w-0 text-center">
            {onDelete && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
                title="Excluir contrato"
                className="absolute right-0 top-0 z-10 shrink-0 rounded p-1 text-ig-fg-subtle opacity-0 transition-opacity hover:text-ig-danger group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--ig-danger)_45%,transparent)]"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            )}

            {/* A marca abre a identidade em tamanho de assinatura, não de ícone:
                é o primeiro reconhecimento do card, e o eixo central que o
                código, o título e o serviço seguem abaixo. */}
            <ClientLogoBanner client={logoClient} logoUrl={logoUrl} height={52} align="center" />

            <div className="mt-1.5 flex min-w-0 flex-wrap items-center justify-center gap-2">
              <span className="ig-code truncate">{c.code}</span>
              <DataClassBadge dataClass={c.dataClass} />
            </div>

            {/* Duas linhas equilibradas em vez de uma truncada: o nome da
                contraparte é a informação do card, não um prefixo com "…". */}
            <h3 className="mt-2 text-balance line-clamp-2 text-ig-h2 leading-tight text-ig-fg-strong">
              {c.title}
            </h3>
            {/* Resumo do objeto — mesma peça tipográfica do card de projeto. */}
            {serviceSummary ? (
              <p className="relative mt-1.5 text-[12px] leading-relaxed text-ig-fg-muted line-clamp-2">
                {serviceSummary}
              </p>
            ) : null}
          </header>

          {/* ══ CAMADA 2 — FINANCEIRO ═══════════════════════════════════════
              Superfície PRÓPRIA: gradiente interno leve, realce de topo e
              sombra local. É o que separa dinheiro de identidade sem gastar
              mais uma borda, e o que devolve ao card a leitura em camadas que
              a compressão anterior tinha achatado. */}
          <div
            className={cn(
              'relative overflow-hidden rounded-[12px] px-3.5 py-3',
              'bg-[linear-gradient(145deg,color-mix(in_oklab,var(--ig-bg-raised)_82%,transparent),color-mix(in_oklab,var(--ig-bg-panel)_55%,transparent))]',
              'shadow-[inset_0_1px_0_color-mix(in_oklab,var(--ig-border-strong)_65%,transparent),0_6px_18px_-12px_rgba(0,0,0,0.55)]',
              'mt-3.5',
              wide && 'lg:mt-0 lg:flex lg:flex-col lg:justify-center',
            )}
          >
            <div className="flex items-baseline justify-between gap-3">
              <p className="min-w-0">
                <span className="block text-ig-label uppercase tracking-[0.1em] text-ig-fg-muted">Valor contratado</span>
                <span className="ig-tabular mt-1 block truncate text-ig-kpi-md leading-none text-ig-fg-strong">
                  {hasOfficialValue(c.totalValue) ? BRL.format(c.totalValue.value) : (
                    <span className="text-ig-body-sm font-medium text-ig-fg-subtle">Não apurado</span>
                  )}
                </span>
              </p>
              <p className="ig-tabular shrink-0 text-ig-body-sm font-semibold text-ig-fg-strong">
                {pct === null ? <span className="text-ig-fg-subtle">execução —</span> : `${pct}% executado`}
              </p>
            </div>

            {/* Sem apuração: trilho tracejado, nunca uma barra que pareça medição. */}
            <div className="mt-2">
              {pct === null ? (
                <div className="h-1 w-full rounded-full border border-dashed border-ig-border-strong" role="img" aria-label="Execução não apurada" />
              ) : (
                <div className="h-1 w-full overflow-hidden rounded-full bg-ig-border-subtle">
                  <div className="h-full rounded-full bg-ig-success transition-[width] duration-500" style={{ width: `${pct}%` }} />
                </div>
              )}
            </div>

            <p className="mt-2 flex flex-wrap gap-x-3.5 text-ig-caption text-ig-fg-subtle">
              <span className="truncate">
                Faturado <span className="ig-tabular text-ig-fg-muted">{hasOfficialValue(c.billedValue) ? BRL.format(c.billedValue.value) : '—'}</span>
              </span>
              <span className="truncate">
                Backlog <span className="ig-tabular text-ig-fg-muted">{hasOfficialValue(c.remainingValue) ? BRL.format(c.remainingValue.value) : '—'}</span>
              </span>
            </p>

            {/*
              O VÍNCULO DE PROJETO fecha a camada financeira, não a de estado:
              é por ele que este contrato entra no portfólio consolidado e na
              rastreabilidade do dinheiro. Estava perdido no meio dos chips de
              status, onde lia como mais um rótulo.
            */}
            <p className="mt-2 flex items-center gap-1.5 border-t border-ig-border-subtle pt-2 text-ig-caption text-ig-fg-subtle">
              <Workflow className="h-3 w-3 shrink-0" aria-hidden />
              {linked ? (
                <>
                  <span className="shrink-0">Projeto</span>
                  <span className="ig-code truncate" title={c.project.value.nome}>{c.project.value.codigo}</span>
                </>
              ) : (
                <HudSignal
                  variant="inline"
                  size="sm"
                  tone="warning"
                  icon={<Link2 aria-hidden />}
                  label={isError(c.project) ? 'Vínculo indisponível' : 'Sem projeto'}
                />
              )}
            </p>
          </div>
        </div>

        {/* ══ CAMADA 3 — ESTADO E AÇÃO ══════════════════════════════════════
            Status, risco e vigência na régua de sinais; contadores e saúde
            como contexto; atenção e a saída fechando à direita. */}
        {/* `mt-auto` empurra a camada de ação para a base: com alturas
            equalizadas, o CTA de todos os cards da linha fica na MESMA
            altura, que é o que faz a linha ler como um conjunto. */}
        <div className="mt-auto border-t border-ig-border-subtle pt-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <HudSignal
              size="sm"
              label={STATUS_LABEL[c.status] ?? c.status}
              tone={c.status === 'active' || c.status === 'signed' ? 'success' : 'accent'}
            />
            <HudSignal
              size="sm"
              label={`Risco ${RISK_LABEL[c.riskLevel]}`}
              tone={c.riskLevel === 'high' ? 'critical' : c.riskLevel === 'medium' ? 'warning' : 'success'}
            />
            {hasOfficialValue(renewal) && (renewal.value === 'expired' || renewal.value === 'critical') && (
              <HudSignal size="sm" label={RENEWAL_CHIP[renewal.value]} tone="critical" />
            )}
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
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

            {/* Alerta é Signal INLINE — uma cápsula aqui somaria mais uma caixa
                à mesma linha, ao lado dos chips de estado logo acima. */}
            {attention.length > 0 ? (
              <span className="flex min-w-0 flex-1 items-center gap-2" title={attention[0].title}>
                <HudSignal
                  variant="inline"
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
                <HudSignal variant="inline" size="sm" tone="success" label="Sem pendências" />
              </span>
            )}

            {onOpen && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onOpen(); }}
                className={cn(
                  'ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-[8px] px-3 py-1.5',
                  'text-ig-caption font-semibold text-ig-accent',
                  'bg-[color-mix(in_oklab,var(--ig-accent)_10%,transparent)]',
                  'shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--ig-accent)_22%,transparent)]',
                  'transition-colors hover:bg-[color-mix(in_oklab,var(--ig-accent)_18%,transparent)]',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--ig-accent)_45%,transparent)]',
                )}
              >
                Abrir dossiê
                <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </button>
            )}
          </div>
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
