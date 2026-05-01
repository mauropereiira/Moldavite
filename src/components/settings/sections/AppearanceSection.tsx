/**
 * AppearanceSection — Theme, typography, and layout preferences.
 */

import { useSettingsStore, applyFontFamily, PRESETS } from '@/stores';
import type { FontFamily, ThemePreset } from '@/stores';
import { InfoTooltip, Toggle } from '../common';

export interface AppearanceSectionProps {
  theme: 'light' | 'dark' | 'system';
  onThemeChange: (theme: 'light' | 'dark' | 'system') => void;
  preset: ThemePreset;
  onPresetChange: (preset: ThemePreset) => void;
}

export function AppearanceSection({ theme, onThemeChange, preset, onPresetChange }: AppearanceSectionProps) {
  const settings = useSettingsStore();
  return (
    <div className="space-y-6">
      {/* Theme Section */}
      <div className="p-4 space-y-4" style={{ backgroundColor: 'var(--bg-panel)', borderRadius: 'var(--radius-md)' }}>
        <div>
          <div className="flex items-center gap-1">
            <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              Theme
            </h3>
            <InfoTooltip text="Light for daytime, Dark for nighttime. System follows your macOS appearance setting." />
          </div>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            Choose your preferred color scheme
          </p>
        </div>
        <div className="flex gap-2">
          {(['light', 'dark', 'system'] as const).map((t) => (
            <button
              key={t}
              onClick={() => onThemeChange(t)}
              className="px-3 py-1.5 text-sm font-medium transition-colors"
              style={{
                backgroundColor: theme === t ? 'var(--accent-primary)' : 'var(--bg-elevated)',
                color: theme === t ? 'white' : 'var(--text-secondary)',
                border: theme === t ? 'none' : '1px solid var(--border-default)',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Color Preset Section */}
      <div className="p-4 space-y-4" style={{ backgroundColor: 'var(--bg-panel)', borderRadius: 'var(--radius-md)' }}>
        <div>
          <div className="flex items-center gap-1">
            <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              Color preset
            </h3>
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
              p.coverage === 'dark'
                ? 'Dark only'
                : p.coverage === 'light'
                ? 'Light only'
                : null;
            return (
              <button
                key={p.id}
                role="radio"
                aria-checked={selected}
                onClick={() => onPresetChange(p.id)}
                className="text-left p-3 transition-colors flex flex-col gap-2"
                style={{
                  backgroundColor: 'var(--bg-elevated)',
                  border: selected
                    ? '2px solid var(--accent-primary)'
                    : '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-sm)',
                  // Compensate the 1px-vs-2px border difference so cards don't jump.
                  padding: selected ? 'calc(0.75rem - 1px)' : '0.75rem',
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
                        backgroundColor: 'var(--bg-inset)',
                        color: 'var(--text-tertiary)',
                        borderRadius: 'var(--radius-sm)',
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
                      className="inline-block"
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: 4,
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
      </div>

      {/* Typography Section */}
      <div className="p-4 space-y-4" style={{ backgroundColor: 'var(--bg-panel)', borderRadius: 'var(--radius-md)' }}>
        <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          Typography
        </h3>

        <div>
          <label className="text-xs mb-2 block" style={{ color: 'var(--text-tertiary)' }}>
            Font Size
          </label>
          <div className="flex gap-2">
            {([
              { value: 'small', label: 'S' },
              { value: 'medium', label: 'M' },
              { value: 'large', label: 'L' },
              { value: 'extra-large', label: 'XL' },
            ] as const).map((size) => (
              <button
                key={size.value}
                onClick={() => settings.setFontSize(size.value)}
                className="px-3 py-1.5 text-sm font-medium transition-colors"
                style={{
                  backgroundColor: settings.fontSize === size.value ? 'var(--accent-primary)' : 'var(--bg-elevated)',
                  color: settings.fontSize === size.value ? 'white' : 'var(--text-secondary)',
                  border: settings.fontSize === size.value ? 'none' : '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                {size.label}
              </button>
            ))}
          </div>
        </div>

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
            className="w-full px-3 py-2 text-sm focus:outline-none focus:ring-2"
            style={{
              backgroundColor: 'var(--bg-elevated)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-sm)',
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
      </div>

      {/* Layout Section */}
      <div className="p-4 space-y-4" style={{ backgroundColor: 'var(--bg-panel)', borderRadius: 'var(--radius-md)' }}>
        <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          Layout
        </h3>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Sidebar Width
            </label>
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
          <div className="flex justify-between text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            <span>Narrow</span>
            <span>Wide</span>
          </div>
        </div>

        <div className="flex items-center justify-between pt-2" style={{ borderTop: '1px solid var(--border-muted)' }}>
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
          />
        </div>
      </div>
    </div>
  );
}
