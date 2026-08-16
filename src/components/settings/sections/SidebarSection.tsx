/**
 * SidebarSection — Sidebar visibility, note sort order, and panel widths.
 */

import { useSettingsStore } from '@/stores';
import { InfoTooltip, SectionHeading, SegmentedControl, Toggle } from '../common';

const SORT_OPTIONS = [
  { value: 'name-asc', label: 'Name (A-Z)' },
  { value: 'name-desc', label: 'Name (Z-A)' },
  { value: 'modified-desc', label: 'Modified (Newest)' },
  { value: 'modified-asc', label: 'Modified (Oldest)' },
  { value: 'created-desc', label: 'Created (Newest)' },
  { value: 'created-asc', label: 'Created (Oldest)' },
] as const;

export function SidebarSection() {
  const settings = useSettingsStore();
  return (
    <div className="space-y-6">
      {/* Visible Sections */}
      <section className="settings-section space-y-1">
        <div className="flex items-center gap-1 mb-3">
          <SectionHeading>Visible Sections</SectionHeading>
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
            ariaLabel="Show folders section"
          />
        </div>

        <div
          className="flex items-center justify-between py-2"
          style={{ borderTop: '1px solid var(--border-muted)' }}
        >
          <div className="flex items-center gap-1">
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Backlinks Section
            </span>
            <InfoTooltip text="Show backlinks in the sidebar. Requires Backlinks to be enabled in Features." />
          </div>
          <Toggle
            enabled={settings.showBacklinksSection}
            onChange={settings.setShowBacklinksSection}
            ariaLabel="Show backlinks section"
          />
        </div>
      </section>

      {/* Sorting */}
      <section className="settings-section">
        <div>
          <div className="flex items-center gap-1">
            <SectionHeading>Sort Notes By</SectionHeading>
            <InfoTooltip text="Choose how notes are ordered in the sidebar list. Modified sorts by last edit time." />
          </div>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            How notes are ordered in the sidebar
          </p>
        </div>
        <SegmentedControl
          ariaLabel="Sort Notes By"
          value={settings.sortOption}
          onChange={settings.setSortOption}
          options={SORT_OPTIONS}
        />
      </section>

      {/* Layout */}
      <section className="settings-section">
        <div className="flex items-center gap-1">
          <SectionHeading>Layout</SectionHeading>
          <InfoTooltip text="Control the width of sidebars. Wider sidebars show more note titles, narrower gives more editor space." />
        </div>

        {/* Only meaningful when the Index is a pinned column. As an overlay it
            is full-window, and the rail is a fixed 48px — so an ungated slider
            here is a control that silently does nothing. */}
        {settings.indexMode === 'pinned' && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1">
                <label
                  htmlFor="sidebar-width-range"
                  className="text-xs"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  Sidebar Width
                </label>
                <InfoTooltip text="Width of the pinned Index column in pixels. Range: 200px (compact) to 400px (spacious)." />
              </div>
              <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                {settings.sidebarWidth}px
              </span>
            </div>
            <input
              id="sidebar-width-range"
              type="range"
              min="200"
              max="400"
              step="10"
              value={settings.sidebarWidth}
              onChange={(e) => settings.setSidebarWidth(Number(e.target.value))}
              className="settings-range w-full appearance-none cursor-pointer"
            />
          </div>
        )}

        {settings.agendaMode === 'pinned' && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1">
                <label
                  htmlFor="right-panel-width-range"
                  className="text-xs"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  Right Panel Width
                </label>
                <InfoTooltip text="Width of the right panel (calendar/timeline) in pixels. Range: 250px to 500px." />
              </div>
              <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                {settings.rightPanelWidth}px
              </span>
            </div>
            <input
              id="right-panel-width-range"
              type="range"
              min="250"
              max="500"
              step="10"
              value={settings.rightPanelWidth}
              onChange={(e) => settings.setRightPanelWidth(Number(e.target.value))}
              className="settings-range w-full appearance-none cursor-pointer"
            />
          </div>
        )}
      </section>
    </div>
  );
}
