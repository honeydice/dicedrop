'use client';

import { useEffect, useState } from 'react';

type Theme = 'dark' | 'light';

/** Light / dark switch. The choice is remembered on this device. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('dark');

  useEffect(() => {
    const current = document.documentElement.getAttribute('data-theme');
    setTheme(current === 'light' ? 'light' : 'dark');
  }, []);

  const choose = (next: Theme) => {
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem('dd-theme', next);
    } catch {
      // Private windows may block storage; the theme still applies for this visit.
    }
  };

  const base = 'min-h-[44px] px-5 text-sm font-medium';
  const on = 'bg-accent text-onaccent';
  const off = 'bg-raised text-muted hover:text-strong';

  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="text-[13px] font-medium text-soft" id="theme-label">
        Appearance
      </div>
      <div role="group" aria-labelledby="theme-label" className="inline-flex overflow-hidden rounded-[10px] border border-edge">
        <button type="button" aria-pressed={theme === 'dark'} onClick={() => choose('dark')} className={`${base} ${theme === 'dark' ? on : off}`}>
          Dark
        </button>
        <button
          type="button"
          aria-pressed={theme === 'light'}
          onClick={() => choose('light')}
          className={`${base} border-l border-edge ${theme === 'light' ? on : off}`}
        >
          Light
        </button>
      </div>
    </div>
  );
}
