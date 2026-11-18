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
    <nav aria-label="Console" className="flex flex-row flex-wrap gap-1 md:flex-col">
      {ITEMS.map((item) => {
        const active = item.href === '/' ? path === '/' : path.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`flex min-h-[44px] items-center rounded-lg px-3.5 font-mono text-[14px] no-underline ${
              active ? 'bg-raised text-strong' : 'text-muted hover:bg-raised/60 hover:text-strong'
            }`}
          >
            <span aria-hidden="true" className={`mr-2.5 inline-block h-1.5 w-1.5 rounded-full ${active ? 'bg-accent' : 'bg-transparent'}`} />
            {item.label.toLowerCase()}
          </Link>
        );
      })}
    </nav>
  );
}
