import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useGraphStore,
  useNoteStore,
  useOverlayStore,
  useQuickSwitcherStore,
  useSettingsStore,
  useTimelineStore,
  useUpdateStore,
} from '@/stores';
import { registerAutosaveFlush } from '@/lib/autosaveFlush';
import type { Note } from '@/types';
import { IconRail } from './IconRail';
import { QuickSwitcher } from '@/components/quick-switcher';
import { WelcomeEmptyState } from '@/components/ui/WelcomeScreen';
import { formatShortcut } from '@/lib/shortcuts';

const trash = vi.hoisted(() => ({
  loadTrash: vi.fn(async () => undefined),
  restoreNote: vi.fn(async () => undefined),
  permanentlyDelete: vi.fn(async () => undefined),
  emptyTrash: vi.fn(async () => undefined),
  cleanupOld: vi.fn(async () => undefined),
}));

vi.mock('@/hooks/useTrash', () => ({
  useTrash: () => ({ trashedNotes: [], ...trash }),
}));

vi.mock('@/components/sidebar/TrashPopover', () => ({
  TrashPopover: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="trash-popover">Trash</div> : null,
}));

vi.mock('@/hooks/useNotes', () => ({
  useNotes: () => ({
    notes: [],
    loadNote: vi.fn(async () => undefined),
    loadDailyNote: vi.fn(async () => undefined),
    createNote: vi.fn(async () => undefined),
  }),
}));

