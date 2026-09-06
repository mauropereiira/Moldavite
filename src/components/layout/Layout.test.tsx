import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { format } from 'date-fns';
import {
  useNoteStore,
  useOverlayStore,
  useQuickSwitcherStore,
  useSettingsStore,
  useTimelineStore,
} from '@/stores';
import { isMobilePlatform, isTabletPlatform } from '@/lib/platform';
import { useElementWidth } from '@/hooks/useElementWidth';
import type { Note } from '@/types';
import { Layout } from './Layout';

vi.mock('@/lib/platform', () => ({
  isMobilePlatform: vi.fn(() => false),
  isTabletPlatform: vi.fn(() => false),
}));
vi.mock('@/hooks/useElementWidth', () => ({ useElementWidth: vi.fn(() => null) }));

const notes = vi.hoisted(() => ({
  loadDailyNote: vi.fn(async (_date: Date) => undefined),
}));

vi.mock('@/hooks/useNotes', () => ({
  useNotes: () => ({ loadDailyNote: notes.loadDailyNote }),
}));

vi.mock('../editor/Editor', () => ({
  Editor: () => <main data-testid="editor">Editor</main>,
}));

vi.mock('../sidebar/Sidebar', () => ({
  Sidebar: () => <aside data-testid="sidebar">Sidebar</aside>,
}));

vi.mock('./RightPanel', () => ({
  RightPanel: () => <aside data-testid="right-panel">Right panel</aside>,
}));

vi.mock('./IconRail', () => ({
  IconRail: () => <aside data-testid="icon-rail">Rail</aside>,
}));

vi.mock('@/components/index-overlay/IndexOverlay', () => ({
  IndexOverlay: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <section data-testid="index-overlay">Index</section> : null,
}));

vi.mock('@/components/agenda-overlay/AgendaOverlay', () => ({
  AgendaOverlay: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <section data-testid="agenda-overlay">Agenda</section> : null,
}));

