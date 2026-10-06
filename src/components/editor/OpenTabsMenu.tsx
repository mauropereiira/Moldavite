/**
 * The top bar's two menus: Open tabs, the list of everything in the bar, and
 * the context menu of a single tab. Both are grids of buttons: up and down move
 * between rows, left and right between a row's actions, Escape closes and
 * hands focus back to whatever opened the menu.
 */

import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { Pin, PinOff, X } from 'lucide-react';

export interface BarItem {
  id: string;
  title: string;
  tooltip: string;
  pinned: boolean;
  /** Loaded in a tab. A pin that is not open only names its note. */
  open: boolean;
  /** Files outside the Forge have no lasting address to pin. */
  canPin: boolean;
}

export interface BarActions {
  open: (item: BarItem) => void;
  togglePin: (item: BarItem) => void;
  close: (item: BarItem) => void;
  /** Close every open tab except this one. */
  closeOthers: (keepId: string) => void;
  closeAll: () => void;
}

const ICON = { className: 'w-3.5 h-3.5', strokeWidth: 1.25, 'aria-hidden': true } as const;

function rowsOf(menu: HTMLElement): HTMLButtonElement[][] {
  return Array.from(menu.querySelectorAll<HTMLElement>('[data-row]')).map((row) =>
    Array.from(row.querySelectorAll<HTMLButtonElement>('button'))
  );
}

function MenuSurface({
  label,
  className,
  style,
  onClose,
  ignore,
  children,
}: {
  label: string;
  className: string;
  style?: React.CSSProperties;
  onClose: (restoreFocus: boolean) => void;
  /** The control that opened the menu; a press on it toggles rather than dismisses. */
  ignore?: HTMLElement | null;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const lastFocus = useRef<{ row: number; col: number } | null>(null);

  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    (
      menu.querySelector<HTMLElement>('[data-row][data-active] button') ??
      menu.querySelector<HTMLElement>('[data-row] button')
    )?.focus();
  }, []);

  // Pin and Close keep the menu open, and either can take away the row that
  // had the focus. Put it back on the row now in that place.
  useLayoutEffect(() => {
    const menu = ref.current;
    const last = lastFocus.current;
    if (!menu || !last || menu.contains(document.activeElement)) return;
    const rows = rowsOf(menu);
    const row = rows[Math.min(last.row, rows.length - 1)];
    row?.[Math.min(last.col, row.length - 1)]?.focus();
  });

  useEffect(() => {
    const onPointerDown = (event: Event) => {
      const target = event.target as Node;
      if (ref.current?.contains(target) || ignore?.contains(target)) return;
      onClose(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [ignore, onClose]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    const menu = ref.current;
    if (!menu) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose(true);
      return;
    }
    if (event.key === 'Tab') {
      onClose(false);
      return;
    }
    const rows = rowsOf(menu);
    let row = rows.findIndex((buttons) => buttons.includes(event.target as HTMLButtonElement));
    if (row < 0) return;
    let col = rows[row].indexOf(event.target as HTMLButtonElement);
    if (event.key === 'ArrowDown') row = (row + 1) % rows.length;
    else if (event.key === 'ArrowUp') row = (row - 1 + rows.length) % rows.length;
    else if (event.key === 'ArrowRight') col += 1;
    else if (event.key === 'ArrowLeft') col -= 1;
    else if (event.key === 'Home' || event.key === 'End') {
      row = event.key === 'Home' ? 0 : rows.length - 1;
      col = 0;
    } else return;
    event.preventDefault();
    const buttons = rows[row];
    buttons[Math.max(0, Math.min(col, buttons.length - 1))]?.focus();
  };

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      className={`${className} impact-surface flex flex-col`}
      style={style}
      onKeyDown={onKeyDown}
      onFocus={(event) => {
        const target = event.target as Node;
        const rows = rowsOf(event.currentTarget);
        const row = rows.findIndex((buttons) => buttons.some((button) => button === target));
        if (row >= 0) {
          lastFocus.current = { row, col: rows[row].findIndex((button) => button === target) };
        }
      }}
    >
      {children}
    </div>
  );
}

