'use client';

/**
 * INTELIGÊNCIA CONTRATUAL — o cockpit.
 *
 * ─── A regra que organiza a tela ───────────────────────────────────────────
 *
 *     EXCEÇÃO PRIMEIRO. DETALHE SOB DEMANDA.
 *     PESSOAS REVISAM EXCEÇÕES, NÃO TUDO.
 *
 * Uma folha opaca, uma faixa de comando e quatro zonas numeradas:
 *
 *   ▸ FAIXA ......... os sete números que respondem "como está este contrato"
 *                     em três segundos. Métricas divididas por fio, não cinco
 *                     cartões de KPI competindo entre si.
 *   ① ATENÇÃO ....... a fila humana, agrupada pelo MOTIVO. Sete linhas viram
 *                     duas rubricas — que é o número de decisões que existem.
 *   ② ESTRUTURADO ... o que o Apex opera. Zona calma, densa, por categoria.
 *   ③ REGISTROS ..... exposição documental, risco formal e penalidade formal,
 *                     com a MESMA forma e tintas diferentes — porque a
 *                     pergunta é "são a mesma coisa?" e a resposta é não.
 *   ④ RASTREAMENTO .. as cláusulas do documento, recolhidas, um degrau de
 *                     tinta abaixo. Auditoria, não trabalho.
 *
 * ─── A correção de verdade, e não de número ────────────────────────────────
 *
 * O "21 itens requerem sua atenção" não era erro de contagem: era a tabela
 * errada. `contract_clauses` é o TEXTO extraído do PDF, e o selo de exceção
 * dela é da política de extração. A fila de trabalho vive em
 * `contract_operational_interpretations` — 29 linhas, 22 `automatic`, 7
 * `requires_attention`. Nada no banco mudou para esta tela existir.
 *
 * ─── A névoa ───────────────────────────────────────────────────────────────
 *
 * `ImmersiveSpatialBackground` pinta o app inteiro, no claro, com um degradê
 * bege (`#F8F7F4 → #edeee9`), um tinte lima a 3% e uma vinheta nas bordas.
 * Conteúdo sem superfície própria — que era o caso desta aba — lê-se direto
 * sobre aquilo. A aba passa a ter PAPEL: `.ig-ci-sheet`, opaco, com o degrau
 * de luminosidade que faltava. O fundo imersivo não foi tocado; ele é do
 * produto inteiro, e trocá-lo por causa de uma tela seria consertar a casa
 * pela janela.
 *
 * ─── O que esta tela NÃO faz ───────────────────────────────────────────────
 *
 * Não decide, não aceita e não resolve exceção nenhuma. Não existe caminho de
 * escrita em `contract_operational_interpretations` para `authenticated`
 * (migration 161), e inventar um "Aprovar" que não persiste nada seria pior
 * que não ter botão. "Revisar" abre a evidência; a gaveta diz, em palavras,
 * que o registro da decisão ainda não existe no produto.
 */

import { useMemo, useState } from 'react';
import {
  AlertTriangle, ChevronDown, ChevronRight, ExternalLink, FileText, Gavel,
  Layers, Quote, ScanLine, ShieldAlert,
} from 'lucide-react';
import { format } from 'date-fns';
import { pt } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { DossierDetailDrawer, DossierDisclosure } from '../shell/DossierPrimitives';
import { HudButton } from '@/components/hud';
import type {
  ContractAiAnalysisRow, ContractClauseRow, ContractDocumentRow,
  ContractPenaltyRow, ContractRiskRow,
} from '@/lib/contracts/contract-service';
import { CLAUSE_CATEGORY_LABEL, type ClauseCategory } from '@/lib/contracts/clause-categories';
import { formatContractCurrency } from '@/lib/contracts/trust/format';
import { contractRiskLabel } from '@/lib/contracts/risk-labels';
import { clauseProvenance } from '@/lib/contracts/clause-provenance';
import { safeAnalysisFailureMessage } from '@/lib/contracts/trust/analysis-errors';
import {
  ATTENTION_REASON_ASK, ATTENTION_REASON_LABEL, type AttentionReason,
} from '@/lib/contracts/intelligence/attention-policy';
import type { InterpretationDecision } from '@/lib/contracts/intelligence/session';
import {
  attentionReasonAsk, attentionReasonLabel, buildContractIntelligence,
  type AttentionGroup, type ContractOperationalInterpretationRow,
  type InterpretationView,
} from '@/lib/contracts/intelligence/operational-interpretations';
import { ContractAnalysisProgress } from './ContractAnalysisProgress';

// ═══════════════════════════════════════════════════════════════════════════
// props
// ═══════════════════════════════════════════════════════════════════════════

export interface ContractIntelligenceTabProps {
  readonly interpretations: readonly ContractOperationalInterpretationRow[];
  /** A leitura das interpretações falhou — ausência de fila não é fila vazia. */
  readonly interpretationsError?: string | null;
  readonly clauses: readonly ContractClauseRow[];
  readonly documents: readonly ContractDocumentRow[];
  readonly analyses: readonly ContractAiAnalysisRow[];
  readonly risks: readonly ContractRiskRow[];
  /**
   * Os riscos formais com a sua exposição e as ações de alçada, já montados
   * pelo dossiê. Fica aqui como conteúdo, e não como dados, porque as ações
   * governadas pertencem ao dossiê — esta aba decide apenas ONDE aparecem.
   */
  readonly riskExposureDetail?: React.ReactNode;
  readonly penalties: readonly ContractPenaltyRow[];
  readonly canAct?: boolean;
  readonly onOpenDocument?: (documentId: string, page: number | null) => void;
  /**
   * A decisão humana sobre a LEITURA de uma cláusula (migration 154).
   *
   * Vive só na gaveta da cláusula, e de propósito: é um caminho de escrita
   * governado que continua existindo, mas que não pode voltar à tela
   * principal como fila — foi essa fila que apresentou 21 conferências
   * manuais onde há 7 exceções operacionais.
   */
  readonly onClauseDecision?: (clause: ContractClauseRow, decision: InterpretationDecision) => void;
  readonly onCreateRisk?: () => void;
  readonly onLinkRisk?: () => void;
  readonly onRegisterPenalty?: () => void;
  readonly className?: string;
}

/** O que a gaveta está mostrando. Uma gaveta só, dois tipos de evidência. */
type DrawerTarget =
  | { readonly kind: 'interpretation'; readonly item: InterpretationView }
  | { readonly kind: 'clause'; readonly item: ContractClauseRow };

