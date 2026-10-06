import { fireEvent, render, screen } from '@testing-library/react';
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

  it('heads the section with a band: toggle, count chip, then the actions', () => {
    const onToggle = vi.fn();
    const { container } = render(
      <CollapsibleSection
        title="Notes"
        count={6}
        isCollapsed={false}
        onToggle={onToggle}
        rightAction={<button>New</button>}
      >
        <span />
      </CollapsibleSection>
    );

    const band = container.querySelector('.section-band');
    const toggle = screen.getByRole('button', { name: 'Notes' });
    expect(band?.children[0]).toBe(toggle);
    expect(band?.children[1]).toHaveClass('section-count');
    expect(band?.children[1]).toHaveTextContent('6');
    expect(band?.children[2]).toContainElement(screen.getByRole('button', { name: 'New' }));

    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledTimes(1);
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
