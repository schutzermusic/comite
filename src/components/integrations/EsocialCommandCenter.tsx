'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Database,
  FileCode2,
  KeyRound,
  Loader2,
  ExternalLink,
  PlugZap,
  Save,
  ShieldCheck,
  Upload,
  XCircle,
} from 'lucide-react';

import {
  HudButton,
  HudHeader,
  HudPageLayout,
  HudPanel,
  HudSignal,
} from '@/components/hud';
import { cn } from '@/lib/utils';

const ESOCIAL_PORTAL_URL = 'https://www.gov.br/esocial/pt-br';

/**
 * Tamanho de cada lote enviado ao servidor.
 *
 * O histórico inteiro não sobe numa requisição só: além da memória do servidor,
 * a Vercel limita o corpo de uma function a poucos MB. Então o navegador fatia
 * a seleção e envia em sequência — o total deixa de ter teto, e cada requisição
 * fica pequena o bastante para passar em qualquer ambiente.
 */
const BATCH_BYTES = 3 * 1024 * 1024;
const BATCH_MAX_FILES = 300;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * CENTRAL eSOCIAL
 * ===============
 * Ingestão dos eventos do eSocial para os indicadores de Pessoas & Custos.
 *
 * O insumo é o PACOTE do eSocial Download (portal web). Não existe webservice
 * para recuperar eventos já transmitidos por competência — é restrição da
 * plataforma, não escolha de implementação. Daí a importação manual do arquivo,
 * e daí para a frente tudo é automático: parse, apuração por competência e por
 * lotação, e os valores reais de INSS, IRRF e FGTS vindos dos totalizadores.
 *
 * SOMENTE LEITURA: o INSIGHT não assina nem transmite nada ao eSocial.
 */

interface IngestedEvent {
  code: string;
  label: string;
  feeds: string;
}

interface ConfigState {
  tpInsc: number;
  nrInsc: string;
  environment: 'production' | 'restricted';
  autoSyncEnabled: boolean;
  syncFrequency: 'manual' | 'daily' | 'weekly';
  lookbackMonths: number;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  nextSyncAt: string | null;
  certificate: { subject: string | null; expiresAt: string | null; fingerprint: string | null } | null;
}

interface SyncRun {
  id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  competence_from: string | null;
  competence_to: string | null;
  events_found: number;
  events_imported: number;
  events_failed: number;
  dry_run: boolean;
  safe_message: string | null;
}

interface ImportSummary {
  filesProcessed: number;
  xmlFound: number;
  eventsParsed: number;
  eventsImported: number;
  eventsDuplicated: number;
  eventsStoredOnly: number;
  returnsStored: number;
  occurrences: number;
  eventsFailed: number;
  competencesUpdated: number;
  competences: string[];
  messages: string[];
}

interface ConfigResponse {
  ok: boolean;
  configured: boolean;
  automationEnabled: boolean;
  certKeyConfigured: boolean;
  config: ConfigState | null;
  ingestedEvents: IngestedEvent[];
  recentRuns: SyncRun[];
}

interface FormState {
  nrInsc: string;
  environment: 'production' | 'restricted';
  autoSyncEnabled: boolean;
  syncFrequency: 'manual' | 'daily' | 'weekly';
  lookbackMonths: number;
}

const EMPTY_FORM: FormState = {
  nrInsc: '',
  // Homologação como padrão: um erro de configuração em produção restrita não
  // consulta dado real de trabalhador.
  environment: 'restricted',
  autoSyncEnabled: false,
  syncFrequency: 'daily',
  lookbackMonths: 3,
};

function formatDateTime(value?: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value));
}

function daysUntil(iso?: string | null): number | null {
  if (!iso) return null;
  return Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

const RUN_TONE: Record<string, 'success' | 'warning' | 'critical' | 'info' | 'neutral'> = {
  success: 'success',
  partial: 'warning',
  failed: 'critical',
  running: 'info',
  skipped: 'neutral',
};

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold text-ig-fg-default">{label}</span>
      {children}
      {hint && <span className="text-[10px] leading-snug text-ig-fg-muted">{hint}</span>}
    </label>
  );
}

