import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from '@/stores/settingsStore';
import { useThemeStore } from '@/stores/themeStore';
import { CollapsibleSection } from './CollapsibleSection';

describe('CollapsibleSection', () => {
  it('removes collapsed content from keyboard navigation', () => {
    const { rerender } = render(
      <CollapsibleSection title="Notes" isCollapsed onToggle={vi.fn()}>
        <button>Hidden action</button>
      </CollapsibleSection>
    );

    expect(screen.queryByRole('button', { name: 'Hidden action' })).not.toBeInTheDocument();

    rerender(
      <CollapsibleSection title="Notes" isCollapsed={false} onToggle={vi.fn()}>
        <button>Hidden action</button>
      </CollapsibleSection>
    );

    expect(screen.getByRole('button', { name: 'Hidden action' })).toBeInTheDocument();
  });

  afterEach(() => {
    useThemeStore.setState({ preset: 'default' });
    useSettingsStore.setState({ showSeasonalTouches: true });
  });

  it('draws the section icon only with the Autumn theme and seasonal touches on', () => {
    const section = (
      <CollapsibleSection title="Folders" isCollapsed={false} onToggle={vi.fn()}>
        <span />
      </CollapsibleSection>
    );
    const { container, rerender } = render(section);
    expect(container.querySelector('.seasonal-section-icon')).toBeNull();

    useThemeStore.setState({ preset: 'autumn' });
    rerender(section);
    expect(container.querySelector('.seasonal-section-icon')).not.toBeNull();

    useSettingsStore.setState({ showSeasonalTouches: false });
    rerender(section);
    expect(container.querySelector('.seasonal-section-icon')).toBeNull();
  });
});
