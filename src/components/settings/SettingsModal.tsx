/**
 * Settings Modal Component
 *
 * A tabbed settings interface for Moldavite configuration. This file is the
 * tab shell — header, tab sidebar, and content routing. Each tab's UI lives
 * in its own file under `./sections/`.
 *
 * On a phone (`isMobilePlatform()`) the same sections render as a full-screen
 * page beside the icon rail instead of a centred dialog: level one is the
 * section list, level two is one section with a back control. See
 * `MobileSettingsPage` at the bottom of this file.
 *
 * ## Tabs
 *
 * - **General** (`GeneralSection`)      — notes directory, backup/restore,
 *                                          encrypted backup, auto-lock,
 *                                          auto-save, clear-all (danger zone)
 * - **Appearance** (`AppearanceSection`) — theme, typography, layout
 * - **Layout** (`LayoutSection`)          — navigation, editor and welcome chrome
 * - **Editor** (`EditorSection`)         — defaults, formatting, writing aids
 * - **Features** (`FeaturesSection`)     — editor / navigation / right-panel
 * - **Sidebar** (`SidebarSection`)       — visibility, sort, panel widths
 * - **Calendar** (`CalendarSection`)     — Apple and Google calendar sources
 * - **AI & Agents** (`AgentsSection`)    — agent-ready Forge (AGENTS.md)
 * - **Templates** (`SettingsTemplates`)  — template management
 * - **Data** (`SettingsData`)            — bulk import / export actions
 * - **Import** (`ImportSection`)         — one-time Obsidian vault COPY import
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

import { useRef, useMemo } from 'react';
import {
  useSettingsStore,
  useThemeStore,
  useUpdateStore,
  selectHasPendingUpdate,
  applyTheme,
  type SettingsTab,
} from '@/stores';
import { DialogSurface } from '@/components/ui/DialogSurface';
import { isMobilePlatform } from '@/lib/platform';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Settings,
  Palette,
  Type,
  FileText,
  Info,
  Zap,
  PanelLeft,
  Database,
  Puzzle,
  Bot,
  FileInput,
  PanelsTopLeft,
} from 'lucide-react';
import { SettingsData } from './SettingsData';
import { AboutSection } from './sections/AboutSection';
import { AppearanceSection } from './sections/AppearanceSection';
import { EditorSection } from './sections/EditorSection';
import { FeaturesSection } from './sections/FeaturesSection';
import { SidebarSection } from './sections/SidebarSection';
import { CalendarSection } from './sections/CalendarSection';
import { GeneralSection } from './sections/GeneralSection';
import { PluginsSection } from './sections/PluginsSection';
import { AgentsSection } from './sections/AgentsSection';
import { ImportSection } from './sections/ImportSection';
import { LayoutSection } from './sections/LayoutSection';
import { SettingsTemplates } from '@/components/templates/SettingsTemplates';
import { useTemplates } from '@/hooks/useTemplates';

const PHONE_HIDDEN_TABS: SettingsTab[] = ['agents', 'import', 'plugins', 'calendar'];

interface SettingsTabItem {
  id: SettingsTab;
  label: string;
  icon: React.ReactNode;
}

export function SettingsModal() {
  const settingsStore = useSettingsStore();
  const { theme, setTheme, preset, setPreset } = useThemeStore();
  const { deleteExistingTemplate, updateExistingTemplate } = useTemplates();
  const activeTab = settingsStore.activeSettingsTab;
  const setActiveTab = settingsStore.setActiveSettingsTab;
  const hasPendingUpdate = useUpdateStore(selectHasPendingUpdate);
  const tabRefs = useRef<Record<SettingsTab, HTMLButtonElement | null>>({
    general: null,
    appearance: null,
    layout: null,
    editor: null,
    features: null,
    sidebar: null,
    calendar: null,
    templates: null,
    plugins: null,
    agents: null,
    data: null,
    import: null,
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

  const tabs = useMemo<SettingsTabItem[]>(
    () => [
      {
        id: 'general',
        label: 'General',
        icon: <Settings className="w-4 h-4" strokeWidth={1.25} />,
      },
      {
        id: 'appearance',
        label: 'Appearance',
        icon: <Palette className="w-4 h-4" strokeWidth={1.25} />,
      },
      {
        id: 'layout',
        label: 'Layout',
        icon: <PanelsTopLeft className="w-4 h-4" strokeWidth={1.25} />,
      },
      { id: 'editor', label: 'Editor', icon: <Type className="w-4 h-4" strokeWidth={1.25} /> },
      { id: 'features', label: 'Features', icon: <Zap className="w-4 h-4" strokeWidth={1.25} /> },
      {
        id: 'sidebar',
        label: 'Sidebar',
        icon: <PanelLeft className="w-4 h-4" strokeWidth={1.25} />,
      },
      {
        id: 'calendar',
        label: 'Calendar',
        icon: <Calendar className="w-4 h-4" strokeWidth={1.25} />,
      },
      {
        id: 'templates',
        label: 'Templates',
        icon: <FileText className="w-4 h-4" strokeWidth={1.25} />,
      },
      { id: 'plugins', label: 'Plugins', icon: <Puzzle className="w-4 h-4" strokeWidth={1.25} /> },
      { id: 'agents', label: 'AI & Agents', icon: <Bot className="w-4 h-4" strokeWidth={1.25} /> },
      { id: 'data', label: 'Data', icon: <Database className="w-4 h-4" strokeWidth={1.25} /> },
      { id: 'import', label: 'Import', icon: <FileInput className="w-4 h-4" strokeWidth={1.25} /> },
      { id: 'about', label: 'About', icon: <Info className="w-4 h-4" strokeWidth={1.25} /> },
    ],
    []
  );

  // Nothing behind these works on a phone: no MCP or agent process, no
  // semantic-search runtime, no folder picker for an Obsidian vault.
  const phoneTabs = tabs.filter((tab) => !PHONE_HIDDEN_TABS.includes(tab.id));

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

  const renderSection = (tab: SettingsTab) => (
    <>
      {tab === 'general' && <GeneralSection />}
      {tab === 'appearance' && (
        <AppearanceSection
          theme={theme}
          onThemeChange={handleThemeChange}
          preset={preset}
          onPresetChange={handlePresetChange}
        />
      )}
      {tab === 'layout' && <LayoutSection />}
      {tab === 'editor' && <EditorSection />}
      {tab === 'features' && <FeaturesSection />}
      {tab === 'sidebar' && <SidebarSection />}
      {tab === 'calendar' && <CalendarSection />}
      {tab === 'templates' && (
        <SettingsTemplates
          onDeleteTemplate={handleDeleteTemplate}
          onUpdateTemplate={handleUpdateTemplate}
        />
      )}
      {tab === 'plugins' && <PluginsSection />}
      {tab === 'agents' && <AgentsSection />}
      {tab === 'data' && <SettingsData />}
      {tab === 'import' && <ImportSection />}
      {tab === 'about' && <AboutSection />}
    </>
  );

  if (isMobilePlatform()) {
    return (
      <MobileSettingsPage
        tabs={phoneTabs}
        hasPendingUpdate={hasPendingUpdate}
        onOpenSection={setActiveTab}
        onClose={() => settingsStore.setIsSettingsOpen(false)}
        renderSection={renderSection}
      />
    );
  }

  return (
    <div
      className="settings-scrim fixed inset-0 flex items-center justify-center z-[9999] modal-backdrop-enter"
      onClick={handleBackdropClick}
    >
      <DialogSurface
        onEscape={() => settingsStore.setIsSettingsOpen(false)}
        className="settings-dialog w-full max-w-3xl mx-4 max-h-[85vh] flex flex-col modal-content-enter"
        aria-labelledby="settings-modal-title"
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--border-default)' }}
        >
          <h2
            id="settings-modal-title"
            className="text-lg font-semibold"
            style={{ color: 'var(--text-primary)' }}
          >
            Settings
          </h2>
          <button
            onClick={() => settingsStore.setIsSettingsOpen(false)}
            className="settings-close p-1 transition-colors"
            style={{ color: 'var(--text-muted)' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
            aria-label="Close settings"
          >
            <span aria-hidden="true">×</span>
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
              backgroundColor: 'transparent',
            }}
          >
            {tabs.map((tab, index) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  ref={(el) => {
                    tabRefs.current[tab.id] = el;
                  }}
                  id={tabButtonId(tab.id)}
                  role="tab"
                  type="button"
                  aria-selected={isActive}
                  aria-controls={tabPanelId(tab.id)}
                  aria-label={
                    tab.id === 'about' && hasPendingUpdate ? 'About (update available)' : undefined
                  }
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => setActiveTab(tab.id)}
                  onKeyDown={(e) => handleTabKeyDown(e, index)}
                  className="flex items-center gap-2 px-3 py-2 text-sm font-medium transition-all text-left focus-ring"
                  style={{
                    color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
                    backgroundColor: 'transparent',
                    borderLeft: `2px solid ${isActive ? 'var(--text-primary)' : 'transparent'}`,
                  }}
                >
                  {tab.icon}
                  <span>{tab.label}</span>
                  {tab.id === 'about' && hasPendingUpdate && (
                    <span
                      aria-hidden="true"
                      className="settings-update-dot ml-auto"
                      style={{
                        width: '7px',
                        height: '7px',
                        backgroundColor: 'var(--update-dot)',
                      }}
                    />
                  )}
                </button>
              );
            })}
          </div>

          {/* Content */}
          <div
            id={tabPanelId(activeTab)}
            role="tabpanel"
            aria-labelledby={tabButtonId(activeTab)}
            className="flex-1 overflow-y-auto p-6 min-w-0"
          >
            <div key={activeTab} className="tab-content-enter">
              {renderSection(activeTab)}
            </div>
          </div>
        </div>
      </DialogSurface>
    </div>
  );
}