describe('IconRail', () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.getState().resetToDefaults();
    useOverlayStore.setState({
      activeOverlay: null,
      isSidebarHidden: false,
      isRightPanelHidden: false,
    });
    useQuickSwitcherStore.getState().close();
    useGraphStore.getState().close();
    useTimelineStore.getState().close();
    useNoteStore.setState({
      notes: [],
      openTabs: [],
      activeTabId: null,
      currentNote: null,
      unlockedNotes: new Set(),
      externallyChanged: new Map(),
    });
    useUpdateStore.setState({ availableVersion: null });
    vi.clearAllMocks();
  });

  it('shows the available update on Settings with the version in its tooltip', () => {
    useUpdateStore.setState({ availableVersion: '1.8.0' });
    render(<IconRail />);

    const settings = screen.getByRole('button', { name: /settings.*update available/i });
    expect(settings).toHaveAttribute(
      'data-tooltip',
      `Settings · Update 1.8.0 available · ${formatShortcut('⌘,')}`
    );
    expect(screen.getByTestId('settings-update-indicator')).toBeInTheDocument();
  });

  it('does not show an update indicator when no update is available', () => {
    render(<IconRail />);

    expect(screen.queryByTestId('settings-update-indicator')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settings (Command Comma)' })).toBeInTheDocument();
  });

  it('goes Home from an open note and Index after flushing, without closing tabs', async () => {
    const currentNote: Note = {
      id: 'notes/impact.md',
      title: 'Impact',
      content: '<p>Latest unsaved keystroke</p>',
      createdAt: new Date('2026-08-15T08:00:00Z'),
      updatedAt: new Date('2026-08-15T08:00:00Z'),
      isDaily: false,
      isWeekly: false,
    };
    const otherTab: Note = {
      ...currentNote,
      id: 'notes/orbit.md',
      title: 'Orbit',
      content: '<p>Still open</p>',
    };
    useNoteStore.setState({
      openTabs: [currentNote, otherTab],
      activeTabId: currentNote.id,
      currentNote,
    });
    useOverlayStore.getState().openIndex(false);

    const flush = vi.fn(async () => {
      expect(useNoteStore.getState().activeTabId).toBe(currentNote.id);
      expect(useOverlayStore.getState().activeOverlay).toBe('index');
    });
    const unregisterFlush = registerAutosaveFlush(flush);

    function Destination() {
      const note = useNoteStore((state) => state.currentNote);
      return note ? (
        <main>{note.title}</main>
      ) : (
        <WelcomeEmptyState onCreateToday={() => undefined} onCreateNote={() => undefined} />
      );
    }

    try {
      render(
        <>
          <IconRail />
          <Destination />
        </>
      );

      const home = screen.getByRole('button', { name: 'Home' });
      expect(home).toHaveAttribute('data-tooltip', 'Home');
      fireEvent.click(home);

      await waitFor(() =>
        expect(screen.getByRole('img', { name: 'Moldavite' })).toBeInTheDocument()
      );
      expect(flush).toHaveBeenCalledOnce();
      expect(useOverlayStore.getState().activeOverlay).toBeNull();
      expect(useNoteStore.getState().activeTabId).toBeNull();
      expect(useNoteStore.getState().currentNote).toBeNull();
      expect(useNoteStore.getState().openTabs).toEqual([currentNote, otherTab]);

      act(() => useNoteStore.getState().switchTab(otherTab.id));
      expect(useNoteStore.getState().activeTabId).toBe(otherTab.id);
      expect(useNoteStore.getState().currentNote).toBe(otherTab);
    } finally {
      unregisterFlush();
    }
  });

  it('provides labelled, shortcut-bearing controls and opens their surfaces', () => {
    render(<IconRail />);

    const index = screen.getByRole('button', { name: 'Index (Command Backslash)' });
    expect(index).toHaveAttribute('data-tooltip', `Index · ${formatShortcut('⌘\\')}`);

    fireEvent.click(index);
    expect(useOverlayStore.getState().activeOverlay).toBe('index');
    expect(index).toHaveAttribute('data-active', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Search (Command P)' }));
    expect(useQuickSwitcherStore.getState().isOpen).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Graph (Command Shift G)' }));
    expect(useGraphStore.getState().isOpen).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Timeline' }));
    expect(useTimelineStore.getState().isOpen).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Settings (Command Comma)' }));
    expect(useSettingsStore.getState().isSettingsOpen).toBe(true);
  });

  it('toggles pinned columns and ignores a surface whose mode is off', () => {
    useSettingsStore.getState().setIndexMode('pinned');
    useSettingsStore.getState().setAgendaMode('off');
    render(<IconRail />);

    const index = screen.getByRole('button', { name: 'Index (Command Backslash)' });
    expect(index).toHaveAttribute('data-active', 'true');
    fireEvent.click(index);
    expect(useOverlayStore.getState().isSidebarHidden).toBe(true);

    const agenda = screen.getByRole('button', {
      name: 'Agenda (Command Option Backslash)',
    });
    expect(agenda).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(agenda);
    expect(useOverlayStore.getState().activeOverlay).toBeNull();
    expect(useOverlayStore.getState().isRightPanelHidden).toBe(false);
  });

  /**
   * The rail is the one place every surface is reachable from, so it is where
   * exclusivity has to hold: exactly one of these can be open, and the button
   * for the open one closes it.
   */
  const surfaces = [
    {
      button: 'Index (Command Backslash)',
      isOpen: () => useOverlayStore.getState().activeOverlay === 'index',
    },
    { button: 'Search (Command P)', isOpen: () => useQuickSwitcherStore.getState().isOpen },
    {
      button: 'Agenda (Command Option Backslash)',
      isOpen: () => useOverlayStore.getState().activeOverlay === 'agenda',
    },
    { button: 'Graph (Command Shift G)', isOpen: () => useGraphStore.getState().isOpen },
    { button: 'Timeline', isOpen: () => useTimelineStore.getState().isOpen },
  ];

  it('leaves the graph for any other surface', () => {
    render(<IconRail />);

    fireEvent.click(screen.getByRole('button', { name: 'Graph (Command Shift G)' }));
    expect(useGraphStore.getState().isOpen).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Index (Command Backslash)' }));
    expect(useOverlayStore.getState().activeOverlay).toBe('index');
    expect(useGraphStore.getState().isOpen).toBe(false);
  });

  it.each(surfaces)('marks only $button active while its surface is open', ({ button: name }) => {
    const { container } = render(<IconRail />);

    fireEvent.click(screen.getByRole('button', { name }));

    const active = container.querySelectorAll('[data-active="true"]');
    expect(active).toHaveLength(1);
    expect(active[0]).toBe(screen.getByRole('button', { name }));
    // Home is not a surface and never reports an active state.
    expect(screen.getByRole('button', { name: 'Home' })).not.toHaveAttribute('data-active');
  });

  it.each(surfaces)('closes $button again from its own rail button', ({ button: name, isOpen }) => {
    render(<IconRail />);

    const button = screen.getByRole('button', { name });
    fireEvent.click(button);
    expect(isOpen()).toBe(true);

    fireEvent.click(button);
    expect(isOpen()).toBe(false);
  });

  it('keeps every pair of surfaces mutually exclusive', () => {
    render(<IconRail />);

    for (const opened of surfaces) {
      for (const next of surfaces) {
        if (next === opened) continue;
        fireEvent.click(screen.getByRole('button', { name: opened.button }));
        expect(opened.isOpen()).toBe(true);

        fireEvent.click(screen.getByRole('button', { name: next.button }));
        expect(next.isOpen()).toBe(true);
        expect(opened.isOpen()).toBe(false);

        fireEvent.click(screen.getByRole('button', { name: next.button }));
      }
    }
  });

  it('closes the mounted quick switcher on a real second click of Search', async () => {
    render(
      <>
        <IconRail />
        <QuickSwitcher />
      </>
    );

    const search = screen.getByRole('button', { name: 'Search (Command P)' });
    fireEvent.mouseDown(search);
    fireEvent.click(search);
    expect(useQuickSwitcherStore.getState().isOpen).toBe(true);

    // The switcher's own click-outside listener registers a tick after opening.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    fireEvent.mouseDown(search);
    fireEvent.click(search);
    expect(useQuickSwitcherStore.getState().isOpen).toBe(false);
  });

  it('opens the existing trash surface from the bottom action', async () => {
    render(<IconRail />);

    const button = screen.getByRole('button', { name: 'Trash' });
    fireEvent.click(button);

    expect(await screen.findByTestId('trash-popover')).toBeInTheDocument();
    expect(button).toHaveAttribute('data-active', 'true');
    expect(trash.loadTrash).toHaveBeenCalled();
  });
});
