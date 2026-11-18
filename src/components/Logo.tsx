export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 32 32" fill="none">
      <rect x="3" y="3" width="26" height="26" rx="7" stroke="#F5C542" strokeWidth="2.5" />
      <circle cx="11" cy="11" r="2.2" fill="#F5C542" />
      <circle cx="16" cy="16" r="2.2" fill="#F5C542" />
      <circle cx="21" cy="21" r="2.2" fill="#F5C542" />
    </svg>
  );
}
