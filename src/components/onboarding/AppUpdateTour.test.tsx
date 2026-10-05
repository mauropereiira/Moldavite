import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { AppOnboardingModal } from './AppOnboardingModal';
import { WhatsNewModal } from '@/components/updates/WhatsNewModal';
import { CalendarOnboardingModal } from '@/components/calendar/CalendarOnboardingModal';
import { useCalendarStore } from '@/stores/calendarStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { PRESETS, useThemeStore } from '@/stores/themeStore';
import { useWhatsNewStore } from '@/stores/whatsNewStore';
import { formatShortcut } from '@/lib/shortcuts';
import type { DefaultAppStatus } from '@/lib/defaultApp';
import { markLaunchedWithFile, useLaunchContextStore } from '@/lib/launchContext';
import { JACK_O_LANTERN_SRC } from '@/lib/seasons';

const mocks = vi.hoisted(() => ({
  mobile: false,
  season: 'autumn' as 'autumn' | null,
  getVersion: vi.fn<() => Promise<string>>(),
}));

vi.mock('@tauri-apps/api/app', () => ({ getVersion: mocks.getVersion }));
vi.mock('@tauri-apps/plugin-shell', () => ({ open: vi.fn() }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('@/lib/platform', () => ({ isMobilePlatform: () => mocks.mobile }));
vi.mock('@/lib/seasons', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/seasons')>()),
  get ACTIVE_SEASON() {
    return mocks.season;
  },
}));

function answer(status: DefaultAppStatus) {
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === 'default_markdown_app_status') return status;
    if (command === 'make_default_markdown_app') return { ...status, isDefault: true };
    return undefined;
  });
}

