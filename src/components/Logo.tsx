/** The DiceDrop mark. It stands in for the name wherever the brand appears. */
export function Logo({ size = 44 }: { size?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/logo.png" alt="DiceDrop" width={size} height={size} className="shrink-0 select-none" draggable={false} />;
}
