'use client';

/**
 * Fila de vencimento de ASO — a tela que o RH abre para saber o que fazer hoje.
 *
 * Ordenada por urgência real: vencido, depois o que vence na janela crítica,
 * depois quem não tem ASO nenhum no acervo. Os dois baldes do fim da lista —
 * "sem vencimento apurável" e "em dia" — existem separados de propósito, e a
 * distinção é o ponto inteiro desta tela: quem não tem data apurável NÃO está
 * irregular, está por conferir.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BellRing, CalendarClock, Loader2, Send, ShieldAlert } from 'lucide-react';
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
import { DEFAULT_ASO_WINDOWS, type AsoAlert, type AsoAlertLevel, type AsoAlertSummary } from '@/lib/workforce/aso-alerts';
import { ASO_KIND_FROM_DOCUMENT_LABEL } from '@/lib/workforce/aso-extractor';

const NA = '—';

const LEVEL_META: Record<
  AsoAlertLevel,
  { label: string; variant: 'error' | 'warning' | 'active' | 'neutral'; order: string }
> = {
  expired: { label: 'Vencido', variant: 'error', order: '1' },
  critical: { label: 'Vence em breve', variant: 'warning', order: '2' },
  absent: { label: 'Sem ASO no acervo', variant: 'warning', order: '3' },
  warning: { label: 'A vencer', variant: 'warning', order: '4' },
  undetermined: { label: 'Sem vencimento apurável', variant: 'neutral', order: '5' },
  ok: { label: 'Em dia', variant: 'active', order: '6' },
};

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
      },
      {
        id: 'critical',
        label: `Vencem em ${windows.critical} dias`,
        value: summary?.critical ?? '–',
        icon: <CalendarClock className="h-4 w-4" />,
        variant: summary && summary.critical > 0 ? 'warning' : 'default',
      },
      {
        id: 'absent',
        label: 'Sem ASO no acervo',
        value: summary?.absent ?? '–',
        variant: summary && summary.absent > 0 ? 'warning' : 'default',
        deltaLabel: 'Nem documento, nem evento',
      },
      {
        id: 'undetermined',
        label: 'Sem vencimento apurável',
        value: summary?.undetermined ?? '–',
        // Nunca semântico: é lacuna de leiaute, não irregularidade.
        variant: 'default',
        deltaLabel: 'Envie o PDF para obter a data declarada',
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
      key: 'validUntil',
      header: 'Vence em',
      align: 'right',
      cell: (a) => <span className="text-sm tabular-nums text-ig-fg-strong">{dateLabel(a.validUntil)}</span>,
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
      key: 'source',
      header: 'Origem',
      cell: (a) =>
        a.source === 'none' ? (
          <span className="text-sm text-ig-fg-subtle">{NA}</span>
        ) : (
          <span title={a.reason}>
            <HudBadge size="sm" variant={a.source === 'document' ? 'success' : 'subtle'}>
              {a.source === 'document' ? 'documento' : 'eSocial'}
            </HudBadge>
          </span>
        ),
    },
    {
      key: 'level',
      header: 'Situação',
      cell: (a) => (
        <span title={a.reason}>
          <HudStatusPill size="sm" variant={LEVEL_META[a.level].variant}>
            {LEVEL_META[a.level].label}
          </HudStatusPill>
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-3xl text-[11px] leading-relaxed text-ig-fg-muted">
          Quando existem as duas fontes, vale o <strong className="text-ig-fg-strong">documento</strong>:
          ele declara a validade, o eSocial só permite deduzi-la. Quem aparece em{' '}
          <strong className="text-ig-fg-strong">sem vencimento apurável</strong> ou{' '}
          <strong className="text-ig-fg-strong">sem ASO no acervo</strong> não está irregular — está
          por conferir, e o caminho mais curto é enviar o PDF do atestado.
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

      <HudKpiStrip kpis={kpis} columns={4} size="sm" />

      {data && !data.documentsAvailable && (
        <HudPanel state="warning">
          <p className="text-sm text-ig-warning">
            A tabela de documentos de ASO ainda não foi provisionada (migration 085). A fila abaixo usa
            apenas a validade inferida do eSocial, que só existe para o exame periódico.
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
              title="Nenhum vínculo ativo apurado"
              description="A fila é montada sobre os vínculos ativos vindos do eSocial."
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
            ? `${summary.expired} vencido(s), ${summary.critical} em até ${windows.critical} dias, ${summary.absent} sem ASO`
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
            estão sem vencimento apurável — para que a ausência de data não seja lida como
            conformidade. Sem <code className="font-mono">RESEND_API_KEY</code> configurada o envio é
            simulado e dito como tal.
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
