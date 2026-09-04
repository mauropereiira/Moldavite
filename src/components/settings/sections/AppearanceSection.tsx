/**
 * AppearanceSection — Theme, typography, and layout preferences.
 */

import { useSettingsStore, applyFontFamily, PRESETS } from '@/stores';
import type { BaseMode, FontFamily, FontSize, ThemePreset } from '@/stores';
import { InfoTooltip, SectionHeading, SegmentedControl, Toggle } from '../common';
import { formatShortcut } from '@/lib/shortcuts';

const THEME_OPTIONS: ReadonlyArray<{ value: BaseMode; label: string }> = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

const FONT_SIZE_OPTIONS: ReadonlyArray<{ value: FontSize; label: string }> = [
  { value: 'small', label: 'S' },
  { value: 'medium', label: 'M' },
  { value: 'large', label: 'L' },
  { value: 'extra-large', label: 'XL' },
];

export interface AppearanceSectionProps {
  theme: 'light' | 'dark' | 'system';
  onThemeChange: (theme: 'light' | 'dark' | 'system') => void;
  preset: ThemePreset;
  onPresetChange: (preset: ThemePreset) => void;
}

export function AppearanceSection({
  theme,
  onThemeChange,
  preset,
  onPresetChange,
}: AppearanceSectionProps) {
  const settings = useSettingsStore();
  return (
    <div className="space-y-6">
      <section className="settings-section">
        <div>
          <div className="flex items-center gap-1">
            <SectionHeading>Theme</SectionHeading>
            <InfoTooltip text="Light for daytime, Dark for nighttime. System follows your macOS appearance setting." />
          </div>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            Choose your preferred color scheme
          </p>
        </div>
        <SegmentedControl
          ariaLabel="Theme"
          value={theme}
          onChange={onThemeChange}
          options={THEME_OPTIONS}
        />
      </section>

      <section className="settings-section">
        <div>
          <div className="flex items-center gap-1">
            <SectionHeading>Color preset</SectionHeading>
            <InfoTooltip text="Curated palettes layered on top of your light/dark choice. Some presets are designed for one mode only and fall back to Moldavite otherwise." />
          </div>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            Pick a palette for the editor and chrome
          </p>
        </div>
        <div
          role="radiogroup"
          aria-label="Color preset"
          className="grid gap-2"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}
        >
          {PRESETS.map((p) => {
            const selected = preset === p.id;
            const badge =
              p.coverage === 'dark' ? 'Dark only' : p.coverage === 'light' ? 'Light only' : null;
            return (
              <button
                key={p.id}
                role="radio"
                aria-checked={selected}
                onClick={() => onPresetChange(p.id)}
                className="settings-preset-option text-left p-3 transition-colors flex flex-col gap-2"
                style={{
                  border: '1px solid var(--border-default)',
                  borderLeft: `2px solid ${selected ? 'var(--text-primary)' : 'transparent'}`,
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {p.label}
                  </span>
                  {badge && (
                    <span
                      className="text-[10px] px-1.5 py-0.5"
                      style={{
                        color: 'var(--text-tertiary)',
                      }}
                    >
                      {badge}
                    </span>
                  )}
                </div>
                <div className="flex gap-1">
                  {(['bg', 'surface', 'accent', 'text', 'border'] as const).map((k) => (
                    <span
                      key={k}
                      aria-hidden
                      className="settings-preset-swatch inline-block"
                      style={{
                        width: 18,
                        height: 18,
                        backgroundColor: p.swatches[k],
                        border: '1px solid var(--border-muted)',
                      }}
                    />
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="settings-section">
        <SectionHeading>Typography</SectionHeading>

        <SegmentedControl
          label="Font Size"
          ariaLabel="Font Size"
          value={settings.fontSize}
          onChange={settings.setFontSize}
          options={FONT_SIZE_OPTIONS}
        />

        <div>
          <label className="text-xs mb-2 block" style={{ color: 'var(--text-tertiary)' }}>
            Font Family
          </label>
          <select
            value={settings.fontFamily}
            onChange={(e) => {
              const family = e.target.value as FontFamily;
              settings.setFontFamily(family);
              applyFontFamily(family);
            }}
            className="settings-input w-full px-0 py-2 text-sm focus:outline-none"
            style={{
              color: 'var(--text-primary)',
            }}
          >
            <optgroup label="System Fonts">
              <option value="system-sans">Sans-serif (System)</option>
              <option value="system-serif">Serif (System)</option>
              <option value="system-mono">Monospace (System)</option>
            </optgroup>
            <optgroup label="Web Fonts">
              <option value="inter">Inter</option>
              <option value="merriweather">Merriweather</option>
            </optgroup>
          </select>
        </div>
      </section>

      <section className="settings-section">
        <SectionHeading>Layout</SectionHeading>

        {/* Sidebar width lives in Settings → Sidebar, gated on the Index
            actually being a pinned column. It was duplicated here, so the same
            control existed in two tabs. */}

        <div
          className="flex items-center justify-between pt-2"
          style={{ borderTop: '1px solid var(--border-muted)' }}
        >
          <div>
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Compact Mode
            </span>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Tighter spacing throughout the app
            </p>
          </div>
          <Toggle
            enabled={settings.compactMode}
            onChange={settings.setCompactMode}
            ariaLabel="Use compact mode"
          />
        </div>

        <div
          className="flex items-center justify-between pt-2"
          style={{ borderTop: '1px solid var(--border-muted)' }}
        >
          <div>
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Focus mode
            </span>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Hide every panel at once and leave just the note. {formatShortcut('⌘.')}
            </p>
          </div>
          <Toggle
            enabled={settings.focusModeEnabled}
            onChange={settings.setFocusModeEnabled}
            ariaLabel="Enable focus mode"
          />
        </div>
      </section>
    </div>
  );
}
