import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppearanceSection } from './sections/AppearanceSection';
import { AboutSection } from './sections/AboutSection';
import { Toggle } from './common';
import { ShortcutHelpHost } from '@/components/ShortcutHelpModal';
import { useSettingsStore } from '@/stores';

const platform = vi.hoisted(() => ({ mobile: false }));
vi.mock('@/lib/platform', () => ({ isMobilePlatform: () => platform.mobile }));

vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn(async () => '2.7.2') }));

function renderAppearance() {
  render(
    <AppearanceSection
      theme="light"
      onThemeChange={vi.fn()}
      preset="default"
      onPresetChange={vi.fn()}
    />
  );
}

describe('Settings on a phone', () => {
  afterEach(() => {
    platform.mobile = false;
  });

  it('spells colour one way', () => {
    renderAppearance();
    expect(screen.getByRole('radiogroup', { name: 'Colour preset' })).toBeInTheDocument();
  });

  it('offers the quiet home screen and seasonal touches on a phone', () => {
    platform.mobile = true;
    renderAppearance();
    fireEvent.click(screen.getByRole('button', { name: 'Home screen' }));
    expect(screen.getByRole('switch', { name: 'Quiet home screen' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Seasonal touches' })).toBeInTheDocument();
  });

  it('lists no keyboard shortcuts in About on a phone', () => {
    platform.mobile = true;
    render(<AboutSection />);
    expect(screen.queryByText('Keyboard shortcuts')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Privacy policy' })).toBeInTheDocument();
  });

  it('opens the full shortcut sheet from About on the desktop', () => {
    useSettingsStore.setState({ isSettingsOpen: true });
    render(
      <>
        <AboutSection />
        <ShortcutHelpHost />
      </>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show all shortcuts' }));

    expect(useSettingsStore.getState().isSettingsOpen).toBe(false);
    expect(screen.getByRole('dialog', { name: 'Keyboard Shortcuts' })).toBeInTheDocument();
  });

  it('can disable a switch', () => {
    render(<Toggle enabled onChange={vi.fn()} ariaLabel="Busy" disabled />);
    expect(screen.getByRole('switch', { name: 'Busy' })).toBeDisabled();
  });
});
