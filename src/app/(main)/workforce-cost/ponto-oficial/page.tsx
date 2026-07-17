'use client';

/**
 * Ponto Oficial (REP-P) — módulo fiscal vendável (Fase 9, spec §22.2).
 * Configuração do empregador, exportação do AFD (Portaria 671), espelho
 * de ponto mensal, comprovante por marcação e trilha imutável de
 * exportações. NSR + hash encadeado são atribuídos pelo banco (052).
 *
 * ⚠️ Uso fiscal requer homologação: validação do layout AFD contra o
 * Anexo oficial, assinatura ICP-Brasil e atestado técnico do desenvolvedor.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BadgeCheck,
  Download,
  FileBadge,
  FileText,
  Printer,
  Receipt,
  ShieldCheck,
} from 'lucide-react';
import {
  HudBadge,
  HudButton,
  HudEmptyState,
  HudHeader,
  HudInput,
  HudKpiStrip,
  HudPageLayout,
  HudPanel,
  HudSelect,
  HudStatusPill,
  HudTable,
  useHudToast,
  type HudTableColumn,
  type KpiItem,
} from '@/components/hud';
import { usePermissions } from '@/hooks/use-permissions';
import type { AttendancePunch, Person, RepFileExport, RepSettings } from '@/lib/types/people';
import { PUNCH_TYPE_LABELS } from '@/lib/types/people';
import {
  downloadTextFile,
  getRepSettings,
  listRepExports,
  openPrintWindow,
  registerRepExport,
  sha256Hex,
  upsertRepSettings,
} from '@/lib/rep/rep';
import { buildAfd } from '@/lib/rep/afd';
import { buildEspelhoHtml } from '@/lib/rep/espelho';
import { buildComprovanteHtml } from '@/lib/rep/comprovante';
import { buildJourneys, listPunches } from '@/lib/services/journey';
import { listPeople } from '@/lib/services/people';
import { monthBounds } from '@/lib/services/capacity';

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}
function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

const FILE_TYPE_LABEL: Record<RepFileExport['fileType'], string> = {
  afd: 'AFD',
  aej: 'AEJ',
  espelho: 'Espelho de ponto',
  comprovante: 'Comprovante',
};

export default function PontoOficialPage() {
  const { hasPermission } = usePermissions();
  const { notify } = useHudToast();
  const canManage = hasPermission('people.rep_manage');

  const [settings, setSettings] = useState<RepSettings | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [exportsLog, setExportsLog] = useState<RepFileExport[]>([]);
  const [loading, setLoading] = useState(true);

  // settings form
  const [employerName, setEmployerName] = useState('');
  const [employerId, setEmployerId] = useState('');
  const [employerIdType, setEmployerIdType] = useState<'cnpj' | 'cpf'>('cnpj');
  const [active, setActive] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  // AFD form
  const [afdStart, setAfdStart] = useState(`${currentMonth()}-01`);
  const [afdEnd, setAfdEnd] = useState(new Date().toISOString().slice(0, 10));
  const [busyAfd, setBusyAfd] = useState(false);

  // espelho form
  const [espelhoPerson, setEspelhoPerson] = useState('');
  const [espelhoMonth, setEspelhoMonth] = useState(currentMonth());
  const [busyEspelho, setBusyEspelho] = useState(false);

  // comprovante
  const [compPunches, setCompPunches] = useState<AttendancePunch[]>([]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [s, p, ex] = await Promise.all([
        getRepSettings().catch(() => null),
        listPeople({ status: 'active' }).catch(() => [] as Person[]),
        listRepExports().catch(() => [] as RepFileExport[]),
      ]);
      setSettings(s);
      setPeople(p);
      setExportsLog(ex);
      if (s) {
        setEmployerName(s.employerName);
        setEmployerId(s.employerId);
        setEmployerIdType(s.employerIdType);
        setActive(s.active);
      }
      if (p.length > 0) setEspelhoPerson((cur) => cur || p[0].id);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const peopleById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const peopleWithoutCpf = useMemo(() => people.filter((p) => !p.cpf).length, [people]);

  const configured = Boolean(settings?.employerId && settings?.employerName);

  const kpis: KpiItem[] = [
    {
      id: 'status',
      label: 'Módulo',
      value: settings?.active ? 'Ativo' : 'Inativo',
      variant: settings?.active ? 'success' : 'warning',
      tintValue: true,
      icon: <BadgeCheck className="h-4 w-4" />,
    },
    {
      id: 'employer',
      label: 'Empregador',
      value: configured ? 'Configurado' : 'Pendente',
      variant: configured ? 'success' : 'danger',
    },
    {
      id: 'cpfs',
      label: 'Pessoas sem CPF',
      value: peopleWithoutCpf,
      variant: peopleWithoutCpf > 0 ? 'warning' : 'success',
    },
    { id: 'exports', label: 'Arquivos gerados', value: exportsLog.length, icon: <FileText className="h-4 w-4" /> },
  ];

  async function handleSaveSettings() {
    if (!employerName.trim() || !employerId.trim()) {
      notify('Informe razão social e CNPJ/CPF do empregador', { variant: 'warning' });
      return;
    }
    setSavingSettings(true);
    try {
      const saved = await upsertRepSettings({
        employerIdType,
        employerId,
        employerName,
        active,
      });
      setSettings(saved);
      notify('Configuração salva', { variant: 'success' });
    } catch (e) {
      notify('Erro ao salvar', { description: e instanceof Error ? e.message : undefined, variant: 'error' });
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleGenerateAfd() {
    if (!settings || !configured) {
      notify('Configure o empregador antes de gerar o AFD', { variant: 'warning' });
      return;
    }
    if (afdEnd < afdStart) return notify('Período inválido', { variant: 'warning' });
    setBusyAfd(true);
    try {
      const punches = await listPunches(afdStart, afdEnd);
      const afd = buildAfd(settings, punches, afdStart, afdEnd);
      if (afd.recordCount === 0) {
        notify('Nenhuma marcação elegível no período', {
          description:
            afd.skippedWithoutCpf > 0
              ? `${afd.skippedWithoutCpf} marcação(ões) ignorada(s) por falta de CPF no cadastro.`
              : 'Não há marcações com NSR no período.',
          variant: 'warning',
        });
        return;
      }
      const hash = await sha256Hex(afd.content);
      downloadTextFile(afd.fileName, afd.content);
      await registerRepExport({
        fileType: 'afd',
        periodStart: afdStart,
        periodEnd: afdEnd,
        fileName: afd.fileName,
        sha256: hash,
        recordCount: afd.recordCount,
        params: { skipped_without_cpf: afd.skippedWithoutCpf },
      });
      notify('AFD gerado', {
        description: `${afd.recordCount} marcação(ões) · SHA-256 ${hash.slice(0, 12)}…${
          afd.skippedWithoutCpf > 0 ? ` · ${afd.skippedWithoutCpf} sem CPF ignoradas` : ''
        }`,
        variant: 'success',
      });
      await reload();
    } catch (e) {
      notify('Erro ao gerar AFD', { description: e instanceof Error ? e.message : undefined, variant: 'error' });
    } finally {
      setBusyAfd(false);
    }
  }

  async function handleEspelho() {
    const person = peopleById.get(espelhoPerson);
    if (!settings || !person) return notify('Selecione o colaborador', { variant: 'warning' });
    setBusyEspelho(true);
    try {
      const [start, end] = monthBounds(espelhoMonth);
      const punches = await listPunches(start, end, person.id);
      const journeys = buildJourneys(person, punches);
      const { html, recordCount } = buildEspelhoHtml(settings, person, espelhoMonth, journeys, punches);
      openPrintWindow(`Espelho de ponto — ${person.fullName} — ${espelhoMonth}`, html);
      const hash = await sha256Hex(html);
      await registerRepExport({
        fileType: 'espelho',
        periodStart: start,
        periodEnd: end,
        personId: person.id,
        fileName: `ESPELHO_${espelhoMonth}_${person.fullName.replace(/\s+/g, '_')}.html`,
        sha256: hash,
        recordCount,
      });
      await reload();
    } catch (e) {
      notify('Erro ao gerar espelho', { description: e instanceof Error ? e.message : undefined, variant: 'error' });
    } finally {
      setBusyEspelho(false);
    }
  }

  async function loadComprovantes() {
    const person = peopleById.get(espelhoPerson);
    if (!person) return;
    const [start, end] = monthBounds(espelhoMonth);
    setCompPunches(await listPunches(start, end, person.id));
  }

  function printComprovante(punch: AttendancePunch) {
    if (!settings) return;
    const withPerson = { ...punch, person: punch.person ?? peopleById.get(punch.personId) };
    openPrintWindow(`Comprovante NSR ${punch.nsr ?? ''}`, buildComprovanteHtml(settings, withPerson));
    void registerRepExport({
      fileType: 'comprovante',
      personId: punch.personId,
      fileName: `COMPROVANTE_NSR_${punch.nsr ?? 'sem-nsr'}.html`,
      sha256: punch.integrityHash ?? 'n/a',
      recordCount: 1,
    }).then(reload);
  }

  const exportColumns: HudTableColumn<RepFileExport>[] = [
    {
      key: 'type',
      header: 'Arquivo',
      cell: (r) => (
        <div>
          <p className="text-sm font-medium text-ig-fg-strong">{FILE_TYPE_LABEL[r.fileType]}</p>
          <p className="max-w-64 truncate font-mono text-[11px] text-ig-fg-muted" title={r.fileName}>{r.fileName}</p>
        </div>
      ),
    },
    {
      key: 'period',
      header: 'Período',
      cell: (r) => (
        <span className="text-xs tabular-nums text-ig-fg-muted">
          {r.periodStart ? `${r.periodStart} → ${r.periodEnd ?? ''}` : '—'}
        </span>
      ),
    },
    {
      key: 'records',
      header: 'Registros',
      align: 'right',
      cell: (r) => <span className="text-sm tabular-nums text-ig-fg-strong">{r.recordCount}</span>,
    },
    {
      key: 'sha',
      header: 'SHA-256',
      cell: (r) => (
        <span className="font-mono text-[11px] text-ig-fg-muted" title={r.sha256}>
          {r.sha256.slice(0, 16)}…
        </span>
      ),
    },
    {
      key: 'when',
      header: 'Gerado em',
      cell: (r) => (
        <span className="text-xs tabular-nums text-ig-fg-muted">
          {new Date(r.generatedAt).toLocaleString('pt-BR')}
        </span>
      ),
    },
  ];

  if (!canManage) {
    return (
      <HudPageLayout>
        <HudPanel>
          <HudEmptyState
            icon="alert"
            title="Sem acesso ao módulo"
            description="O Ponto Oficial (REP-P) requer a permissão people.rep_manage."
          />
        </HudPanel>
      </HudPageLayout>
    );
  }

  return (
    <HudPageLayout>
      <div className="space-y-6">
        <HudHeader
          title="Ponto Oficial (REP-P)"
          subtitle="Módulo fiscal — Portaria 671: NSR, hash encadeado, AFD, espelho e comprovantes"
          icon={<FileBadge className="h-5 w-5" />}
          breadcrumbs={[{ label: 'Pessoas & Custos', href: '/workforce-cost' }, { label: 'Ponto Oficial' }]}
        />

        <div className="flex items-start gap-2 rounded-lg border border-[color-mix(in_oklab,var(--ig-warning)_32%,transparent)] bg-[color-mix(in_oklab,var(--ig-warning)_10%,transparent)] px-4 py-3">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-ig-warning" />
          <p className="text-xs text-ig-warning">
            <strong>Homologação:</strong> antes do uso como registro oficial de jornada, valide o
            layout do AFD contra o Anexo da Portaria 671, acople a assinatura ICP-Brasil (certificado
            do empregador) e emita o atestado técnico do desenvolvedor. A infraestrutura fiscal
            (NSR sequencial, imutabilidade e hash encadeado) já é aplicada pelo banco.
          </p>
        </div>

        <HudKpiStrip kpis={kpis} columns={4} />

        {/* Configuração do empregador */}
        <HudPanel title="Empregador (cabeçalho dos arquivos fiscais)" accentColor="emerald">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <HudInput label="Razão social" value={employerName} onChange={(e) => setEmployerName(e.target.value)} />
            <HudSelect
              label="Tipo de identificador"
              value={employerIdType}
              onChange={(v) => setEmployerIdType(v as 'cnpj' | 'cpf')}
              options={[
                { value: 'cnpj', label: 'CNPJ' },
                { value: 'cpf', label: 'CPF' },
              ]}
            />
            <HudInput
              label={employerIdType.toUpperCase()}
              value={employerId}
              onChange={(e) => setEmployerId(e.target.value)}
              placeholder={employerIdType === 'cnpj' ? '00.000.000/0000-00' : '000.000.000-00'}
            />
            <div className="flex items-end gap-3 pb-1">
              <label className="flex items-center gap-2 text-sm text-ig-fg-muted">
                <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4 accent-[var(--ig-accent)]" />
                Módulo ativo
              </label>
              <HudButton variant="primary" onClick={() => void handleSaveSettings()} disabled={savingSettings}>
                {savingSettings ? 'Salvando…' : 'Salvar'}
              </HudButton>
            </div>
          </div>
          {peopleWithoutCpf > 0 && (
            <p className="mt-3 text-xs text-ig-warning">
              {peopleWithoutCpf} colaborador(es) sem CPF — marcações deles ficam fora do AFD.
              Complete em Pessoas &amp; Custos → Pessoas.
            </p>
          )}
        </HudPanel>

        {/* AFD */}
        <HudPanel title="AFD — Arquivo-Fonte de Dados" accentColor="emerald">
          <div className="flex flex-wrap items-end gap-3">
            <HudInput label="Início" type="date" value={afdStart} onChange={(e) => setAfdStart(e.target.value)} />
            <HudInput label="Fim" type="date" value={afdEnd} onChange={(e) => setAfdEnd(e.target.value)} />
            <HudButton
              variant="primary"
              leftIcon={<Download className="h-4 w-4" />}
              onClick={() => void handleGenerateAfd()}
              disabled={busyAfd || !configured}
            >
              {busyAfd ? 'Gerando…' : 'Gerar e baixar AFD'}
            </HudButton>
            {!configured && <HudBadge variant="warning">configure o empregador primeiro</HudBadge>}
          </div>
          <p className="mt-3 text-[11px] text-ig-fg-muted">
            Registros tipo 7 (marcação REP-P) com NSR, CPF, data/hora com fuso e hash SHA-256
            encadeado. O SHA-256 do arquivo fica registrado na trilha abaixo.
          </p>
        </HudPanel>

        {/* Espelho + comprovantes */}
        <HudPanel title="Espelho de ponto e comprovantes" accentColor="emerald">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-64">
              <HudSelect
                label="Colaborador"
                value={espelhoPerson}
                onChange={(v) => {
                  setEspelhoPerson(v);
                  setCompPunches([]);
                }}
                options={people.map((p) => ({
                  value: p.id,
                  label: `${p.fullName}${p.cpf ? '' : ' (sem CPF)'}`,
                }))}
              />
            </div>
            <HudSelect
              label="Competência"
              value={espelhoMonth}
              onChange={(v) => {
                setEspelhoMonth(v);
                setCompPunches([]);
              }}
              options={[-2, -1, 0].map((i) => {
                const m = addMonths(currentMonth(), i);
                return { value: m, label: monthLabel(m) };
              })}
              fullWidth={false}
            />
            <HudButton
              variant="primary"
              leftIcon={<Printer className="h-4 w-4" />}
              onClick={() => void handleEspelho()}
              disabled={busyEspelho || !configured}
            >
              {busyEspelho ? 'Gerando…' : 'Imprimir espelho'}
            </HudButton>
            <HudButton
              variant="secondary"
              leftIcon={<Receipt className="h-4 w-4" />}
              onClick={() => void loadComprovantes()}
              disabled={!configured}
            >
              Listar marcações p/ comprovante
            </HudButton>
          </div>

          {compPunches.length > 0 && (
            <div className="mt-4 space-y-1.5">
              {compPunches.map((p) => (
                <div
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-ig-border-subtle bg-ig-panel/60 px-3 py-2"
                >
                  <span className="text-sm text-ig-fg-strong">
                    {new Date(p.occurredAt).toLocaleString('pt-BR')} · {PUNCH_TYPE_LABELS[p.type]}
                    <span className="ml-2 font-mono text-[11px] text-ig-fg-muted">
                      NSR {p.nsr ?? '—'}
                    </span>
                  </span>
                  <div className="flex items-center gap-2">
                    <HudStatusPill size="sm" variant={p.status === 'accepted' ? 'active' : 'warning'}>
                      {p.status}
                    </HudStatusPill>
                    <HudButton variant="ghost" size="sm" onClick={() => printComprovante(p)}>
                      Comprovante
                    </HudButton>
                  </div>
                </div>
              ))}
            </div>
          )}
        </HudPanel>

        {/* Trilha de exportações */}
        <HudPanel title="Trilha de arquivos fiscais (imutável)" accentColor="emerald">
          <HudTable<RepFileExport>
            columns={exportColumns}
            data={exportsLog}
            keyExtractor={(r) => r.id}
            loading={loading}
            compact
            emptyState={
              <HudEmptyState
                icon="file"
                compact
                title="Nenhum arquivo gerado"
                description="AFDs, espelhos e comprovantes gerados aparecem aqui com SHA-256 e autor."
              />
            }
          />
        </HudPanel>
      </div>
    </HudPageLayout>
  );
}
