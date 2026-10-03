import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { AppOnboardingModal, APP_ONBOARDING_VERSION } from './AppOnboardingModal';
import { isMobilePlatform } from '@/lib/platform';
import { open as openDirDialog } from '@tauri-apps/plugin-dialog';
import { useSettingsStore } from '@/stores/settingsStore';
import { invoke } from '@tauri-apps/api/core';

// The Forge dir picker plugin isn't available in jsdom — stub it.
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/platform', () => ({ isMobilePlatform: vi.fn(() => false) }));

const launch = vi.hoisted(() => ({ withFile: false }));
vi.mock('@/lib/launchContext', () => ({
  markLaunchedWithFile: vi.fn(),
  wasLaunchedWithFile: () => launch.withFile,
}));

describe('AppOnboardingModal', () => {
  beforeEach(() => {
    vi.mocked(isMobilePlatform).mockReturnValue(false);
    vi.mocked(openDirDialog).mockClear();
    vi.mocked(invoke).mockReset();
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
      screen.getByRole('heading', { name: /semantic search, fully offline/i })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /get started/i }));
    expect(useSettingsStore.getState().hasSeenAppOnboarding).toBe(true);
    expect(useSettingsStore.getState().lastSeenOnboardingVersion).toBe(APP_ONBOARDING_VERSION);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('starts a replayed tour on the welcome step', () => {
    vi.mocked(isMobilePlatform).mockReturnValue(true);
    render(<AppOnboardingModal />);
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /get started/i }));
    expect(screen.queryByRole('dialog')).toBeNull();

    act(() => useSettingsStore.getState().setHasSeenAppOnboarding(false));

    expect(screen.getByRole('heading', { name: /welcome to moldavite/i })).toBeInTheDocument();
  });

  it('uses the local mobile Forge without a folder picker or desktop feature pages', () => {
    vi.mocked(isMobilePlatform).mockReturnValue(true);
    render(<AppOnboardingModal />);
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(screen.getByRole('heading', { name: 'Your local Forge' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /choose another folder/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(
      screen.getByText('Tap Index in the rail for notes, folders, and tags.')
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /get started/i }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(openDirDialog).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().hasSeenAppOnboarding).toBe(true);
  });

  /// jsdom does no layout, so this asserts the structure the fix relies on
  /// rather than the pixel positions the bug showed up as: the indicator and
  /// the footer must stay siblings of a single flex body, in that order, on
  /// every step. Nesting a step's content outside the body, or emitting a
  /// second body, is what would let them drift again.
  it('keeps the step indicator and footer pinned around one body on every step', () => {
    vi.mocked(isMobilePlatform).mockReturnValue(true);
    render(<AppOnboardingModal />);

    for (const heading of [/welcome to moldavite/i, /your local forge/i, /a quick tour/i]) {
      expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();

      const dialog = screen.getByRole('dialog');
      const column = dialog.querySelector('.p-8');
      const children = Array.from(column?.children ?? []);
      const classes = children.map((child) => child.className);

      expect(dialog.querySelectorAll('.app-onboarding-body')).toHaveLength(1);
      expect(classes[0]).toContain('app-onboarding-steps');
      expect(classes[1]).toContain('app-onboarding-body');
      expect(classes[children.length - 1]).toContain('app-onboarding-footer');

      const next = screen.queryByRole('button', { name: /next/i });
      if (next) fireEvent.click(next);
    }
  });

  it("draws the Agenda tile with the rail's calendar icon, not the graph's", () => {
    vi.mocked(isMobilePlatform).mockReturnValue(true);
    render(<AppOnboardingModal />);
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    const agenda = screen.getByText('Agenda').closest('div')?.parentElement;
    expect(agenda?.querySelector('svg.lucide-calendar')).not.toBeNull();
    expect(document.querySelector('.app-onboarding-body svg.lucide-network')).toBeNull();
  });

  it('does not advertise desktop AI features to an existing mobile user', () => {
    vi.mocked(isMobilePlatform).mockReturnValue(true);
    useSettingsStore.setState({ hasSeenAppOnboarding: true, lastSeenOnboardingVersion: 0 });
    render(<AppOnboardingModal />);
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
        screen.getByRole('heading', { name: /new: built for ai agents/i })
      ).toBeInTheDocument();
      // No welcome step and no Back button — the flow starts at the new pages.
      expect(screen.queryByRole('heading', { name: /welcome to moldavite/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /back/i })).toBeNull();
    });

    it('waits for persisted settings before choosing the flow for an existing user', async () => {
      const storage = useSettingsStore.persist.getOptions().storage;
      if (!storage) throw new Error('Expected settings persistence storage');

      let finishHydration: (() => void) | undefined;
      // This is the exact persisted shape from before the version key shipped.
      const persistedState = { hasSeenAppOnboarding: true };

      const delayedRead = new Promise<{ state: Record<string, unknown>; version: number }>(
        (resolve) => {
          finishHydration = () => resolve({ state: persistedState, version: 0 });
        }
      );
      const getItem = vi
        .spyOn(storage, 'getItem')
        .mockReturnValueOnce(delayedRead as ReturnType<typeof storage.getItem>);

      act(() => {
        useSettingsStore.setState({
          hasSeenAppOnboarding: false,
          lastSeenOnboardingVersion: 0,
        });
        void useSettingsStore.persist.rehydrate();
      });
      render(<AppOnboardingModal />);

      // The pre-hydration defaults describe a new user and must not select the
      // full Welcome flow while the existing user's settings are still loading.
      expect(screen.queryByRole('dialog')).toBeNull();

      await act(async () => {
        finishHydration?.();
        await delayedRead;
      });

      await waitFor(() =>
        expect(
          screen.getByRole('heading', { name: /new: built for ai agents/i })
        ).toBeInTheDocument()
      );
      getItem.mockRestore();
    });

    it('finishes with Done and records the seen version without re-running onboarding', () => {
      render(<AppOnboardingModal />);
      fireEvent.click(screen.getByRole('button', { name: /next/i }));
      expect(
        screen.getByRole('heading', { name: /semantic search, fully offline/i })
      ).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /done/i }));
      expect(useSettingsStore.getState().lastSeenOnboardingVersion).toBe(APP_ONBOARDING_VERSION);
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
      expect(useSettingsStore.getState().lastSeenOnboardingVersion).toBe(APP_ONBOARDING_VERSION);
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  describe('the default Markdown app step', () => {
    type Status = { mode: 'set' | 'open-settings' | 'unsupported'; isDefault: boolean | null };

    function answer(status: Status) {
      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === 'default_markdown_app_status') return status;
        if (cmd === 'make_default_markdown_app') return { ...status, isDefault: true };
        return undefined;
      });
    }

    function seen(version: number) {
      act(() => {
        useSettingsStore.getState().setHasSeenAppOnboarding(true);
        useSettingsStore.getState().setLastSeenOnboardingVersion(version);
      });
    }

    const heading = /open markdown files with moldavite/i;

    beforeEach(() => {
      launch.withFile = false;
      answer({ mode: 'set', isDefault: false });
    });

    it('shows a v2 user only the new step, not the AI pages again', async () => {
      seen(2);
      render(<AppOnboardingModal />);

      expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: /built for ai agents/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /back/i })).toBeNull();
      expect(document.querySelectorAll('.app-onboarding-steps > div')).toHaveLength(1);
    });

    it('makes Moldavite the default and records the version', async () => {
      seen(2);
      render(<AppOnboardingModal />);

      const makeDefault = await screen.findByRole('button', { name: 'Make default' });
      await act(async () => {
        fireEvent.click(makeDefault);
      });

      expect(invoke).toHaveBeenCalledWith('make_default_markdown_app', undefined);
      expect(useSettingsStore.getState().lastSeenOnboardingVersion).toBe(APP_ONBOARDING_VERSION);
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('Not now closes without changing the default', async () => {
      seen(2);
      render(<AppOnboardingModal />);

      fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));

      expect(invoke).not.toHaveBeenCalledWith('make_default_markdown_app', undefined);
      expect(useSettingsStore.getState().lastSeenOnboardingVersion).toBe(APP_ONBOARDING_VERSION);
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('offers Default Apps settings on Windows', async () => {
      answer({ mode: 'open-settings', isDefault: null });
      seen(2);
      render(<AppOnboardingModal />);

      expect(
        await screen.findByRole('button', { name: 'Open Default Apps settings' })
      ).toBeInTheDocument();
    });

    it('ends the first-run flow with the step when it is supported', async () => {
      render(<AppOnboardingModal />);
      await act(async () => {});

      const order = [
        /welcome to moldavite/i,
        /pick your forge/i,
        /a quick tour/i,
        /built for ai agents/i,
        /semantic search, fully offline/i,
      ];
      for (const name of order) {
        expect(screen.getByRole('heading', { name })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /next/i }));
      }
      expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Make default' })).toBeInTheDocument();
    });

    it('shows a user from before v2 the AI pages and then the step', async () => {
      seen(1);
      render(<AppOnboardingModal />);
      await act(async () => {});

      expect(
        screen.getByRole('heading', { name: /new: built for ai agents/i })
      ).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /next/i }));
      fireEvent.click(screen.getByRole('button', { name: /next/i }));
      expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
    });

    it('shows a v3 user nothing and does not ask for the status', async () => {
      seen(3);
      render(<AppOnboardingModal />);
      await act(async () => {});

      expect(screen.queryByRole('dialog')).toBeNull();
      expect(invoke).not.toHaveBeenCalled();
    });

    it.each([
      ['unsupported', { mode: 'unsupported', isDefault: null } as Status, false],
      ['already the default', { mode: 'set', isDefault: true } as Status, false],
      ['launched by opening a file', { mode: 'set', isDefault: false } as Status, true],
    ])(
      'does not open just for the step when %s, but records the version',
      async (_label, status, withFile) => {
        answer(status);
        launch.withFile = withFile;
        seen(2);
        render(<AppOnboardingModal />);
        await act(async () => {});

        expect(screen.queryByRole('dialog')).toBeNull();
        expect(useSettingsStore.getState().lastSeenOnboardingVersion).toBe(APP_ONBOARDING_VERSION);
      }
    );

    it('leaves the step out of a first-run flow when Moldavite is already the default', async () => {
      answer({ mode: 'set', isDefault: true });
      render(<AppOnboardingModal />);
      await act(async () => {});

      for (let i = 0; i < 4; i++) fireEvent.click(screen.getByRole('button', { name: /next/i }));
      expect(
        screen.getByRole('heading', { name: /semantic search, fully offline/i })
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /get started/i })).toBeInTheDocument();
    });

    it('never asks on a phone', async () => {
      vi.mocked(isMobilePlatform).mockReturnValue(true);
      seen(2);
      render(<AppOnboardingModal />);
      await act(async () => {});

      expect(screen.queryByRole('dialog')).toBeNull();
      expect(invoke).not.toHaveBeenCalled();
    });
  });
});
