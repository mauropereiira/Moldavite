import { Profiler } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note, NoteFile } from '@/types';
import { useNoteStore, useQuickSwitcherStore, useSettingsStore } from '@/stores';
import { isMobilePlatform, isTabletPlatform } from '@/lib/platform';
import { rememberActiveForge } from '@/lib/forgeStorage';
import { TabBar } from './TabBar';

const loadNote = vi.fn();
vi.mock('@/hooks', () => ({ useNotes: () => ({ loadNote }) }));
vi.mock('@/lib/platform', () => ({
  isMobilePlatform: vi.fn(() => false),
  isTabletPlatform: vi.fn(() => false),
}));

const note = (id: string, overrides: Partial<Note> = {}): Note => ({
  id,
  title: id.replace(/^notes\//, '').replace(/\.md$/, ''),
  content: `<p>${id}</p>`,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  isDaily: false,
  isWeekly: false,
  ...overrides,
});

const file = (path: string): NoteFile => ({
  name: path.slice(path.lastIndexOf('/') + 1),
  path,
  isDaily: false,
  isWeekly: false,
  isLocked: false,
});

const ids = () => useNoteStore.getState().openTabs.map((tab) => tab.id);
const pins = () => useQuickSwitcherStore.getState().pinnedNoteIds;
const nameOf = (element: Element | null) =>
  element?.textContent || element?.getAttribute('aria-label');
const tabNames = () =>
  screen.getAllByRole('tab').map((tab) => tab.querySelector('.tab-title')?.textContent);

/** Opens notes as tabs, the last one active. */
function openNotes(...paths: string[]) {
  const tabs = paths.map((path) => note(path));
  useNoteStore.setState({
    notes: paths.map(file),
    openTabs: tabs,
    activeTabId: tabs[tabs.length - 1]?.id ?? null,
    currentNote: tabs[tabs.length - 1] ?? null,
    savedContent: new Map(tabs.map((tab) => [tab.id, tab.content])),
    externallyChanged: new Map(),
  });
}

/** jsdom does no layout, so give every tab and the strip a width. */
function mockLayout(stripWidth: number, tabWidth = 100) {
  const offset = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (
    this: HTMLElement
  ) {
    return this.classList.contains('tab') ? tabWidth : 0;
  });
  const client = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (
    this: HTMLElement
  ) {
    return this.classList.contains('tab-strip') ? stripWidth : 0;
  });
  return () => {
    offset.mockRestore();
    client.mockRestore();
  };
}

beforeEach(() => {
  localStorage.clear();
  loadNote.mockReset();
  vi.mocked(isMobilePlatform).mockReturnValue(false);
  vi.mocked(isTabletPlatform).mockReturnValue(false);
  useQuickSwitcherStore.setState({ pinnedNoteIds: [] });
  useSettingsStore.setState({ showTabBar: true });
  openNotes();
});