/** Apple's minimum touch target, 44px; declared in src/mobile.css. */
const TOUCH_TARGET = 'var(--touch-target)';

/**
 * Settings as a phone page. It fills the content area to the right of the
 * icon rail (the rail stays above the scrim at z-10000 so its Settings button
 * keeps lit and the other rail buttons still switch pages, #121), and opens at
 * the section list every time: the page only mounts while Settings is open,
 * so its level-two state resets with it rather than reopening on a remembered
 * tab.
 *
 * The list is a `<nav>` of plain buttons, not a tablist. The section body
 * keeps `role="tabpanel"` on purpose: index.css keys section typography and
 * button colour on `.settings-dialog [role='tabpanel']`, and a tabpanel with
 * no tablist is still valid ARIA — it is labelled by the page heading.
 */
function MobileSettingsPage({
  tabs,
  hasPendingUpdate,
  onOpenSection,
  onClose,
  renderSection,
}: {
  tabs: SettingsTabItem[];
  hasPendingUpdate: boolean;
  onOpenSection: (tab: SettingsTab) => void;
  onClose: () => void;
  renderSection: (tab: SettingsTab) => React.ReactNode;
}) {
  // In the store rather than local state so the rail's Settings button can
  // walk back to the list from a section.
  const sectionId = useSettingsStore((state) => state.settingsSection);
  const setSectionId = useSettingsStore((state) => state.setSettingsSection);
  const section = sectionId === null ? null : (tabs.find((tab) => tab.id === sectionId) ?? null);

  const openSection = (id: SettingsTab) => {
    onOpenSection(id);
    setSectionId(id);
  };

  return (
    <div
      className="settings-scrim fixed z-[9999] modal-backdrop-enter"
      style={{ top: 0, bottom: 0, left: 'var(--rail-width)', right: 0 }}
    >
      {/* iOS zooms into any field under 16px on focus, and a phone needs a
          thumb-sized button; the sections are shared with desktop, so both
          are imposed from here rather than in every section. Switches keep
          their own 20px height. */}
      <DialogSurface
        onEscape={onClose}
        className="settings-dialog flex h-full w-full flex-col [&_input]:text-[16px] [&_select]:text-[16px] [&_textarea]:text-[16px] [&_button:not([role=switch])]:min-h-10"
        style={{
          paddingTop: 'var(--safe-top)',
          paddingBottom: 'var(--safe-bottom)',
          border: 0,
        }}
        aria-labelledby="settings-modal-title"
      >
        <header
          className="flex items-center flex-shrink-0 gap-1"
          style={{
            minHeight: TOUCH_TARGET,
            paddingLeft: section ? '4px' : '16px',
            paddingRight: '4px',
            borderBottom: '1px solid var(--border-default)',
          }}
        >
          {section && (
            <button
              type="button"
              onClick={() => setSectionId(null)}
              className="flex items-center pr-2 text-sm font-medium focus-ring"
              style={{
                minWidth: TOUCH_TARGET,
                minHeight: TOUCH_TARGET,
                color: 'var(--text-secondary)',
              }}
              aria-label="Back to settings"
            >
              <ChevronLeft aria-hidden="true" className="w-5 h-5" />
              <span>Settings</span>
            </button>
          )}
          <h2
            id="settings-modal-title"
            className="flex-1 min-w-0 truncate text-lg font-semibold"
            style={{ color: 'var(--text-primary)' }}
          >
            {section ? section.label : 'Settings'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="settings-close flex items-center justify-center flex-shrink-0"
            style={{ minWidth: TOUCH_TARGET, minHeight: TOUCH_TARGET, color: 'var(--text-muted)' }}
            aria-label="Close settings"
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>

        {section ? (
          <div
            id={`settings-panel-${section.id}`}
            role="tabpanel"
            aria-labelledby="settings-modal-title"
            className="flex-1 min-h-0 min-w-0 overflow-y-auto"
            style={{ padding: '16px 16px 20px' }}
          >
            <div key={section.id} className="tab-content-enter">
              {renderSection(section.id)}
            </div>
          </div>
        ) : (
          <nav aria-label="Settings sections" className="flex-1 min-h-0 overflow-y-auto">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => openSection(tab.id)}
                aria-label={
                  tab.id === 'about' && hasPendingUpdate ? 'About (update available)' : undefined
                }
                className="flex w-full items-center gap-3 text-left text-[15px] font-medium focus-ring"
                style={{
                  minHeight: '48px',
                  padding: '0 16px',
                  borderBottom: '1px solid var(--border-muted)',
                  color: 'var(--text-primary)',
                }}
              >
                {tab.icon}
                <span className="flex-1 min-w-0 truncate">{tab.label}</span>
                {tab.id === 'about' && hasPendingUpdate && (
                  <span
                    aria-hidden="true"
                    className="settings-update-dot"
                    style={{
                      width: '7px',
                      height: '7px',
                      backgroundColor: 'var(--update-dot)',
                    }}
                  />
                )}
                <ChevronRight aria-hidden="true" className="w-4 h-4 flex-shrink-0" />
              </button>
            ))}
          </nav>
        )}
      </DialogSurface>
    </div>
  );
}
