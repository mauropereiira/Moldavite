import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchIndexStatus } from '@/lib/searchIndex';
import { useToastStore } from '@/stores/toastStore';
import { AgentsSection } from './AgentsSection';

const invoke = vi.fn();

vi.mock('@/lib/ipc', () => ({ safeInvoke: (...args: unknown[]) => invoke(...args) }));

function statusFixture(overrides: Partial<SearchIndexStatus> = {}): SearchIndexStatus {
  return {
    ready: false,
    building: false,
    noteCount: 0,
    lastReconcileMs: null,
    indexPath: '/forge/.index',
    ...overrides,
  };
}

/** Route only `search_index_status`; every other command resolves undefined like the app default. */
function mockStatus(status: SearchIndexStatus) {
  invoke.mockImplementation((cmd: string) =>
    cmd === 'search_index_status' ? Promise.resolve(status) : Promise.resolve(undefined)
  );
}

describe('AgentsSection — Search index', () => {
  beforeEach(() => {
    invoke.mockReset();
    useToastStore.setState({ toasts: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows "Not built yet" before any build has run', async () => {
    mockStatus(statusFixture());
    render(<AgentsSection />);
    expect(await screen.findByText('Not built yet')).toBeInTheDocument();
  });

  it('shows "Indexing…" while a build is running', async () => {
    mockStatus(statusFixture({ building: true }));
    render(<AgentsSection />);
    expect(await screen.findByText('Indexing…')).toBeInTheDocument();
  });

  it('shows the note count and a relative rebuild time once ready', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-04T12:00:00Z'));
    mockStatus(
      statusFixture({ ready: true, noteCount: 42, lastReconcileMs: Date.now() - 3 * 60_000 })
    );

    render(<AgentsSection />);

    expect(await screen.findByText('42 notes indexed — rebuilt 3 minutes ago')).toBeInTheDocument();
  });

  it('rebuilds the index on click and disables the button while building', async () => {
    mockStatus(statusFixture({ ready: true, noteCount: 5, lastReconcileMs: Date.now() }));
    render(<AgentsSection />);
    await screen.findByText(/notes indexed/);
    const button = screen.getByRole('button', { name: 'Rebuild search index' });

    fireEvent.click(button);

    expect(invoke).toHaveBeenCalledWith('search_index_rebuild');
    expect(button).toBeDisabled();
    expect(screen.getByText('Building…')).toBeInTheDocument();
  });

  it('toasts on rebuild failure', async () => {
    invoke.mockImplementation((cmd: string) => {
      if (cmd === 'search_index_status') {
        return Promise.resolve(
          statusFixture({ ready: true, noteCount: 5, lastReconcileMs: Date.now() })
        );
      }
      if (cmd === 'search_index_rebuild') {
        return Promise.reject(new Error('disk full'));
      }
      return Promise.resolve(undefined);
    });

    render(<AgentsSection />);
    await screen.findByText(/notes indexed/);
    fireEvent.click(screen.getByRole('button', { name: 'Rebuild search index' }));

    await screen.findByText(/notes indexed/); // reverts once the failed rebuild's status refetch lands
    expect(useToastStore.getState().toasts[0]).toMatchObject({
      type: 'error',
      message: 'Failed to rebuild the search index',
    });
  });

  it('polls status every 2 seconds while building and stops once it clears', async () => {
    // Drive the poll interval by hand instead of advancing real/fake time:
    // capture the callback the component registers and invoke it directly.
    const setIntervalSpy = vi
      .spyOn(window, 'setInterval')
      .mockImplementation(() => 1 as unknown as ReturnType<typeof setInterval>);
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval').mockImplementation(() => {});

    let calls = 0;
    invoke.mockImplementation((cmd: string) => {
      if (cmd !== 'search_index_status') return Promise.resolve(undefined);
      calls += 1;
      return Promise.resolve(
        calls < 3
          ? statusFixture({ building: true })
          : statusFixture({
              ready: true,
              building: false,
              noteCount: 9,
              lastReconcileMs: Date.now(),
            })
      );
    });

    render(<AgentsSection />);
    await screen.findByText('Indexing…');
    expect(calls).toBe(1);
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 2000);

    // Other components on the page (e.g. tooltips) also start intervals, so
    // find the one registered at our 2-second poll cadence.
    const pollCall = setIntervalSpy.mock.calls.find((call) => call[1] === 2000);
    const poll = pollCall?.[0] as () => void;

    poll();
    expect(calls).toBe(2);

    poll();
    expect(calls).toBe(3);

    // Building cleared on the 3rd fetch — the polling effect tears down its interval.
    await screen.findByText(/notes indexed/);
    expect(clearIntervalSpy).toHaveBeenCalled();

    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
  });
});