describe('release welcome tour', () => {
  beforeEach(() => {
    mocks.mobile = false;
    mocks.season = 'autumn';
    useLaunchContextStore.setState({ ready: true, launchedWithFile: false });
    mocks.getVersion.mockReset().mockResolvedValue('2.10.0');
    vi.mocked(invoke).mockReset();
    answer({ mode: 'set', isDefault: false });
    useSettingsStore.setState({ hasSeenAppOnboarding: true, lastSeenOnboardingVersion: 2 });
    useThemeStore.setState({ theme: 'light', baseMode: 'light', preset: 'default' });
    useWhatsNewStore.setState({ lastSeenVersion: '2.9.1', isOpen: false, entry: null });
    document.documentElement.classList.remove('dark');
    document.documentElement.removeAttribute('data-theme');
  });

  it('shows exactly season and open-files to a v2 desktop user and suppresses release notes', async () => {
    const first = render(
      <>
        <WhatsNewModal />
        <AppOnboardingModal />
      </>
    );
    expect(screen.getByRole('heading', { name: 'Autumn is here' })).toBeInTheDocument();
    const pumpkin = document.querySelector<HTMLElement>('.app-onboarding-body .mask-art');
    expect(pumpkin?.style.maskImage).toBe(`url("${JACK_O_LANTERN_SRC}")`);
    expect(pumpkin).toHaveAttribute('aria-hidden', 'true');
    expect(document.querySelectorAll('.app-onboarding-steps > div')).toHaveLength(2);
    await waitFor(() => expect(useWhatsNewStore.getState().lastSeenVersion).toBe('2.10.0'));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(useWhatsNewStore.getState().isOpen).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Keep my theme' }));
    expect(screen.getByRole('heading', { name: 'Open any Markdown file' })).toBeInTheDocument();
    expect(screen.getByText(/choose Moldavite in Open With/i)).toHaveTextContent(
      formatShortcut('⌘O')
    );
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useSettingsStore.getState().lastSeenOnboardingVersion).toBe(3);

    first.unmount();
    render(
      <>
        <WhatsNewModal />
        <AppOnboardingModal />
      </>
    );
    await act(async () => {});
    expect(screen.queryByRole('dialog')).toBeNull();

    act(() => useWhatsNewStore.getState().open({ version: '2.10.0', date: null, groups: [] }));
    expect(
      screen.getByRole('heading', { name: /what's new in version 2.10.0/i })
    ).toBeInTheDocument();
  });

  it('shows only season on mobile and records completion', () => {
    mocks.mobile = true;
    render(<AppOnboardingModal />);
    expect(screen.getByRole('heading', { name: 'Autumn is here' })).toBeInTheDocument();
    expect(document.querySelectorAll('.app-onboarding-steps > div')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Keep my theme' }));
    expect(useSettingsStore.getState().lastSeenOnboardingVersion).toBe(3);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('Use Autumn applies the preset immediately and continues', async () => {
    useThemeStore.getState().setTheme('dark');
    render(<AppOnboardingModal />);
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Use Autumn' }));
    expect(useThemeStore.getState().preset).toBe('autumn');
    expect(document.documentElement).toHaveAttribute('data-theme', 'autumn');
    expect(document.documentElement).toHaveClass('dark');
    expect(screen.getByRole('heading', { name: 'Open any Markdown file' })).toBeInTheDocument();
  });

  it('already-Autumn users get the alternate copy and a single Continue', async () => {
    useThemeStore.getState().setPreset('autumn');
    render(<AppOnboardingModal />);
    await act(async () => {});
    expect(screen.getByText("You're already using Autumn")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Use Autumn' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Keep my theme' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('heading', { name: 'Open any Markdown file' })).toBeInTheDocument();
  });

  it.each(['light', 'dark', 'system'] as const)('previews the %s mode swatches', async (mode) => {
    useThemeStore.getState().setTheme(mode);
    render(<AppOnboardingModal />);
    await act(async () => {});
    const preset = PRESETS.find((preset) => preset.id === 'autumn');
    if (!preset) throw new Error('Expected Autumn preset');
    const colors = Object.values(mode === 'dark' ? preset.darkSwatches : preset.swatches);
    const row = screen.getByRole('img', { name: 'Autumn palette' });
    expect(row.children).toHaveLength(colors.length);
    for (const [index, color] of colors.entries()) {
      expect(row.children[index]).toHaveStyle({ backgroundColor: color });
    }
  });

  it.each([
    ['unsupported', { mode: 'unsupported', isDefault: null }],
    ['already default', { mode: 'set', isDefault: true }],
  ] as const)('keeps open-files but hides the default action when %s', async (_label, status) => {
    answer(status);
    render(<AppOnboardingModal />);
    fireEvent.click(screen.getByRole('button', { name: 'Keep my theme' }));
    await act(async () => {});
    expect(screen.getByRole('heading', { name: 'Open any Markdown file' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Make default' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open Default Apps settings' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(useSettingsStore.getState().lastSeenOnboardingVersion).toBe(3);
  });

  it('appends season after the existing first-run desktop pages', async () => {
    useSettingsStore.setState({ hasSeenAppOnboarding: false, lastSeenOnboardingVersion: 0 });
    render(<AppOnboardingModal />);
    await act(async () => {});
    for (const name of [
      'Welcome to Moldavite',
      'Pick your Forge',
      'A quick tour',
      'Built for AI agents',
      'Semantic search, fully offline',
      'Open any Markdown file',
    ]) {
      expect(screen.getByRole('heading', { name })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /^(Next|Continue)$/ }));
    }
    expect(screen.getByRole('heading', { name: 'Autumn is here' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep my theme' }));
    expect(useSettingsStore.getState().hasSeenAppOnboarding).toBe(true);
    expect(useSettingsStore.getState().lastSeenOnboardingVersion).toBe(3);
  });

  it.each([false, true])(
    'defers every welcome without recording versions on a file launch (existing user: %s)',
    async (existingUser) => {
      useSettingsStore.setState({
        hasSeenAppOnboarding: existingUser,
        lastSeenOnboardingVersion: existingUser ? 2 : 0,
      });
      useWhatsNewStore.setState({ lastSeenVersion: existingUser ? '2.9.1' : null });
      useLaunchContextStore.setState({ ready: false });
      const first = render(
        <>
          <WhatsNewModal />
          <AppOnboardingModal />
        </>
      );
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(mocks.getVersion).not.toHaveBeenCalled();

      act(() => {
        markLaunchedWithFile();
        useLaunchContextStore.setState({ ready: true });
      });
      await act(async () => {});
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(useSettingsStore.getState().hasSeenAppOnboarding).toBe(existingUser);
      expect(useSettingsStore.getState().lastSeenOnboardingVersion).toBe(existingUser ? 2 : 0);
      expect(useWhatsNewStore.getState().lastSeenVersion).toBe(existingUser ? '2.9.1' : null);
      expect(invoke).not.toHaveBeenCalled();

      first.unmount();
      useLaunchContextStore.setState({ ready: true, launchedWithFile: false });
      render(
        <>
          <WhatsNewModal />
          <AppOnboardingModal />
        </>
      );
      expect(
        screen.getByRole('heading', {
          name: existingUser ? 'Autumn is here' : 'Welcome to Moldavite',
        })
      ).toBeInTheDocument();
      await waitFor(() => expect(useWhatsNewStore.getState().lastSeenVersion).toBe('2.10.0'));
    }
  );

  it('defers automatic release notes until the next normal launch', async () => {
    useSettingsStore.setState({ lastSeenOnboardingVersion: 3 });
    markLaunchedWithFile();
    const first = render(<WhatsNewModal />);
    await act(async () => {});
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useWhatsNewStore.getState().lastSeenVersion).toBe('2.9.1');

    first.unmount();
    useLaunchContextStore.setState({ ready: true, launchedWithFile: false });
    render(<WhatsNewModal />);
    expect(
      await screen.findByRole('heading', { name: /what's new in version 2.10.0/i })
    ).toBeInTheDocument();
    expect(useWhatsNewStore.getState().lastSeenVersion).toBe('2.10.0');
  });

  it('does not record an empty update flow on a file launch', () => {
    mocks.mobile = true;
    mocks.season = null;
    markLaunchedWithFile();
    render(<AppOnboardingModal />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useSettingsStore.getState().lastSeenOnboardingVersion).toBe(2);
  });

  it('defers calendar onboarding on a file launch without recording completion', () => {
    useCalendarStore.setState({
      hasSeenOnboarding: false,
      sources: [
        {
          source: 'google',
          available: true,
          connected: true,
          account: null,
          permission: null,
          error: null,
        },
      ],
    });
    markLaunchedWithFile();
    const first = render(<CalendarOnboardingModal />);
    expect(screen.queryByText('Calendar Events in Your Timeline')).toBeNull();
    expect(useCalendarStore.getState().hasSeenOnboarding).toBe(false);

    first.unmount();
    useLaunchContextStore.setState({ ready: true, launchedWithFile: false });
    render(<CalendarOnboardingModal />);
    expect(screen.getByText('Calendar Events in Your Timeline')).toBeInTheDocument();
  });

  it('records the version when no mobile update pages apply', () => {
    mocks.mobile = true;
    mocks.season = null;
    render(<AppOnboardingModal />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useSettingsStore.getState().lastSeenOnboardingVersion).toBe(3);
  });

  it('omits season when inactive and leaves release notes unchanged when no update pages apply', async () => {
    mocks.season = null;
    useSettingsStore.setState({ lastSeenOnboardingVersion: 3 });
    render(
      <>
        <WhatsNewModal />
        <AppOnboardingModal />
      </>
    );
    expect(screen.queryByRole('heading', { name: 'Autumn is here' })).toBeNull();
    expect(
      await screen.findByRole('heading', { name: /what's new in version 2.10.0/i })
    ).toBeInTheDocument();
    expect(useWhatsNewStore.getState().lastSeenVersion).toBe('2.10.0');
  });

  it('still shows open-files without an active season', async () => {
    mocks.season = null;
    render(<AppOnboardingModal />);
    await act(async () => {});
    expect(screen.getByRole('heading', { name: 'Open any Markdown file' })).toBeInTheDocument();
    expect(document.querySelectorAll('.app-onboarding-steps > div')).toHaveLength(1);
  });

  it.each([false, true])('shows nothing to a v3 user (mobile: %s)', (mobile) => {
    mocks.mobile = mobile;
    useSettingsStore.setState({ lastSeenOnboardingVersion: 3 });
    render(<AppOnboardingModal />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('keeps release notes suppressed if the tour finishes before the version read', async () => {
    let finishVersion: ((version: string) => void) | undefined;
    mocks.getVersion.mockReturnValue(
      new Promise((resolve) => {
        finishVersion = resolve;
      })
    );
    render(
      <>
        <WhatsNewModal />
        <AppOnboardingModal />
      </>
    );
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Keep my theme' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await act(async () => {
      finishVersion?.('2.10.0');
    });
    expect(useWhatsNewStore.getState().lastSeenVersion).toBe('2.10.0');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('waits for settings hydration before deciding which update popup opens', async () => {
    const storage = useSettingsStore.persist.getOptions().storage;
    if (!storage) throw new Error('Expected settings persistence storage');
    let finishHydration: (() => void) | undefined;
    const delayedRead = new Promise<{ state: Record<string, unknown>; version: number }>(
      (resolve) => {
        finishHydration = () =>
          resolve({
            state: { hasSeenAppOnboarding: true, lastSeenOnboardingVersion: 2 },
            version: 0,
          });
      }
    );
    const getItem = vi.spyOn(storage, 'getItem').mockReturnValueOnce(delayedRead);
    try {
      act(() => {
        useSettingsStore.setState({ hasSeenAppOnboarding: false, lastSeenOnboardingVersion: 0 });
        void useSettingsStore.persist.rehydrate();
      });
      render(
        <>
          <WhatsNewModal />
          <AppOnboardingModal />
        </>
      );
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(mocks.getVersion).not.toHaveBeenCalled();
      await act(async () => {
        finishHydration?.();
        await delayedRead;
      });
      await waitFor(() => expect(useWhatsNewStore.getState().lastSeenVersion).toBe('2.10.0'));
      expect(screen.getAllByRole('dialog')).toHaveLength(1);
      expect(screen.getByRole('heading', { name: 'Autumn is here' })).toBeInTheDocument();
      expect(useWhatsNewStore.getState().isOpen).toBe(false);
    } finally {
      getItem.mockRestore();
    }
  });
});
