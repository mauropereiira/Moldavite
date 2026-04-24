/**
 * Settings Modal Component
 *
 * A tabbed settings interface for Moldavite configuration. This file is the
 * tab shell — header, tab bar, and content routing. Each tab's UI lives in
 * its own file under `./sections/`.
 *
 * ## Tabs
 *
 * - **General** (`GeneralSection`)      — notes directory, backup/restore,
 *                                          encrypted backup, auto-lock,
 *                                          auto-save, clear-all (danger zone)
 * - **Appearance** (`AppearanceSection`) — theme, typography, layout
 * - **Editor** (`EditorSection`)         — defaults, formatting, writing aids
 * - **Features** (`FeaturesSection`)     — editor / navigation / right-panel
 * - **Sidebar** (`SidebarSection`)       — visibility, sort, panel widths
 * - **Calendar** (`CalendarSection`)     — macOS Calendar.app integration
 * - **Templates** (`SettingsTemplates`)  — template management
 * - **Data** (`SettingsData`)            — bulk import / export actions
 * - **About** (`AboutSection`)           — version, updates, shortcuts
 *
 * Shared primitives (`Toggle`, `InfoTooltip`, `ShortcutRow`) live under
 * `./common/` and are imported by the section files that need them.
 *
 * All IPC calls are routed through `safeInvoke` from `@/lib/ipc` via the
 * wrapper modules in `@/lib` — no section calls Tauri's raw `invoke`.
 *
 * @module components/settings/SettingsModal
 */

import { useState, useEffect } from 'react';
import { useSettingsStore, useThemeStore, applyTheme } from '@/stores';
import { Calendar, Settings, Palette, Type, FileText, Info, Zap, PanelLeft, Database } from 'lucide-react';
import { SettingsData } from './SettingsData';
import { AboutSection } from './sections/AboutSection';
import { AppearanceSection } from './sections/AppearanceSection';
import { EditorSection } from './sections/EditorSection';
import { FeaturesSection } from './sections/FeaturesSection';
import { SidebarSection } from './sections/SidebarSection';
import { CalendarSection } from './sections/CalendarSection';
import { GeneralSection } from './sections/GeneralSection';
import { SettingsTemplates } from '@/components/templates/SettingsTemplates';
import { useTemplates } from '@/hooks/useTemplates';

/** Available settings tabs */
type SettingsTab = 'general' | 'appearance' | 'editor' | 'features' | 'sidebar' | 'calendar' | 'templates' | 'data' | 'about';

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
    { id: 'data', label: 'Data', icon: <Database className="w-4 h-4" /> },
    { id: 'about', label: 'About', icon: <Info className="w-4 h-4" /> },
  ];

  return (
    <div
      className="fixed inset-0 modal-backdrop-dark flex items-center justify-center z-[9999] modal-backdrop-enter"
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
              <GeneralSection />
            )}
            {activeTab === 'appearance' && (
              <AppearanceSection
                theme={theme}
                onThemeChange={handleThemeChange}
              />
            )}
            {activeTab === 'editor' && (
              <EditorSection />
            )}
            {activeTab === 'features' && (
              <FeaturesSection />
            )}
            {activeTab === 'sidebar' && (
              <SidebarSection />
            )}
            {activeTab === 'calendar' && (
              <CalendarSection />
            )}
            {activeTab === 'templates' && (
              <SettingsTemplates
                onDeleteTemplate={handleDeleteTemplate}
                onUpdateTemplate={handleUpdateTemplate}
              />
            )}
            {activeTab === 'data' && (
              <SettingsData />
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