function ItemRow({
  item,
  active,
  actions,
  onDone,
}: {
  item: BarItem;
  active: boolean;
  actions: BarActions;
  onDone: () => void;
}) {
  return (
    <div data-row="" data-active={active || undefined} className="tabs-menu-row" role="none">
      <button
        type="button"
        role="menuitem"
        className="tabs-menu-open"
        title={item.tooltip}
        aria-current={active ? 'page' : undefined}
        onClick={() => {
          actions.open(item);
          onDone();
        }}
      >
        {item.pinned && <Pin {...ICON} className={`${ICON.className} tabs-menu-pin-mark`} />}
        <span className="tab-title">{item.title}</span>
      </button>
      {item.canPin && (
        <button
          type="button"
          role="menuitem"
          className="tabs-menu-icon"
          aria-label={item.pinned ? `Unpin ${item.title}` : `Pin ${item.title}`}
          title={item.pinned ? 'Unpin' : 'Pin to the top bar'}
          onClick={() => actions.togglePin(item)}
        >
          {item.pinned ? <PinOff {...ICON} /> : <Pin {...ICON} />}
        </button>
      )}
      {item.open ? (
        <button
          type="button"
          role="menuitem"
          className="tabs-menu-icon"
          aria-label={`Close ${item.title}`}
          title="Close"
          onClick={() => actions.close(item)}
        >
          <X {...ICON} />
        </button>
      ) : (
        <span className="tabs-menu-icon" aria-hidden="true" />
      )}
    </div>
  );
}

function ActionRow({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <div data-row="" className="tabs-menu-row" role="none">
      <button type="button" role="menuitem" className="tabs-menu-open" onClick={onClick}>
        {children}
      </button>
    </div>
  );
}

export function OpenTabsMenu({
  items,
  activeId,
  actions,
  trigger,
  onClose,
}: {
  items: BarItem[];
  activeId: string | null;
  actions: BarActions;
  trigger: HTMLElement | null;
  onClose: (restoreFocus: boolean) => void;
}) {
  const pinned = items.filter((item) => item.pinned);
  const open = items.filter((item) => !item.pinned);
  const openCount = items.filter((item) => item.open).length;
  const done = () => onClose(false);

  const section = (label: string, list: BarItem[]) =>
    list.length > 0 && (
      <div role="group" aria-label={label}>
        <div className="section-header tabs-menu-label" aria-hidden="true">
          {label}
        </div>
        {list.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            active={item.id === activeId}
            actions={actions}
            onDone={done}
          />
        ))}
      </div>
    );

  return (
    <MenuSurface label="Open tabs" className="tabs-menu" onClose={onClose} ignore={trigger}>
      <div className="tabs-menu-list">
        {section('Pinned', pinned)}
        {section('Open', open)}
      </div>
      {openCount > 0 && (
        <div className="tabs-menu-footer">
          {openCount > 1 && activeId && (
            <ActionRow
              onClick={() => {
                actions.closeOthers(activeId);
                done();
              }}
            >
              Close other tabs
            </ActionRow>
          )}
          <ActionRow
            onClick={() => {
              actions.closeAll();
              done();
            }}
          >
            Close all tabs
          </ActionRow>
        </div>
      )}
    </MenuSurface>
  );
}

export function TabContextMenu({
  item,
  x,
  y,
  openCount,
  actions,
  onClose,
}: {
  item: BarItem;
  x: number;
  y: number;
  openCount: number;
  actions: BarActions;
  onClose: (restoreFocus: boolean) => void;
}) {
  const run = (action: () => void) => () => {
    action();
    onClose(true);
  };
  return (
    <MenuSurface
      label={`${item.title} options`}
      className="tabs-menu tabs-context-menu"
      // A tab near the right edge would open its menu past the window.
      style={{ left: `min(${x}px, calc(100vw - 220px))`, top: y }}
      onClose={onClose}
    >
      {item.canPin && (
        <ActionRow onClick={run(() => actions.togglePin(item))}>
          {item.pinned ? 'Unpin from the top bar' : 'Pin to the top bar'}
        </ActionRow>
      )}
      {item.open && <ActionRow onClick={run(() => actions.close(item))}>Close</ActionRow>}
      {openCount - (item.open ? 1 : 0) > 0 && (
        <ActionRow onClick={run(() => actions.closeOthers(item.id))}>Close other tabs</ActionRow>
      )}
      {openCount > 0 && <ActionRow onClick={run(actions.closeAll)}>Close all tabs</ActionRow>}
    </MenuSurface>
  );
}
