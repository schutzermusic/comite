'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { KeyRound } from 'lucide-react';
import { HudButton, HudInput, HudPanel } from '@/components/hud';
import { createClient } from '@/utils/supabase/client';

export default function ResetPasswordPage() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setMessage('');

    if (password.length < 8) {
      setError('Use uma senha com pelo menos 8 caracteres.');
      return;
    }

    if (password !== confirmPassword) {
      setError('As senhas nao conferem.');
      return;
    }

    setLoading(true);
    const { error: updateError } = await createClient().auth.updateUser({ password });
    if (updateError) {
      setError(updateError.message);
    } else {
      setMessage('Senha atualizada com sucesso.');
    }
    setLoading(false);
  };

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-ig-bg-canvas p-4">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,color-mix(in_oklab,var(--ig-warning)_18%,transparent),transparent_42%)]" />
      <HudPanel elevation={4} className="relative z-10 w-full max-w-md">
        <div className="mb-7">
          <h1 className="text-xl font-semibold text-ig-fg-strong">Redefinir senha</h1>
          <p className="mt-1 text-sm text-ig-fg-muted">Crie uma nova senha para sua conta.</p>
        </div>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <HudInput label="Nova senha" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          <HudInput label="Confirmar senha" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required />
          {error && <p className="text-sm text-ig-danger">{error}</p>}
          {message && <p className="text-sm text-ig-success">{message}</p>}
          <HudButton type="submit" variant="primary" fullWidth isLoading={loading} leftIcon={<KeyRound className="h-4 w-4" />}>
            Atualizar senha
          </HudButton>
        </form>
        <Link href="/login" className="mt-5 block text-sm text-ig-accent hover:underline">
          Ir para o login
        </Link>
      </HudPanel>
    </main>
  );
}
