"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Archive,
  CalendarClock,
  CheckCircle2,
  Clock3,
  CloudUpload,
  DatabaseZap,
  ExternalLink,
  FileCode2,
  FileWarning,
  Fingerprint,
  History,
  KeyRound,
  LockKeyhole,
  Play,
  RefreshCcw,
  Save,
  Settings2,
  ShieldCheck,
  TimerReset,
  Upload,
} from "lucide-react";

import {
  HudButton,
  HudCard,
  HudCardContent,
  HudCardHeader,
  HudCardTitle,
  HudHeader,
  HudKpiStrip,
  HudPageLayout,
  HudPanel,
  HudProgressBar,
  HudStatusPill,
  type KpiItem,
} from "@/components/hud";
import { getEsocialDashboardData, type EsocialSyncRun } from "@/lib/esocial";
import {
  defaultEsocialScheduleConfig,
  getEsocialIntegrationStatus,
  type EsocialEnvironment,
  type EsocialSyncFrequency,
} from "@/lib/integrations/esocial";
import { cn } from "@/lib/utils";

const fmtNumber = new Intl.NumberFormat("pt-BR");
const fmtCurrency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const statusVariant: Record<EsocialSyncRun["status"], "active" | "warning" | "error" | "neutral" | "info"> = {
  scheduled: "info",
  running: "active",
  completed: "active",
  completed_with_warnings: "warning",
  failed: "error",
};

const statusLabel: Record<EsocialSyncRun["status"], string> = {
  scheduled: "Agendado",
  running: "Em execucao",
  completed: "Concluido",
  completed_with_warnings: "Concluido com avisos",
  failed: "Falhou",
};

