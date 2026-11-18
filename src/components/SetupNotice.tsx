import { Logo } from '@/components/Logo';
import { VERSION } from '@/lib/version';

/** Shown until the three Supabase values are set, so a fresh deploy explains itself. */
export function SetupNotice() {
  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <h1>
        <Logo size={64} />
      </h1>
      <p className="mt-6 text-base text-soft">Almost there. Connect DiceDrop to its database to bring the Control Tower online.</p>
      <ol className="mt-6 list-decimal space-y-3 pl-5 text-soft">
        <li>Create a new Supabase project named DiceDrop.</li>
        <li>
          Run <code className="font-mono text-accent">supabase/schema.sql</code> in its SQL editor.
        </li>
        <li>
          Add <code className="font-mono text-accent">NEXT_PUBLIC_SUPABASE_URL</code> and{' '}
          <code className="font-mono text-accent">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to this deployment, then redeploy.
        </li>
      </ol>
      <p className="mt-8 text-xs text-muted">v{VERSION}</p>
    </main>
  );
}
