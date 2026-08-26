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
import { useHudToast } from '@/hooks/useHudToast';
import {
  createContractAmendment,
  replaceContractDocument,
  type ContractDocumentRow,
} from '@/lib/contracts/contract-service';

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
    setKind('amendment');
  };

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
      size={kind === 'amendment' ? 'lg' : 'md'}
      title={kind === 'amendment' ? 'Adicionar aditivo contratual' : 'Substituir documento'}
      footer={
        <>
          <HudButton variant="ghost" size="sm" onClick={close} disabled={submitting}>Cancelar</HudButton>
          {kind === 'amendment' ? (
            <HudButton variant="primary" size="sm" isLoading={submitting}
                       disabled={amendmentBlocked} onClick={submitAmendment}>
              Registrar aditivo
            </HudButton>
          ) : (
            <HudButton variant="primary" size="sm" isLoading={submitting}
                       disabled={!file} onClick={submitReplace}>
              Registrar nova versão
            </HudButton>
          )}
        </>
      }
    >
      {kind === 'amendment' && (
        <div className="space-y-5">
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
            <p className="mb-2 text-ig-label uppercase tracking-[0.14em] text-ig-fg-muted">Efeito sobre o valor</p>
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
            <p className="mb-2 text-ig-label uppercase tracking-[0.14em] text-ig-fg-muted">Efeito sobre o prazo</p>
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