function formatDateTime(value?: string) {
  if (!value) return "Nao agendado";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function EsocialCommandCenter() {
  const data = getEsocialDashboardData();
  const integrationStatus = getEsocialIntegrationStatus();
  const { config, syncRuns, importSummary, workforce, payroll, errors } = data;
  const [environment, setEnvironment] = useState<EsocialEnvironment>(config.environment);
  const [frequency, setFrequency] = useState<EsocialSyncFrequency>(defaultEsocialScheduleConfig.frequency);
  const [automaticSync, setAutomaticSync] = useState(defaultEsocialScheduleConfig.automaticSyncEnabled);
  const [companyCnpj, setCompanyCnpj] = useState(config.companyCnpjMasked);
  const [certificateFileName, setCertificateFileName] = useState("empresa-a1.pfx");

  const kpis: KpiItem[] = [
    { id: "events", label: "Eventos importados", value: fmtNumber.format(config.importedEventsCount), variant: "success", tintValue: true, icon: <DatabaseZap /> },
    { id: "failures", label: "Falhas/rejeicoes", value: fmtNumber.format(config.failedEventsCount), variant: "warning", tintValue: true, icon: <FileWarning /> },
    { id: "headcount", label: "Headcount eSocial", value: fmtNumber.format(workforce.headcount), variant: "info", tintValue: true, icon: <Fingerprint /> },
    { id: "gross", label: "Folha bruta", value: fmtCurrency.format(payroll.grossPayroll), variant: "success", tintValue: true, icon: <Archive /> },
    { id: "overtime", label: "Overtime", value: fmtCurrency.format(payroll.overtimeAmount), variant: "warning", tintValue: true, icon: <Clock3 /> },
    { id: "updated", label: "Ultima sync", value: "05/05", deltaText: "09:30", deltaTone: "neutral", variant: "info", tintValue: true, icon: <RefreshCcw /> },
  ];

  return (
    <HudPageLayout maxWidth="full" contentClassName="max-w-[1800px]">
      <HudHeader
        title="eSocial Data Command Center"
        subtitle="Camada central de folha, vinculos e indicadores para Pessoas & Custos e Financeiro."
        icon={<ShieldCheck className="h-5 w-5" />}
        iconTint="#17C3B2"
        breadcrumbs={[
          { label: "Configuracoes", href: "/configuracoes" },
          { label: "Integracoes", href: "/configuracoes/integracoes" },
          { label: "eSocial" },
        ]}
        statusChips={[
          { label: environment === "production" ? "Producao" : "Homologacao", variant: "info" },
          { label: "Certificado expira em 44 dias", variant: "warning" },
          { label: "XML seguro", variant: "success" },
        ]}
        actions={
          <div className="flex flex-wrap justify-end gap-2">
            <HudButton variant="secondary" size="sm" leftIcon={<KeyRound className="h-4 w-4" />}>
              Validar certificado
            </HudButton>
            <HudButton variant="secondary" size="sm" leftIcon={<Upload className="h-4 w-4" />}>
              Importar XMLs
            </HudButton>
            <HudButton variant="primary" size="sm" leftIcon={<Play className="h-4 w-4" />}>
              Sincronizar agora
            </HudButton>
          </div>
        }
      />

      <HudKpiStrip kpis={kpis} columns={6} connected align="center" />

      <HudPanel
        title="Configuracao A1 e sincronizacao automatica"
        subtitle="Credenciais ficam no servidor/bridge PHP; a senha nao e exibida depois de salvar."
        icon={<Settings2 className="h-4 w-4" />}
        iconTint="#17C3B2"
        elevation={3}
        state="warning"
        headerActions={
          <HudStatusPill variant="warning" size="sm">
            aguardando conector PHP
          </HudStatusPill>
        }
      >
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_0.9fr]">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <FieldBlock label="CNPJ da empresa" help="Mascarado na UI; valor real deve ir para storage seguro.">
              <input
                value={companyCnpj}
                onChange={(event) => setCompanyCnpj(event.target.value)}
                className="h-10 w-full rounded-lg border border-ig-border-subtle bg-ig-panel px-3 font-mono text-sm text-ig-fg-strong outline-none focus:border-ig-border-focus"
                aria-label="CNPJ da empresa"
              />
            </FieldBlock>

            <FieldBlock label="Ambiente" help="Homologacao e producao usam configuracoes separadas.">
              <select
                value={environment}
                onChange={(event) => setEnvironment(event.target.value as EsocialEnvironment)}
                className="h-10 w-full rounded-lg border border-ig-border-subtle bg-ig-panel px-3 text-sm text-ig-fg-strong outline-none focus:border-ig-border-focus"
                aria-label="Ambiente eSocial"
              >
                <option value="homologation">Homologacao</option>
                <option value="production">Producao</option>
              </select>
            </FieldBlock>

            <FieldBlock label="Certificado A1 (.pfx/.p12)" help="O arquivo real nao deve ficar no repositorio nem em public/.">
              <label className="flex h-10 cursor-pointer items-center justify-between gap-3 rounded-lg border border-dashed border-ig-border-strong bg-ig-panel px-3 text-sm text-ig-fg-muted hover:border-ig-border-focus">
                <span className="truncate font-mono text-xs">{certificateFileName}</span>
                <Upload className="h-4 w-4 text-ig-accent" />
                <input
                  type="file"
                  accept=".pfx,.p12"
                  className="sr-only"
                  onChange={(event) => setCertificateFileName(event.target.files?.[0]?.name ?? "empresa-a1.pfx")}
                  aria-label="Arquivo do certificado A1"
                />
              </label>
            </FieldBlock>

            <FieldBlock label="Senha do certificado" help="Nao e renderizada apos salvar; enviar somente ao backend seguro.">
              <div className="relative">
                <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ig-fg-subtle" />
                <input
                  type="password"
                  placeholder="Digite para validar ou atualizar"
                  className="h-10 w-full rounded-lg border border-ig-border-subtle bg-ig-panel px-9 text-sm text-ig-fg-strong outline-none focus:border-ig-border-focus"
                  aria-label="Senha do certificado"
                />
              </div>
            </FieldBlock>

            <FieldBlock label="Sincronizacao automatica" help="Agenda preparada; execucao real depende do worker PHP.">
              <button
                type="button"
                onClick={() => setAutomaticSync((previous) => !previous)}
                className={cn(
                  "flex h-10 w-full items-center justify-between rounded-lg border px-3 text-sm font-medium transition-colors",
                  automaticSync
                    ? "border-[color-mix(in_oklab,var(--ig-success)_34%,transparent)] bg-[color-mix(in_oklab,var(--ig-success)_12%,transparent)] text-ig-success"
                    : "border-ig-border-subtle bg-ig-panel text-ig-fg-muted",
                )}
                aria-pressed={automaticSync}
              >
                <span>{automaticSync ? "Ativa" : "Manual"}</span>
                <span className={cn("h-5 w-9 rounded-full p-0.5 transition-colors", automaticSync ? "bg-ig-success" : "bg-ig-panel-hover")}>
                  <span className={cn("block h-4 w-4 rounded-full bg-white transition-transform", automaticSync && "translate-x-4")} />
                </span>
              </button>
            </FieldBlock>

            <FieldBlock label="Frequencia" help="manual, diaria, semanal ou mensal.">
              <select
                value={frequency}
                onChange={(event) => setFrequency(event.target.value as EsocialSyncFrequency)}
                className="h-10 w-full rounded-lg border border-ig-border-subtle bg-ig-panel px-3 text-sm text-ig-fg-strong outline-none focus:border-ig-border-focus"
                aria-label="Frequencia de sincronizacao"
              >
                <option value="manual">Manual</option>
                <option value="daily">Diaria</option>
                <option value="weekly">Semanal</option>
                <option value="monthly">Mensal</option>
              </select>
            </FieldBlock>
          </div>

          <div className="rounded-xl border border-[color-mix(in_oklab,var(--ig-warning)_30%,transparent)] bg-ig-panel/60 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-ig-fg-strong">Status do conector</p>
                <p className="mt-1 text-xs leading-relaxed text-ig-fg-muted">{integrationStatus.safeStatusMessage}</p>
              </div>
              <HudStatusPill variant="warning" size="sm">simulado</HudStatusPill>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-2">
              <InfoRow label="Status certificado" value={certificateStatusLabel(config.certificateStatus)} tone="warning" />
              <InfoRow label="Expiracao" value={config.certificateExpiresAt ?? "Nao informado"} tone="warning" />
              <InfoRow label="Competencia sincronizada" value={defaultEsocialScheduleConfig.competence} tone="info" />
              <InfoRow label="Proxima execucao" value={formatDateTime(defaultEsocialScheduleConfig.nextScheduledSyncAt)} tone="info" />
              <InfoRow label="Senha salva" value={integrationStatus.certificatePasswordSaved ? "Sim" : "Nao exibida / nao persistida no stub"} tone="neutral" />
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <HudButton variant="secondary" size="sm" leftIcon={<KeyRound className="h-4 w-4" />}>
                Validar certificado
              </HudButton>
              <HudButton variant="secondary" size="sm" leftIcon={<TimerReset className="h-4 w-4" />}>
                Testar conectividade
              </HudButton>
              <HudButton variant="primary" size="sm" leftIcon={<Save className="h-4 w-4" />}>
                Salvar configuracao
              </HudButton>
            </div>
          </div>
        </div>
      </HudPanel>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <HudPanel
          title="Motor de integracao"
          subtitle="Bridge PHP planejado com nfephp-org/sped-esocial; SOAP real permanece fora do Next.js."
          icon={<FileCode2 className="h-4 w-4" />}
          iconTint="#17C3B2"
          elevation={3}
          sweep
          headerActions={
            <Link
              href={config.githubUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-ig-accent hover:text-ig-accent-strong"
            >
              GitHub reference <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          }
        >
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <InfoTile label="Provider" value={config.provider} tone="accent" />
            <InfoTile label="Ambiente" value={environment === "production" ? "Producao" : "Homologacao"} tone="info" />
            <InfoTile label="CNPJ empresa" value={config.companyCnpjMasked} tone="neutral" />
            <InfoTile label="Cofre XML" value={config.secureStoragePathLabel} tone="success" />
            <InfoTile label="Certificado" value="A1 PKCS#12" tone="warning" />
            <InfoTile label="Status certificado" value={certificateStatusLabel(config.certificateStatus)} tone="warning" />
            <InfoTile label="Expiracao" value={config.certificateExpiresAt ?? "Nao informado"} tone="warning" />
            <InfoTile label="Proxima sync" value={formatDateTime(config.nextScheduledSyncAt)} tone="info" />
          </div>

          <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-3">
            <FlowCard
              icon={<KeyRound className="h-5 w-5" />}
              title="A) Sync via certificado"
              description="Carrega A1 por env/config, valida expiracao, consulta periodos/protocolos no bridge PHP e grava retornos em storage privado."
              actions={["Validar certificado", "Sincronizar periodo", "Consultar protocolos"]}
            />
            <FlowCard
              icon={<CloudUpload className="h-5 w-5" />}
              title="B) Importacao XML"
              description="Upload multiplo, valida estrutura eSocial, identifica evento, calcula hash, armazena XML bruto criptografado e normaliza para BI."
              actions={["Selecionar XMLs", "Validar estrutura", "Normalizar eventos"]}
            />
            <FlowCard
              icon={<DatabaseZap className="h-5 w-5" />}
              title="Camada BI central"
              description="Atualiza trabalhadores, vinculos, rubricas, pagamentos, snapshots mensais e alocacoes consumidas por Pessoas e Financeiro."
              actions={["Workforce summary", "Payroll summary", "Ranking e tendencia"]}
            />
          </div>
        </HudPanel>

        <HudPanel
          title="Console de rejeicoes"
          subtitle="Somente metadados seguros; CPF/CNPJ e XML bruto nao aparecem na UI."
          icon={<AlertTriangle className="h-4 w-4" />}
          iconTint="#F59E0B"
          elevation={3}
          state="warning"
        >
          <div className="space-y-3">
            {errors.map((error) => (
              <div
                key={error.id}
                className="rounded-lg border border-ig-border-subtle bg-ig-panel/70 px-3 py-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <HudStatusPill variant={error.severity === "error" ? "error" : "warning"} size="sm">
                      {error.eventType ?? "Evento"}
                    </HudStatusPill>
                    <span className="truncate font-mono text-[11px] text-ig-fg-subtle">{error.safeCode}</span>
                  </div>
                  <span className="shrink-0 text-[10px] text-ig-fg-subtle">{formatDateTime(error.occurredAt)}</span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-ig-fg-muted">{error.safeMessage}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <HudButton variant="secondary" size="sm" leftIcon={<History className="h-4 w-4" />}>
              Ver historico
            </HudButton>
            <HudButton variant="danger" size="sm" leftIcon={<FileWarning className="h-4 w-4" />}>
              Ver erros
            </HudButton>
          </div>
        </HudPanel>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[0.85fr_1.15fr]">
        <HudPanel
          title="Importacao manual XML"
          subtitle="Fundacao de upload, validacao, deduplicacao e normalizacao."
          icon={<Upload className="h-4 w-4" />}
          iconTint="#38BDF8"
          elevation={2}
        >
          <div className="rounded-xl border border-dashed border-ig-border-strong bg-ig-panel/60 p-5 text-center">
            <CloudUpload className="mx-auto h-9 w-9 text-ig-info" />
            <p className="mt-3 text-sm font-medium text-ig-fg-strong">Solte XMLs eSocial aqui ou selecione multiplos arquivos</p>
            <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-ig-fg-muted">
              O fluxo previsto valida estrutura, identifica S-1200/S-1210/S-2200/S-2299, grava XML bruto em storage privado e exibe apenas metadados mascarados.
            </p>
            <div className="mt-4">
              <HudButton variant="glass" size="sm" leftIcon={<Upload className="h-4 w-4" />}>
                Importar XMLs
              </HudButton>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <MiniStat label="Arquivos" value={importSummary.filesProcessed} />
            <MiniStat label="Eventos" value={importSummary.eventsImported} />
            <MiniStat label="Duplicados" value={importSummary.duplicatesIgnored} />
            <MiniStat label="Periodo" value={importSummary.periodDetected} />
          </div>

          <div className="mt-4 space-y-2">
            {Object.entries(importSummary.eventTypes).map(([eventType, count]) => (
              <div key={eventType} className="flex items-center justify-between gap-3">
                <span className="font-mono text-xs text-ig-fg-muted">{eventType}</span>
                <div className="flex flex-1 items-center gap-3">
                  <HudProgressBar value={(count / importSummary.eventsImported) * 100} size="sm" />
                  <span className="w-8 text-right font-mono text-xs text-ig-fg-strong">{count}</span>
                </div>
              </div>
            ))}
          </div>
        </HudPanel>

        <HudPanel
          title="Timeline de sincronizacao"
          subtitle="Runs recentes, origem, protocolos e sumarizacao segura."
          icon={<CalendarClock className="h-4 w-4" />}
          iconTint="#A78BFA"
          elevation={2}
        >
          <div className="relative space-y-3 before:absolute before:left-[11px] before:top-2 before:h-[calc(100%-1rem)] before:w-px before:bg-ig-border-subtle">
            {syncRuns.map((run) => (
              <div key={run.id} className="relative flex gap-3 pl-8">
                <span className="absolute left-0 top-2 flex h-6 w-6 items-center justify-center rounded-full border border-ig-border-strong bg-ig-bg-raised text-ig-accent">
                  {run.status === "completed" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <RefreshCcw className="h-3.5 w-3.5" />}
                </span>
                <div className="w-full rounded-lg border border-ig-border-subtle bg-ig-panel/60 px-3 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ig-fg-strong">{run.id}</p>
                      <p className="mt-0.5 text-xs text-ig-fg-muted">
                        {run.source === "manual_xml" ? "Importacao XML" : "Sync certificado"} | {run.periodFrom} a {run.periodTo}
                      </p>
                    </div>
                    <HudStatusPill variant={statusVariant[run.status]} size="sm">
                      {statusLabel[run.status]}
                    </HudStatusPill>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-5">
                    <RunMetric label="Eventos" value={run.eventsImported} />
                    <RunMetric label="Duplicados" value={run.duplicatesIgnored} />
                    <RunMetric label="Erros" value={run.errorsCount} />
                    <RunMetric label="Rejeicoes" value={run.rejectedEventsCount} />
                    <RunMetric label="Protocolos" value={run.protocolCount} />
                  </div>
                  <p className="mt-3 text-xs leading-relaxed text-ig-fg-muted">{run.safeMessage}</p>
                </div>
              </div>
            ))}
          </div>
        </HudPanel>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <ConsumerCard
          title="Pessoas & Custos"
          description="Headcount, ativos, admissoes, desligamentos, tenure, turnover, PJ vs CLT, overtime, custo por colaborador, concentracao e alertas."
          metrics={[
            ["Ativos", workforce.activeEmployees],
            ["Turnover", `${workforce.turnoverPercent.toFixed(1)}%`],
            ["PJ", workforce.pjCount],
          ]}
        />
        <ConsumerCard
          title="Financeiro > Folha & Alocacao"
          description="Folha bruta, remuneracao por competencia, rubricas, overtime, beneficios, bases/encargos, departamentos, projetos, lotes e DRE."
          metrics={[
            ["Custo total", fmtCurrency.format(payroll.totalCost)],
            ["Encargos", fmtCurrency.format(payroll.taxesCharges)],
            ["DRE", fmtCurrency.format(payroll.dreImpactAmount)],
          ]}
        />
        <ConsumerCard
          title="Contrato futuro PHP"
          description="HTTP interno, CLI worker, job agendado, fila e webhook/result callback para operar o engine nfephp-org/sped-esocial."
          metrics={[
            ["Health", "/api/integrations/esocial/health"],
            ["Sync", "POST /sync"],
            ["Resumo", "GET /payroll-summary"],
          ]}
        />
      </section>
    </HudPageLayout>
  );
}

function certificateStatusLabel(status: string) {
  const labels: Record<string, string> = {
    not_configured: "Nao configurado",
    valid: "Valido",
    expiring: "Expirando",
    expired: "Expirado",
    invalid: "Invalido",
  };
  return labels[status] ?? status;
}

function InfoTile({ label, value, tone }: { label: string; value: string; tone: "accent" | "info" | "success" | "warning" | "neutral" }) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-ig-panel/70 px-3 py-3",
        tone === "accent" && "border-ig-border-focus",
        tone === "info" && "border-[color-mix(in_oklab,var(--ig-info)_26%,transparent)]",
        tone === "success" && "border-[color-mix(in_oklab,var(--ig-success)_26%,transparent)]",
        tone === "warning" && "border-[color-mix(in_oklab,var(--ig-warning)_30%,transparent)]",
        tone === "neutral" && "border-ig-border-subtle",
      )}
    >
      <p className="text-[10px] uppercase tracking-[0.12em] text-ig-fg-subtle">{label}</p>
      <p className="mt-1 truncate font-mono text-xs text-ig-fg-strong">{value}</p>
    </div>
  );
}

