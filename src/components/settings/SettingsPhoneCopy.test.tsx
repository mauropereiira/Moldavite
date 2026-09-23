import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppearanceSection } from './sections/AppearanceSection';
import { AboutSection } from './sections/AboutSection';
import { EditorSection } from './sections/EditorSection';
import { Toggle } from './common';

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

  it('shows no keyboard shortcut for focus mode on a phone', () => {
    platform.mobile = true;
    renderAppearance();
    expect(screen.getByText(/leave just the note\.$/)).toBeInTheDocument();
  });

  it('keeps the focus mode shortcut on the desktop', () => {
    renderAppearance();
    expect(screen.getByText(/leave just the note\. .+/)).toBeInTheDocument();
  });

  it('spells colour one way', () => {
    renderAppearance();
    expect(screen.getByRole('radiogroup', { name: 'Colour preset' })).toBeInTheDocument();
  });

  it('lists no keyboard shortcuts in About on a phone', () => {
    platform.mobile = true;
    render(<AboutSection />);
    expect(screen.queryByText('Keyboard Shortcuts')).not.toBeInTheDocument();
  });

  // Features has the same switch.
  it('does not repeat the Tags switch in Editor', () => {
    render(<EditorSection />);
    expect(screen.queryByRole('switch', { name: 'Enable tags' })).not.toBeInTheDocument();
  });

  it('can disable a switch', () => {
    render(<Toggle enabled onChange={vi.fn()} ariaLabel="Busy" disabled />);
    expect(screen.getByRole('switch', { name: 'Busy' })).toBeDisabled();
  });
});