describe('TabBar', () => {
  it('renders nothing with no tabs and no pins', () => {
    const { container } = render(<TabBar />);
    expect(container).toBeEmptyDOMElement();
  });

  // Mauro's ask: the note you open is in the bar, ready to pin.
  it('shows a single open note, ready to pin, and pins it from the tab', () => {
    openNotes('notes/roadmap.md');
    render(<TabBar />);

    expect(screen.getByRole('tab', { name: /roadmap/ })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Pin roadmap' }));

    expect(pins()).toEqual(['notes/roadmap.md']);
    expect(screen.getByRole('button', { name: 'Unpin roadmap' })).toBeInTheDocument();
  });

  it('puts pins first with a pin mark, then open tabs, and unpinning keeps the tab open', () => {
    openNotes('notes/a.md', 'notes/b.md', 'notes/c.md');
    useQuickSwitcherStore.setState({ pinnedNoteIds: ['notes/c.md'] });
    render(<TabBar />);

    expect(tabNames()).toEqual(['c', 'a', 'b']);
    expect(screen.getByRole('tab', { name: /^c/ })).toHaveClass('tab-pinned');
    expect(document.querySelector('.tab-strip > .tabs-divider')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Unpin c' }));

    expect(pins()).toEqual([]);
    expect(ids()).toEqual(['c', 'a', 'b'].map((n) => `notes/${n}.md`));
    expect(screen.getByRole('tab', { name: /^c/ })).not.toHaveClass('tab-pinned');
  });

  it('opens a pin that is not open through the normal load path, and switches to one that is', () => {
    openNotes('notes/open.md', 'notes/reading.md');
    useNoteStore.setState({
      notes: ['notes/open.md', 'notes/reading.md', 'notes/closed.md'].map(file),
    });
    useQuickSwitcherStore.setState({ pinnedNoteIds: ['notes/closed.md', 'notes/open.md'] });
    render(<TabBar />);

    fireEvent.click(screen.getByRole('tab', { name: /^closed/ }));
    expect(loadNote).toHaveBeenCalledWith(expect.objectContaining({ path: 'notes/closed.md' }));

    fireEvent.click(screen.getByRole('tab', { name: /^open/ }));
    expect(useNoteStore.getState().activeTabId).toBe('notes/open.md');
  });

  // Deleted outside the app, or left from another Forge.
  it('skips a pin whose note no longer exists', () => {
    openNotes('notes/a.md');
    useQuickSwitcherStore.setState({ pinnedNoteIds: ['notes/gone.md'] });
    render(<TabBar />);
    expect(tabNames()).toEqual(['a']);
  });

  it('shows daily notes as Today and keeps their pin', () => {
    const today = new Date();
    const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
      today.getDate()
    ).padStart(2, '0')}`;
    const daily: NoteFile = { ...file(`daily/${date}.md`), isDaily: true, date };
    useNoteStore.setState({ notes: [daily] });
    useQuickSwitcherStore.setState({ pinnedNoteIds: [daily.path] });
    render(<TabBar />);
    expect(tabNames()).toEqual(['Today']);
  });

  it('closes a tab with its ×, with a middle click, and never shows × on a pin', () => {
    openNotes('notes/a.md', 'notes/b.md', 'notes/c.md');
    useQuickSwitcherStore.setState({ pinnedNoteIds: ['notes/a.md'] });
    render(<TabBar />);

    expect(screen.queryByRole('button', { name: 'Close a' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close c' }));
    expect(ids()).toEqual(['notes/a.md', 'notes/b.md']);

    fireEvent(
      screen.getByRole('tab', { name: /^b/ }),
      new MouseEvent('auxclick', { bubbles: true, button: 1 })
    );
    expect(ids()).toEqual(['notes/a.md']);
  });

  it('offers Pin first in a tab’s context menu, and Unpin for a pin', () => {
    openNotes('notes/a.md', 'notes/b.md');
    render(<TabBar />);

    fireEvent.contextMenu(screen.getByRole('tab', { name: /^a/ }));
    let menu = screen.getByRole('menu', { name: 'a options' });
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'Pin to the top bar',
      'Close',
      'Close other tabs',
      'Close all tabs',
    ]);
    expect(items[0]).toHaveFocus();
    fireEvent.click(items[0]);
    expect(pins()).toEqual(['notes/a.md']);

    fireEvent.contextMenu(screen.getByRole('tab', { name: /^a/ }));
    menu = screen.getByRole('menu', { name: 'a options' });
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Unpin from the top bar' }));
    expect(pins()).toEqual([]);
    expect(ids()).toEqual(['notes/a.md', 'notes/b.md']);
  });

  it('closes the other tabs from a tab’s context menu, keeping that tab', () => {
    openNotes('notes/a.md', 'notes/b.md', 'notes/c.md');
    render(<TabBar />);
    fireEvent.contextMenu(screen.getByRole('tab', { name: /^a/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close other tabs' }));
    expect(ids()).toEqual(['notes/a.md']);
  });

  it('opens the context menu from the keyboard and closes it with Escape', () => {
    openNotes('notes/a.md', 'notes/b.md');
    render(<TabBar />);
    const tab = screen.getByRole('tab', { name: /^b/ });
    tab.focus();

    fireEvent.keyDown(tab, { key: 'F10', shiftKey: true });
    const menu = screen.getByRole('menu', { name: 'b options' });
    fireEvent.keyDown(within(menu).getAllByRole('menuitem')[0], { key: 'Escape' });

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(tab).toHaveFocus();
  });

  describe('Open tabs menu', () => {
    beforeEach(() => {
      openNotes('notes/a.md', 'notes/b.md', 'notes/c.md');
      useNoteStore.setState({
        notes: ['notes/a.md', 'notes/b.md', 'notes/c.md', 'notes/p.md'].map(file),
      });
      useQuickSwitcherStore.setState({ pinnedNoteIds: ['notes/p.md', 'notes/a.md'] });
    });

    const openMenu = () => {
      fireEvent.click(screen.getByRole('button', { name: /^Open tabs/ }));
      return screen.getByRole('menu', { name: 'Open tabs' });
    };

    it('lists Pinned and Open, each row able to open, pin or unpin, and close', () => {
      render(<TabBar />);
      const menu = openMenu();

      const pinned = within(menu).getByRole('group', { name: 'Pinned' });
      const open = within(menu).getByRole('group', { name: 'Open' });
      expect(within(pinned).getAllByRole('menuitem').map(nameOf)).toEqual([
        'p',
        'Unpin p',
        'a',
        'Unpin a',
        'Close a',
      ]);
      expect(within(open).getAllByRole('menuitem').map(nameOf)).toEqual([
        'b',
        'Pin b',
        'Close b',
        'c',
        'Pin c',
        'Close c',
      ]);
      // The current note has the focus when the menu opens.
      expect(within(open).getByRole('menuitem', { name: 'c' })).toHaveFocus();
      expect(within(open).getByRole('menuitem', { name: 'c' })).toHaveAttribute(
        'aria-current',
        'page'
      );
    });

    it('pins, unpins and closes without closing the menu, and opening a row closes it', () => {
      render(<TabBar />);
      const menu = openMenu();

      fireEvent.click(within(menu).getByRole('menuitem', { name: 'Pin b' }));
      expect(pins()).toEqual(['notes/p.md', 'notes/a.md', 'notes/b.md']);
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'Unpin a' }));
      expect(pins()).toEqual(['notes/p.md', 'notes/b.md']);
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'Close a' }));
      expect(ids()).not.toContain('notes/a.md');
      expect(screen.getByRole('menu', { name: 'Open tabs' })).toBeInTheDocument();

      fireEvent.click(within(menu).getByRole('menuitem', { name: 'p' }));
      expect(loadNote).toHaveBeenCalledWith(expect.objectContaining({ path: 'notes/p.md' }));
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('closes other tabs or all tabs, and pins stay in the bar', () => {
      render(<TabBar />);
      fireEvent.click(within(openMenu()).getByRole('menuitem', { name: 'Close other tabs' }));
      expect(ids()).toEqual(['notes/c.md']);

      fireEvent.click(within(openMenu()).getByRole('menuitem', { name: 'Close all tabs' }));
      expect(useNoteStore.getState()).toMatchObject({
        openTabs: [],
        activeTabId: null,
        currentNote: null,
      });
      expect(tabNames()).toEqual(['p', 'a']);
    });

    it('moves with the arrow keys, and Escape returns focus to the button', () => {
      render(<TabBar />);
      const menu = openMenu();
      const focused = () => nameOf(document.activeElement);

      expect(focused()).toBe('c');
      fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowRight' });
      expect(focused()).toBe('Pin c');
      fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowRight' });
      expect(focused()).toBe('Close c');
      fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowUp' });
      expect(focused()).toBe('Close b');
      fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowLeft' });
      expect(focused()).toBe('Pin b');
      fireEvent.keyDown(document.activeElement as Element, { key: 'Home' });
      expect(focused()).toBe('p');
      fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowUp' });
      expect(focused()).toBe('Close all tabs');
      fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' });
      expect(focused()).toBe('p');

      fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
      expect(menu).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^Open tabs/ })).toHaveFocus();
    });

    it('keeps the focus in place after closing the focused row', () => {
      render(<TabBar />);
      openMenu();
      const close = screen.getByRole('menuitem', { name: 'Close b' });
      close.focus();
      fireEvent.click(close);
      expect(nameOf(document.activeElement)).toBe('Close c');
    });

    it('closes on a press outside, but not on its own button', () => {
      render(<TabBar />);
      openMenu();
      fireEvent.pointerDown(screen.getByRole('button', { name: /^Open tabs/ }));
      expect(screen.getByRole('menu', { name: 'Open tabs' })).toBeInTheDocument();
      fireEvent.pointerDown(document.body);
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
  });

  describe('overflow', () => {
    let restore: () => void = () => {};
    afterEach(() => restore());

    it('folds what does not fit into Open tabs, with a count, keeping the active tab', () => {
      restore = mockLayout(420);
      openNotes('notes/a.md', 'notes/b.md', 'notes/c.md', 'notes/d.md', 'notes/e.md');
      render(<TabBar />);

      // Four 100px tabs and their gaps fit in 420; the active tab is the last.
      expect(tabNames()).toEqual(['a', 'b', 'c', 'e']);
      expect(screen.getByRole('button', { name: 'Open tabs, 1 more' })).toHaveTextContent('+1');
    });

    it.each([
      [800, 7],
      [1280, 12],
      [2560, 24],
    ])('holds 25 pins and 40 open tabs at %ipx', (width, shown) => {
      restore = mockLayout(width);
      const open = Array.from({ length: 40 }, (_, i) => `notes/open-${i}.md`);
      const pinned = Array.from({ length: 25 }, (_, i) => `notes/pin-${i}.md`);
      openNotes(...open);
      useNoteStore.setState({ notes: [...open, ...pinned].map(file) });
      useQuickSwitcherStore.setState({ pinnedNoteIds: pinned });
      render(<TabBar />);

      const visible = screen.getAllByRole('tab');
      expect(visible).toHaveLength(shown);
      expect(visible[visible.length - 1]).toHaveAttribute('aria-selected', 'true');
      expect(tabNames()[visible.length - 1]).toBe('open-39');
      expect(screen.getByRole('button', { name: `Open tabs, ${65 - shown} more` })).toBeVisible();

      fireEvent.click(screen.getByRole('button', { name: /^Open tabs/ }));
      const menu = screen.getByRole('menu', { name: 'Open tabs' });
      expect(within(menu).getAllByRole('menuitem', { name: /^Unpin / })).toHaveLength(25);
      expect(within(menu).getAllByRole('menuitem', { name: /^Close open-/ })).toHaveLength(40);
    });
  });

  describe('with the tab bar turned off', () => {
    beforeEach(() => useSettingsStore.setState({ showTabBar: false }));

    it('shows nothing while nothing is pinned', () => {
      openNotes('notes/a.md', 'notes/b.md');
      const { container } = render(<TabBar />);
      expect(container).toBeEmptyDOMElement();
    });

    it('shows only the pins', () => {
      openNotes('notes/a.md', 'notes/b.md');
      useQuickSwitcherStore.setState({ pinnedNoteIds: ['notes/a.md'] });
      render(<TabBar />);
      expect(tabNames()).toEqual(['a']);
      expect(screen.queryByRole('button', { name: /^Open tabs/ })).not.toBeInTheDocument();
    });
  });

  describe('drag and keyboard reordering', () => {
    beforeEach(() => {
      openNotes('notes/a.md', 'notes/b.md', 'notes/c.md', 'notes/d.md');
      useQuickSwitcherStore.setState({ pinnedNoteIds: ['notes/a.md', 'notes/b.md'] });
    });

    const drag = (from: string, to: string) => {
      const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
      fireEvent.dragStart(screen.getByRole('tab', { name: new RegExp(`^${from}`) }), {
        dataTransfer,
      });
      const target = screen.getByRole('tab', { name: new RegExp(`^${to}`) });
      fireEvent.dragOver(target, { dataTransfer });
      fireEvent.drop(target, { dataTransfer });
    };

    it('moves pins among pins and open tabs among open tabs, never across', () => {
      render(<TabBar />);
      drag('b', 'a');
      expect(pins()).toEqual(['notes/b.md', 'notes/a.md']);
      drag('d', 'c');
      expect(ids().slice(2)).toEqual(['notes/d.md', 'notes/c.md']);
      drag('d', 'a');
      expect(pins()).toEqual(['notes/b.md', 'notes/a.md']);
      expect(ids().slice(2)).toEqual(['notes/d.md', 'notes/c.md']);
    });

    it('moves a tab with alt+arrow and walks the bar with the arrows', () => {
      render(<TabBar />);
      const a = screen.getByRole('tab', { name: /^a/ });
      fireEvent.keyDown(a, { key: 'ArrowRight', altKey: true });
      expect(pins()).toEqual(['notes/b.md', 'notes/a.md']);
      // Off the end of its group, it stays put.
      fireEvent.keyDown(a, { key: 'ArrowRight', altKey: true });
      expect(pins()).toEqual(['notes/b.md', 'notes/a.md']);

      a.focus();
      fireEvent.keyDown(a, { key: 'ArrowRight' });
      expect(screen.getByRole('tab', { name: /^c/ })).toHaveFocus();
      fireEvent.keyDown(document.activeElement as Element, { key: 'Enter' });
      expect(useNoteStore.getState().activeTabId).toBe('notes/c.md');
    });
  });

  describe('on a phone', () => {
    beforeEach(() => vi.mocked(isMobilePlatform).mockReturnValue(true));

    it('shows the note you are reading and an Open tabs button with the rest', () => {
      openNotes('notes/a.md', 'notes/b.md', 'notes/c.md');
      useQuickSwitcherStore.setState({ pinnedNoteIds: ['notes/a.md'] });
      render(<TabBar />);

      expect(tabNames()).toEqual(['c']);
      expect(screen.getByRole('button', { name: 'Pin c' })).toBeInTheDocument();
      const trigger = screen.getByRole('button', { name: 'Open tabs, 2 more' });
      expect(trigger).toHaveTextContent('Tabs3');
      expect(document.querySelector('.tab-measure')).toBeNull();

      fireEvent.click(trigger);
      const menu = screen.getByRole('menu', { name: 'Open tabs' });
      expect(within(menu).getByRole('menuitem', { name: 'Unpin a' })).toBeInTheDocument();
      expect(within(menu).getByRole('menuitem', { name: 'Close b' })).toBeInTheDocument();
    });

    it('keeps the Open tabs button on the welcome screen', () => {
      useNoteStore.setState({ notes: [file('notes/a.md'), file('notes/b.md')] });
      useQuickSwitcherStore.setState({ pinnedNoteIds: ['notes/a.md', 'notes/b.md'] });
      render(<TabBar />);
      expect(screen.queryAllByRole('tab')).toHaveLength(0);
      expect(screen.getByRole('button', { name: 'Open tabs, 2 more' })).toBeInTheDocument();
    });

    it('reaches a single pin from the welcome screen', () => {
      useNoteStore.setState({ notes: [file('notes/a.md')] });
      useQuickSwitcherStore.setState({ pinnedNoteIds: ['notes/a.md'] });
      render(<TabBar />);
      expect(screen.queryAllByRole('tab')).toHaveLength(0);
      fireEvent.click(screen.getByRole('button', { name: 'Open tabs, 1 more' }));
      const menu = screen.getByRole('menu', { name: 'Open tabs' });
      expect(within(menu).getByRole('menuitem', { name: 'Unpin a' })).toBeInTheDocument();
    });

    it('lays an iPad out like a desktop', () => {
      vi.mocked(isTabletPlatform).mockReturnValue(true);
      openNotes('notes/a.md', 'notes/b.md', 'notes/c.md');
      render(<TabBar />);
      expect(tabNames()).toEqual(['a', 'b', 'c']);
    });
  });

  // The bar is on screen for every note now, and the editor writes the open
  // tab on every keystroke.
  it('does not re-render while you type, but does when a pin changes', () => {
    openNotes('notes/a.md', 'notes/b.md');
    let commits = 0;
    render(
      <Profiler id="bar" onRender={() => (commits += 1)}>
        <TabBar />
      </Profiler>
    );
    const settled = commits;

    act(() => {
      for (const text of ['<p>t</p>', '<p>ty</p>', '<p>typ</p>']) {
        useNoteStore.getState().updateNoteContent(text, 'notes/b.md');
      }
    });
    expect(commits).toBe(settled);

    act(() => useQuickSwitcherStore.getState().togglePinned('notes/b.md'));
    expect(commits).toBeGreaterThan(settled);
  });

  // Pins are Forge-relative paths, so each Forge keeps its own.
  it('shows each Forge’s own pins across a Forge switch', async () => {
    rememberActiveForge('Alpha');
    useNoteStore.setState({ notes: ['notes/a.md', 'notes/b.md'].map(file) });
    useQuickSwitcherStore.getState().togglePinned('notes/a.md');
    render(<TabBar />);
    expect(tabNames()).toEqual(['a']);

    await act(async () => {
      rememberActiveForge('Beta');
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    act(() => useQuickSwitcherStore.getState().togglePinned('notes/b.md'));
    expect(tabNames()).toEqual(['b']);

    await act(async () => {
      rememberActiveForge('Alpha');
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(tabNames()).toEqual(['a']);
  });

  it('survives rapid open, pin, unpin and close', () => {
    render(<TabBar />);
    const store = useNoteStore.getState();
    const quick = useQuickSwitcherStore.getState();
    act(() => {
      for (let i = 0; i < 60; i += 1) {
        const id = `notes/n${i % 12}.md`;
        store.openTab(note(id), i % 3 === 0);
        if (i % 4 === 0) quick.togglePinned(id);
        if (i % 5 === 0) void store.closeTab(`notes/n${(i + 3) % 12}.md`);
        if (i % 7 === 0) quick.togglePinned(`notes/n${(i + 1) % 12}.md`);
      }
    });

    const state = useNoteStore.getState();
    const pinned = pins().filter((id) => state.openTabs.some((tab) => tab.id === id));
    const shown = screen.getAllByRole('tab').map((tab) => tab.title);
    expect(new Set(shown).size).toBe(shown.length);
    expect(state.openTabs.slice(0, pinned.length).map((tab) => tab.id)).toEqual(pinned);
    expect(state.currentNote?.id ?? null).toBe(state.activeTabId);
    expect(screen.getByRole('tab', { selected: true }).title).toBe(state.currentNote?.title);
  });
});
