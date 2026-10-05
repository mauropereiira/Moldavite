import { Pin, PinOff } from 'lucide-react';
import { CloseButton } from '@/components/ui/CloseButton';
import { formatShortcut } from '@/lib/shortcuts';
import { isLooseId } from '@/lib/looseId';
import { useQuickSwitcherStore } from '@/stores';

/**
 * Pin and Close in the top-right of the open note, as two quiet icons.
 *
 * Close is here because the bar may be turned off, which would leave ⌘W as
 * the only way to close a note. Pin is here so pinning is one click from the
 * note you are reading. A file outside the Forge has no address to pin.
 */
export function NoteCloseButton({
  noteId,
  onClose,
  title,
}: {
  noteId: string;
  onClose: () => void;
  title: string;
}) {
  const pinned = useQuickSwitcherStore((state) => state.pinnedNoteIds.includes(noteId));
  const togglePinned = useQuickSwitcherStore((state) => state.togglePinned);

  return (
    <div className="note-corner-actions">
      {!isLooseId(noteId) && (
        <button
          type="button"
          className="note-corner-button"
          data-on={pinned || undefined}
          onClick={() => togglePinned(noteId)}
          aria-label={pinned ? `Unpin ${title} from the top bar` : `Pin ${title} to the top bar`}
          title={pinned ? 'Unpin from the top bar' : 'Pin to the top bar'}
        >
          <Pin className="w-3.5 h-3.5 tab-glyph-pinned" strokeWidth={1.25} aria-hidden="true" />
          {pinned && (
            <PinOff className="w-3.5 h-3.5 tab-glyph-unpin" strokeWidth={1.25} aria-hidden="true" />
          )}
        </button>
      )}
      <CloseButton
        onClick={onClose}
        label={`Close ${title} (${formatShortcut('⌘W')})`}
        shortcut={formatShortcut('⌘W')}
      />
    </div>
  );
}
