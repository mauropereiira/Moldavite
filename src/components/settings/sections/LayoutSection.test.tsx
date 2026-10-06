import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from '@/stores';
import { LayoutSection } from './LayoutSection';

const platform = vi.hoisted(() => ({ mobile: false }));
vi.mock('@/lib/platform', () => ({ isMobilePlatform: () => platform.mobile }));

describe('LayoutSection', () => {
  beforeEach(() => {
    useSettingsStore.getState().resetToDefaults();
  });

  it('shows every control on the desktop', () => {
    platform.mobile = false;
    render(<LayoutSection />);

    expect(screen.getByRole('switch', { name: 'Icon rail' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Rail side' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: /^Index/ })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: /^Agenda/ })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Writing width' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Focus mode' })).toBeInTheDocument();
    expect(screen.queryByText(/Desktop settings/)).not.toBeInTheDocument();
  });

  it('hides the rail, chrome modes and column width on a phone', () => {
    platform.mobile = true;
    render(<LayoutSection />);

    expect(screen.queryByRole('switch', { name: 'Icon rail' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radiogroup', { name: /^Index/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('radiogroup', { name: /^Agenda/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('radiogroup', { name: 'Writing width' })).not.toBeInTheDocument();
    // Focus mode hides the rail, a phone's only way back to Settings to undo it.
    expect(screen.queryByRole('switch', { name: 'Focus mode' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Desktop settings/)).not.toBeInTheDocument();

    // What still applies on a phone stays.
    expect(screen.getByRole('radiogroup', { name: 'Rail side' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Tab bar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Index sections/ })).toBeInTheDocument();
  });

  it('moves the rail to the chosen side, and hides the choice while the rail is off', () => {
    platform.mobile = false;
    render(<LayoutSection />);

    expect(screen.getByRole('radio', { name: 'Left' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('radio', { name: 'Right' }));
    expect(useSettingsStore.getState().iconRailSide).toBe('right');
    expect(screen.getByRole('radio', { name: 'Right' })).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(screen.getByRole('switch', { name: 'Icon rail' }));
    expect(screen.queryByRole('radiogroup', { name: 'Rail side' })).not.toBeInTheDocument();
  });

  // A pinned column's width is set by dragging its edge, never by a slider here.
  it('folds the Index sections and sort order, with no width sliders', () => {
    platform.mobile = false;
    useSettingsStore.setState({ indexMode: 'pinned', agendaMode: 'pinned' });
    render(<LayoutSection />);

    fireEvent.click(screen.getByRole('button', { name: 'Index sections and sorting' }));
    expect(screen.getByRole('radiogroup', { name: 'Sort notes by' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Backlinks section' })).toBeInTheDocument();
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  });
});
