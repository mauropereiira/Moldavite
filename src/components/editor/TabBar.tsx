/**
 * The top bar: pinned notes first, as compact tabs, then the open tabs.
 *
 * One pin list for the whole app, `quickSwitcherStore.pinnedNoteIds`, so a note
 * pinned here is pinned in the Quick Switcher, the Index and More too. A pin
 * stays in the bar whether or not its note is open; an open tab stays until it
 * is closed or the preview slot reuses it (see `noteStore.openTab`).
 *
 * Tabs that do not fit fold into the Open tabs menu at the end of the bar,
 * which lists everything with pin and close on every row. The active tab never
 * folds. Widths come from an invisible copy of every tab, so the decision does
 * not depend on which tabs happen to be on screen. A phone shows only the note
 * you are reading and keeps the rest in that menu.
 *
 * With the tab bar turned off in Settings it shows only the pins, and only
 * while something is pinned, as the separate pinned bar used to.
 */

import React, { memo, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, Pin, PinOff, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useNoteStore, useQuickSwitcherStore, useSettingsStore } from '@/stores';
import { useNotes } from '@/hooks';
import { filenameToNote } from '@/lib';
import { isLooseId, looseDisplayPath } from '@/lib/looseId';
import { isMobilePlatform, isTabletPlatform } from '@/lib/platform';
import type { Note, NoteFile } from '@/types';
import { fitTabs } from './tabOverflow';
import { OpenTabsMenu, TabContextMenu, type BarActions, type BarItem } from './OpenTabsMenu';

/** Mirror `.tab-strip`'s gap and `.tabs-divider`'s width plus margins in index.css. */
const TAB_GAP = 2;
const DIVIDER_WIDTH = 1 + 12 + TAB_GAP;

const ICON = { className: 'w-3.5 h-3.5', strokeWidth: 1.25, 'aria-hidden': true } as const;

/**
 * Formats a note's title for display in a tab.
 * Daily notes show "Today" or a formatted date.
 */
function getTabTitle(note: Note): string {
  if (note.isDaily && note.date) {
    const today = new Date();
    const noteDate = new Date(note.date + 'T00:00:00');

    if (
      noteDate.getFullYear() === today.getFullYear() &&
      noteDate.getMonth() === today.getMonth() &&
      noteDate.getDate() === today.getDate()
    ) {
      return 'Today';
    }

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (
      noteDate.getFullYear() === yesterday.getFullYear() &&
      noteDate.getMonth() === yesterday.getMonth() &&
      noteDate.getDate() === yesterday.getDate()
    ) {
      return 'Yesterday';
    }

    return noteDate.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  }

  return note.title || 'Untitled';
}

interface Measured {
  available: number;
  widths: Record<string, number>;
}

export function TabBar() {
  // `useNotes` follows the whole note store, so this re-renders on every
  // keystroke. `loadNote` is stable, so the memoised bar below does not.
  const { loadNote } = useNotes();
  return <TopBar loadNote={loadNote} />;
}

/** Id, label and tooltip of each open tab, flat, so typing in a tab changes nothing here. */
function openTabFields(tabs: Note[]): string[] {
  return tabs.flatMap((tab) => [
    tab.id,
    getTabTitle(tab),
    tab.loose ? looseDisplayPath(tab.loose) : tab.title,
  ]);
}

