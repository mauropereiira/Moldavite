/**
 * GeneralSection: the Forge, the default .md app, and folded below them
 * auto-save, auto-lock and the Delete all notes danger zone. Backups live in
 * SettingsData.
 */

import { useState, useEffect } from 'react';
import { FolderOpen, RefreshCw, ExternalLink } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { DotLoader } from '@/components/ui/DotLoader';
import { useSettingsStore, useNoteStore } from '@/stores';
import type { AutoLockTimeout } from '@/stores';
import {
  clearAllNotes,
  getNotesDirectory,
  getForgesRoot,
  setForgesRoot,
  rescanForge,
  openForgeInFinder,
  listNotes,
} from '@/lib';
import { CURRENT_PLATFORM } from '@/lib/shortcuts';
import { isMobilePlatform } from '@/lib/platform';
import { Group, Row, SegmentedControl, ToggleRow, label } from '../common';
import { DialogSurface } from '@/components/ui/DialogSurface';
import SyncedForgeControl from '../SyncedForgeControl';
import DefaultMarkdownAppControl from '../DefaultMarkdownAppControl';
import { CloseButton } from '@/components/ui/CloseButton';

const AUTO_LOCK_OPTIONS: ReadonlyArray<{ value: AutoLockTimeout; label: string }> = [
  { value: 5, label: '5 min' },
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 60, label: '1 hour' },
  { value: 0, label: 'Never' },
];

