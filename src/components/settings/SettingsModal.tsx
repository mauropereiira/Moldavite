import { useState, useEffect } from 'react';
import { useSettingsStore, useThemeStore, applyTheme, useNoteStore } from '@/stores';
import { useCalendarStore } from '@/stores/calendarStore';
import { clearAllNotes } from '@/lib';
import { Calendar, RefreshCw, Check, Lock } from 'lucide-react';
import { SettingsTemplates } from '@/components/templates/SettingsTemplates';
import { useTemplates } from '@/hooks/useTemplates';

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

  const tabs: { id: SettingsTab; label: string }[] = [
    { id: 'general', label: 'General' },
    { id: 'appearance', label: 'Appearance' },
    { id: 'editor', label: 'Editor' },
    { id: 'calendar', label: 'Calendar' },
    { id: 'templates', label: 'Templates' },
    { id: 'about', label: 'About' },
  ];

  return (
    <div
      className="fixed inset-0 modal-backdrop-dark flex items-center justify-center z-50 modal-backdrop-enter"
      onClick={handleBackdropClick}
    >
      <div className="bg-white dark:bg-gray-800 rounded-xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col modal-elevated modal-content-enter">
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
        <div className="flex border-b border-gray-200 dark:border-gray-700 px-6">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-3 text-sm font-medium transition-all rounded-t-lg mx-0.5 focus-ring ${
                activeTab === tab.id
                  ? 'settings-tab settings-tab-active text-blue-600 dark:text-blue-400'
                  : 'settings-tab text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
              }`}
            >
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
      <div>
        <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-1">
          Notes Directory
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
          Where your notes are stored
        </p>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={settings.notesDirectory}
            readOnly
            className="flex-1 px-3 py-2 text-sm bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-600 dark:text-gray-400"
          />
          <button
            className="px-3 py-2 text-sm font-medium text-gray-500 bg-gray-100 dark:bg-gray-700 rounded-lg cursor-not-allowed"
            disabled
            title="Coming soon"
          >
            Change
          </button>
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
          Changing directory will be available in a future update
        </p>
      </div>

      <div>
        <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-1">
          Auto-save Delay
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
          How long to wait after typing before saving ({settings.autoSaveDelay}ms)
        </p>
        <input
          type="range"
          min="100"
          max="2000"
          step="100"
          value={settings.autoSaveDelay}
          onChange={(e) => settings.setAutoSaveDelay(Number(e.target.value))}
          className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer"
        />
        <div className="flex justify-between text-xs text-gray-400 dark:text-gray-500 mt-1">
          <span>100ms (fast)</span>
          <span>2000ms (slow)</span>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-gray-900 dark:text-white">
            Show Auto-save Status
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Display "Saving..." indicator when saving
          </p>
        </div>
        <Toggle
          enabled={settings.showAutoSaveStatus}
          onChange={settings.setShowAutoSaveStatus}
        />
      </div>

      {/* Danger Zone */}
      <div className="pt-6 mt-6 border-t border-gray-200 dark:border-gray-700">
        <div className="rounded-lg border-2 border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/30 p-4">
          <h3 className="text-sm font-medium text-red-800 dark:text-red-400 mb-1">
            Danger Zone
          </h3>
          <p className="text-sm text-red-600 dark:text-red-400/80 mb-3">
            Permanently delete all notes. This action cannot be undone.
          </p>
          <button
            onClick={() => setShowClearConfirm(true)}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
          >
            Clear All Notes
          </button>
        </div>
      </div>

      {/* Clear Confirmation Modal */}
      {showClearConfirm && (
        <div className="fixed inset-0 modal-backdrop-dark flex items-center justify-center z-[60] modal-backdrop-enter">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 max-w-sm mx-4 modal-elevated modal-content-enter">
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
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500 mb-4"
              autoFocus
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowClearConfirm(false);
                  setConfirmText('');
                }}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors focus-ring"
              >
                Cancel
              </button>
              <button
                onClick={handleClearAllNotes}
                disabled={confirmText !== 'DELETE' || isClearing}
                className={`px-4 py-2 text-sm font-medium text-white rounded-lg btn-danger-gradient focus-ring ${
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
      <div>
        <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-1">
          Theme
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
          Choose your preferred color scheme
        </p>
        <div className="flex gap-2">
          {(['light', 'dark', 'system'] as const).map((t) => (
            <button
              key={t}
              onClick={() => onThemeChange(t)}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                theme === t
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-1">
          Font Size
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
          Editor text size
        </p>
        <div className="flex gap-2">
          {([
            { value: 'small', label: 'Small' },
            { value: 'medium', label: 'Medium' },
            { value: 'large', label: 'Large' },
            { value: 'extra-large', label: 'Extra Large' },
          ] as const).map((size) => (
            <button
              key={size.value}
              onClick={() => settings.setFontSize(size.value)}
              className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                settings.fontSize === size.value
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              {size.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-1">
          Sidebar Width
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
          Adjust sidebar width ({settings.sidebarWidth}px)
        </p>
        <input
          type="range"
          min="200"
          max="400"
          step="10"
          value={settings.sidebarWidth}
          onChange={(e) => settings.setSidebarWidth(Number(e.target.value))}
          className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer"
        />
        <div className="flex justify-between text-xs text-gray-400 dark:text-gray-500 mt-1">
          <span>200px</span>
          <span>400px</span>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-gray-900 dark:text-white">
            Compact Mode
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Tighter spacing throughout the app
          </p>
        </div>
        <Toggle
          enabled={settings.compactMode}
          onChange={settings.setCompactMode}
        />
      </div>
    </div>
  );
}

// Editor Settings Section
function EditorSettings() {
  const settings = useSettingsStore();
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-1">
          Default Note Type
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
          What type of note to create by default
        </p>
        <div className="flex gap-2">
          {(['daily', 'standalone'] as const).map((type) => (
            <button
              key={type}
              onClick={() => settings.setDefaultNoteType(type)}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                settings.defaultNoteType === type
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              {type.charAt(0).toUpperCase() + type.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-1">
          Line Height
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
          Spacing between lines in the editor
        </p>
        <div className="flex gap-2">
          {(['comfortable', 'compact'] as const).map((height) => (
            <button
              key={height}
              onClick={() => settings.setLineHeight(height)}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                settings.lineHeight === height
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              {height.charAt(0).toUpperCase() + height.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-gray-900 dark:text-white">
            Spell Check
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Underline spelling errors
          </p>
        </div>
        <Toggle
          enabled={settings.spellCheck}
          onChange={settings.setSpellCheck}
        />
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-gray-900 dark:text-white">
            Auto-capitalize
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Capitalize first letter of sentences
          </p>
        </div>
        <Toggle
          enabled={settings.autoCapitalize}
          onChange={settings.setAutoCapitalize}
        />
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-gray-900 dark:text-white">
            Show Word Count
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Display word count at bottom of editor
          </p>
        </div>
        <Toggle
          enabled={settings.showWordCount}
          onChange={settings.setShowWordCount}
        />
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
      {/* Permission Status */}
      <div>
        <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-1">
          Calendar Access
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
          Display events from Calendar.app in your timeline
        </p>

        {isAuthorized ? (
          <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
            <div className="w-8 h-8 rounded-full bg-green-100 dark:bg-green-800 flex items-center justify-center">
              <Check className="w-4 h-4 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-green-800 dark:text-green-200">
                Calendar Access Enabled
              </p>
              <p className="text-xs text-green-600 dark:text-green-400">
                Showing events from Calendar.app
              </p>
            </div>
          </div>
        ) : permissionStatus === 'Denied' || permissionStatus === 'Restricted' ? (
          <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
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
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded-lg transition-colors"
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
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-gray-900 dark:text-white">
                Show Calendar Events
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Display events in the timeline
              </p>
            </div>
            <Toggle
              enabled={calendarEnabled}
              onChange={setCalendarEnabled}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-gray-900 dark:text-white">
                Show All-Day Events
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Include events without specific times
              </p>
            </div>
            <Toggle
              enabled={showAllDayEvents}
              onChange={setShowAllDayEvents}
            />
          </div>

          {/* Calendar Selection */}
          {calendars.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-1">
                Calendar
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
                Choose which calendar to display
              </p>
              <select
                value={selectedCalendarId || ''}
                onChange={(e) => setSelectedCalendarId(e.target.value || null)}
                className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
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
  return (
    <div className="space-y-6">
      <div className="text-center py-4">
        {/* Logo */}
        <div className="flex justify-center mb-4">
          <img
            src="/logo.png"
            alt="Notomattic Logo"
            className="h-20 w-auto rounded-lg"
            style={{ backgroundColor: 'transparent' }}
          />
        </div>
        <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
          Notomattic
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Version 0.1.0 MVP
        </p>
        <p className="text-sm text-gray-600 dark:text-gray-300 mt-2">
          Privacy-first note-taking app
        </p>
      </div>

      <div>
        <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-3">
          Keyboard Shortcuts
        </h4>
        <div className="space-y-2 text-sm">
          <ShortcutRow keys={['Cmd', ',']} description="Open Settings" />
          <ShortcutRow keys={['Cmd', 'T']} description="New from Template" />
          <ShortcutRow keys={['Cmd', 'B']} description="Bold" />
          <ShortcutRow keys={['Cmd', 'I']} description="Italic" />
          <ShortcutRow keys={['Cmd', 'U']} description="Underline" />
          <ShortcutRow keys={['Cmd', 'K']} description="Add Link" />
          <ShortcutRow keys={['Cmd', 'Z']} description="Undo" />
          <ShortcutRow keys={['Cmd', 'Shift', 'Z']} description="Redo" />
          <ShortcutRow keys={['Cmd', 'S']} description="Save (auto-saves)" />
          <ShortcutRow keys={['Esc']} description="Close modal" />
        </div>
      </div>

      <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
        <p className="text-xs text-gray-400 dark:text-gray-500 text-center">
          Built with Tauri, React, and TipTap
        </p>
        <p className="text-xs text-gray-400 dark:text-gray-500 text-center mt-1">
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
