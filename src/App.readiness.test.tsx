/** Launch on the synced Forge: nothing reads it until iCloud is ready, and one message if it is not. */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();
const initializeNotesMock = vi.fn(async () => undefined);
const handlers = new Map<string, (event: { payload: unknown }) => void>();

vi.mock('@/lib/ipc', () => ({
  safeInvoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => false }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (name: string, handler: (event: { payload: unknown }) => void) => {
    handlers.set(name, handler);
    return () => handlers.delete(name);
  }),
}));
vi.mock('./components', () => ({
  Layout: () => <div data-testid="layout" />,
  ToastContainer: () => null,
  UpdateNotification: () => null,
  WhatsNewModal: () => null,
  CalendarOnboardingModal: () => null,
  AppOnboardingModal: () => null,
}));
vi.mock('./components/quick-switcher', () => ({ QuickSwitcher: () => null }));
vi.mock('./components/ShortcutHelpModal', () => ({ ShortcutHelpHost: () => null }));
vi.mock('./components/ChromeShortcutHost', () => ({ ChromeShortcutHost: () => null }));
vi.mock('./components/graph', () => ({ GraphView: () => null }));
vi.mock('./components/plugins/PluginDialogHostLoader', () => ({
  PluginDialogHostLoader: () => null,
}));
vi.mock('./components/settings', () => ({ SettingsModal: () => null }));
vi.mock('./hooks', () => ({
  initializeNotes: () => initializeNotesMock(),
  useAutoLock: () => undefined,
  useForgeWatcher: () => undefined,
  usePluginDeepLinks: () => undefined,
  usePluginHost: () => undefined,
}));

function emit(name: string, payload: unknown = null) {
  act(() => handlers.get(name)?.({ payload }));
}

async function renderApp(readiness: { state: string; message: string | null }) {
  invokeMock.mockImplementation(async (command: string) => {
    if (command === 'icloud_readiness') return readiness;
    if (command === 'get_all_note_colors') return {};
    if (command === 'semantic_status') return { enabled: false };
    if (command === 'semantic_models') return [];
    return undefined;
  });
  const { default: App } = await import('./App');
  render(<App />);
  await act(async () => {});
}

const FORGE_READS = ['list_notes', 'read_note', 'get_all_note_colors', 'fix_note_permissions'];

function reads() {
  return invokeMock.mock.calls
    .map(([command]) => command)
    .filter((command) => FORGE_READS.includes(command));
}

beforeEach(() => {
  vi.resetModules();
  handlers.clear();
  invokeMock.mockReset();
  initializeNotesMock.mockClear();
  localStorage.clear();
  localStorage.setItem('__moldavite_active_forge', 'icloud://moldavite');
});

describe('launching on the synced Forge', () => {
  it('waits for iCloud before loading notes or showing the app', async () => {
    await renderApp({ state: 'preparing', message: null });

    expect(screen.queryByTestId('layout')).toBeNull();
    expect(screen.getByRole('status', { name: 'Opening your iCloud Forge' })).toBeInTheDocument();
    expect(initializeNotesMock).not.toHaveBeenCalled();
    expect(reads()).toEqual([]);

    emit('icloud:ready');
    await act(async () => {});

    expect(screen.getByTestId('layout')).toBeInTheDocument();
    expect(initializeNotesMock).toHaveBeenCalledTimes(1);
    expect(reads()).toEqual(['fix_note_permissions', 'get_all_note_colors']);
  });

  it('shows one message when iCloud is unavailable, and opens the Forge if it arrives late', async () => {
    await renderApp({ state: 'preparing', message: null });

    emit('icloud:error', 'iCloud is still preparing this Forge. Try again shortly.');
    emit('icloud:error', 'iCloud is still preparing this Forge. Try again shortly.');

    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByText("iCloud isn't available right now")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(initializeNotesMock).not.toHaveBeenCalled();

    emit('icloud:ready');
    await act(async () => {});
    expect(screen.getByTestId('layout')).toBeInTheDocument();
    expect(initializeNotesMock).toHaveBeenCalledTimes(1);
  });

  it('reports an unavailable account found before the window subscribed, and retries on request', async () => {
    await renderApp({ state: 'unavailable', message: 'iCloud Drive is unavailable.' });
    const { useForgeStore } = await import('@/stores/forgeStore');
    const setSyncedForge = vi.fn(async () => undefined);
    useForgeStore.setState({ setSyncedForge });

    expect(screen.getByText('iCloud Drive is unavailable.')).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Try again' })));
    expect(setSyncedForge).toHaveBeenCalledWith(true);
  });

  it('renders a local Forge at once', async () => {
    localStorage.setItem('__moldavite_active_forge', 'Default');
    invokeMock.mockImplementation(async (command: string) =>
      command === 'icloud_readiness' ? { state: 'local', message: null } : {}
    );
    const { default: App } = await import('./App');
    render(<App />);

    expect(screen.getByTestId('layout')).toBeInTheDocument();
    await act(async () => {});
    expect(initializeNotesMock).toHaveBeenCalledTimes(1);
  });
});
