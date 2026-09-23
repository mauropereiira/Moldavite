/**
 * GeneralSection — Notes directory, auto-lock, auto-save, and the
 * Clear-all-notes danger zone. Backups live in SettingsData.
 *
 * All IPC calls go through the `@/lib` wrapper modules, which internally
 * use `safeInvoke` from `@/lib/ipc` (no direct Tauri `invoke` usage here).
 */

import { useState, useEffect } from 'react';
import { FolderOpen, Timer, RefreshCw, ExternalLink } from 'lucide-react';
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
import { InfoTooltip, SegmentedControl, Toggle } from '../common';
import { DialogSurface } from '@/components/ui/DialogSurface';
import SyncedForgeControl from '../SyncedForgeControl';

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
   * the copy beside it says so.
   *
   * This used to call `set_notes_directory`, which promised to move the Forge
   * and instead destroyed part of it: it copied only the immediate files of
   * `daily/`, `notes/` and `templates/` — skipping `weekly/`, `images/`,
   * `.trash/`, `.plugins/` and every nested folder — then deleted the
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
    <div className="space-y-6">
      {/* Status Message */}
      {statusMessage && (
        <div
          className="p-3 rounded text-sm border"
          style={{
            color: statusMessage.type === 'success' ? 'var(--success)' : 'var(--error)',
            backgroundColor: 'transparent',
            borderColor: statusMessage.type === 'success' ? 'var(--success)' : 'var(--error)',
          }}
        >
          {statusMessage.text}
        </div>
      )}

      {/* Forge Section */}
      <div
        className="p-4 space-y-4"
        style={{ backgroundColor: 'transparent', borderRadius: 'var(--radius-md)' }}
      >
        <div className="flex items-center gap-1">
          <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            Forge
          </h3>
          <InfoTooltip text="Your notes live in your Forge — a folder of plain .md files you can sync, back up, or open in any other tool." />
        </div>

        <div>
          {!mobile && (
            <>
              <label className="text-xs mb-1.5 block" style={{ color: 'var(--text-tertiary)' }}>
                Forges folder
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={forgesRoot}
                  readOnly
                  className="flex-1 px-3 py-2 text-sm"
                  style={{
                    backgroundColor: 'transparent',
                    border: '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-tertiary)',
                  }}
                />
                <button
                  onClick={handleChangeDirectory}
                  disabled={isChangingDir}
                  className="flex items-center gap-2 px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50"
                  style={{
                    backgroundColor: 'transparent',
                    border: '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  <FolderOpen aria-hidden="true" className="w-4 h-4" />
                  {isChangingDir ? 'Switching...' : 'Change'}
                </button>
              </div>
            </>
          )}
          {mobile ? (
            <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)' }}>
              Your notes are plain Markdown files. Local Forges stay on this device.
            </p>
          ) : (
            <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)' }}>
              Plain .md files. Sync, back up, or open in any other tool. This Forge is at{' '}
              <span
                className={mobile ? 'font-mono' : 'font-mono break-all'}
                style={
                  mobile
                    ? { color: 'var(--text-tertiary)', overflowWrap: 'anywhere', fontSize: '13px' }
                    : { color: 'var(--text-tertiary)' }
                }
              >
                {notesDirectory}
              </span>
              .
            </p>
          )}
          <SyncedForgeControl />
          {!mobile && (
            <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)' }}>
              Changing this points Moldavite at a different folder — it does not move your files. To
              relocate a Forge, quit Moldavite, move the folder yourself, then point it here.
            </p>
          )}
        </div>

        <div className="flex gap-2 flex-wrap">
          {!mobile && (
            <button
              onClick={handleOpenInFinder}
              className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium transition-colors"
              style={{
                backgroundColor: 'transparent',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-secondary)',
              }}
            >
              <ExternalLink aria-hidden="true" className="w-4 h-4" />
              {CURRENT_PLATFORM === 'windows' ? 'Show in Explorer' : 'Open Forge in Finder'}
            </button>
          )}
          <button
            onClick={handleRescan}
            disabled={isRescanning}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50"
            style={{
              backgroundColor: 'transparent',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-secondary)',
            }}
          >
            {isRescanning ? (
              <DotLoader label="Rescanning Forge" />
            ) : (
              <RefreshCw aria-hidden="true" className="w-4 h-4" />
            )}
            {isRescanning ? 'Rescanning...' : 'Rescan Forge'}
          </button>
        </div>
      </div>

      <p className="px-4 text-xs" style={{ color: 'var(--text-tertiary)' }}>
        Backups, exports and restores are in Data.
      </p>

      {/* Security Section */}
      <div
        className="p-4 space-y-4"
        style={{ backgroundColor: 'transparent', borderRadius: 'var(--radius-md)' }}
      >
        <div className="flex items-start gap-3">
          <div
            aria-hidden="true"
            className="w-8 h-8 flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: 'transparent' }}
          >
            <Timer className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
          </div>
          <div>
            <div className="flex items-center gap-1">
              <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                Auto-Lock
              </h3>
              <InfoTooltip text="For encrypted notes. Automatically locks unlocked notes after a period of inactivity for security." />
            </div>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
              Automatically re-lock notes after inactivity
            </p>
          </div>
        </div>
        <div>
          <SegmentedControl
            label="Lock after"
            ariaLabel="Lock after"
            value={settings.autoLockTimeout}
            onChange={settings.setAutoLockTimeout}
            options={AUTO_LOCK_OPTIONS}
          />
          <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
            Unlocked notes will be automatically re-locked after the selected period of inactivity
          </p>
        </div>
      </div>

      {/* Auto-save Section */}
      <div
        className="p-4 space-y-4"
        style={{ backgroundColor: 'transparent', borderRadius: 'var(--radius-md)' }}
      >
        <div className="flex items-center gap-1">
          <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            Auto-save
          </h3>
          <InfoTooltip text="Notes are saved automatically as you type. Adjust the delay to balance between instant saves and reduced disk activity." />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label
              htmlFor="autosave-delay-range"
              className="text-xs"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Save delay
            </label>
            <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
              {settings.autoSaveDelay}ms
            </span>
          </div>
          <input
            id="autosave-delay-range"
            type="range"
            min="100"
            max="2000"
            step="100"
            value={settings.autoSaveDelay}
            aria-valuetext={`${settings.autoSaveDelay} milliseconds`}
            onChange={(e) => settings.setAutoSaveDelay(Number(e.target.value))}
            className="settings-range w-full appearance-none cursor-pointer"
          />
          <div className="flex justify-between text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            <span>Fast</span>
            <span>Slow</span>
          </div>
        </div>

        <div
          className="flex items-center justify-between pt-2"
          style={{ borderTop: '1px solid var(--border-muted)' }}
        >
          <div>
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Show save indicator
            </span>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Display &quot;Saving...&quot; when auto-saving
            </p>
          </div>
          <Toggle
            enabled={settings.showAutoSaveStatus}
            onChange={settings.setShowAutoSaveStatus}
            ariaLabel="Show auto-save status"
          />
        </div>
      </div>

      {/* Danger Zone */}
      <div
        className="p-4"
        style={{
          borderRadius: 'var(--radius-md)',
          border: '2px solid var(--error)',
          backgroundColor: 'transparent',
        }}
      >
        <h3 className="text-sm font-medium mb-1" style={{ color: 'var(--error)' }}>
          Danger Zone
        </h3>
        <p className="text-xs mb-3" style={{ color: 'var(--error)', opacity: 0.8 }}>
          Permanently delete all notes. This cannot be undone.
        </p>
        <button
          onClick={() => setShowClearConfirm(true)}
          className="px-3 py-1.5 text-sm font-medium transition-colors"
          style={{ backgroundColor: 'transparent', borderRadius: 'var(--radius-sm)' }}
        >
          Clear All Notes
        </button>
      </div>

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
            <h3
              id="clear-all-notes-title"
              className="text-lg font-semibold mb-2"
              style={{ color: 'var(--error)' }}
            >
              Delete All Notes
            </h3>
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
