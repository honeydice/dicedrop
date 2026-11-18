'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Logo } from '@/components/Logo';
import { createClient } from '@/lib/supabase/client';

/** Operator sign-in. There is no sign-up: operators are added by an existing operator. */
export function LoginForm() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setMessage(error.message);
        return;
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
      <p className="mt-2 font-mono text-[13px] text-muted">operator console</p>

      <form onSubmit={submit} className="mt-8 space-y-4">
        <div>
          <label htmlFor="email" className="text-[13px] font-medium text-soft">
            Email
          </label>
          <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={field} />
        </div>
        <div>
          <label htmlFor="password" className="text-[13px] font-medium text-soft">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
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
        <button type="submit" disabled={busy} className="h-11 w-full rounded-[10px] bg-accent text-sm font-semibold text-onaccent disabled:opacity-60">
          {busy ? 'One moment' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
