'use client';

/**
 * Edição dos dados cadastrais do contrato.
 *
 * ─── O que esta tela É ────────────────────────────────────────────────────
 *
 * A correção do CADASTRO: título, número, contraparte, tipo, vigência, valores
 * e escopo. Até aqui, um contrato cadastrado com a data errada ou a contraparte
 * trocada só podia ser corrigido pelo banco — todas as ações do dossiê criavam
 * registros FILHOS (obrigação, faturamento, documento, aprovação) e nenhuma
 * editava a linha do próprio contrato.
 *
 * ─── O que esta tela NÃO É ────────────────────────────────────────────────
 *
 * Não classifica origem (`dataClass`): promover um fixture a contrato
 * operacional muda o que a diretoria vê somado, e isso exige justificativa e
 * trilha própria — é o que "Classificar origem" faz, via `reclassifyContract`.
 *
 * Não decide alçada. Mudar `status` aqui corrige um cadastro; aprovar ou
 * rejeitar continua sendo `submitContractApproval`, com autor e etapa.
 *
 * ─── Por que o PATCH é parcial ────────────────────────────────────────────
 *
 * `updateContract` grava apenas as chaves fornecidas. Esta tela envia SOMENTE
 * os campos que o usuário mudou (`diff` abaixo), então salvar um formulário
 * onde só o título foi tocado não reescreve as outras dezoito colunas com o que
 * estava na tela quando ela abriu — o que atropelaria uma alteração feita por
 * outra pessoa nesse intervalo.
 */

import { useCallback, useState } from 'react';
import { HudModal, HudButton, HudInput, HudSelect } from '@/components/hud';
import { useHudToast } from '@/hooks/useHudToast';
import { updateContract, type ContractDetail } from '@/lib/contracts/contract-service';
import { formFrom, diffContractEdit, isBadAmount, type EditForm } from '@/lib/contracts/contract-edit-form';
import { ClientLogoUploadSlot } from '@/components/portfolio/ClientLogoUploadSlot';

/**
 * Logo do cliente, editável junto do cadastro.
 *
 * A logo NÃO é uma coluna do contrato — mora em `projects.client_logo_url` e
 * já é essa a fonte que os cards e o cabeçalho do dossiê leem (P1A). Editar
 * aqui grava no mesmo lugar; `projectId` nulo (contrato sem vínculo) é o único
 * caso em que o upload fica indisponível, e a tela diz por quê em vez de
 * simplesmente esconder o botão.
 */
export interface ContractEditLogoProps {
  url: string | null;
  /** Nome exibido no `alt` — normalmente a contraparte. */
  alt: string;
  projectId: string | null;
  onUpload: (file: File | null) => Promise<string | null>;
}

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Rascunho' },
  { value: 'negotiation', label: 'Em negociação' },
  { value: 'legal_review', label: 'Revisão jurídica' },
  { value: 'commercial_review', label: 'Revisão comercial' },
  { value: 'signed', label: 'Assinado' },
  { value: 'active', label: 'Ativo' },
  { value: 'expiring_soon', label: 'Expirando' },
  { value: 'expired', label: 'Expirado' },
  { value: 'closed', label: 'Encerrado' },
  { value: 'cancelled', label: 'Cancelado' },
];

const RISK_OPTIONS = [
  { value: 'low', label: 'Baixo' },
  { value: 'medium', label: 'Médio' },
  { value: 'high', label: 'Alto' },
];

