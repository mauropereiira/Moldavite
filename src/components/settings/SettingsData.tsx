import { useState } from 'react';
import { Download, Upload, Lock, Loader2, Shield, Eye, EyeOff, Settings as SettingsIcon } from 'lucide-react';
import { open, save } from '@tauri-apps/plugin-dialog';
import { safeInvoke as invoke } from '@/lib/ipc';
import {
  exportNotes,
  importNotes,
  exportEncryptedBackup,
  importEncryptedBackup,
} from '@/lib';
import type { ImportResult } from '@/lib';
import { useToast } from '@/hooks/useToast';

const SETTINGS_LS_KEYS = [
  'moldavite-calendar',
  'moldavite-folders',
  'moldavite-pinned-tabs',
  'moldavite-recent-notes',
  'moldavite-settings',
  'moldavite-theme',
] as const;

const SETTINGS_EXPORT_VERSION = 1;

interface SettingsExportPayload {
  app: 'moldavite';
  kind: 'settings';
  version: number;
  exportedAt: string;
  entries: Record<string, string>;
}

/**
 * Data tab — bulk import / export actions.
 *
 * Plain ZIP export/import, encrypted backup export/import, and JSON
 * settings export/import (frontend-only: serialises the `moldavite-*`
 * localStorage keys without touching the backend).
 */
