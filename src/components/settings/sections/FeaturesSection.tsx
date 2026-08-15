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
      <div
        className="p-4 space-y-1"
        style={{ backgroundColor: 'transparent', borderRadius: 'var(--radius-md)' }}
      >
        <div className="flex items-center gap-1 mb-3">
          <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            Editor Features
          </h3>
          <InfoTooltip text="Enable or disable special editing features. Disabling features you don't use can simplify the interface." />
        </div>

        <div className="flex items-center justify-between py-2">
          <div className="flex items-center gap-1">
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Tags (#hashtags)
            </span>
            <InfoTooltip text="Type #tagname to create tags. Tags are highlighted and can be filtered in the sidebar." />
          </div>
          <Toggle enabled={settings.tagsEnabled} onChange={settings.setTagsEnabled} />
        </div>
      </div>

      {/* Navigation Features */}
      <div
        className="p-4 space-y-1"
        style={{ backgroundColor: 'transparent', borderRadius: 'var(--radius-md)' }}
      >
        <div className="flex items-center gap-1 mb-3">
          <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            Navigation
          </h3>
          <InfoTooltip text="Ways to quickly find and navigate between your notes." />
        </div>

        <div className="flex items-center justify-between py-2">
          <div className="flex items-center gap-1">
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Backlinks
            </span>
            <InfoTooltip text="Shows a list of all notes that link to the current note. Helps you see connections between ideas." />
          </div>
          <Toggle enabled={settings.backlinksEnabled} onChange={settings.setBacklinksEnabled} />
        </div>
      </div>

      {/* Agenda */}
      <div
        className="p-4 space-y-1"
        style={{ backgroundColor: 'transparent', borderRadius: 'var(--radius-md)' }}
      >
        <div className="flex items-center gap-1 mb-3">
          <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            Agenda
          </h3>
          <InfoTooltip text="Choose which calendar surfaces appear in the Agenda overlay and pinned right panel." />
        </div>

        <div
          className="flex items-center justify-between py-2"
          style={{ borderTop: '1px solid var(--border-muted)' }}
        >
          <div className="flex items-center gap-1">
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Calendar Widget
            </span>
            <InfoTooltip text="A month calendar with daily and weekly note navigation." />
          </div>
          <Toggle enabled={settings.showCalendarWidget} onChange={settings.setShowCalendarWidget} />
        </div>

        <div
          className="flex items-center justify-between py-2"
          style={{ borderTop: '1px solid var(--border-muted)' }}
        >
          <div className="flex items-center gap-1">
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Timeline Widget
            </span>
            <InfoTooltip text="Shows your daily schedule with events from Apple Calendar or Google Calendar (connect a source in Settings → Calendar)." />
          </div>
          <Toggle enabled={settings.showTimelineWidget} onChange={settings.setShowTimelineWidget} />
        </div>
      </div>
    </div>
  );
}
