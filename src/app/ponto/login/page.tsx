'use client';

/**
 * Portal de Ponto Web — login do colaborador (ponto.insightapex.co/login).
 * Alternativa para quem não consegue instalar o app: mesma conta Supabase,
 * mesma tela simplificada do app de campo. Após autenticar vai direto a
 * /ponto (não ao dashboard executivo).
 */

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Clock } from 'lucide-react';
import { createClient } from '@/utils/supabase/client';

export default function PontoLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      setError(
        /invalid/i.test(signInError.message)
          ? 'E-mail ou senha incorretos.'
          : signInError.message,
      );
      setLoading(false);
      return;
    }
    router.replace('/ponto');
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0C1116] px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <div className="mb-3 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-[rgba(34,192,141,0.14)]">
            <Clock className="h-5 w-5 text-[#22C08D]" />
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-[#E8EEF2]">
            Insight <span className="text-[#22C08D]">Ponto</span>
          </h1>
          <p className="mt-1 text-sm text-[#8DA2B5]">
            Registre sua jornada pelo navegador — sem instalar nada.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="email"
            required
            autoComplete="email"
            placeholder="E-mail"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl border border-[rgba(141,162,181,0.2)] bg-[#121A22] px-4 py-3.5 text-[15px] text-[#E8EEF2] placeholder-[#5C7186] outline-none focus:border-[rgba(34,192,141,0.5)]"
          />
          <input
            type="password"
            required
            autoComplete="current-password"
            placeholder="Senha"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-xl border border-[rgba(141,162,181,0.2)] bg-[#121A22] px-4 py-3.5 text-[15px] text-[#E8EEF2] placeholder-[#5C7186] outline-none focus:border-[rgba(34,192,141,0.5)]"
          />

          {error ? <p className="text-sm text-[#DB5C6E]">{error}</p> : null}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-[#22C08D] py-4 text-base font-bold text-[#07120E] transition-opacity disabled:opacity-60"
          >
            {loading ? 'Entrando…' : 'Entrar'}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-[#5C7186]">
          Mesmo login do Insight Apex. Problemas de acesso? Fale com o RH.
        </p>
      </div>
    </main>
  );
}