/**
 * Lê a resposta com tolerância a corpo não-JSON.
 *
 * Um 500 do Next vem em HTML; `res.json()` direto morre com "Unexpected end of
 * JSON input" e esconde a causa. Aqui o texto cru é lido primeiro, e o que
 * sobra é uma mensagem que diz o que aconteceu de verdade.
 */
async function readJson<T>(res: Response): Promise<T & { ok?: boolean; error?: string }> {
  const raw = await res.text();
  if (!raw) {
    throw new Error(
      res.ok
        ? 'O servidor respondeu vazio.'
        : `O servidor respondeu ${res.status} sem detalhes. Verifique os logs da aplicação.`,
    );
  }
  try {
    return JSON.parse(raw) as T & { ok?: boolean; error?: string };
  } catch {
    // Corpo em HTML: extrair algo legível é melhor que despejar a página.
    const plain = raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
    throw new Error(`Resposta inesperada do servidor (HTTP ${res.status}). ${plain}`);
  }
}

const inputCls =
  'h-9 rounded-lg border border-ig-border-subtle bg-ig-panel px-3 text-[12.5px] text-ig-fg-strong ' +
  'outline-none transition-colors focus:border-ig-border-focus';

export function EsocialCommandCenter() {
  const [data, setData] = useState<ConfigResponse | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [password, setPassword] = useState('');
  const [certFile, setCertFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [packageFiles, setPackageFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [feedback, setFeedback] = useState<
    { tone: 'ok' | 'error'; message: string; details?: string[] } | null
  >(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const packageRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/integrations/esocial/config', { cache: 'no-store' });
      const json = await readJson<ConfigResponse>(res);
      // Mesmo em erro, o payload traz a tabela de eventos — a tela continua útil.
      if (json.ingestedEvents) setData((prev) => ({ ...(prev ?? json), ...json }));
      if (!res.ok || !json.ok) throw new Error(json.error ?? 'Falha ao carregar configuração.');
      setData(json);
      if (json.config) {
        setForm({
          nrInsc: json.config.nrInsc,
          environment: json.config.environment,
          autoSyncEnabled: json.config.autoSyncEnabled,
          syncFrequency: json.config.syncFrequency,
          lookbackMonths: json.config.lookbackMonths,
        });
      }
    } catch (err) {
      setFeedback({ tone: 'error', message: err instanceof Error ? err.message : 'Falha ao carregar.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    setFeedback(null);
    try {
      const body = new FormData();
      body.set('tpInsc', '1');
      body.set('nrInsc', form.nrInsc);
      body.set('environment', form.environment);
      // O agendamento saiu da tela junto com a automação que não existe; a API
      // mantém as colunas, então enviamos valores neutros.
      body.set('autoSyncEnabled', 'false');
      body.set('syncFrequency', 'manual');
      body.set('lookbackMonths', '3');
      if (certFile) {
        body.set('certificate', certFile);
        body.set('certificatePassword', password);
      }

      const res = await fetch('/api/integrations/esocial/config', { method: 'POST', body });
      const json = await readJson<{ ok: boolean; error?: string }>(res);
      if (!res.ok || !json.ok) throw new Error(json.error ?? 'Falha ao salvar.');

      // A senha só existe em memória durante o envio; some assim que ele termina.
      setPassword('');
      setCertFile(null);
      if (fileRef.current) fileRef.current.value = '';
      setFeedback({ tone: 'ok', message: 'Configuração salva.' });
      await load();
    } catch (err) {
      setFeedback({ tone: 'error', message: err instanceof Error ? err.message : 'Falha ao salvar.' });
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    setTesting(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/integrations/esocial/validate-certificate', { method: 'POST' });
      const json = await readJson<{ ok: boolean; message?: string; stage?: string }>(res);
      setFeedback({
        tone: json.ok ? 'ok' : 'error',
        message: json.ok
          ? json.message ?? 'Conexão estabelecida.'
          : `${json.stage === 'certificate' ? 'Certificado' : 'Conexão'}: ${json.error ?? 'falhou.'}`,
      });
    } catch (err) {
      setFeedback({ tone: 'error', message: err instanceof Error ? err.message : 'Falha no teste.' });
    } finally {
      setTesting(false);
    }
  };

  /** Fatia a seleção respeitando tamanho e contagem; um arquivo grande vira lote próprio. */
  const splitIntoBatches = (files: File[]): File[][] => {
    const batches: File[][] = [];
    let current: File[] = [];
    let bytes = 0;
    for (const file of files) {
      const wouldExceed = current.length > 0 && (bytes + file.size > BATCH_BYTES || current.length >= BATCH_MAX_FILES);
      if (wouldExceed) {
        batches.push(current);
        current = [];
        bytes = 0;
      }
      current.push(file);
      bytes += file.size;
    }
    if (current.length > 0) batches.push(current);
    return batches;
  };

  const importPackage = async () => {
    if (packageFiles.length === 0) {
      setFeedback({ tone: 'error', message: 'Selecione o ZIP (ou os XMLs) baixados do eSocial Download.' });
      return;
    }

    setImporting(true);
    setFeedback(null);

    const batches = splitIntoBatches(packageFiles);
    const total = { imported: 0, duplicated: 0, storedOnly: 0, failed: 0, returns: 0, occurrences: 0 };
    const competences = new Set<string>();
    /** Amostra dos motivos: repetir a mesma causa 700 vezes não informa mais. */
    const reasons = new Set<string>();
    let batchesDone = 0;

    try {
      for (const [index, batch] of batches.entries()) {
        setProgress({ current: index + 1, total: batches.length });

        const body = new FormData();
        for (const f of batch) body.append('files', f);

        const res = await fetch('/api/integrations/esocial/import', { method: 'POST', body });
        const json = await readJson<{ ok: boolean; summary?: ImportSummary }>(res);
        if (!res.ok || !json.ok || !json.summary) {
          // Falhar no lote 7 de 20 não desfaz os 6 anteriores: eles já estão
          // gravados e a reimportação os reconhece. Dizer onde parou é o que
          // permite retomar sem repetir tudo.
          throw new Error(
            `${json.error ?? 'Falha na importação.'} (lote ${index + 1} de ${batches.length}; ` +
              `${total.imported} evento(s) já importado(s) antes da falha)`,
          );
        }

        const sum = json.summary;
        total.imported += sum.eventsImported;
        total.duplicated += sum.eventsDuplicated;
        total.storedOnly += sum.eventsStoredOnly;
        total.returns += sum.returnsStored;
        total.occurrences += sum.occurrences;
        total.failed += sum.eventsFailed;
        sum.competences.forEach((c) => competences.add(c));
        sum.messages.slice(0, 5).forEach((m) => reasons.add(m));
        batchesDone += 1;
      }

      const partes = [
        `${total.imported} evento(s) importado(s)`,
        total.duplicated > 0 ? `${total.duplicated} já existente(s)` : null,
        total.storedOnly > 0 ? `${total.storedOnly} guardado(s) para uso futuro` : null,
        total.returns > 0 ? `${total.returns} retorno(s) de lote` : null,
        total.occurrences > 0 ? `${total.occurrences} ocorrência(s) apontada(s) pelo eSocial` : null,
        total.failed > 0 ? `${total.failed} com falha` : null,
        competences.size > 0 ? `${competences.size} competência(s): ${[...competences].sort().join(', ')}` : null,
        batches.length > 1 ? `${batchesDone} lote(s)` : null,
      ].filter(Boolean);

      setFeedback({
        tone: total.failed > 0 ? 'error' : 'ok',
        message: partes.join(' · '),
        details: total.failed > 0 ? [...reasons].slice(0, 6) : undefined,
      });
      setPackageFiles([]);
      if (packageRef.current) packageRef.current.value = '';
      await load();
    } catch (err) {
      setFeedback({ tone: 'error', message: err instanceof Error ? err.message : 'Falha na importação.' });
    } finally {
      setImporting(false);
      setProgress(null);
    }
  };

  const totalBytes = packageFiles.reduce((sum, f) => sum + f.size, 0);

  const cert = data?.config?.certificate;
  const certDays = daysUntil(cert?.expiresAt);
  const configured = data?.configured ?? false;

  return (
    <HudPageLayout>
      <HudHeader
        title="eSocial"
        subtitle="Importe o pacote do eSocial Download e os indicadores de Pessoas & Custos se apuram sozinhos"
        icon={<ShieldCheck className="h-5 w-5" />}
        iconTint="#17C3B2"
        breadcrumbs={[
          { label: 'Configurações', href: '/configuracoes' },
          { label: 'Integrações', href: '/configuracoes/integracoes' },
          { label: 'eSocial' },
        ]}
        statusChips={[
          {
            label: (data?.recentRuns?.length ?? 0) > 0 ? 'eventos importados' : 'sem importação',
            variant: (data?.recentRuns?.length ?? 0) > 0 ? 'success' : 'neutral',
          },
          { label: 'somente leitura', variant: 'info' },
          ...(configured
            ? [{ label: 'certificado guardado', variant: 'neutral' as const }]
            : []),
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <HudButton
              variant="secondary"
              size="sm"
              leftIcon={<ExternalLink className="h-4 w-4" />}
              onClick={() => window.open(ESOCIAL_PORTAL_URL, '_blank', 'noopener')}
            >
              Abrir eSocial Download
            </HudButton>
            <HudButton
              variant="primary"
              size="sm"
              leftIcon={importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              onClick={importPackage}
              disabled={importing || packageFiles.length === 0}
            >
              Importar pacote
            </HudButton>
          </div>
        }
      />

      {feedback && (
        <div
          className={cn(
            'flex items-start gap-2 rounded-xl border px-4 py-3 text-[12px]',
            feedback.tone === 'ok'
              ? 'border-ig-success/30 bg-ig-success/[0.06] text-ig-fg-default'
              : 'border-ig-danger/30 bg-ig-danger/[0.06] text-ig-fg-default',
          )}
        >
          {feedback.tone === 'ok' ? (
            <CheckCircle2 className="mt-px h-4 w-4 shrink-0 text-ig-success" />
          ) : (
            <XCircle className="mt-px h-4 w-4 shrink-0 text-ig-danger" />
          )}
          <div className="min-w-0">
            <p>{feedback.message}</p>
            {feedback.details && feedback.details.length > 0 && (
              <ul className="mt-2 max-h-32 space-y-0.5 overflow-y-auto rounded-lg bg-ig-panel/60 p-2 font-mono text-[10px] text-ig-fg-muted">
                {feedback.details.map((d, i) => (
                  <li key={i} className="break-all">{d}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {!loading && data && !data.certKeyConfigured && (
        <div className="flex items-start gap-2 rounded-xl border border-ig-warning/30 bg-ig-warning/[0.06] px-4 py-3 text-[12px]">
          <AlertTriangle className="mt-px h-4 w-4 shrink-0 text-ig-warning" />
          <span>
            <b>ESOCIAL_CERT_KEY</b> não está configurada no servidor. Sem ela a senha do certificado não pode ser
            guardada com segurança e o upload será recusado.
          </span>
        </div>
      )}

      {/* ── Importação do pacote ── */}
      <HudPanel
        elevation={3}
        title="Importar eventos do eSocial"
        subtitle="Pacote do eSocial Download (.zip do portal) ou XMLs avulsos"
        icon={<Upload size={16} />}
        iconTint="#17C3B2"
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.2fr_1fr]">
          <div>
            <input
              ref={packageRef}
              type="file"
              multiple
              accept=".zip,.xml"
              className={cn(
                inputCls,
                'h-auto w-full py-2 file:mr-2 file:rounded-md file:border-0 file:bg-ig-panel-hover file:px-2 file:py-1 file:text-[11px] file:text-ig-fg-default',
              )}
              onChange={(e) => setPackageFiles(Array.from(e.target.files ?? []))}
            />
            {packageFiles.length > 0 && (
              <div className="mt-3 rounded-xl border border-ig-border-subtle bg-ig-bg-raised/50 p-3">
                {/* Um export de folha traz centenas de XMLs: o resumo é o que
                    importa, e a lista fica disponível sem empurrar o botão
                    de confirmar para fora da tela. */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[12px] font-semibold text-ig-fg-strong">
                    {packageFiles.length} arquivo(s) · {formatBytes(totalBytes)}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setPackageFiles([]);
                      if (packageRef.current) packageRef.current.value = '';
                    }}
                    className="text-[11px] font-semibold text-ig-fg-muted underline-offset-2 transition-colors hover:text-ig-danger hover:underline"
                  >
                    limpar seleção
                  </button>
                </div>


                <details className="group mt-2">
                  <summary className="cursor-pointer list-none text-[11px] font-medium text-ig-fg-muted transition-colors hover:text-ig-accent">
                    <span className="group-open:hidden">ver arquivos selecionados</span>
                    <span className="hidden group-open:inline">ocultar arquivos</span>
                  </summary>
                  <ul className="mt-2 max-h-40 space-y-0.5 overflow-y-auto rounded-lg bg-ig-panel/60 p-2 font-mono text-[10px] text-ig-fg-muted">
                    {packageFiles.map((f, i) => (
                      <li key={`${f.name}-${i}`} className="truncate" title={f.name}>
                        {f.name}
                      </li>
                    ))}
                  </ul>
                </details>

                <HudButton
                  className="mt-3"
                  variant="primary"
                  size="sm"
                  leftIcon={importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  onClick={importPackage}
                  disabled={importing}
                >
                  {importing
                    ? progress
                      ? `Importando… lote ${progress.current} de ${progress.total}`
                      : 'Importando…'
                    : `Importar ${packageFiles.length} arquivo(s)`}
                </HudButton>

                {importing && progress && progress.total > 1 && (
                  <div className="mt-2">
                    <div className="h-1 overflow-hidden rounded-full bg-ig-border-subtle">
                      <div
                        className="h-full rounded-full bg-ig-accent transition-[width] duration-300"
                        style={{ width: `${(progress.current / progress.total) * 100}%` }}
                      />
                    </div>
                    <p className="mt-1 text-[10px] text-ig-fg-muted">
                      Enviando em lotes — não feche a página até terminar.
                    </p>
                  </div>
                )}
              </div>
            )}
            <p className="mt-2 text-[11px] leading-snug text-ig-fg-muted">
              Reimportar o mesmo pacote é seguro: eventos já ingeridos são reconhecidos e ignorados.
            </p>
          </div>

          <ol className="space-y-1.5 rounded-xl border border-ig-border-subtle bg-ig-bg-raised/50 p-3 text-[11px] leading-snug text-ig-fg-muted">
            <li>
              <b className="text-ig-fg-default">1.</b> No portal do eSocial, acesse{' '}
              <b className="text-ig-fg-default">Empregador → eSocial Download</b>.
            </li>
            <li>
              <b className="text-ig-fg-default">2.</b> Peça o período desejado (máx. 35 dias por solicitação).
            </li>
            <li>
              <b className="text-ig-fg-default">3.</b> Baixe o ZIP quando ficar disponível e selecione-o aqui.
            </li>
            <li className="pt-1 text-ig-fg-subtle">
              Limites do portal: 12 solicitações/dia, arquivos disponíveis por 7 dias.
            </li>
          </ol>
        </div>

        <p className="mt-3 flex items-start gap-1.5 text-[10.5px] leading-snug text-ig-fg-subtle">
          <AlertTriangle className="mt-px h-3 w-3 shrink-0 text-ig-warning" />
          O eSocial não oferece webservice para recuperar eventos já transmitidos por competência — o eSocial
          Download é exclusivo do portal web. Por isso esta etapa é manual; tudo depois dela é automático.
        </p>
      </HudPanel>

      {/* ── Configuração ── */}
      <HudPanel
        elevation={3}
        title="Identificação do empregador"
        subtitle="CNPJ, ambiente e — opcionalmente — o certificado A1"
        icon={<KeyRound size={16} />}
        iconTint="#17C3B2"
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Field label="CNPJ do empregador" hint="Somente números; deve bater com o titular do certificado.">
            <input
              className={inputCls}
              value={form.nrInsc}
              inputMode="numeric"
              maxLength={14}
              placeholder="00000000000000"
              onChange={(e) => setForm((f) => ({ ...f, nrInsc: e.target.value.replace(/\D/g, '') }))}
            />
          </Field>

          <Field label="Ambiente" hint="Comece em homologação; mude para produção após o teste passar.">
            <select
              className={inputCls}
              value={form.environment}
              onChange={(e) => setForm((f) => ({ ...f, environment: e.target.value as 'production' | 'restricted' }))}
            >
              <option value="restricted">Produção restrita (homologação)</option>
              <option value="production">Produção</option>
            </select>
          </Field>

          <Field
            label="Certificado A1 (.pfx / .p12) — opcional"
            hint={
              cert
                ? `Atual: vence em ${formatDateTime(cert.expiresAt)}. Envie outro arquivo apenas para substituir.`
                : 'Não é necessário para importar: o download é feito com seu login no portal. Guarde-o apenas se pretender transmitir pelo INSIGHT no futuro.'
            }
          >
            <input
              ref={fileRef}
              type="file"
              accept=".pfx,.p12"
              className={cn(inputCls, 'py-1.5 file:mr-2 file:rounded-md file:border-0 file:bg-ig-panel-hover file:px-2 file:py-1 file:text-[11px] file:text-ig-fg-default')}
              onChange={(e) => setCertFile(e.target.files?.[0] ?? null)}
            />
          </Field>

          <Field label="Senha do certificado" hint="Cifrada antes de tocar o banco; nunca é devolvida pela API.">
            <input
              type="password"
              className={inputCls}
              value={password}
              autoComplete="new-password"
              placeholder={cert ? '•••••••• (mantida)' : ''}
              onChange={(e) => setPassword(e.target.value)}
              disabled={!certFile}
            />
          </Field>

                </div>

        <div className="mt-4 flex items-center gap-2">
          <HudButton
            variant="primary"
            size="sm"
            leftIcon={saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            onClick={save}
            disabled={saving || loading}
          >
            Salvar configuração
          </HudButton>
          {certFile && (
            <span className="flex items-center gap-1.5 text-[11px] text-ig-fg-muted">
              <Upload className="h-3 w-3" /> {certFile.name}
            </span>
          )}
          {configured && (
            <HudButton
              variant="secondary"
              size="sm"
              leftIcon={testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
              onClick={testConnection}
              disabled={testing}
            >
              Validar certificado
            </HudButton>
          )}
        </div>
      </HudPanel>

      {/* ── Estado atual ── */}
      <HudPanel
        elevation={2}
        title="Estado da ingestão"
        subtitle="Certificado guardado e última importação"
        icon={<Clock3 size={16} />}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            {
              label: 'Certificado',
              value: cert ? (certDays !== null && certDays < 0 ? 'Expirado' : `${certDays}d restantes`) : 'Não enviado',
              tone: !cert ? 'neutral' : certDays !== null && certDays < 30 ? 'warning' : 'success',
            },
            {
              label: 'Última importação',
              value: formatDateTime(data?.config?.lastSyncAt),
              tone: data?.config?.lastSyncStatus === 'failed' ? 'critical' : 'info',
            },
            {
              label: 'Importações registradas',
              value: String(data?.recentRuns?.length ?? 0),
              tone: 'info' as const,
            },
          ].map((k) => (
            <div key={k.label} className="rounded-xl border border-ig-border-subtle bg-ig-panel/60 px-3 py-3">
              <p className="text-[10px] uppercase tracking-[0.12em] text-ig-fg-subtle">{k.label}</p>
              <p
                className={cn(
                  'mt-1 text-[13px] font-semibold',
                  k.tone === 'critical' && 'text-ig-danger',
                  k.tone === 'warning' && 'text-ig-warning',
                  k.tone === 'success' && 'text-ig-success',
                  (k.tone === 'info' || k.tone === 'neutral') && 'text-ig-fg-strong',
                )}
              >
                {k.value}
              </p>
            </div>
          ))}
        </div>

        {cert?.subject && (
          <p className="mt-3 truncate font-mono text-[10.5px] text-ig-fg-muted" title={cert.subject}>
            {cert.subject}
          </p>
        )}
      </HudPanel>

      {/* ── O que é ingerido ── */}
      <HudPanel
        elevation={2}
        title="Eventos consumidos"
        subtitle="Eventos que viram indicador hoje — os demais são guardados para uso futuro"
        icon={<Database size={16} />}
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse">
            <thead>
              <tr className="border-b border-ig-border-subtle">
                <th className="px-3 py-2 text-left text-[9.5px] font-bold uppercase tracking-[0.12em] text-ig-fg-muted">Evento</th>
                <th className="px-3 py-2 text-left text-[9.5px] font-bold uppercase tracking-[0.12em] text-ig-fg-muted">Descrição</th>
                <th className="px-3 py-2 text-left text-[9.5px] font-bold uppercase tracking-[0.12em] text-ig-fg-muted">Alimenta</th>
              </tr>
            </thead>
            <tbody>
              {(data?.ingestedEvents ?? []).map((e) => (
                <tr key={e.code} className="border-b border-ig-border-subtle/50">
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] font-bold text-ig-fg-strong">{e.code}</td>
                  <td className="px-3 py-2 text-[11.5px] text-ig-fg-default">{e.label}</td>
                  <td className="px-3 py-2 text-[11px] text-ig-fg-muted">{e.feeds}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 flex items-start gap-1.5 text-[10.5px] leading-snug text-ig-fg-muted">
          <Database className="mt-px h-3 w-3 shrink-0" />
          <span>
            <b className="text-ig-fg-default">Todos os demais eventos do pacote também são guardados</b> — CAT
            (S-2210), exames ocupacionais (S-2220), agentes nocivos (S-2240), fechamento (S-1299), tabelas e
            exclusões. Eles ainda não viram indicador, mas ficam disponíveis: um indicador novo passa a ser uma
            reapuração do que já está no banco, e não um novo pedido de arquivo à contabilidade — o que importa
            porque o eSocial apaga os XMLs após o prazo de retenção.
          </span>
        </p>
        <p className="mt-2 flex items-start gap-1.5 text-[10.5px] leading-snug text-ig-fg-muted">
          <FileCode2 className="mt-px h-3 w-3 shrink-0" />
          Conector somente de leitura: o INSIGHT não assina nem envia eventos ao eSocial.
        </p>
      </HudPanel>

      {/* ── Histórico ── */}
      <HudPanel
        elevation={2}
        title="Histórico de importações"
        subtitle="Últimos pacotes processados e seus resultados"
        icon={<CalendarClock size={16} />}
      >
        {(data?.recentRuns ?? []).length === 0 ? (
          <p className="py-4 text-center text-[12px] text-ig-fg-muted">Nenhuma importação registrada ainda.</p>
        ) : (
          <div className="space-y-2">
            {(data?.recentRuns ?? []).map((run) => (
              <div
                key={run.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-ig-border-subtle bg-ig-panel/60 px-3 py-2.5"
              >
                <HudSignal
                  tone={RUN_TONE[run.status] ?? 'neutral'}
                  size="sm"
                  label={run.status}
                  value={run.dry_run ? 'sim' : undefined}
                />
                <span className="text-[11.5px] tabular-nums text-ig-fg-default">
                  {formatDateTime(run.started_at)}
                </span>
                <span className="text-[11px] text-ig-fg-muted">
                  {run.competence_from} → {run.competence_to}
                </span>
                <span className="text-[11px] tabular-nums text-ig-fg-muted">
                  {run.events_imported} importado(s) de {run.events_found}
                  {run.events_failed > 0 && (
                    <span className="ml-1 text-ig-warning">· {run.events_failed} falha(s)</span>
                  )}
                </span>
                {run.safe_message && (
                  <span className="min-w-0 flex-1 truncate text-[10.5px] text-ig-fg-subtle" title={run.safe_message}>
                    {run.safe_message}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </HudPanel>
    </HudPageLayout>
  );
}
