'use client';

/**
 * Portal de Ponto Web (ponto.insightapex.co) — versão navegador do app do
 * colaborador. Reusa /api/mobile/* com o token da sessão web (geofence,
 * evidências, NSR fiscal). Ao dar ENTRADA, o colaborador escolhe o
 * projeto e a etapa do cronograma (WBS) — a jornada e o apontamento
 * começam juntos.
 *
 * Prova de presença na WEB: como o navegador nem sempre oferece Face ID/
 * Touch ID (WebAuthn), a marcação exige uma SELFIE tirada na hora — a foto
 * vira uma authentication_evidence (facial_verification) anexada ao ponto.
 * Localização capturada só no evento.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Briefcase, Camera, Clock, LayoutList, LogOut, MapPin, Play, RefreshCw, ShieldCheck, Square, X } from 'lucide-react';
import { createClient } from '@/utils/supabase/client';
import {
  captureLocation,
  nextPunchOptions,
  pontoApi,
  PUNCH_LABEL,
  uuid,
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
type Activity = { projectId: string; stageId: string | null };
type PendingPunch = { type: PunchType; activity?: Activity };

export default function PontoPage() {
  const router = useRouter();
  const [state, setState] = useState<PontoBootstrap | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: Tone } | null>(null);
  const [now, setNow] = useState(Date.now());

  // folha de seleção de projeto/etapa ao dar entrada
  const [entryOpen, setEntryOpen] = useState(false);
  const [selProject, setSelProject] = useState<string | null>(null);
  const [selStage, setSelStage] = useState<string | null>(null);
  const [entryStages, setEntryStages] = useState<TimelineStage[]>([]);
  const [stagesLoading, setStagesLoading] = useState(false);

  // captura de selfie (prova de presença)
  const [pendingPunch, setPendingPunch] = useState<PendingPunch | null>(null);

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
  const runningAllocation = running ? allocations.find((a) => a.project_id === running.project_id) : null;

  /* ── marcação (jornada) + apontamento opcional (projeto/etapa) ──
     `authenticationEvidenceId` vem da selfie tirada antes de chamar aqui. */
  async function doPunch(type: PunchType, authenticationEvidenceId: string, activity?: Activity) {
    setBusy(true);
    setMessage(null);
    try {
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

  /** Abre a câmera para a selfie; ao capturar, envia a foto e bate o ponto. */
  function requestSelfie(pending: PendingPunch) {
    setMessage(null);
    setPendingPunch(pending);
  }

  async function onSelfieCaptured(imageDataUrl: string) {
    const pending = pendingPunch;
    setPendingPunch(null);
    if (!pending) return;
    setBusy(true);
    setMessage(null);
    try {
      const { authenticationEvidenceId } = await pontoApi.selfie(imageDataUrl);
      await doPunch(pending.type, authenticationEvidenceId, pending.activity);
    } catch (e) {
      setBusy(false);
      setMessage({ text: e instanceof Error ? e.message : 'Falha ao enviar a foto', tone: 'err' });
    }
  }

  /** Entrada: se há alocações, abre a seleção de projeto/etapa; senão, vai direto à selfie. */
  async function handlePunchButton(type: PunchType) {
    if (type === 'clock_in' && allocations.length > 0) {
      const first = allocations[0];
      setSelProject(first.project_id);
      setSelStage(null);
      setEntryOpen(true);
      void loadStages(first.project_id);
      return;
    }
    requestSelfie({ type });
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

  function confirmEntry(withProject: boolean) {
    setEntryOpen(false);
    if (withProject && selProject) {
      requestSelfie({ type: 'clock_in', activity: { projectId: selProject, stageId: selStage } });
    } else {
      requestSelfie({ type: 'clock_in' });
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
              <Camera className="h-4 w-4 opacity-70" />
              {busy ? 'Confirmando…' : PUNCH_LABEL[type]}
              {type === 'clock_in' && allocations.length > 0 && <span className="text-xs font-medium opacity-70">· escolher projeto</span>}
            </button>
          ))}
          <p className="flex items-center justify-center gap-1.5 text-center text-[11px] text-[#5C7186]">
            <ShieldCheck className="h-3 w-3" /> Foto (selfie) + localização são capturadas ao registrar, para validar a presença.
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
              onClick={() => confirmEntry(true)}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#22C08D] py-4 text-base font-bold text-[#07120E] disabled:opacity-60"
            >
              <Camera className="h-4 w-4" />
              <Play className="h-4 w-4" /> Registrar entrada{selectedAlloc ? ` · ${selectedAlloc.role_title ?? 'projeto'}` : ''}
            </button>
            <button type="button" onClick={() => confirmEntry(false)} className="mt-2 w-full py-2 text-center text-xs text-[#5C7186] hover:text-[#8DA2B5]">
              Entrar sem apontar projeto agora
            </button>
          </div>
        </div>
      )}

      {/* captura de selfie (prova de presença) */}
      {pendingPunch && (
        <SelfieCapture
          title={pendingPunch.type === 'clock_in' ? 'Selfie para a entrada' : `Selfie para ${SHORT_PUNCH[pendingPunch.type].toLowerCase()}`}
          onCapture={(dataUrl) => void onSelfieCaptured(dataUrl)}
          onCancel={() => setPendingPunch(null)}
        />
      )}
    </main>
  );
}

