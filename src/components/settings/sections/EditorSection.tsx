/**
 * EditorSection — Editor defaults, formatting, and writing assistance.
 */

import { useSettingsStore } from '@/stores';
import { SectionHeading, SegmentedControl, Toggle } from '../common';

const NOTE_TYPE_OPTIONS = [
  { value: 'daily', label: 'Daily' },
  { value: 'standalone', label: 'Standalone' },
] as const;

const LINE_HEIGHT_OPTIONS = [
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'compact', label: 'Compact' },
] as const;

export function EditorSection() {
  const settings = useSettingsStore();
  return (
    <div className="space-y-6">
      <section className="settings-section">
        <div>
          <SectionHeading>Default Note Type</SectionHeading>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            What type of note to create by default
          </p>
        </div>
        <SegmentedControl
          ariaLabel="Default Note Type"
          value={settings.defaultNoteType}
          onChange={settings.setDefaultNoteType}
          options={NOTE_TYPE_OPTIONS}
        />
      </section>

      {/* Formatting Section */}
      <section className="settings-section">
        <SectionHeading>Formatting</SectionHeading>
        <SegmentedControl
          label="Line Height"
          ariaLabel="Line Height"
          value={settings.lineHeight}
          onChange={settings.setLineHeight}
          options={LINE_HEIGHT_OPTIONS}
        />
      </section>

      {/* Writing Assistance Section */}
      <section className="settings-section space-y-1">
        <SectionHeading>Writing Assistance</SectionHeading>

        <div className="flex items-center justify-between py-2">
          <div>
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Spell Check
            </span>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Underline spelling errors
            </p>
          </div>
          <Toggle
            enabled={settings.spellCheck}
            onChange={settings.setSpellCheck}
            ariaLabel="Enable spell check"
          />
        </div>

        <div
          className="flex items-center justify-between py-2"
          style={{ borderTop: '1px solid var(--border-muted)' }}
        >
          <div>
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Auto-capitalize
            </span>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Capitalize first letter of sentences
            </p>
          </div>
          <Toggle
            enabled={settings.autoCapitalize}
            onChange={settings.setAutoCapitalize}
            ariaLabel="Enable auto-capitalization"
          />
        </div>

        <div
          className="flex items-center justify-between py-2"
          style={{ borderTop: '1px solid var(--border-muted)' }}
        >
          <div>
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Show Word Count
            </span>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Display word count at bottom of editor
            </p>
          </div>
          <Toggle
            enabled={settings.showWordCount}
            onChange={settings.setShowWordCount}
            ariaLabel="Show word count"
          />
        </div>

        <div
          className="flex items-center justify-between py-2"
          style={{ borderTop: '1px solid var(--border-muted)' }}
        >
          <div>
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Tags (#hashtags)
            </span>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Highlight #tags and show in sidebar
            </p>
          </div>
          <Toggle
            enabled={settings.tagsEnabled}
            onChange={settings.setTagsEnabled}
            ariaLabel="Enable tags"
          />
        </div>
      </section>
    </div>
  );
}
