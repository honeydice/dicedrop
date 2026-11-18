import Link from 'next/link';
import { signOut } from '@/app/actions';
import { Logo } from '@/components/Logo';

export function Header({
  workspaceName,
  email,
  current,
  isPlatformAdmin = false,
}: {
  workspaceName: string;
  email: string;
  current: 'orders' | 'admin' | 'platform';
  isPlatformAdmin?: boolean;
}) {
  const linkBase = 'inline-flex min-h-[44px] items-center rounded-lg border px-3.5 text-[13px] no-underline';
  const on = 'border-edge bg-raised text-strong';
  const off = 'border-line text-muted hover:text-strong';

  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line px-5 py-4 sm:px-8">
      <div className="flex items-center gap-3">
        <Logo />
        <div className="font-display text-[22px] font-bold tracking-tight">DiceDrop</div>
        <div className="border-l border-line pl-3 text-[13px] text-muted">{workspaceName}</div>
      </div>
      <nav className="flex flex-wrap items-center gap-2" aria-label="Main">
        <Link href="/" className={`${linkBase} ${current === 'orders' ? on : off}`}>
          Orders
        </Link>
        <Link href="/admin" className={`${linkBase} ${current === 'admin' ? on : off}`}>
          Admin
        </Link>
        {isPlatformAdmin ? (
          <Link
            href="/platform"
            className={`${linkBase} ${current === 'platform' ? 'border-accent bg-raised text-accent' : 'border-accent/50 text-accent hover:border-accent'}`}
          >
            Platform
          </Link>
        ) : null}
        <form action={signOut}>
          <button type="submit" className={`${linkBase} ${off} bg-transparent`} title={email}>
            Sign out
          </button>
        </form>
      </nav>
    </header>
  );
}
