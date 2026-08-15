import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore, type BaseMode, type ThemePreset } from '@/stores';
import { AppearanceSection } from './sections/AppearanceSection';

function AppearanceHarness() {
  const [theme, setTheme] = useState<BaseMode>('light');
  const [preset, setPreset] = useState<ThemePreset>('default');

  return (
    <AppearanceSection
      theme={theme}
      onThemeChange={setTheme}
      preset={preset}
      onPresetChange={setPreset}
    />
  );
}

describe('Settings Cream controls', () => {
  beforeEach(() => {
    useSettingsStore.getState().resetToDefaults();
    vi.clearAllMocks();
  });

  it('renders Theme and Font Size as radio-style segmented controls and preserves changes', () => {
    render(<AppearanceHarness />);

    const themeGroup = screen.getByRole('radiogroup', { name: 'Theme' });
    const light = screen.getByRole('radio', { name: 'Light' });
    const dark = screen.getByRole('radio', { name: 'Dark' });
    expect(themeGroup).toContainElement(light);
    expect(light).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(dark);
    expect(dark).toHaveAttribute('aria-checked', 'true');
    expect(light).toHaveAttribute('aria-checked', 'false');

    const fontSizeGroup = screen.getByRole('radiogroup', { name: 'Font Size' });
    const extraLarge = screen.getByRole('radio', { name: 'XL' });
    expect(fontSizeGroup).toContainElement(extraLarge);

    fireEvent.click(extraLarge);
    expect(extraLarge).toHaveAttribute('aria-checked', 'true');
    expect(useSettingsStore.getState().fontSize).toBe('extra-large');
  });

  it('contains no literal white or black colour values in Settings components', () => {
    const { container } = render(<AppearanceHarness />);
    const violations = Array.from(container.querySelectorAll<HTMLElement>('[style]'))
      .map((element) => element.getAttribute('style') ?? '')
      .filter((style) =>
        /(?:^|;)\s*(?:color|background-color|border(?:-color)?|fill|stroke)\s*:\s*(?:white|black)\b/i.test(
          style
        )
      );

    expect(violations).toEqual([]);
  });
});