const categoryLabel = (type: string | null): string =>
  (type && CLAUSE_CATEGORY_LABEL[type as ClauseCategory]) || type || 'Sem categoria';

/** O efeito da cláusula, em números do documento. `null` nunca vira zero. */
function clauseEffect(clause: ContractClauseRow): string | null {
  const parts: string[] = [];
  const amount = clause.amount === null ? null : Number(clause.amount);
  const pct = clause.percentage === null ? null : Number(clause.percentage);
  if (amount !== null && Number.isFinite(amount)) parts.push(formatContractCurrency(amount));
  if (pct !== null && Number.isFinite(pct)) parts.push(`${pct}%`);
  if (clause.term_days !== null) parts.push(`${clause.term_days} dias`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** A cláusula custa dinheiro: há quantia ou percentual ESCRITO no documento. */
function hasMonetaryEffect(clause: ContractClauseRow): boolean {
  const amount = clause.amount === null ? null : Number(clause.amount);
  const pct = clause.percentage === null ? null : Number(clause.percentage);
  return (amount !== null && Number.isFinite(amount)) || (pct !== null && Number.isFinite(pct));
}

// ═══════════════════════════════════════════════════════════════════════════
// a aba
// ═══════════════════════════════════════════════════════════════════════════

export function ContractIntelligenceTab({
  interpretations, interpretationsError = null, clauses, documents, analyses,
  risks, riskExposureDetail, penalties, canAct = false, onOpenDocument, onClauseDecision,
  onCreateRisk, onLinkRisk, onRegisterPenalty, className,
}: ContractIntelligenceTabProps) {
  const [drawer, setDrawer] = useState<DrawerTarget | null>(null);
  const [clausesOpen, setClausesOpen] = useState(false);

  const intelligence = useMemo(
    () => buildContractIntelligence(interpretations), [interpretations]);

  const documentById = useMemo(
    () => new Map(documents.map((d) => [d.id, d])), [documents]);
  const analysisById = useMemo(
    () => new Map(analyses.map((a) => [a.id, a])), [analyses]);

  /* A leitura em curso, quando há uma. É observação, nunca enfileiramento. */
  const running = useMemo(
    () => analyses.find((a) => a.status === 'running' || a.status === 'pending') ?? null,
    [analyses]);

  /* A última leitura concluída — a que produziu o que está na tela. */
  const lastCompleted = useMemo(
    () => analyses
      .filter((a) => a.status === 'completed')
      .sort((a, b) => (b.completed_at ?? b.created_at).localeCompare(a.completed_at ?? a.created_at))[0]
      ?? null,
    [analyses]);

  const failure = useMemo(() => {
    if (running || intelligence.total > 0) return null;
    const failed = analyses.find((a) => a.status === 'failed');
    return failed ? safeAnalysisFailureMessage(failed.error_message) : null;
  }, [analyses, running, intelligence.total]);

  /*
    Quantas LEITURAS produziram o acervo de cláusulas, e quantas CATEGORIAS
    contratuais o documento exerce.

    A cobertura NÃO é "N de 10": o vocabulário tem dez categorias e nenhum
    contrato precisa ter as dez — o painel anterior dizia "0 de 10 com
    cláusula validada" e lia-se como reprovação. Aqui o número conta o que o
    documento TEM, que é um fato sobre este contrato.
  */
  const readings = useMemo(
    () => new Set(clauses.map((c) => c.ai_analysis_id).filter(Boolean)).size,
    [clauses]);
  const categories = useMemo(
    () => new Set(clauses.map((c) => c.clause_type).filter(Boolean)).size,
    [clauses]);

  const sourceDocument = intelligence.documentId
    ? documentById.get(intelligence.documentId) ?? null
    : null;

  const exposure = useMemo(
    () => clauses
      .filter(hasMonetaryEffect)
      .sort((a, b) => (a.source_page ?? 0) - (b.source_page ?? 0)),
    [clauses]);

  return (
    <div className={cn('ig-ci-sheet', className)} data-testid="contract-intelligence-tab">
      {/* ── FAIXA DE COMANDO ─────────────────────────────────────────── */}
      <CommandStrip
        total={intelligence.total}
        structured={intelligence.structuredCount}
        attention={intelligence.attentionCount}
        sourceClauses={clauses.length}
        readings={readings}
        categories={categories}
        exposureCount={exposure.length}
        documentTitle={sourceDocument?.title ?? null}
        readAt={lastCompleted?.completed_at ?? lastCompleted?.created_at ?? null}
      />

      <div className="space-y-10 px-5 py-7 md:px-7">
        {running && (
          <ContractAnalysisProgress
            startedAt={running.started_at}
            stage={running.extracted_data?.kind === 'contract_operationalization'
              ? 'operationalization'
              : running.extracted_data?.kind === 'clause_extraction'
                ? 'clause-extraction'
                : null}
          />
        )}

        {interpretationsError && (
          <p className="ig-ci-notice-danger pl-3 text-ig-caption text-ig-fg-muted">
            Não foi possível ler as interpretações operacionais deste contrato. O que aparece abaixo
            são as cláusulas do documento — a fila de exceções permanece desconhecida, e não vazia.
          </p>
        )}

        {failure && !interpretationsError && (
          <p className="ig-ci-notice-warning pl-3 text-ig-caption text-ig-fg-muted">
            {failure} Nenhuma exigência operacional foi estruturada a partir dele.
          </p>
        )}

        {/* ── ① REQUER SUA ATENÇÃO ───────────────────────────────────── */}
        {intelligence.attentionCount > 0 && (
          <AttentionZone
            groups={intelligence.attentionGroups}
            total={intelligence.attentionCount}
            onOpen={(item) => setDrawer({ kind: 'interpretation', item })}
          />
        )}

        {/* ── ② ESTRUTURADO PELO APEX ────────────────────────────────── */}
        {intelligence.structuredCount > 0 && (
          <StructuredZone
            groups={intelligence.structured}
            total={intelligence.structuredCount}
            index={intelligence.attentionCount > 0 ? '02' : '01'}
            onOpen={(item) => setDrawer({ kind: 'interpretation', item })}
          />
        )}

        {intelligence.total === 0 && !interpretationsError && !running && (
          <p className="text-ig-body-sm text-ig-fg-muted">
            Nenhuma exigência operacional foi estruturada a partir deste contrato ainda. As cláusulas
            extraídas do documento continuam abaixo — ausência de exigência é informação, não uma
            lacuna a preencher à mão.
          </p>
        )}

        {/* ── ③ EXPOSIÇÃO E REGISTROS FORMAIS ────────────────────────── */}
        <RecordsZone
          index={intelligence.attentionCount > 0 ? '03' : '02'}
          exposure={exposure}
          risks={risks}
          riskExposureDetail={riskExposureDetail}
          penalties={penalties}
          canAct={canAct}
          onCreateRisk={onCreateRisk}
          onLinkRisk={onLinkRisk}
          onRegisterPenalty={onRegisterPenalty}
          onOpenClause={(clause) => setDrawer({ kind: 'clause', item: clause })}
        />
      </div>

      {/* ── ④ RASTREAMENTO DOCUMENTAL ────────────────────────────────── */}
      <AuditZone
        clauses={clauses}
        readings={readings}
        open={clausesOpen}
        onToggle={() => setClausesOpen((v) => !v)}
        onOpenClause={(clause) => setDrawer({ kind: 'clause', item: clause })}
      />

      <EvidenceDrawer
        target={drawer}
        onClose={() => setDrawer(null)}
        documentById={documentById}
        analysisById={analysisById}
        onOpenDocument={onOpenDocument}
        onClauseDecision={canAct ? onClauseDecision : undefined}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// faixa de comando
// ═══════════════════════════════════════════════════════════════════════════

/**
 * O topo da folha: o contrato em sete números e uma linha de procedência.
 *
 * Sem cartões de KPI. Cinco molduras lado a lado no topo competiriam entre si
 * e com a zona logo abaixo; células divididas por fio dão a mesma leitura e
 * deixam a ênfase para o número que muda de cor.
 */
function CommandStrip({
  total, structured, attention, sourceClauses, readings, categories, exposureCount,
  documentTitle, readAt,
}: {
  total: number;
  structured: number;
  attention: number;
  sourceClauses: number;
  readings: number;
  categories: number;
  exposureCount: number;
  documentTitle: string | null;
  readAt: string | null;
}) {
  return (
    <header className="ig-ci-command px-5 py-4 md:px-6" data-testid="intelligence-summary">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-ig-label uppercase tracking-[0.2em] text-ig-fg-subtle">
            <ScanLine className="h-3.5 w-3.5" aria-hidden />
            Inteligência Contratual
          </p>
          <h2 className="mt-2 text-lg font-normal text-ig-fg-default">
            <span className="ig-tabular text-3xl font-semibold text-ig-fg-strong">{total}</span>
            {' '}
            {total === 1 ? 'interpretação operacional' : 'interpretações operacionais'}
          </h2>
        </div>

        {/*
          A largura representa a contagem de cada estado governado.
          Os números continuam explícitos; o medidor não afirma desempenho.
        */}
        <div className="w-full max-w-[300px]">
          <div className="flex items-baseline justify-between text-ig-caption">
            <span className="text-ig-fg-muted">Operado pelo Apex</span>
            <span className="ig-tabular font-semibold text-ig-fg-strong">
              {structured}/{total}
            </span>
          </div>
          <div className="ig-ci-meter mt-2" role="img"
            aria-label={`${structured} de ${total} interpretações operadas pelo Apex`}>
            {structured > 0 && <i data-on="structured" style={{ flex: structured }} />}
            {attention > 0 && <i data-on="attention" style={{ flex: attention }} />}
            {total > structured + attention && <i style={{ flex: total - structured - attention }} />}
          </div>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
        <Metric value={structured} label="estruturadas" hint="em operação" />
        <Metric value={attention} label="requerem atenção" hint="fila humana" tone="warning" />
        <Metric value={exposureCount} label="exposições" hint="com valor no papel" />
        <Metric value={sourceClauses} label="cláusulas de origem" hint={`${categories} categorias`} />
        <Metric value={readings} label={readings === 1 ? 'leitura' : 'leituras'} hint="do documento" />
      </dl>

      {(documentTitle || readAt) && (
        <p className="mt-5 truncate text-ig-caption text-ig-fg-subtle">
          {documentTitle && <span title={documentTitle}>{documentTitle}</span>}
          {documentTitle && readAt && ' · '}
          {readAt && `lido em ${format(new Date(readAt), "dd 'de' MMMM 'de' yyyy", { locale: pt })}`}
        </p>
      )}
    </header>
  );
}

function Metric({
  value, label, hint, tone = 'default',
}: {
  value: number;
  label: string;
  hint?: string;
  tone?: 'default' | 'warning';
}) {
  return (
    <div className="ig-ci-metric px-4 first:pl-0">
      <dd className={cn(
        'text-ig-kpi-md ig-tabular leading-none',
        tone === 'warning' ? 'text-ig-warning' : 'text-ig-fg-strong',
      )}>
        {value}
      </dd>
      <dt className="mt-1.5 text-ig-caption text-ig-fg-muted">{label}</dt>
      {hint && <p className="text-ig-label text-ig-fg-subtle">{hint}</p>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// cabeçalho de zona
// ═══════════════════════════════════════════════════════════════════════════

/**
 * O que substitui a moldura.
 *
 * Índice, título, contagem e um fio que se apaga à direita. Cinco seções
 * emolduradas empilhadas eram cinco caixas do mesmo peso; o índice ordena e o
 * fio separa, sem desenhar caixa nenhuma.
 */
function ZoneHeader({
  index, title, count, hint, tone = 'default', icon, id,
}: {
  index: string;
  title: string;
  count?: number;
  hint?: string;
  tone?: 'default' | 'warning';
  icon?: React.ReactNode;
  id?: string;
}) {
  return (
    <div className="mb-4">
      <div className="flex items-center gap-3">
        <span className="ig-ci-index text-ig-label">{index}</span>
        <h3
          id={id}
          className={cn(
            'flex items-center gap-2 whitespace-nowrap text-ig-h2',
            tone === 'warning' ? 'text-ig-warning' : 'text-ig-fg-strong',
          )}
        >
          {icon}
          {title}
        </h3>
        {count !== undefined && (
          <span className="ig-ci-count px-2 py-0.5 text-ig-label font-semibold">{count}</span>
        )}
        <span className="ig-ci-zone-rule min-w-6 flex-1" aria-hidden />
      </div>
      {hint && <p className="mt-1.5 pl-8 text-ig-caption text-ig-fg-muted">{hint}</p>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ① requer sua atenção
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A fila humana, agrupada pelo MOTIVO.
 *
 * Sete linhas com o mesmo "Baixa confiança documental" repetido são sete
 * leituras. Duas rubricas — 3 garantias inconclusivas, 4 seguros com exposição
 * material — são DUAS decisões, e é assim que quem decide pensa. Nenhum item
 * some: os sete continuam listados, com efeito e página. O que deixa de se
 * repetir é a explicação.
 *
 * O âmbar aparece na espinha da zona e no motivo do grupo — não em cada linha.
 */
function AttentionZone({
  groups, total, onOpen,
}: {
  groups: readonly AttentionGroup[];
  total: number;
  onOpen: (item: InterpretationView) => void;
}) {
  return (
    <section aria-labelledby="ig-attention" data-testid="intelligence-attention">
      <ZoneHeader
        id="ig-attention"
        index="01"
        title="Requer sua atenção"
        count={total}
        tone="warning"
        icon={<AlertTriangle className="h-4 w-4" aria-hidden />}
        hint="O Apex reteve estas interpretações e não opera por elas. Nenhuma linha canônica foi escrita a partir daqui."
      />

      <div className="ig-ci-spine space-y-6 pl-5">
        {groups.map((group) => (
          <div key={group.key}>
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <h4 className="ig-ci-reason text-ig-body-sm font-semibold">{group.label}</h4>
              <span className="ig-ci-count px-1.5 py-px text-ig-label font-semibold">
                {group.items.length}
              </span>
            </div>
            {group.ask && (
              <p className="mt-1 max-w-[70ch] text-ig-caption text-ig-fg-muted">{group.ask}</p>
            )}

            <div className="mt-2.5">
              {group.items.map((item) => (
                <AttentionRow key={item.id} item={item} onOpen={() => onOpen(item)} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function AttentionRow({
  item, onOpen,
}: {
  item: InterpretationView;
  onOpen: () => void;
}) {
  return (
    <div className="ig-ci-row grid items-center gap-x-4 gap-y-1.5 px-1.5 py-2.5 md:grid-cols-[minmax(0,1fr)_128px_150px_54px_88px]">
      <p className="min-w-0 truncate text-ig-body-sm font-medium text-ig-fg-strong" title={item.title}>
        {item.title}
      </p>

      <span className="truncate text-ig-caption text-ig-fg-muted">{item.familyLabel}</span>

      {/*
        No desktop, efeito e página são colunas alinhadas com as demais zonas.
        No telefone voltam a ser uma linha só: empilhadas, um item ocupava
        cinco alturas de texto — e um traço de "sem valor quantificado" ganhava
        uma linha inteira só para si.
      */}
      <span className="flex items-baseline gap-2 md:contents">
        <span className="truncate text-ig-body-sm ig-tabular font-semibold text-ig-fg-strong md:block md:text-right">
          {item.effect ?? <span className="font-normal text-ig-fg-subtle">—</span>}
        </span>
        <span className="ig-ci-page px-1.5 py-px text-ig-label md:justify-self-end">
          p. {item.page}
        </span>
      </span>

      <div className="md:justify-self-end">
        <button
          type="button"
          onClick={onOpen}
          className="ig-ci-action inline-flex h-7 items-center rounded-md px-3 text-ig-label font-semibold"
        >
          Revisar
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ② estruturado pelo Apex
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A zona calma.
 *
 * Duas colunas em tela larga, porque vinte e duas linhas em coluna única viram
 * uma rolagem longa de itens idênticos — e o que estas linhas precisam dizer
 * é justamente "não há nada a fazer aqui". Densidade, neste caso, é conforto.
 *
 * A linha diz título, efeito e página. Nada mais: o cabeçalho da zona já disse
 * que isto está estruturado e em operação, e repetir "Registrada",
 * "Estruturado pelo Apex" e "origem documental" em cada uma das vinte e duas
 * foi o que tornou a leitura exaustiva.
 */
function StructuredZone({
  groups, total, index, onOpen,
}: {
  groups: readonly { family: string; label: string; items: readonly InterpretationView[] }[];
  total: number;
  index: string;
  onOpen: (item: InterpretationView) => void;
}) {
  return (
    <section aria-labelledby="ig-structured" data-testid="intelligence-structured">
      <ZoneHeader
        id="ig-structured"
        index={index}
        title="Estruturado pelo Apex"
        count={total}
        icon={<Layers className="h-4 w-4 text-ig-accent" aria-hidden />}
        hint="Em operação a partir do documento assinado. Nada aqui depende de uma decisão sua."
      />

      {/*
        Duas colunas BALANCEADAS por contagem, e não por fluxo.

        Uma grade alinha linhas: "Condições de pagamento" (6) ao lado de
        "Obrigações contratuais" (11) esticava a célula curta e abria um vão de
        cinco linhas. `columns-2` não alinha, mas também não parte um grupo com
        `break-inside-avoid` — e o bloco de 11 caía inteiro na primeira coluna,
        deixando 17 linhas de um lado e 5 do outro.

        `balanceColumns` distribui os grupos pelo tamanho, preservando a ordem
        de leitura dentro de cada coluna. Com 6+11+2+3 dá 11 e 11.
      */}
      <div className="grid items-start gap-x-10 pl-8 xl:grid-cols-2">
        {balanceColumns(groups).map((column, columnIndex) => (
          <div key={columnIndex}>
        {column.map((group) => (
          <DossierDisclosure key={group.family} title={group.label} count={group.items.length} open={group.items.length <= 4}>
            <div>
              {group.items.map((item) => (
                <OperationalRow
                  key={item.id}
                  title={item.title}
                  effect={item.effect}
                  page={item.page}
                  onOpen={() => onOpen(item)}
                />
              ))}
            </div>
          </DossierDisclosure>
        ))}
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Distribui grupos em duas colunas de altura parecida.
 *
 * Guloso, mas do MAIOR para o menor — e essa ordem é a diferença entre
 * funcionar e não funcionar. Percorrendo na ordem de exibição, o último grupo
 * a chegar costuma ser grande e desequilibra tudo: nas nove categorias de
 * cláusula deste contrato isso dava 20 linhas de um lado e 27 do outro.
 * Colocando os grandes primeiro, cada um deles ainda encontra espaço para ser
 * compensado pelos pequenos que vêm depois.
 *
 * A ordem de LEITURA é restaurada dentro de cada coluna no fim: ninguém lê
 * duas colunas em ziguezague, mas todo mundo espera encontrá-las em ordem.
 */
function balanceColumns<T extends { items: readonly unknown[] }>(groups: readonly T[]): T[][] {
  const indexed = groups.map((group, order) => ({ group, order }));
  const columns: { group: T; order: number }[][] = [[], []];
  const height = [0, 0];

  for (const entry of [...indexed].sort((a, b) => b.group.items.length - a.group.items.length)) {
    const target = height[0] <= height[1] ? 0 : 1;
    columns[target].push(entry);
    // +1 pelo cabeçalho do grupo, que também ocupa altura.
    height[target] += entry.group.items.length + 1;
  }

  return columns.map((column) => column
    .sort((a, b) => a.order - b.order)
    .map((entry) => entry.group));
}

/** Título, efeito, página. A unidade de leitura de toda a tela. */
function OperationalRow({
  title, effect, page, onOpen,
}: {
  title: string;
  effect: string | null;
  page: number | null;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="ig-ci-row grid w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 px-1.5 py-2 text-left"
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <ChevronRight className="ig-ci-chevron h-3 w-3 shrink-0 text-ig-accent" aria-hidden />
        <span className="text-ig-body-sm text-ig-fg-default" title={title}>{title}</span>
      </span>
      {/*
        Teto do efeito em CARACTERES, não em porcentagem.

        `max-w-44%` parecia razoável e cortava "30 dias" em "3…": a coluna é
        `auto`, então a porcentagem resolvia contra a largura que ela própria
        acabara de colapsar. `ch` resolve contra a fonte, e 18 caracteres
        cabem "240 dias corridos" inteiro — só um indexador por extenso passa
        disso, e esse tem o valor completo no `title` e na gaveta.
      */}
      <span
        className="ig-tabular max-w-[18ch] truncate text-ig-body-sm font-semibold text-ig-fg-strong"
        title={effect ?? undefined}
      >
        {effect ?? <span className="font-normal text-ig-fg-subtle">—</span>}
      </span>
      <span className="ig-ci-page px-1.5 py-px text-ig-label">
        {page === null ? '—' : `p. ${page}`}
      </span>
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ③ exposição e registros formais
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Três coisas diferentes que a tela anterior deixava colidir.
 *
 * "Riscos: Sem registros" aparecia ao lado de interpretações contratuais de
 * risco alto, e lia-se como "este contrato não tem risco" — quando o que
 * faltava era o REGISTRO formal no módulo de Riscos. O mesmo com penalidades:
 * não haver ocorrência registrada não significa não haver cláusula de multa;
 * neste contrato há cinco.
 *
 * Os três cartões têm a mesma forma e tintas de topo diferentes, porque a
 * pergunta que o usuário faz é "são a mesma coisa?" — e a resposta é não.
 */
function RecordsZone({
  index, exposure, risks, riskExposureDetail, penalties, canAct,
  onCreateRisk, onLinkRisk, onRegisterPenalty, onOpenClause,
}: {
  index: string;
  exposure: readonly ContractClauseRow[];
  risks: readonly ContractRiskRow[];
  riskExposureDetail?: React.ReactNode;
  penalties: readonly ContractPenaltyRow[];
  canAct: boolean;
  onCreateRisk?: () => void;
  onLinkRisk?: () => void;
  onRegisterPenalty?: () => void;
  onOpenClause: (clause: ContractClauseRow) => void;
}) {
  return (
    <section aria-labelledby="ig-exposure" data-testid="intelligence-exposure">
      <ZoneHeader
        id="ig-exposure"
        index={index}
        title="Exposição e registros formais"
        hint="O que o contrato expõe, o que foi registrado como risco da empresa e o que já foi aplicado como penalidade são três coisas distintas."
      />

      {/*
        O COMPARADOR, e não três painéis empilháveis.

        A versão anterior dava a cada tipo de registro um cartão com a sua
        lista dentro. Como só um deles tem itens, a grade esticava os três à
        altura do maior e sobravam duas colunas de vazio — do tamanho de meia
        tela. Aqui os três cartões respondem só à pergunta comparativa ("são a
        mesma coisa?"), em altura própria e igual; os ITENS descem para uma
        lista de largura inteira, logo abaixo.
      */}
      <div className="grid items-start gap-4 pl-8 lg:grid-cols-3">
        <RecordCard
          kind="document"
          icon={<FileText className="h-3.5 w-3.5" aria-hidden />}
          label="Exposição contratual"
          count={exposure.length}
          status={exposure.length > 0
            ? `${exposure.length === 1 ? 'cláusula' : 'cláusulas'} com valor ou percentual escrito`
            : 'nenhuma cláusula com valor escrito'}
          note="Lida do documento pelo Apex. Não é risco formal da empresa."
        />

        <RecordCard
          kind="risk"
          icon={<ShieldAlert className="h-3.5 w-3.5" aria-hidden />}
          label="Riscos vinculados"
          count={risks.length}
          status={risks.length > 0
            ? `${risks.length === 1 ? 'risco formal vinculado' : 'riscos formais vinculados'}`
            : 'nenhum risco formal vinculado'}
          note="Descreve o módulo de Riscos — não o contrato, cuja exposição está ao lado."
          actions={canAct && (onCreateRisk || onLinkRisk) ? (
            <>
              {onCreateRisk && <GhostAction onClick={onCreateRisk}>Criar risco</GhostAction>}
              {onLinkRisk && <GhostAction onClick={onLinkRisk}>Vincular existente</GhostAction>}
            </>
          ) : undefined}
        />

        <RecordCard
          kind="penalty"
          icon={<Gavel className="h-3.5 w-3.5" aria-hidden />}
          label="Penalidades registradas"
          count={penalties.length}
          status={penalties.length > 0
            ? `${penalties.length === 1 ? 'ocorrência registrada' : 'ocorrências registradas'}`
            : 'nenhuma ocorrência de penalidade registrada'}
          note="Isso não diz que o contrato não tem cláusula de multa — as cláusulas de penalidade seguem no documento."
          actions={canAct && onRegisterPenalty
            ? <GhostAction onClick={onRegisterPenalty}>Registrar penalidade</GhostAction>
            : undefined}
        />
      </div>

      {/* O que o documento expõe, em largura inteira e no mesmo ritmo de linha. */}
      {exposure.length > 0 && (
        <div className="mt-6 pl-8">
          <div className="mb-1 flex items-baseline gap-2">
            <h4 className="text-ig-label uppercase tracking-[0.14em] text-ig-fg-subtle">
              Exposição contratual identificada
            </h4>
            <span className="ig-tabular text-ig-label text-ig-fg-subtle">{exposure.length}</span>
            <span className="ig-ci-zone-rule min-w-4 flex-1" aria-hidden />
          </div>
          <div className="grid gap-x-10 xl:grid-cols-2">
            {exposure.map((clause) => (
              <OperationalRow
                key={clause.id}
                title={clause.title}
                effect={clauseEffect(clause)}
                page={clause.source_page}
                onOpen={() => onOpenClause(clause)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Lista de registros formais de risco, quando existem. */}
      {risks.length > 0 && (
        <div className="mt-6 pl-8">
          <div className="mb-1 flex items-baseline gap-2">
            <h4 className="text-ig-label uppercase tracking-[0.14em] text-ig-fg-subtle">
              Riscos formais vinculados
            </h4>
            <span className="ig-tabular text-ig-label text-ig-fg-subtle">{risks.length}</span>
            <span className="ig-ci-zone-rule min-w-4 flex-1" aria-hidden />
          </div>
          {/*
            O detalhe — com exposição apurada e as ações de alçada — vem do
            dossiê. Dentro de uma coluna de um terço ele voltaria a ser o
            cartão denso que a tela anterior empilhava.
          */}
          {riskExposureDetail ?? (
            <div>
              {risks.slice(0, 8).map((risk) => (
                <div key={risk.id} className="ig-ci-row px-1.5 py-2">
                  <p className="truncate text-ig-body-sm text-ig-fg-default">{risk.title}</p>
                  <p className="truncate text-ig-caption text-ig-fg-subtle">
                    {risk.category ?? 'categoria não informada'}
                    {risk.status ? ` · ${risk.status}` : ''}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Ocorrências de penalidade, quando existem. */}
      {penalties.length > 0 && (
        <div className="mt-6 pl-8">
          <div className="mb-1 flex items-baseline gap-2">
            <h4 className="text-ig-label uppercase tracking-[0.14em] text-ig-fg-subtle">
              Ocorrências de penalidade
            </h4>
            <span className="ig-tabular text-ig-label text-ig-fg-subtle">{penalties.length}</span>
            <span className="ig-ci-zone-rule min-w-4 flex-1" aria-hidden />
          </div>
          <div className="grid gap-x-10 xl:grid-cols-2">
            {penalties.map((penalty) => (
              <div key={penalty.id} className="ig-ci-row px-1.5 py-2">
                <p className="truncate text-ig-body-sm text-ig-fg-default">{penalty.title}</p>
                <p className="truncate text-ig-caption text-ig-fg-subtle">
                  {penalty.trigger_condition || 'gatilho não descrito'}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * Um tipo de registro, em altura própria.
 *
 * Número grande, uma linha de estado e a ressalva que impede a leitura errada
 * da ausência. Sem lista dentro: listas aqui foram o que produziu as duas
 * colunas de vazio.
 */
function RecordCard({
  kind, icon, label, count, status, note, actions,
}: {
  kind: 'document' | 'risk' | 'penalty';
  icon: React.ReactNode;
  label: string;
  count: number;
  status: string;
  note: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="ig-ci-record flex flex-col p-4" data-kind={kind}>
      <div className="flex items-center gap-2">
        <span className="text-ig-fg-subtle">{icon}</span>
        <h4 className="min-w-0 flex-1 truncate text-ig-label uppercase tracking-[0.12em] text-ig-fg-muted">
          {label}
        </h4>
      </div>

      <p className="mt-2.5 flex items-baseline gap-2">
        <span className={cn(
          'ig-tabular text-ig-kpi-md leading-none',
          count === 0 ? 'text-ig-fg-subtle' : 'text-ig-fg-strong',
        )}>
          {count}
        </span>
        <span className="text-ig-caption text-ig-fg-muted">{status}</span>
      </p>

      <p className="mt-2.5 border-t border-ig-border-subtle pt-2 text-ig-caption leading-relaxed text-ig-fg-subtle">
        {note}
      </p>

      {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

function GhostAction({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md border border-ig-border-subtle px-2.5 py-1 text-ig-label font-semibold text-ig-fg-muted transition-colors hover:border-ig-border-focus hover:text-ig-fg-strong"
    >
      {children}
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ④ rastreamento documental
// ═══════════════════════════════════════════════════════════════════════════

/**
 * O acervo, recolhido, e um degrau de tinta abaixo do papel.
 *
 * Isto é rastreamento e auditoria: de onde veio cada afirmação acima. Não é
 * fila de validação, e por isso nenhuma linha traz estado de revisão. O selo
 * de exceção que a extração gravou em algumas cláusulas continua existindo no
 * banco e aparece na gaveta de cada uma — na tela principal ele criaria uma
 * SEGUNDA fila humana, que é exatamente o defeito que esta aba corrige.
 */
function AuditZone({
  clauses, readings, open, onToggle, onOpenClause,
}: {
  clauses: readonly ContractClauseRow[];
  readings: number;
  open: boolean;
  onToggle: () => void;
  onOpenClause: (clause: ContractClauseRow) => void;
}) {
  const groups = useMemo(() => {
    const byCategory = new Map<string, ContractClauseRow[]>();
    for (const clause of clauses) {
      const key = clause.clause_type ?? '';
      const bucket = byCategory.get(key) ?? [];
      bucket.push(clause);
      byCategory.set(key, bucket);
    }
    return [...byCategory.entries()]
      .map(([key, items]) => ({
        key,
        label: categoryLabel(key || null),
        items: items.sort((a, b) => (a.source_page ?? 0) - (b.source_page ?? 0)),
      }))
      .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
  }, [clauses]);

  return (
    <section className="ig-ci-audit px-5 py-5 md:px-7" data-testid="intelligence-clauses">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        disabled={clauses.length === 0}
        className="flex w-full items-center gap-3 text-left disabled:cursor-default"
      >
        <span className="ig-ci-index text-ig-label">{open ? '—' : '+'}</span>
        <span className="text-ig-h3 text-ig-fg-muted">Cláusulas do documento</span>
        <span className="ig-ci-count px-2 py-0.5 text-ig-label font-semibold">{clauses.length}</span>
        <span className="hidden text-ig-caption text-ig-fg-subtle sm:inline">
          rastreamento e auditoria
          {readings > 1 && <> · <span className="ig-tabular">{readings}</span> leituras do documento</>}
        </span>
        <span className="ig-ci-zone-rule min-w-4 flex-1" aria-hidden />
        {clauses.length > 0 && (open
          ? <ChevronDown className="h-4 w-4 shrink-0 text-ig-fg-subtle" aria-hidden />
          : <ChevronRight className="h-4 w-4 shrink-0 text-ig-fg-subtle" aria-hidden />)}
      </button>

      {clauses.length === 0 && (
        <p className="mt-2 pl-8 text-ig-caption text-ig-fg-subtle">
          Nenhuma cláusula extraída deste contrato.
        </p>
      )}

      {open && clauses.length > 0 && (
        <div className="mt-5 pl-8">
          <p className="mb-5 max-w-[80ch] text-ig-caption text-ig-fg-subtle">
            O texto que o Apex leu do PDF assinado. Não é uma fila de validação: o que exige decisão
            está em &ldquo;Requer sua atenção&rdquo;.
            {readings > 1 && (
              <> As {readings} leituras explicam os títulos repetidos em páginas diferentes — são
              registros de momentos distintos, e a gaveta de cada cláusula diz de qual.</>
            )}
          </p>
          <div className="grid items-start gap-x-10 xl:grid-cols-2">
            {balanceColumns(groups).map((column, columnIndex) => (
              <div key={columnIndex}>
            {column.map((group) => (
              <div key={group.key} className="mb-6">
                <div className="mb-1 flex items-baseline gap-2">
                  <h4 className="text-ig-label uppercase tracking-[0.14em] text-ig-fg-subtle">
                    {group.label}
                  </h4>
                  <span className="ig-tabular text-ig-label text-ig-fg-subtle">
                    {group.items.length}
                  </span>
                  <span className="ig-ci-zone-rule min-w-4 flex-1" aria-hidden />
                </div>
                <div>
                  {group.items.map((clause) => (
                    <OperationalRow
                      key={clause.id}
                      title={clause.title}
                      effect={clauseEffect(clause)}
                      page={clause.source_page}
                      onOpen={() => onOpenClause(clause)}
                    />
                  ))}
                </div>
              </div>
            ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// gaveta de evidência
// ═══════════════════════════════════════════════════════════════════════════

function EvidenceDrawer({
  target, onClose, documentById, analysisById, onOpenDocument, onClauseDecision,
}: {
  target: DrawerTarget | null;
  onClose: () => void;
  documentById: ReadonlyMap<string, ContractDocumentRow>;
  analysisById: ReadonlyMap<string, ContractAiAnalysisRow>;
  onOpenDocument?: (documentId: string, page: number | null) => void;
  onClauseDecision?: (clause: ContractClauseRow, decision: InterpretationDecision) => void;
}) {
  const isInterpretation = target?.kind === 'interpretation';
  const title = target ? target.item.title : '';
  const subtitle = target
    ? (isInterpretation ? target.item.familyLabel : categoryLabel(target.item.clause_type))
    : undefined;

  const documentId = target
    ? (isInterpretation ? target.item.documentId : target.item.source_document_id)
    : null;
  const page = target
    ? (isInterpretation ? target.item.page : target.item.source_page)
    : null;
  const document = documentId ? documentById.get(documentId) ?? null : null;

  return (
    <DossierDetailDrawer
      isOpen={target !== null}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      footer={document && onOpenDocument ? (
        <HudButton
          variant="secondary"
          size="md"
          leftIcon={<ExternalLink className="h-4 w-4" />}
          onClick={() => onOpenDocument(document.id, page)}
        >
          {page ? `Abrir documento na p. ${page}` : 'Abrir documento'}
        </HudButton>
      ) : undefined}
    >
      {target?.kind === 'interpretation' && (
        <InterpretationDetail item={target.item} document={document} />
      )}
      {target?.kind === 'clause' && (
        <ClauseDetail
          clause={target.item}
          document={document}
          reading={analysisById.get(target.item.ai_analysis_id ?? '') ?? null}
          onDecision={onClauseDecision
            ? (decision) => { onClauseDecision(target.item, decision); onClose(); }
            : undefined}
        />
      )}
    </DossierDetailDrawer>
  );
}

function InterpretationDetail({
  item, document,
}: {
  item: InterpretationView;
  document: ContractDocumentRow | null;
}) {
  return (
    <div className="space-y-5">
      {item.trustState === 'requires_attention' && (
        <section className="ig-ci-attention-box rounded-[10px] p-3">
          <h4 className="text-ig-label uppercase tracking-[0.14em] text-ig-warning">
            Por que isto precisa de você
          </h4>
          <ul className="mt-2 space-y-2">
            {item.attentionReasons.map((reason) => (
              <li key={reason} className="text-ig-caption text-ig-fg-default">
                <span className="font-semibold text-ig-fg-strong">{attentionReasonLabel(reason)}</span>
                {attentionReasonAsk(reason) && (
                  <span className="mt-0.5 block text-ig-fg-muted">{attentionReasonAsk(reason)}</span>
                )}
              </li>
            ))}
          </ul>
          <p className="ig-ci-attention-divider mt-2.5 pt-2 text-ig-caption text-ig-fg-muted">
            Enquanto esta interpretação estiver retida, o Apex não opera por ela e nenhuma obrigação,
            condição de faturamento ou exigência foi criada a partir dela.
          </p>
        </section>
      )}

      {item.facts.length > 0 && (
        <DrawerSection label="O que o Apex entendeu">
          <dl className="space-y-2.5">
            {item.facts.map((fact) => (
              <div key={fact.label}>
                <dt className="text-ig-label uppercase tracking-[0.1em] text-ig-fg-subtle">
                  {fact.label}
                </dt>
                <dd className="mt-0.5 text-ig-caption text-ig-fg-default">{fact.value}</dd>
              </div>
            ))}
          </dl>
        </DrawerSection>
      )}

      <DrawerSection label="Fonte no documento">
        <SourceEvidence
          documentTitle={document?.title ?? null}
          page={item.page}
          excerpt={item.excerpt}
        />
      </DrawerSection>

      <DrawerSection label="Procedência">
        <ul className="space-y-1 text-ig-caption text-ig-fg-muted">
          <li>Estruturado pelo Apex a partir do documento assinado.</li>
          {item.confidence !== null && (
            <li>
              Confiança da leitura: <span className="ig-tabular text-ig-fg-default">
                {Math.round(item.confidence * 100)}%
              </span>
            </li>
          )}
          <li>
            {item.trustState === 'automatic'
              ? 'Materializado: o Apex opera por esta regra.'
              : 'Retido pela governança: nada canônico foi escrito.'}
          </li>
        </ul>
      </DrawerSection>

      {item.trustState === 'requires_attention' && (
        <p className="rounded-[10px] border border-dashed border-ig-border-strong p-3 text-ig-caption text-ig-fg-subtle">
          O registro da sua decisão sobre uma interpretação operacional ainda não existe no produto:
          a retirada da retenção acontece em uma nova leitura do documento. Até lá, a exceção
          permanece visível aqui com a evidência que a originou.
        </p>
      )}
    </div>
  );
}

function ClauseDetail({
  clause, document, reading, onDecision,
}: {
  clause: ContractClauseRow;
  document: ContractDocumentRow | null;
  /** A leitura que extraiu esta cláusula. `null` = registro manual ou acervo antigo. */
  reading: ContractAiAnalysisRow | null;
  onDecision?: (decision: InterpretationDecision) => void;
}) {
  const effect = clauseEffect(clause);
  const reasons = (clause.attention_reasons ?? []) as AttentionReason[];

  return (
    <div className="space-y-5">
      <DrawerSection label="Efeito contratual">
        <p className="text-ig-body-sm ig-tabular font-semibold text-ig-fg-strong">
          {effect ?? <span className="text-ig-caption font-normal text-ig-fg-subtle">
            O trecho não quantifica valor, percentual nem prazo.
          </span>}
        </p>
        <p className="mt-1.5 text-ig-caption text-ig-fg-muted">
          Risco da cláusula: {contractRiskLabel(clause.risk_level)}
        </p>
      </DrawerSection>

      {clause.content?.trim() && (
        <DrawerSection label="Leitura registrada">
          <p className="text-ig-caption text-ig-fg-default">{clause.content.trim()}</p>
        </DrawerSection>
      )}

      <DrawerSection label="Fonte no documento">
        <SourceEvidence
          documentTitle={document?.title ?? null}
          page={clause.source_page}
          excerpt={clause.source_excerpt}
        />
      </DrawerSection>

      {/*
        O selo de exceção da EXTRAÇÃO, dito onde ele não vira fila: é uma
        observação sobre o texto desta cláusula, não uma tarefa atribuída.
      */}
      {reasons.length > 0 && (
        <DrawerSection label="Observações da leitura">
          <ul className="space-y-1.5 text-ig-caption text-ig-fg-muted">
            {reasons.map((reason) => (
              <li key={reason}>
                <span className="text-ig-fg-default">
                  {ATTENTION_REASON_LABEL[reason] ?? 'Observação registrada'}
                </span>
                {ATTENTION_REASON_ASK[reason] && (
                  <span className="mt-0.5 block">{ATTENTION_REASON_ASK[reason]}</span>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-ig-caption text-ig-fg-subtle">
            Registrado na extração do texto. Não cria pendência na tela: a fila de decisão é a de
            interpretações operacionais, acima.
          </p>
          {/*
            O caminho de escrita da migration 154 continua aqui, e só aqui: uma
            decisão sobre a leitura de UMA cláusula, tomada com o trecho de
            origem à vista. Na tela principal ele era uma fila de 21 itens.
          */}
          {onDecision && clause.interpretation_state === 'requires_attention' && (
            <div className="mt-3 flex flex-wrap gap-2">
              <GhostAction onClick={() => onDecision('confirm')}>Confirmar leitura</GhostAction>
              <GhostAction onClick={() => onDecision('acknowledge')}>Ciente</GhostAction>
              <GhostAction onClick={() => onDecision('dismiss')}>Descartar</GhostAction>
            </div>
          )}
        </DrawerSection>
      )}

      {clause.attention_resolution_note && (
        <DrawerSection label="Decisão registrada">
          <p className="text-ig-caption text-ig-fg-muted">{clause.attention_resolution_note}</p>
        </DrawerSection>
      )}

      <DrawerSection label="Procedência">
        <ul className="space-y-1 text-ig-caption text-ig-fg-muted">
          <li>
            {clauseProvenance(clause) === 'apex'
              ? 'Transcrito pelo Apex do documento assinado.'
              : 'Registro manual estruturado por uma pessoa.'}
          </li>
          {/*
            De QUAL leitura. É o que explica duas cláusulas com o mesmo título
            em páginas diferentes: elas vieram de leituras diferentes do mesmo
            PDF. Uma leitura substituída não torna a cláusula falsa — ela só
            deixou de ser a leitura corrente.
          */}
          {reading && (
            <li>
              Leitura de{' '}
              {format(
                new Date(reading.completed_at ?? reading.created_at),
                "dd/MM/yyyy 'às' HH:mm",
                { locale: pt },
              )}
              {reading.superseded_by_analysis_id || reading.status === 'superseded'
                ? ' — substituída por uma leitura posterior.'
                : ' — leitura corrente do documento.'}
            </li>
          )}
        </ul>
      </DrawerSection>
    </div>
  );
}

function DrawerSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section>
      <h4 className="mb-1.5 text-ig-label uppercase tracking-[0.14em] text-ig-fg-subtle">
        {label}
      </h4>
      {children}
    </section>
  );
}

function SourceEvidence({
  documentTitle, page, excerpt,
}: {
  documentTitle: string | null;
  page: number | null;
  excerpt: string | null;
}) {
  return (
    <div className="space-y-2">
      <p className="text-ig-caption text-ig-fg-muted">
        {documentTitle ?? 'Documento de origem não vinculado'}
        {page !== null && <span className="ig-tabular"> · p. {page}</span>}
      </p>
      {excerpt?.trim() ? (
        <blockquote className="ig-ci-quote flex gap-2 rounded-[10px] p-2.5">
          <Quote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ig-fg-subtle" aria-hidden />
          <p className="text-ig-caption italic text-ig-fg-default">{excerpt.trim()}</p>
        </blockquote>
      ) : (
        <p className="text-ig-caption text-ig-fg-subtle">Sem trecho de documento associado.</p>
      )}
    </div>
  );
}
