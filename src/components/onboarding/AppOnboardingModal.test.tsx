import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { AppOnboardingModal, APP_ONBOARDING_VERSION } from './AppOnboardingModal';
import { isMobilePlatform } from '@/lib/platform';
import { open as openDirDialog } from '@tauri-apps/plugin-dialog';
import { useSettingsStore } from '@/stores/settingsStore';
import { invoke } from '@tauri-apps/api/core';
import { useLaunchContextStore } from '@/lib/launchContext';
import { JACK_O_LANTERN_SRC } from '@/lib/seasons';

// The Forge dir picker plugin isn't available in jsdom — stub it.
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/platform', () => ({ isMobilePlatform: vi.fn(() => false) }));

describe('AppOnboardingModal', () => {
  beforeEach(() => {
    vi.mocked(isMobilePlatform).mockReturnValue(false);
    vi.mocked(openDirDialog).mockClear();
    vi.mocked(invoke).mockReset();
    useLaunchContextStore.setState({ ready: true, launchedWithFile: false });
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

  it('walks the full flow and closes after the release pages', () => {
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

    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep my theme' }));
    expect(useSettingsStore.getState().hasSeenAppOnboarding).toBe(true);
    expect(useSettingsStore.getState().lastSeenOnboardingVersion).toBe(APP_ONBOARDING_VERSION);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('starts a replayed tour on the welcome step', () => {
    vi.mocked(isMobilePlatform).mockReturnValue(true);
    render(<AppOnboardingModal />);
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep my theme' }));
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
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep my theme' }));
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

  /// The card keeps one size because every step renders into the same grid
  /// cell and only the current one shows. jsdom does no layout, so this pins
  /// that structure: the card's size rules never change, every step is in the
  /// stack on every step, and only the current one is reachable and titled.
  it('renders every step into one stack so the card keeps its size', () => {
    render(<AppOnboardingModal />);
    const dialog = screen.getByRole('dialog');
    const cardClass = dialog.className;
    const cardStyle = dialog.getAttribute('style');
    const stepCount = dialog.querySelectorAll('.app-onboarding-steps > div').length;
    const headings: string[] = [];

    expect(cardClass).toContain('app-onboarding-card');
    for (let i = 0; i < stepCount; i++) {
      expect(dialog.className).toBe(cardClass);
      expect(dialog.getAttribute('style')).toBe(cardStyle);

      const pages = Array.from(dialog.querySelectorAll('.app-onboarding-body .step-stack > *'));
      expect(pages).toHaveLength(stepCount);
      pages.forEach((page) => expect(page.className).toBe('step-stack-page'));

      const current = pages.filter((page) => !page.hasAttribute('inert'));
      expect(current).toHaveLength(1);
      expect(current[0]).not.toHaveAttribute('aria-hidden');
      expect(dialog.querySelectorAll('#app-onboarding-title')).toHaveLength(1);
      expect(current[0].querySelector('#app-onboarding-title')).not.toBeNull();
      pages
        .filter((page) => page !== current[0])
        .forEach((page) => expect(page).toHaveAttribute('aria-hidden', 'true'));
      headings.push(screen.getByRole('heading').textContent ?? '');

      const next =
        screen.queryByRole('button', { name: /next/i }) ??
        screen.queryByRole('button', { name: 'Continue' });
      if (next) fireEvent.click(next);
    }

    expect(new Set(headings).size).toBe(stepCount);
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
    expect(screen.getByRole('heading', { name: 'Autumn is here' })).toBeInTheDocument();
    const pumpkin = document.querySelector<HTMLElement>('.app-onboarding-body .mask-art');
    expect(pumpkin?.style.maskImage).toBe(`url("${JACK_O_LANTERN_SRC}")`);
    expect(pumpkin).toHaveAttribute('aria-hidden', 'true');
    expect(pumpkin).toHaveClass('w-10', 'h-10');
    expect(screen.queryByRole('heading', { name: /built for ai agents/i })).toBeNull();
  });

  describe('feature-update flow for existing users', () => {
    beforeEach(() => {
      // A user who completed onboarding before the AI pages shipped.
      act(() => {
        useSettingsStore.getState().setHasSeenAppOnboarding(true);
        useSettingsStore.getState().setLastSeenOnboardingVersion(0);
      });
    });

    it('starts with the unseen AI pages', () => {
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

    it('records the seen version without re-running onboarding', () => {
      render(<AppOnboardingModal />);
      fireEvent.click(screen.getByRole('button', { name: /next/i }));
      expect(
        screen.getByRole('heading', { name: /semantic search, fully offline/i })
      ).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /next/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Keep my theme' }));
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
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
  });

  describe('the inline default Markdown app action', () => {
    beforeEach(() => {
      useSettingsStore.setState({ hasSeenAppOnboarding: true, lastSeenOnboardingVersion: 2 });
      vi.mocked(invoke).mockImplementation(async (command) => {
        if (command === 'default_markdown_app_status') return { mode: 'set', isDefault: false };
        if (command === 'make_default_markdown_app') return { mode: 'set', isDefault: true };
        return undefined;
      });
    });

    async function openFilesPage() {
      render(<AppOnboardingModal />);
      fireEvent.click(screen.getByRole('button', { name: 'Keep my theme' }));
      await act(async () => {});
    }

    it('makes Moldavite the default and records the version', async () => {
      await openFilesPage();
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Make default' }));
      });
      expect(invoke).toHaveBeenCalledWith('make_default_markdown_app', undefined);
      expect(useSettingsStore.getState().lastSeenOnboardingVersion).toBe(APP_ONBOARDING_VERSION);
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('Continue closes without changing the default', async () => {
      await openFilesPage();
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      expect(invoke).not.toHaveBeenCalledWith('make_default_markdown_app', undefined);
      expect(useSettingsStore.getState().lastSeenOnboardingVersion).toBe(APP_ONBOARDING_VERSION);
    });

    it('offers Default Apps settings on Windows', async () => {
      vi.mocked(invoke).mockResolvedValue({ mode: 'open-settings', isDefault: null });
      await openFilesPage();
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Open Default Apps settings' }));
      });
      expect(invoke).toHaveBeenCalledWith('make_default_markdown_app', undefined);
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('keeps the page open and reports a failed default-app change', async () => {
      await openFilesPage();
      vi.mocked(invoke).mockRejectedValueOnce(new Error('Could not change the default'));
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Make default' }));
      });
      expect(screen.getByText('Could not change the default')).toBeInTheDocument();
      expect(useSettingsStore.getState().lastSeenOnboardingVersion).toBe(2);
      expect(screen.getByRole('button', { name: 'Make default' })).toBeEnabled();
    });
  });
});
