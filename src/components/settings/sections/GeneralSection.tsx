/**
 * GeneralSection: the Forge, the default .md app and auto-lock. Backups and the
 * Delete all notes danger zone live in SettingsData.
 */

import { useState, useEffect } from 'react';
import { FolderOpen, RefreshCw, ExternalLink } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { DotLoader } from '@/components/ui/DotLoader';
import { useSettingsStore, useNoteStore } from '@/stores';
import type { AutoLockTimeout } from '@/stores';
import {
  getNotesDirectory,
  getForgesRoot,
  setForgesRoot,
  rescanForge,
  openForgeInFinder,
  listNotes,
} from '@/lib';
import { CURRENT_PLATFORM } from '@/lib/shortcuts';
import { isMobilePlatform } from '@/lib/platform';
import { Group, Row, SegmentedControl, label } from '../common';
import SyncedForgeControl from '../SyncedForgeControl';
import DefaultMarkdownAppControl from '../DefaultMarkdownAppControl';

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

      <Group id="lock">
        <Row id="auto-lock" stack>
          <SegmentedControl
            ariaLabel={label('auto-lock')}
            value={settings.autoLockTimeout}
            onChange={settings.setAutoLockTimeout}
            options={AUTO_LOCK_OPTIONS}
          />
        </Row>
      </Group>
    </div>
  );
}
