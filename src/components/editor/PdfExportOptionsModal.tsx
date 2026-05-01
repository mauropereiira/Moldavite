import { usePdfExportStore } from '@/stores';
import type { PdfPageSize, PdfMarginPreset } from '@/stores';

interface PdfExportOptionsModalProps {
  isOpen: boolean;
  /** Called when the user cancels — modal should close, no export. */
  onClose: () => void;
  /**
   * Called when the user confirms. Receives the chosen options so the caller
   * can immediately pass them to {@link exportNoteToPdf} without needing to
   * re-read the store.
   */
  onConfirm: (opts: { pageSize: PdfPageSize; margin: PdfMarginPreset }) => void;
  /**
   * Title of the modal — defaults to "PDF export options". Bulk export overrides
   * this so the user knows they're configuring the whole batch.
   */
  title?: string;
}

/**
 * Lightweight modal that lets the user pick a page size and margin preset
 * before triggering a PDF export. Choices are persisted via
 * {@link usePdfExportStore} so the next export defaults to the last-used pair.
 *
 * Kept intentionally small — two `<select>`s and a confirm button. The visual
 * style mirrors the existing modal patterns (delete confirm, note info) so we
 * don't introduce a new dialog idiom.
 */
export function PdfExportOptionsModal({
  isOpen,
  onClose,
  onConfirm,
  title = 'PDF export options',
}: PdfExportOptionsModalProps) {
  const pageSize = usePdfExportStore((s) => s.pageSize);
  const margin = usePdfExportStore((s) => s.margin);
  const setPageSize = usePdfExportStore((s) => s.setPageSize);
  const setMargin = usePdfExportStore((s) => s.setMargin);

  if (!isOpen) return null;

  const handleConfirm = () => {
    // Persist last-used choice. The store already does this on each setter
    // call, but we re-read here so the callback gets a consistent snapshot.
    onConfirm({ pageSize, margin });
  };

  return (
    <div
      className="fixed inset-0 modal-backdrop-dark flex items-center justify-center z-[9999] modal-backdrop-enter"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal-elevated modal-content-enter p-6 max-w-sm mx-4 w-full"
        style={{ borderRadius: 'var(--radius-md)' }}
      >
        <h3
          className="text-base font-semibold mb-4"
          style={{ color: 'var(--text-primary)' }}
        >
          {title}
        </h3>

        <div className="space-y-3 mb-6">
          <label className="block">
            <span
              className="text-xs font-medium mb-1 block"
              style={{ color: 'var(--text-secondary)' }}
            >
              Page size
            </span>
            <select
              value={pageSize}
              onChange={(e) => setPageSize(e.target.value as PdfPageSize)}
              className="w-full px-2 py-1.5 text-sm rounded focus-ring"
              style={{
                backgroundColor: 'var(--bg-elevated)',
                border: '1px solid var(--border-default)',
                color: 'var(--text-primary)',
              }}
            >
              <option value="letter">Letter (8.5 × 11 in)</option>
              <option value="a4">A4 (210 × 297 mm)</option>
              <option value="legal">Legal (8.5 × 14 in)</option>
            </select>
          </label>

          <label className="block">
            <span
              className="text-xs font-medium mb-1 block"
              style={{ color: 'var(--text-secondary)' }}
            >
              Margins
            </span>
            <select
              value={margin}
              onChange={(e) => setMargin(e.target.value as PdfMarginPreset)}
              className="w-full px-2 py-1.5 text-sm rounded focus-ring"
              style={{
                backgroundColor: 'var(--bg-elevated)',
                border: '1px solid var(--border-default)',
                color: 'var(--text-primary)',
              }}
            >
              <option value="narrow">Narrow</option>
              <option value="normal">Normal</option>
              <option value="wide">Wide</option>
            </select>
          </label>
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn focus-ring">
            Cancel
          </button>
          <button onClick={handleConfirm} className="btn btn-primary focus-ring">
            Export
          </button>
        </div>
      </div>
    </div>
  );
}
