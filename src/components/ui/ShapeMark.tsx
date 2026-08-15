/**
 * A deterministic geometric mark for a named thing — a Forge, a folder, a tag.
 *
 * The set is 72 abstract shapes (quarter-arcs, wedges, blocks) rather than an
 * icon set, so no shape *means* anything. That is the point: a folder icon
 * that looks like a folder tells you nothing you didn't already read in the
 * label beside it. A stable arbitrary mark tells you "this one, again" — it
 * gives a name a silhouette you start recognising before you finish reading.
 *
 * Rendered as a CSS mask so one asset inherits the current ink colour and
 * needs no fetch, matching how the wordmark is drawn.
 */

const SHAPE_COUNT = 72;

/** FNV-1a. Small, stable across runs, and good enough to spread names evenly. */
function hashToShape(name: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (Math.abs(h) % SHAPE_COUNT) + 1;
}

export function ShapeMark({
  name,
  size = 12,
  color = 'var(--text-muted)',
  className,
}: {
  name: string;
  size?: number;
  color?: string;
  className?: string;
}) {
  const n = String(hashToShape(name)).padStart(2, '0');
  const url = `url(/shapes/shape-${n}.svg)`;

  return (
    <span
      aria-hidden="true"
      className={className}
      style={{
        display: 'inline-block',
        flexShrink: 0,
        width: size,
        height: size,
        backgroundColor: color,
        WebkitMaskImage: url,
        maskImage: url,
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        WebkitMaskSize: 'contain',
        maskSize: 'contain',
        WebkitMaskPosition: 'center',
        maskPosition: 'center',
        transition: 'background-color var(--dur-micro) var(--ease-standard)',
      }}
    />
  );
}
