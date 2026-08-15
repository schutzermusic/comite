'use client';

/**
 * Resumo de conferência de UM ASO, com o botão de confirmar.
 *
 * É a peça que tira o RH da fila separada: aparece logo depois do upload, com
 * tudo que foi lido do PDF e um link para o original ao lado — para que
 * confirmar seja comparar duas coisas na mesma tela, e não lembrar de um
 * documento visto dias antes.
 *
 * O QUE ESTE CARTÃO SE RECUSA A FAZER
 *
 * Não pré-marca nada, não tem "confirmar todos" escondido, e o botão some
 * quando a leitura tem impeditivo. Onde há ressalva leve, o texto do botão
 * MUDA — "Confirmar mesmo assim" — porque um clique que assume uma lacuna não
 * pode parecer igual a um clique que assume um documento completo.
 */

import { useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, Info, Loader2, Pencil } from 'lucide-react';
import { HudBadge, HudButton, HudPanel, HudStatusPill } from '@/components/hud';
import { ASO_KIND_FROM_DOCUMENT_LABEL } from '@/lib/workforce/aso-extractor';
import {
  ASO_DOCUMENT_STATUS_LABELS,
  ASO_ESOCIAL_STATUS_LABELS,
  ASO_RESULT_LABELS,
  ASO_VALIDITY_BASIS_LABELS,
} from '@/lib/workforce/aso-labels';
import type { AsoReviewSummary } from '@/lib/workforce/aso-summary';

const NA = '—';

function dateLabel(value: string | null): string {
  return value ? value.split('-').reverse().join('/') : NA;
}

function Field({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div title={hint}>
      <p className="text-[10px] uppercase tracking-wide text-ig-fg-muted">{label}</p>
      <p className="text-sm text-ig-fg-strong">{value}</p>
    </div>
  );
}