function FieldBlock({ label, help, children }: { label: string; help: string; children: React.ReactNode }) {
  return (
    <div className="block rounded-xl border border-ig-border-subtle bg-ig-panel/55 p-3">
      <span className="text-xs font-semibold text-ig-fg-strong">{label}</span>
      <span className="mt-0.5 block min-h-[2rem] text-[11px] leading-relaxed text-ig-fg-muted">{help}</span>
      <span className="mt-2 block">{children}</span>
    </div>
  );
}

function InfoRow({ label, value, tone }: { label: string; value: string; tone: "info" | "warning" | "neutral" }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-ig-border-subtle bg-ig-surface-subtle/40 px-3 py-2">
      <span className="text-xs text-ig-fg-muted">{label}</span>
      <span
        className={cn(
          "max-w-[58%] truncate text-right font-mono text-xs font-semibold",
          tone === "info" && "text-ig-info",
          tone === "warning" && "text-ig-warning",
          tone === "neutral" && "text-ig-fg-strong",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function FlowCard({ icon, title, description, actions }: { icon: React.ReactNode; title: string; description: string; actions: string[] }) {
  return (
    <div className="rounded-xl border border-ig-border-subtle bg-ig-panel/55 p-4">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-ig-border-focus bg-ig-accent-weak text-ig-accent">
          {icon}
        </span>
        <h3 className="text-sm font-semibold text-ig-fg-strong">{title}</h3>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-ig-fg-muted">{description}</p>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {actions.map((action) => (
          <HudStatusPill key={action} variant="neutral" size="sm">
            {action}
          </HudStatusPill>
        ))}
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-ig-border-subtle bg-ig-panel/70 px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.1em] text-ig-fg-subtle">{label}</p>
      <p className="mt-1 font-mono text-sm font-semibold text-ig-fg-strong">{value}</p>
    </div>
  );
}

function RunMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-ig-surface-subtle/50 px-2 py-1.5">
      <p className="text-[9px] uppercase tracking-[0.1em] text-ig-fg-subtle">{label}</p>
      <p className="font-mono text-xs font-semibold text-ig-fg-strong">{value}</p>
    </div>
  );
}

function ConsumerCard({ title, description, metrics }: { title: string; description: string; metrics: Array<[string, string | number]> }) {
  return (
    <HudCard elevation={2}>
      <HudCardHeader>
        <HudCardTitle>{title}</HudCardTitle>
      </HudCardHeader>
      <HudCardContent>
        <p className="min-h-[4rem] text-sm leading-relaxed text-ig-fg-muted">{description}</p>
        <div className="mt-4 grid grid-cols-1 gap-2">
          {metrics.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-3 rounded-lg border border-ig-border-subtle bg-ig-panel/60 px-3 py-2">
              <span className="text-xs text-ig-fg-muted">{label}</span>
              <span className="max-w-[70%] truncate text-right font-mono text-xs font-semibold text-ig-fg-strong">{value}</span>
            </div>
          ))}
        </div>
      </HudCardContent>
    </HudCard>
  );
}
