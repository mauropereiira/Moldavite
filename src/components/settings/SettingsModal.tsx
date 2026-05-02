/**
 * Settings Modal Component
 *
 * A tabbed settings interface for Moldavite configuration. This file is the
 * tab shell — header, tab sidebar, and content routing. Each tab's UI lives
 * in its own file under `./sections/`.
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

import { useState, useEffect, useRef, useMemo } from 'react';
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
  const { theme, setTheme, preset, setPreset } = useThemeStore();
  const { deleteExistingTemplate, updateExistingTemplate } = useTemplates();
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const tabRefs = useRef<Record<SettingsTab, HTMLButtonElement | null>>({
    general: null,
    appearance: null,
    editor: null,
    features: null,
    sidebar: null,
    calendar: null,
    templates: null,
    data: null,
    about: null,
  });

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

  const tabs = useMemo<{ id: SettingsTab; label: string; icon: React.ReactNode }[]>(
    () => [
      { id: 'general', label: 'General', icon: <Settings className="w-4 h-4" /> },
      { id: 'appearance', label: 'Appearance', icon: <Palette className="w-4 h-4" /> },
      { id: 'editor', label: 'Editor', icon: <Type className="w-4 h-4" /> },
      { id: 'features', label: 'Features', icon: <Zap className="w-4 h-4" /> },
      { id: 'sidebar', label: 'Sidebar', icon: <PanelLeft className="w-4 h-4" /> },
      { id: 'calendar', label: 'Calendar', icon: <Calendar className="w-4 h-4" /> },
      { id: 'templates', label: 'Templates', icon: <FileText className="w-4 h-4" /> },
      { id: 'data', label: 'Data', icon: <Database className="w-4 h-4" /> },
      { id: 'about', label: 'About', icon: <Info className="w-4 h-4" /> },
    ],
    []
  );

  if (!settingsStore.isSettingsOpen) return null;

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      settingsStore.setIsSettingsOpen(false);
    }
  };

  const handleThemeChange = (newTheme: 'light' | 'dark' | 'system') => {
    setTheme(newTheme);
    applyTheme(newTheme, preset);
  };

  const handlePresetChange = (newPreset: import('@/stores').ThemePreset) => {
    setPreset(newPreset);
    applyTheme(theme, newPreset);
  };

  const focusTab = (tabId: SettingsTab) => {
    setActiveTab(tabId);
    // Defer focus until after re-render to ensure the ref is current.
    requestAnimationFrame(() => {
      tabRefs.current[tabId]?.focus();
    });
  };

  const handleTabKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      const next = tabs[(index + 1) % tabs.length];
      focusTab(next.id);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const prev = tabs[(index - 1 + tabs.length) % tabs.length];
      focusTab(prev.id);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusTab(tabs[0].id);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusTab(tabs[tabs.length - 1].id);
    }
  };

  const tabButtonId = (id: SettingsTab) => `settings-tab-${id}`;
  const tabPanelId = (id: SettingsTab) => `settings-panel-${id}`;

  return (
    <div
      className="fixed inset-0 modal-backdrop-dark flex items-center justify-center z-[9999] modal-backdrop-enter"
      onClick={handleBackdropClick}
    >
      <div
        className="w-full max-w-3xl mx-4 max-h-[85vh] flex flex-col modal-elevated modal-content-enter"
        style={{ borderRadius: 'var(--radius-md)' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--border-default)' }}
        >
          <h2 id="settings-modal-title" className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            Settings
          </h2>
          <button
            onClick={() => settingsStore.setIsSettingsOpen(false)}
            className="p-1 transition-colors"
            style={{ color: 'var(--text-muted)', borderRadius: 'var(--radius-sm)' }}
            onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
            onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
            aria-label="Close settings"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body: tab sidebar + content */}
        <div className="flex flex-1 min-h-0">
          {/* Tab sidebar */}
          <div
            role="tablist"
            aria-orientation="vertical"
            aria-label="Settings sections"
            className="flex flex-col py-3 px-2 gap-0.5 overflow-y-auto flex-shrink-0"
            style={{
              width: '180px',
              borderRight: '1px solid var(--border-default)',
              backgroundColor: 'var(--bg-inset)',
            }}
          >
            {tabs.map((tab, index) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  ref={(el) => { tabRefs.current[tab.id] = el; }}
                  id={tabButtonId(tab.id)}
                  role="tab"
                  type="button"
                  aria-selected={isActive}
                  aria-controls={tabPanelId(tab.id)}
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => setActiveTab(tab.id)}
                  onKeyDown={(e) => handleTabKeyDown(e, index)}
                  className="flex items-center gap-2 px-3 py-2 text-sm font-medium transition-all text-left focus-ring"
                  style={{
                    borderRadius: 'var(--radius-sm)',
                    color: isActive ? 'var(--accent-primary)' : 'var(--text-secondary)',
                    backgroundColor: isActive ? 'var(--accent-subtle)' : 'transparent',
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.color = 'var(--text-primary)';
                      e.currentTarget.style.backgroundColor = 'var(--bg-default)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.color = 'var(--text-secondary)';
                      e.currentTarget.style.backgroundColor = 'transparent';
                    }
                  }}
                >
                  {tab.icon}
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* Content */}
          <div
            id={tabPanelId(activeTab)}
            role="tabpanel"
            aria-labelledby={tabButtonId(activeTab)}
            tabIndex={0}
            className="flex-1 overflow-y-auto p-6 min-w-0"
          >
            <div key={activeTab} className="tab-content-enter">
              {activeTab === 'general' && (
                <GeneralSection />
              )}
              {activeTab === 'appearance' && (
                <AppearanceSection
                  theme={theme}
                  onThemeChange={handleThemeChange}
                  preset={preset}
                  onPresetChange={handlePresetChange}
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
    </div>
  );
}
