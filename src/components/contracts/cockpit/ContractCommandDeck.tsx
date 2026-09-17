'use client';

/**
 * A PLATAFORMA DE COMANDO do dossiê — o primeiro terço da tela.
 *
 * ─── O que ela substitui ───────────────────────────────────────────────────
 *
 * Um `HudHeader` genérico (título, subtítulo, dois chips, três botões) seguido
 * de uma faixa sem moldura com quatro métricas e, abaixo, o bloco de projeto.
 * Três superfícies sem relação visual entre si, todas do mesmo peso, sobre o
 * fundo bege do app — e a identidade do contrato competindo com os botões.
 *
 * ─── A pergunta que ela responde, em uma tela ──────────────────────────────
 *
 *   Que contrato é este?          → identidade, com o número como âncora
 *   Com quem?                     → contraparte, ao lado do número
 *   Em que estado?                → chips de assinatura e risco
 *   Quanto vale?                  → valor contratado, a voz dominante
 *   Como está indo?               → faturado, backlog, execução
 *   A que ele está ligado?        → o módulo de projeto, à direita
 *   O que fazer agora?            → as ações, no alto à direita
 *
 * ─── A gramática ───────────────────────────────────────────────────────────
 *
 * A mesma da aba Inteligência Contratual, e de propósito: papel opaco que
 * corta a névoa do fundo imersivo, crista com cantos de HUD, células divididas
 * por fio em vez de cartões, números tabulares, um acento por significado.
 * Duas telas do mesmo produto não podem ter dois sistemas visuais.
 *
 * ─── O que ela NUNCA faz ───────────────────────────────────────────────────
 *
 * Nenhum `?? 0`. Todo número vem de `Official<T>` e atravessa `TrustedValue`,
 * que é o único ponto onde "não apurado" vira pixel. Um backlog ausente
 * mostrado como R$ 0 seria uma afirmação que ninguém fez — e é o defeito que
 * o Trust Layer existe para impedir.
 */

import Link from 'next/link';
import { cn } from '@/lib/utils';
import { ArrowUpRight, Link2, Workflow, AlertTriangle } from 'lucide-react';
import { HudSignal, type HudSignalTone } from '@/components/hud';
import { TrustedValue } from './TrustedValue';
import { hasOfficialValue, isError, ratioTrusted, type Official } from '@/lib/contracts/trust/trusted';
import type { TrustedContract } from '@/lib/contracts/trust/read-model';
import type { Project } from '@/lib/types';
import { compactContractCurrency, officialCurrencyFull } from '@/lib/contracts/trust/format';

export type DeckChipTone = 'neutral' | 'success' | 'warning' | 'critical' | 'accent';

/** O tom do deck resolve para o tom do Signal Chip — uma escala só. */
const CHIP_TONE: Record<DeckChipTone, HudSignalTone> = {
  neutral: 'neutral',
  success: 'success',
  warning: 'warning',
  critical: 'critical',
  accent: 'accent',
};

export interface DeckChip {
  readonly label: string;
  readonly tone: DeckChipTone;
}

export interface ContractCommandDeckProps {
  readonly contract: TrustedContract;
  /** Título do contrato — a linha que o identifica para uma pessoa. */
  readonly title: string;
  /** Número do contrato. A âncora: é por ele que o contrato é citado. */
  readonly code: string;
  readonly chips: readonly DeckChip[];
  readonly breadcrumbHref?: string;
  /** Ações primárias do dossiê, já compostas pela página. */
  readonly actions?: React.ReactNode;
  readonly onLinkProject?: () => void;
  /**
   * A terceira dobra: o que exige uma pessoa agora.
   *
   * Entra como conteúdo, e não como dados, porque os destinos de cada ação
   * pertencem ao dossiê — o deck decide apenas que ela fecha a plataforma,
   * dentro da mesma folha.
   */
  readonly actionCenter?: React.ReactNode;
  readonly className?: string;
}

