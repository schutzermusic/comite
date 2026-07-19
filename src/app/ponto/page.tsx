'use client';

/**
 * Portal de Ponto Web (ponto.insightapex.co) — versão navegador do app do
 * colaborador. Reusa /api/mobile/* com o token da sessão web (geofence,
 * evidências, NSR fiscal). Ao dar ENTRADA, o colaborador escolhe o
 * projeto e a etapa do cronograma (WBS) — a jornada e o apontamento
 * começam juntos. Ponto exige biometria do aparelho (Face ID/Touch ID via
 * WebAuthn) quando suportada. Localização capturada só no evento.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Briefcase, Clock, Fingerprint, LayoutList, LogOut, MapPin, Play, ShieldCheck, Square, X } from 'lucide-react';
import { createClient } from '@/utils/supabase/client';
import {
  biometricsSupported,
  captureLocation,
  enrollBiometric,
  nextPunchOptions,
  pontoApi,
  PUNCH_LABEL,
  uuid,
  verifyBiometric,
  type PontoBootstrap,
  type PunchType,
  type TimelineStage,
} from '@/lib/ponto/client';

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function elapsedLabel(startedAt: string, now: number): string {
  const secs = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  const h = String(Math.floor(secs / 3600)).padStart(2, '0');
  const m = String(Math.floor((secs % 3600) / 60)).padStart(2, '0');
  const s = String(secs % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}
const SHORT_PUNCH: Record<PunchType, string> = {
  clock_in: 'Entrada',
  break_start: 'Intervalo',
  break_end: 'Retorno',
  clock_out: 'Saída',
};
type Tone = 'ok' | 'warn' | 'err';
type Alloc = PontoBootstrap['allocations'][number];

export default function PontoPage() {
  const router = useRouter();
  const [state, setState] = useState<PontoBootstrap | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: Tone } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [needsEnroll, setNeedsEnroll] = useState(false);

  // folha de seleção de projeto/etapa ao dar entrada
  const [entryOpen, setEntryOpen] = useState(false);
  const [selProject, setSelProject] = useState<string | null>(null);
  const [selStage, setSelStage] = useState<string | null>(null);
  const [entryStages, setEntryStages] = useState<TimelineStage[]>([]);
  const [stagesLoading, setStagesLoading] = useState(false);

  const biometrics = useMemo(() => biometricsSupported(), []);

  const load = useCallback(async () => {
    try {
      setState(await pontoApi.bootstrap());
      setMessage(null);
    } catch (e) {
      const text = e instanceof Error ? e.message : 'Erro ao carregar';
      if (/Sessão expirada/i.test(text)) return router.replace('/ponto/login');
      setMessage({ text, tone: 'err' });
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!state?.runningSession) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [state?.runningSession]);

  const punches = state?.punches ?? [];
  const allocations = state?.allocations ?? [];
  const running = state?.runningSession ?? null;
  const last = punches.length ? punches[punches.length - 1].type : null;
  const options = nextPunchOptions(last);
  const firstName = state?.person?.full_name?.split(' ')[0] ?? 'colaborador';
  const runningAllocation = useMemo(
    () => (running ? allocations.find((a) => a.project_id === running.project_id) : null),
    [running, allocations],
  );

  /* ── biometria ── */
  async function ensureBiometric(): Promise<string | undefined> {
    if (!biometrics) return undefined;
    try {
      return await verifyBiometric();
    } catch (e) {
      if ((e as { needsEnroll?: boolean }).needsEnroll) {
        setNeedsEnroll(true);
        throw new Error('Cadastre o Face ID/Touch ID deste aparelho para bater o ponto.');
      }
      throw e instanceof Error ? e : new Error('Biometria não confirmada');
    }
  }

  async function handleEnroll() {
    setBusy(true);
    setMessage(null);
    try {
      await enrollBiometric();
      setNeedsEnroll(false);
      setMessage({ text: 'Biometria cadastrada neste aparelho. Já pode bater o ponto.', tone: 'ok' });
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : 'Falha ao cadastrar biometria', tone: 'err' });
    } finally {
      setBusy(false);
    }
  }

  /* ── marcação (jornada) + apontamento opcional (projeto/etapa) ── */
  async function doPunch(type: PunchType, activity?: { projectId: string; stageId: string | null }) {
    setBusy(true);
    setMessage(null);
    try {
      const authenticationEvidenceId = await ensureBiometric().catch((e) => {
        throw e;
      });
      const location = await captureLocation();
      const res = await pontoApi.punch({
        type,
        clientEventId: uuid(),
        occurredAt: new Date().toISOString(),
        location: location ?? undefined,
        authenticationEvidenceId,
      });
      if (activity) {
        await pontoApi.activity({ action: 'start', projectId: activity.projectId, timelineItemId: activity.stageId ?? undefined });
      }
      if (res.needsReview) {
        setMessage({ text: 'Ponto registrado — em revisão (fora da área autorizada).', tone: 'warn' });
      } else if (!location) {
        setMessage({ text: 'Ponto registrado sem localização — permita o acesso para validar a área.', tone: 'warn' });
      } else {
        setMessage({ text: activity ? 'Entrada e apontamento registrados.' : 'Ponto registrado.', tone: 'ok' });
      }
      await load();
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : 'Erro ao registrar', tone: 'err' });
    } finally {
      setBusy(false);
    }
  }

  /** Entrada: se há alocações, abre a seleção de projeto/etapa; senão, bate direto. */
  async function handlePunchButton(type: PunchType) {
    if (type === 'clock_in' && allocations.length > 0) {
      const first = allocations[0];
      setSelProject(first.project_id);
      setSelStage(null);
      setEntryOpen(true);
      void loadStages(first.project_id);
      return;
    }
    await doPunch(type);
  }

  async function loadStages(projectId: string) {
    setStagesLoading(true);
    setEntryStages([]);
    try {
      const { items } = await pontoApi.timeline(projectId);
      setEntryStages(items);
    } catch {
      setEntryStages([]);
    } finally {
      setStagesLoading(false);
    }
  }

  async function confirmEntry(withProject: boolean) {
    setEntryOpen(false);
    if (withProject && selProject) {
      await doPunch('clock_in', { projectId: selProject, stageId: selStage });
    } else {
      await doPunch('clock_in');
    }
  }

  async function stopActivity() {
    setBusy(true);
    try {
      await pontoApi.activity({ action: 'stop' });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    await createClient().auth.signOut();
    router.replace('/ponto/login');
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0C1116]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[rgba(141,162,181,0.3)] border-t-[#22C08D]" />
      </main>
    );
  }

  const selectedAlloc = allocations.find((a) => a.project_id === selProject) as Alloc | undefined;

  return (
    <main className="min-h-screen bg-[#0C1116] text-[#E8EEF2]">
      <div className="mx-auto w-full max-w-md px-6 pb-16 pt-10">
        <header className="mb-6 flex items-start justify-between">
          <div>
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#22C08D]">
              <Clock className="h-3.5 w-3.5" /> Insight Ponto
            </p>
            <h1 className="mt-1 text-2xl font-extrabold tracking-tight">Olá, {firstName}</h1>
            <p className="text-sm capitalize text-[#8DA2B5]">
              {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
          </div>
          <button type="button" onClick={handleSignOut} className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-[#5C7186] hover:text-[#8DA2B5]">
            <LogOut className="h-3.5 w-3.5" /> Sair
          </button>
        </header>

        {message && (
          <div className={`mb-4 rounded-xl px-4 py-3 text-sm ${message.tone === 'ok' ? 'bg-[rgba(34,192,141,0.12)] text-[#22C08D]' : message.tone === 'warn' ? 'bg-[rgba(217,161,59,0.12)] text-[#D9A13B]' : 'bg-[rgba(219,92,110,0.12)] text-[#DB5C6E]'}`}>
            {message.text}
          </div>
        )}

        {biometrics && needsEnroll && (
          <button type="button" onClick={handleEnroll} disabled={busy} className="mb-4 flex w-full items-center justify-center gap-2 rounded-xl border border-[rgba(34,192,141,0.4)] bg-[rgba(34,192,141,0.1)] py-3.5 text-sm font-bold text-[#22C08D] disabled:opacity-60">
            <Fingerprint className="h-4 w-4" /> Cadastrar Face ID / Touch ID neste aparelho
          </button>
        )}

        {/* jornada de hoje */}
        <section className="rounded-2xl border border-[rgba(141,162,181,0.16)] bg-[#121A22] p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#8DA2B5]">Jornada de hoje</p>
          {punches.length === 0 ? (
            <p className="mt-3 text-sm text-[#5C7186]">Nenhuma marcação ainda.</p>
          ) : (
            <ul className="mt-3 space-y-1.5">
              {punches.map((p) => (
                <li key={p.id} className="flex items-center gap-3">
                  <span className="w-12 text-[15px] font-bold tabular-nums">{fmtTime(p.occurred_at)}</span>
                  <span className="h-2 w-2 rounded-full bg-[#22C08D]" />
                  <span className="flex-1 text-sm text-[#8DA2B5]">{SHORT_PUNCH[p.type]}</span>
                  {p.status === 'under_review' && <span className="rounded-full bg-[rgba(217,161,59,0.14)] px-2 py-0.5 text-[10px] font-bold text-[#D9A13B]">em revisão</span>}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* botões de ponto */}
        <section className="mt-4 space-y-3">
          {options.map((type) => (
            <button
              key={type}
              type="button"
              disabled={busy}
              onClick={() => void handlePunchButton(type)}
              className={`flex w-full items-center justify-center gap-2 rounded-xl py-4 text-base font-bold transition-opacity disabled:opacity-60 ${type === 'clock_in' || type === 'break_end' ? 'bg-[#22C08D] text-[#07120E]' : 'border border-[rgba(141,162,181,0.3)] bg-[#121A22] text-[#E8EEF2]'}`}
            >
              {biometrics && <Fingerprint className="h-4 w-4 opacity-70" />}
              {busy ? 'Confirmando…' : PUNCH_LABEL[type]}
              {type === 'clock_in' && allocations.length > 0 && <span className="text-xs font-medium opacity-70">· escolher projeto</span>}
            </button>
          ))}
          <p className="flex items-center justify-center gap-1.5 text-center text-[11px] text-[#5C7186]">
            {biometrics ? <ShieldCheck className="h-3 w-3" /> : <MapPin className="h-3 w-3" />}
            {biometrics ? 'Confirmação por Face ID/Touch ID + localização, ao registrar.' : 'A localização é capturada apenas ao registrar, para validar a área.'}
          </p>
          {allocations.length === 0 && (
            <p className="rounded-xl bg-[rgba(141,162,181,0.08)] px-4 py-3 text-center text-xs text-[#8DA2B5]">
              Você ainda não está alocado em um projeto, então a entrada registra só a jornada.
              Peça ao gestor para alocar você no projeto para apontar as horas.
            </p>
          )}
        </section>

        {/* atividade em andamento / trocar de projeto */}
        {running && (
          <section className="mt-8">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#8DA2B5]">Atividade em andamento</p>
            <div className="rounded-2xl border border-[rgba(34,192,141,0.4)] bg-[#121A22] p-5">
              <p className="text-[15px] font-semibold">{runningAllocation?.role_title ?? 'Projeto'} · {running.project_id}</p>
              <p className="my-2 text-4xl font-extrabold tabular-nums">{elapsedLabel(running.started_at, now)}</p>
              <button type="button" disabled={busy} onClick={() => void stopActivity()} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#22C08D] py-3.5 text-[15px] font-bold text-[#07120E] disabled:opacity-60">
                <Square className="h-4 w-4" /> Encerrar atividade
              </button>
            </div>
          </section>
        )}

        <p className="mt-10 text-center text-[11px] text-[#5C7186]">
          Marcações são imutáveis e numeradas (NSR). Prefere o celular? Baixe o app Insight Apex.
        </p>
      </div>

      {/* folha de seleção de projeto/etapa ao dar entrada */}
      {entryOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={() => setEntryOpen(false)}>
          <div className="w-full max-w-md rounded-t-3xl border-t border-[rgba(141,162,181,0.16)] bg-[#0F161D] p-6 pb-8" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-lg font-bold">
                <Briefcase className="h-4 w-4 text-[#22C08D]" /> Onde você vai trabalhar?
              </h2>
              <button type="button" onClick={() => setEntryOpen(false)} className="rounded-lg p-1 text-[#5C7186] hover:text-[#8DA2B5]">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* projeto */}
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#8DA2B5]">Projeto</p>
            <div className="mb-4 space-y-1.5">
              {allocations.map((a) => (
                <button
                  key={a.project_id}
                  type="button"
                  onClick={() => { setSelProject(a.project_id); setSelStage(null); void loadStages(a.project_id); }}
                  className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left ${selProject === a.project_id ? 'border-[rgba(34,192,141,0.5)] bg-[rgba(34,192,141,0.08)]' : 'border-[rgba(141,162,181,0.16)] bg-[#121A22]'}`}
                >
                  <span>
                    <span className="block text-sm font-semibold">{a.role_title ?? 'Colaborador'}</span>
                    <span className="mt-0.5 block text-xs text-[#8DA2B5]">{a.project_id} · {a.planned_percentage}%</span>
                  </span>
                  {selProject === a.project_id && <span className="h-2.5 w-2.5 rounded-full bg-[#22C08D]" />}
                </button>
              ))}
            </div>

            {/* etapa */}
            {selProject && (
              <>
                <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#8DA2B5]">
                  <LayoutList className="h-3 w-3" /> Etapa do cronograma
                </p>
                <div className="mb-5 max-h-52 space-y-1 overflow-y-auto">
                  <button type="button" onClick={() => setSelStage(null)} className={`w-full rounded-lg px-3 py-2.5 text-left text-sm ${selStage === null ? 'bg-[rgba(34,192,141,0.1)] text-[#22C08D]' : 'text-[#E8EEF2] hover:bg-[#121A22]'}`}>
                    Sem etapa específica
                  </button>
                  {stagesLoading ? (
                    <p className="px-3 py-2 text-xs text-[#5C7186]">Carregando etapas…</p>
                  ) : (
                    entryStages.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setSelStage(s.id)}
                        style={{ paddingLeft: `${12 + Math.min(s.outline_level, 4) * 12}px` }}
                        className={`flex w-full items-center justify-between rounded-lg py-2.5 pr-3 text-left ${selStage === s.id ? 'bg-[rgba(34,192,141,0.1)]' : 'hover:bg-[#121A22]'}`}
                      >
                        <span className={`min-w-0 truncate text-sm ${selStage === s.id ? 'text-[#22C08D]' : 'text-[#E8EEF2]'}`}>
                          {s.wbs_code ? <span className="mr-1.5 text-[#5C7186]">{s.wbs_code}</span> : null}{s.title}
                        </span>
                        <span className="ml-2 shrink-0 text-[11px] tabular-nums text-[#8DA2B5]">{Math.round(s.percent_complete)}%</span>
                      </button>
                    ))
                  )}
                  {!stagesLoading && entryStages.length === 0 && <p className="px-3 py-2 text-xs text-[#5C7186]">Sem cronograma importado para este projeto.</p>}
                </div>
              </>
            )}

            <button
              type="button"
              disabled={busy}
              onClick={() => void confirmEntry(true)}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#22C08D] py-4 text-base font-bold text-[#07120E] disabled:opacity-60"
            >
              {biometrics && <Fingerprint className="h-4 w-4" />}
              <Play className="h-4 w-4" /> Registrar entrada{selectedAlloc ? ` · ${selectedAlloc.role_title ?? 'projeto'}` : ''}
            </button>
            <button type="button" onClick={() => void confirmEntry(false)} className="mt-2 w-full py-2 text-center text-xs text-[#5C7186] hover:text-[#8DA2B5]">
              Entrar sem apontar projeto agora
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
