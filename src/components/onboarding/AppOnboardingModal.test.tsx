import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { AppOnboardingModal } from './AppOnboardingModal';
import { useSettingsStore } from '@/stores/settingsStore';

// The Forge dir picker plugin isn't available in jsdom — stub it.
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn().mockResolvedValue(null),
}));

describe('AppOnboardingModal', () => {
  beforeEach(() => {
    // Reset to a known state before each test.
    act(() => {
      useSettingsStore.getState().setHasSeenAppOnboarding(false);
    });
  });

  it('does not render when hasSeenAppOnboarding is true', () => {
    act(() => {
      useSettingsStore.getState().setHasSeenAppOnboarding(true);
    });
    render(<AppOnboardingModal />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders the welcome step when hasSeenAppOnboarding is false', () => {
    render(<AppOnboardingModal />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'app-onboarding-title');
    expect(screen.getByRole('heading', { name: /welcome to moldavite/i })).toBeInTheDocument();
  });

  it('advances to the Forge step when Next is clicked', () => {
    render(<AppOnboardingModal />);
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(screen.getByRole('heading', { name: /pick your forge/i })).toBeInTheDocument();
  });

  it('reaches the tour step and closes via Get started', () => {
    render(<AppOnboardingModal />);
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(screen.getByRole('heading', { name: /a quick tour/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /get started/i }));
    expect(useSettingsStore.getState().hasSeenAppOnboarding).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