const TopBar = memo(function TopBar({
  loadNote,
}: {
  loadNote: (note: NoteFile, inNewTab?: boolean) => Promise<void>;
}) {
  const activeTabId = useNoteStore((state) => state.activeTabId);
  const pinnedNoteIds = useQuickSwitcherStore((state) => state.pinnedNoteIds);
  const tabFields = useNoteStore(useShallow((state) => openTabFields(state.openTabs)));
  const pinnedFiles = useNoteStore(
    useShallow((state) => pinnedNoteIds.map((id) => state.notes.find((note) => note.path === id)))
  );
  const showTabBar = useSettingsStore((state) => state.showTabBar);
  const { switchTab, closeTab, reorderTabs } = useNoteStore.getState();
  const { togglePinned, movePinnedNote } = useQuickSwitcherStore.getState();
  const compact = isMobilePlatform() && !isTabletPlatform();
  const openTabs = Array.from({ length: tabFields.length / 3 }, (_, i) => ({
    id: tabFields[i * 3],
    title: tabFields[i * 3 + 1],
    tooltip: tabFields[i * 3 + 2],
  }));

  const [strip, setStrip] = useState<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState<Measured | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; pinned: boolean } | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tabRefs = useRef(new Map<string, HTMLDivElement>());

  // A pin can outlive its note (deleted outside the app), so it is resolved
  // against the open tabs and the note list and simply left out when neither
  // has it.
  const pinnedItems = pinnedNoteIds.flatMap((id, index): BarItem[] => {
    const tab = openTabs.find((candidate) => candidate.id === id);
    if (tab) return [{ ...tab, pinned: true, open: true, canPin: true }];
    const file = pinnedFiles[index];
    if (!file) return [];
    const note = filenameToNote(file, '');
    return [
      {
        id,
        title: getTabTitle(note),
        tooltip: note.title,
        pinned: true,
        open: false,
        canPin: true,
      },
    ];
  });
  const openItems: BarItem[] = showTabBar
    ? openTabs
        .filter((tab) => !pinnedNoteIds.includes(tab.id))
        .map((tab) => ({ ...tab, pinned: false, open: true, canPin: !isLooseId(tab.id) }))
    : [];
  const items = [...pinnedItems, ...openItems];

  const signature = items
    .map((item) => `${item.id}\u0000${item.title}\u0000${item.pinned}`)
    .join('\u0001');
  useLayoutEffect(() => {
    const layer = measureRef.current;
    if (!layer || !strip) return;
    const measure = () => {
      const widths: Record<string, number> = {};
      for (const element of Array.from(layer.children) as HTMLElement[]) {
        if (element.dataset.id) widths[element.dataset.id] = element.offsetWidth;
      }
      const next = { available: strip.clientWidth, widths };
      setMeasured((previous) =>
        previous &&
        previous.available === next.available &&
        JSON.stringify(previous.widths) === JSON.stringify(widths)
          ? previous
          : next
      );
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(strip);
    observer.observe(layer);
    return () => observer.disconnect();
  }, [strip, signature]);

  if (items.length === 0) return null;

  let visibleIds: string[];
  if (compact) {
    visibleIds = items.some((item) => item.id === activeTabId) ? [activeTabId as string] : [];
  } else if (!measured || measured.available === 0) {
    // Not laid out yet (or no layout at all, as in jsdom): show everything
    // rather than guess.
    visibleIds = items.map((item) => item.id);
  } else {
    visibleIds = fitTabs(
      items.map((item) => ({
        id: item.id,
        width: measured.widths[item.id] ?? 0,
        pinned: item.pinned,
      })),
      {
        available: measured.available,
        gap: TAB_GAP,
        divider: DIVIDER_WIDTH,
        activeId: activeTabId,
      }
    ).visible;
  }
  const visible = items.filter((item) => visibleIds.includes(item.id));
  const foldedCount = items.length - visible.length;
  const openCount = items.filter((item) => item.open).length;
  const rovingId = visible.some((item) => item.id === focusedId)
    ? focusedId
    : visible.some((item) => item.id === activeTabId)
      ? activeTabId
      : (visible[0]?.id ?? null);

  const actions: BarActions = {
    open: (item) => {
      if (item.open) {
        switchTab(item.id);
        return;
      }
      const file = pinnedFiles[pinnedNoteIds.indexOf(item.id)];
      if (file) void loadNote(file);
    },
    togglePin: (item) => togglePinned(item.id),
    close: (item) => void closeTab(item.id),
    closeOthers: (keepId) => {
      for (const tab of useNoteStore.getState().openTabs) {
        if (tab.id !== keepId) void closeTab(tab.id);
      }
    },
    closeAll: () => {
      for (const tab of useNoteStore.getState().openTabs) void closeTab(tab.id);
    },
  };

  const moveWithinGroup = (item: BarItem, targetId: string) => {
    if (item.id === targetId) return;
    if (item.pinned) {
      movePinnedNote(pinnedNoteIds.indexOf(item.id), pinnedNoteIds.indexOf(targetId));
      return;
    }
    const ids = useNoteStore.getState().openTabs.map((tab) => tab.id);
    reorderTabs(ids.indexOf(item.id), ids.indexOf(targetId));
  };

  const focusTab = (id: string | undefined) => {
    if (!id) return;
    setFocusedId(id);
    tabRefs.current.get(id)?.focus();
  };

  const onTabKeyDown = (event: React.KeyboardEvent<HTMLDivElement>, item: BarItem) => {
    // Keys pressed on the pin and close buttons inside the tab are theirs.
    if (event.target !== event.currentTarget) return;
    const index = visible.indexOf(item);
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      actions.open(item);
    } else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      setContextMenu({ id: item.id, x: rect.left, y: rect.bottom });
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const step = event.key === 'ArrowLeft' ? -1 : 1;
      if (event.altKey) {
        // The keyboard path to drag-to-reorder, within the tab's own group.
        const group = items.filter((candidate) => candidate.pinned === item.pinned);
        const target = group[group.indexOf(item) + step];
        if (target) moveWithinGroup(item, target.id);
        requestAnimationFrame(() => tabRefs.current.get(item.id)?.focus());
        return;
      }
      focusTab(visible[index + step]?.id);
    }
  };

  const renderTab = (item: BarItem, measuring = false) => {
    const isActive = item.id === activeTabId;
    const controlTabIndex = item.id === rovingId ? 0 : -1;
    const stop = (action: () => void) => (event: React.MouseEvent) => {
      event.stopPropagation();
      action();
    };
    const pinMark = item.pinned && (
      <button
        type="button"
        className="tab-pin-mark"
        tabIndex={controlTabIndex}
        aria-label={`Unpin ${item.title}`}
        title="Unpin"
        onClick={stop(() => togglePinned(item.id))}
      >
        <Pin {...ICON} className={`${ICON.className} tab-glyph-pinned`} />
        <PinOff {...ICON} className={`${ICON.className} tab-glyph-unpin`} />
      </button>
    );
    const controls = !item.pinned && (
      <>
        {item.canPin && (
          <button
            type="button"
            className="tab-pin"
            tabIndex={controlTabIndex}
            aria-label={`Pin ${item.title}`}
            title="Pin to the top bar"
            onClick={stop(() => togglePinned(item.id))}
          >
            <Pin {...ICON} />
          </button>
        )}
        <button
          type="button"
          className="tab-close"
          tabIndex={controlTabIndex}
          aria-label={`Close ${item.title}`}
          title="Close"
          onClick={stop(() => void closeTab(item.id))}
        >
          <X {...ICON} />
        </button>
      </>
    );
    const className = [
      'tab select-none',
      isActive && 'active',
      item.pinned && 'tab-pinned',
      drag && overId === item.id && drag.id !== item.id && 'tab-drag-over',
      drag?.id === item.id && 'tab-dragging',
    ]
      .filter(Boolean)
      .join(' ');

    // The measuring copy is the same element, made inert by its layer.
    return (
      <div
        key={item.id}
        data-id={item.id}
        ref={
          measuring
            ? undefined
            : (node) => {
                if (node) tabRefs.current.set(item.id, node);
                else tabRefs.current.delete(item.id);
              }
        }
        className={className}
        role="tab"
        aria-label={item.title}
        aria-selected={isActive}
        tabIndex={item.id === rovingId ? 0 : -1}
        title={item.tooltip}
        onClick={() => actions.open(item)}
        onFocus={(event) => event.target === event.currentTarget && setFocusedId(item.id)}
        onAuxClick={(event) => {
          if (event.button !== 1 || !item.open) return;
          event.preventDefault();
          void closeTab(item.id);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          setContextMenu({ id: item.id, x: event.clientX, y: event.clientY });
        }}
        onKeyDown={(event) => onTabKeyDown(event, item)}
        draggable={!compact}
        onDragStart={(event) => {
          setDrag({ id: item.id, pinned: item.pinned });
          event.dataTransfer.effectAllowed = 'move';
          // Firefox refuses to start a drag without a payload.
          event.dataTransfer.setData('text/plain', item.id);
        }}
        onDragEnd={() => {
          setDrag(null);
          setOverId(null);
        }}
        onDragOver={(event) => {
          if (!drag || drag.pinned !== item.pinned) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          setOverId(item.id);
        }}
        onDragLeave={() => setOverId((current) => (current === item.id ? null : current))}
        onDrop={(event) => {
          event.preventDefault();
          const dragged = items.find((candidate) => candidate.id === drag?.id);
          if (dragged && dragged.pinned === item.pinned) moveWithinGroup(dragged, item.id);
          setDrag(null);
          setOverId(null);
        }}
      >
        {pinMark}
        <span className="tab-title">{item.title}</span>
        {controls}
      </div>
    );
  };

  const visiblePinned = visible.filter((item) => item.pinned);
  const visibleOpen = visible.filter((item) => !item.pinned);
  const contextItem = contextMenu && items.find((item) => item.id === contextMenu.id);

  return (
    <div
      className="tab-bar select-none"
      data-compact={compact || undefined}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusedId(null);
      }}
    >
      <div ref={setStrip} className="tab-strip" role="tablist" aria-label="Top bar">
        {visiblePinned.map((item) => renderTab(item))}
        {visiblePinned.length > 0 && visibleOpen.length > 0 && (
          <div className="tabs-divider" aria-hidden="true" />
        )}
        {visibleOpen.map((item) => renderTab(item))}
        {!compact && (
          <div ref={measureRef} className="tab-measure" aria-hidden="true" inert>
            {items.map((item) => renderTab(item, true))}
          </div>
        )}
      </div>

      {/* A phone with no note open folds even a single pin into the menu. */}
      {(items.length > 1 || foldedCount > 0) && (
        <button
          ref={triggerRef}
          type="button"
          className="tab-overflow"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={foldedCount > 0 ? `Open tabs, ${foldedCount} more` : 'Open tabs'}
          title="Open tabs"
          onClick={() => setMenuOpen((open) => !open)}
        >
          {compact && <span className="tab-overflow-label">Tabs</span>}
          {foldedCount > 0 && (
            <span className="tab-overflow-count">{compact ? items.length : `+${foldedCount}`}</span>
          )}
          <ChevronDown {...ICON} />
        </button>
      )}

      {menuOpen && (
        <OpenTabsMenu
          items={items}
          activeId={activeTabId}
          actions={actions}
          trigger={triggerRef.current}
          onClose={(restoreFocus) => {
            setMenuOpen(false);
            if (restoreFocus) triggerRef.current?.focus();
          }}
        />
      )}

      {contextItem && contextMenu && (
        <TabContextMenu
          item={contextItem}
          x={contextMenu.x}
          y={contextMenu.y}
          openCount={openCount}
          actions={actions}
          onClose={(restoreFocus) => {
            setContextMenu(null);
            if (restoreFocus) tabRefs.current.get(contextItem.id)?.focus();
          }}
        />
      )}
    </div>
  );
});
