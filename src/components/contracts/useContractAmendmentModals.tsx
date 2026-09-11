'use client';

/**
 * Substituição de documento e registro de aditivo (P2F.1).
 *
 * Os dois fluxos vivem juntos porque compartilham a mesma disciplina: nenhum
 * dos dois destrói o que existia antes. Substituir um documento preserva a
 * versão anterior e a encadeia; registrar um aditivo NÃO reescreve o valor nem
 * o prazo do contrato mestre — grava o efeito declarado, e o vigente passa a
 * ser derivado.
 *
 * A escolha de interface que mais importa aqui é o par de rádios do efeito
 * sobre o valor. O banco proíbe declarar acréscimo E novo total ao mesmo tempo
 * (CHECK em 098), e um formulário com dois campos livres deixaria o usuário
 * preencher os dois e receber um erro de constraint em vez de uma pergunta
 * clara. O rádio faz a exclusão ser óbvia antes de qualquer submissão.
 */

import { useState } from 'react';
import { HudModal, HudButton, HudInput, HudSelect } from '@/components/hud';
import { Input } from '@/components/ui/input';
import { AlertTriangle, Check, FileText, LoaderCircle, UploadCloud } from 'lucide-react';
import { useHudToast } from '@/hooks/useHudToast';
import {
  createContractAmendment,
  replaceContractDocument,
  uploadAmendmentDocumentIdempotent,
  type ContractDocumentRow,
} from '@/lib/contracts/contract-service';
import { deriveAmendmentEffectiveness } from '@/lib/contracts/amendments/ai-types';

type Kind = 'amendment' | 'replaceDoc';

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Rascunho — registrado, sem efeito' },
  { value: 'signed', label: 'Assinado — produz efeito' },
  { value: 'active', label: 'Em vigor — produz efeito' },
  { value: 'cancelled', label: 'Cancelado — nunca produz efeito' },
];

/** Como o aditivo declara a mudança de valor. Exclusivos por desenho. */
type ValueMode = 'none' | 'delta' | 'absolute';
/** Como declara a mudança de prazo. */
type TermMode = 'none' | 'newDate' | 'extension';
type AmendmentMode = 'ai' | 'manual';
type AIStage = 'idle' | 'uploading' | 'queued' | 'reading' | 'comparing'
  | 'structuring' | 'completed' | 'requires_attention' | 'failed';

type AIResult = {
  request: { id: string; status: string; error_safe: string | null; attention_count: number };
  amendment: null | (Record<string, unknown> & {
    amendment_number: string; title: string | null; signed_date: string | null;
    effective_date: string | null; documentary_state: 'draft' | 'signed' | 'unknown';
    status: string; apex_summary: string | null; attention_count: number;
  });
  effects: Array<Record<string, unknown> & {
    id: string; category: string; operation: string; title: string; description: string;
    source_page: number | null; trust_state: 'automatic' | 'requires_attention';
    trust_reasons: string[]; currently_effective: boolean;
  }>;
};

