'use client';

/**
 * Ativação de conta do colaborador de Ponto (mobile-first). Consome o link
 * de convite/recuperação NATIVO do Supabase (fluxo ?code= PKCE ou hash
 * #access_token). O colaborador confirma nome/e-mail, cria a senha, aceita
 * os termos e ativa — em seguida entra direto no app de Ponto. Nenhuma
 * senha é enviada por e-mail; nenhum token é persistido.
 */

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Clock, KeyRound, ShieldCheck } from 'lucide-react';
import { createClient } from '@/utils/supabase/client';

type BootState =
  | { kind: 'loading' }
  | { kind: 'ready'; email: string | null; fullName: string | null; workspace: string | null }
  | { kind: 'no-session'; error: string };

export default function PontoActivatePage() {
  const router = useRouter();
  const [boot, setBoot] = useState<BootState>({ kind: 'loading' });
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const bootstrap = async () => {
      const supabase = createClient();
      const url = new URL(window.location.href);
      const code = url.searchParams.get('code');

      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (cancelled) return;
        if (exchangeError) {
          setBoot({ kind: 'no-session', error: 'Convite expirado ou inválido. Peça um novo convite ao seu gestor.' });
          return;
        }
        window.history.replaceState({}, '', '/ponto/ativar');
      } else {
        const rawHash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash;
        if (rawHash) {
          const hashParams = new URLSearchParams(rawHash);
          const accessToken = hashParams.get('access_token');
          const refreshToken = hashParams.get('refresh_token');
          const hashError = hashParams.get('error_description') || hashParams.get('error');
          if (hashError) {
            window.history.replaceState({}, '', '/ponto/ativar');
            setBoot({ kind: 'no-session', error: 'Convite expirado ou inválido. Peça um novo convite ao seu gestor.' });
            return;
          }
          if (accessToken && refreshToken) {
            const { error: setErr } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
            if (cancelled) return;
            window.history.replaceState({}, '', '/ponto/ativar');
            if (setErr) {
              setBoot({ kind: 'no-session', error: 'Convite expirado ou inválido. Peça um novo convite ao seu gestor.' });
              return;
            }
          }
        }
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!user) {
        setBoot({ kind: 'no-session', error: 'Abra o link de ativação que você recebeu por e-mail neste dispositivo.' });
        return;
      }
      const meta = (user.user_metadata ?? {}) as { full_name?: string; workspace_name?: string };
      setBoot({ kind: 'ready', email: user.email ?? null, fullName: meta.full_name ?? null, workspace: meta.workspace_name ?? null });
    };

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (password.length < 8) return setError('Use uma senha com pelo menos 8 caracteres.');
    if (password !== confirmPassword) return setError('As senhas não conferem.');
    if (!acceptTerms) return setError('É preciso aceitar os termos de uso e o aviso de privacidade.');

    setLoading(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError(updateError.message);
      setLoading(false);
      return;
    }
    router.replace('/ponto');
    router.refresh();
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#0C1116] px-5 py-10 text-[#E8EEF2]">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-[rgba(34,192,141,0.4)] bg-[rgba(34,192,141,0.1)] text-[#22C08D]">
            <Clock className="h-4 w-4" />
          </span>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#22C08D]">Insight Ponto</p>
            <h1 className="text-lg font-extrabold tracking-tight">Ativar seu acesso</h1>
          </div>
        </div>

        {boot.kind === 'loading' && (
          <div className="flex items-center gap-3 rounded-2xl border border-[rgba(141,162,181,0.16)] bg-[#121A22] px-4 py-4 text-sm text-[#8DA2B5]">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-[rgba(141,162,181,0.3)] border-t-[#22C08D]" />
            Validando convite…
          </div>
        )}

        {boot.kind === 'no-session' && (
          <div className="space-y-4 rounded-2xl border border-[rgba(219,92,110,0.3)] bg-[#121A22] p-5">
            <p className="text-sm text-[#DB5C6E]">{boot.error}</p>
            <button
              type="button"
              onClick={() => router.replace('/ponto/login')}
              className="w-full rounded-xl border border-[rgba(141,162,181,0.3)] bg-[#0F161D] py-3 text-sm font-bold text-[#E8EEF2]"
            >
              Ir para o login
            </button>
          </div>
        )}

        {boot.kind === 'ready' && (
          <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl border border-[rgba(141,162,181,0.16)] bg-[#121A22] p-5">
            <div className="rounded-xl bg-[rgba(141,162,181,0.08)] px-4 py-3 text-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#8DA2B5]">Confirme seus dados</p>
              <p className="mt-1 font-semibold text-[#E8EEF2]">{boot.fullName ?? '—'}</p>
              <p className="text-[#8DA2B5]">{boot.email ?? '—'}</p>
              {boot.workspace && <p className="mt-1 text-xs text-[#5C7186]">{boot.workspace}</p>}
            </div>

            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.1em] text-[#8DA2B5]">Criar senha</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                required
                className="w-full rounded-xl border border-[rgba(141,162,181,0.24)] bg-[#0F161D] px-4 py-3 text-[15px] text-[#E8EEF2] outline-none focus:border-[#22C08D]"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.1em] text-[#8DA2B5]">Confirmar senha</span>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                required
                className="w-full rounded-xl border border-[rgba(141,162,181,0.24)] bg-[#0F161D] px-4 py-3 text-[15px] text-[#E8EEF2] outline-none focus:border-[#22C08D]"
              />
            </label>
            <p className="text-[11px] text-[#5C7186]">Mínimo de 8 caracteres.</p>

            <label className="flex items-start gap-2.5 text-xs text-[#8DA2B5]">
              <input
                type="checkbox"
                checked={acceptTerms}
                onChange={(e) => setAcceptTerms(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[#22C08D]"
              />
              <span>
                Li e aceito os <span className="text-[#E8EEF2]">Termos de Uso</span> e o{' '}
                <span className="text-[#E8EEF2]">Aviso de Privacidade</span>, incluindo o registro de ponto com
                localização e foto (selfie) como prova de presença.
              </span>
            </label>

            {error && <p className="rounded-lg bg-[rgba(219,92,110,0.12)] px-3 py-2 text-sm text-[#DB5C6E]">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#22C08D] py-4 text-base font-bold text-[#07120E] disabled:opacity-60"
            >
              {loading ? 'Ativando…' : (<><KeyRound className="h-4 w-4" /> Ativar e entrar no Ponto</>)}
            </button>
            <p className="flex items-center justify-center gap-1.5 text-center text-[11px] text-[#5C7186]">
              <ShieldCheck className="h-3 w-3" /> Sua senha é pessoal e nunca é enviada por e-mail.
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
