import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { AppOnboardingModal, APP_ONBOARDING_VERSION } from './AppOnboardingModal';
import { useSettingsStore } from '@/stores/settingsStore';

// The Forge dir picker plugin isn't available in jsdom — stub it.
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn().mockResolvedValue(null),
}));

describe('AppOnboardingModal', () => {
  beforeEach(() => {
    // Reset to a known first-run state before each test.
    act(() => {
      useSettingsStore.getState().setHasSeenAppOnboarding(false);
      useSettingsStore.getState().setLastSeenOnboardingVersion(0);
      useSettingsStore.getState().setIsSettingsOpen(false);
    });
  });

  it('does not render when onboarding and feature pages have been seen', () => {
    act(() => {
      useSettingsStore.getState().setHasSeenAppOnboarding(true);
      useSettingsStore.getState().setLastSeenOnboardingVersion(APP_ONBOARDING_VERSION);
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

  it('walks the full flow (tour + AI pages) and closes via Get started', () => {
    render(<AppOnboardingModal />);
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(screen.getByRole('heading', { name: /a quick tour/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(screen.getByRole('heading', { name: /built for ai agents/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(
      screen.getByRole('heading', { name: /semantic search, fully offline/i }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /get started/i }));
    expect(useSettingsStore.getState().hasSeenAppOnboarding).toBe(true);
    expect(useSettingsStore.getState().lastSeenOnboardingVersion).toBe(
      APP_ONBOARDING_VERSION,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  describe('feature-update flow for existing users', () => {
    beforeEach(() => {
      // A user who completed onboarding before the AI pages shipped.
      act(() => {
        useSettingsStore.getState().setHasSeenAppOnboarding(true);
        useSettingsStore.getState().setLastSeenOnboardingVersion(0);
      });
    });

    it('shows only the new AI pages, starting on the agents page', () => {
      render(<AppOnboardingModal />);
      expect(
        screen.getByRole('heading', { name: /new: built for ai agents/i }),
      ).toBeInTheDocument();
      // No welcome step and no Back button — the flow starts at the new pages.
      expect(screen.queryByRole('heading', { name: /welcome to moldavite/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /back/i })).toBeNull();
    });

    it('finishes with Done and records the seen version without re-running onboarding', () => {
      render(<AppOnboardingModal />);
      fireEvent.click(screen.getByRole('button', { name: /next/i }));
      expect(
        screen.getByRole('heading', { name: /semantic search, fully offline/i }),
      ).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /done/i }));
      expect(useSettingsStore.getState().lastSeenOnboardingVersion).toBe(
        APP_ONBOARDING_VERSION,
      );
      expect(useSettingsStore.getState().hasSeenAppOnboarding).toBe(true);
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('does not render again once the version has been seen', () => {
      act(() => {
        useSettingsStore.getState().setLastSeenOnboardingVersion(APP_ONBOARDING_VERSION);
      });
      render(<AppOnboardingModal />);
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('Open Settings on the final page opens the settings modal and closes onboarding', () => {
      render(<AppOnboardingModal />);
      fireEvent.click(screen.getByRole('button', { name: /next/i }));
      fireEvent.click(screen.getByRole('button', { name: /open settings/i }));

      expect(useSettingsStore.getState().isSettingsOpen).toBe(true);
      expect(useSettingsStore.getState().lastSeenOnboardingVersion).toBe(
        APP_ONBOARDING_VERSION,
      );
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });
});
