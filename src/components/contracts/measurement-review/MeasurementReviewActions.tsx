'use client';

/**
 * AS DECISÕES DA GESTÃO DE CONTRATOS sobre uma medição.
 *
 * ─── A regra que os formulários abaixo codificam ────────────────────────────
 *
 *   TODA DECISÃO NEGATIVA EXIGE MOTIVO, E CORREÇÃO EXIGE ITENS.
 *
 * Um campo de texto livre atende o motivo e some com os itens: "faltou o
 * relatório e a assinatura da página 3" vira uma frase que ninguém consegue
 * marcar como resolvida. O banco recusa lista vazia; o formulário recusa antes,
 * para que a pessoa descubra na hora e não depois do clique.
 *
 * ─── O aceite ──────────────────────────────────────────────────────────────
 *
 * Não existe botão "Aceitar". Existe REGISTRAR ACEITE DA CONTRATANTE, e ele
 * exige de onde o aceite veio e o que o comprova. O sistema representa
 * "usuário X registrou que a contratante Y aceitou" — nunca "X aceitou".
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { HudButton, HudInput, HudModal, HudSelect, useHudToast } from '@/components/hud';
import {
  MeasurementError, acceptMeasurement, approveMeasurementForCustomer,
  recordCustomerCorrection, rejectMeasurement, requestMeasurementCorrection,
  sendMeasurementToCustomer, startContractReview,
  type CorrectionItemInput,
} from '@/lib/projects/measurements/measurement-service';
import {
  ACCEPTANCE_SOURCE_LABEL, CORRECTION_CATEGORY_LABEL, DISPATCH_CHANNEL_LABEL,
  REQUIREMENT_KIND_LABEL, type AcceptanceSource, type CorrectionCategory,
  type DispatchChannel, type RequirementKind,
} from '@/lib/projects/measurements/types';
import {
  listMeasurementDocuments, type QueueDocument, type ReviewAction, type ReviewQueueItem,
} from '@/lib/projects/measurements/review-queue';

/** O aviso do handoff. Falha aqui NÃO desfaz a decisão já registrada. */
async function announce(measurementId: string, event: string, reason?: string | null) {
  try {
    await fetch(`/api/projects/measurements/${measurementId}/handoff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, reason: reason ?? null }),
    });
  } catch { /* o fato é durável; o aviso é reentregável pelo cron de SLA */ }
}

const CATEGORIES = Object.keys(CORRECTION_CATEGORY_LABEL) as CorrectionCategory[];
const KINDS = Object.keys(REQUIREMENT_KIND_LABEL) as RequirementKind[];
const CHANNELS = Object.keys(DISPATCH_CHANNEL_LABEL) as DispatchChannel[];

/**
 * As fontes de aceite que a Contratante pode ter usado.
 *
 * `internal_reviewer` e `approval_engine` ficam de fora DE PROPÓSITO: este
 * formulário registra o aceite de quem está do outro lado do contrato, e
 * oferecer "revisor interno" aqui seria o caminho mais curto para o produto
 * fingir aceite do cliente.
 */
const CUSTOMER_ACCEPTANCE_SOURCES: readonly AcceptanceSource[] =
  ['signed_bulletin', 'external_document', 'customer_portal', 'integration'];

function CorrectionItemsEditor({
  items, onChange,
}: {
  readonly items: readonly CorrectionItemInput[];
  readonly onChange: (next: readonly CorrectionItemInput[]) => void;
}) {
  return (
    <div className="space-y-2">
      {items.map((it, idx) => (
        <div key={idx} className="flex items-start gap-2">
          <div className="flex-1 space-y-1">
            <HudInput
              size="sm"
              placeholder="O que precisa ser corrigido"
              value={it.item}
              onChange={(e) => onChange(items.map((x, i) =>
                (i === idx ? { ...x, item: e.target.value } : x)))}
            />
            <div className="flex gap-2">
              <HudSelect
                size="sm"
                value={it.category ?? 'documental'}
                options={CATEGORIES.map((c) => ({ value: c, label: CORRECTION_CATEGORY_LABEL[c] }))}
                onChange={(v) => onChange(items.map((x, i) =>
                  (i === idx ? { ...x, category: v as CorrectionCategory } : x)))}
              />
              <HudSelect
                size="sm"
                value={it.requirementKind ?? ''}
                options={[
                  { value: '', label: 'Sem exigência vinculada' },
                  ...KINDS.map((k) => ({ value: k, label: REQUIREMENT_KIND_LABEL[k] })),
                ]}
                onChange={(v) => onChange(items.map((x, i) =>
                  (i === idx ? { ...x, requirementKind: (v || null) as RequirementKind | null } : x)))}
              />
            </div>
          </div>
          {items.length > 1 && (
            <button
              type="button"
              aria-label="Remover item"
              className="mt-1 text-ig-fg-subtle hover:text-ig-danger"
              onClick={() => onChange(items.filter((_, i) => i !== idx))}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      ))}
      <HudButton
        variant="ghost"
        size="sm"
        leftIcon={<Plus className="h-4 w-4" />}
        onClick={() => onChange([...items, { item: '', category: 'documental' }])}
      >
        Acrescentar item
      </HudButton>
    </div>
  );
}

export function MeasurementReviewActionModal({
  item, action, onClose, onDone,
}: {
  readonly item: ReviewQueueItem;
  readonly action: ReviewAction | null;
  readonly onClose: () => void;
  readonly onDone: () => void;
}) {
  const { notify } = useHudToast();
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [items, setItems] = useState<readonly CorrectionItemInput[]>([
    { item: '', category: 'documental' },
  ]);
  const [channel, setChannel] = useState<DispatchChannel>('email');
  const [contact, setContact] = useState('');
  const [reference, setReference] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [selectedDocs, setSelectedDocs] = useState<readonly string[]>([]);
  const [docs, setDocs] = useState<readonly QueueDocument[]>([]);
  const [source, setSource] = useState<AcceptanceSource>('signed_bulletin');
  const [acceptedValue, setAcceptedValue] = useState('');

  useEffect(() => {
    if (action !== 'send_to_customer') return;
    let alive = true;
    void listMeasurementDocuments(item.measurementId, item.milestoneId)
      .then((d) => { if (alive) { setDocs(d); setSelectedDocs(d.map((x) => x.documentId)); } })
      .catch(() => { if (alive) setDocs([]); });
    return () => { alive = false; };
  }, [action, item.measurementId, item.milestoneId]);

  const run = useCallback(async () => {
    if (!action) return;
    setBusy(true);
    try {
      const clean = items.map((i) => ({ ...i, item: i.item.trim() })).filter((i) => i.item !== '');
      switch (action) {
        case 'start_review':
          await startContractReview(item.measurementId, note || undefined);
          notify('Análise contratual iniciada', { variant: 'success' });
          break;
        case 'request_correction':
          if (clean.length === 0) throw new MeasurementError('CORRECTION_ITEMS_REQUIRED',
            'Informe pelo menos um item a corrigir.');
          await requestMeasurementCorrection(item.measurementId, reason, clean);
          await announce(item.measurementId, 'measurement.correction_requested', reason);
          notify('Correção solicitada ao projeto', {
            description: 'O mesmo item voltou ao projeto com a lista exata de correções.',
            variant: 'success',
          });
          break;
        case 'approve_for_customer':
          await approveMeasurementForCustomer(item.measurementId, note || undefined);
          await announce(item.measurementId, 'measurement.approved_for_customer');
          notify('Pacote aprovado para envio ao cliente', {
            description: 'Isso significa que o pacote interno está pronto. Não é aceite da contratante.',
            variant: 'success',
          });
          break;
        case 'send_to_customer':
          await sendMeasurementToCustomer({
            measurementId: item.measurementId,
            channel,
            customerContact: contact || null,
            externalReference: reference || null,
            dueAt: dueAt || null,
            documentIds: selectedDocs,
            note: note || null,
          });
          await announce(item.measurementId, 'measurement.sent_to_customer');
          notify('Pacote enviado para aceite da contratante', {
            description: 'A remessa foi registrada com destinatário, referência e documentos.',
            variant: 'success',
          });
          break;
        case 'record_acceptance':
          await acceptMeasurement({
            measurementId: item.measurementId,
            source,
            acceptedValue: acceptedValue ? Number(acceptedValue) : null,
            acceptedCurrency: acceptedValue ? (item.currency ?? 'BRL') : null,
            externalReference: reference || null,
            note: note || null,
          });
          await announce(item.measurementId, 'measurement.accepted');
          notify('Aceite da contratante registrado', {
            description: 'Registrado como “você registrou que a contratante aceitou”, com a comprovação informada.',
            variant: 'success',
          });
          break;
        case 'record_customer_correction':
          await recordCustomerCorrection(item.measurementId, reason, clean, reference || null);
          await announce(item.measurementId, 'measurement.customer_correction_requested', reason);
          notify('Correção pedida pela contratante registrada', {
            description: 'Projeto e Contratos foram avisados.',
            variant: 'success',
          });
          break;
        case 'reject':
          await rejectMeasurement(item.measurementId, reason);
          notify('Medição rejeitada', {
            description: 'Rejeitar não é devolver: o pacote só volta por supersessão governada.',
            variant: 'warning',
          });
          break;
      }
      onDone();
      onClose();
    } catch (e) {
      notify('A decisão não foi registrada', {
        description: e instanceof MeasurementError ? e.message : String(e),
        variant: 'error',
      });
    } finally {
      setBusy(false);
    }
  }, [action, acceptedValue, channel, contact, dueAt, item, items, note, notify, onClose,
    onDone, reason, reference, selectedDocs, source]);

  if (!action) return null;

  const needsReason = action === 'request_correction' || action === 'reject'
    || action === 'record_customer_correction';
  const needsItems = action === 'request_correction' || action === 'record_customer_correction';

  const TITLES: Record<ReviewAction, string> = {
    start_review: 'Iniciar análise contratual',
    request_correction: 'Solicitar correção ao projeto',
    approve_for_customer: 'Aprovar para envio ao cliente',
    send_to_customer: 'Enviar para aceite da contratante',
    record_acceptance: 'Registrar aceite da contratante',
    record_customer_correction: 'Registrar correção pedida pela contratante',
    reject: 'Rejeitar medição',
  };

  const disabled = busy
    || (needsReason && reason.trim() === '')
    || (action === 'request_correction' && items.every((i) => i.item.trim() === ''))
    || (action === 'send_to_customer' && contact.trim() === '' && reference.trim() === '');

  return (
    <HudModal
      isOpen
      onClose={onClose}
      title={TITLES[action]}
      subtitle={`${item.milestoneTitle ?? 'Evento contratual'} · ${item.contractNumber ?? item.projectCode ?? ''}`}
      size="lg"
      footer={(
        <div className="flex justify-end gap-2">
          <HudButton variant="ghost" size="sm" onClick={onClose}>Cancelar</HudButton>
          <HudButton
            variant={action === 'reject' ? 'danger' : 'primary'}
            size="sm"
            isLoading={busy}
            disabled={disabled}
            onClick={() => void run()}
          >
            Confirmar
          </HudButton>
        </div>
      )}
    >
      <div className="space-y-3 text-[13px]">
        {action === 'approve_for_customer' && (
          <p className="rounded border border-ig-warning/30 bg-ig-warning/5 px-2 py-1.5 text-[12px] text-ig-warning">
            Aprovar para envio significa que o pacote interno está pronto. <strong>Não é aceite
            da contratante</strong> e não libera faturamento.
          </p>
        )}

        {action === 'record_acceptance' && (
          <p className="rounded border border-ig-accent/30 bg-ig-accent/5 px-2 py-1.5 text-[12px] text-ig-fg">
            Você está registrando que <strong>a contratante aceitou</strong> — não aceitando em nome
            dela. Informe de onde veio o aceite e o que o comprova.
          </p>
        )}

        {needsReason && (
          <label className="block">
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-ig-fg-muted">
              Motivo {action === 'reject' ? '(obrigatório)' : '(obrigatório)'}
            </span>
            <textarea
              className="hud-input-bg w-full rounded border border-ig-border-subtle px-2 py-1.5 text-[13px]"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={action === 'reject'
                ? 'Por que a medição está sendo rejeitada'
                : 'O que motivou o pedido de correção'}
            />
          </label>
        )}

        {needsItems && (
          <div>
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-ig-fg-muted">
              Itens a corrigir {action === 'request_correction' ? '(obrigatório)' : '(quando conhecidos)'}
            </span>
            <CorrectionItemsEditor items={items} onChange={setItems} />
          </div>
        )}

        {action === 'send_to_customer' && (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              <HudSelect
                label="Canal"
                size="sm"
                value={channel}
                options={CHANNELS.map((c) => ({ value: c, label: DISPATCH_CHANNEL_LABEL[c] }))}
                onChange={(v) => setChannel(v as DispatchChannel)}
              />
              <HudInput
                label="Prazo acordado (opcional)"
                size="sm"
                type="date"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
              />
              <HudInput
                label="Contato / aprovador da contratante"
                size="sm"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder="nome ou e-mail, quando conhecido"
              />
              <HudInput
                label="Referência da comunicação"
                size="sm"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="protocolo, nº do e-mail, ofício"
              />
            </div>
            <p className="text-[11px] text-ig-fg-subtle">
              Informe o contato <em>ou</em> a referência. Sem um dos dois, “enviado ao cliente”
              seria afirmação sem lastro — e é sobre ela que uma cobrança de atraso viraria
              palavra contra palavra.
            </p>
            <div>
              <span className="mb-1 block text-[11px] uppercase tracking-wide text-ig-fg-muted">
                Documentos enviados
              </span>
              {docs.length === 0 ? (
                <p className="text-[12px] text-ig-fg-subtle">
                  Nenhum documento vinculado a esta medição ou a este marco.
                </p>
              ) : (
                <ul className="max-h-40 space-y-1 overflow-y-auto">
                  {docs.map((d) => (
                    <li key={d.documentId} className="flex items-center gap-2 text-[12px]">
                      <input
                        type="checkbox"
                        checked={selectedDocs.includes(d.documentId)}
                        onChange={(e) => setSelectedDocs(e.target.checked
                          ? [...selectedDocs, d.documentId]
                          : selectedDocs.filter((x) => x !== d.documentId))}
                      />
                      <span className="truncate">{d.fileName}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}

        {action === 'record_acceptance' && (
          <div className="grid gap-2 sm:grid-cols-2">
            <HudSelect
              label="De onde veio o aceite"
              size="sm"
              value={source}
              options={CUSTOMER_ACCEPTANCE_SOURCES.map((x) => ({
                value: x, label: ACCEPTANCE_SOURCE_LABEL[x],
              }))}
              onChange={(v) => setSource(v as AcceptanceSource)}
            />
            <HudInput
              label="Protocolo / referência do aceite"
              size="sm"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="nº do BM assinado, e-mail, protocolo"
            />
            {item.canViewValues && (
              <HudInput
                label={`Valor aceito (${item.currency ?? 'BRL'}) — opcional`}
                size="sm"
                inputMode="decimal"
                value={acceptedValue}
                onChange={(e) => setAcceptedValue(e.target.value)}
                placeholder="em branco = o valor submetido"
              />
            )}
          </div>
        )}

        {action === 'record_customer_correction' && (
          <HudInput
            label="Referência da comunicação da contratante"
            size="sm"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="e-mail, protocolo, ata"
          />
        )}

        <label className="block">
          <span className="mb-1 block text-[11px] uppercase tracking-wide text-ig-fg-muted">
            Observação (opcional)
          </span>
          <textarea
            className="hud-input-bg w-full rounded border border-ig-border-subtle px-2 py-1.5 text-[13px]"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
      </div>
    </HudModal>
  );
}
