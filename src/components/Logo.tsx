export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg aria-hidden="true" className="text-accent" width={size} height={size} viewBox="0 0 32 32" fill="none">
      <rect x="3" y="3" width="26" height="26" rx="7" stroke="currentColor" strokeWidth="2.5" />
      <circle cx="11" cy="11" r="2.2" fill="currentColor" />
      <circle cx="16" cy="16" r="2.2" fill="currentColor" />
      <circle cx="21" cy="21" r="2.2" fill="currentColor" />
    </svg>
  );
}
