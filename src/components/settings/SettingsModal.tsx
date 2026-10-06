/**
 * Settings.
 *
 * On a desktop it is a full page beside the icon rail: grouped navigation
 * (Basics, Connections, Your data) with a search box on the left, and the
 * chosen tab on the right under a large title. On a phone
 * (`isMobilePlatform()`) it is a two-level page: the grouped list with the same
 * search, then one tab with a back control. See `MobileSettingsPage` below.
 *
 * What each tab holds, and the label and (i) text of every setting, is in
 * `settingsMap.ts`; each tab's controls live in its own file under
 * `./sections/`. Shared rows, groups and controls live under `./common/`.
 *
 * All IPC calls are routed through `safeInvoke` from `@/lib/ipc` via the
 * wrapper modules in `@/lib`; no section calls Tauri's raw `invoke`.
 *
 * @module components/settings/SettingsModal
 */

import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  useSettingsStore,
  useThemeStore,
  useUpdateStore,
  selectHasPendingUpdate,
  applyTheme,
  resolveSettingsTarget,
  type SettingsTab,
  type SettingsTarget,
} from '@/stores';
import { DialogSurface } from '@/components/ui/DialogSurface';
import { isMobilePlatform } from '@/lib/platform';
import {
  Bot,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Database,
  Info,
  Palette,
  PanelsTopLeft,
  Puzzle,
  Settings,
  Type,
} from 'lucide-react';
import { SettingsData } from './SettingsData';
import { AboutSection } from './sections/AboutSection';
import { AppearanceSection } from './sections/AppearanceSection';
import { CalendarSection } from './sections/CalendarSection';
import { GeneralSection } from './sections/GeneralSection';
import { PluginsSection } from './sections/PluginsSection';
import { AgentsSection } from './sections/AgentsSection';
import { LayoutSection } from './sections/LayoutSection';
import { WritingSection } from './sections/WritingSection';
import { InfoTooltip } from './common';
import { searchSettings, settingsTab, visibleTabs, type SettingsTabSpec } from './settingsMap';
import { JACK_O_LANTERN_SMALL_SRC, useSeasonalTouches } from '@/lib/seasons';
import { MaskArt } from '@/components/ui/MaskArt';
import { CloseButton } from '@/components/ui/CloseButton';

const AUTUMN_PUMPKIN = (
  <MaskArt src={JACK_O_LANTERN_SMALL_SRC} className="size-[22px]" label="Happy autumn" />
);

const ICON = { className: 'w-4 h-4', strokeWidth: 1.25, 'aria-hidden': true } as const;
const TAB_ICONS: Record<SettingsTab, React.ReactNode> = {
  general: <Settings {...ICON} />,
  appearance: <Palette {...ICON} />,
  layout: <PanelsTopLeft {...ICON} />,
  writing: <Type {...ICON} />,
  calendar: <Calendar {...ICON} />,
  agents: <Bot {...ICON} />,
  plugins: <Puzzle {...ICON} />,
  data: <Database {...ICON} />,
  about: <Info {...ICON} />,
};

const NAV_GROUPS = ['Basics', 'Connections', 'Your data'] as const;

function TabContent({ tab }: { tab: SettingsTab }) {
  const { theme, setTheme, preset, setPreset } = useThemeStore();
  switch (tab) {
    case 'general':
      return <GeneralSection />;
    case 'appearance':
      return (
        <AppearanceSection
          theme={theme}
          onThemeChange={(next) => {
            setTheme(next);
            applyTheme(next, preset);
          }}
          preset={preset}
          onPresetChange={(next) => {
            setPreset(next);
            applyTheme(theme, next);
          }}
        />
      );
    case 'layout':
      return <LayoutSection />;
    case 'writing':
      return <WritingSection />;
    case 'calendar':
      return <CalendarSection />;
    case 'agents':
      return <AgentsSection />;
    case 'plugins':
      return <PluginsSection />;
    case 'data':
      return <SettingsData />;
    case 'about':
      return <AboutSection />;
  }
}

/**
 * Opens the fold holding the setting a search result or an old tab id points
 * at (see `Group`), then scrolls to it, marks it briefly and focuses its
 * control.
 */
