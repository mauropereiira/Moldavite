import { beforeEach, describe, expect, it } from 'vitest';
import { useOverlayStore, type AppOverlay } from './overlayStore';
import { useSettingsStore } from './settingsStore';
import { useGraphStore } from './graphStore';
import { useTimelineStore } from './timelineStore';
import { useQuickSwitcherStore } from './quickSwitcherStore';

describe('overlayStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useOverlayStore.setState({
      activeOverlay: null,
      isSidebarHidden: false,
      isRightPanelHidden: false,
    });
    useSettingsStore.getState().resetToDefaults();
  });

  it('defaults both chrome preferences to overlay mode', () => {
    const settings = useSettingsStore.getState();
    expect(settings.indexMode).toBe('overlay');
    expect(settings.agendaMode).toBe('overlay');
  });

  it('keeps summoned overlays mutually exclusive', () => {
    const overlay = useOverlayStore.getState();

    overlay.openIndex(false);
    expect(useOverlayStore.getState().activeOverlay).toBe('index');

    overlay.openAgenda(false);
    expect(useOverlayStore.getState().activeOverlay).toBe('agenda');
  });

  it('toggles visibility without changing an unpinned preference', () => {
    useOverlayStore.getState().toggleIndex(false);
    expect(useOverlayStore.getState().activeOverlay).toBe('index');
    expect(useSettingsStore.getState().indexMode).toBe('overlay');

    useOverlayStore.getState().toggleIndex(false);
    expect(useOverlayStore.getState().activeOverlay).toBeNull();
  });

  it('keeps every surface exclusive, whichever store you open it from', () => {
    const surfaces: { surface: AppOverlay; open: () => void }[] = [
      { surface: 'index', open: () => useOverlayStore.getState().openIndex(false) },
      { surface: 'agenda', open: () => useOverlayStore.getState().openAgenda(false) },
      { surface: 'graph', open: () => useGraphStore.getState().open() },
      { surface: 'timeline', open: () => useTimelineStore.getState().open() },
      { surface: 'search', open: () => useQuickSwitcherStore.getState().open() },
    ];

    for (const previous of surfaces) {
      for (const next of surfaces) {
        previous.open();
        expect(useOverlayStore.getState().activeOverlay).toBe(previous.surface);

        next.open();
        expect(useOverlayStore.getState().activeOverlay).toBe(next.surface);
      }
    }
  });

  it('mirrors the active surface onto the per-surface stores', () => {
    useGraphStore.getState().open();
    expect(useGraphStore.getState().isOpen).toBe(true);

    useTimelineStore.getState().open();
    expect(useGraphStore.getState().isOpen).toBe(false);
    expect(useTimelineStore.getState().isOpen).toBe(true);

    useQuickSwitcherStore.getState().toggle();
    expect(useTimelineStore.getState().isOpen).toBe(false);
    expect(useQuickSwitcherStore.getState().isOpen).toBe(true);

    useOverlayStore.getState().closeOverlay();
    expect(useQuickSwitcherStore.getState().isOpen).toBe(false);
  });

  it('closes a surface only from its own store', () => {
    useGraphStore.getState().open();

    useTimelineStore.getState().close();
    expect(useGraphStore.getState().isOpen).toBe(true);

    useGraphStore.getState().close();
    expect(useOverlayStore.getState().activeOverlay).toBeNull();
  });

  it('temporarily hides pinned columns without changing the pin', () => {
    useSettingsStore.getState().setIndexMode('pinned');
    useSettingsStore.getState().setAgendaMode('pinned');

    useOverlayStore.getState().toggleIndex(true);
    useOverlayStore.getState().toggleAgenda(true);

    const overlay = useOverlayStore.getState();
    expect(overlay.isSidebarHidden).toBe(true);
    expect(overlay.isRightPanelHidden).toBe(true);
    expect(overlay.activeOverlay).toBeNull();
    expect(useSettingsStore.getState().indexMode).toBe('pinned');
    expect(useSettingsStore.getState().agendaMode).toBe('pinned');
  });
});
