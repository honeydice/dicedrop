'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';

/** Pages listed here use the full screen width; the rest keep the standard column. */
const WIDE = ['/accounts'];

export function PageWidth({ children }: { children: ReactNode }) {
  const path = usePathname();
  const wide = WIDE.some((p) => path === p || path.startsWith(p + '/'));
  return <div className={wide ? 'w-full' : 'mx-auto max-w-[1280px]'}>{children}</div>;
}