function parseAmount(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

export interface ContractAmendmentModals {
  openAmendment: () => void;
  openReplaceDocument: (doc: ContractDocumentRow) => void;
  modals: React.ReactNode;
}

export function useContractAmendmentModals({
  contractId,
  onRefresh,
}: {
  contractId: string;
  onRefresh: () => Promise<void> | void;
}): ContractAmendmentModals {
  const { notify } = useHudToast();
  const [kind, setKind] = useState<Kind | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [amendmentMode, setAmendmentMode] = useState<AmendmentMode>('ai');
  const [aiStage, setAIStage] = useState<AIStage>('idle');
  const [aiDocumentId, setAIDocumentId] = useState<string | null>(null);
  const [aiError, setAIError] = useState<string | null>(null);
  const [aiResult, setAIResult] = useState<AIResult | null>(null);

  // ── aditivo ──
  const [number, setNumber] = useState('');
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState('signed');
  const [signedDate, setSignedDate] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [valueMode, setValueMode] = useState<ValueMode>('none');
  const [valueAmount, setValueAmount] = useState('');
  const [termMode, setTermMode] = useState<TermMode>('none');
  const [newEndDate, setNewEndDate] = useState('');
  const [extensionDays, setExtensionDays] = useState('');
  const [scopeChange, setScopeChange] = useState('');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState<File | null>(null);

  // ── substituição de documento ──
  const [target, setTarget] = useState<ContractDocumentRow | null>(null);
  const [newTitle, setNewTitle] = useState('');

  const close = () => {
    if (submitting) return;
    setKind(null);
  };

  const resetAmendment = () => {
    setNumber(''); setTitle(''); setStatus('signed');
    setSignedDate(''); setEffectiveDate('');
    setValueMode('none'); setValueAmount('');
    setTermMode('none'); setNewEndDate(''); setExtensionDays('');
    setScopeChange(''); setNotes(''); setFile(null);
    setAmendmentMode('ai'); setAIStage('idle');
    setAIDocumentId(null); setAIError(null); setAIResult(null);
    setKind('amendment');
  };

  const stageFromRequest = (status: string): AIStage => {
    const normalized = status.toLowerCase();
    const allowed: AIStage[] = ['queued', 'reading', 'comparing', 'structuring', 'completed',
      'requires_attention', 'failed'];
    return allowed.includes(normalized as AIStage)
      ? normalized as AIStage : 'queued';
  };

  async function pollAmendment(requestId: string): Promise<void> {
    for (let attempt = 0; attempt < 240; attempt += 1) {
      const response = await fetch(
        `/api/contracts/${contractId}/amendments/onboarding?requestId=${encodeURIComponent(requestId)}`,
        { cache: 'no-store' },
      );
      const body = await response.json() as AIResult & { ok?: boolean; error?: string };
      if (!response.ok) throw new Error(body.error ?? 'Não foi possível acompanhar a análise.');
      const next = stageFromRequest(body.request.status);
      setAIStage(next);
      if (next === 'completed' || next === 'requires_attention') {
        setAIResult(body);
        await onRefresh();
        return;
      }
      if (next === 'failed') {
        setAIError(body.request.error_safe ?? 'A leitura falhou. O PDF continua registrado e pode ser reprocessado.');
        await onRefresh();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1_500));
    }
    setAIError('A análise continua na fila. Feche esta janela e acompanhe o instrumento no dossiê.');
  }

  async function queueDocument(documentId: string): Promise<void> {
    const response = await fetch(`/api/contracts/${contractId}/amendments/onboarding`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documentId }),
    });
    const body = await response.json() as { ok?: boolean; error?: string; requestId?: string; status?: string };
    if (!response.ok || !body.requestId) throw new Error(body.error ?? 'Não foi possível iniciar a leitura.');
    setAIStage(stageFromRequest(body.status ?? 'QUEUED'));
    await pollAmendment(body.requestId);
  }

  async function handleAIFile(selected: File): Promise<void> {
    if (!selected.name.toLowerCase().endsWith('.pdf')
        || (selected.type && selected.type !== 'application/pdf')) {
      setAIError('Selecione um arquivo PDF.');
      setAIStage('failed');
      return;
    }
    setFile(selected); setAIError(null); setAIResult(null); setAIStage('uploading');
    try {
      const document = await uploadAmendmentDocumentIdempotent(contractId, selected);
      setAIDocumentId(document.id);
      await queueDocument(document.id);
    } catch (error) {
      setAIStage('failed');
      setAIError(error instanceof Error ? error.message : 'Falha inesperada ao registrar o PDF.');
      await onRefresh();
    }
  }

  async function retryAI(): Promise<void> {
    if (!aiDocumentId) return;
    setAIError(null); setAIStage('queued');
    try { await queueDocument(aiDocumentId); }
    catch (error) {
      setAIStage('failed');
      setAIError(error instanceof Error ? error.message : 'Não foi possível reprocessar o documento.');
    }
  }

  async function run(task: () => Promise<string>) {
    setSubmitting(true);
    try {
      const message = await task();
      await onRefresh();
      notify('Registro concluído', { description: message, variant: 'success' });
      setKind(null);
    } catch (err) {
      notify('Não foi possível concluir', {
        description: err instanceof Error ? err.message : 'Erro inesperado.',
        variant: 'error',
      });
    } finally {
      setSubmitting(false);
    }
  }

  /*
    Um aditivo em vigor que altera valor ou prazo sem data de efeito não pode
    ser aplicado — o produto passaria a exibir "valor vigente: não apurado".
    Avisar aqui, antes de salvar, evita que o usuário descubra isso depois
    olhando um indicador vazio e sem explicação.
  */
  const declaresEffect = valueMode !== 'none' || termMode !== 'none';
  const inForce = status === 'signed' || status === 'active';
  const effectWithoutDate = declaresEffect && inForce && !effectiveDate;

  const amendmentBlocked =
    !number.trim()
    || (valueMode !== 'none' && parseAmount(valueAmount) === null)
    || (termMode === 'newDate' && !newEndDate)
    || (termMode === 'extension' && !Number(extensionDays));

  const submitAmendment = () =>
    run(async () => {
      const amount = parseAmount(valueAmount);
      await createContractAmendment({
        contractId,
        amendmentNumber: number.trim(),
        title: title.trim() || null,
        status: status as 'draft' | 'signed' | 'active' | 'cancelled',
        signedDate: signedDate || null,
        effectiveDate: effectiveDate || null,
        valueDelta: valueMode === 'delta' ? amount : null,
        valueAbsolute: valueMode === 'absolute' ? amount : null,
        newEndDate: termMode === 'newDate' ? newEndDate : null,
        termExtensionDays: termMode === 'extension' ? Number(extensionDays) : null,
        scopeChange: scopeChange.trim() || null,
        notes: notes.trim() || null,
        file,
      });
      return `Aditivo ${number.trim()} registrado. O contrato original permanece inalterado.`;
    });

  const submitReplace = () =>
    run(async () => {
      if (!target || !file) throw new Error('Selecione o arquivo da nova versão.');
      const { supersededProposals } = await replaceContractDocument(
        contractId, target.id, file, newTitle.trim() || file.name,
      );
      return supersededProposals > 0
        ? `Nova versão registrada. ${supersededProposals} proposta(s) do documento anterior saíram da fila.`
        : 'Nova versão registrada. A versão anterior continua acessível.';
    });

  const textareaClass =
    'w-full rounded-lg border hud-input-bg hud-text p-3 text-sm leading-relaxed focus:border-ig-border-focus focus:outline-none';

  const radio = (name: string, checked: boolean, onChange: () => void, label: string, hint?: string) => (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-ig-border-subtle bg-ig-panel/45 px-3 py-2">
      <input type="radio" name={name} checked={checked} onChange={onChange}
             className="mt-0.5 h-4 w-4 accent-[var(--ig-accent)]" />
      <span className="min-w-0">
        <span className="block text-ig-body-sm font-medium text-ig-fg-strong">{label}</span>
        {hint && <span className="mt-0.5 block text-ig-caption text-ig-fg-muted">{hint}</span>}
      </span>
    </label>
  );

  const modals = (
    <HudModal
      isOpen={kind !== null}
      onClose={close}
      size={kind === 'amendment' && amendmentMode === 'manual' ? 'lg' : 'md'}
      title={kind === 'amendment' ? 'Adicionar aditivo' : 'Substituir documento'}
      footer={
        <>
          <HudButton variant="ghost" size="sm" onClick={close} disabled={submitting}>
            {kind === 'amendment' && ['completed', 'requires_attention', 'failed'].includes(aiStage)
              ? 'Fechar' : 'Cancelar'}
          </HudButton>
          {kind === 'amendment' && amendmentMode === 'manual' ? (
            <HudButton variant="primary" size="sm" isLoading={submitting}
                       disabled={amendmentBlocked} onClick={submitAmendment}>
              Registrar aditivo
            </HudButton>
          ) : kind === 'amendment' && aiStage === 'failed' && aiDocumentId ? (
            <HudButton variant="primary" size="sm" onClick={() => void retryAI()}>
              Tentar novamente
            </HudButton>
          ) : (
            kind === 'replaceDoc' && <HudButton variant="primary" size="sm" isLoading={submitting}
                       disabled={!file} onClick={submitReplace}>
              Registrar nova versão
            </HudButton>
          )}
        </>
      }
    >
      {kind === 'amendment' && amendmentMode === 'ai' && (
        <AmendmentAIOnboarding
          stage={aiStage}
          file={file}
          error={aiError}
          result={aiResult}
          onFile={(selected) => void handleAIFile(selected)}
          onManual={() => setAmendmentMode('manual')}
        />
      )}

      {kind === 'amendment' && amendmentMode === 'manual' && (
        <div className="space-y-5">
          <button type="button" onClick={() => setAmendmentMode('ai')}
                  className="text-ig-caption font-semibold text-ig-accent hover:underline">
            ← Voltar para leitura do PDF pelo Apex
          </button>
          <div className="grid gap-3 md:grid-cols-2">
            <HudInput label="Número do aditivo" value={number} onChange={(e) => setNumber(e.target.value)}
                      placeholder="Ex.: 1º Termo Aditivo" />
            <HudInput label="Título" value={title} onChange={(e) => setTitle(e.target.value)}
                      placeholder="Ex.: Prorrogação e reajuste" />
            <HudInput label="Data de assinatura" type="date" value={signedDate}
                      onChange={(e) => setSignedDate(e.target.value)} />
            <HudInput label="Data de efeito" type="date" value={effectiveDate}
                      onChange={(e) => setEffectiveDate(e.target.value)} />
            <div className="md:col-span-2">
              <HudSelect label="Situação" value={status} onChange={setStatus} options={STATUS_OPTIONS} />
            </div>
          </div>

          {effectWithoutDate && (
            <p className="rounded-lg border border-[color-mix(in_oklab,var(--ig-warning)_34%,transparent)] bg-[color-mix(in_oklab,var(--ig-warning)_10%,transparent)] p-3 text-ig-caption text-ig-fg-muted">
              Este aditivo está em vigor e altera valor ou prazo, mas não tem data de efeito.
              Sem ela não é possível ordená-lo contra os demais, e o contrato passará a exibir
              o valor ou o prazo vigente como <strong>não apurado</strong> — em vez de um número
              calculado em ordem arbitrária.
            </p>
          )}

          <div>
            <p className="mb-2 text-ig-label text-ig-fg-muted">Efeito sobre o valor</p>
            <div className="space-y-2">
              {radio('valueMode', valueMode === 'none', () => setValueMode('none'), 'Não altera o valor')}
              {radio('valueMode', valueMode === 'delta', () => setValueMode('delta'),
                     'Acréscimo ou supressão', 'O papel diz "fica acrescido de". Use negativo para supressão.')}
              {radio('valueMode', valueMode === 'absolute', () => setValueMode('absolute'),
                     'Novo valor total', 'O papel diz "o valor passa a ser". Substitui o total, não soma.')}
            </div>
            {valueMode !== 'none' && (
              <div className="mt-3">
                <HudInput
                  label={valueMode === 'delta' ? 'Acréscimo (R$)' : 'Novo valor total (R$)'}
                  value={valueAmount} onChange={(e) => setValueAmount(e.target.value)}
                  placeholder="0,00" inputMode="decimal"
                />
              </div>
            )}
          </div>

          <div>
            <p className="mb-2 text-ig-label text-ig-fg-muted">Efeito sobre o prazo</p>
            <div className="space-y-2">
              {radio('termMode', termMode === 'none', () => setTermMode('none'), 'Não altera o prazo')}
              {radio('termMode', termMode === 'newDate', () => setTermMode('newDate'), 'Nova data de término')}
              {radio('termMode', termMode === 'extension', () => setTermMode('extension'),
                     'Prorrogação em dias', 'Somada à vigência corrente.')}
            </div>
            {termMode === 'newDate' && (
              <div className="mt-3">
                <HudInput label="Vigência até" type="date" value={newEndDate}
                          onChange={(e) => setNewEndDate(e.target.value)} />
              </div>
            )}
            {termMode === 'extension' && (
              <div className="mt-3">
                <HudInput label="Dias de prorrogação" type="number" value={extensionDays}
                          onChange={(e) => setExtensionDays(e.target.value)} placeholder="365" />
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-medium uppercase tracking-wider hud-label">Alteração de escopo</label>
            <textarea className={textareaClass} rows={2} value={scopeChange}
                      onChange={(e) => setScopeChange(e.target.value)}
                      placeholder="O que muda no objeto contratado" />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-medium uppercase tracking-wider hud-label">Observações</label>
            <textarea className={textareaClass} rows={2} value={notes}
                      onChange={(e) => setNotes(e.target.value)} />
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider hud-label">
              PDF do aditivo
            </label>
            <Input type="file" accept=".pdf,.doc,.docx"
                   onChange={(e) => setFile(e.target.files?.[0] || null)}
                   className="border-ig-border-strong bg-ig-panel text-ig-fg-strong file:text-ig-fg-strong" />
            <p className="mt-1.5 text-ig-caption text-ig-fg-muted">
              Anexado como documento do tipo <em>aditivo</em>, e analisável pela leitura assistida
              como qualquer outro documento do contrato.
            </p>
          </div>

          <p className="rounded-lg border border-ig-border-subtle bg-ig-panel/45 p-3 text-ig-caption text-ig-fg-muted">
            O valor e o prazo do contrato original <strong>não são alterados</strong>. Eles continuam
            registrados como o contrato dizia, e o estado vigente passa a ser derivado dos efeitos
            declarados aqui — de modo que original, aditivo e vigente permaneçam distinguíveis.
          </p>
        </div>
      )}

      {kind === 'replaceDoc' && (
        <div className="space-y-4">
          <div className="rounded-lg border border-ig-border-subtle bg-ig-panel/55 p-3">
            <p className="text-ig-label text-ig-fg-muted">Documento a substituir</p>
            <p className="mt-1 truncate text-ig-body-sm font-semibold text-ig-fg-strong">
              {target?.title}
            </p>
            <p className="mt-0.5 text-ig-caption text-ig-fg-muted">
              versão {target?.version ?? 1} · permanecerá acessível como versão anterior
            </p>
          </div>

          <HudInput label="Título da nova versão" value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="Deixe em branco para usar o nome do arquivo" />

          <div>
            <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider hud-label">
              Arquivo da nova versão
            </label>
            <Input type="file" accept=".pdf,.doc,.docx"
                   onChange={(e) => setFile(e.target.files?.[0] || null)}
                   className="border-ig-border-strong bg-ig-panel text-ig-fg-strong file:text-ig-fg-strong" />
          </div>

          <p className="rounded-lg border border-ig-border-subtle bg-ig-panel/45 p-3 text-ig-caption text-ig-fg-muted">
            A versão anterior <strong>não é apagada</strong>: ela continua legível e segue respondendo
            por qualquer cláusula já validada que tenha saído dela. As propostas de IA
            <em> ainda pendentes</em> do documento anterior saem da fila, porque foram lidas de um
            papel que deixou de ser o vigente.
          </p>
        </div>
      )}
    </HudModal>
  );

  return {
    openAmendment: resetAmendment,
    openReplaceDocument: (doc) => {
      setTarget(doc);
      setNewTitle('');
      setFile(null);
      setKind('replaceDoc');
    },
    modals,
  };
}

const STAGE_ORDER: AIStage[] = ['queued', 'reading', 'comparing', 'structuring', 'completed'];
const STAGE_LABEL: Record<AIStage, string> = {
  idle: 'Aguardando documento', uploading: 'Enviando documento', queued: 'Documento recebido',
  reading: 'Lendo o aditivo', comparing: 'Comparando com o histórico contratual',
  structuring: 'Estruturando alterações', completed: 'Concluído',
  requires_attention: 'Requer atenção', failed: 'Falhou',
};

function AmendmentAIOnboarding({
  stage, file, error, result, onFile, onManual,
}: {
  stage: AIStage;
  file: File | null;
  error: string | null;
  result: AIResult | null;
  onFile: (file: File) => void;
  onManual: () => void;
}) {
  const terminal = stage === 'completed' || stage === 'requires_attention';
  const currentIndex = STAGE_ORDER.indexOf(stage === 'requires_attention' ? 'completed' : stage);
  const formatDate = (value: string | null) => value
    ? new Date(`${value}T00:00:00`).toLocaleDateString('pt-BR') : 'Não identificada';

  if (terminal && result?.amendment) {
    const amendment = result.amendment;
    const effectiveness = deriveAmendmentEffectiveness({
      documentaryState: amendment.documentary_state,
      effectiveDate: amendment.effective_date,
      cancelled: amendment.status === 'cancelled',
    });
    const attention = result.effects.filter((effect) => effect.trust_state === 'requires_attention');
    const extraction = amendment.ai_extraction as {
      precedence_conflicts?: Array<{ description: string; page: number | null }>;
    } | null;
    const conflicts = extraction?.precedence_conflicts ?? [];
    const stateLabel = amendment.documentary_state === 'signed' ? 'Assinado'
      : amendment.documentary_state === 'draft' ? 'Rascunho' : 'Não identificado';
    const effectivenessLabel = {
      effective: 'Em vigor', not_yet_effective: 'Efeito futuro', indeterminate: 'Indeterminada',
      superseded: 'Superado', cancelled: 'Cancelado',
    }[effectiveness];
    return (
      <div className="space-y-4" data-testid="amendment-ai-result">
        <div className="flex items-start gap-3 rounded-lg border border-ig-border-strong bg-ig-panel/55 p-3">
          {stage === 'completed'
            ? <Check className="mt-0.5 h-5 w-5 text-ig-success" aria-hidden />
            : <AlertTriangle className="mt-0.5 h-5 w-5 text-ig-warning" aria-hidden />}
          <div>
            <p className="text-ig-body-sm font-semibold text-ig-fg-strong">{amendment.amendment_number}</p>
            <p className="text-ig-caption text-ig-fg-muted">{amendment.title ?? 'Título documental não identificado'}</p>
            {amendment.apex_summary && <p className="mt-1 text-ig-caption text-ig-fg-muted">{amendment.apex_summary}</p>}
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-ig-border-subtle p-3 text-ig-caption">
          <div><dt className="text-ig-fg-subtle">Assinado em</dt><dd className="font-semibold text-ig-fg-strong">{formatDate(amendment.signed_date)}</dd></div>
          <div><dt className="text-ig-fg-subtle">Produz efeito em</dt><dd className="font-semibold text-ig-fg-strong">{formatDate(amendment.effective_date)}</dd></div>
          <div><dt className="text-ig-fg-subtle">Estado documental</dt><dd className="font-semibold text-ig-fg-strong">{stateLabel}</dd></div>
          <div><dt className="text-ig-fg-subtle">Eficácia</dt><dd className="font-semibold text-ig-fg-strong">{effectivenessLabel}</dd></div>
        </dl>

        <section>
          <p className="mb-2 text-ig-label text-ig-fg-muted">Alterações identificadas</p>
          <div className="space-y-2">
            {result.effects.map((effect) => (
              <div key={effect.id} className="rounded-lg border border-ig-border-subtle bg-ig-panel/40 p-3">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-ig-body-sm font-semibold text-ig-fg-strong">{effect.title}</p>
                  <span className="text-ig-label text-ig-fg-subtle">{effect.operation}</span>
                </div>
                <p className="mt-1 text-ig-caption text-ig-fg-muted">{effect.description}</p>
                <p className="mt-1 text-ig-label text-ig-fg-subtle">
                  {effect.source_page ? `Fonte: pág. ${effect.source_page}` : 'Fonte não localizada'}
                  {effect.currently_effective ? ' · vigente' : ''}
                </p>
              </div>
            ))}
            {result.effects.length === 0 && (
              <p className="text-ig-caption text-ig-fg-muted">Nenhuma alteração pôde ser estruturada com segurança.</p>
            )}
          </div>
        </section>

        {(attention.length > 0 || conflicts.length > 0) && (
          <section className="rounded-lg border border-[color-mix(in_oklab,var(--ig-warning)_35%,transparent)] bg-[color-mix(in_oklab,var(--ig-warning)_8%,transparent)] p-3">
            <p className="text-ig-body-sm font-semibold text-ig-fg-strong">
              {attention.length + conflicts.length} ponto(s) requer(em) sua atenção
            </p>
            <div className="mt-2 space-y-2">
              {attention.map((effect) => (
                <div key={effect.id} className="flex gap-2 text-ig-caption text-ig-fg-muted">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ig-warning" aria-hidden />
                  <span><strong>{effect.title}.</strong> {effect.trust_reasons.join(', ') || 'A evidência não permite aplicação automática.'}</span>
                </div>
              ))}
              {conflicts.map((conflict, index) => (
                <div key={`${conflict.description}-${index}`} className="flex gap-2 text-ig-caption text-ig-fg-muted">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ig-warning" aria-hidden />
                  <span><strong>Precedência ambígua.</strong> {conflict.description}{conflict.page ? ` (pág. ${conflict.page})` : ''}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    );
  }

  if (stage === 'idle') {
    return (
      <div className="space-y-3">
        <label
          className="flex min-h-52 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-ig-border-strong bg-ig-panel/35 p-8 text-center transition-colors hover:bg-ig-panel-hover/45"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => { event.preventDefault(); const selected = event.dataTransfer.files[0]; if (selected) onFile(selected); }}
        >
          <UploadCloud className="mb-3 h-8 w-8 text-ig-accent" aria-hidden />
          <span className="text-ig-body-sm font-semibold text-ig-fg-strong">Solte o PDF do aditivo aqui</span>
          <span className="mt-1 text-ig-caption text-ig-fg-muted">ou selecione o documento</span>
          <Input type="file" accept="application/pdf,.pdf" className="sr-only"
                 onChange={(event) => { const selected = event.target.files?.[0]; if (selected) onFile(selected); }} />
        </label>
        <button type="button" onClick={onManual}
                className="w-full text-center text-ig-caption text-ig-fg-muted hover:text-ig-fg-strong">
          Registrar manualmente
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4" aria-live="polite" data-testid="amendment-ai-progress">
      <div className="flex items-center gap-3 rounded-lg border border-ig-border-subtle bg-ig-panel/45 p-3">
        <FileText className="h-5 w-5 text-ig-accent" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-ig-body-sm font-semibold text-ig-fg-strong">{file?.name ?? 'PDF do aditivo'}</p>
          <p className="text-ig-caption text-ig-fg-muted">O original já registrado permanece como verdade documental.</p>
        </div>
      </div>
      <div>
        <div className="flex items-center gap-2">
          {stage === 'failed' ? <AlertTriangle className="h-4 w-4 text-ig-warning" />
            : <LoaderCircle className="h-4 w-4 animate-spin text-ig-accent" />}
          <p className="text-ig-body-sm font-semibold text-ig-fg-strong">
            {stage === 'failed' ? 'A análise não foi concluída' : `Apex está ${STAGE_LABEL[stage].toLowerCase()}`}
          </p>
        </div>
        <ol className="mt-3 space-y-2">
          {(['queued', 'reading', 'comparing', 'structuring'] as AIStage[]).map((item, index) => {
            const done = currentIndex > index;
            const active = currentIndex === index;
            return (
              <li key={item} className="flex items-center gap-2 text-ig-caption text-ig-fg-muted">
                {done ? <Check className="h-3.5 w-3.5 text-ig-success" />
                  : active ? <LoaderCircle className="h-3.5 w-3.5 animate-spin text-ig-accent" />
                    : <span className="h-3.5 w-3.5 rounded-full border border-ig-border-strong" />}
                {STAGE_LABEL[item]}
              </li>
            );
          })}
        </ol>
      </div>
      {error && <p className="rounded-lg border border-ig-border-subtle p-3 text-ig-caption text-ig-warning">{error}</p>}
    </div>
  );
}
