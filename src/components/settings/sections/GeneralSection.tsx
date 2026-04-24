/**
 * GeneralSection — Notes directory, backup/restore, encrypted backups,
 * auto-lock, auto-save, and Clear-all-notes danger zone.
 *
 * All IPC calls go through the `@/lib` wrapper modules, which internally
 * use `safeInvoke` from `@/lib/ipc` (no direct Tauri `invoke` usage here).
 */

import { useState, useEffect } from 'react';
import { Lock, FolderOpen, Download, Upload, Shield, Eye, EyeOff, Timer } from 'lucide-react';
import { open, save } from '@tauri-apps/plugin-dialog';
import { useSettingsStore, useNoteStore } from '@/stores';
import type { AutoLockTimeout } from '@/stores';
import { clearAllNotes, getNotesDirectory, setNotesDirectory, exportNotes, importNotes, exportEncryptedBackup, importEncryptedBackup } from '@/lib';
import type { ImportResult } from '@/lib';
import { InfoTooltip, Toggle } from '../common';

export function GeneralSection() {
  const settings = useSettingsStore();
  const { setNotes, setCurrentNote } = useNoteStore();
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [isClearing, setIsClearing] = useState(false);
  const [notesDirectory, setNotesDirectoryState] = useState('');
  const [isChangingDir, setIsChangingDir] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [showImportOptions, setShowImportOptions] = useState(false);
  const [pendingImportPath, setPendingImportPath] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Encrypted backup state
  const [showEncryptedExportModal, setShowEncryptedExportModal] = useState(false);
  const [showEncryptedImportModal, setShowEncryptedImportModal] = useState(false);
  const [encryptedPassword, setEncryptedPassword] = useState('');
  const [encryptedConfirmPassword, setEncryptedConfirmPassword] = useState('');
  const [showEncryptedPassword, setShowEncryptedPassword] = useState(false);
  const [pendingEncryptedImportPath, setPendingEncryptedImportPath] = useState<string | null>(null);
  const [encryptedImportMerge, setEncryptedImportMerge] = useState(true);

  // Fetch current notes directory on mount
  useEffect(() => {
    getNotesDirectory().then(setNotesDirectoryState).catch(console.error);
  }, []);

  // Clear status message after 3 seconds
  useEffect(() => {
    if (statusMessage) {
      const timeout = setTimeout(() => setStatusMessage(null), 3000);
      return () => clearTimeout(timeout);
    }
  }, [statusMessage]);

  const handleChangeDirectory = async () => {
    try {
      setIsChangingDir(true);
      const selected = await open({
        directory: true,
        title: 'Select Notes Directory',
      });

      if (selected && typeof selected === 'string') {
        await setNotesDirectory(selected);
        setNotesDirectoryState(selected);
        setStatusMessage({ type: 'success', text: 'Notes directory changed successfully!' });
        // Refresh notes list
        window.location.reload();
      }
    } catch (error) {
      console.error('[Settings] Failed to change directory:', error);
      setStatusMessage({ type: 'error', text: String(error) });
    } finally {
      setIsChangingDir(false);
    }
  };

  const handleExport = async () => {
    try {
      setIsExporting(true);
      const date = new Date().toISOString().split('T')[0];
      const destination = await save({
        title: 'Export Notes',
        defaultPath: `moldavite-export-${date}.zip`,
        filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
      });

      if (destination) {
        await exportNotes(destination);
        setStatusMessage({ type: 'success', text: 'Notes exported successfully!' });
      }
    } catch (error) {
      console.error('[Settings] Failed to export notes:', error);
      setStatusMessage({ type: 'error', text: String(error) });
    } finally {
      setIsExporting(false);
    }
  };

  const handleImportSelect = async () => {
    try {
      const selected = await open({
        title: 'Import Notes',
        filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
      });

      if (selected && typeof selected === 'string') {
        setPendingImportPath(selected);
        setShowImportOptions(true);
      }
    } catch (error) {
      console.error('[Settings] Failed to select import file:', error);
      setStatusMessage({ type: 'error', text: String(error) });
    }
  };

  const handleImport = async (merge: boolean) => {
    if (!pendingImportPath) return;

    try {
      setIsImporting(true);
      setShowImportOptions(false);
      const result: ImportResult = await importNotes(pendingImportPath, merge);
      const total = result.dailyNotes + result.standaloneNotes + result.templates;
      setStatusMessage({
        type: 'success',
        text: `Imported ${total} items (${result.dailyNotes} daily, ${result.standaloneNotes} notes, ${result.templates} templates)`
      });
      setPendingImportPath(null);
      // Refresh notes list
      window.location.reload();
    } catch (error) {
      console.error('[Settings] Failed to import notes:', error);
      setStatusMessage({ type: 'error', text: String(error) });
    } finally {
      setIsImporting(false);
    }
  };

  // Encrypted backup handlers
  const handleEncryptedExportStart = () => {
    setEncryptedPassword('');
    setEncryptedConfirmPassword('');
    setShowEncryptedPassword(false);
    setShowEncryptedExportModal(true);
  };

  const handleEncryptedExport = async () => {
    if (encryptedPassword.length < 8) {
      setStatusMessage({ type: 'error', text: 'Password must be at least 8 characters' });
      return;
    }
    if (encryptedPassword !== encryptedConfirmPassword) {
      setStatusMessage({ type: 'error', text: 'Passwords do not match' });
      return;
    }

    try {
      setIsExporting(true);
      setShowEncryptedExportModal(false);
      const date = new Date().toISOString().split('T')[0];
      const destination = await save({
        title: 'Export Encrypted Backup',
        defaultPath: `moldavite-backup-${date}.moldavite-backup`,
        filters: [{ name: 'Moldavite Backup', extensions: ['moldavite-backup'] }],
      });

      if (destination) {
        await exportEncryptedBackup(destination, encryptedPassword);
        setStatusMessage({ type: 'success', text: 'Encrypted backup created successfully!' });
      }
    } catch (error) {
      console.error('[Settings] Failed to export encrypted backup:', error);
      setStatusMessage({ type: 'error', text: String(error) });
    } finally {
      setIsExporting(false);
      setEncryptedPassword('');
      setEncryptedConfirmPassword('');
    }
  };

  const handleEncryptedImportSelect = async () => {
    try {
      const selected = await open({
        title: 'Import Encrypted Backup',
        filters: [{ name: 'Moldavite Backup', extensions: ['moldavite-backup'] }],
      });

      if (selected && typeof selected === 'string') {
        setPendingEncryptedImportPath(selected);
        setEncryptedPassword('');
        setShowEncryptedPassword(false);
        setShowEncryptedImportModal(true);
      }
    } catch (error) {
      console.error('[Settings] Failed to select encrypted backup:', error);
      setStatusMessage({ type: 'error', text: String(error) });
    }
  };

  const handleEncryptedImport = async () => {
    if (!pendingEncryptedImportPath) return;

    try {
      setIsImporting(true);
      setShowEncryptedImportModal(false);
      const result: ImportResult = await importEncryptedBackup(
        pendingEncryptedImportPath,
        encryptedPassword,
        encryptedImportMerge
      );
      const total = result.dailyNotes + result.standaloneNotes + result.templates;
      setStatusMessage({
        type: 'success',
        text: `Imported ${total} items (${result.dailyNotes} daily, ${result.standaloneNotes} notes, ${result.templates} templates)`
      });
      setPendingEncryptedImportPath(null);
      // Refresh notes list
      window.location.reload();
    } catch (error) {
      console.error('[Settings] Failed to import encrypted backup:', error);
      const errorMsg = String(error);
      if (errorMsg.includes('Decryption failed')) {
        setStatusMessage({ type: 'error', text: 'Incorrect password or corrupted backup file' });
      } else {
        setStatusMessage({ type: 'error', text: errorMsg });
      }
    } finally {
      setIsImporting(false);
      setEncryptedPassword('');
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
        <div className={`p-3 rounded text-sm ${
          statusMessage.type === 'success'
            ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200 border border-green-200 dark:border-green-800'
            : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 border border-red-200 dark:border-red-800'
        }`}>
          {statusMessage.text}
        </div>
      )}

      {/* Storage Section */}
      <div className="p-4 space-y-4" style={{ backgroundColor: 'var(--bg-panel)', borderRadius: 'var(--radius-md)' }}>
        <div className="flex items-center gap-1">
          <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            Storage
          </h3>
          <InfoTooltip text="Where your notes are saved on your computer. All data is stored locally." />
        </div>

        <div>
          <label className="text-xs mb-1.5 block" style={{ color: 'var(--text-tertiary)' }}>
            Notes Directory
          </label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={notesDirectory}
              readOnly
              className="flex-1 px-3 py-2 text-sm"
              style={{
                backgroundColor: 'var(--bg-elevated)',
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
                backgroundColor: 'var(--bg-elevated)',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-secondary)',
              }}
            >
              <FolderOpen className="w-4 h-4" />
              {isChangingDir ? 'Moving...' : 'Change'}
            </button>
          </div>
          <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)' }}>
            Existing notes will be moved to the new location
          </p>
        </div>
      </div>

      {/* Backup & Restore Section */}
      <div className="p-4 space-y-4" style={{ backgroundColor: 'var(--bg-panel)', borderRadius: 'var(--radius-md)' }}>
        <div>
          <div className="flex items-center gap-1">
            <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              Backup & Restore
            </h3>
            <InfoTooltip text="Create ZIP backups of all your notes and templates. Import to restore from backup." />
          </div>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            Export or import your notes and templates
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleExport}
            disabled={isExporting}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-white transition-colors disabled:opacity-50"
            style={{ backgroundColor: 'var(--accent-primary)', borderRadius: 'var(--radius-sm)' }}
          >
            <Download className="w-4 h-4" />
            {isExporting ? 'Exporting...' : 'Export'}
          </button>
          <button
            onClick={handleImportSelect}
            disabled={isImporting}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50"
            style={{
              backgroundColor: 'var(--bg-elevated)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-secondary)',
            }}
          >
            <Upload className="w-4 h-4" />
            {isImporting ? 'Importing...' : 'Import'}
          </button>
        </div>
      </div>

      {/* Encrypted Backup Section */}
      <div className="p-4 space-y-4" style={{ backgroundColor: 'var(--bg-panel)', borderRadius: 'var(--radius-md)', border: '1px solid var(--accent-primary)' }}>
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'var(--accent-subtle)' }}>
            <Shield className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
          </div>
          <div>
            <div className="flex items-center gap-1">
              <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                Encrypted Backup
              </h3>
              <InfoTooltip text="Secure backups protected with military-grade AES-256 encryption. Requires a password to decrypt." />
            </div>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
              Password-protected backup with AES-256 encryption
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleEncryptedExportStart}
            disabled={isExporting}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-white transition-colors disabled:opacity-50"
            style={{ backgroundColor: 'var(--accent-primary)', borderRadius: 'var(--radius-sm)' }}
          >
            <Lock className="w-4 h-4" />
            {isExporting ? 'Exporting...' : 'Export Encrypted'}
          </button>
          <button
            onClick={handleEncryptedImportSelect}
            disabled={isImporting}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50"
            style={{
              backgroundColor: 'var(--bg-elevated)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-secondary)',
            }}
          >
            <Upload className="w-4 h-4" />
            {isImporting ? 'Importing...' : 'Import Encrypted'}
          </button>
        </div>
      </div>

      {/* Security Section */}
      <div className="p-4 space-y-4" style={{ backgroundColor: 'var(--bg-panel)', borderRadius: 'var(--radius-md)' }}>
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'var(--accent-subtle)' }}>
            <Timer className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
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
          <label className="text-xs mb-2 block" style={{ color: 'var(--text-tertiary)' }}>
            Lock after
          </label>
          <div className="flex gap-2 flex-wrap">
            {([
              { value: 5, label: '5 min' },
              { value: 15, label: '15 min' },
              { value: 30, label: '30 min' },
              { value: 60, label: '1 hour' },
              { value: 0, label: 'Never' },
            ] as { value: AutoLockTimeout; label: string }[]).map((option) => (
              <button
                key={option.value}
                onClick={() => settings.setAutoLockTimeout(option.value)}
                className="px-3 py-1.5 text-sm font-medium transition-colors"
                style={{
                  backgroundColor: settings.autoLockTimeout === option.value ? 'var(--accent-primary)' : 'var(--bg-elevated)',
                  color: settings.autoLockTimeout === option.value ? 'white' : 'var(--text-secondary)',
                  border: settings.autoLockTimeout === option.value ? 'none' : '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
            Unlocked notes will be automatically re-locked after the selected period of inactivity
          </p>
        </div>
      </div>

      {/* Auto-save Section */}
      <div className="p-4 space-y-4" style={{ backgroundColor: 'var(--bg-panel)', borderRadius: 'var(--radius-md)' }}>
        <div className="flex items-center gap-1">
          <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            Auto-save
          </h3>
          <InfoTooltip text="Notes are saved automatically as you type. Adjust the delay to balance between instant saves and reduced disk activity." />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Save delay
            </label>
            <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
              {settings.autoSaveDelay}ms
            </span>
          </div>
          <input
            type="range"
            min="100"
            max="2000"
            step="100"
            value={settings.autoSaveDelay}
            onChange={(e) => settings.setAutoSaveDelay(Number(e.target.value))}
            className="w-full h-2 rounded appearance-none cursor-pointer"
            style={{ backgroundColor: 'var(--bg-inset)', accentColor: 'var(--accent-primary)' }}
          />
          <div className="flex justify-between text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            <span>Fast</span>
            <span>Slow</span>
          </div>
        </div>

        <div className="flex items-center justify-between pt-2" style={{ borderTop: '1px solid var(--border-muted)' }}>
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
          />
        </div>
      </div>

      {/* Danger Zone */}
      <div className="p-4" style={{ borderRadius: 'var(--radius-md)', border: '2px solid var(--error)', backgroundColor: 'rgba(184, 92, 92, 0.1)' }}>
        <h3 className="text-sm font-medium mb-1" style={{ color: 'var(--error)' }}>
          Danger Zone
        </h3>
        <p className="text-xs mb-3" style={{ color: 'var(--error)', opacity: 0.8 }}>
          Permanently delete all notes. This cannot be undone.
        </p>
        <button
          onClick={() => setShowClearConfirm(true)}
          className="px-3 py-1.5 text-sm font-medium text-white transition-colors"
          style={{ backgroundColor: 'var(--error)', borderRadius: 'var(--radius-sm)' }}
        >
          Clear All Notes
        </button>
      </div>

      {/* Import Options Modal */}
      {showImportOptions && (
        <div className="fixed inset-0 modal-backdrop-dark flex items-center justify-center z-[60] modal-backdrop-enter">
          <div className="p-6 max-w-sm mx-4 modal-elevated modal-content-enter" style={{ backgroundColor: 'var(--bg-elevated)', borderRadius: 'var(--radius-md)' }}>
            <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
              Import Notes
            </h3>
            <p className="mb-4" style={{ color: 'var(--text-secondary)' }}>
              How would you like to import the notes?
            </p>
            <div className="space-y-2 mb-4">
              <button
                onClick={() => handleImport(true)}
                className="w-full px-4 py-3 text-left text-sm font-medium transition-colors"
                style={{ backgroundColor: 'var(--bg-panel)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)' }}
              >
                <span className="font-semibold">Merge with existing</span>
                <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                  Add new notes without overwriting existing ones
                </p>
              </button>
              <button
                onClick={() => handleImport(false)}
                className="w-full px-4 py-3 text-left text-sm font-medium transition-colors"
                style={{ backgroundColor: 'var(--bg-panel)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)' }}
              >
                <span className="font-semibold">Replace all</span>
                <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                  Clear existing notes and import from backup
                </p>
              </button>
            </div>
            <button
              onClick={() => {
                setShowImportOptions(false);
                setPendingImportPath(null);
              }}
              className="w-full px-3 py-1.5 text-sm font-medium transition-colors"
              style={{ backgroundColor: 'var(--bg-panel)', borderRadius: 'var(--radius-sm)', color: 'var(--text-secondary)' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Clear Confirmation Modal */}
      {showClearConfirm && (
        <div className="fixed inset-0 modal-backdrop-dark flex items-center justify-center z-[60] modal-backdrop-enter">
          <div className="p-6 max-w-sm mx-4 modal-elevated modal-content-enter" style={{ backgroundColor: 'var(--bg-elevated)', borderRadius: 'var(--radius-md)' }}>
            <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--error)' }}>
              Delete All Notes
            </h3>
            <p className="mb-4" style={{ color: 'var(--text-secondary)' }}>
              This will permanently delete ALL notes. This cannot be undone.
            </p>
            <p className="text-sm mb-2" style={{ color: 'var(--text-tertiary)' }}>
              Type <span className="font-mono font-bold" style={{ color: 'var(--error)' }}>DELETE</span> to confirm:
            </p>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="Type DELETE"
              className="w-full px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2"
              style={{
                backgroundColor: 'var(--bg-panel)',
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
                style={{ backgroundColor: 'var(--bg-panel)', borderRadius: 'var(--radius-sm)', color: 'var(--text-secondary)' }}
              >
                Cancel
              </button>
              <button
                onClick={handleClearAllNotes}
                disabled={confirmText !== 'DELETE' || isClearing}
                className={`px-3 py-1.5 text-sm font-medium text-white focus-ring ${
                  confirmText !== 'DELETE' || isClearing ? 'btn-disabled' : 'btn-elevated'
                }`}
                style={{ backgroundColor: 'var(--error)', borderRadius: 'var(--radius-sm)' }}
              >
                {isClearing ? 'Deleting...' : 'Delete All'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Encrypted Export Modal */}
      {showEncryptedExportModal && (
        <div className="fixed inset-0 modal-backdrop-dark flex items-center justify-center z-[60] modal-backdrop-enter">
          <div className="p-6 max-w-sm mx-4 modal-elevated modal-content-enter" style={{ backgroundColor: 'var(--bg-elevated)', borderRadius: 'var(--radius-md)' }}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: 'var(--accent-subtle)' }}>
                <Shield className="w-5 h-5" style={{ color: 'var(--accent-primary)' }} />
              </div>
              <div>
                <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Create Encrypted Backup
                </h3>
                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  Your backup will be protected with AES-256
                </p>
              </div>
            </div>

            <div className="space-y-3 mb-4">
              <div>
                <label className="text-xs mb-1.5 block" style={{ color: 'var(--text-tertiary)' }}>
                  Password (minimum 8 characters)
                </label>
                <div className="relative">
                  <input
                    type={showEncryptedPassword ? 'text' : 'password'}
                    value={encryptedPassword}
                    onChange={(e) => setEncryptedPassword(e.target.value)}
                    placeholder="Enter password"
                    className="w-full px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2"
                    style={{
                      backgroundColor: 'var(--bg-panel)',
                      border: '1px solid var(--border-default)',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--text-primary)',
                    }}
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowEncryptedPassword(!showEncryptedPassword)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {showEncryptedPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs mb-1.5 block" style={{ color: 'var(--text-tertiary)' }}>
                  Confirm Password
                </label>
                <input
                  type={showEncryptedPassword ? 'text' : 'password'}
                  value={encryptedConfirmPassword}
                  onChange={(e) => setEncryptedConfirmPassword(e.target.value)}
                  placeholder="Confirm password"
                  className="w-full px-3 py-2 text-sm focus:outline-none focus:ring-2"
                  style={{
                    backgroundColor: 'var(--bg-panel)',
                    border: '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-primary)',
                  }}
                />
              </div>
            </div>

            <div className="p-3 mb-4" style={{ backgroundColor: 'rgba(201, 163, 103, 0.15)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--warning)' }}>
              <p className="text-xs" style={{ color: 'var(--warning)' }}>
                <strong>Warning:</strong> If you forget this password, your backup cannot be recovered.
              </p>
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowEncryptedExportModal(false);
                  setEncryptedPassword('');
                  setEncryptedConfirmPassword('');
                }}
                className="px-3 py-1.5 text-sm font-medium transition-colors"
                style={{ backgroundColor: 'var(--bg-panel)', borderRadius: 'var(--radius-sm)', color: 'var(--text-secondary)' }}
              >
                Cancel
              </button>
              <button
                onClick={handleEncryptedExport}
                disabled={encryptedPassword.length < 8 || encryptedPassword !== encryptedConfirmPassword}
                className="px-3 py-1.5 text-sm font-medium text-white transition-colors disabled:opacity-50"
                style={{ backgroundColor: 'var(--accent-primary)', borderRadius: 'var(--radius-sm)' }}
              >
                Create Backup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Encrypted Import Modal */}
      {showEncryptedImportModal && (
        <div className="fixed inset-0 modal-backdrop-dark flex items-center justify-center z-[60] modal-backdrop-enter">
          <div className="p-6 max-w-sm mx-4 modal-elevated modal-content-enter" style={{ backgroundColor: 'var(--bg-elevated)', borderRadius: 'var(--radius-md)' }}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: 'var(--accent-subtle)' }}>
                <Lock className="w-5 h-5" style={{ color: 'var(--accent-primary)' }} />
              </div>
              <div>
                <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Import Encrypted Backup
                </h3>
                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  Enter the password to decrypt your backup
                </p>
              </div>
            </div>

            <div className="space-y-3 mb-4">
              <div>
                <label className="text-xs mb-1.5 block" style={{ color: 'var(--text-tertiary)' }}>
                  Password
                </label>
                <div className="relative">
                  <input
                    type={showEncryptedPassword ? 'text' : 'password'}
                    value={encryptedPassword}
                    onChange={(e) => setEncryptedPassword(e.target.value)}
                    placeholder="Enter backup password"
                    className="w-full px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2"
                    style={{
                      backgroundColor: 'var(--bg-panel)',
                      border: '1px solid var(--border-default)',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--text-primary)',
                    }}
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowEncryptedPassword(!showEncryptedPassword)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {showEncryptedPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs mb-1.5 block" style={{ color: 'var(--text-tertiary)' }}>
                  Import Mode
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setEncryptedImportMerge(true)}
                    className="flex-1 px-3 py-2 text-sm font-medium transition-colors"
                    style={{
                      backgroundColor: encryptedImportMerge ? 'var(--accent-primary)' : 'var(--bg-panel)',
                      color: encryptedImportMerge ? 'white' : 'var(--text-secondary)',
                      borderRadius: 'var(--radius-sm)',
                      border: encryptedImportMerge ? 'none' : '1px solid var(--border-default)',
                    }}
                  >
                    Merge
                  </button>
                  <button
                    onClick={() => setEncryptedImportMerge(false)}
                    className="flex-1 px-3 py-2 text-sm font-medium transition-colors"
                    style={{
                      backgroundColor: !encryptedImportMerge ? 'var(--accent-primary)' : 'var(--bg-panel)',
                      color: !encryptedImportMerge ? 'white' : 'var(--text-secondary)',
                      borderRadius: 'var(--radius-sm)',
                      border: !encryptedImportMerge ? 'none' : '1px solid var(--border-default)',
                    }}
                  >
                    Replace All
                  </button>
                </div>
                <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                  {encryptedImportMerge
                    ? 'Add new notes without overwriting existing ones'
                    : 'Clear existing notes and import from backup'}
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowEncryptedImportModal(false);
                  setEncryptedPassword('');
                  setPendingEncryptedImportPath(null);
                }}
                className="px-3 py-1.5 text-sm font-medium transition-colors"
                style={{ backgroundColor: 'var(--bg-panel)', borderRadius: 'var(--radius-sm)', color: 'var(--text-secondary)' }}
              >
                Cancel
              </button>
              <button
                onClick={handleEncryptedImport}
                disabled={!encryptedPassword}
                className="px-3 py-1.5 text-sm font-medium text-white transition-colors disabled:opacity-50"
                style={{ backgroundColor: 'var(--accent-primary)', borderRadius: 'var(--radius-sm)' }}
              >
                Import Backup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
