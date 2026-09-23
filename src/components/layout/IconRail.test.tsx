import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { isMobilePlatform } from '@/lib/platform';
import { formatShortcut } from '@/lib/shortcuts';

vi.mock('@/lib/platform', () => ({ isMobilePlatform: vi.fn(() => false) }));

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

const notes = vi.hoisted(() => ({
  loadDailyNote: vi.fn(async (_date: Date) => undefined),
}));

vi.mock('@/hooks/useNotes', () => ({
  useNotes: () => ({
    notes: [],
    loadNote: vi.fn(async () => undefined),
    loadDailyNote: notes.loadDailyNote,
    createNote: vi.fn(async () => undefined),
  }),
}));

describe('IconRail', () => {
  afterEach(() => {
    vi.mocked(isMobilePlatform).mockReturnValue(false);
  });

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

  it('walks Settings back on a phone: section to list, list to closed', () => {
    vi.mocked(isMobilePlatform).mockReturnValue(true);
    render(<IconRail />);
    const settings = screen.getByRole('button', { name: 'Settings' });

    fireEvent.click(settings);
    expect(useSettingsStore.getState().isSettingsOpen).toBe(true);
    expect(useSettingsStore.getState().settingsSection).toBeNull();

    act(() => useSettingsStore.getState().setSettingsSection('editor'));
    fireEvent.click(settings);
    expect(useSettingsStore.getState().isSettingsOpen).toBe(true);
    expect(useSettingsStore.getState().settingsSection).toBeNull();

    fireEvent.click(settings);
    expect(useSettingsStore.getState().isSettingsOpen).toBe(false);
  });

  it('leaves Settings when another rail destination is picked', () => {
    // The rail is clickable above the Settings scrim, so a rail click has to
    // close the sheet itself; before #121 the action ran underneath it.
    render(<IconRail />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings (Command Comma)' }));
    expect(useSettingsStore.getState().isSettingsOpen).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Graph (Command Shift G)' }));
    expect(useSettingsStore.getState().isSettingsOpen).toBe(false);
    expect(useGraphStore.getState().isOpen).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Settings (Command Comma)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Timeline' }));
    expect(useSettingsStore.getState().isSettingsOpen).toBe(false);
    expect(useTimelineStore.getState().isOpen).toBe(true);
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

  it('names its buttons without keyboard shortcuts on a phone', () => {
    vi.mocked(isMobilePlatform).mockReturnValue(true);
    render(<IconRail />);

    for (const name of ['Index', 'Search', 'Agenda', 'Graph', 'Timeline', 'Settings', 'Trash']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: /Command/ })).not.toBeInTheDocument();
  });

  it('raises the keyboard in the tap that opens Search on a phone', () => {
    vi.mocked(isMobilePlatform).mockReturnValue(true);
    render(<IconRail />);

    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(useQuickSwitcherStore.getState().isOpen).toBe(true);
    // The stand-in field the switcher's input takes the focus from.
    expect(document.activeElement).toBeInstanceOf(HTMLInputElement);
    (document.activeElement as HTMLInputElement).blur();
  });

  it('opens the Trash as a page on a phone, one of the exclusive surfaces', () => {
    vi.mocked(isMobilePlatform).mockReturnValue(true);
    render(<IconRail />);

    const button = screen.getByRole('button', { name: 'Trash' });
    fireEvent.click(button);
    expect(useOverlayStore.getState().activeOverlay).toBe('trash');
    expect(button).toHaveAttribute('data-active', 'true');
    expect(screen.queryByTestId('trash-popover')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Index' }));
    expect(useOverlayStore.getState().activeOverlay).toBe('index');
    expect(button).not.toHaveAttribute('data-active');
  });

  it('lights only Settings while phone Settings covers an open page', () => {
    vi.mocked(isMobilePlatform).mockReturnValue(true);
    render(<IconRail />);

    fireEvent.click(screen.getByRole('button', { name: 'Index' }));
    act(() => useSettingsStore.getState().setIsSettingsOpen(true));

    expect(screen.getByRole('button', { name: 'Index' })).not.toHaveAttribute('data-active');
    expect(screen.getByRole('button', { name: 'Settings' })).toHaveAttribute('data-active', 'true');
  });

  it('opens the existing trash surface from the bottom action', async () => {
    render(<IconRail />);

    const button = screen.getByRole('button', { name: 'Trash' });
    fireEvent.click(button);

    expect(await screen.findByTestId('trash-popover')).toBeInTheDocument();
    expect(button).toHaveAttribute('data-active', 'true');
    expect(trash.loadTrash).toHaveBeenCalled();
  });

  it('keeps its hairline on the edge facing the note, on either side', () => {
    const { rerender } = render(<IconRail />);
    const rail = screen.getByRole('complementary', { name: 'App navigation' });
    expect(rail).toHaveAttribute('data-side', 'left');
    expect(rail.style.borderRight).toContain('var(--border-default)');
    expect(rail.style.borderLeft).toBe('');

    rerender(<IconRail side="right" />);
    expect(rail).toHaveAttribute('data-side', 'right');
    expect(rail.style.borderLeft).toContain('var(--border-default)');
    expect(rail.style.borderRight).toBe('');
  });

  // jsdom does no layout and never computes a pseudo-element, so the flip is
  // pinned by the stylesheet rules the `data-side` attribute selects.
  it('opens its tooltips towards the note when the rail is on the right', () => {
    // Vitest runs with `css: false`, which empties a `?raw` stylesheet import.
    const stylesheet = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8');
    const rule = (selector: string) => {
      const start = stylesheet.indexOf(`${selector} {`);
      expect(start).toBeGreaterThan(-1);
      return stylesheet.slice(start, stylesheet.indexOf('}', start));
    };

    expect(rule('.icon-rail [data-tooltip]::after')).toContain('left: calc(100% + 8px)');
    const right = rule(".icon-rail[data-side='right'] [data-tooltip]::after");
    expect(right).toContain('right: calc(100% + 8px)');
    expect(right).toContain('left: auto');
  });

  describe('in the phone stylesheet', () => {
    const mobileCss = readFileSync(join(process.cwd(), 'src/mobile.css'), 'utf8');
    const rule = (selector: string, from = 0) => {
      const start = mobileCss.indexOf(`${selector} {`, from);
      expect(start).toBeGreaterThan(-1);
      return mobileCss.slice(start, mobileCss.indexOf('}', start));
    };

    it('leaves the safe-area inset to the rail on its own edge and to pages on the other', () => {
      const root = rule(
        "html[data-platform='mobile']",
        mobileCss.indexOf('The edge without the rail')
      );
      expect(root).toContain('--page-safe-left: var(--safe-left)');
      expect(root).toContain('--page-safe-right: var(--safe-right)');
      expect(
        rule("html[data-platform='mobile'].has-icon-rail:not(.focus-mode):not(.icon-rail-right)")
      ).toContain('--page-safe-left: 0px');
      expect(
        rule("html[data-platform='mobile'].has-icon-rail.icon-rail-right:not(.focus-mode)")
      ).toContain('--page-safe-right: 0px');

      for (const bar of ['.mobile-formatting-bar', '.backlinks-panel']) {
        const padded = rule(`html[data-platform='mobile'] ${bar}`);
        expect(padded).toContain('padding-left: var(--page-safe-left)');
        expect(padded).toContain('padding-right: var(--page-safe-right)');
      }
      for (const surface of ['.editor-paper', '.editor-footer', '.timeline-view-header']) {
        expect(rule(`html[data-platform='mobile'] ${surface}`)).toMatch(
          /var\(--page-safe-left\)[\s\S]*var\(--page-safe-right\)|var\(--page-safe-right\)[\s\S]*var\(--page-safe-left\)/
        );
      }
    });

    it('moves the active marker to the hairline on a landscape phone, on either side', () => {
      const landscape = mobileCss.indexOf(
        '@media (orientation: landscape) and (max-height: 500px)'
      );
      expect(landscape).toBeGreaterThan(-1);
      expect(
        rule(
          "html[data-platform='mobile'] .icon-rail [data-tooltip].icon-rail-button[data-active='true']",
          landscape
        )
      ).toContain('border-right-color: var(--text-primary)');
      const right = mobileCss.slice(
        landscape,
        mobileCss.indexOf('border-left-color: var(--text-primary)', landscape)
      );
      expect(right).toContain(".icon-rail[data-side='right']");
      expect(right).toContain('border-left: 2px solid transparent');
    });
  });
});
