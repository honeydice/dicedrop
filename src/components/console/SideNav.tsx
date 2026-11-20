'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '/', label: 'Overview' },
  { href: '/orders', label: 'Orders' },
  { href: '/clients', label: 'Clients' },
  { href: '/accounts', label: 'Accounts' },
  { href: '/vps', label: 'VPS' },
  { href: '/settings', label: 'Settings' },
];

export function SideNav() {
  const path = usePathname();
  return (
    <nav aria-label="Console" className="-mx-3 flex flex-row gap-1 overflow-x-auto px-3 [scrollbar-width:none] md:mx-0 md:flex-col md:overflow-visible md:px-0 [&::-webkit-scrollbar]:hidden">
      {ITEMS.map((item) => {
        const active = item.href === '/' ? path === '/' : path.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`flex min-h-[40px] shrink-0 items-center rounded-lg px-3 font-mono text-[14px] no-underline md:min-h-[44px] md:px-3.5 ${
              active ? 'bg-raised text-strong' : 'text-muted hover:bg-raised/60 hover:text-strong'
            }`}
          >
            <span aria-hidden="true" className={`mr-2 inline-block h-1.5 w-1.5 rounded-full md:mr-2.5 ${active ? 'bg-accent' : 'hidden bg-transparent md:inline-block'}`} />
            {item.label.toLowerCase()}
          </Link>
        );
      })}
    </nav>
  );
}
