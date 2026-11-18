import { PageWidth } from '@/components/console/PageWidth';
import { redirect } from 'next/navigation';
import { signOut } from '@/app/actions';
import { SideNav } from '@/components/console/SideNav';
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
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col gap-5 border-b border-line bg-panel px-4 py-5 md:w-[232px] md:border-b-0 md:border-r">
        <div className="flex items-center gap-3 px-1.5">
          <Logo size={48} />
          <div>
            <div className="font-digital text-[30px] leading-none tracking-wide text-strong">DiceDrop</div>
            <div className="font-mono text-[12px] text-muted">operator console</div>
          </div>
        </div>
        <SideNav />
        <div className="mt-auto space-y-2 px-1.5">
          <div className="truncate font-mono text-xs text-muted" title={me.email}>
            {me.email}
          </div>
          <form action={signOut}>
            <button type="submit" className="min-h-[44px] w-full rounded-lg border border-line bg-transparent px-3.5 text-left text-[13px] text-muted hover:text-strong">
              Sign out
            </button>
          </form>
          <div className="font-mono text-[11px] text-muted">v{VERSION}</div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-5 pb-10 pt-6 sm:px-8">
        <PageWidth>{children}</PageWidth>
      </main>
    </div>
  );
}
