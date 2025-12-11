import { useState, useEffect } from 'react';
import { useSettingsStore, useThemeStore, applyTheme, useNoteStore, applyFontFamily, useUpdateStore } from '@/stores';
import type { FontFamily } from '@/stores';
import { useCalendarStore } from '@/stores/calendarStore';
import { clearAllNotes, getNotesDirectory, setNotesDirectory, exportNotes, importNotes } from '@/lib';
import type { ImportResult } from '@/lib';
import { Calendar, RefreshCw, Check, Lock, FolderOpen, Download, Upload, Settings, Palette, Type, FileText, Info, CheckCircle, AlertCircle } from 'lucide-react';
import { SettingsTemplates } from '@/components/templates/SettingsTemplates';
import { useTemplates } from '@/hooks/useTemplates';
import { open, save } from '@tauri-apps/plugin-dialog';
import { getVersion } from '@tauri-apps/api/app';

type SettingsTab = 'general' | 'appearance' | 'editor' | 'calendar' | 'templates' | 'about';

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
    { id: 'calendar', label: 'Calendar', icon: <Calendar className="w-4 h-4" /> },
    { id: 'templates', label: 'Templates', icon: <FileText className="w-4 h-4" /> },
    { id: 'about', label: 'About', icon: <Info className="w-4 h-4" /> },
  ];

  return (
    <div
      className="fixed inset-0 modal-backdrop-dark flex items-center justify-center z-50 modal-backdrop-enter"
      onClick={handleBackdropClick}
    >
      <div className="bg-white dark:bg-gray-800 rounded-md w-full max-w-3xl mx-4 max-h-[85vh] flex flex-col modal-elevated modal-content-enter">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            Settings
          </h2>
          <button
            onClick={() => settingsStore.setIsSettingsOpen(false)}
            className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 dark:border-gray-700 px-6 overflow-x-auto">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-all rounded-t mx-0.5 focus-ring whitespace-nowrap ${
                activeTab === tab.id
                  ? 'settings-tab settings-tab-active text-blue-600 dark:text-blue-400'
                  : 'settings-tab text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
              }`}
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
        defaultPath: `notomattic-export-${date}.zip`,
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
      <div className="p-4 bg-gray-50 dark:bg-gray-900/50 rounded-md space-y-4">
        <h3 className="text-sm font-medium text-gray-900 dark:text-white">
          Storage
        </h3>

        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 mb-1.5 block">
            Notes Directory
          </label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={notesDirectory}
              readOnly
              className="flex-1 px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded text-gray-600 dark:text-gray-400"
            />
            <button
              onClick={handleChangeDirectory}
              disabled={isChangingDir}
              className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors disabled:opacity-50"
            >
              <FolderOpen className="w-4 h-4" />
              {isChangingDir ? 'Moving...' : 'Change'}
            </button>
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1.5">
            Existing notes will be moved to the new location
          </p>
        </div>
      </div>

      {/* Backup & Restore Section */}
      <div className="p-4 bg-gray-50 dark:bg-gray-900/50 rounded-md space-y-4">
        <div>
          <h3 className="text-sm font-medium text-gray-900 dark:text-white">
            Backup & Restore
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Export or import your notes and templates
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleExport}
            disabled={isExporting}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            {isExporting ? 'Exporting...' : 'Export'}
          </button>
          <button
            onClick={handleImportSelect}
            disabled={isImporting}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors disabled:opacity-50"
          >
            <Upload className="w-4 h-4" />
            {isImporting ? 'Importing...' : 'Import'}
          </button>
        </div>
      </div>

      {/* Auto-save Section */}
      <div className="p-4 bg-gray-50 dark:bg-gray-900/50 rounded-md space-y-4">
        <h3 className="text-sm font-medium text-gray-900 dark:text-white">
          Auto-save
        </h3>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs text-gray-500 dark:text-gray-400">
              Save delay
            </label>
            <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
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
            className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded appearance-none cursor-pointer accent-blue-600"
          />
          <div className="flex justify-between text-xs text-gray-400 dark:text-gray-500 mt-1">
            <span>Fast</span>
            <span>Slow</span>
          </div>
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-gray-200 dark:border-gray-800">
          <div>
            <span className="text-sm text-gray-700 dark:text-gray-200">
              Show save indicator
            </span>
            <p className="text-xs text-gray-500 dark:text-gray-400">
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
      <div className="p-4 rounded-md border-2 border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30">
        <h3 className="text-sm font-medium text-red-800 dark:text-red-400 mb-1">
          Danger Zone
        </h3>
        <p className="text-xs text-red-600 dark:text-red-400/80 mb-3">
          Permanently delete all notes. This cannot be undone.
        </p>
        <button
          onClick={() => setShowClearConfirm(true)}
          className="px-3 py-1.5 text-sm font-medium text-white bg-red-600 rounded hover:bg-red-700 transition-colors"
        >
          Clear All Notes
        </button>
      </div>

      {/* Import Options Modal */}
      {showImportOptions && (
        <div className="fixed inset-0 modal-backdrop-dark flex items-center justify-center z-[60] modal-backdrop-enter">
          <div className="bg-white dark:bg-gray-800 rounded-md p-6 max-w-sm mx-4 modal-elevated modal-content-enter">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              Import Notes
            </h3>
            <p className="text-gray-600 dark:text-gray-300 mb-4">
              How would you like to import the notes?
            </p>
            <div className="space-y-2 mb-4">
              <button
                onClick={() => handleImport(true)}
                className="w-full px-4 py-3 text-left text-sm font-medium text-gray-900 dark:text-white bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
              >
                <span className="font-semibold">Merge with existing</span>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Add new notes without overwriting existing ones
                </p>
              </button>
              <button
                onClick={() => handleImport(false)}
                className="w-full px-4 py-3 text-left text-sm font-medium text-gray-900 dark:text-white bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
              >
                <span className="font-semibold">Replace all</span>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Clear existing notes and import from backup
                </p>
              </button>
            </div>
            <button
              onClick={() => {
                setShowImportOptions(false);
                setPendingImportPath(null);
              }}
              className="w-full px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Clear Confirmation Modal */}
      {showClearConfirm && (
        <div className="fixed inset-0 modal-backdrop-dark flex items-center justify-center z-[60] modal-backdrop-enter">
          <div className="bg-white dark:bg-gray-800 rounded-md p-6 max-w-sm mx-4 modal-elevated modal-content-enter">
            <h3 className="text-lg font-semibold text-red-600 dark:text-red-400 mb-2">
              Delete All Notes
            </h3>
            <p className="text-gray-600 dark:text-gray-300 mb-4">
              This will permanently delete ALL notes. This cannot be undone.
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
              Type <span className="font-mono font-bold text-red-600 dark:text-red-400">DELETE</span> to confirm:
            </p>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="Type DELETE"
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500 mb-4"
              autoFocus
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowClearConfirm(false);
                  setConfirmText('');
                }}
                className="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors focus-ring"
              >
                Cancel
              </button>
              <button
                onClick={handleClearAllNotes}
                disabled={confirmText !== 'DELETE' || isClearing}
                className={`px-3 py-1.5 text-sm font-medium text-white rounded btn-danger-gradient focus-ring ${
                  confirmText !== 'DELETE' || isClearing ? 'btn-disabled' : 'btn-elevated'
                }`}
              >
                {isClearing ? 'Deleting...' : 'Delete All'}
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
      <div className="p-4 bg-gray-50 dark:bg-gray-900/50 rounded-md space-y-4">
        <div>
          <h3 className="text-sm font-medium text-gray-900 dark:text-white">
            Theme
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Choose your preferred color scheme
          </p>
        </div>
        <div className="flex gap-2">
          {(['light', 'dark', 'system'] as const).map((t) => (
            <button
              key={t}
              onClick={() => onThemeChange(t)}
              className={`px-3 py-1.5 text-sm font-medium rounded transition-colors ${
                theme === t
                  ? 'bg-blue-600 text-white'
                  : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Typography Section */}
      <div className="p-4 bg-gray-50 dark:bg-gray-900/50 rounded-md space-y-4">
        <h3 className="text-sm font-medium text-gray-900 dark:text-white">
          Typography
        </h3>

        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 mb-2 block">
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
                className={`px-3 py-1.5 text-sm font-medium rounded transition-colors ${
                  settings.fontSize === size.value
                    ? 'bg-blue-600 text-white'
                    : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                {size.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 mb-2 block">
            Font Family
          </label>
          <select
            value={settings.fontFamily}
            onChange={(e) => {
              const family = e.target.value as FontFamily;
              settings.setFontFamily(family);
              applyFontFamily(family);
            }}
            className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
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
      <div className="p-4 bg-gray-50 dark:bg-gray-900/50 rounded-md space-y-4">
        <h3 className="text-sm font-medium text-gray-900 dark:text-white">
          Layout
        </h3>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs text-gray-500 dark:text-gray-400">
              Sidebar Width
            </label>
            <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
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
            className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded appearance-none cursor-pointer accent-blue-600"
          />
          <div className="flex justify-between text-xs text-gray-400 dark:text-gray-500 mt-1">
            <span>Narrow</span>
            <span>Wide</span>
          </div>
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-gray-200 dark:border-gray-800">
          <div>
            <span className="text-sm text-gray-700 dark:text-gray-200">
              Compact Mode
            </span>
            <p className="text-xs text-gray-500 dark:text-gray-400">
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
      <div className="p-4 bg-gray-50 dark:bg-gray-900/50 rounded-md space-y-4">
        <div>
          <h3 className="text-sm font-medium text-gray-900 dark:text-white">
            Default Note Type
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            What type of note to create by default
          </p>
        </div>
        <div className="flex gap-2">
          {(['daily', 'standalone'] as const).map((type) => (
            <button
              key={type}
              onClick={() => settings.setDefaultNoteType(type)}
              className={`px-3 py-1.5 text-sm font-medium rounded transition-colors ${
                settings.defaultNoteType === type
                  ? 'bg-blue-600 text-white'
                  : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              {type.charAt(0).toUpperCase() + type.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Formatting Section */}
      <div className="p-4 bg-gray-50 dark:bg-gray-900/50 rounded-md space-y-4">
        <h3 className="text-sm font-medium text-gray-900 dark:text-white">
          Formatting
        </h3>

        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 mb-2 block">
            Line Height
          </label>
          <div className="flex gap-2">
            {(['comfortable', 'compact'] as const).map((height) => (
              <button
                key={height}
                onClick={() => settings.setLineHeight(height)}
                className={`px-3 py-1.5 text-sm font-medium rounded transition-colors ${
                  settings.lineHeight === height
                    ? 'bg-blue-600 text-white'
                    : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                {height.charAt(0).toUpperCase() + height.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Writing Assistance Section */}
      <div className="p-4 bg-gray-50 dark:bg-gray-900/50 rounded-md space-y-1">
        <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-3">
          Writing Assistance
        </h3>

        <div className="flex items-center justify-between py-2">
          <div>
            <span className="text-sm text-gray-700 dark:text-gray-200">
              Spell Check
            </span>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Underline spelling errors
            </p>
          </div>
          <Toggle
            enabled={settings.spellCheck}
            onChange={settings.setSpellCheck}
          />
        </div>

        <div className="flex items-center justify-between py-2 border-t border-gray-200 dark:border-gray-800">
          <div>
            <span className="text-sm text-gray-700 dark:text-gray-200">
              Auto-capitalize
            </span>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Capitalize first letter of sentences
            </p>
          </div>
          <Toggle
            enabled={settings.autoCapitalize}
            onChange={settings.setAutoCapitalize}
          />
        </div>

        <div className="flex items-center justify-between py-2 border-t border-gray-200 dark:border-gray-800">
          <div>
            <span className="text-sm text-gray-700 dark:text-gray-200">
              Show Word Count
            </span>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Display word count at bottom of editor
            </p>
          </div>
          <Toggle
            enabled={settings.showWordCount}
            onChange={settings.setShowWordCount}
          />
        </div>
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
      <div className="p-4 bg-gray-50 dark:bg-gray-900/50 rounded-md space-y-4">
        <div>
          <h3 className="text-sm font-medium text-gray-900 dark:text-white">
            Calendar Access
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Display events from Calendar.app in your timeline
          </p>
        </div>

        {isAuthorized ? (
          <div className="flex items-center gap-3 p-3 bg-green-50 dark:bg-green-900/20 rounded border border-green-200 dark:border-green-800">
            <div className="w-8 h-8 rounded-full bg-green-100 dark:bg-green-800 flex items-center justify-center flex-shrink-0">
              <Check className="w-4 h-4 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-green-800 dark:text-green-200">
                Calendar Access Enabled
              </p>
              <p className="text-xs text-green-600 dark:text-green-400">
                Connected to Calendar.app
              </p>
            </div>
          </div>
        ) : permissionStatus === 'Denied' || permissionStatus === 'Restricted' ? (
          <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded border border-red-200 dark:border-red-800">
            <div className="flex items-center gap-2 mb-2">
              <Lock className="w-4 h-4 text-red-600 dark:text-red-400" />
              <p className="text-sm font-medium text-red-800 dark:text-red-200">
                Access Denied
              </p>
            </div>
            <p className="text-xs text-red-600 dark:text-red-400 mb-2">
              Calendar access was denied. To enable:
            </p>
            <ol className="text-xs text-red-600 dark:text-red-400 list-decimal list-inside space-y-1">
              <li>Open System Settings</li>
              <li>Go to Privacy & Security → Calendars</li>
              <li>Enable access for Notomattic</li>
            </ol>
          </div>
        ) : (
          <button
            onClick={handleRequestPermission}
            disabled={isRequestingPermission}
            className="w-full flex items-center justify-center gap-2 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded transition-colors"
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
          <div className="p-4 bg-gray-50 dark:bg-gray-900/50 rounded-md space-y-1">
            <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-3">
              Display Options
            </h3>

            <div className="flex items-center justify-between py-2">
              <div>
                <span className="text-sm text-gray-700 dark:text-gray-200">
                  Show Calendar Events
                </span>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Display events in the timeline
                </p>
              </div>
              <Toggle
                enabled={calendarEnabled}
                onChange={setCalendarEnabled}
              />
            </div>

            <div className="flex items-center justify-between py-2 border-t border-gray-200 dark:border-gray-800">
              <div>
                <span className="text-sm text-gray-700 dark:text-gray-200">
                  Show All-Day Events
                </span>
                <p className="text-xs text-gray-500 dark:text-gray-400">
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
            <div className="p-4 bg-gray-50 dark:bg-gray-900/50 rounded-md space-y-4">
              <div>
                <h3 className="text-sm font-medium text-gray-900 dark:text-white">
                  Calendar Source
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  Choose which calendar to display
                </p>
              </div>
              <select
                value={selectedCalendarId || ''}
                onChange={(e) => setSelectedCalendarId(e.target.value || null)}
                className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
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
  const {
    available,
    version: updateVersion,
    isChecking,
    lastChecked,
    error,
    downloading,
    progress,
    checkForUpdate,
    installUpdate,
  } = useUpdateStore();

  // Fetch app version on mount
  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => setAppVersion('0.0.0'));
  }, []);

  // Format last checked time
  const formatLastChecked = () => {
    if (!lastChecked) return null;
    const now = new Date();
    const diff = now.getTime() - lastChecked.getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    return lastChecked.toLocaleDateString();
  };

  return (
    <div className="space-y-6">
      {/* App Info + Update Section */}
      <div className="flex items-start gap-4 p-4 bg-gray-50 dark:bg-gray-900/50 rounded-md">
        {/* Logo */}
        <img
          src="/logo.png"
          alt="Notomattic Logo"
          className="h-16 w-16 rounded-md flex-shrink-0"
          style={{ backgroundColor: 'transparent' }}
        />

        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white">
            Notomattic
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Version {appVersion || '...'}
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
            Privacy-first note-taking app
          </p>
        </div>
      </div>

      {/* Update Status */}
      <div className="p-4 bg-gray-50 dark:bg-gray-900/50 rounded-md">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-medium text-gray-900 dark:text-white">
            Software Updates
          </h4>
          {lastChecked && (
            <span className="text-xs text-gray-400 dark:text-gray-500">
              Checked {formatLastChecked()}
            </span>
          )}
        </div>

        {/* Update Available State */}
        {available ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 p-3 bg-blue-50 dark:bg-blue-900/20 rounded border border-blue-200 dark:border-blue-800">
              <Download className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-blue-800 dark:text-blue-200">
                  Update Available: v{updateVersion}
                </p>
                <p className="text-xs text-blue-600 dark:text-blue-400">
                  A new version is ready to install
                </p>
              </div>
            </div>

            {/* Progress bar when downloading */}
            {downloading && (
              <div>
                <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded overflow-hidden">
                  <div
                    className="h-full bg-blue-600 dark:bg-blue-500 transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 text-center">
                  Downloading... {progress}%
                </p>
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={installUpdate}
                disabled={downloading}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded transition-colors"
              >
                {downloading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Installing...
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    Install Update
                  </>
                )}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Up to date state */}
            {lastChecked && !error && (
              <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-900/20 rounded border border-green-200 dark:border-green-800">
                <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-green-800 dark:text-green-200">
                    Up to Date
                  </p>
                  <p className="text-xs text-green-600 dark:text-green-400">
                    You're running the latest version
                  </p>
                </div>
              </div>
            )}

            {/* Error state */}
            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 rounded border border-red-200 dark:border-red-800">
                <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-red-800 dark:text-red-200">
                    Update Check Failed
                  </p>
                  <p className="text-xs text-red-600 dark:text-red-400">
                    {error}
                  </p>
                </div>
              </div>
            )}

            <button
              onClick={checkForUpdate}
              disabled={isChecking}
              className="w-full flex items-center justify-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isChecking ? 'animate-spin' : ''}`} />
              {isChecking ? 'Checking...' : 'Check for Updates'}
            </button>
          </div>
        )}
      </div>

      {/* Keyboard Shortcuts */}
      <div className="p-4 bg-gray-50 dark:bg-gray-900/50 rounded-md">
        <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-3">
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

      {/* Footer */}
      <div className="text-center space-y-1">
        <p className="text-xs text-gray-400 dark:text-gray-500">
          Built with Tauri, React, and TipTap
        </p>
        <p className="text-xs text-gray-400 dark:text-gray-500">
          Your notes are stored locally and never leave your device
        </p>
      </div>
    </div>
  );
}

// Toggle Component
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
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-all duration-200 ${
        enabled ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-all duration-200 ${
          enabled ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

// Shortcut Row Component
function ShortcutRow({ keys, description }: { keys: string[]; description: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-600 dark:text-gray-400">{description}</span>
      <div className="flex gap-1">
        {keys.map((key, i) => (
          <kbd
            key={i}
            className="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-700 rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300"
          >
            {key}
          </kbd>
        ))}
      </div>
    </div>
  );
}
