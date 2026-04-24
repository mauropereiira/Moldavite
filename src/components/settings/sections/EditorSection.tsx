/**
 * EditorSection — Editor defaults, formatting, and writing assistance.
 */

import { useSettingsStore } from '@/stores';
import { Toggle } from '../common';

export function EditorSection() {
  const settings = useSettingsStore();
  return (
    <div className="space-y-6">
      {/* Note Defaults Section */}
      <div className="p-4 space-y-4" style={{ backgroundColor: 'var(--bg-panel)', borderRadius: 'var(--radius-md)' }}>
        <div>
          <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            Default Note Type
          </h3>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            What type of note to create by default
          </p>
        </div>
        <div className="flex gap-2">
          {(['daily', 'standalone'] as const).map((type) => (
            <button
              key={type}
              onClick={() => settings.setDefaultNoteType(type)}
              className="px-3 py-1.5 text-sm font-medium transition-colors"
              style={{
                backgroundColor: settings.defaultNoteType === type ? 'var(--accent-primary)' : 'var(--bg-elevated)',
                color: settings.defaultNoteType === type ? 'white' : 'var(--text-secondary)',
                border: settings.defaultNoteType === type ? 'none' : '1px solid var(--border-default)',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              {type.charAt(0).toUpperCase() + type.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Formatting Section */}
      <div className="p-4 space-y-4" style={{ backgroundColor: 'var(--bg-panel)', borderRadius: 'var(--radius-md)' }}>
        <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          Formatting
        </h3>

        <div>
          <label className="text-xs mb-2 block" style={{ color: 'var(--text-tertiary)' }}>
            Line Height
          </label>
          <div className="flex gap-2">
            {(['comfortable', 'compact'] as const).map((height) => (
              <button
                key={height}
                onClick={() => settings.setLineHeight(height)}
                className="px-3 py-1.5 text-sm font-medium transition-colors"
                style={{
                  backgroundColor: settings.lineHeight === height ? 'var(--accent-primary)' : 'var(--bg-elevated)',
                  color: settings.lineHeight === height ? 'white' : 'var(--text-secondary)',
                  border: settings.lineHeight === height ? 'none' : '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                {height.charAt(0).toUpperCase() + height.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Writing Assistance Section */}
      <div className="p-4 space-y-1" style={{ backgroundColor: 'var(--bg-panel)', borderRadius: 'var(--radius-md)' }}>
        <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>
          Writing Assistance
        </h3>

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
          />
        </div>

        <div className="flex items-center justify-between py-2" style={{ borderTop: '1px solid var(--border-muted)' }}>
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
          />
        </div>

        <div className="flex items-center justify-between py-2" style={{ borderTop: '1px solid var(--border-muted)' }}>
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
          />
        </div>

        <div className="flex items-center justify-between py-2" style={{ borderTop: '1px solid var(--border-muted)' }}>
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
          />
        </div>
      </div>
    </div>
  );
}
