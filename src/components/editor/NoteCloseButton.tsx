import { useState } from 'react';
import { formatShortcut } from '@/lib/shortcuts';

/**
 * "Close" in the top-right of the open note.
 *
 * The tab bar hides itself when only one tab is open, which left ⌘W as the
 * only way to close a note — invisible unless you already knew it. This is the
 * visible counterpart.
 *
 * Styled inline rather than via a class in `index.css`: that file is a single
 * 3,700-line stylesheet that concurrent work has to serialise on, and inline
 * `style={{}}` reading `var()` is this codebase's dominant pattern anyway.
 */
export function NoteCloseButton({ onClose, title }: { onClose: () => void; title: string }) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      type="button"
      onClick={onClose}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      aria-label={`Close ${title} (${formatShortcut('⌘W')})`}
      style={{
        // Out of flow: the parent rail is zero-height on purpose.
        position: 'absolute',
        top: '8px',
        right: '12px',
        pointerEvents: 'auto',
        display: 'inline-flex',
        alignItems: 'center',
        lineHeight: 1,
        padding: '8px 12px',
        fontSize: '10px',
        letterSpacing: '0.14em',
        // Uppercase + positive tracking leaves a trailing gap after the last
        // letter, which reads as the label sitting left of its own box.
        textIndent: '0.14em',
        textTransform: 'uppercase',
        color: hovered ? 'var(--text-primary)' : 'var(--text-muted)',
        backgroundColor: hovered ? 'var(--hover-overlay)' : 'transparent',
        transition:
          'color var(--dur-micro) var(--ease-standard), background-color var(--dur-micro) var(--ease-standard)',
      }}
    >
      Close
    </button>
  );
}
