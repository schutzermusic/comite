'use client';

/**
 * Fila de vencimento de ASO — a tela que o RH abre para saber o que fazer hoje.
 *
 * A fila é montada sobre o ACERVO DE PDFs. Quem decide o nível de cada linha é
 * o documento aprovado; o eSocial aparece numa coluna própria e no máximo
 * acusa divergência.
 *
 * A ordem é de urgência real: vencido, o que vence na janela crítica, quem está
 * sem documento enviado, o que voltou para correção, o que espera revisão. Os
 * dois baldes do fim — "sem vencimento apurável" e "em dia" — existem separados
 * de propósito.
 *
 * A DISTINÇÃO QUE ESTA TELA EXISTE PARA PRESERVAR
 *
 * Nem "documento não enviado" nem "sem vencimento apurável" são irregularidade.
 * O primeiro é pendência de acervo; o segundo é uma data que ninguém escreveu.
 * Pintar os dois de vermelho junto com "vencido" ensinaria o RH, em dois meses,
 * a ignorar a lista inteira — e o vencido de verdade sumiria no meio.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BellRing, CalendarClock, FileUp, Loader2, Send, ShieldAlert } from 'lucide-react';
import {
  HudBadge,
  HudButton,
  HudEmptyState,
  HudInput,
  HudKpiStrip,
  HudModal,
  HudPanel,
  HudStatusPill,
  HudTable,
  useHudToast,
  type HudTableColumn,
  type KpiItem,
} from '@/components/hud';
import {
  ASO_CONTROL_NOTICE,
  DEFAULT_ASO_WINDOWS,
  type AsoAlert,
  type AsoAlertSummary,
} from '@/lib/workforce/aso-alerts';
import {
  ASO_ALERT_LEVEL_LABELS,
  ASO_ESOCIAL_STATUS_LABELS,
} from '@/lib/workforce/aso-labels';
import { ASO_KIND_FROM_DOCUMENT_LABEL } from '@/lib/workforce/aso-extractor';

const NA = '—';

// Rótulos e tons vêm de `aso-labels`: a mesma frase precisa aparecer aqui, no
// acervo e no cartão de conferência, senão o mesmo estado ganha dois nomes.
const LEVEL_META = ASO_ALERT_LEVEL_LABELS;
const ESOCIAL_META = ASO_ESOCIAL_STATUS_LABELS;

function dateLabel(value: string | null): string {
  return value ? value.split('-').reverse().join('/') : NA;
}

interface AlertsResponse {
  ok: boolean;
  identified: boolean;
  windows: { critical: number; warning: number };
  alerts: AsoAlert[];
  summary: AsoAlertSummary;
  documentsAvailable: boolean;
  esocialAvailable: boolean;
  error?: string;
}

export function AsoAlertsPanel({ refreshKey }: { refreshKey?: number }) {
  const { notify } = useHudToast();
  const [data, setData] = useState<AlertsResponse | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [digestOpen, setDigestOpen] = useState(false);
  const [recipients, setRecipients] = useState('');
  const [sending, setSending] = useState(false);

  const reload = useCallback(async () => {
    try {
      const res = await fetch('/api/workforce/aso-alerts');
      const json = (await res.json()) as AlertsResponse;
      if (!res.ok || !json.ok) throw new Error(json.error ?? 'Falha ao carregar alertas');
      setData(json);
    } catch {
      setData(null);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload, refreshKey]);

  async function sendDigest() {
    const list = recipients.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
    if (list.length === 0) {
      notify('Informe ao menos um e-mail', { variant: 'error' });
      return;
    }
    setSending(true);
    try {
      const res = await fetch('/api/workforce/aso-alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipients: list }),
      });
      const json = (await res.json()) as {
        ok: boolean; sent?: boolean; simulated?: boolean; message?: string; error?: string;
      };
      if (!res.ok || !json.ok) throw new Error(json.error ?? 'Falha ao enviar');

      notify(
        json.sent ? 'Alerta enviado ao RH' : 'Envio simulado',
        {
          description: json.message ?? (json.sent ? `${list.length} destinatário(s).` : undefined),
          variant: json.sent ? 'success' : 'info',
        },
      );
      setDigestOpen(false);
    } catch (e) {
      notify('Falha ao enviar', { description: e instanceof Error ? e.message : undefined, variant: 'error' });
    } finally {
      setSending(false);
    }
  }

  const summary = data?.summary;
  // Memoizado: um objeto literal novo a cada render invalidaria o useMemo dos
  // KPIs sem que nada tivesse mudado.
  const windows = useMemo(
    () => data?.windows ?? DEFAULT_ASO_WINDOWS,
    [data?.windows],
  );

  const kpis: KpiItem[] = useMemo(
    () => [
      {
        id: 'expired',
        label: 'ASOs vencidos',
        value: summary?.expired ?? '–',
        icon: <ShieldAlert className="h-4 w-4" />,
        variant: summary && summary.expired > 0 ? 'danger' : 'default',
        deltaLabel: 'Sobre documento aprovado',
      },
      {
        id: 'expiring30',
        label: `Vencem em ${windows.critical} dias`,
        value: summary?.expiring30 ?? '–',
        icon: <CalendarClock className="h-4 w-4" />,
        variant: summary && summary.expiring30 > 0 ? 'warning' : 'default',
      },
      {
        id: 'expiring60',
        label: `Vencem em ${windows.warning} dias`,
        value: summary?.expiring60 ?? '–',
        variant: 'default',
      },
      {
        id: 'noDocument',
        label: 'Documento não enviado',
        value: summary?.noDocument ?? '–',
        icon: <FileUp className="h-4 w-4" />,
        // Nunca semântico: falta de PDF é pendência de acervo, não irregularidade.
        variant: 'default',
        deltaLabel: 'Pendência de acervo, não infração',
      },
      {
        id: 'pending',
        label: 'Aguardando revisão',
        value: summary?.pendingReview ?? '–',
        variant: summary && summary.pendingReview > 0 ? 'warning' : 'default',
      },
      {
        id: 'noValidity',
        label: 'Sem vencimento apurável',
        value: summary?.noValidity ?? '–',
        variant: 'default',
        deltaLabel: 'O papel não declarou data',
      },
    ],
    [summary, windows],
  );

  const columns: HudTableColumn<AsoAlert>[] = [
    {
      key: 'worker',
      header: 'Colaborador',
      cell: (a) => (
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ig-fg-strong">
            {a.name ?? 'Identificação restrita'}
          </p>
          <p className="text-xs text-ig-fg-muted">{a.areaLabel ?? NA}</p>
        </div>
      ),
    },
    {
      key: 'exam',
      header: 'Último exame',
      cell: (a) => (
        <div>
          <p className="text-sm tabular-nums text-ig-fg-strong">{dateLabel(a.examDate)}</p>
          <p className="text-xs text-ig-fg-muted">
            {a.examKind ? ASO_KIND_FROM_DOCUMENT_LABEL[a.examKind as '0'] ?? a.examKind : NA}
          </p>
        </div>
      ),
    },
    {
      key: 'validityDate',
      header: 'Vence em',
      align: 'right',
      cell: (a) => <span className="text-sm tabular-nums text-ig-fg-strong">{dateLabel(a.validityDate)}</span>,
    },
    {
      key: 'days',
      header: 'Dias',
      align: 'right',
      cell: (a) => (
        <span
          className={`text-sm tabular-nums ${
            a.daysToExpiry === null ? 'text-ig-fg-subtle' : a.daysToExpiry < 0 ? 'text-ig-danger' : 'text-ig-fg-muted'
          }`}
        >
          {a.daysToExpiry === null ? NA : a.daysToExpiry}
        </span>
      ),
    },
    {
      key: 'level',
      header: 'Documento',
      cell: (a) => (
        <div className="space-y-1">
          <span title={a.reason}>
            <HudStatusPill size="sm" variant={LEVEL_META[a.level].tone}>
              {LEVEL_META[a.level].label}
            </HudStatusPill>
          </span>
          {a.validityBasis === 'inferred_periodicity' && (
            <HudBadge size="sm" variant="warning">validade inferida</HudBadge>
          )}
        </div>
      ),
    },
    {
      key: 'esocial',
      header: 'eSocial (opcional)',
      cell: (a) => (
        <span title={a.esocial.summary ?? ESOCIAL_META[a.esocial.status].hint}>
          <HudBadge
            size="sm"
            variant={
              a.esocial.status === 'divergent'
                ? 'warning'
                : a.esocial.status === 'matched'
                  ? 'success'
                  : 'subtle'
            }
          >
            {ESOCIAL_META[a.esocial.status].label}
          </HudBadge>
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-3xl text-[11px] leading-relaxed text-ig-fg-muted">
          <strong className="text-ig-fg-strong">{ASO_CONTROL_NOTICE}</strong> O vencimento é apurado
          a partir do PDF aprovado pelo RH. Quem aparece em{' '}
          <strong className="text-ig-fg-strong">documento não enviado</strong> ou{' '}
          <strong className="text-ig-fg-strong">sem vencimento apurável</strong> não está irregular —
          o primeiro é pendência de acervo, o segundo é uma data que o papel não trouxe.
        </p>
        <HudButton
          variant="secondary"
          size="sm"
          leftIcon={<BellRing className="h-4 w-4" />}
          disabled={!summary || summary.actionable === 0}
          onClick={() => setDigestOpen(true)}
        >
          Enviar alerta ao RH
        </HudButton>
      </div>

      <HudKpiStrip kpis={kpis} columns={3} size="sm" />

      {data && !data.documentsAvailable && (
        <HudPanel state="warning">
          <p className="text-sm text-ig-warning">
            O acervo de documentos de ASO ainda não foi provisionado (migrations 085 e 089). Sem ele
            não há como controlar vencimento: o evento S-2220 do eSocial não declara data de validade.
          </p>
        </HudPanel>
      )}

      {data && summary && summary.esocialDivergent > 0 && (
        <HudPanel state="warning">
          <p className="text-sm text-ig-warning">
            {summary.esocialDivergent} documento(s) divergem do S-2220 transmitido. É provável erro de
            transmissão — confira qual das duas fontes está certa. O ASO continua valendo.
          </p>
        </HudPanel>
      )}

      <HudPanel title="Fila de vencimento" subtitle="Ordenada pelo que exige ação primeiro">
        <HudTable<AsoAlert>
          columns={columns}
          data={data?.alerts ?? []}
          keyExtractor={(a) => a.workerKey}
          loading={!loaded}
          emptyState={
            <HudEmptyState
              icon="inbox"
              title="Nenhum colaborador na fila"
              description="A fila cobre as pessoas do cadastro e os ASOs já enviados. Cadastre colaboradores ou envie os PDFs dos atestados para que ela seja montada."
            />
          }
        />
      </HudPanel>

      <HudModal
        isOpen={digestOpen}
        onClose={() => setDigestOpen(false)}
        title="Enviar alerta de vencimento ao RH"
        subtitle={
          summary
            ? `${summary.expired} vencido(s), ${summary.expiring30} em até ${windows.critical} dias, ${summary.noDocument} sem documento`
            : undefined
        }
        size="md"
      >
        <div className="space-y-3">
          <HudInput
            label="Destinatários"
            value={recipients}
            onChange={(e) => setRecipients(e.target.value)}
            placeholder="rh@empresa.com.br, sesmt@empresa.com.br"
          />
          <p className="text-[11px] leading-relaxed text-ig-fg-muted">
            O e-mail lista os vencidos e os que vencem na janela crítica, e informa à parte quantos
            estão sem documento enviado e quantos estão sem vencimento apurável — para que nenhuma das
            duas lacunas seja lida como conformidade nem como infração. Sem{' '}
            <code className="font-mono">RESEND_API_KEY</code> configurada o envio é simulado e dito
            como tal.
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <HudButton variant="secondary" onClick={() => setDigestOpen(false)}>Cancelar</HudButton>
            <HudButton
              variant="primary"
              disabled={sending}
              leftIcon={sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              onClick={() => void sendDigest()}
            >
              Enviar
            </HudButton>
          </div>
        </div>
      </HudModal>
    </div>
  );
}