export function useContractEditModal({
  contract,
  logo,
  onRefresh,
}: {
  /** `null` enquanto o dossiê carrega — a ação fica inerte até o contrato chegar. */
  contract: ContractDetail['contract'] | null;
  /** Ausente = tela sem seção de logo (chamador que não resolveu projeto ainda). */
  logo?: ContractEditLogoProps;
  onRefresh: () => Promise<void> | void;
}): { open: () => void; modal: React.ReactNode } {
  const { notify } = useHudToast();
  const [isOpen, setIsOpen] = useState(false);
  const [initial, setInitial] = useState<EditForm>(() => formFrom(contract));
  const [form, setForm] = useState<EditForm>(() => formFrom(contract));
  const [submitting, setSubmitting] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(logo?.url ?? null);

  const open = () => {
    if (!contract) return;
    // A tela abre com o contrato COMO ESTÁ AGORA, não com o que foi carregado
    // quando a página montou.
    const snapshot = formFrom(contract);
    setInitial(snapshot);
    setForm(snapshot);
    setLogoUrl(logo?.url ?? null);
    setIsOpen(true);
  };

  /**
   * Upload é IMEDIATO, não parte do "Salvar alterações".
   *
   * A logo grava em `projects`, não em `contracts` — misturá-la no PATCH do
   * formulário faria o botão de salvar mentir sobre o que ele está prestes a
   * gravar, e faria "Cancelar" parecer que desfaz um upload que já aconteceu.
   * O padrão espelha o mesmo `handleLogoSelect` do Quick Dossier: preview
   * otimista via `ObjectURL`, e o resultado do upload substitui o preview.
   */
  const handleLogoSelect = useCallback(
    (file: File | null) => {
      if (!logo) return;
      const preview = file ? URL.createObjectURL(file) : null;
      setLogoUrl(preview);
      Promise.resolve(logo.onUpload(file))
        .then((url) => setLogoUrl(url))
        .catch(() => setLogoUrl(logo.url))
        .finally(() => {
          if (preview) URL.revokeObjectURL(preview);
        });
    },
    [logo],
  );

  const set = <K extends keyof EditForm>(key: K) => (value: EditForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const patch = diffContractEdit(initial, form);
  const changedCount = Object.keys(patch).length;
  const titleMissing = form.title.trim().length === 0;
  const badTotal = isBadAmount(form.totalValue);
  const badMonthly = isBadAmount(form.monthlyValue);
  const endBeforeStart =
    form.startDate.length > 0 && form.endDate.length > 0 && form.endDate < form.startDate;

  const blocked = titleMissing || badTotal || badMonthly || endBeforeStart;
  const canSubmit = changedCount > 0 && !blocked && !submitting;

  const submit = async () => {
    if (!canSubmit || !contract) return;
    setSubmitting(true);
    try {
      await updateContract(contract.id, patch);
      await onRefresh();
      notify('Contrato atualizado', {
        description: `${changedCount} ${changedCount === 1 ? 'campo gravado' : 'campos gravados'}. A alteração ficou na auditoria.`,
        variant: 'success',
      });
      setIsOpen(false);
    } catch (err) {
      notify('Não foi possível salvar', {
        description: err instanceof Error ? err.message : 'Erro inesperado.',
        variant: 'error',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const modal = !contract ? null : (
    <HudModal
      isOpen={isOpen}
      onClose={() => setIsOpen(false)}
      title="Editar contrato"
      subtitle="Corrige os dados cadastrais. Origem e alçada têm fluxo próprio."
      size="lg"
      footer={
        <div className="flex items-center justify-between gap-3">
          <p className="text-ig-caption text-ig-fg-muted">
            {changedCount === 0
              ? 'Nenhuma alteração ainda.'
              : `${changedCount} ${changedCount === 1 ? 'campo alterado' : 'campos alterados'} — só eles serão gravados.`}
          </p>
          <div className="flex gap-2">
            <HudButton variant="secondary" onClick={() => setIsOpen(false)}>Cancelar</HudButton>
            <HudButton variant="primary" disabled={!canSubmit} onClick={submit}>
              {submitting ? 'Salvando...' : 'Salvar alterações'}
            </HudButton>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {/*
          Logo ACIMA do título, de propósito: a identidade visual do contrato
          é, antes do nome, de quem ele é — o cliente. É a mesma leitura que os
          cards e o cabeçalho do dossiê já fazem com `ClientLogoBanner`.
        */}
        {logo && (
          <div>
            <ClientLogoUploadSlot
              size="lg"
              logoUrl={logoUrl}
              alt={logo.alt || 'Logo do cliente'}
              disabled={!logo.projectId}
              onSelect={handleLogoSelect}
            />
            {!logo.projectId && (
              <p className="mt-1.5 text-ig-caption leading-relaxed text-ig-fg-subtle">
                Vincule um projeto a este contrato para habilitar o upload — a logo fica
                gravada no projeto e aparece em todos os cards e dossiês que o citam.
              </p>
            )}
          </div>
        )}

        <HudInput
          label="Título do contrato"
          value={form.title}
          onChange={(e) => set('title')(e.target.value)}
          error={titleMissing ? 'O título é obrigatório.' : undefined}
        />

        {/*
          Dois campos, deliberadamente independentes.

          `contractNumber` é o número OFICIAL do contrato — o Apex já costuma
          extraí-lo do PDF assinado, então este campo chega preenchido na
          maioria dos casos. `osNumber` é a Ordem de Serviço: um número interno
          que a operação atribui DEPOIS, para acompanhar a execução, e que não
          tem relação necessária com o número do contrato (um contrato pode
          abrir mais de uma OS ao longo da vigência). Um campo só, editando os
          dois números como se fossem um, obrigava a escolher qual sobrescrever.
        */}
        <div className="grid gap-4 sm:grid-cols-2">
          <HudInput
            label="Número do contrato"
            value={form.contractNumber}
            onChange={(e) => set('contractNumber')(e.target.value)}
            placeholder="Extraído do PDF, quando houver"
          />
          <div>
            <HudInput
              label="Número da OS"
              value={form.osNumber}
              onChange={(e) => set('osNumber')(e.target.value)}
              placeholder="Atribuído pela operação"
            />
            {/*
              O código do cabeçalho do dossiê (ex.: CTR-04C0C6) prioriza a OS
              quando ela existe — é o identificador que a operação reconhece no
              dia a dia. Sem OS, cai para o número do contrato; sem nenhum dos
              dois, para um código gerado a partir do ID.
            */}
            <p className="mt-1.5 text-ig-caption leading-relaxed text-ig-fg-subtle">
              Aparece no cabeçalho do dossiê assim que preenchida. Sem ela, o
              código exibido usa o número do contrato ou um identificador gerado.
            </p>
          </div>
        </div>

        <HudInput
          label="Tipo"
          value={form.contractType}
          onChange={(e) => set('contractType')(e.target.value)}
          placeholder="Prestação de serviços"
        />

        <HudInput
          label="Contraparte"
          value={form.counterpartyName}
          onChange={(e) => set('counterpartyName')(e.target.value)}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <HudSelect label="Status" value={form.status} onChange={set('status')} options={STATUS_OPTIONS} />
          <HudSelect label="Risco" value={form.riskLevel} onChange={set('riskLevel')} options={RISK_OPTIONS} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <HudInput
            type="date"
            label="Início da vigência"
            value={form.startDate}
            onChange={(e) => set('startDate')(e.target.value)}
          />
          <HudInput
            type="date"
            label="Término da vigência"
            value={form.endDate}
            onChange={(e) => set('endDate')(e.target.value)}
            error={endBeforeStart ? 'O término não pode ser anterior ao início.' : undefined}
          />
          <HudInput
            type="date"
            label="Assinatura"
            value={form.signedDate}
            onChange={(e) => set('signedDate')(e.target.value)}
          />
          <HudInput
            type="date"
            label="Renovação"
            value={form.renewalDate}
            onChange={(e) => set('renewalDate')(e.target.value)}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <HudInput
            label="Valor contratado (BRL)"
            value={form.totalValue}
            onChange={(e) => set('totalValue')(e.target.value)}
            inputMode="decimal"
            placeholder="8000000"
            error={badTotal ? 'Informe um número.' : undefined}
          />
          <HudInput
            label="Valor mensal (BRL)"
            value={form.monthlyValue}
            onChange={(e) => set('monthlyValue')(e.target.value)}
            inputMode="decimal"
            error={badMonthly ? 'Informe um número.' : undefined}
          />
        </div>

        <HudInput
          label="Condições de pagamento"
          value={form.paymentTerms}
          onChange={(e) => set('paymentTerms')(e.target.value)}
          placeholder="30 dias após o aceite da medição"
        />

        <div>
          <label htmlFor="ig-contract-scope" className="mb-1.5 block text-ig-caption font-medium text-ig-fg-muted">
            Resumo do escopo
          </label>
          <textarea
            id="ig-contract-scope"
            rows={3}
            value={form.scopeSummary}
            onChange={(e) => set('scopeSummary')(e.target.value)}
            className="hud-input-bg hud-text w-full rounded-lg border p-3 text-sm leading-relaxed focus:border-ig-border-focus focus:outline-none"
          />
        </div>

        <p className="rounded-lg border border-ig-border-subtle bg-ig-panel/45 p-3 text-ig-caption text-ig-fg-muted">
          A classificação de origem e as decisões de alçada não se alteram aqui — cada uma tem
          sua ação, com justificativa e trilha próprias.
        </p>
      </div>
    </HudModal>
  );

  return { open, modal };
}
