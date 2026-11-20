import type { ReactNode } from 'react';

export const btn =
  'inline-flex min-h-[44px] items-center justify-center rounded-lg border border-edge bg-raised px-4 text-[13px] font-medium text-fg disabled:cursor-not-allowed disabled:opacity-40';
export const btnAccent =
  'inline-flex min-h-[44px] items-center justify-center rounded-lg bg-accent px-5 text-[13px] font-semibold text-onaccent disabled:opacity-60';
export const btnDanger =
  'inline-flex min-h-[44px] items-center justify-center rounded-lg border border-dangerline bg-raised px-4 text-[13px] font-medium text-bad disabled:cursor-not-allowed disabled:opacity-40';
export const field = 'h-11 w-full rounded-[10px] border border-edge bg-raised px-3.5 text-sm text-fg';
export const label = 'mb-1.5 block text-[13px] font-medium text-soft';
export const th = 'px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted';
export const td = 'px-3 py-2.5 align-middle';

export function PageHead({ title, hint, children }: { title: string; hint?: string; children?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3 sm:mb-5 sm:gap-4">
      <div>
        <h1 className="font-display text-[24px] font-semibold tracking-tight sm:text-[28px]">{title}</h1>
        {hint ? <p className="mt-1 text-[13px] text-muted">{hint}</p> : null}
      </div>
      {children}
    </div>
  );
}

export function Card({ title, right, children }: { title?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-panel">
      {title ? (
        <div className="flex items-center justify-between gap-3 border-b border-line bg-raised px-4 py-2.5 sm:px-5 sm:py-3">
          <div className="font-mono text-[13px] text-muted">{title}</div>
          {right}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Tile({ label: l, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'good' | 'bad' | 'warn' | 'accent' }) {
  const color =
    tone === 'good' ? 'text-good' : tone === 'bad' ? 'text-bad' : tone === 'warn' ? 'text-warn' : tone === 'accent' ? 'text-accent' : '';
  return (
    <div className="flex-1 basis-[calc(50%-0.5rem)] rounded-xl border border-line bg-panel px-4 py-3 sm:basis-44 sm:px-5 sm:py-4">
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted sm:text-xs">{l}</div>
      <div className={`mt-1 font-display text-2xl font-semibold tracking-tight sm:mt-1.5 sm:text-3xl ${color}`}>{value}</div>
      {hint ? <div className="mt-1 text-xs text-muted">{hint}</div> : null}
    </div>
  );
}

export function Dot({ color }: { color: string }) {
  return <span aria-hidden="true" className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />;
}

export function Badge({ children }: { children: ReactNode }) {
  return <span className="rounded-full bg-good/20 px-2.5 py-0.5 font-mono text-xs font-medium text-good">{children}</span>;
}

export function ErrorNote({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div role="alert" className="mb-4 rounded-lg border border-dangerline bg-dangerbg px-4 py-3 text-[13px] text-bad">
      {message}
    </div>
  );
}

export function when(iso: string | null | undefined): string {
  if (!iso) return 'never';
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export const TONE = {
  good: 'rgb(var(--good))',
  bad: 'rgb(var(--bad))',
  warn: 'rgb(var(--warn))',
  muted: 'rgb(var(--muted))',
  accent: 'rgb(var(--accent))',
};

export function sessionTone(state: string): string {
  if (state === 'signed_in') return TONE.good;
  if (state === 'locked') return TONE.bad;
  if (state === 'needs_sign_in' || state === 'verification') return TONE.warn;
  return TONE.muted;
}

export function sessionLabel(state: string): string {
  if (state === 'signed_in') return 'signed in';
  if (state === 'needs_sign_in') return 'needs sign-in';
  if (state === 'verification') return 'verification requested';
  if (state === 'locked') return 'locked';
  return 'not checked yet';
}