export function SettingsData() {
  const toast = useToast();

  const [isExportingNotes, setIsExportingNotes] = useState(false);
  const [isImportingNotes, setIsImportingNotes] = useState(false);
  const [isExportingBackup, setIsExportingBackup] = useState(false);
  const [isImportingBackup, setIsImportingBackup] = useState(false);
  const [isExportingSettings, setIsExportingSettings] = useState(false);
  const [isImportingSettings, setIsImportingSettings] = useState(false);

  // Import-mode picker (merge vs replace) for plain notes import
  const [pendingZipPath, setPendingZipPath] = useState<string | null>(null);

  // Encrypted export modal
  const [showEncryptedExport, setShowEncryptedExport] = useState(false);
  const [exportPw, setExportPw] = useState('');
  const [exportPwConfirm, setExportPwConfirm] = useState('');
  const [showExportPw, setShowExportPw] = useState(false);

  // Encrypted import modal
  const [showEncryptedImport, setShowEncryptedImport] = useState(false);
  const [pendingBackupPath, setPendingBackupPath] = useState<string | null>(null);
  const [importPw, setImportPw] = useState('');
  const [showImportPw, setShowImportPw] = useState(false);
  const [importMerge, setImportMerge] = useState(true);

  // ---- Plain notes export ---------------------------------------------------
  const handleExportNotes = async () => {
    try {
      setIsExportingNotes(true);
      const date = new Date().toISOString().split('T')[0];
      const destination = await save({
        title: 'Export Notes',
        defaultPath: `moldavite-export-${date}.zip`,
        filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
      });
      if (!destination) return;
      await exportNotes(destination);
      toast.success('Notes exported successfully');
    } catch (error) {
      console.error('[SettingsData] export notes failed:', error);
      toast.error(`Export failed: ${String(error)}`);
    } finally {
      setIsExportingNotes(false);
    }
  };

  // ---- Plain notes import ---------------------------------------------------
  const handleSelectZip = async () => {
    try {
      const selected = await open({
        title: 'Import Notes',
        filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
      });
      if (selected && typeof selected === 'string') {
        setPendingZipPath(selected);
      }
    } catch (error) {
      console.error('[SettingsData] select zip failed:', error);
      toast.error(`Failed to open file picker: ${String(error)}`);
    }
  };

  const handleImportNotes = async (merge: boolean) => {
    if (!pendingZipPath) return;
    try {
      setIsImportingNotes(true);
      setPendingZipPath(null);
      const result: ImportResult = await importNotes(pendingZipPath, merge);
      const total = result.dailyNotes + result.standaloneNotes + result.templates;
      toast.success(
        `Imported ${total} items (${result.dailyNotes} daily, ${result.standaloneNotes} notes, ${result.templates} templates)`,
      );
      // Refresh so in-memory stores pick up new files.
      window.location.reload();
    } catch (error) {
      console.error('[SettingsData] import notes failed:', error);
      toast.error(`Import failed: ${String(error)}`);
    } finally {
      setIsImportingNotes(false);
    }
  };

  // ---- Encrypted backup export ---------------------------------------------
  const handleEncryptedExport = async () => {
    if (exportPw.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }
    if (exportPw !== exportPwConfirm) {
      toast.error('Passwords do not match');
      return;
    }
    try {
      setIsExportingBackup(true);
      setShowEncryptedExport(false);
      const date = new Date().toISOString().split('T')[0];
      const destination = await save({
        title: 'Export Encrypted Backup',
        defaultPath: `moldavite-backup-${date}.moldavite-backup`,
        filters: [{ name: 'Moldavite Backup', extensions: ['moldavite-backup'] }],
      });
      if (!destination) return;
      await exportEncryptedBackup(destination, exportPw);
      toast.success('Encrypted backup created');
    } catch (error) {
      console.error('[SettingsData] encrypted export failed:', error);
      toast.error(`Encrypted export failed: ${String(error)}`);
    } finally {
      setIsExportingBackup(false);
      setExportPw('');
      setExportPwConfirm('');
    }
  };

  // ---- Encrypted backup import ---------------------------------------------
  const handleSelectBackup = async () => {
    try {
      const selected = await open({
        title: 'Import Encrypted Backup',
        filters: [{ name: 'Moldavite Backup', extensions: ['moldavite-backup'] }],
      });
      if (selected && typeof selected === 'string') {
        setPendingBackupPath(selected);
        setImportPw('');
        setShowImportPw(false);
        setImportMerge(true);
        setShowEncryptedImport(true);
      }
    } catch (error) {
      console.error('[SettingsData] select backup failed:', error);
      toast.error(`Failed to open file picker: ${String(error)}`);
    }
  };

  const handleEncryptedImport = async () => {
    if (!pendingBackupPath) return;
    try {
      setIsImportingBackup(true);
      setShowEncryptedImport(false);
      const result: ImportResult = await importEncryptedBackup(
        pendingBackupPath,
        importPw,
        importMerge,
      );
      const total = result.dailyNotes + result.standaloneNotes + result.templates;
      toast.success(
        `Imported ${total} items (${result.dailyNotes} daily, ${result.standaloneNotes} notes, ${result.templates} templates)`,
      );
      setPendingBackupPath(null);
      window.location.reload();
    } catch (error) {
      console.error('[SettingsData] encrypted import failed:', error);
      const msg = String(error);
      if (msg.includes('Decryption failed')) {
        toast.error('Incorrect password or corrupted backup file');
      } else {
        toast.error(`Encrypted import failed: ${msg}`);
      }
    } finally {
      setIsImportingBackup(false);
      setImportPw('');
    }
  };

  // ---- Settings JSON export / import (frontend-only) -----------------------
  const handleExportSettings = async () => {
    try {
      setIsExportingSettings(true);
      const entries: Record<string, string> = {};
      for (const key of SETTINGS_LS_KEYS) {
        const value = localStorage.getItem(key);
        if (value !== null) entries[key] = value;
      }
      const payload: SettingsExportPayload = {
        app: 'moldavite',
        kind: 'settings',
        version: SETTINGS_EXPORT_VERSION,
        exportedAt: new Date().toISOString(),
        entries,
      };
      const date = new Date().toISOString().split('T')[0];
      const destination = await save({
        title: 'Export Settings',
        defaultPath: `moldavite-settings-${date}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (!destination) return;
      await invoke('export_settings_json', {
        path: destination,
        json: JSON.stringify(payload, null, 2),
      });
      toast.success('Settings exported successfully');
    } catch (error) {
      console.error('[SettingsData] export settings failed:', error);
      toast.error(`Export failed: ${String(error)}`);
    } finally {
      setIsExportingSettings(false);
    }
  };

  const handleImportSettings = async () => {
    try {
      const selected = await open({
        title: 'Import Settings',
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (!selected || typeof selected !== 'string') return;
      setIsImportingSettings(true);
      const raw = await invoke<string>('import_settings_json', { path: selected });
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        toast.error('Invalid JSON file');
        return;
      }
      const payload = parsed as Partial<SettingsExportPayload>;
      if (
        !payload ||
        payload.app !== 'moldavite' ||
        payload.kind !== 'settings' ||
        typeof payload.entries !== 'object' ||
        payload.entries === null
      ) {
        toast.error('Not a valid Moldavite settings file');
        return;
      }
      let applied = 0;
      for (const key of SETTINGS_LS_KEYS) {
        const value = (payload.entries as Record<string, unknown>)[key];
        if (typeof value === 'string') {
          localStorage.setItem(key, value);
          applied += 1;
        }
      }
      toast.success(`Imported ${applied} settings keys — reloading…`);
      setTimeout(() => window.location.reload(), 400);
    } catch (error) {
      console.error('[SettingsData] import settings failed:', error);
      toast.error(`Import failed: ${String(error)}`);
    } finally {
      setIsImportingSettings(false);
    }
  };

  const buttonPrimary =
    'flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-white transition-colors disabled:opacity-50';
  const buttonSecondary =
    'flex items-center gap-2 px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50';

  return (
    <div className="space-y-6">
      {/* Notes: plain ZIP export / import */}
      <div
        className="p-4 space-y-4"
        style={{ backgroundColor: 'var(--bg-panel)', borderRadius: 'var(--radius-md)' }}
      >
        <div>
          <h3
            className="text-sm font-medium"
            style={{ color: 'var(--text-primary)' }}
          >
            Notes
          </h3>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            Export all notes and templates as a ZIP archive, or import from one
          </p>
        </div>

        <div className="flex gap-2 flex-wrap">
          <button
            onClick={handleExportNotes}
            disabled={isExportingNotes}
            className={buttonPrimary}
            style={{
              backgroundColor: 'var(--accent-primary)',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            {isExportingNotes ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            {isExportingNotes ? 'Exporting...' : 'Export all notes (.zip)'}
          </button>
          <button
            onClick={handleSelectZip}
            disabled={isImportingNotes}
            className={buttonSecondary}
            style={{
              backgroundColor: 'var(--bg-elevated)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-secondary)',
            }}
          >
            {isImportingNotes ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Upload className="w-4 h-4" />
            )}
            {isImportingNotes ? 'Importing...' : 'Import notes from .zip'}
          </button>
        </div>
      </div>

      {/* Encrypted backup */}
      <div
        className="p-4 space-y-4"
        style={{
          backgroundColor: 'var(--bg-panel)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--accent-primary)',
        }}
      >
        <div className="flex items-start gap-3">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: 'var(--accent-subtle)' }}
          >
            <Shield className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
          </div>
          <div>
            <h3
              className="text-sm font-medium"
              style={{ color: 'var(--text-primary)' }}
            >
              Encrypted Backup
            </h3>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
              Password-protected backup with AES-256 encryption
            </p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => {
              setExportPw('');
              setExportPwConfirm('');
              setShowExportPw(false);
              setShowEncryptedExport(true);
            }}
            disabled={isExportingBackup}
            className={buttonPrimary}
            style={{
              backgroundColor: 'var(--accent-primary)',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            {isExportingBackup ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Lock className="w-4 h-4" />
            )}
            {isExportingBackup ? 'Exporting...' : 'Export encrypted backup'}
          </button>
          <button
            onClick={handleSelectBackup}
            disabled={isImportingBackup}
            className={buttonSecondary}
            style={{
              backgroundColor: 'var(--bg-elevated)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-secondary)',
            }}
          >
            {isImportingBackup ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Upload className="w-4 h-4" />
            )}
            {isImportingBackup ? 'Importing...' : 'Import encrypted backup'}
          </button>
        </div>
      </div>

      {/* Settings JSON export / import */}
      <div
        className="p-4 space-y-4"
        style={{ backgroundColor: 'var(--bg-panel)', borderRadius: 'var(--radius-md)' }}
      >
        <div className="flex items-start gap-3">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: 'var(--accent-subtle)' }}
          >
            <SettingsIcon className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
          </div>
          <div>
            <h3
              className="text-sm font-medium"
              style={{ color: 'var(--text-primary)' }}
            >
              Settings
            </h3>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
              Export your preferences, theme, folders and pinned tabs as JSON —
              useful for syncing across devices. Notes are not included.
            </p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={handleExportSettings}
            disabled={isExportingSettings}
            className={buttonPrimary}
            style={{
              backgroundColor: 'var(--accent-primary)',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            {isExportingSettings ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            {isExportingSettings ? 'Exporting...' : 'Export settings (.json)'}
          </button>
          <button
            onClick={handleImportSettings}
            disabled={isImportingSettings}
            className={buttonSecondary}
            style={{
              backgroundColor: 'var(--bg-elevated)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-secondary)',
            }}
          >
            {isImportingSettings ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Upload className="w-4 h-4" />
            )}
            {isImportingSettings ? 'Importing...' : 'Import settings (.json)'}
          </button>
        </div>
      </div>

      {/* Merge-vs-replace picker for plain notes import */}
      {pendingZipPath && (
        <div className="fixed inset-0 modal-backdrop-dark flex items-center justify-center z-[60] modal-backdrop-enter">
          <div
            className="p-6 max-w-sm mx-4 modal-elevated modal-content-enter"
            style={{
              backgroundColor: 'var(--bg-elevated)',
              borderRadius: 'var(--radius-md)',
            }}
          >
            <h3
              className="text-lg font-semibold mb-2"
              style={{ color: 'var(--text-primary)' }}
            >
              Import Notes
            </h3>
            <p className="mb-4" style={{ color: 'var(--text-secondary)' }}>
              How would you like to import the notes?
            </p>
            <div className="space-y-2 mb-4">
              <button
                onClick={() => handleImportNotes(true)}
                className="w-full px-4 py-3 text-left text-sm font-medium transition-colors"
                style={{
                  backgroundColor: 'var(--bg-panel)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-primary)',
                }}
              >
                <span className="font-semibold">Merge with existing</span>
                <p
                  className="text-xs mt-1"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  Add new notes without overwriting existing ones
                </p>
              </button>
              <button
                onClick={() => handleImportNotes(false)}
                className="w-full px-4 py-3 text-left text-sm font-medium transition-colors"
                style={{
                  backgroundColor: 'var(--bg-panel)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-primary)',
                }}
              >
                <span className="font-semibold">Replace all</span>
                <p
                  className="text-xs mt-1"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  Clear existing notes and import from backup
                </p>
              </button>
            </div>
            <button
              onClick={() => setPendingZipPath(null)}
              className="w-full px-3 py-1.5 text-sm font-medium transition-colors"
              style={{
                backgroundColor: 'var(--bg-panel)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-secondary)',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Encrypted export: password prompt */}
      {showEncryptedExport && (
        <div className="fixed inset-0 modal-backdrop-dark flex items-center justify-center z-[60] modal-backdrop-enter">
          <div
            className="p-6 max-w-sm mx-4 modal-elevated modal-content-enter"
            style={{
              backgroundColor: 'var(--bg-elevated)',
              borderRadius: 'var(--radius-md)',
            }}
          >
            <div className="flex items-center gap-3 mb-4">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center"
                style={{ backgroundColor: 'var(--accent-subtle)' }}
              >
                <Shield
                  className="w-5 h-5"
                  style={{ color: 'var(--accent-primary)' }}
                />
              </div>
              <div>
                <h3
                  className="text-lg font-semibold"
                  style={{ color: 'var(--text-primary)' }}
                >
                  Create Encrypted Backup
                </h3>
                <p
                  className="text-xs"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  AES-256 encrypted archive
                </p>
              </div>
            </div>
            <div className="space-y-3 mb-4">
              <div>
                <label
                  className="text-xs mb-1.5 block"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  Password (minimum 8 characters)
                </label>
                <div className="relative">
                  <input
                    type={showExportPw ? 'text' : 'password'}
                    value={exportPw}
                    onChange={(e) => setExportPw(e.target.value)}
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
                    onClick={() => setShowExportPw(!showExportPw)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1"
                    style={{ color: 'var(--text-muted)' }}
                    aria-label={showExportPw ? 'Hide password' : 'Show password'}
                  >
                    {showExportPw ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>
              <div>
                <label
                  className="text-xs mb-1.5 block"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  Confirm Password
                </label>
                <input
                  type={showExportPw ? 'text' : 'password'}
                  value={exportPwConfirm}
                  onChange={(e) => setExportPwConfirm(e.target.value)}
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
            <div
              className="p-3 mb-4"
              style={{
                backgroundColor: 'rgba(201, 163, 103, 0.15)',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--warning)',
              }}
            >
              <p className="text-xs" style={{ color: 'var(--warning)' }}>
                <strong>Warning:</strong> If you forget this password, your backup
                cannot be recovered.
              </p>
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowEncryptedExport(false);
                  setExportPw('');
                  setExportPwConfirm('');
                }}
                className="px-3 py-1.5 text-sm font-medium transition-colors"
                style={{
                  backgroundColor: 'var(--bg-panel)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-secondary)',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleEncryptedExport}
                disabled={
                  exportPw.length < 8 || exportPw !== exportPwConfirm
                }
                className="px-3 py-1.5 text-sm font-medium text-white transition-colors disabled:opacity-50"
                style={{
                  backgroundColor: 'var(--accent-primary)',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                Create Backup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Encrypted import: password + merge choice */}
      {showEncryptedImport && (
        <div className="fixed inset-0 modal-backdrop-dark flex items-center justify-center z-[60] modal-backdrop-enter">
          <div
            className="p-6 max-w-sm mx-4 modal-elevated modal-content-enter"
            style={{
              backgroundColor: 'var(--bg-elevated)',
              borderRadius: 'var(--radius-md)',
            }}
          >
            <div className="flex items-center gap-3 mb-4">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center"
                style={{ backgroundColor: 'var(--accent-subtle)' }}
              >
                <Lock
                  className="w-5 h-5"
                  style={{ color: 'var(--accent-primary)' }}
                />
              </div>
              <div>
                <h3
                  className="text-lg font-semibold"
                  style={{ color: 'var(--text-primary)' }}
                >
                  Import Encrypted Backup
                </h3>
                <p
                  className="text-xs"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  Enter the password to decrypt
                </p>
              </div>
            </div>
            <div className="space-y-3 mb-4">
              <div>
                <label
                  className="text-xs mb-1.5 block"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  Password
                </label>
                <div className="relative">
                  <input
                    type={showImportPw ? 'text' : 'password'}
                    value={importPw}
                    onChange={(e) => setImportPw(e.target.value)}
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
                    onClick={() => setShowImportPw(!showImportPw)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1"
                    style={{ color: 'var(--text-muted)' }}
                    aria-label={showImportPw ? 'Hide password' : 'Show password'}
                  >
                    {showImportPw ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>
              <div
                className="flex items-center gap-2 pt-2"
                style={{ borderTop: '1px solid var(--border-muted)' }}
              >
                <label
                  className="flex items-center gap-2 text-sm cursor-pointer"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  <input
                    type="checkbox"
                    checked={importMerge}
                    onChange={(e) => setImportMerge(e.target.checked)}
                  />
                  Merge with existing notes (unchecked = replace all)
                </label>
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowEncryptedImport(false);
                  setPendingBackupPath(null);
                  setImportPw('');
                }}
                className="px-3 py-1.5 text-sm font-medium transition-colors"
                style={{
                  backgroundColor: 'var(--bg-panel)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-secondary)',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleEncryptedImport}
                disabled={importPw.length === 0}
                className="px-3 py-1.5 text-sm font-medium text-white transition-colors disabled:opacity-50"
                style={{
                  backgroundColor: 'var(--accent-primary)',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                Import
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