/* ───────────────────── captura de selfie ───────────────────── */

function SelfieCapture({ title, onCapture, onCancel }: { title: string; onCapture: (dataUrl: string) => void; onCancel: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [shot, setShot] = useState<string | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setReady(false);
    try {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        throw new Error('Câmera não disponível neste navegador.');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setReady(true);
    } catch (e) {
      const name = (e as { name?: string }).name;
      setError(
        name === 'NotAllowedError'
          ? 'Permita o acesso à câmera para tirar a selfie e bater o ponto.'
          : e instanceof Error ? e.message : 'Não foi possível abrir a câmera.',
      );
    }
  }, []);

  useEffect(() => {
    void start();
    return () => stop();
  }, [start, stop]);

  function takeShot() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const size = Math.min(video.videoWidth, video.videoHeight);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // recorte central quadrado, espelhado (selfie)
    const sx = (video.videoWidth - size) / 2;
    const sy = (video.videoHeight - size) / 2;
    ctx.translate(size, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, sx, sy, size, size, 0, 0, size, size);
    setShot(canvas.toDataURL('image/jpeg', 0.82));
    stop();
  }

  function retake() {
    setShot(null);
    void start();
  }

  function confirm() {
    if (shot) onCapture(shot);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70">
      <div className="w-full max-w-md rounded-t-3xl border-t border-[rgba(141,162,181,0.16)] bg-[#0F161D] p-6 pb-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-bold text-[#E8EEF2]">
            <Camera className="h-4 w-4 text-[#22C08D]" /> {title}
          </h2>
          <button type="button" onClick={() => { stop(); onCancel(); }} className="rounded-lg p-1 text-[#5C7186] hover:text-[#8DA2B5]">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="relative mx-auto aspect-square w-full max-w-[300px] overflow-hidden rounded-2xl border border-[rgba(141,162,181,0.2)] bg-black">
          {error ? (
            <div className="flex h-full items-center justify-center px-6 text-center text-sm text-[#DB5C6E]">{error}</div>
          ) : shot ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shot} alt="Selfie" className="h-full w-full object-cover" />
          ) : (
            <>
              <video ref={videoRef} playsInline muted className="h-full w-full -scale-x-100 object-cover" />
              {!ready && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="h-7 w-7 animate-spin rounded-full border-2 border-[rgba(141,162,181,0.3)] border-t-[#22C08D]" />
                </div>
              )}
            </>
          )}
        </div>

        <p className="mt-3 text-center text-[11px] text-[#5C7186]">
          Centralize o rosto, com boa iluminação. A foto fica anexada à marcação como prova de presença.
        </p>

        <div className="mt-4 space-y-3">
          {error ? (
            <button type="button" onClick={() => void start()} className="flex w-full items-center justify-center gap-2 rounded-xl border border-[rgba(141,162,181,0.3)] bg-[#121A22] py-3.5 text-sm font-bold text-[#E8EEF2]">
              <RefreshCw className="h-4 w-4" /> Tentar novamente
            </button>
          ) : shot ? (
            <>
              <button type="button" onClick={confirm} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#22C08D] py-4 text-base font-bold text-[#07120E]">
                <ShieldCheck className="h-4 w-4" /> Usar esta foto e registrar
              </button>
              <button type="button" onClick={retake} className="flex w-full items-center justify-center gap-2 py-2 text-center text-xs text-[#5C7186] hover:text-[#8DA2B5]">
                <RefreshCw className="h-3.5 w-3.5" /> Tirar outra
              </button>
            </>
          ) : (
            <button type="button" disabled={!ready} onClick={takeShot} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#22C08D] py-4 text-base font-bold text-[#07120E] disabled:opacity-60">
              <Camera className="h-4 w-4" /> Tirar foto
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
