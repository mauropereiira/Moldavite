import { fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from '@/stores';
import { AppearanceSection } from './sections/AppearanceSection';
import { LayoutSection } from './sections/LayoutSection';

describe('Settings toggles', () => {
  beforeEach(() => useSettingsStore.getState().resetToDefaults());

  // A switch is named by the words beside it, so a screen reader and the eye
  // agree on what it is.
  it('names every switch after the label on its row', () => {
    const { container } = render(
      <>
        <AppearanceSection
          theme="light"
          onThemeChange={vi.fn()}
          preset="default"
          onPresetChange={vi.fn()}
        />
        <LayoutSection />
      </>
    );
    container.querySelectorAll<HTMLElement>('.settings-fold-toggle').forEach((fold) => {
      fireEvent.click(fold);
    });

    const switches = container.querySelectorAll('[role="switch"]');
    expect(switches.length).toBeGreaterThan(10);
    for (const control of switches) {
      const row = control.closest('.settings-row');
      expect(control.getAttribute('aria-label')).toBe(
        row?.querySelector('.settings-row-label > span')?.textContent
      );
    }
  });
});
