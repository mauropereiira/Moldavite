/**
 * Settings Modal Component
 *
 * A tabbed settings interface for Moldavite configuration.
 *
 * ## Sections
 *
 * - **General**: Notes directory, import/export, encrypted backups, auto-lock, clear data
 * - **Appearance**: Theme selection, font family, font size, line height, compact mode
 * - **Editor**: Default note type, auto-save delay
 * - **Calendar**: Calendar permissions, calendar selection, onboarding
 * - **Templates**: Template management (uses SettingsTemplates component)
 * - **About**: Version info, links, credits
 *
 * ## Architecture
 *
 * The modal uses internal function components for each section:
 * - `GeneralSettings` - Notes directory and backup operations
 * - `AppearanceSettings` - Theme and display settings
 * - `EditorSettings` - Editor behavior settings
 * - `CalendarSettings` - Calendar integration
 * - `AboutSection` - App information
 *
 * ## Future Improvements
 *
 * These sections can be extracted to separate files in `./sections/` for better
 * maintainability. The current internal organization provides a foundation for
 * incremental migration.
 *
 * @module components/settings/SettingsModal
 */

import { useState, useEffect } from 'react';
import { useSettingsStore, useThemeStore, applyTheme, useNoteStore, applyFontFamily } from '@/stores';
import type { FontFamily } from '@/stores';
import { useCalendarStore } from '@/stores/calendarStore';
import { clearAllNotes, getNotesDirectory, setNotesDirectory, exportNotes, importNotes, exportEncryptedBackup, importEncryptedBackup } from '@/lib';
import type { ImportResult } from '@/lib';
import { Calendar, Check, Lock, FolderOpen, Download, Upload, Settings, Palette, Type, FileText, Info, ExternalLink, RefreshCw, Shield, Eye, EyeOff, Timer, Zap, PanelLeft } from 'lucide-react';
import type { AutoLockTimeout } from '@/stores';
import { SettingsTemplates } from '@/components/templates/SettingsTemplates';
import { useTemplates } from '@/hooks/useTemplates';
import { open, save } from '@tauri-apps/plugin-dialog';
import { getVersion } from '@tauri-apps/api/app';
import { open as shellOpen } from '@tauri-apps/plugin-shell';

// =============================================================================
// INFO TOOLTIP COMPONENT
// =============================================================================

function InfoTooltip({ text }: { text: string }) {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <div className="relative inline-flex items-center ml-1.5">
      <button
        type="button"
        className="p-0.5 rounded-full transition-all duration-200"
        style={{
          color: 'var(--text-muted)',
          backgroundColor: 'transparent',
        }}
        onMouseEnter={(e) => {
          setIsVisible(true);
          e.currentTarget.style.color = 'var(--accent-primary)';
          e.currentTarget.style.backgroundColor = 'var(--accent-subtle)';
          e.currentTarget.style.transform = 'scale(1.1)';
        }}
        onMouseLeave={(e) => {
          setIsVisible(false);
          e.currentTarget.style.color = 'var(--text-muted)';
          e.currentTarget.style.backgroundColor = 'transparent';
          e.currentTarget.style.transform = 'scale(1)';
        }}
        onFocus={() => setIsVisible(true)}
        onBlur={() => setIsVisible(false)}
        aria-label="More information"
      >
        <Info className="w-3.5 h-3.5" />
      </button>
      {isVisible && (
        <div
          className="absolute z-50 px-3 py-2 text-xs max-w-[320px] whitespace-normal"
          style={{
            top: 'calc(100% + 8px)',
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-lg)',
            color: 'var(--text-secondary)',
            animation: 'tooltipFadeInBelow 0.15s ease-out',
          }}
        >
          {text}
          <div
            className="absolute w-2 h-2"
            style={{
              top: '-5px',
              left: '50%',
              transform: 'translateX(-50%) rotate(45deg)',
              backgroundColor: 'var(--bg-elevated)',
              borderLeft: '1px solid var(--border-default)',
              borderTop: '1px solid var(--border-default)',
            }}
          />
        </div>
      )}
    </div>
  );
}

// =============================================================================
// TYPES
// =============================================================================

/** Available settings tabs */
type SettingsTab = 'general' | 'appearance' | 'editor' | 'features' | 'sidebar' | 'calendar' | 'templates' | 'about';