function useScrollToAnchor(bodyRef: RefObject<HTMLElement | null>, tab: SettingsTab | null) {
  const anchor = useSettingsStore((state) => state.settingsAnchor);
  useEffect(() => {
    if (!anchor) return;
    const frame = requestAnimationFrame(() => {
      useSettingsStore.getState().setSettingsAnchor(null);
      const target = bodyRef.current?.querySelector<HTMLElement>(`[data-setting="${anchor}"]`);
      if (!target) return;
      target.scrollIntoView?.({ block: 'center' });
      target.classList.add('settings-flash');
      window.setTimeout(() => target.classList.remove('settings-flash'), 1600);
      target
        .querySelector<HTMLElement>('.settings-row-control :is(button, input, select)')
        ?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [anchor, tab, bodyRef]);
}

function SearchBox({
  query,
  onChange,
  onSubmit,
}: {
  query: string;
  onChange: (query: string) => void;
  onSubmit: () => void;
}) {
  return (
    <input
      type="search"
      className="settings-search"
      placeholder="Search settings"
      aria-label="Search settings"
      value={query}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        // A query clears first; Escape on an empty box closes Settings.
        if (e.key === 'Escape' && query) {
          e.stopPropagation();
          onChange('');
        } else if (e.key === 'Enter') {
          onSubmit();
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          document.querySelector<HTMLElement>('.settings-result')?.focus();
        }
      }}
    />
  );
}

function SearchResults({
  query,
  mobile,
  onPick,
}: {
  query: string;
  mobile: boolean;
  onPick: (target: SettingsTarget) => void;
}) {
  const results = searchSettings(query, mobile);
  const move = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('.settings-result'));
    const index = items.indexOf(document.activeElement as HTMLElement);
    items[
      Math.max(0, Math.min(items.length - 1, index + (e.key === 'ArrowDown' ? 1 : -1)))
    ]?.focus();
  };
  return (
    <div className="settings-results">
      <p className="settings-row-note" role="status">
        {results.length === 0
          ? `No settings match "${query.trim()}".`
          : `${results.length} ${results.length === 1 ? 'setting' : 'settings'}`}
      </p>
      <ul onKeyDown={move}>
        {results.map(({ item, tab, group }) => (
          <li key={item.id}>
            <button
              type="button"
              className="settings-result"
              onClick={() => onPick(`${tab.id}#${item.id}`)}
            >
              <span>{item.label}</span>
              <span className="settings-result-path">
                {item === group ? tab.label : `${tab.label} › ${group.label}`}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function UpdateDot() {
  return <span aria-hidden="true" className="settings-update-dot" />;
}

const navLabel = (tab: SettingsTabSpec, hasPendingUpdate: boolean) =>
  tab.id === 'about' && hasPendingUpdate ? 'About (update available)' : undefined;

export function SettingsModal() {
  const isOpen = useSettingsStore((state) => state.isSettingsOpen);
  if (!isOpen) return null;
  return isMobilePlatform() ? <MobileSettingsPage /> : <DesktopSettingsPage />;
}

function DesktopSettingsPage() {
  const activeSettingsTab = useSettingsStore((state) => state.activeSettingsTab);
  const setActiveTab = useSettingsStore((state) => state.setActiveSettingsTab);
  const close = () => useSettingsStore.getState().setIsSettingsOpen(false);
  const hasPendingUpdate = useUpdateStore(selectHasPendingUpdate);
  const season = useSeasonalTouches();
  const [query, setQuery] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);
  const tabs = visibleTabs(false);
  const active = settingsTab(resolveSettingsTarget(activeSettingsTab).tab);
  const searching = query.trim() !== '';
  useScrollToAnchor(bodyRef, active.id);

  const pick = (target: SettingsTarget) => {
    setQuery('');
    setActiveTab(target);
    bodyRef.current?.scrollTo?.({ top: 0 });
  };

  return (
    <div className="settings-scrim fixed inset-0 z-[var(--z-surface)] modal-backdrop-enter">
      <DialogSurface
        onEscape={close}
        className="settings-dialog settings-page modal-content-enter"
        aria-labelledby="settings-modal-title"
      >
        <nav className="settings-nav" aria-label="Settings sections">
          <h2 id="settings-modal-title" className="settings-nav-title">
            Settings
          </h2>
          <SearchBox
            query={query}
            onChange={setQuery}
            onSubmit={() => {
              const [first] = searchSettings(query, false);
              if (first) pick(`${first.tab.id}#${first.item.id}`);
            }}
          />
          {NAV_GROUPS.map((group) => (
            <div key={group} role="group" aria-label={group} className="settings-nav-group">
              <p aria-hidden="true" className="settings-nav-label">
                {group}
              </p>
              {tabs
                .filter((tab) => tab.nav === group)
                .map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    className="settings-nav-link"
                    aria-current={!searching && tab.id === active.id ? 'page' : undefined}
                    aria-label={navLabel(tab, hasPendingUpdate)}
                    onClick={() => pick(tab.id)}
                  >
                    {TAB_ICONS[tab.id]}
                    <span>{tab.label}</span>
                    {tab.id === 'about' && hasPendingUpdate && <UpdateDot />}
                  </button>
                ))}
            </div>
          ))}
          {season === 'autumn' && (
            <div className="mt-auto px-3 pt-4" style={{ color: 'var(--text-muted)' }}>
              {AUTUMN_PUMPKIN}
            </div>
          )}
        </nav>

        <div
          ref={bodyRef}
          id={`settings-panel-${active.id}`}
          role="region"
          aria-labelledby={searching ? 'settings-modal-title' : 'settings-page-title'}
          className="settings-body"
        >
          <CloseButton onClick={close} label="Close settings" className="absolute top-4 right-4" />
          <div key={searching ? 'search' : active.id} className="settings-column tab-content-enter">
            {searching ? (
              <SearchResults query={query} mobile={false} onPick={pick} />
            ) : (
              <>
                <header className="settings-page-head">
                  <div className="flex items-center gap-1">
                    <h1 id="settings-page-title">{active.label}</h1>
                    {active.info && <InfoTooltip label={active.label} text={active.info} />}
                  </div>
                  <p>{active.blurb}</p>
                </header>
                <TabContent tab={active.id} />
              </>
            )}
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
 * the section list every time: closing Settings forgets the open section, so
 * it never reopens on a remembered tab.
 *
 * The list is a `<nav>` of plain buttons in the same groups as the desktop.
 */
function MobileSettingsPage() {
  const season = useSeasonalTouches();
  const hasPendingUpdate = useUpdateStore(selectHasPendingUpdate);
  // In the store rather than local state so the rail's Settings button can
  // walk back to the list from a section.
  const sectionId = useSettingsStore((state) => state.settingsSection);
  const setSection = useSettingsStore((state) => state.setSettingsSection);
  const close = () => useSettingsStore.getState().setIsSettingsOpen(false);
  const [query, setQuery] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);
  const tabs = visibleTabs(true);
  const section =
    sectionId === null
      ? null
      : (tabs.find((tab) => tab.id === resolveSettingsTarget(sectionId).tab) ?? null);
  useScrollToAnchor(bodyRef, section?.id ?? null);

  const open = (target: SettingsTarget) => {
    setQuery('');
    setSection(target);
  };

  return (
    // Spans the rail's column too; the rail paints above it.
    <div
      className="settings-scrim fixed inset-0 z-[var(--z-surface)] modal-backdrop-enter"
      style={{ background: 'var(--bg-base)' }}
    >
      {/* iOS zooms into any field under 16px on focus, and a phone needs a
          thumb-sized button; the sections are shared with desktop, so both
          are imposed from here rather than in every section. Switches keep
          their own size. */}
      <DialogSurface
        onEscape={close}
        className="settings-dialog flex h-full flex-col [&_input]:text-[16px] [&_select]:text-[16px] [&_textarea]:text-[16px] [&_button:not([role=switch])]:min-h-10"
        style={{
          marginLeft: 'var(--rail-inset-left)',
          marginRight: 'var(--rail-inset-right)',
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
            paddingLeft: `calc(${section ? '4px' : 'var(--mobile-page-inset)'} + var(--page-safe-left))`,
            paddingRight: 'calc(4px + var(--page-safe-right))',
            borderBottom: '1px solid var(--border-default)',
          }}
        >
          {section && (
            <button
              type="button"
              onClick={() => setSection(null)}
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
          <CloseButton onClick={close} label="Close settings" />
        </header>

        {section ? (
          <div
            ref={bodyRef}
            id={`settings-panel-${section.id}`}
            role="region"
            aria-labelledby="settings-modal-title"
            className="settings-body flex-1 min-h-0 min-w-0 overflow-y-auto"
            style={{
              padding:
                '16px calc(16px + var(--page-safe-right)) 20px calc(16px + var(--page-safe-left))',
            }}
          >
            <div key={section.id} className="tab-content-enter">
              <TabContent tab={section.id} />
            </div>
          </div>
        ) : (
          <nav aria-label="Settings sections" className="flex-1 min-h-0 overflow-y-auto">
            <div className="settings-phone-search">
              <SearchBox
                query={query}
                onChange={setQuery}
                onSubmit={() => {
                  const [first] = searchSettings(query, true);
                  if (first) open(`${first.tab.id}#${first.item.id}`);
                }}
              />
            </div>
            {query.trim() ? (
              <SearchResults query={query} mobile onPick={open} />
            ) : (
              NAV_GROUPS.map((group) => (
                <div key={group} role="group" aria-label={group}>
                  <p aria-hidden="true" className="settings-nav-label settings-phone-label">
                    {group}
                  </p>
                  {tabs
                    .filter((tab) => tab.nav === group)
                    .map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => open(tab.id)}
                        aria-label={navLabel(tab, hasPendingUpdate)}
                        className="flex w-full items-center gap-3 text-left text-[15px] font-medium focus-ring"
                        style={{
                          minHeight: '48px',
                          padding:
                            '0 calc(16px + var(--page-safe-right)) 0 calc(16px + var(--page-safe-left))',
                          borderBottom: '1px solid var(--border-muted)',
                          color: 'var(--text-primary)',
                        }}
                      >
                        {TAB_ICONS[tab.id]}
                        <span className="flex-1 min-w-0 truncate">{tab.label}</span>
                        {tab.id === 'about' && hasPendingUpdate && <UpdateDot />}
                        <ChevronRight aria-hidden="true" className="w-4 h-4 flex-shrink-0" />
                      </button>
                    ))}
                </div>
              ))
            )}
            {season === 'autumn' && !query.trim() && (
              <div className="flex justify-center py-6" style={{ color: 'var(--text-muted)' }}>
                {AUTUMN_PUMPKIN}
              </div>
            )}
          </nav>
        )}
      </DialogSurface>
    </div>
  );
}