export function ContractCommandDeck({
  contract, title, code, chips, breadcrumbHref = '/contratos', actions,
  onLinkProject, actionCenter, className,
}: ContractCommandDeckProps) {
  const execution = ratioTrusted(
    contract.billedValue,
    contract.totalValue,
    'faturado sobre valor contratado',
    ['contracts', 'contract_billing_events'],
  );
  const pct = hasOfficialValue(execution) ? Math.round(execution.value * 100) : null;

  return (
    <section className={cn('ig-deck', className)} data-testid="contract-command-deck">
      {/* ── Identidade ────────────────────────────────────────────────── */}
      <header className="ig-deck-crest relative overflow-hidden px-5 pb-5 pt-6 md:px-7">
        {/*
          Não há marca d'água aqui.

          Um glifo de contrato atrás da identidade parecia um toque de
          acabamento, e em tela ele caía exatamente atrás de "Exportar PDF" e
          "Mais ações" — decoração por baixo dos controles, que é onde
          decoração menos pode estar. Os cantos de HUD da crista já dão o sinal
          de superfície instrumentada, e custam 1px.
        */}
        <div className="relative flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
          <div className="min-w-0 flex-1">
            <Link
              href={breadcrumbHref}
              className="text-ig-label uppercase tracking-[0.18em] text-ig-fg-subtle transition-colors hover:text-ig-accent"
            >
              Contratos
            </Link>

            {/*
              O NÚMERO vem antes do título, e em acento.

              É por ele que o contrato é citado num e-mail, numa reunião e numa
              nota fiscal — "JA10182283" identifica; "Contrato de Prestação de
              Serviços" descreve uma categoria e serve a metade da carteira.
            */}
            <p className="mt-2 ig-tabular text-ig-h2 font-semibold text-ig-accent">{code}</p>

            <h1 className="mt-0.5 text-ig-h1 font-semibold text-ig-fg-strong">{title}</h1>

            <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-2">
              <span className="truncate text-ig-body-sm text-ig-fg-muted">
                <TrustedValue
                  value={contract.counterparty}
                  format={(v) => v}
                  size="sm"
                  missingLabel="Contraparte não informada"
                />
              </span>
              {/*
                O ponto separador anda GRUDADO no que ele separa. Solto entre
                dois spans, ele quebrava linha sozinho no telefone e a segunda
                linha começava com "· Prestação de serviços".
              */}
              {hasOfficialValue(contract.contractType) && (
                <span className="truncate text-ig-body-sm text-ig-fg-muted">
                  <span className="text-ig-fg-subtle" aria-hidden>· </span>
                  {contract.contractType.value}
                </span>
              )}
              {/*
                Signal Chip do sistema. Era a cápsula outline legada — raio
                999px com um ponto colorido de 5px —, a peça que o produto
                aposentou: ponto não tem anatomia, e a pílula lia como tag de
                blog ao lado dos chips de status do resto do módulo.
              */}
              {chips.map((chip) => (
                <HudSignal key={chip.label} size="sm" label={chip.label} tone={CHIP_TONE[chip.tone]} />
              ))}
            </div>
          </div>

          {/*
            Sem `shrink-0`.

            Ele parecia proteger os botões e fazia o contrário: a crista tem
            `overflow-hidden` (é ela que arredonda o topo da folha), então a
            barra que se recusava a encolher era CORTADA — a 390px "Mais ações"
            aparecia como "Mais açõe". Deixando encolher, o `flex-wrap` do pai
            manda a barra inteira para a linha de baixo, que é o que ela deve
            fazer quando não cabe.
          */}
          {actions && <div className="relative min-w-0">{actions}</div>}
        </div>
      </header>

      {/* ── Faixa operacional + relação ───────────────────────────────── */}
      <div className="ig-deck-strip grid grid-cols-1 gap-x-0 gap-y-4 px-5 py-4 md:px-7 xl:grid-cols-[minmax(0,1fr)_300px] xl:gap-x-7">
        <dl className="grid min-w-0 grid-cols-2 gap-y-3 sm:grid-cols-4">
          {/*
            O valor contratado é a voz dominante: o único metálico, e o único
            que carrega a moeda por extenso no `title`. Os outros três o
            qualificam — quanto virou fatura, quanto falta, que fração já
            andou — e por isso têm o mesmo tamanho entre si, menor que o dele.
          */}
          {/*
            O compacto é uma decisão de LEITURA executiva, e ela se anuncia
            como tal — "R$ 8 mi". Mas o contrato diz R$ 8.032.339,76, e o
            número por extenso não pode ficar inalcançável: ele vai no `title`,
            a um hover de distância, com os centavos que o documento assinou.
          */}
          <DeckCell label="Valor contratado" first title={officialCurrencyFull(contract.totalValue)}>
            <TrustedValue
              value={contract.totalValue}
              format={(v) => compactContractCurrency(v)}
              size="hero"
              metallic
            />
          </DeckCell>

          <DeckCell label="Faturado">
            <TrustedValue
              value={contract.billedValue}
              format={(v) => compactContractCurrency(v)}
              size="md"
            />
          </DeckCell>

          <DeckCell label="Backlog">
            <TrustedValue
              value={contract.remainingValue}
              format={(v) => compactContractCurrency(v)}
              size="md"
            />
          </DeckCell>

          <DeckCell label="Execução">
            <TrustedValue
              value={execution}
              format={(v) => `${Math.round(v * 100)}%`}
              size="md"
              missingLabel="Não apurada"
            />
            {/*
              Sem apuração NÃO vira 0%. O trilho tracejado diz "não há
              medição"; uma barra sólida vazia diria "a medição deu quase
              nada", que é uma afirmação sobre a execução do contrato.
            */}
            <div
              className="ig-deck-rail mt-2"
              data-unmeasured={pct === null ? 'true' : undefined}
              role="img"
              aria-label={pct === null
                ? 'Execução financeira não apurada'
                : `Execução financeira em ${pct}%`}
            >
              {pct !== null && <i style={{ width: `${Math.min(pct, 100)}%` }} />}
            </div>
          </DeckCell>
        </dl>

        <ProjectModule project={contract.project} onLink={onLinkProject} />
      </div>

      {actionCenter}
    </section>
  );
}

