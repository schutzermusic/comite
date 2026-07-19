'use client';

/**
 * Portal de Ponto Web (ponto.insightapex.co) — versão navegador do app
 * do colaborador, para quem não pode instalar o app. Reusa /api/mobile/*
 * (geofence, evidências, NSR fiscal) com o token da sessão web. Captura
 * a localização apenas no evento; sem biometria (assurance menor — o
 * backend registra a origem e o gestor vê o canal na revisão).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Clock, LogOut, MapPin, Play, Square } from 'lucide-react';
import { createClient } from '@/utils/supabase/client';
import {
  captureLocation,
  nextPunchOptions,
  pontoApi,
  PUNCH_LABEL,
  uuid,
  type PontoBootstrap,
  type PunchType,
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

export default function PontoPage() {
  const router = useRouter();
  const [state, setState] = useState<PontoBootstrap | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: 'ok' | 'warn' | 'err' } | null>(null);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    try {
      setState(await pontoApi.bootstrap());
      setMessage(null);
    } catch (e) {
      const text = e instanceof Error ? e.message : 'Erro ao carregar';
      if (/Sessão expirada/i.test(text)) {
        router.replace('/ponto/login');
        return;
      }
      setMessage({ text, tone: 'err' });
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  // relógio do cronômetro
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

  async function handlePunch(type: PunchType) {
    setBusy(true);
    setMessage(null);
    try {
      const location = await captureLocation();
      const res = await pontoApi.punch({
        type,
        clientEventId: uuid(),
        occurredAt: new Date().toISOString(),
        location: location ?? undefined,
      });
      if (res.needsReview) {
        setMessage({
          text: 'Ponto registrado — em revisão (fora da área autorizada ou sem localização).',
          tone: 'warn',
        });
      } else if (!location) {
        setMessage({
          text: 'Ponto registrado sem localização — permita o acesso para validar a área.',
          tone: 'warn',
        });
      } else {
        setMessage({ text: 'Ponto registrado.', tone: 'ok' });
      }
      await load();
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : 'Erro ao registrar', tone: 'err' });
    } finally {
      setBusy(false);
    }
  }

  async function handleActivity(action: 'start' | 'stop', projectId?: string) {
    setBusy(true);
    setMessage(null);
    try {
      await pontoApi.activity({ action, projectId });
      await load();
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : 'Erro na atividade', tone: 'err' });
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

  return (
    <main className="min-h-screen bg-[#0C1116] text-[#E8EEF2]">
      <div className="mx-auto w-full max-w-md px-6 pb-16 pt-10">
        {/* header */}
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
          <button
            type="button"
            onClick={handleSignOut}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-[#5C7186] hover:text-[#8DA2B5]"
          >
            <LogOut className="h-3.5 w-3.5" /> Sair
          </button>
        </header>

        {message && (
          <div
            className={`mb-4 rounded-xl px-4 py-3 text-sm ${
              message.tone === 'ok'
                ? 'bg-[rgba(34,192,141,0.12)] text-[#22C08D]'
                : message.tone === 'warn'
                  ? 'bg-[rgba(217,161,59,0.12)] text-[#D9A13B]'
                  : 'bg-[rgba(219,92,110,0.12)] text-[#DB5C6E]'
            }`}
          >
            {message.text}
          </div>
        )}

        {/* jornada de hoje */}
        <section className="rounded-2xl border border-[rgba(141,162,181,0.16)] bg-[#121A22] p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#8DA2B5]">
            Jornada de hoje
          </p>
          {punches.length === 0 ? (
            <p className="mt-3 text-sm text-[#5C7186]">Nenhuma marcação ainda.</p>
          ) : (
            <ul className="mt-3 space-y-1.5">
              {punches.map((p) => (
                <li key={p.id} className="flex items-center gap-3">
                  <span className="w-12 text-[15px] font-bold tabular-nums">{fmtTime(p.occurred_at)}</span>
                  <span className="h-2 w-2 rounded-full bg-[#22C08D]" />
                  <span className="flex-1 text-sm text-[#8DA2B5]">{SHORT_PUNCH[p.type]}</span>
                  {p.status === 'under_review' && (
                    <span className="rounded-full bg-[rgba(217,161,59,0.14)] px-2 py-0.5 text-[10px] font-bold text-[#D9A13B]">
                      em revisão
                    </span>
                  )}
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
              onClick={() => void handlePunch(type)}
              className={`w-full rounded-xl py-4 text-base font-bold transition-opacity disabled:opacity-60 ${
                type === 'clock_in' || type === 'break_end'
                  ? 'bg-[#22C08D] text-[#07120E]'
                  : 'border border-[rgba(141,162,181,0.3)] bg-[#121A22] text-[#E8EEF2]'
              }`}
            >
              {busy ? 'Registrando…' : PUNCH_LABEL[type]}
            </button>
          ))}
          <p className="flex items-center justify-center gap-1.5 text-[11px] text-[#5C7186]">
            <MapPin className="h-3 w-3" />
            A localização é capturada apenas ao registrar, para validar a área de trabalho.
          </p>
        </section>

        {/* atividade por projeto */}
        <section className="mt-8">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#8DA2B5]">
            Atividade em projeto
          </p>

          {running ? (
            <div className="rounded-2xl border border-[rgba(34,192,141,0.4)] bg-[#121A22] p-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#22C08D]">
                Em andamento
              </p>
              <p className="mt-1 text-[15px] font-semibold">
                {runningAllocation?.role_title ?? 'Projeto'} · {running.project_id}
              </p>
              <p className="my-2 text-4xl font-extrabold tabular-nums">
                {elapsedLabel(running.started_at, now)}
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleActivity('stop')}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#22C08D] py-3.5 text-[15px] font-bold text-[#07120E] disabled:opacity-60"
              >
                <Square className="h-4 w-4" /> Encerrar atividade
              </button>
            </div>
          ) : allocations.length === 0 ? (
            <p className="text-sm text-[#5C7186]">Você não tem alocações ativas em projetos.</p>
          ) : (
            <ul className="space-y-2.5">
              {allocations.map((a) => (
                <li key={a.project_id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleActivity('start', a.project_id)}
                    className="flex w-full items-center justify-between rounded-xl border border-[rgba(141,162,181,0.16)] bg-[#121A22] px-4 py-3.5 text-left disabled:opacity-60"
                  >
                    <span>
                      <span className="block text-sm font-semibold">{a.role_title ?? 'Colaborador'}</span>
                      <span className="mt-0.5 block text-xs text-[#8DA2B5]">
                        {a.project_id} · {a.planned_percentage}%
                      </span>
                    </span>
                    <span className="flex items-center gap-1.5 text-sm font-bold text-[#22C08D]">
                      <Play className="h-3.5 w-3.5" /> Iniciar
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="mt-10 text-center text-[11px] text-[#5C7186]">
          Marcações são imutáveis e numeradas (NSR). Prefere o celular? Baixe o app Insight Apex.
        </p>
      </div>
    </main>
  );
}
