import { fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  useGraphStore,
  useOverlayStore,
  useQuickSwitcherStore,
  useSettingsStore,
  useTimelineStore,
} from '@/stores';
import { ChromeShortcutHost } from './ChromeShortcutHost';

describe('ChromeShortcutHost modes', () => {
  beforeEach(() => {
    useSettingsStore.getState().resetToDefaults();
    useOverlayStore.setState({
      activeOverlay: null,
      isSidebarHidden: false,
      isRightPanelHidden: false,
    });
  });

  it('does nothing for Index and Agenda shortcuts when their modes are off', () => {
    useSettingsStore.setState({ indexMode: 'off', agendaMode: 'off' });
    render(<ChromeShortcutHost />);

    fireEvent.keyDown(window, { key: '\\', code: 'Backslash', metaKey: true });
    fireEvent.keyDown(window, {
      key: '«',
      code: 'Backslash',
      metaKey: true,
      altKey: true,
    });

    expect(useOverlayStore.getState()).toMatchObject({
      activeOverlay: null,
      isSidebarHidden: false,
      isRightPanelHidden: false,
    });
  });

  const agendaShortcut = () =>
    fireEvent.keyDown(window, {
      key: '«',
      code: 'Backslash',
      metaKey: true,
      altKey: true,
    });

  it('uses the selected overlay and pinned forms', () => {
    useSettingsStore.setState({ indexMode: 'overlay', agendaMode: 'pinned' });
    render(<ChromeShortcutHost />);

    fireEvent.keyDown(window, { key: '\\', code: 'Backslash', metaKey: true });
    expect(useOverlayStore.getState().activeOverlay).toBe('index');

    // The Index overlay covers the pinned Agenda column, so the first Agenda
    // press means "show me the Agenda": dismiss the overlay, keep the column.
    agendaShortcut();
    expect(useOverlayStore.getState()).toMatchObject({
      activeOverlay: null,
      isRightPanelHidden: false,
    });

    // With nothing covering it, the pinned form toggles the column itself.
    agendaShortcut();
    expect(useOverlayStore.getState()).toMatchObject({
      activeOverlay: null,
      isRightPanelHidden: true,
    });
  });
});

describe('ChromeShortcutHost surfaces', () => {
  beforeEach(() => {
    useSettingsStore.getState().resetToDefaults();
    useOverlayStore.setState({
      activeOverlay: null,
      isSidebarHidden: false,
      isRightPanelHidden: false,
    });
  });

  const escape = () => fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });

  const surfaces = [
    { name: 'index', open: () => useOverlayStore.getState().openIndex(false) },
    { name: 'agenda', open: () => useOverlayStore.getState().openAgenda(false) },
    { name: 'graph', open: () => useGraphStore.getState().open() },
    { name: 'timeline', open: () => useTimelineStore.getState().open() },
    { name: 'search', open: () => useQuickSwitcherStore.getState().open() },
  ];

  it.each(surfaces)('closes the active $name surface on Escape', ({ open }) => {
    render(<ChromeShortcutHost />);

    open();
    escape();

    expect(useOverlayStore.getState().activeOverlay).toBeNull();
    expect(useGraphStore.getState().isOpen).toBe(false);
    expect(useTimelineStore.getState().isOpen).toBe(false);
    expect(useQuickSwitcherStore.getState().isOpen).toBe(false);
  });

  it('toggles Search and Graph from the keyboard like their rail buttons', () => {
    render(<ChromeShortcutHost />);

    fireEvent.keyDown(window, { key: 'p', code: 'KeyP', metaKey: true });
    expect(useQuickSwitcherStore.getState().isOpen).toBe(true);

    fireEvent.keyDown(window, { key: 'G', code: 'KeyG', metaKey: true, shiftKey: true });
    expect(useGraphStore.getState().isOpen).toBe(true);
    expect(useQuickSwitcherStore.getState().isOpen).toBe(false);

    fireEvent.keyDown(window, { key: 'G', code: 'KeyG', metaKey: true, shiftKey: true });
    expect(useGraphStore.getState().isOpen).toBe(false);

    fireEvent.keyDown(window, { key: 'p', code: 'KeyP', metaKey: true });
    fireEvent.keyDown(window, { key: 'p', code: 'KeyP', metaKey: true });
    expect(useQuickSwitcherStore.getState().isOpen).toBe(false);
  });
});
