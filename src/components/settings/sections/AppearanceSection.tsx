/**
 * AppearanceSection: theme and colour preset, text and spacing, and the home
 * screen's decorations folded at the bottom.
 */

import { useSettingsStore, applyFontFamily, PRESETS } from '@/stores';
import type { BaseMode, FontFamily, FontSize, LineHeight, ThemePreset } from '@/stores';
import { isMobilePlatform } from '@/lib/platform';
import { Group, Row, SegmentedControl, ToggleRow, label } from '../common';

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

const LINE_HEIGHT_OPTIONS: ReadonlyArray<{ value: LineHeight; label: string }> = [
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'compact', label: 'Compact' },
];

type HomeSetting =
  | 'showWelcomeDots'
  | 'showWelcomeStats'
  | 'showWelcomeDate'
  | 'showAsteroidCursor'
  | 'showSeasonalTouches';

const HOME_CONTROLS: ReadonlyArray<[string, HomeSetting]> = [
  ['constellations', 'showWelcomeDots'],
  ['live-counts', 'showWelcomeStats'],
  ['welcome-date', 'showWelcomeDate'],
  ['asteroid-cursor', 'showAsteroidCursor'],
  ['seasonal', 'showSeasonalTouches'],
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
  // A phone has no pointer for the asteroid cursor; `WelcomeScreen` skips it on
  // coarse pointers anyway.
  const mobile = isMobilePlatform();
  const isDark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  return (
    <div className="settings-tab">
      <Group id="theme">
        <Row id="mode">
          <SegmentedControl
            ariaLabel="Theme"
            value={theme}
            onChange={onThemeChange}
            options={THEME_OPTIONS}
          />
        </Row>
        <Row id="preset" stack>
          <div role="radiogroup" aria-label={label('preset')} className="settings-presets">
            {PRESETS.map((p) => {
              const swatches = isDark ? p.darkSwatches : p.swatches;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={preset === p.id}
                  onClick={() => onPresetChange(p.id)}
                  className="settings-preset-option"
                >
                  <span>{p.label}</span>
                  <span className="flex gap-1">
                    {(['bg', 'surface', 'accent', 'text', 'border'] as const).map((k) => (
                      <span
                        key={k}
                        aria-hidden
                        className="settings-preset-swatch"
                        style={{ backgroundColor: swatches[k] }}
                      />
                    ))}
                  </span>
                </button>
              );
            })}
          </div>
        </Row>
      </Group>

      <Group id="text">
        <Row id="font-size">
          <SegmentedControl
            ariaLabel="Font Size"
            value={settings.fontSize}
            onChange={settings.setFontSize}
            options={FONT_SIZE_OPTIONS}
          />
        </Row>
        <Row id="font">
          <select
            value={settings.fontFamily}
            aria-label={label('font')}
            onChange={(e) => {
              const family = e.target.value as FontFamily;
              settings.setFontFamily(family);
              applyFontFamily(family);
            }}
            className="settings-input"
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
        </Row>
        <Row id="line-height">
          <SegmentedControl
            ariaLabel={label('line-height')}
            value={settings.lineHeight}
            onChange={settings.setLineHeight}
            options={LINE_HEIGHT_OPTIONS}
          />
        </Row>
        <ToggleRow id="compact" value={settings.compactMode} onChange={settings.setCompactMode} />
      </Group>

      <Group id="home">
        {HOME_CONTROLS.filter(([id]) => !mobile || id !== 'asteroid-cursor').map(([id, key]) => (
          <ToggleRow
            key={id}
            id={id}
            value={settings[key]}
            onChange={(value) => useSettingsStore.setState({ [key]: value })}
          />
        ))}
      </Group>
    </div>
  );
}
