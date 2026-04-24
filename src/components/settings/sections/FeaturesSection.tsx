/**
 * FeaturesSection — Toggle editor features, navigation, and right-panel widgets.
 */

import { useSettingsStore } from '@/stores';
import { InfoTooltip, Toggle } from '../common';

export function FeaturesSection() {
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
