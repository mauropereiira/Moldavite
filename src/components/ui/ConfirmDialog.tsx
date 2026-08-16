import { DialogSurface } from './DialogSurface';

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Styles the confirm button as destructive (red). */
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Accessible in-app replacement for window.confirm: role="dialog",
 * focus-trapped, Escape cancels, backdrop click cancels.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <div
      className="fixed inset-0 modal-backdrop-dark flex items-center justify-center z-50 modal-backdrop-enter"
      onClick={() => !busy && onCancel()}
    >
      <DialogSurface
        onEscape={busy ? undefined : onCancel}
        aria-labelledby="confirm-dialog-title"
        className="modal-elevated modal-content-enter p-6 max-w-sm mx-4"
        style={{ borderRadius: 'var(--radius-md)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3
          id="confirm-dialog-title"
          className="text-base font-semibold mb-2"
          style={{ color: 'var(--text-primary)' }}
        >
          {title}
        </h3>
        <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
          {message}
        </p>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="btn focus-ring" disabled={busy}>
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            autoFocus
            disabled={busy}
            className={danger ? 'btn btn-danger focus-ring' : 'btn btn-primary focus-ring'}
          >
            {confirmLabel}
          </button>
        </div>
      </DialogSurface>
    </div>
  );
}
