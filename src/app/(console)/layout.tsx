import { Shell } from '@/components/console/Shell';
import { redirect } from 'next/navigation';
import { signOut } from '@/app/actions';
import { Logo } from '@/components/Logo';
import { SetupNotice } from '@/components/SetupNotice';
import { getOperator } from '@/lib/context';
import { hasSupabaseEnv } from '@/lib/env';
import { VERSION } from '@/lib/version';

export const dynamic = 'force-dynamic';

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  if (!hasSupabaseEnv()) return <SetupNotice />;

  const me = await getOperator();
  if (!me) redirect('/login');

  if (!me.isOperator) {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 py-12">
        <h1>
          <Logo size={64} />
        </h1>
        <p className="mt-4 text-soft">This console is for DiceDrop operators. {me.email} does not have operator access.</p>
        <form action={signOut} className="mt-6">
          <button type="submit" className="min-h-[44px] rounded-lg border border-edge bg-raised px-4 text-[13px] font-medium text-fg">
            Sign out
          </button>
        </form>
      </main>
    );
  }

  return (
    <Shell email={me.email} version={VERSION} signOut={signOut}>
      {children}
    </Shell>
  );
}
