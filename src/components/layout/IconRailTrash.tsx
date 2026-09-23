import { lazy, Suspense, useEffect, useState } from 'react';
import { TrashPopover } from '@/components/sidebar/TrashPopover';
import { useTrash } from '@/hooks/useTrash';
import type { TrashedNote } from '@/types';
import { useTrashConfirmations } from '@/components/sidebar/useTrashConfirmations';

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
  const { confirmDelete, confirmEmpty, isConfirming, dialog } = useTrashConfirmations({
    trashedNotes,
    permanentlyDelete,
    emptyTrash,
  });

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
        // A press in the preview or a confirmation is outside the popover.
        // Closing then would unmount it, before its click lands.
        onClose={() => {
          if (!previewNote && !isConfirming) onClose();
        }}
        onRestore={restoreNote}
        onPermanentDelete={confirmDelete}
        onEmptyTrash={confirmEmpty}
        onPreview={setPreviewNote}
      />
      {previewNote && (
        <Suspense fallback={null}>
          <TrashPreviewModal
            note={previewNote}
            onClose={() => setPreviewNote(null)}
            onRestore={restoreNote}
            onPermanentDelete={confirmDelete}
          />
        </Suspense>
      )}
      {dialog}
    </>
  );
}
