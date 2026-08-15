import { lazy, Suspense, useEffect, useState } from 'react';
import { TrashPopover } from '@/components/sidebar/TrashPopover';
import { useTrash } from '@/hooks/useTrash';
import type { TrashedNote } from '@/types';

const TrashPreviewModal = lazy(() =>
  import('@/components/sidebar/TrashPreviewModal').then((module) => ({
    default: module.TrashPreviewModal,
  }))
);

export function IconRailTrash({
  anchor,
  onClose,
}: {
  anchor: HTMLButtonElement;
  onClose: () => void;
}) {
  const { trashedNotes, loadTrash, restoreNote, permanentlyDelete, emptyTrash, cleanupOld } =
    useTrash();
  const [previewNote, setPreviewNote] = useState<TrashedNote | null>(null);

  useEffect(() => {
    void loadTrash();
    void cleanupOld();
  }, [cleanupOld, loadTrash]);

  return (
    <>
      <TrashPopover
        isOpen
        anchor={anchor}
        trashedNotes={trashedNotes}
        onClose={onClose}
        onRestore={restoreNote}
        onPermanentDelete={permanentlyDelete}
        onEmptyTrash={emptyTrash}
        onPreview={setPreviewNote}
      />
      {previewNote && (
        <Suspense fallback={null}>
          <TrashPreviewModal
            note={previewNote}
            onClose={() => setPreviewNote(null)}
            onRestore={restoreNote}
            onPermanentDelete={permanentlyDelete}
          />
        </Suspense>
      )}
    </>
  );
}
