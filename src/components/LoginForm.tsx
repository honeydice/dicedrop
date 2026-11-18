'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Logo } from '@/components/Logo';
import { createClient } from '@/lib/supabase/client';

export function LoginForm() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      if (mode === 'in') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          setMessage(error.message);
          return;
        }
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) {
          setMessage(error.message);
          return;
        }
        if (!data.session) {
          setMessage('Account created. Check your email to confirm it, then sign in.');
          setMode('in');
          return;
        }
      }
      router.push('/');
      router.refresh();
    } catch {
      setMessage('Could not reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const field = 'mt-1.5 h-11 w-full rounded-[10px] border border-edge bg-raised px-3.5 text-sm text-fg';

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 py-12">
      <div className="flex items-center gap-3">
        <Logo />
        <h1 className="font-display text-2xl font-bold tracking-tight">DiceDrop</h1>
      </div>
      <p className="mt-2 text-muted">{mode === 'in' ? 'Sign in to the Control Tower.' : 'Create your account.'}</p>

      <form onSubmit={submit} className="mt-8 space-y-4">
        <div>
          <label htmlFor="email" className="text-[13px] font-medium text-soft">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={field}
          />
        </div>
        <div>
          <label htmlFor="password" className="text-[13px] font-medium text-soft">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={field}
          />
        </div>
        {message ? (
          <div role="status" className="rounded-lg border border-edge bg-raised px-3.5 py-2.5 text-[13px] text-soft">
            {message}
          </div>
        ) : null}
        <button
          type="submit"
          disabled={busy}
          className="h-11 w-full rounded-[10px] bg-accent text-sm font-semibold text-onaccent disabled:opacity-60"
        >
          {busy ? 'One moment' : mode === 'in' ? 'Sign in' : 'Create account'}
        </button>
      </form>

      <button
        type="button"
        onClick={() => {
          setMode(mode === 'in' ? 'up' : 'in');
          setMessage('');
        }}
        className="mt-4 min-h-[44px] bg-transparent text-[13px] text-muted hover:text-strong"
      >
        {mode === 'in' ? 'New here? Create an account' : 'Already have an account? Sign in'}
      </button>
    </main>
  );
}
