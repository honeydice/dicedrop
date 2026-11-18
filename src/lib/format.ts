export function money(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
  return '$' + Number(n).toFixed(2);
}

export function timeAgo(iso: string, now: number): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'Yesterday' : `${d}d ago`;
}

/** "AMEX 1003" style: bank first, then the last 4. */
export function cardLabel(bank: string | null, last4: string | null): string {
  if (!bank && !last4) return '—';
  return [bank, last4].filter(Boolean).join(' ');
}
