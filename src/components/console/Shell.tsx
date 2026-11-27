import type { ReactNode } from 'react';
import Link from 'next/link';
import { PageWidth } from '@/components/console/PageWidth';
import { SideNav } from '@/components/console/SideNav';
import { Logo } from '@/components/Logo';

/** The console frame: sidebar on desktop, a compact top bar with a scrolling tab row on phones. */
export function Shell({ email, version, signOut, children }: { email: string; version: string; signOut: (formData: FormData) => void | Promise<void>; children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="sticky top-0 z-30 flex shrink-0 flex-col gap-2 border-b border-line bg-panel px-3 pb-2 pt-3 md:static md:w-[232px] md:gap-5 md:border-b-0 md:border-r md:px-4 md:py-5">
        <div className="flex items-center gap-2.5 px-1 md:gap-3 md:px-1.5">
          <Link href="/" aria-label="DiceDrop home" title="Home page" className="shrink-0 transition-opacity hover:opacity-80">
            <span className="md:hidden">
              <Logo size={30} />
            </span>
            <span className="hidden md:block">
              <Logo size={48} />
            </span>
          </Link>
          <div className="min-w-0 flex-1">
            <div className="font-digital text-[24px] leading-none tracking-wide text-strong md:text-[30px]">DiceDrop</div>
            <div className="hidden font-mono text-[12px] text-muted md:block">operator console</div>
          </div>
          <form action={signOut} className="md:hidden">
            <button type="submit" className="min-h-[36px] rounded-lg border border-line bg-transparent px-3 font-mono text-[12px] text-muted">
              sign out
            </button>
          </form>
        </div>
        <SideNav />
        <div className="mt-auto hidden space-y-2 px-1.5 md:block">
          <div className="truncate font-mono text-xs text-muted" title={email}>
            {email}
          </div>
          <form action={signOut}>
            <button type="submit" className="min-h-[44px] w-full rounded-lg border border-line bg-transparent px-3.5 text-left text-[13px] text-muted hover:text-strong">
              Sign out
            </button>
          </form>
          <div className="font-mono text-[11px] text-muted">v{version}</div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-3 pb-10 pt-4 sm:px-8 md:px-5 md:pt-6">
        <PageWidth>{children}</PageWidth>
        <div className="mt-8 truncate text-center font-mono text-[11px] text-muted md:hidden">
          {email} · v{version}
        </div>
      </main>
    </div>
  );
}
