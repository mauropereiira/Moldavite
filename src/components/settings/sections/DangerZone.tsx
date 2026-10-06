/** DangerZone: Delete all notes, at the bottom of Data behind its own fold. */

import { useState } from 'react';
import { useNoteStore, useSettingsStore } from '@/stores';
import { clearAllNotes } from '@/lib';
import { DialogSurface } from '@/components/ui/DialogSurface';
import { CloseButton } from '@/components/ui/CloseButton';
import { Group, Row } from '../common';

export function DangerZone() {
  const setNotes = useNoteStore((state) => state.setNotes);
  const setCurrentNote = useNoteStore((state) => state.setCurrentNote);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [isClearing, setIsClearing] = useState(false);

  const cancel = () => {
    setShowClearConfirm(false);
    setConfirmText('');
  };

  const handleClearAllNotes = async () => {
    if (confirmText !== 'DELETE') return;

    try {
      setIsClearing(true);
      await clearAllNotes();
      setNotes([]);
      setCurrentNote(null);
      cancel();
      useSettingsStore.getState().setIsSettingsOpen(false);
    } catch (error) {
      console.error('[Settings] Failed to clear notes:', error);
    } finally {
      setIsClearing(false);
    }
  };

  return (
    <>
      <Group id="danger">
        <Row id="delete-all">
          <button
            onClick={() => setShowClearConfirm(true)}
            className="settings-btn settings-btn-danger"
          >
            Delete all notes...
          </button>
        </Row>
      </Group>

      {showClearConfirm && (
        <div className="fixed inset-0 modal-backdrop-dark flex items-center justify-center z-[60] modal-backdrop-enter">
          <DialogSurface
            onEscape={isClearing ? undefined : cancel}
            aria-labelledby="clear-all-notes-title"
            className="p-6 max-w-sm mx-4 modal-elevated modal-content-enter"
            style={{ backgroundColor: 'transparent', borderRadius: 'var(--radius-md)' }}
          >
            <div className="dialog-head">
              <h3
                id="clear-all-notes-title"
                className="text-lg font-semibold mb-2"
                style={{ color: 'var(--error)' }}
              >
                Delete All Notes
              </h3>
              <CloseButton onClick={cancel} label="Close" disabled={isClearing} />
            </div>
            <p className="mb-4" style={{ color: 'var(--text-secondary)' }}>
              This will permanently delete ALL notes. This cannot be undone.
            </p>
            <p className="text-sm mb-2" style={{ color: 'var(--text-tertiary)' }}>
              Type{' '}
              <span className="font-mono font-bold" style={{ color: 'var(--error)' }}>
                DELETE
              </span>{' '}
              to confirm:
            </p>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="Type DELETE"
              className="w-full px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2"
              style={{
                backgroundColor: 'transparent',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-primary)',
              }}
              autoFocus
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={cancel}
                className="px-3 py-1.5 text-sm font-medium transition-colors focus-ring"
                style={{
                  backgroundColor: 'transparent',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-secondary)',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleClearAllNotes}
                disabled={confirmText !== 'DELETE' || isClearing}
                className={`px-3 py-1.5 text-sm font-medium focus-ring ${
                  confirmText !== 'DELETE' || isClearing ? 'btn-disabled' : 'btn-elevated'
                }`}
                style={{ backgroundColor: 'transparent', borderRadius: 'var(--radius-sm)' }}
              >
                {isClearing ? 'Deleting...' : 'Delete All'}
              </button>
            </div>
          </DialogSurface>
        </div>
      )}
    </>
  );
}