export function GeneralSection() {
  const settings = useSettingsStore();
  // A phone cannot pick a folder (the dialog plugin has no directory picker
  // on iOS) or open Finder, so those controls stay desktop-only.
  const mobile = isMobilePlatform();
  // Actions are stable references, so selecting them individually (rather
  // than the whole store) means this section never re-renders on typing.
  const setNotes = useNoteStore((state) => state.setNotes);
  const setCurrentNote = useNoteStore((state) => state.setCurrentNote);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [isClearing, setIsClearing] = useState(false);
  const [notesDirectory, setNotesDirectoryState] = useState('');
  const [forgesRoot, setForgesRootState] = useState('');
  const [isChangingDir, setIsChangingDir] = useState(false);
  const [isRescanning, setIsRescanning] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Both paths on mount: the active Forge answers "where are my notes right
  // now", the root is what the Change button actually repoints.
  useEffect(() => {
    getNotesDirectory().then(setNotesDirectoryState).catch(console.error);
    getForgesRoot().then(setForgesRootState).catch(console.error);
  }, []);

  useEffect(() => {
    if (statusMessage) {
      const timeout = setTimeout(() => setStatusMessage(null), 3000);
      return () => clearTimeout(timeout);
    }
  }, [statusMessage]);

  const handleRescan = async () => {
    try {
      setIsRescanning(true);
      await rescanForge();
      const fresh = await listNotes();
      useNoteStore.getState().setNotes(fresh);
      setStatusMessage({ type: 'success', text: 'Forge re-scanned' });
    } catch (error) {
      console.error('[Settings] Failed to rescan Forge:', error);
      setStatusMessage({ type: 'error', text: String(error) });
    } finally {
      setIsRescanning(false);
    }
  };

  const handleOpenInFinder = async () => {
    try {
      await openForgeInFinder();
    } catch (error) {
      console.error('[Settings] Failed to open Forge in file browser:', error);
      setStatusMessage({ type: 'error', text: String(error) });
    }
  };

  /**
   * Repoint Moldavite at a different Forges root. It does not move files, and
   * the row's (i) says so.
   *
   * This used to call `set_notes_directory`, which promised to move the Forge
   * and instead destroyed part of it: it copied only the immediate files of
   * `daily/`, `notes/` and `templates/` (skipping `weekly/`, `images/`,
   * `.trash/`, `.plugins/` and every nested folder), then deleted the
   * originals, and wrote a config field that `get_notes_dir` no longer reads.
   * The app reopened the same Forge with those notes gone, under a toast
   * reading "Forge moved successfully!".
   */
  const handleChangeDirectory = async () => {
    try {
      setIsChangingDir(true);
      const selected = await open({
        directory: true,
        title: 'Select Forges Folder',
      });

      if (selected && typeof selected === 'string') {
        const resolved = await setForgesRoot(selected);
        setForgesRootState(resolved);
        setStatusMessage({ type: 'success', text: `Now looking for Forges in ${resolved}` });
        window.location.reload();
      }
    } catch (error) {
      console.error('[Settings] Failed to change Forges folder:', error);
      setStatusMessage({ type: 'error', text: String(error) });
    } finally {
      setIsChangingDir(false);
    }
  };

  const handleClearAllNotes = async () => {
    if (confirmText !== 'DELETE') return;

    try {
      setIsClearing(true);
      await clearAllNotes();
      setNotes([]);
      setCurrentNote(null);
      setShowClearConfirm(false);
      setConfirmText('');
      settings.setIsSettingsOpen(false);
    } catch (error) {
      console.error('[Settings] Failed to clear notes:', error);
    } finally {
      setIsClearing(false);
    }
  };

  return (
    <div className="settings-tab">
      {statusMessage && (
        <p
          className={statusMessage.type === 'success' ? 'settings-ok' : 'settings-error'}
          role="status"
        >
          {statusMessage.text}
        </p>
      )}

      <Group id="forge">
        {!mobile && (
          <Row
            id="forges-folder"
            note={
              <span className="truncate max-w-full font-mono" title={forgesRoot}>
                {forgesRoot}
              </span>
            }
          >
            <button
              onClick={handleChangeDirectory}
              disabled={isChangingDir}
              className="settings-btn"
            >
              <FolderOpen aria-hidden="true" className="w-4 h-4" />
              {isChangingDir ? 'Switching...' : 'Change'}
            </button>
          </Row>
        )}
        <Row
          id="this-forge"
          detail={
            !mobile &&
            notesDirectory && (
              <span className="settings-path-block">This Forge is at {notesDirectory}</span>
            )
          }
        >
          {!mobile && (
            <button onClick={handleOpenInFinder} className="settings-btn">
              <ExternalLink aria-hidden="true" className="w-4 h-4" />
              {CURRENT_PLATFORM === 'windows' ? 'Show in Explorer' : 'Open in Finder'}
            </button>
          )}
          <button onClick={handleRescan} disabled={isRescanning} className="settings-btn">
            {isRescanning ? (
              <DotLoader label="Rescanning Forge" />
            ) : (
              <RefreshCw aria-hidden="true" className="w-4 h-4" />
            )}
            {isRescanning ? 'Rescanning...' : 'Rescan'}
          </button>
        </Row>
        <SyncedForgeControl />
        <DefaultMarkdownAppControl />
      </Group>

      <Group id="saving">
        <Row id="autosave-delay">
          <input
            type="range"
            min="100"
            max="2000"
            step="100"
            value={settings.autoSaveDelay}
            aria-label={label('autosave-delay')}
            aria-valuetext={`${settings.autoSaveDelay} milliseconds`}
            onChange={(e) => settings.setAutoSaveDelay(Number(e.target.value))}
            className="settings-range"
          />
          <span className="settings-value">{settings.autoSaveDelay} ms</span>
        </Row>
        <ToggleRow
          id="save-status"
          value={settings.showAutoSaveStatus}
          onChange={settings.setShowAutoSaveStatus}
        />
        <Row id="auto-lock" stack>
          <SegmentedControl
            ariaLabel={label('auto-lock')}
            value={settings.autoLockTimeout}
            onChange={settings.setAutoLockTimeout}
            options={AUTO_LOCK_OPTIONS}
          />
        </Row>
      </Group>

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

      {/* Clear Confirmation Modal */}
      {showClearConfirm && (
        <div className="fixed inset-0 modal-backdrop-dark flex items-center justify-center z-[60] modal-backdrop-enter">
          <DialogSurface
            onEscape={
              isClearing
                ? undefined
                : () => {
                    setShowClearConfirm(false);
                    setConfirmText('');
                  }
            }
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
              <CloseButton
                onClick={() => {
                  setShowClearConfirm(false);
                  setConfirmText('');
                }}
                label="Close"
                disabled={isClearing}
              />
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
                onClick={() => {
                  setShowClearConfirm(false);
                  setConfirmText('');
                }}
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
    </div>
  );
}
