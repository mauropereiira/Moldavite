import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useTrash } from '@/hooks/useTrash';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { useOverlayPresence } from '@/components/overlays/useOverlayPresence';
import { SignatureEmptyState } from '@/components/ui/SignatureMark';
import type { TrashedNote } from '@/types';
import { useTrashConfirmations } from './useTrashConfirmations';

const TrashPreviewModal = lazy(() =>
  import('./TrashPreviewModal').then((module) => ({ default: module.TrashPreviewModal }))
);

/** Trash entries live 7 days, so the age follows from the days remaining. */
function trashedAgo(daysRemaining: number): string {
  const days = Math.max(0, 7 - daysRemaining);
  if (days === 0) return 'Today';
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

const rowAction: CSSProperties = {
  minWidth: 'var(--touch-target)',
  minHeight: 'var(--touch-target)',
  padding: '0 10px',
  fontSize: '14px',
  color: 'var(--text-secondary)',
};

/**
 * The phone's Trash: a page beside the rail like Index and Agenda. The
 * desktop keeps the floating TrashPopover.
 */
export function TrashPage({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const pageRef = useRef<HTMLDivElement>(null);
  const { trashedNotes, loadTrash, restoreNote, permanentlyDelete, emptyTrash, cleanupOld } =
    useTrash();
  const [previewNote, setPreviewNote] = useState<TrashedNote | null>(null);
  const { isRendered, isClosing } = useOverlayPresence(isOpen);
  // Reports its own failure in a toast.
  const restore = (id: string) => restoreNote(id).catch(() => undefined);
  const { confirmDelete, confirmEmpty, isConfirming, dialog } = useTrashConfirmations({
    trashedNotes,
    permanentlyDelete,
    emptyTrash,
  });

  useEffect(() => {
    if (!isOpen) return;
    void loadTrash();
    void cleanupOld();
  }, [isOpen, cleanupOld, loadTrash]);

  useFocusTrap(pageRef, isOpen && isRendered && !previewNote && !isConfirming);

  if (!isRendered) return null;

  return (
    <div
      ref={pageRef}
      className={`app-overlay impact-surface app-trash-overlay${isClosing ? ' app-overlay-closing' : ''}`}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 80,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        overflow: 'hidden',
        backgroundColor: 'var(--bg-base)',
        color: 'var(--text-primary)',
      }}
      role="region"
      aria-label="Trash"
      tabIndex={-1}
    >
      <header
        className="app-overlay-section app-overlay-header"
        style={
          {
            '--index': 0,
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: '24px',
            paddingBottom: '18px',
            borderBottom: '1px solid var(--border-default)',
          } as CSSProperties
        }
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px' }}>
          <h1
            className="app-overlay-title"
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: '28px',
              fontWeight: 500,
              letterSpacing: '-0.015em',
            }}
          >
            Trash
          </h1>
          <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-display)' }}>
            {trashedNotes.length}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="focus-ring app-overlay-close"
          style={{
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-display)',
            fontSize: '24px',
            lineHeight: 1,
          }}
          aria-label="Close Trash"
        >
          ×
        </button>
      </header>

      <div
        className="app-overlay-section app-trash-list"
        style={{ '--index': 1, flex: 1, minHeight: 0, overflowY: 'auto' } as CSSProperties}
      >
        {trashedNotes.length === 0 ? (
          <SignatureEmptyState className="py-6 text-sm">
            <p>Trash is empty.</p>
          </SignatureEmptyState>
        ) : (
          <>
            <p className="py-3 text-xs" style={{ color: 'var(--text-muted)' }}>
              Notes stay here for 7 days. Tap one to read it.
            </p>
            <ul>
              {trashedNotes.map((note) => {
                const title = note.filename.replace(/\.md(\.locked)?$/, '');
                return (
                  <li
                    key={note.id}
                    className="flex items-center gap-1"
                    style={{ borderTop: '1px solid var(--border-muted)' }}
                  >
                    <button
                      type="button"
                      className="flex-1 min-w-0 py-2 text-left"
                      style={{ minHeight: 'var(--touch-target)' }}
                      onClick={() => setPreviewNote(note)}
                    >
                      <span className="block truncate text-[15px]">{title}</span>
                      <span className="block text-xs" style={{ color: 'var(--text-muted)' }}>
                        {note.isFolder ? 'Folder · ' : note.isDaily ? 'Daily · ' : ''}
                        {note.filename.endsWith('.md.locked') ? 'Locked · ' : ''}
                        {trashedAgo(note.daysRemaining)} · {note.daysRemaining}d left
                      </span>
                    </button>
                    <button
                      type="button"
                      style={rowAction}
                      aria-label={`Restore ${title}`}
                      onClick={() => void restore(note.id)}
                    >
                      Restore
                    </button>
                    <button
                      type="button"
                      style={{ ...rowAction, color: 'var(--error)' }}
                      aria-label={`Delete ${title} permanently`}
                      onClick={() => confirmDelete(note.id)}
                    >
                      Delete
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      {trashedNotes.length > 0 && (
        <div
          className="app-overlay-section"
          style={{ '--index': 2, borderTop: '1px solid var(--border-default)' } as CSSProperties}
        >
          <button
            type="button"
            className="w-full text-sm"
            style={{ minHeight: 'var(--touch-target)', color: 'var(--error)' }}
            onClick={confirmEmpty}
          >
            Empty trash
          </button>
        </div>
      )}

      {previewNote && (
        <Suspense fallback={null}>
          <TrashPreviewModal
            note={previewNote}
            onClose={() => setPreviewNote(null)}
            onRestore={restore}
            onPermanentDelete={confirmDelete}
          />
        </Suspense>
      )}

      {dialog}
    </div>
  );
}