describe('Layout navigation surfaces', () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.getState().resetToDefaults();
    useOverlayStore.setState({
      activeOverlay: null,
      isSidebarHidden: false,
      isRightPanelHidden: false,
    });
    useTimelineStore.getState().close();
  });

  it('renders the default rail and editor with both surfaces in overlay mode', () => {
    render(<Layout />);

    expect(screen.getByTestId('icon-rail')).toBeInTheDocument();
    expect(screen.getByTestId('editor')).toBeInTheDocument();
    expect(screen.queryByTestId('sidebar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('right-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('index-overlay')).not.toBeInTheDocument();
    expect(screen.queryByTestId('agenda-overlay')).not.toBeInTheDocument();
  });

  it('uses the same transient toggle to hide a pinned sidebar', () => {
    useSettingsStore.getState().setIndexMode('pinned');
    render(<Layout />);
    expect(screen.getByTestId('sidebar')).toBeInTheDocument();

    act(() => useOverlayStore.getState().toggleIndex(true));

    expect(screen.queryByTestId('sidebar')).not.toBeInTheDocument();
    expect(useSettingsStore.getState().indexMode).toBe('pinned');
    expect(screen.queryByTestId('index-overlay')).not.toBeInTheDocument();
  });

  it('keeps both pinned columns inside the content sibling beside the rail', () => {
    useSettingsStore.getState().setIndexMode('pinned');
    useSettingsStore.getState().setAgendaMode('pinned');
    render(<Layout />);

    const contentArea = screen.getByTestId('app-content-area');
    expect(screen.getByTestId('sidebar').parentElement?.parentElement).toBe(contentArea);
    expect(screen.getByTestId('right-panel').parentElement?.parentElement).toBe(contentArea);
    expect(screen.getByTestId('right-panel').parentElement).toHaveClass('min-h-0');
  });

  it('removes the rail when its layout setting is off', () => {
    useSettingsStore.setState({ showIconRail: false });
    render(<Layout />);

    expect(screen.queryByTestId('icon-rail')).not.toBeInTheDocument();
  });

  it('insets overlays through the rail content sibling only while the rail is shown', () => {
    render(<Layout />);

    act(() => useOverlayStore.getState().openIndex(false));

    const rail = screen.getByTestId('icon-rail');
    const contentArea = screen.getByTestId('app-content-area');
    expect(screen.getByTestId('index-overlay').parentElement).toBe(contentArea);

    act(() => useOverlayStore.getState().openAgenda(false));

    expect(rail.parentElement).toBe(contentArea.parentElement);
    expect(screen.getByTestId('agenda-overlay').parentElement).toBe(contentArea);
    expect(contentArea).toHaveClass('flex-1', 'min-w-0');
    expect(contentArea.parentElement?.firstElementChild).toBe(rail);

    act(() => useSettingsStore.setState({ showIconRail: false }));

    expect(screen.queryByTestId('icon-rail')).not.toBeInTheDocument();
    expect(screen.getByTestId('agenda-overlay').parentElement).toBe(contentArea);
    expect(contentArea.parentElement?.firstElementChild).toBe(contentArea);
  });

  it('replaces one unpinned overlay with the other', () => {
    render(<Layout />);

    act(() => useOverlayStore.getState().openIndex(false));
    expect(screen.getByTestId('index-overlay')).toBeInTheDocument();

    act(() => useOverlayStore.getState().openAgenda(false));
    expect(screen.queryByTestId('index-overlay')).not.toBeInTheDocument();
    expect(screen.getByTestId('agenda-overlay')).toBeInTheDocument();
  });

  // The pinned bar used to live inside the editor column, as a sibling above an
  // editor whose root is `h-full`. That made the column taller than its box and
  // pushed the editor's own footer — Colour, WordPress, Share, Format, More —
  // out of view, so those controls vanished exactly when a note was pinned.
  // It belongs above the whole app: full width, outside the content row.
  it('puts the pinned bar above the content row, not inside the editor column', () => {
    useQuickSwitcherStore.setState({ pinnedNoteIds: ['notes/roadmap.md'] });
    useNoteStore.setState({
      notes: [
        {
          name: 'roadmap.md',
          path: 'notes/roadmap.md',
          isDaily: false,
          isWeekly: false,
          isLocked: false,
        },
      ] as never,
      currentNote: null,
    });

    render(<Layout />);

    const bar = screen.getByRole('navigation', { name: 'Pinned notes' });
    const content = screen.getByTestId('app-content-area');
    // Not a descendant of the content area, and therefore not of the editor
    // column inside it.
    expect(content.contains(bar)).toBe(false);
    // Ordered before it in the document, so it reads as a bar across the top.
    expect(bar.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // The pinned bar is the newest thing in this tree and the one most likely to
  // be broken by a layout change: it sits outside the content row, so every
  // combination of rail, pinned columns and overlays has to leave it alone.
  // It already regressed once by being inside the editor column, where it
  // pushed the editor's own footer out of view.
  describe('pinned bar across layout combinations', () => {
    const pinOne = () => {
      useQuickSwitcherStore.setState({ pinnedNoteIds: ['notes/roadmap.md'] });
      useNoteStore.setState({
        notes: [
          {
            name: 'roadmap.md',
            path: 'notes/roadmap.md',
            isDaily: false,
            isWeekly: false,
            isLocked: false,
          },
        ] as never,
        currentNote: null,
      });
    };

    const combos: Array<[string, () => void]> = [
      ['rail off', () => useSettingsStore.setState({ showIconRail: false })],
      ['index pinned', () => useSettingsStore.setState({ indexMode: 'pinned' })],
      ['agenda pinned', () => useSettingsStore.setState({ agendaMode: 'pinned' })],
      [
        'both columns pinned',
        () => useSettingsStore.setState({ indexMode: 'pinned', agendaMode: 'pinned' }),
      ],
      [
        'both pinned and no rail',
        () =>
          useSettingsStore.setState({
            indexMode: 'pinned',
            agendaMode: 'pinned',
            showIconRail: false,
          }),
      ],
      ['index overlay open', () => useOverlayStore.setState({ activeOverlay: 'index' })],
      ['agenda overlay open', () => useOverlayStore.setState({ activeOverlay: 'agenda' })],
      ['timeline replacing the editor', () => useTimelineStore.getState().open()],
    ];

    for (const [name, configure] of combos) {
      it(`stays outside the content row with ${name}`, () => {
        pinOne();
        act(configure);
        render(<Layout />);

        const bar = screen.getByRole('navigation', { name: 'Pinned notes' });
        const content = screen.getByTestId('app-content-area');
        expect(content.contains(bar)).toBe(false);
        expect(
          bar.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING
        ).toBeTruthy();
      });
    }

    // The bar renders above the rail too, so the rail must not be its parent
    // and must still be reachable beside the content.
    it('does not swallow the icon rail', () => {
      pinOne();
      render(<Layout />);

      const bar = screen.getByRole('navigation', { name: 'Pinned notes' });
      expect(bar.contains(screen.getByTestId('icon-rail'))).toBe(false);
      expect(screen.getByTestId('icon-rail')).toBeInTheDocument();
    });

    // With nothing pinned there must be no row at all — an empty bar costs a
    // strip of vertical space in an app whose argument is that the note is the
    // only thing on screen that earned its place.
    it('renders nothing when no note is pinned, whatever else is open', () => {
      useQuickSwitcherStore.setState({ pinnedNoteIds: [] });
      act(() => useSettingsStore.setState({ indexMode: 'pinned', agendaMode: 'pinned' }));
      render(<Layout />);

      expect(screen.queryByRole('navigation', { name: 'Pinned notes' })).not.toBeInTheDocument();
    });
  });

  it('renders the resize handles beside pinned columns on desktop', () => {
    useSettingsStore.setState({ indexMode: 'pinned', agendaMode: 'pinned' });
    const { container } = render(<Layout />);

    expect(container.querySelectorAll('.cursor-col-resize').length).toBeGreaterThan(0);
    expect(container.firstElementChild).toHaveClass('h-screen');
    expect(screen.queryByRole('banner')).not.toBeInTheDocument();
  });
});

describe('Layout on a phone', () => {
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const todayNote: Note = {
    id: `daily/${todayStr}.md`,
    title: 'Today',
    content: '<p>Hi</p>',
    createdAt: new Date(),
    updatedAt: new Date(),
    isDaily: true,
    isWeekly: false,
    date: todayStr,
  };

  beforeEach(() => {
    vi.mocked(isMobilePlatform).mockReturnValue(true);
    vi.mocked(isTabletPlatform).mockReturnValue(false);
    vi.mocked(useElementWidth).mockReturnValue(390);
    notes.loadDailyNote.mockClear();
    localStorage.clear();
    useSettingsStore.getState().resetToDefaults();
    useOverlayStore.setState({
      activeOverlay: null,
      isSidebarHidden: false,
      isRightPanelHidden: false,
    });
    useTimelineStore.getState().close();
    useNoteStore.setState({
      notes: [],
      openTabs: [],
      activeTabId: null,
      currentNote: null,
      isLoading: false,
    });
  });

  afterEach(() => {
    vi.mocked(isMobilePlatform).mockReturnValue(false);
    vi.mocked(isTabletPlatform).mockReturnValue(false);
    vi.mocked(useElementWidth).mockReturnValue(null);
    document.documentElement.style.removeProperty('--app-height');
  });

  it('keeps saved pinned desktop columns out of the phone layout', () => {
    useSettingsStore.setState({ indexMode: 'pinned', agendaMode: 'pinned' });
    useNoteStore.setState({
      openTabs: [todayNote],
      activeTabId: todayNote.id,
      currentNote: todayNote,
    });
    const { container } = render(<Layout />);

    expect(screen.queryByTestId('sidebar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('right-panel')).not.toBeInTheDocument();
    expect(container.querySelectorAll('.cursor-col-resize')).toHaveLength(0);
  });

  it('keeps an iPhone in page navigation when rotated', () => {
    vi.mocked(useElementWidth).mockReturnValue(852);
    render(<Layout />);
    expect(useSettingsStore.getState().indexMode).toBe('overlay');
    expect(screen.queryByTestId('sidebar')).not.toBeInTheDocument();
  });

  it('keeps the iPad editor and note intact while its window changes width', () => {
    vi.mocked(isTabletPlatform).mockReturnValue(true);
    vi.mocked(useElementWidth).mockReturnValue(744);
    useNoteStore.setState({
      openTabs: [todayNote],
      activeTabId: todayNote.id,
      currentNote: todayNote,
    });
    const { rerender, container } = render(<Layout />);
    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('editor')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar').parentElement).toHaveStyle({ width: '280px' });
    expect(screen.queryByTestId('right-panel')).not.toBeInTheDocument();
    expect(container.querySelectorAll('.cursor-col-resize')).toHaveLength(0);

    vi.mocked(useElementWidth).mockReturnValue(500);
    rerender(<Layout />);
    expect(screen.queryByTestId('sidebar')).not.toBeInTheDocument();
    expect(useSettingsStore.getState().indexMode).toBe('overlay');
    expect(useNoteStore.getState().currentNote).toEqual(todayNote);

    vi.mocked(useElementWidth).mockReturnValue(1000);
    rerender(<Layout />);
    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    expect(useNoteStore.getState().activeTabId).toBe(todayNote.id);
  });

  it('sizes the shell from the visual viewport instead of the screen', () => {
    useNoteStore.setState({
      openTabs: [todayNote],
      activeTabId: todayNote.id,
      currentNote: todayNote,
    });
    const { container } = render(<Layout />);

    const shell = container.firstElementChild as HTMLElement;
    expect(shell).not.toHaveClass('h-screen');
    expect(shell.style.height).toBe('var(--app-height)');
    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe(
      `${window.innerHeight}px`
    );
  });
});
