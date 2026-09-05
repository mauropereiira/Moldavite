import { render, screen } from '@testing-library/react';
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
    expect(screen.getByRole('radiogroup', { name: /^Index/ })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: /^Agenda/ })).toBeInTheDocument();
    expect(
      screen.getByRole('radiogroup', { name: 'Writing column width mode' })
    ).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Asteroid cursor' })).toBeInTheDocument();
    expect(screen.queryByText(/Desktop settings/)).not.toBeInTheDocument();
  });

  it('hides the rail, chrome modes, column width and asteroid cursor on a phone', () => {
    platform.mobile = true;
    render(<LayoutSection />);

    expect(screen.queryByRole('switch', { name: 'Icon rail' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radiogroup', { name: /^Index/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('radiogroup', { name: /^Agenda/ })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('radiogroup', { name: 'Writing column width mode' })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Asteroid cursor' })).not.toBeInTheDocument();
    expect(screen.getByText(/Desktop settings/)).toBeInTheDocument();

    // What still applies on a phone stays.
    expect(screen.getByRole('switch', { name: 'Tab bar' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Constellations' })).toBeInTheDocument();
  });
});
