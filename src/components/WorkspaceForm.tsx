'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { createWorkspace } from '@/app/actions';
import { Logo } from '@/components/Logo';

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-11 w-full rounded-[10px] bg-accent text-sm font-semibold text-[#141413] disabled:opacity-60"
    >
      {pending ? 'Creating' : 'Create workspace'}
    </button>
  );
}

export function WorkspaceForm({ email }: { email: string }) {
  const [state, action] = useFormState(createWorkspace, { error: '' });

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 py-12">
      <div className="flex items-center gap-3">
        <Logo />
        <h1 className="font-display text-2xl font-bold tracking-tight">Name your workspace</h1>
      </div>
      <p className="mt-2 text-muted">
        Signed in as {email}. A workspace holds your orders, buyer accounts, and API keys.
      </p>
      <form action={action} className="mt-8 space-y-4">
        <div>
          <label htmlFor="name" className="text-[13px] font-medium text-soft">
            Workspace name
          </label>
          <input
            id="name"
            name="name"
            required
            maxLength={80}
            placeholder="World Source Market"
            className="mt-1.5 h-11 w-full rounded-[10px] border border-edge bg-raised px-3.5 text-sm text-[#E6EDF3]"
          />
        </div>
        {state.error ? (
          <div role="alert" className="rounded-lg border border-[#5A2626] bg-[#2A1414] px-3.5 py-2.5 text-[13px] text-bad">
            {state.error}
          </div>
        ) : null}
        <Submit />
      </form>
    </main>
  );
}
