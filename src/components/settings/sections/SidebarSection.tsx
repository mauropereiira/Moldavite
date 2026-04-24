/**
 * SidebarSection — Sidebar visibility, note sort order, and panel widths.
 */

import { useSettingsStore } from '@/stores';
import { InfoTooltip, Toggle } from '../common';

export function SidebarSection() {
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
