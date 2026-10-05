import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { format } from 'date-fns';
import { useNoteStore, useOverlayStore, useSettingsStore, useTimelineStore } from '@/stores';
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
  IconRail: ({ side }: { side?: string }) => (
    <aside data-testid="icon-rail" data-side={side}>
      Rail
    </aside>
  ),
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
    expect(screen.getByRole('navigation', { name: 'App navigation' })).toBeInTheDocument();
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

  describe('with the rail on the right', () => {
    beforeEach(() => {
      useSettingsStore.setState({
        iconRailSide: 'right',
        indexMode: 'pinned',
        agendaMode: 'pinned',
      });
    });

    it('puts the rail on the right edge with the Index beside it and the Agenda opposite', () => {
      render(<Layout />);

      const rail = screen.getByTestId('icon-rail');
      const content = screen.getByTestId('app-content-area');
      expect(rail).toHaveAttribute('data-side', 'right');
      expect(content.parentElement?.firstElementChild).toBe(content);
      expect(content.parentElement?.lastElementChild).toBe(rail);
      expect(document.documentElement).toHaveClass('icon-rail-right');

      const columns = Array.from(content.children);
      const indexColumn = screen.getByTestId('sidebar').parentElement as HTMLElement;
      const agendaColumn = screen.getByTestId('right-panel').parentElement as HTMLElement;
      const editorColumn = screen.getByTestId('editor').parentElement as HTMLElement;
      expect(columns.indexOf(agendaColumn)).toBeLessThan(columns.indexOf(editorColumn));
      expect(columns.indexOf(editorColumn)).toBeLessThan(columns.indexOf(indexColumn));

      // Hairlines stay on each column's edge facing the note.
      expect(indexColumn.style.borderLeft).toContain('var(--border-default)');
      expect(indexColumn.style.borderRight).toBe('');
      expect(agendaColumn.style.borderRight).toContain('var(--border-default)');
      expect(agendaColumn.style.borderLeft).toBe('');
      expect(indexColumn.querySelector('.cursor-col-resize')).toHaveClass('left-0');
      expect(agendaColumn.querySelector('.cursor-col-resize')).toHaveClass('right-0');
    });

    it('widens each column when its handle is dragged towards the note', () => {
      useSettingsStore.setState({ sidebarWidth: 280, rightPanelWidth: 288 });
      render(<Layout />);

      const indexHandle = screen
        .getByTestId('sidebar')
        .parentElement?.querySelector('.cursor-col-resize') as HTMLElement;
      fireEvent.mouseDown(indexHandle, { clientX: 900 });
      fireEvent.mouseMove(document, { clientX: 860 });
      fireEvent.mouseUp(document);
      expect(useSettingsStore.getState().sidebarWidth).toBe(320);

      const agendaHandle = screen
        .getByTestId('right-panel')
        .parentElement?.querySelector('.cursor-col-resize') as HTMLElement;
      fireEvent.mouseDown(agendaHandle, { clientX: 300 });
      fireEvent.mouseMove(document, { clientX: 340 });
      fireEvent.mouseUp(document);
      expect(useSettingsStore.getState().rightPanelWidth).toBe(328);
    });

    it('drops the right-edge class when the rail goes back to the left', () => {
      render(<Layout />);
      act(() => useSettingsStore.getState().setIconRailSide('left'));

      const content = screen.getByTestId('app-content-area');
      expect(content.parentElement?.firstElementChild).toBe(screen.getByTestId('icon-rail'));
      expect(document.documentElement).not.toHaveClass('icon-rail-right');
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

  // The footer's Index · Agenda · Settings menu repeated the rail beside it.
  it('leaves Index, Agenda and Settings to the rail', () => {
    render(<Layout />);

    expect(screen.getByTestId('icon-rail')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'App navigation' })).not.toBeInTheDocument();
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
