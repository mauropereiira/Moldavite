import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useOverlayStore, useSettingsStore, useTimelineStore } from '@/stores';
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
});
