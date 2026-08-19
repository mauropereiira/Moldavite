import type { DropPlace } from '@/stores/sidebarOrderStore';

/**
 * The hairline that says where a dragged row will land. Absolutely positioned,
 * so the row it sits in must be `relative`; renders nothing when no reorder
 * drag is over that row.
 */
export function DropIndicator({ place }: { place: DropPlace | null }) {
  if (!place) return null;
  return (
    <div
      aria-hidden="true"
      className={`absolute left-0 right-0 h-px ${place === 'before' ? 'top-0' : 'bottom-0'}`}
      style={{ backgroundColor: 'var(--border-strong)' }}
    />
  );
}