function DeckCell({
  label, children, first = false, title,
}: {
  label: string;
  children: React.ReactNode;
  first?: boolean;
  title?: string;
}) {
  return (
    <div className={cn('ig-deck-cell min-w-0 px-4 py-1', first && 'pl-0')} title={title}>
      <dd className="leading-none">{children}</dd>
      <dt className="mt-2 text-ig-caption text-ig-fg-muted">{label}</dt>
    </div>
  );
}

/**
 * O contrato apontando para outro objeto governado.
 *
 * Três estados, e nenhum deles é um campo vazio: vinculado (abre o projeto),
 * não vinculado (é trabalho, e tem botão) e indisponível (a leitura falhou, e
 * dizer "sem projeto" nesse caso seria afirmar ausência a partir de erro).
 */
function ProjectModule({
  project, onLink,
}: {
  project: Official<Project>;
  onLink?: () => void;
}) {
  if (isError(project)) {
    return (
      <div className="ig-deck-link px-4 py-3" data-state="error">
        <p className="flex items-center gap-1.5 text-ig-label uppercase tracking-[0.12em] text-ig-danger">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
          Vínculo indisponível
        </p>
        <p className="mt-1.5 text-ig-caption text-ig-fg-muted">
          Não foi possível ler os vínculos de projeto deste contrato.
        </p>
      </div>
    );
  }

  if (!hasOfficialValue(project)) {
    return (
      <div className="ig-deck-link px-4 py-3" data-state="missing">
        <p className="flex items-center gap-1.5 text-ig-label uppercase tracking-[0.12em] text-ig-warning">
          <Workflow className="h-3.5 w-3.5" aria-hidden />
          Projeto não vinculado
        </p>
        <p className="mt-1.5 text-ig-caption leading-relaxed text-ig-fg-muted">
          Sem vínculo, o contrato fica fora da visão consolidada de portfólio.
        </p>
        {onLink && (
          <button
            type="button"
            onClick={onLink}
            className="mt-2.5 inline-flex items-center gap-1.5 rounded-md border border-ig-border-default px-2.5 py-1 text-ig-label font-semibold text-ig-fg-strong transition-colors hover:border-ig-border-focus"
          >
            <Link2 className="h-3.5 w-3.5" aria-hidden />
            Vincular projeto
          </button>
        )}
      </div>
    );
  }

  const p = project.value;
  return (
    <Link href={`/projetos/${p.id}`} className="ig-deck-link group min-w-0 px-4 py-3">
      <span className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-ig-label uppercase tracking-[0.12em] text-ig-fg-muted">
          <Workflow className="h-3.5 w-3.5 text-ig-accent" aria-hidden />
          Projeto vinculado
        </span>
        <ArrowUpRight className="ig-deck-link-go h-3.5 w-3.5 text-ig-accent" aria-hidden />
      </span>
      <span className="mt-1.5 block truncate ig-tabular text-ig-body-sm font-semibold text-ig-fg-strong">
        {p.codigo}
      </span>
      <span className="mt-0.5 block text-ig-caption text-ig-fg-muted">{p.nome}</span>
    </Link>
  );
}
