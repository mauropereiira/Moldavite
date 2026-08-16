import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useNoteStore,
  useOverlayStore,
  useQuickSwitcherStore,
  useSettingsStore,
  useTimelineStore,
} from '@/stores';
import { Layout } from './Layout';

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
});