export function AsoReviewSummaryCard({
  summary,
  signedUrl,
  busy,
  onConfirm,
  onEdit,
  onReject,
}: {
  summary: AsoReviewSummary;
  signedUrl?: string | null;
  busy?: boolean;
  onConfirm: (acknowledge: boolean) => void;
  onEdit: () => void;
  onReject: () => void;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const { readiness } = summary;
  const basis = ASO_VALIDITY_BASIS_LABELS[summary.validityBasis];
  const esocial = ASO_ESOCIAL_STATUS_LABELS[summary.esocialMatchStatus];
  const status = ASO_DOCUMENT_STATUS_LABELS[summary.documentStatus];

  const confirmDisabled =
    busy || !readiness.eligibleForConfirmation || (readiness.requiresAcknowledgement && !acknowledged);

  return (
    <HudPanel
      elevation={1}
      state={readiness.blockers.length > 0 ? 'warning' : undefined}
      title={summary.workerName ?? 'Colaborador não identificado no documento'}
      subtitle={summary.fileName}
      headerActions={
        signedUrl ? (
          <a
            href={signedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-ig-accent hover:underline"
          >
            Abrir PDF original <ExternalLink className="h-3 w-3" />
          </a>
        ) : undefined
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <HudStatusPill size="sm" variant={status.tone}>{status.label}</HudStatusPill>
          <span title={esocial.hint}>
            <HudBadge size="sm" variant={esocial.tone === 'active' ? 'success' : 'subtle'}>
              {esocial.label}
            </HudBadge>
          </span>
          {summary.extractionConfidence !== null && summary.extractionMethod !== 'manual' && (
            <HudBadge size="sm" variant="subtle">
              {(summary.extractionConfidence * 100).toFixed(0)}% de confiança ·{' '}
              {summary.extractionMethod === 'ocr_ai' ? 'IA / OCR' : 'camada de texto'}
            </HudBadge>
          )}
          {summary.extractionMethod === 'manual' && (
            <HudBadge size="sm" variant="info">corrigido à mão</HudBadge>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field
            label="Colaborador"
            value={
              summary.personId ? (
                summary.workerName ?? 'vinculado'
              ) : (
                <span className="text-ig-warning">não vinculado ao cadastro</span>
              )
            }
            hint={summary.workerRegistration ? `Matrícula ${summary.workerRegistration}` : undefined}
          />
          <Field
            label="Tipo de exame"
            value={
              summary.examKind
                ? ASO_KIND_FROM_DOCUMENT_LABEL[summary.examKind as '0'] ?? summary.examKind
                : NA
            }
          />
          <Field label="Resultado" value={summary.result ? ASO_RESULT_LABELS[summary.result] ?? summary.result : NA} />
          <Field label="Data do exame" value={dateLabel(summary.examDate)} />
          <Field label="Válido até" value={dateLabel(summary.validityDate)} />
          <Field
            label="Procedência da validade"
            value={<span className="text-xs">{basis.label}</span>}
            hint={basis.hint}
          />
          <Field
            label="Médico / CRM"
            value={
              summary.doctorName || summary.doctorCrm
                ? `${summary.doctorName ?? NA}${summary.doctorCrm ? ` · CRM ${summary.doctorCrm}` : ''}`
                : NA
            }
          />
          <Field label="Clínica" value={summary.clinicName ?? NA} />
          <Field
            label="Riscos ocupacionais"
            value={summary.occupationalRisks.length > 0 ? summary.occupationalRisks.join(', ') : NA}
          />
        </div>

        {readiness.issues.length > 0 && (
          <div className="space-y-2 rounded-md border border-ig-border-subtle p-3">
            {readiness.blockers.map((b) => (
              <p key={b.code} className="flex items-start gap-2 text-[11px] leading-relaxed text-ig-danger">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span><strong>{b.label}.</strong> {b.detail}</span>
              </p>
            ))}
            {readiness.cautions.map((c) => (
              <p key={c.code} className="flex items-start gap-2 text-[11px] leading-relaxed text-ig-warning">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span><strong>{c.label}.</strong> {c.detail}</span>
              </p>
            ))}
          </div>
        )}

        {summary.extractionIssues.length > 0 && (
          <details className="text-[11px] text-ig-fg-muted">
            <summary className="cursor-pointer">
              {summary.extractionIssues.length} ressalva(s) do extrator
            </summary>
            <ul className="mt-1 space-y-0.5 pl-3">
              {summary.extractionIssues.map((i, idx) => (
                <li key={`${i.field}-${idx}`}>• {i.reason}</li>
              ))}
            </ul>
          </details>
        )}

        {summary.divergenceSummary && (
          <p className="text-[11px] leading-relaxed text-ig-warning">{summary.divergenceSummary}</p>
        )}

        {readiness.requiresAcknowledgement && readiness.eligibleForConfirmation && (
          <label className="flex cursor-pointer items-start gap-2 text-[11px] leading-relaxed text-ig-fg-muted">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Estou ciente de que este ASO fica arquivado{' '}
              <strong className="text-ig-fg-strong">sem controle de vencimento</strong> e confirmo
              mesmo assim.
            </span>
          </label>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <HudButton
            variant="primary"
            size="sm"
            disabled={confirmDisabled}
            leftIcon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            onClick={() => onConfirm(acknowledged)}
          >
            {readiness.requiresAcknowledgement ? 'Confirmar mesmo assim' : 'Confirmar e arquivar ASO'}
          </HudButton>
          <HudButton
            variant="secondary"
            size="sm"
            disabled={busy}
            leftIcon={<Pencil className="h-4 w-4" />}
            onClick={onEdit}
          >
            Corrigir campos
          </HudButton>
          <HudButton variant="ghost" size="sm" disabled={busy} onClick={onReject}>
            Rejeitar
          </HudButton>
          {!readiness.eligibleForConfirmation && (
            <p className="text-[11px] text-ig-fg-muted">
              Corrija o que está apontado acima para liberar a confirmação — o documento fica no
              acervo até lá.
            </p>
          )}
        </div>
      </div>
    </HudPanel>
  );
}