export function SettingsModal() {
  const settingsStore = useSettingsStore();
  const { theme, setTheme } = useThemeStore();
  const { deleteExistingTemplate, updateExistingTemplate } = useTemplates();
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');

  // Template handlers for SettingsTemplates
  const handleDeleteTemplate = async (id: string) => {
    await deleteExistingTemplate(id);
  };

  const handleUpdateTemplate = async (
    id: string,
    name: string,
    description: string,
    icon: string,
    content: string
  ) => {
    await updateExistingTemplate(id, { name, description, icon, content });
  };

  // Handle ESC key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        settingsStore.setIsSettingsOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [settingsStore]);

  if (!settingsStore.isSettingsOpen) return null;

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      settingsStore.setIsSettingsOpen(false);
    }
  };

  const handleThemeChange = (newTheme: 'light' | 'dark' | 'system') => {
    setTheme(newTheme);
    applyTheme(newTheme);
  };

  const tabs: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
    { id: 'general', label: 'General', icon: <Settings className="w-4 h-4" /> },
    { id: 'appearance', label: 'Appearance', icon: <Palette className="w-4 h-4" /> },
    { id: 'editor', label: 'Editor', icon: <Type className="w-4 h-4" /> },
    { id: 'features', label: 'Features', icon: <Zap className="w-4 h-4" /> },
    { id: 'sidebar', label: 'Sidebar', icon: <PanelLeft className="w-4 h-4" /> },
    { id: 'calendar', label: 'Calendar', icon: <Calendar className="w-4 h-4" /> },
    { id: 'templates', label: 'Templates', icon: <FileText className="w-4 h-4" /> },
    { id: 'about', label: 'About', icon: <Info className="w-4 h-4" /> },
  ];

  return (
    <div
      className="fixed inset-0 modal-backdrop-dark flex items-center justify-center z-50 modal-backdrop-enter"
      onClick={handleBackdropClick}
    >
      <div
        className="w-full max-w-3xl mx-4 max-h-[85vh] flex flex-col modal-elevated modal-content-enter"
        style={{ borderRadius: 'var(--radius-md)' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4"
          style={{ borderBottom: '1px solid var(--border-default)' }}
        >
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            Settings
          </h2>
          <button
            onClick={() => settingsStore.setIsSettingsOpen(false)}
            className="p-1 transition-colors"
            style={{ color: 'var(--text-muted)', borderRadius: 'var(--radius-sm)' }}
            onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
            onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div
          className="flex px-6 overflow-x-auto flex-shrink-0"
          style={{ borderBottom: '1px solid var(--border-default)', minHeight: '48px' }}
        >
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="flex items-center gap-2 px-4 py-3 text-sm font-medium transition-all mx-0.5 focus-ring whitespace-nowrap"
              style={{
                borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0',
                color: activeTab === tab.id ? 'var(--accent-primary)' : 'var(--text-secondary)',
                backgroundColor: activeTab === tab.id ? 'var(--accent-subtle)' : 'transparent',
                borderBottom: activeTab === tab.id ? '2px solid var(--accent-primary)' : '2px solid transparent',
              }}
              onMouseEnter={(e) => {
                if (activeTab !== tab.id) {
                  e.currentTarget.style.color = 'var(--text-primary)';
                  e.currentTarget.style.backgroundColor = 'var(--bg-inset)';
                }
              }}
              onMouseLeave={(e) => {
                if (activeTab !== tab.id) {
                  e.currentTarget.style.color = 'var(--text-secondary)';
                  e.currentTarget.style.backgroundColor = 'transparent';
                }
              }}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div key={activeTab} className="tab-content-enter">
            {activeTab === 'general' && (
              <GeneralSettings />
            )}
            {activeTab === 'appearance' && (
              <AppearanceSettings
                theme={theme}
                onThemeChange={handleThemeChange}
              />
            )}
            {activeTab === 'editor' && (
              <EditorSettings />
            )}
            {activeTab === 'features' && (
              <FeaturesSettings />
            )}
            {activeTab === 'sidebar' && (
              <SidebarSettings />
            )}
            {activeTab === 'calendar' && (
              <CalendarSettings />
            )}
            {activeTab === 'templates' && (
              <SettingsTemplates
                onDeleteTemplate={handleDeleteTemplate}
                onUpdateTemplate={handleUpdateTemplate}
              />
            )}
            {activeTab === 'about' && (
              <AboutSection />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// General Settings Section
function GeneralSettings() {
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
              Display "Saving..." when auto-saving
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

// Appearance Settings Section
function AppearanceSettings({
  theme,
  onThemeChange,
}: {
  theme: 'light' | 'dark' | 'system';
  onThemeChange: (theme: 'light' | 'dark' | 'system') => void;
}) {
  const settings = useSettingsStore();
  return (
    <div className="space-y-6">
      {/* Theme Section */}
      <div className="p-4 space-y-4" style={{ backgroundColor: 'var(--bg-panel)', borderRadius: 'var(--radius-md)' }}>
        <div>
          <div className="flex items-center gap-1">
            <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              Theme
            </h3>
            <InfoTooltip text="Light for daytime, Dark for nighttime. System follows your macOS appearance setting." />
          </div>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            Choose your preferred color scheme
          </p>
        </div>
        <div className="flex gap-2">
          {(['light', 'dark', 'system'] as const).map((t) => (
            <button
              key={t}
              onClick={() => onThemeChange(t)}
              className="px-3 py-1.5 text-sm font-medium transition-colors"
              style={{
                backgroundColor: theme === t ? 'var(--accent-primary)' : 'var(--bg-elevated)',
                color: theme === t ? 'white' : 'var(--text-secondary)',
                border: theme === t ? 'none' : '1px solid var(--border-default)',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Typography Section */}
      <div className="p-4 space-y-4" style={{ backgroundColor: 'var(--bg-panel)', borderRadius: 'var(--radius-md)' }}>
        <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          Typography
        </h3>

        <div>
          <label className="text-xs mb-2 block" style={{ color: 'var(--text-tertiary)' }}>
            Font Size
          </label>
          <div className="flex gap-2">
            {([
              { value: 'small', label: 'S' },
              { value: 'medium', label: 'M' },
              { value: 'large', label: 'L' },
              { value: 'extra-large', label: 'XL' },
            ] as const).map((size) => (
              <button
                key={size.value}
                onClick={() => settings.setFontSize(size.value)}
                className="px-3 py-1.5 text-sm font-medium transition-colors"
                style={{
                  backgroundColor: settings.fontSize === size.value ? 'var(--accent-primary)' : 'var(--bg-elevated)',
                  color: settings.fontSize === size.value ? 'white' : 'var(--text-secondary)',
                  border: settings.fontSize === size.value ? 'none' : '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                {size.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-xs mb-2 block" style={{ color: 'var(--text-tertiary)' }}>
            Font Family
          </label>
          <select
            value={settings.fontFamily}
            onChange={(e) => {
              const family = e.target.value as FontFamily;
              settings.setFontFamily(family);
              applyFontFamily(family);
            }}
            className="w-full px-3 py-2 text-sm focus:outline-none focus:ring-2"
            style={{
              backgroundColor: 'var(--bg-elevated)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-primary)',
            }}
          >
            <optgroup label="System Fonts">
              <option value="system-sans">Sans-serif (System)</option>
              <option value="system-serif">Serif (System)</option>
              <option value="system-mono">Monospace (System)</option>
            </optgroup>
            <optgroup label="Web Fonts">
              <option value="inter">Inter</option>
              <option value="merriweather">Merriweather</option>
            </optgroup>
          </select>
        </div>
      </div>

      {/* Layout Section */}
      <div className="p-4 space-y-4" style={{ backgroundColor: 'var(--bg-panel)', borderRadius: 'var(--radius-md)' }}>
        <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          Layout
        </h3>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Sidebar Width
            </label>
            <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
              {settings.sidebarWidth}px
            </span>
          </div>
          <input
            type="range"
            min="200"
            max="400"
            step="10"
            value={settings.sidebarWidth}
            onChange={(e) => settings.setSidebarWidth(Number(e.target.value))}
            className="w-full h-2 rounded appearance-none cursor-pointer"
            style={{ backgroundColor: 'var(--bg-inset)', accentColor: 'var(--accent-primary)' }}
          />
          <div className="flex justify-between text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            <span>Narrow</span>
            <span>Wide</span>
          </div>
        </div>

        <div className="flex items-center justify-between pt-2" style={{ borderTop: '1px solid var(--border-muted)' }}>
          <div>
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Compact Mode
            </span>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Tighter spacing throughout the app
            </p>
          </div>
          <Toggle
            enabled={settings.compactMode}
            onChange={settings.setCompactMode}
          />
        </div>
      </div>
    </div>
  );
}

// Editor Settings Section
function EditorSettings() {
  const settings = useSettingsStore();
  return (
    <div className="space-y-6">
      {/* Note Defaults Section */}
      <div className="p-4 space-y-4" style={{ backgroundColor: 'var(--bg-panel)', borderRadius: 'var(--radius-md)' }}>
        <div>
          <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            Default Note Type
          </h3>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            What type of note to create by default
          </p>
        </div>
        <div className="flex gap-2">
          {(['daily', 'standalone'] as const).map((type) => (
            <button
              key={type}
              onClick={() => settings.setDefaultNoteType(type)}
              className="px-3 py-1.5 text-sm font-medium transition-colors"
              style={{
                backgroundColor: settings.defaultNoteType === type ? 'var(--accent-primary)' : 'var(--bg-elevated)',
                color: settings.defaultNoteType === type ? 'white' : 'var(--text-secondary)',
                border: settings.defaultNoteType === type ? 'none' : '1px solid var(--border-default)',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              {type.charAt(0).toUpperCase() + type.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Formatting Section */}
      <div className="p-4 space-y-4" style={{ backgroundColor: 'var(--bg-panel)', borderRadius: 'var(--radius-md)' }}>
        <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          Formatting
        </h3>

        <div>
          <label className="text-xs mb-2 block" style={{ color: 'var(--text-tertiary)' }}>
            Line Height
          </label>
          <div className="flex gap-2">
            {(['comfortable', 'compact'] as const).map((height) => (
              <button
                key={height}
                onClick={() => settings.setLineHeight(height)}
                className="px-3 py-1.5 text-sm font-medium transition-colors"
                style={{
                  backgroundColor: settings.lineHeight === height ? 'var(--accent-primary)' : 'var(--bg-elevated)',
                  color: settings.lineHeight === height ? 'white' : 'var(--text-secondary)',
                  border: settings.lineHeight === height ? 'none' : '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                {height.charAt(0).toUpperCase() + height.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Writing Assistance Section */}
      <div className="p-4 space-y-1" style={{ backgroundColor: 'var(--bg-panel)', borderRadius: 'var(--radius-md)' }}>
        <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>
          Writing Assistance
        </h3>

        <div className="flex items-center justify-between py-2">
          <div>
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Spell Check
            </span>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Underline spelling errors
            </p>
          </div>
          <Toggle
            enabled={settings.spellCheck}
            onChange={settings.setSpellCheck}
          />
        </div>

        <div className="flex items-center justify-between py-2" style={{ borderTop: '1px solid var(--border-muted)' }}>
          <div>
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Auto-capitalize
            </span>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Capitalize first letter of sentences
            </p>
          </div>
          <Toggle
            enabled={settings.autoCapitalize}
            onChange={settings.setAutoCapitalize}
          />
        </div>

        <div className="flex items-center justify-between py-2" style={{ borderTop: '1px solid var(--border-muted)' }}>
          <div>
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Show Word Count
            </span>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Display word count at bottom of editor
            </p>
          </div>
          <Toggle
            enabled={settings.showWordCount}
            onChange={settings.setShowWordCount}
          />
        </div>

        <div className="flex items-center justify-between py-2" style={{ borderTop: '1px solid var(--border-muted)' }}>
          <div>
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Tags (#hashtags)
            </span>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Highlight #tags and show in sidebar
            </p>
          </div>
          <Toggle
            enabled={settings.tagsEnabled}
            onChange={settings.setTagsEnabled}
          />
        </div>
      </div>
    </div>
  );
}

// Features Settings Section
function FeaturesSettings() {
  const settings = useSettingsStore();
  return (
    <div className="space-y-6">
      {/* Editor Features */}
      <div className="p-4 space-y-1" style={{ backgroundColor: 'var(--bg-panel)', borderRadius: 'var(--radius-md)' }}>
        <div className="flex items-center gap-1 mb-3">
          <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            Editor Features
          </h3>
          <InfoTooltip text="Enable or disable special editing features. Disabling features you don't use can simplify the interface." />
        </div>

        <div className="flex items-center justify-between py-2">
          <div className="flex items-center gap-1">
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Slash Commands
            </span>
            <InfoTooltip text="Type '/' at the start of a line to see a menu of blocks: headings, lists, quotes, code blocks, and more." />
          </div>
          <Toggle
            enabled={settings.slashCommandsEnabled}
            onChange={settings.setSlashCommandsEnabled}
          />
        </div>

        <div className="flex items-center justify-between py-2" style={{ borderTop: '1px solid var(--border-muted)' }}>
          <div className="flex items-center gap-1">
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Wiki Links [[...]]
            </span>
            <InfoTooltip text="Create links between notes using [[Note Name]] syntax. Clicking the link opens the referenced note." />
          </div>
          <Toggle
            enabled={settings.wikiLinksEnabled}
            onChange={settings.setWikiLinksEnabled}
          />
        </div>

        <div className="flex items-center justify-between py-2" style={{ borderTop: '1px solid var(--border-muted)' }}>
          <div className="flex items-center gap-1">
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Tags (#hashtags)
            </span>
            <InfoTooltip text="Type #tagname to create tags. Tags are highlighted and can be filtered in the sidebar." />
          </div>
          <Toggle
            enabled={settings.tagsEnabled}
            onChange={settings.setTagsEnabled}
          />
        </div>
      </div>

      {/* Navigation Features */}
      <div className="p-4 space-y-1" style={{ backgroundColor: 'var(--bg-panel)', borderRadius: 'var(--radius-md)' }}>
        <div className="flex items-center gap-1 mb-3">
          <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            Navigation
          </h3>
          <InfoTooltip text="Ways to quickly find and navigate between your notes." />
        </div>

        <div className="flex items-center justify-between py-2">
          <div className="flex items-center gap-1">
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Quick Switcher (⌘P)
            </span>
            <InfoTooltip text="Press ⌘P to open a search dialog. Type to fuzzy-search all notes and quickly jump to any note." />
          </div>
          <Toggle
            enabled={settings.quickSwitcherEnabled}
            onChange={settings.setQuickSwitcherEnabled}
          />
        </div>

        <div className="flex items-center justify-between py-2" style={{ borderTop: '1px solid var(--border-muted)' }}>
          <div className="flex items-center gap-1">
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Backlinks
            </span>
            <InfoTooltip text="Shows a list of all notes that link to the current note. Helps you see connections between ideas." />
          </div>
          <Toggle
            enabled={settings.backlinksEnabled}
            onChange={settings.setBacklinksEnabled}
          />
        </div>
      </div>

      {/* Right Panel */}
      <div className="p-4 space-y-1" style={{ backgroundColor: 'var(--bg-panel)', borderRadius: 'var(--radius-md)' }}>
        <div className="flex items-center gap-1 mb-3">
          <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            Right Panel
          </h3>
          <InfoTooltip text="The right sidebar contains the calendar and timeline. Hide it for a more focused writing experience." />
        </div>

        <div className="flex items-center justify-between py-2">
          <div className="flex items-center gap-1">
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Show Right Panel
            </span>
            <InfoTooltip text="Toggle the entire right sidebar on or off. Hiding it gives more space to the editor." />
          </div>
          <Toggle
            enabled={settings.showRightPanel}
            onChange={settings.setShowRightPanel}
          />
        </div>

        {settings.showRightPanel && (
          <>
            <div className="flex items-center justify-between py-2" style={{ borderTop: '1px solid var(--border-muted)' }}>
              <div className="flex items-center gap-1">
                <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  Calendar Widget
                </span>
                <InfoTooltip text="A mini calendar showing the current month. Click dates to navigate to daily notes." />
              </div>
              <Toggle
                enabled={settings.showCalendarWidget}
                onChange={settings.setShowCalendarWidget}
              />
            </div>

            <div className="flex items-center justify-between py-2" style={{ borderTop: '1px solid var(--border-muted)' }}>
              <div className="flex items-center gap-1">
                <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  Timeline Widget
                </span>
                <InfoTooltip text="Shows your daily schedule with events from Apple Calendar (requires Calendar access)." />
              </div>
              <Toggle
                enabled={settings.showTimelineWidget}
                onChange={settings.setShowTimelineWidget}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Sidebar Settings Section
function SidebarSettings() {
  const settings = useSettingsStore();
  return (
    <div className="space-y-6">
      {/* Visible Sections */}
      <div className="p-4 space-y-1" style={{ backgroundColor: 'var(--bg-panel)', borderRadius: 'var(--radius-md)' }}>
        <div className="flex items-center gap-1 mb-3">
          <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            Visible Sections
          </h3>
          <InfoTooltip text="Choose which sections appear in the left sidebar. Hide sections you don't use." />
        </div>

        <div className="flex items-center justify-between py-2">
          <div className="flex items-center gap-1">
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Folders Section
            </span>
            <InfoTooltip text="Browse notes organized by folders. Useful if you organize notes into different directories." />
          </div>
          <Toggle
            enabled={settings.showFoldersSection}
            onChange={settings.setShowFoldersSection}
          />
        </div>

        <div className="flex items-center justify-between py-2" style={{ borderTop: '1px solid var(--border-muted)' }}>
          <div className="flex items-center gap-1">
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Backlinks Section
            </span>
            <InfoTooltip text="Show backlinks in the sidebar. Requires Backlinks to be enabled in Features." />
          </div>
          <Toggle
            enabled={settings.showBacklinksSection}
            onChange={settings.setShowBacklinksSection}
          />
        </div>
      </div>

      {/* Sorting */}
      <div className="p-4 space-y-4" style={{ backgroundColor: 'var(--bg-panel)', borderRadius: 'var(--radius-md)' }}>
        <div>
          <div className="flex items-center gap-1">
            <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              Sort Notes By
            </h3>
            <InfoTooltip text="Choose how notes are ordered in the sidebar list. Modified sorts by last edit time." />
          </div>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            How notes are ordered in the sidebar
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {([
            { value: 'name-asc', label: 'Name (A-Z)' },
            { value: 'name-desc', label: 'Name (Z-A)' },
            { value: 'modified-desc', label: 'Modified (Newest)' },
            { value: 'modified-asc', label: 'Modified (Oldest)' },
            { value: 'created-desc', label: 'Created (Newest)' },
            { value: 'created-asc', label: 'Created (Oldest)' },
          ] as const).map((option) => (
            <button
              key={option.value}
              onClick={() => settings.setSortOption(option.value)}
              className="px-3 py-2 text-sm font-medium transition-colors text-left"
              style={{
                backgroundColor: settings.sortOption === option.value ? 'var(--accent-primary)' : 'var(--bg-elevated)',
                color: settings.sortOption === option.value ? 'white' : 'var(--text-secondary)',
                border: settings.sortOption === option.value ? 'none' : '1px solid var(--border-default)',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* Layout */}
      <div className="p-4 space-y-4" style={{ backgroundColor: 'var(--bg-panel)', borderRadius: 'var(--radius-md)' }}>
        <div className="flex items-center gap-1">
          <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            Layout
          </h3>
          <InfoTooltip text="Control the width of sidebars. Wider sidebars show more note titles, narrower gives more editor space." />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1">
              <label className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                Sidebar Width
              </label>
              <InfoTooltip text="Width of the left sidebar in pixels. Range: 200px (compact) to 400px (spacious)." />
            </div>
            <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
              {settings.sidebarWidth}px
            </span>
          </div>
          <input
            type="range"
            min="200"
            max="400"
            step="10"
            value={settings.sidebarWidth}
            onChange={(e) => settings.setSidebarWidth(Number(e.target.value))}
            className="w-full h-2 rounded appearance-none cursor-pointer"
            style={{ backgroundColor: 'var(--bg-inset)', accentColor: 'var(--accent-primary)' }}
          />
        </div>

        {settings.showRightPanel && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1">
                <label className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  Right Panel Width
                </label>
                <InfoTooltip text="Width of the right panel (calendar/timeline) in pixels. Range: 250px to 500px." />
              </div>
              <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                {settings.rightPanelWidth}px
              </span>
            </div>
            <input
              type="range"
              min="250"
              max="500"
              step="10"
              value={settings.rightPanelWidth}
              onChange={(e) => settings.setRightPanelWidth(Number(e.target.value))}
              className="w-full h-2 rounded appearance-none cursor-pointer"
              style={{ backgroundColor: 'var(--bg-inset)', accentColor: 'var(--accent-primary)' }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// Calendar Settings Section
function CalendarSettings() {
  const {
    isAuthorized,
    isRequestingPermission,
    permissionStatus,
    calendars,
    selectedCalendarId,
    calendarEnabled,
    showAllDayEvents,
    requestPermission,
    fetchCalendars,
    setSelectedCalendarId,
    setCalendarEnabled,
    setShowAllDayEvents,
    checkPermission,
  } = useCalendarStore();

  const handleRequestPermission = async () => {
    await requestPermission();
  };

  // Check permission and fetch calendars on mount
  useEffect(() => {
    checkPermission();
  }, [checkPermission]);

  // Fetch calendars when authorized
  useEffect(() => {
    if (isAuthorized && calendars.length === 0) {
      fetchCalendars();
    }
  }, [isAuthorized, calendars.length, fetchCalendars]);

  return (
    <div className="space-y-6">
      {/* Permission Status Section */}
      <div className="p-4 space-y-4" style={{ backgroundColor: 'var(--bg-panel)', borderRadius: 'var(--radius-md)' }}>
        <div>
          <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            Calendar Access
          </h3>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            Display events from Calendar.app in your timeline
          </p>
        </div>

        {isAuthorized ? (
          <div className="flex items-center gap-3 p-3" style={{ backgroundColor: 'rgba(90, 138, 110, 0.15)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--success)' }}>
            <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'rgba(90, 138, 110, 0.2)' }}>
              <Check className="w-4 h-4" style={{ color: 'var(--success)' }} />
            </div>
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--success)' }}>
                Calendar Access Enabled
              </p>
              <p className="text-xs" style={{ color: 'var(--success)', opacity: 0.8 }}>
                Connected to Calendar.app
              </p>
            </div>
          </div>
        ) : permissionStatus === 'Denied' || permissionStatus === 'Restricted' ? (
          <div className="p-3" style={{ backgroundColor: 'rgba(184, 92, 92, 0.15)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--error)' }}>
            <div className="flex items-center gap-2 mb-2">
              <Lock className="w-4 h-4" style={{ color: 'var(--error)' }} />
              <p className="text-sm font-medium" style={{ color: 'var(--error)' }}>
                Access Denied
              </p>
            </div>
            <p className="text-xs mb-2" style={{ color: 'var(--error)', opacity: 0.9 }}>
              Calendar access was denied. To enable:
            </p>
            <ol className="text-xs list-decimal list-inside space-y-1" style={{ color: 'var(--error)', opacity: 0.9 }}>
              <li>Open System Settings</li>
              <li>Go to Privacy & Security → Calendars</li>
              <li>Enable access for Moldavite</li>
            </ol>
          </div>
        ) : (
          <button
            onClick={handleRequestPermission}
            disabled={isRequestingPermission}
            className="w-full flex items-center justify-center gap-2 px-3 py-1.5 text-sm font-medium text-white transition-colors disabled:opacity-50"
            style={{ backgroundColor: 'var(--accent-primary)', borderRadius: 'var(--radius-sm)' }}
          >
            {isRequestingPermission ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Requesting...
              </>
            ) : (
              <>
                <Calendar className="w-4 h-4" />
                Enable Calendar Access
              </>
            )}
          </button>
        )}
      </div>

      {/* Calendar Settings (only show when authorized) */}
      {isAuthorized && (
        <>
          {/* Display Options Section */}
          <div className="p-4 space-y-1" style={{ backgroundColor: 'var(--bg-panel)', borderRadius: 'var(--radius-md)' }}>
            <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>
              Display Options
            </h3>

            <div className="flex items-center justify-between py-2">
              <div>
                <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  Show Calendar Events
                </span>
                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  Display events in the timeline
                </p>
              </div>
              <Toggle
                enabled={calendarEnabled}
                onChange={setCalendarEnabled}
              />
            </div>

            <div className="flex items-center justify-between py-2" style={{ borderTop: '1px solid var(--border-muted)' }}>
              <div>
                <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  Show All-Day Events
                </span>
                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  Include events without specific times
                </p>
              </div>
              <Toggle
                enabled={showAllDayEvents}
                onChange={setShowAllDayEvents}
              />
            </div>
          </div>

          {/* Calendar Selection */}
          {calendars.length > 0 && (
            <div className="p-4 space-y-4" style={{ backgroundColor: 'var(--bg-panel)', borderRadius: 'var(--radius-md)' }}>
              <div>
                <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                  Calendar Source
                </h3>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                  Choose which calendar to display
                </p>
              </div>
              <select
                value={selectedCalendarId || ''}
                onChange={(e) => setSelectedCalendarId(e.target.value || null)}
                className="w-full px-3 py-2 text-sm focus:outline-none focus:ring-2"
                style={{
                  backgroundColor: 'var(--bg-elevated)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-primary)',
                }}
              >
                <option value="">All Calendars</option>
                {calendars.map((cal) => (
                  <option key={cal.id} value={cal.id}>
                    {cal.title}
                  </option>
                ))}
              </select>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// About Section
function AboutSection() {
  const [appVersion, setAppVersion] = useState<string>('');

  // Fetch app version on mount
  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => setAppVersion('0.0.0'));
  }, []);

  return (
    <div className="space-y-6">
      {/* App Info + Update Section */}
      <div className="flex items-start gap-4 p-4" style={{ backgroundColor: 'var(--bg-panel)', borderRadius: 'var(--radius-md)' }}>
        {/* Logo */}
        <img
          src="/logo.png"
          alt="Moldavite Logo"
          className="h-16 w-16 flex-shrink-0"
          style={{ backgroundColor: 'transparent', borderRadius: 'var(--radius-md)' }}
        />

        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
            Moldavite
          </h3>
          <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
            Version {appVersion || '...'}
          </p>
        </div>
      </div>

      {/* Update Status */}
      <div className="p-4" style={{ backgroundColor: 'var(--bg-panel)', borderRadius: 'var(--radius-md)' }}>
        <h4 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>
          Software Updates
        </h4>

        <div className="space-y-3">
          <div className="flex items-center gap-2 p-3" style={{ backgroundColor: 'var(--bg-elevated)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)' }}>
            <Download className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--text-tertiary)' }} />
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                Check for Updates
              </p>
              <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                Download the latest version from GitHub
              </p>
            </div>
          </div>

          <button
            onClick={() => shellOpen('https://github.com/mauropereira/moldavite/releases')}
            className="w-full flex items-center justify-center gap-2 px-3 py-1.5 text-sm font-medium transition-colors"
            style={{ backgroundColor: 'var(--bg-elevated)', borderRadius: 'var(--radius-sm)', color: 'var(--text-secondary)' }}
          >
            <ExternalLink className="w-4 h-4" />
            View Releases on GitHub
          </button>
        </div>
      </div>

      {/* Keyboard Shortcuts */}
      <div className="p-4" style={{ backgroundColor: 'var(--bg-panel)', borderRadius: 'var(--radius-md)' }}>
        <h4 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>
          Keyboard Shortcuts
        </h4>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <ShortcutRow keys={['⌘', ',']} description="Settings" />
          <ShortcutRow keys={['⌘', 'T']} description="Template" />
          <ShortcutRow keys={['⌘', 'B']} description="Bold" />
          <ShortcutRow keys={['⌘', 'I']} description="Italic" />
          <ShortcutRow keys={['⌘', 'U']} description="Underline" />
          <ShortcutRow keys={['⌘', 'K']} description="Link" />
          <ShortcutRow keys={['⌘', 'Z']} description="Undo" />
          <ShortcutRow keys={['⌘', '⇧', 'Z']} description="Redo" />
        </div>
      </div>

    </div>
  );
}

// Toggle Component - Modern pill style
function Toggle({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!enabled)}
      className="relative inline-flex h-6 w-10 items-center transition-all"
      style={{
        borderRadius: '12px',
        backgroundColor: enabled ? 'var(--accent-primary)' : 'var(--bg-inset)',
        border: `1px solid ${enabled ? 'var(--accent-primary)' : 'var(--border-default)'}`,
      }}
    >
      <span
        className="inline-block h-4 w-4 transform transition-all"
        style={{
          borderRadius: '8px',
          backgroundColor: 'white',
          boxShadow: 'var(--shadow-sm)',
          transform: enabled ? 'translateX(18px)' : 'translateX(3px)',
        }}
      />
    </button>
  );
}

// Shortcut Row Component
function ShortcutRow({ keys, description }: { keys: string[]; description: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{description}</span>
      <div className="flex gap-1">
        {keys.map((key, i) => (
          <kbd
            key={i}
            className="px-2 py-0.5 text-xs font-mono"
            style={{
              backgroundColor: 'var(--bg-inset)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-primary)',
            }}
          >
            {key}
          </kbd>
        ))}
      </div>
    </div>
  );
}
