import { useState } from 'react';
import { createPortal } from 'react-dom';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import type { TrashedNote } from '@/types';

/**
 * The questions asked before anything leaves the Trash for good, worded the
 * same on the phone's Trash page and the desktop's Trash popover. The dialog
 * is portalled above the popover and preview, which sit at z-index 9999.
 */
export function useTrashConfirmations({
  trashedNotes,
  permanentlyDelete,
  emptyTrash,
}: {
  trashedNotes: TrashedNote[];
  /** Each reports its own failure in a toast. */
  permanentlyDelete: (trashId: string) => Promise<void>;
  emptyTrash: () => Promise<void>;
}) {
  const [pending, setPending] = useState<{ kind: 'delete'; id: string } | { kind: 'empty' } | null>(
    null
  );
  const cancel = () => setPending(null);
  const deleting =
    pending?.kind === 'delete' ? trashedNotes.find((note) => note.id === pending.id) : undefined;

  let dialog: React.ReactNode = null;
  if (deleting) {
    const title = `"${deleting.filename.replace(/\.md(\.locked)?$/, '')}"`;
    dialog = (
      <ConfirmDialog
        title="Delete permanently?"
        message={`${deleting.isFolder ? `The folder ${title}` : title} will be deleted permanently. This cannot be undone.`}
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          cancel();
          void permanentlyDelete(deleting.id).catch(() => undefined);
        }}
        onCancel={cancel}
      />
    );
  } else if (pending?.kind === 'empty') {
    dialog = (
      <ConfirmDialog
        title="Empty the Trash?"
        message={`${trashedNotes.length === 1 ? 'The note' : `All ${trashedNotes.length} items`} in the Trash will be deleted permanently. This cannot be undone.`}
        confirmLabel="Empty trash"
        danger
        onConfirm={() => {
          cancel();
          void emptyTrash().catch(() => undefined);
        }}
        onCancel={cancel}
      />
    );
  }

  return {
    confirmDelete: (trashId: string) => setPending({ kind: 'delete', id: trashId }),
    confirmEmpty: () => setPending({ kind: 'empty' }),
    isConfirming: dialog !== null,
    dialog:
      dialog && createPortal(<div className="relative z-[10000]">{dialog}</div>, document.body),
  };
}
